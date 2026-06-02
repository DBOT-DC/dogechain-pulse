'use strict';

// ═══════════════════════════════════════════════════════════════════
//  Dogechain Pulse — community-driven project directory
//  Loads projects.json, renders directory, handles votes (local),
//  search/filter, submit-a-project, shareable routes.
// ═══════════════════════════════════════════════════════════════════

const DATA_URL = './data/projects.json';
const VOTE_KEY = 'pulse:votes:v1';
const SUBMIT_KEY = 'pulse:submissions:v1';
const WALLET_KEY = 'pulse:wallet:v1';
const VOTE_SIG_PREFIX = 'pulse:vote:';
const VOTE_SIG_INDEX = 'pulse:vote:__index';
const PULSE_PREFIX = 'pulse:';
const DAILY_VOTE_BUDGET = 30;
const REFRESH_BLOCK_MS = 30_000;
const SIWE_DOMAIN = (typeof location !== 'undefined' ? location.host : 'pulse.dogechain.dog');
const SIWE_EXPIRY_DAYS = 7;
let data = null;
let votes = loadVotes();
let submissions = loadSubmissions();
let wallet = loadWallet();
let activeCategory = 'all';
let searchQuery = '';
let sortBy = 'votes';
let blockTimer = null;

// ─── Persistence ───────────────────────────────────────────────────
// Single parse primitive — self-heals on corrupt JSON, warns in dev.
function safeParse(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return v == null ? fallback : v;
  } catch (err) {
    console.warn(`[pulse] corrupt key "${key}", resetting:`, err);
    try { localStorage.removeItem(key); } catch {}
    return fallback;
  }
}

// Single write primitive — surfaces QuotaExceededError as a user toast,
// returns true on success so callers can roll back in-memory state on failure.
function store(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    const isQuota = err && (err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014);
    if (isQuota && typeof showToast === 'function') {
      showToast('Browser storage is full — your vote may not persist. Try clearing site data.', 'err');
    } else {
      console.warn(`[pulse] write failed for ${key}:`, err);
    }
    return false;
  }
}

const voteSigKey = id => `${VOTE_SIG_PREFIX}${id}`;

function loadVotes()       { return safeParse(VOTE_KEY, {}); }
function saveVotes()       { return store(VOTE_KEY, votes); }
function loadSubmissions() { return safeParse(SUBMIT_KEY, []); }
function saveSubmissions() { return store(SUBMIT_KEY, submissions); }
function loadWallet() {
  const raw = safeParse(WALLET_KEY, null);
  if (raw && raw.expiresAt && raw.expiresAt < Date.now()) {
    try { localStorage.removeItem(WALLET_KEY); } catch {}
    return null;
  }
  return raw;
}
function saveWallet(w) {
  if (w) return store(WALLET_KEY, w);
  try { localStorage.removeItem(WALLET_KEY); } catch {}
  return true;
}

// Per-project sig index — keeps listVoteSigs() O(1) instead of O(n) over localStorage.
function touchSigIndex(id) {
  try {
    const ids = JSON.parse(localStorage.getItem(VOTE_SIG_INDEX) || '[]');
    if (!ids.includes(id)) { ids.push(id); localStorage.setItem(VOTE_SIG_INDEX, JSON.stringify(ids)); }
  } catch {}
}
function untouchSigIndex(id) {
  try {
    const ids = JSON.parse(localStorage.getItem(VOTE_SIG_INDEX) || '[]').filter(x => x !== id);
    localStorage.setItem(VOTE_SIG_INDEX, JSON.stringify(ids));
  } catch {}
}
function listVoteSigs() {
  try {
    const ids = JSON.parse(localStorage.getItem(VOTE_SIG_INDEX) || '[]');
    return ids.map(id => ({ id, sig: loadVoteSig(id) })).filter(x => x.sig);
  } catch { return []; }
}

// Backup / restore — every pulse:* key in one JSON blob.
function exportData() {
  return JSON.stringify({
    __v: 1,
    exportedAt: new Date().toISOString(),
    votes: loadVotes(),
    submissions: loadSubmissions(),
    wallet: loadWallet(),
    sigs: listVoteSigs().reduce((acc, { id, sig }) => (acc[id] = sig, acc), {})
  }, null, 2);
}
function importData(json, { merge = true } = {}) {
  let obj; try { obj = JSON.parse(json); } catch { return { ok: false, error: 'not json' }; }
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'bad shape' };
  if (!merge) clearAllLocalData();
  if (obj.votes)       { votes       = merge ? { ...loadVotes(),       ...obj.votes }       : obj.votes;       saveVotes(); }
  if (obj.submissions) { submissions = merge ? [...loadSubmissions(),  ...obj.submissions] : obj.submissions; saveSubmissions(); }
  if (obj.wallet !== undefined) { wallet = obj.wallet; saveWallet(wallet); }
  if (obj.sigs) for (const [id, sig] of Object.entries(obj.sigs)) {
    if (sig && sig.address && sig.sig && sig.ts) { store(voteSigKey(id), sig); touchSigIndex(id); }
  }
  return { ok: true, merged: merge };
}

// Reset to clean slate. Cache mutation matters — without it the next render
// would show the old data. The 'storage' event does NOT fire in the clearing tab.
function clearAllLocalData() {
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PULSE_PREFIX)) toRemove.push(k);
  }
  toRemove.forEach(k => { try { localStorage.removeItem(k); } catch {} });
  votes = {}; submissions = []; wallet = null;
}

// ─── Time / format helpers ─────────────────────────────────────────
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const votesToday = () => {
  const k = todayKey();
  let n = 0;
  for (const id of Object.keys(votes)) {
    const v = votes[id];
    if (v && v.daily && v.daily[k]) n += Object.keys(v.daily[k]).length;
  }
  return n;
};
const remainingVotes = () => Math.max(0, DAILY_VOTE_BUDGET - votesToday());
const slugify = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Lucide icon library — minimal subset of category icons we use
const LUCIDE = {
  'coins':          '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
  'image':          '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  'message-circle': '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  'server':         '<rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>',
  'wrench':         '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  'arrow-right-left':'<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  'smile':          '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
  'sparkles':       '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3"/>',
  'layers':         '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  'wallet':         '<path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1"/><path d="M16 12h6v4h-6a2 2 0 0 1 0-4z"/>',
  'chevron-up':     '<polyline points="18 15 12 9 6 15"/>',
  'check':          '<polyline points="20 6 9 17 4 12"/>',
  'copy':           '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  'arrow-left':     '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  'x':              '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  'info-circle':    '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  'book-open':      '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  'bar-chart-3':    '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  'chevron-down':   '<polyline points="6 9 12 15 18 9"/>'
};
const lucide = (name, size = 13) => {
  const path = LUCIDE[name] || LUCIDE['sparkles'];
  return `<svg class="lucide-ico" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
};
const fmtUsd = n => {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
};
const fmtNum = n => {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
};
const truncateAddr = a => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';
const relTime = iso => {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days < 1) return 'today';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
};
const debounce = (fn, ms = 200) => {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};

// ─── Toast ─────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, kind = '') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `toast show ${kind}`.trim();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = `toast ${kind}`.trim(); }, 2400);
}

// ─── Data access ───────────────────────────────────────────────────
function allProjects() {
  if (!data) return [];
  return [...data.projects, ...submissions];
}
function projectById(id) {
  return allProjects().find(p => p.id === id);
}
function categoryDef(id) {
  return data?.categories.find(c => c.id === id);
}

// ─── Voting ────────────────────────────────────────────────────────
// VOTING MODEL
// ────────────
// Voting is gated by a wallet signature (EIP-4361, Sign-In With Ethereum).
// For each project, on the first vote attempt we:
//   1. Ensure a wallet is connected (window.ethereum, EIP-1193).
//   2. Build a SIWE-shaped message with a fresh 16-byte nonce.
//   3. Request personal_sign from the user's wallet.
//   3a. Cache the signature in localStorage at `pulse:vote:<project-id>`
//       for SIWE_EXPIRY_DAYS (7) days so we don't re-prompt on every vote.
//   4. Record the vote in `votes[id].daily[todayKey()][id] = Date.now()`.
//
// VERIFICATION HONESTY
// ────────────────────
// This is a fully client-side directory. There is no backend. The only
// thing preventing a single user from casting more than one vote per
// project per day is the `pulse:vote:<project-id>` entry in *their* browser.
// A determined user can clear localStorage, switch wallets, or open a
// private window and vote again. Acceptable for a community-directory MVP.
// Future hardening: a Cloudflare Worker that verifies the EIP-4361 sig
// and dedupes by (address, projectId) on the server side.

function loadVoteSig(id) {
  const raw = safeParse(voteSigKey(id), null);
  if (!raw) return null;
  if (!raw.address || !raw.sig || !raw.nonce || !raw.ts) { untouchSigIndex(id); return null; }
  if (Date.now() - raw.ts > SIWE_EXPIRY_DAYS * 86400_000) {
    try { localStorage.removeItem(voteSigKey(id)); } catch {}
    untouchSigIndex(id);
    return null;
  }
  return raw;
}

// Build the EIP-4361 SIWE message we ask the wallet to sign.
function buildSiweMessage(address, projectName, nonce) {
  const issuedAt = new Date().toISOString();
  return [
    `${SIWE_DOMAIN} wants you to sign in with your Ethereum account:`,
    address,
    '',
    `Vote for ${projectName}`,
    '',
    'URI: https://dogechain-pulse.vercel.app',
    'Version: 1',
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`
  ].join('\n');
}

function makeNonce() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

// Request a SIWE signature for this project and cache it.
async function signVoteFor(projectId) {
  const eth = getEthereum();
  if (!eth) {
    showToast('No wallet detected. Install MetaMask or use a wallet browser.', 'warn');
    return null;
  }
  if (!wallet) {
    showToast('Connect a wallet first.', 'warn');
    return null;
  }
  const p = projectById(projectId);
  if (!p) return null;
  const nonce = makeNonce();
  const message = buildSiweMessage(wallet.address, p.name, nonce);
  let sig;
  try {
    sig = await eth.request({ method: 'personal_sign', params: [message, wallet.address] });
  } catch (e) {
    if (e?.code === 4001) showToast('Signature cancelled.', 'warn');
    else showToast(`Wallet error: ${e?.message || 'unknown'}`, 'err');
    return null;
  }
  const record = { address: wallet.address, sig, ts: Date.now(), nonce };
  if (store(voteSigKey(projectId), record)) { touchSigIndex(projectId); return record; }
  return null;
}

// Returns one of: 'disconnected' | 'ready' | 'voted'
function voteState(id) {
  if (!wallet) return 'disconnected';
  if (hasVoted(id)) return 'voted';
  return 'ready';
}

// Main entry point: the card / detail button calls this.
// Three states:
//   - disconnected: open the connect prompt; do NOT record a vote.
//   - ready:        request a SIWE signature, then record the vote.
//   - voted:        no-op (button is disabled in the UI anyway).
async function voteFor(id) {
  const p = projectById(id);
  if (!p) return;
  const state = voteState(id);
  if (state === 'disconnected') {
    openConnectPrompt(p);
    return;
  }
  if (state === 'voted') return;

  // state === 'ready'
  let sigRec = loadVoteSig(id);
  if (!sigRec) {
    sigRec = await signVoteFor(id);
    if (!sigRec) return; // user cancelled or wallet error
  }
  // Sanity: the cached signature should belong to the currently connected wallet.
  if (sigRec.address.toLowerCase() !== wallet.address.toLowerCase()) {
    try { localStorage.removeItem(voteSigKey(id)); } catch {}
    sigRec = await signVoteFor(id);
    if (!sigRec) return;
  }
  // Record the vote (client-side, see VERIFICATION HONESTY above).
  const k = todayKey();
  if (!votes[id]) votes[id] = { daily: {} };
  if (!votes[id].daily[k]) votes[id].daily[k] = {};
  votes[id].daily[k][id] = Date.now();
  if (!saveVotes()) {
    // Rollback: failed write should not be visible to the user.
    delete votes[id].daily[k][id];
    if (Object.keys(votes[id].daily[k]).length === 0) delete votes[id].daily[k];
    if (Object.keys(votes[id].daily).length === 0)    delete votes[id];
    showToast('Vote not saved. Storage may be full or blocked.', 'err');
    return;
  }
  // Optimistic UI updates + toast.
  showToast(`Vote recorded for ${p.name} · signature expires in 7 days`, 'ok');
  renderGrid();
  renderStats();
  // Animate the just-voted card.
  const btn = document.querySelector(`[data-vote="${CSS.escape(id)}"]`);
  if (btn) {
    btn.classList.add('vote-just-voted');
    setTimeout(() => btn.classList.remove('vote-just-voted'), 600);
  }
}
function voteCount(id) {
  let n = 0;
  for (const day of Object.values(votes[id]?.daily || {})) n += Object.keys(day).length;
  const p = projectById(id);
  if (p && p.pending) n += 0; // pending doesn't get baseline
  return n + (p?.votes || 0);
}
function hasVoted(id) {
  const k = todayKey();
  return !!(votes[id]?.daily?.[k]?.[id]);
}

// ─── Wallet (EIP-4361 Sign-In With Ethereum) ──────────────────────
// Opt-in power-user feature: connect a wallet to remove the daily vote budget.
// One address = one vote per project per day. Sig stored locally, expires in 7 days.
function getEthereum() {
  if (typeof window === 'undefined') return null;
  return window.ethereum || null;
}
function isWalletAvailable() {
  const eth = getEthereum();
  return !!(eth && typeof eth.request === 'function');
}
async function connectWallet() {
  const eth = getEthereum();
  if (!eth) {
    showToast('No wallet detected. Install MetaMask, Rabby, or any EIP-1193 wallet.', 'warn');
    return null;
  }
  try {
    // 1. Request accounts (triggers wallet popup)
    const accounts = await eth.request({ method: 'eth_requestAccounts' });
    if (!accounts || !accounts.length) {
      showToast('Wallet connection cancelled.', 'warn');
      return null;
    }
    const address = accounts[0];
    // 2. Get chain ID (informational; we don't enforce Dogechain)
    let chainId = null;
    try {
      chainId = await eth.request({ method: 'eth_chainId' });
    } catch {}
    // 3. Build SIWE message
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    const issuedAt = new Date().toISOString();
    const expiryTime = new Date(Date.now() + SIWE_EXPIRY_DAYS * 86400_000).toISOString();
    const message = [
      `${SIWE_DOMAIN} wants you to sign in with your Ethereum account:`,
      address,
      '',
      'Sign in to Dogechain Pulse to vote on projects without daily limits.',
      '',
      `URI: https://${SIWE_DOMAIN}/`,
      `Version: 1`,
      `Nonce: ${nonce}`,
      `Issued At: ${issuedAt}`,
      `Expiration Time: ${expiryTime}`,
      `Chain ID: ${chainId || '0'}`
    ].join('\n');
    // 4. Request signature
    const signature = await eth.request({
      method: 'personal_sign',
      params: [message, address]
    });
    // 5. Persist
    wallet = {
      address,
      chainId,
      signature,
      message,
      nonce,
      issuedAt,
      expiresAt: Date.now() + SIWE_EXPIRY_DAYS * 86400_000
    };
    saveWallet(wallet);
    showToast(`Wallet connected: ${shortAddr(address)}`, 'ok');
    renderWalletUI();
    renderStats();
    renderGrid();
    return wallet;
  } catch (e) {
    if (e?.code === 4001) {
      showToast('Wallet connection cancelled.', 'warn');
    } else {
      showToast(`Wallet error: ${e?.message || 'unknown'}`, 'err');
    }
    return null;
  }
}
function disconnectWallet() {
  wallet = null;
  saveWallet(null);
  showToast('Wallet disconnected.', 'ok');
  renderWalletUI();
  renderStats();
  renderGrid();
}
function shortAddr(a) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';
}

// ─── Connect-prompt modal ──────────────────────────────────────────
// Shown when a user clicks "Connect to vote" on a card or in the detail
// view. We don't navigate away from the page; we just open a small dialog
// that calls connectWallet(). On success, the calling code re-invokes
// voteFor(id) so the user lands in the "ready" state immediately.
let _connectPromptContext = null;

function openConnectPrompt(project) {
  _connectPromptContext = project ? { id: project.id, name: project.name } : null;
  const dlg = document.getElementById('connectPromptModal');
  if (!dlg) { connectWallet(); return; }
  const slot = dlg.querySelector('[data-connect-project]');
  if (slot && project) slot.textContent = project.name;
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
}

function closeConnectPrompt() {
  _connectPromptContext = null;
  const dlg = document.getElementById('connectPromptModal');
  if (!dlg) return;
  if (typeof dlg.close === 'function') dlg.close();
  else dlg.removeAttribute('open');
}

async function connectPromptAction() {
  if (!isWalletAvailable()) {
    showToast('No wallet detected. Install MetaMask or use a wallet browser.', 'warn');
    return;
  }
  const w = await connectWallet();
  if (!w) return; // user cancelled or errored
  const ctx = _connectPromptContext;
  closeConnectPrompt();
  if (ctx && ctx.id) voteFor(ctx.id);
}

// ─── Submission (local-only, also offers GitHub issue path) ─────────
function submitProject(form) {
  const fd = new FormData(form);
  const name = (fd.get('name') || '').toString().trim();
  if (!name) return false;
  const baseId = slugify(name);
  let id = baseId;
  let n = 2;
  while (projectById(id)) id = `${baseId}-${n++}`;
  const cat = (fd.get('category') || '').toString();
  const sub = {
    id,
    name,
    tagline: (fd.get('tagline') || '').toString().slice(0, 80),
    description: (fd.get('description') || '').toString().slice(0, 400),
    category: cat,
    logo: null,
    color: '#8a8a8a',
    website: (fd.get('website') || '').toString().trim() || null,
    twitter: normalizeTwitter((fd.get('twitter') || '').toString().trim()) || null,
    telegram: (fd.get('telegram') || '').toString().trim() || null,
    github: null,
    contracts: fd.get('contract') ? [{ chain: 'Dogechain', type: 'token', address: (fd.get('contract') || '').toString().trim(), symbol: '' }] : [],
    metrics: null,
    tags: ['community-submitted'],
    addedAt: new Date().toISOString(),
    addedBy: (fd.get('submitter') || '').toString().trim() || 'pulse-submission',
    featured: false,
    pending: true
  };
  submissions.push(sub);
  saveSubmissions();
  return sub;
}
function normalizeTwitter(v) {
  if (!v) return null;
  if (v.startsWith('http')) return v;
  if (v.startsWith('@')) return `https://x.com/${v.slice(1)}`;
  return `https://x.com/${v}`;
}
function buildGitHubIssueUrl(sub) {
  const params = new URLSearchParams({
    title: `[Pulse] Submit: ${sub.name}`,
    labels: 'pulse-submission',
    template: 'pulse-submission.md',
    name: sub.name,
    tagline: sub.tagline,
    description: sub.description || '(none)',
    category: sub.category,
    website: sub.website || '',
    twitter: sub.twitter || '',
    telegram: sub.telegram || '',
    contracts: (sub.contracts || []).map(c => `${c.chain}:${c.address}${c.symbol ? ` (${c.symbol})` : ''}`).join(', ') || '',
    submitter: sub.addedBy
  });
  return `https://github.com/DBOT-DC/dogechain-pulse/issues/new?${params.toString()}`;
}

// ─── Render: stats ─────────────────────────────────────────────────
function renderStats() {
  const bar = document.getElementById('statsBar');
  if (!bar || !data) return;
  const projects = allProjects();
  const cats = new Set(projects.map(p => p.category).filter(Boolean));
  const tvl = projects.reduce((s, p) => s + (p.metrics?.tvlUsd || 0), 0);
  const totalVotes = projects.reduce((s, p) => s + voteCount(p.id), 0);
  const budgetLabel = wallet ? `${shortAddr(wallet.address)}` : `${fmtNum(remainingVotes())}`;
  const budgetKey = wallet ? 'connected-wallet' : 'daily-votes-left';
  const stats = [
    { label: 'Projects listed', value: fmtNum(projects.length) },
    { label: 'Categories', value: fmtNum(cats.size) },
    { label: 'Total DeFi TVL', value: fmtUsd(tvl) },
    { label: 'Community votes', value: fmtNum(totalVotes) },
    { label: wallet ? 'Voting as' : 'Daily votes left', value: budgetLabel, key: budgetKey, isWallet: !!wallet }
  ];
  bar.innerHTML = stats.map(s => `
    <div class="stat ${s.isWallet ? 'stat-wallet' : ''}">
      <div class="stat-value" data-stat="${esc(s.label.toLowerCase().replace(/[^a-z]+/g, '-'))}">${esc(s.value)}</div>
      <div class="stat-label">${esc(s.label)}</div>
    </div>
  `).join('') + `<div class="stat" id="blockStat">
      <div class="stat-value" data-stat="latest-block">…</div>
      <div class="stat-label">Latest block</div>
    </div>`;
  refreshBlock();
}

// ─── Render: wallet UI ────────────────────────────────────────────
function renderWalletUI() {
  const btn = document.getElementById('walletBtn');
  if (!btn) return;
  if (wallet) {
    btn.className = 'btn wallet connected';
    btn.innerHTML = `<span class="wallet-dot" aria-hidden="true"></span><span class="wallet-addr">${esc(shortAddr(wallet.address))}</span>`;
    btn.title = `Connected: ${wallet.address}\nClick to disconnect`;
    btn.onclick = () => { if (confirm('Disconnect wallet?')) disconnectWallet(); };
  } else {
    btn.className = 'btn ghost wallet';
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1"/><path d="M16 12h6v4h-6a2 2 0 0 1 0-4z"/></svg><span>${isWalletAvailable() ? 'Connect wallet' : 'No wallet'}</span>`;
    btn.title = isWalletAvailable() ? 'Sign in with your Ethereum wallet (EIP-4361) for unlimited voting' : 'No EIP-1193 wallet detected';
    btn.onclick = isWalletAvailable() ? connectWallet : null;
    if (!isWalletAvailable()) btn.disabled = true;
  }
}

// ─── Render: category chips ────────────────────────────────────────
function renderCategoryChips() {
  const bar = document.getElementById('catBar');
  if (!bar || !data) return;
  const counts = { all: allProjects().length };
  for (const c of data.categories) counts[c.id] = 0;
  for (const p of allProjects()) {
    if (counts[p.category] != null) counts[p.category]++;
  }
  const chips = [
    `<button class="chip ${activeCategory === 'all' ? 'active' : ''}" data-cat="all" type="button">All <span class="count">${counts.all}</span></button>`,
    ...data.categories.map(c => `
      <button class="chip ${activeCategory === c.id ? 'active' : ''} ${counts[c.id] === 0 ? 'empty' : ''}" data-cat="${esc(c.id)}" type="button" ${counts[c.id] === 0 ? 'disabled' : ''}>
        <span class="cat-ico" aria-hidden="true">${lucide(c.icon || 'sparkles', 13)}</span> ${esc(c.label)} <span class="count">${counts[c.id]}</span>
      </button>`)
  ];
  bar.innerHTML = chips.join('');
  bar.querySelectorAll('.chip').forEach(b => {
    b.addEventListener('click', () => {
      activeCategory = b.dataset.cat;
      bar.querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === b));
      renderGrid();
    });
  });
}

// ─── Render: project grid ──────────────────────────────────────────
function renderGrid() {
  const grid = document.getElementById('grid');
  if (!grid || !data) return;
  let filtered = allProjects();
  if (activeCategory !== 'all') filtered = filtered.filter(p => p.category === activeCategory);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(p => {
      const hay = [
        p.name, p.tagline, p.description, ...(p.tags || []),
        ...(p.contracts || []).map(c => `${c.address} ${c.symbol || ''}`),
        categoryDef(p.category)?.label || ''
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }
  if (sortBy === 'votes') filtered.sort((a, b) => voteCount(b.id) - voteCount(a.id));
  else if (sortBy === 'newest') filtered.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
  else if (sortBy === 'az') filtered.sort((a, b) => a.name.localeCompare(b.name));

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty"><h3>No projects match.</h3><p>Try a different search or category. Or <button class="btn primary inline" id="emptySubmit" type="button">submit a new project</button>.</p></div>`;
    const btn = document.getElementById('emptySubmit');
    if (btn) btn.addEventListener('click', openSubmitModal);
    return;
  }

  const spotlightId = (() => {
    if (sortBy !== 'votes') return null;
    const top = [...filtered].sort((a, b) => voteCount(b.id) - voteCount(a.id))[0];
    return top && voteCount(top.id) > 0 ? top.id : null;
  })();

  grid.innerHTML = filtered.map(p => renderCard(p, p.id === spotlightId)).join('');
  grid.querySelectorAll('[data-card]').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('a, button')) return;
      openDetail(el.dataset.card);
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(el.dataset.card); }
    });
  });
  grid.querySelectorAll('[data-vote]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      await voteFor(btn.dataset.vote);
    });
  });
  grid.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); copyAddr(btn.dataset.copy, btn); });
  });
}

function renderCard(p, spotlight) {
  const cat = categoryDef(p.category);
  const catStyle = cat
    ? `style="--cat-color:${esc(cat.color || '#888')}"`
    : '';
  const links = [
    p.website && linkBtn('web', p.website, 'Website'),
    p.twitter && linkBtn('x', p.twitter, 'X / Twitter'),
    p.telegram && linkBtn('tg', p.telegram, 'Telegram'),
    p.discord && linkBtn('dc', p.discord, 'Discord'),
    p.github && linkBtn('gh', p.github, 'GitHub')
  ].filter(Boolean).join('');
  const contracts = (p.contracts || []).slice(0, 2).map(c => `
    <button class="addr ${c.verified ? 'verified' : ''}" data-copy="${esc(c.address)}" data-copy-btn
      title="${c.verified ? 'Verified on-chain: ' + esc(c.verifiedNote || 'name/symbol/decimals confirmed') : 'Click to copy'}"
      type="button" aria-label="Copy contract address ${esc(truncateAddr(c.address))}">
      <span class="chain">${esc(c.chain || 'Dogechain')}</span>
      <span class="addr-txt">${esc(truncateAddr(c.address))}${c.symbol ? ` · ${esc(c.symbol)}` : ''}</span>
      <span class="copy-btn" aria-hidden="true">${lucide('copy', 11)}</span>
      ${c.verified ? `<span class="verified-tick" aria-label="verified on-chain">${lucide('check', 10)}</span>` : ''}
    </button>`).join('');
  return `
    <article class="card ${p.pending ? 'pending' : ''} ${spotlight ? 'spotlight' : ''}"
             ${catStyle}
             data-card="${esc(p.id)}" tabindex="0" role="button"
             aria-label="Open ${esc(p.name)}">
      ${spotlight ? `<div class="spotlight-badge">${lucide('sparkles', 11)} Today's spotlight</div>` : ''}
      ${p.pending ? `<div class="pending-badge">Pending</div>` : ''}
      <div class="card-head">
        <div class="card-logo" style="background:${esc(p.color || '#1c1f26')}22; border-color:${esc(p.color || '#262a33')}">${esc(p.name.slice(0, 1))}</div>
        <div class="card-title">
          <h2>${esc(p.name)}</h2>
          <div class="card-tagline">${esc(p.tagline || '')}</div>
        </div>
      </div>
      ${cat ? `<div class="card-cat" style="--cat-color:${esc(cat.color || '#888')}"><span class="cat-ico" aria-hidden="true">${lucide(cat.icon, 11)}</span> ${esc(cat.label)}</div>` : ''}
      <p class="card-desc">${esc(p.description || '')}</p>
      ${p.tags?.length ? `<div class="tags">${p.tags.slice(0, 4).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
      ${contracts ? `<div class="contracts">${contracts}</div>` : ''}
      <div class="card-foot">
        <div class="links">${links}</div>
        ${voteButtonHtml(p.id, p.name, false)}
      </div>
    </article>`;
}

// Renders the vote button in one of three states. Used by both the card
// and the detail modal. `large` toggles the .lg modifier for the bigger
// button used in the detail view.
function voteButtonHtml(id, name, large) {
  const state = voteState(id);
  const count = voteCount(id);
  const cls = [
    'vote',
    state === 'voted' ? 'voted' : '',
    state === 'disconnected' ? 'vote-disconnected' : '',
    large ? 'lg' : ''
  ].filter(Boolean).join(' ');
  const aria = state === 'voted'
    ? `Voted for ${esc(name)}`
    : state === 'disconnected'
      ? `Connect to vote for ${esc(name)}`
      : `Vote for ${esc(name)}`;
  let icon, label, pressed, disabled;
  if (state === 'disconnected') {
    icon = lucide('wallet', large ? 14 : 12);
    label = large ? 'Connect to vote' : 'Connect';
    pressed = 'false';
    disabled = '';
  } else if (state === 'voted') {
    icon = lucide('check', large ? 14 : 12);
    label = large ? 'Voted' : '';
    pressed = 'true';
    disabled = ' disabled';
  } else {
    icon = lucide('chevron-up', large ? 14 : 12);
    label = large ? 'Vote' : '';
    pressed = 'false';
    disabled = '';
  }
  // Hide the count entirely when disconnected (the wallet is the focus).
  const showCount = state !== 'disconnected';
  return `<button class="${cls}" data-vote="${esc(id)}" data-vote-state="${state}" type="button" aria-pressed="${pressed}" aria-label="${aria}"${disabled}>
    <span class="vote-ico-wrap" aria-hidden="true">${icon}</span>
    ${showCount ? `<span class="vote-n">${count}</span>` : ''}
    ${label ? `<span class="vote-label">${esc(label)}</span>` : ''}
  </button>`;
}

function linkBtn(kind, url, label) {
  const icons = {
    web: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20"/></svg>',
    x:   '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M18 3h3l-7.5 8.6L22 21h-6.8l-5.3-6.6L4 21H1l8-9.2L1 3h7l4.8 6L18 3z"/></svg>',
    tg:  '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M9.5 14.5l-.4 4c.5 0 .7-.2 1-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3-14c.3-1.2-.4-1.7-1.3-1.4L1.7 9.5c-1.2.5-1.1 1.1-.2 1.4l4.6 1.4L16.7 4.6c.5-.3 1-.2.6.2"/></svg>',
    dc:  '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 5a3 3 0 00-3-3H8a3 3 0 00-3 3v14a3 3 0 003 3h8a3 3 0 003-3V5zM8 4h8a1 1 0 011 1v3H7V5a1 1 0 011-1zm0 16a1 1 0 01-1-1v-9h10v9a1 1 0 01-1 1H8z"/></svg>',
    gh:  '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 1.5a10.5 10.5 0 00-3.3 20.5c.5.1.7-.2.7-.5v-2c-3 .7-3.6-1.3-3.6-1.3-.5-1.3-1.2-1.6-1.2-1.6-1-.6.1-.6.1-.6 1 .1 1.6 1.1 1.6 1.1 1 1.6 2.4 1.2 3 .9.1-.7.4-1.2.6-1.5-2.4-.3-4.9-1.2-4.9-5.3 0-1.2.4-2.1 1.1-2.8-.1-.3-.5-1.4.1-2.8 0 0 .9-.3 3 1.1a10 10 0 015.5 0c2.1-1.4 3-1.1 3-1.1.6 1.4.2 2.5.1 2.8.7.7 1.1 1.6 1.1 2.8 0 4.1-2.5 5-4.9 5.3.4.3.7 1 .7 2v3c0 .3.2.6.7.5A10.5 10.5 0 0012 1.5z"/></svg>'
  };
  return `<a class="iconlink" href="${esc(url)}" target="_blank" rel="noopener" aria-label="${esc(label)}">${icons[kind] || icons.web}</a>`;
}

// ─── Render: detail modal ──────────────────────────────────────────
function renderDetail(p) {
  const cat = categoryDef(p.category);
  const contracts = (p.contracts || []).map(c => `
    <div class="detail-contract">
      <div class="dc-head"><strong>${esc(c.type || 'contract')}</strong>${c.symbol ? ` · ${esc(c.symbol)}` : ''} <span class="chain-tag">${esc(c.chain || 'Dogechain')}</span>${c.verified ? `<span class="verified-pill" title="${esc(c.verifiedNote || 'Verified via eth_call')}"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-1px;margin-right:2px"><polyline points="20 6 9 17 4 12"/></svg>verified</span>` : ''}</div>
      <button class="addr ${c.verified ? 'verified' : ''}" data-copy="${esc(c.address)}" type="button">
        <span class="addr-txt">${esc(c.address)}</span>
        <svg class="copy-ico" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>
    </div>`).join('') || '<div class="muted">No on-chain contracts listed.</div>';
  const tags = (p.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('');
  const m = p.metrics || {};
  const metrics = (m.tvlUsd != null || m.volume24hUsd != null || m.holders != null) ? `
    <div class="detail-metrics">
      ${m.tvlUsd != null ? `<div><div class="m-value">${esc(fmtUsd(m.tvlUsd))}</div><div class="m-label">TVL</div></div>` : ''}
      ${m.volume24hUsd != null ? `<div><div class="m-value">${esc(fmtUsd(m.volume24hUsd))}</div><div class="m-label">24h volume</div></div>` : ''}
      ${m.holders != null ? `<div><div class="m-value">${esc(fmtNum(m.holders))}</div><div class="m-label">Holders</div></div>` : ''}
    </div>` : '';
  const links = [p.website, p.twitter, p.telegram, p.discord, p.github].filter(Boolean).map((u, i) => {
    const labels = ['Website', 'X / Twitter', 'Telegram', 'Discord', 'GitHub'];
    return `<a class="btn ghost small" href="${esc(u)}" target="_blank" rel="noopener">${esc(labels[i] || 'Link')} ↗</a>`;
  }).join('');
  return `
    <div class="detail-head">
      <div class="detail-logo" style="background:${esc(p.color || '#1c1f26')}22; border-color:${esc(p.color || '#262a33')}">${esc(p.name.slice(0, 1))}</div>
      <div class="detail-title">
        <h2 id="detailTitle">${esc(p.name)}</h2>
        <div class="detail-sub">${esc(p.tagline || '')}</div>
        ${cat ? `<div class="card-cat" style="--cat-color:${esc(cat.color || '#888')}"><span class="cat-ico">${lucide(cat.icon, 11)}</span> ${esc(cat.label)}</div>` : ''}
      </div>
    </div>
    <p class="detail-desc">${esc(p.description || '')}</p>
    ${metrics}
    <div class="section"><h3>Contracts</h3>${contracts}</div>
    ${tags ? `<div class="section"><h3>Tags</h3><div class="tags">${tags}</div></div>` : ''}
    <div class="section"><h3>Links</h3><div class="links-row">${links || '<div class="muted">No links listed.</div>'}</div></div>
    <div class="section detail-meta">
      <span class="muted">Added ${esc(relTime(p.addedAt))}${p.addedBy ? ` · ${esc(p.addedBy)}` : ''}${p.pending ? ' · pending verification' : ''}</span>
    </div>
    <div class="detail-foot">
      ${voteButtonHtml(p.id, p.name, true)}
      <button class="btn ghost" data-close type="button">Close</button>
    </div>`;
}

function openDetail(id) {
  const p = projectById(id);
  if (!p) return;
  const dlg = document.getElementById('detailModal');
  document.getElementById('detailBody').innerHTML = renderDetail(p);
  wireDetailHandlers(p);
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
  history.replaceState(null, '', `#/project/${encodeURIComponent(id)}`);
  document.getElementById('detailBody').querySelector('[data-close]')?.focus();
}
function closeDetail() {
  const dlg = document.getElementById('detailModal');
  if (typeof dlg.close === 'function') dlg.close();
  else dlg.removeAttribute('open');
  if (location.hash.startsWith('#/project/')) history.replaceState(null, '', '#/');
}
function wireDetailHandlers(p) {
  document.getElementById('detailBody').querySelectorAll('[data-copy]').forEach(b => {
    b.addEventListener('click', () => copyAddr(b.dataset.copy, b));
  });
  document.getElementById('detailBody').querySelectorAll('[data-vote]').forEach(b => {
    b.addEventListener('click', async () => {
      await voteFor(p.id);
      // Re-render the detail body so the button state updates.
      const body = document.getElementById('detailBody');
      if (body) body.innerHTML = renderDetail(p);
      wireDetailHandlers(p);
    });
  });
  document.getElementById('detailBody').querySelectorAll('[data-close]').forEach(b => {
    b.addEventListener('click', closeDetail);
  });
}

function copyAddr(addr, btnEl) {
  if (!addr) return;
  const finish = (ok) => {
    if (!btnEl) return;
    btnEl.classList.add(ok ? 'copied' : 'copy-fail');
    setTimeout(() => btnEl.classList.remove('copied', 'copy-fail'), 1400);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(addr).then(
      () => { showToast('Copied to clipboard', 'ok'); finish(true); },
      () => { fallbackCopy(addr); finish(true); }
    );
  } else {
    fallbackCopy(addr);
    finish(true);
  }
}
function fallbackCopy(addr) {
  const ta = document.createElement('textarea');
  ta.value = addr;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); showToast('Copied to clipboard', 'ok'); }
  catch { showToast('Copy failed — long-press to copy', 'warn'); }
  document.body.removeChild(ta);
}

// ─── Submit modal ──────────────────────────────────────────────────
function openSubmitModal() {
  const dlg = document.getElementById('submitModal');
  // Populate category options
  const sel = dlg.querySelector('select[name="category"]');
  if (sel && data && !sel.dataset.populated) {
    sel.innerHTML = '<option value="">Choose one…</option>' + data.categories.map(c =>
      `<option value="${esc(c.id)}">${esc(c.icon)} ${esc(c.label)}</option>`
    ).join('');
    sel.dataset.populated = '1';
  }
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
  dlg.querySelector('input[name="name"]')?.focus();
}
function closeSubmitModal() {
  const dlg = document.getElementById('submitModal');
  if (typeof dlg.close === 'function') dlg.close();
  else dlg.removeAttribute('open');
  dlg.querySelector('form')?.reset();
}

// ─── Live block height ─────────────────────────────────────────────
async function refreshBlock() {
  const el = document.querySelector('[data-stat="latest-block"]');
  if (!el) return;
  const endpoints = [
    'https://rpc.dogechain.dog',
    'https://dogechain-rpc.publicnode.com'
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 })
      });
      if (!res.ok) continue;
      const j = await res.json();
      if (j?.result) {
        const n = parseInt(j.result, 16);
        el.textContent = fmtNum(n);
        return;
      }
    } catch {}
  }
  el.textContent = '—';
}

// ─── Routes (hash-based) ───────────────────────────────────────────
function handleRoute() {
  const h = location.hash || '';
  if (h.startsWith('#/project/')) {
    const id = decodeURIComponent(h.replace('#/project/', ''));
    if (data && projectById(id)) openDetail(id);
  }
}

// ─── Resources rail (inline About / Methodology / Stats) ───────────
// Three teaser cards in a row that sit between the stats bar and the
// project grid. Clicking a card expands a panel of rich content below
// the row (one open at a time, fluid height animation).
function renderResourcesRail() {
  const items = [
    { id: 'about',        icon: 'info-circle',  title: 'About',        sub: 'Community-curated directory of Dogechain projects',   body: aboutContent()        },
    { id: 'methodology',  icon: 'book-open',    title: 'Methodology',  sub: 'How projects get listed, verified, and voted on',   body: methodologyContent()  },
    { id: 'stats',        icon: 'bar-chart-3',  title: 'Stats',        sub: 'Network metrics, refresh cadence, and data sources', body: statsContent()        },
  ];
  return `<section class="res" aria-label="About, methodology, and stats">
    <div class="res-cards">${
      items.map(it => `
        <article class="res-card" data-res-id="${it.id}">
          <span class="res-icon">${lucide(it.icon, 18)}</span>
          <div class="res-text">
            <h3 class="res-title">${it.title}</h3>
            <p class="res-sub">${it.sub}</p>
          </div>
          <span class="res-chev">${lucide('chevron-down', 16)}</span>
        </article>`).join('')
    }</div>
    <div class="res-panels">${
      items.map(it => `
        <div class="res-panel" data-res-panel="${it.id}" hidden>
          <div class="res-panel-inner">
            ${it.body}
            <button type="button" class="res-gotit" data-res-close="${it.id}">Got it</button>
          </div>
        </div>`).join('')
    }</div>
  </section>`;
}

function aboutContent() {
  return `
    <p><strong>Dogechain Pulse</strong> is a community-curated directory of projects, protocols, and people building on the <a href="https://dogechain.dog" target="_blank" rel="noopener">Dogechain Network</a>. It's open source, has no accounts, and no server. The data is a single JSON file in the GitHub repo that anyone can read, fork, or submit to.</p>
    <h2>What it does</h2>
    <ul>
      <li><strong>Directory</strong> — every project gets a card with contracts, socials, and metrics</li>
      <li><strong>Upvotes</strong> — the community decides what gets the daily spotlight</li>
      <li><strong>Submissions</strong> — anyone can submit a project; it goes live immediately with a "pending" badge and is verified through community upvotes</li>
      <li><strong>Live data</strong> — the latest Dogechain block is fetched fresh every 30 seconds</li>
    </ul>
    <h2>Who runs it</h2>
    <p>Built and maintained by <a href="https://dbot.dog" target="_blank" rel="noopener">DBOT</a> — the Dogechain community agent. Source on <a href="https://github.com/DBOT-DC/dogechain-pulse" target="_blank" rel="noopener">GitHub</a>. The canonical data file is at <a href="https://github.com/DBOT-DC/dogechain-pulse/blob/main/data/projects.json" target="_blank" rel="noopener"><code>data/projects.json</code></a> and is a free public read-only API.</p>`;
}
function methodologyContent() {
  return `
    <h2>How projects get listed</h2>
    <ol>
      <li><strong>Seeded</strong> — initial 9 projects are hand-curated by DBOT based on on-chain activity, public socials, and Dogechain ecosystem relevance.</li>
      <li><strong>Submitted</strong> — anyone can submit a project via the form. It appears immediately with a "pending" badge.</li>
      <li><strong>Verified</strong> — pending projects graduate when community upvotes push them past the spotlight threshold (10+ votes).</li>
      <li><strong>Pruned</strong> — projects with no socials, broken contracts, or no on-chain activity for 90+ days get removed in the next data refresh.</li>
    </ol>
    <h2>Voting</h2>
    <p>You need to <strong>connect a wallet</strong> to vote. We use Sign-In With Ethereum (EIP-4361) to verify a unique human per project: you sign a message with your wallet, the signature is cached in your browser for 7 days, and your vote is recorded. One vote per project per day. The signature proves you are a unique human without revealing your identity. We never send your address anywhere — everything is client-side.</p>
    <p>No wallet? Click any vote button to open the connect prompt. We support any EIP-1193 wallet (MetaMask, Rabby, Frame, etc).</p>
    <h2>Data freshness</h2>
    <ul>
      <li><strong>Project cards</strong> — verified weekly by DBOT against the Dogechain RPC and public APIs.</li>
      <li><strong>TVL / 24h volume</strong> — pulled from DefiLlama and GeckoTerminal daily.</li>
      <li><strong>Latest block</strong> — fetched live from the Dogechain RPC, refreshed every 30 seconds.</li>
    </ul>`;
}
function statsContent() {
  const ps = allProjects();
  const byCat = {};
  for (const p of ps) byCat[p.category] = (byCat[p.category] || 0) + 1;
  return `
    <p>Live ecosystem data as of ${esc(new Date().toISOString().slice(0, 16).replace('T', ' '))} UTC.</p>
    <h2>By category</h2>
    <ul>
      ${data.categories.map(c => `<li><strong>${esc(c.icon)} ${esc(c.label)}</strong>: ${byCat[c.id] || 0} project${byCat[c.id] === 1 ? '' : 's'}</li>`).join('')}
    </ul>
    <h2>Totals</h2>
    <ul>
      <li>Projects listed: <strong>${ps.length}</strong></li>
      <li>Total community votes: <strong>${ps.reduce((s, p) => s + voteCount(p.id), 0)}</strong></li>
      <li>Pending submissions: <strong>${ps.filter(p => p.pending).length}</strong></li>
    </ul>`;
}

// ─── Init ──────────────────────────────────────────────────────────
async function init() {
  // Wire static-event listeners first so we can show errors
  document.getElementById('openSubmit').addEventListener('click', openSubmitModal);
  renderWalletUI();
  // Listen for wallet account changes
  if (getEthereum()) {
    try {
      getEthereum().on?.('accountsChanged', (accounts) => {
        if (!accounts || !accounts.length) disconnectWallet();
        else if (wallet && accounts[0].toLowerCase() !== wallet.address.toLowerCase()) {
          disconnectWallet();
          connectWallet();
        }
      });
      getEthereum().on?.('chainChanged', () => { renderWalletUI(); });
    } catch {}
  }
  document.getElementById('search').addEventListener('input', debounce(e => {
    searchQuery = e.target.value.trim();
    renderGrid();
  }, 150));
  document.getElementById('sort').addEventListener('change', e => {
    sortBy = e.target.value === 'newest' ? 'newest' : e.target.value === 'az' ? 'az' : 'votes';
    renderGrid();
  });
  // Submit modal
  const sm = document.getElementById('submitModal');
  sm.addEventListener('click', e => { if (e.target === sm) closeSubmitModal(); });
  sm.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeSubmitModal));
  sm.querySelector('form').addEventListener('submit', e => {
    e.preventDefault();
    const sub = submitProject(e.target);
    if (!sub) return;
    closeSubmitModal();
    renderCategoryChips();
    renderGrid();
    const url = buildGitHubIssueUrl(sub);
    showToast('Saved locally — opening GitHub to file your submission', 'ok');
    setTimeout(() => window.open(url, '_blank', 'noopener'), 600);
  });

  // Connect-prompt modal (wallet required to vote)
  const cpm = document.getElementById('connectPromptModal');
  if (cpm) {
    cpm.addEventListener('click', e => { if (e.target === cpm) closeConnectPrompt(); });
    cpm.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeConnectPrompt));
    document.getElementById('connectPromptAction')?.addEventListener('click', connectPromptAction);
  }
  // Detail modal
  const dm = document.getElementById('detailModal');
  dm.addEventListener('click', e => { if (e.target === dm) closeDetail(); });
  dm.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeDetail));
  // Global keys
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeDetail(); closeSubmitModal(); closeConnectPrompt(); }
    if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
      e.preventDefault();
      document.getElementById('search').focus();
    }
  });
  window.addEventListener('hashchange', handleRoute);

  // Load data
  try {
    const res = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    document.getElementById('grid').innerHTML = `
      <div class="error">
        <h2>Couldn't load the directory.</h2>
        <p>${esc(err.message || 'Unknown error')}</p>
        <p>Try <button class="btn primary inline" id="retry" type="button">reloading</button> or check <a href="https://github.com/DBOT-DC/dogechain-pulse" target="_blank" rel="noopener">GitHub</a> for status.</p>
      </div>`;
    document.getElementById('retry')?.addEventListener('click', () => location.reload());
    return;
  }

  renderStats();
  renderCategoryChips();
  renderGrid();
  handleRoute();

  // Resources rail (About / Methodology / Stats) — sits between catbar and grid
  // so visitors encounter it at the start of the directory, not buried below.
  const _grid = document.getElementById('grid');
  if (_grid) {
    const _res = document.createElement('div');
    _res.innerHTML = renderResourcesRail();
    while (_res.firstChild) _grid.parentNode.insertBefore(_res.firstChild, _grid);
    // Children were moved out of _res into the document. Re-query the rail
    // (the <section> we just inserted before #grid) to wire up listeners.
    const rail = _grid.previousElementSibling;
    if (rail) {
      // Wire up card → panel toggle (one panel open at a time)
      rail.querySelectorAll('.res-card').forEach(card => {
        card.addEventListener('click', () => {
          const id = card.dataset.resId;
          const panel = rail.querySelector(`[data-res-panel="${id}"]`);
          if (!panel) return;
          const wasOpen = !panel.hidden;
          // Close all panels and clear all card states
          rail.querySelectorAll('.res-panel').forEach(p => p.hidden = true);
          rail.querySelectorAll('.res-card').forEach(c => c.classList.remove('open'));
          if (!wasOpen) {
            panel.hidden = false;
            card.classList.add('open');
            requestAnimationFrame(() => {
              card.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
          }
        });
      });
      // "Got it" button → close panel, collapse card state, smooth-scroll up
      rail.addEventListener('click', (e) => {
        const t = e.target.closest('[data-res-close]');
        if (!t) return;
        const id = t.dataset.resClose;
        const panel = rail.querySelector(`[data-res-panel="${id}"]`);
        const card  = rail.querySelector(`.res-card[data-res-id="${id}"]`);
        if (panel) panel.hidden = true;
        if (card)  card.classList.remove('open');
        if (card)  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }

  // Cross-tab sync: writes to any pulse:* key in another tab fire 'storage' here.
  // The writing tab does NOT receive this event, so no loop risk.
  window.addEventListener('storage', (e) => {
    if (!e.key || !e.key.startsWith('pulse:')) return;
    votes       = loadVotes();
    submissions = loadSubmissions();
    wallet      = loadWallet();
    renderStats();
    renderGrid();
  });

  // Periodic block refresh
  clearInterval(blockTimer);
  blockTimer = setInterval(refreshBlock, REFRESH_BLOCK_MS);
}

document.addEventListener('DOMContentLoaded', init);
