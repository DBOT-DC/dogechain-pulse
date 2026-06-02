#!/usr/bin/env node
/**
 * verify-submission.js
 * -------------------
 * Auto-verifier for pulse-submission issues.
 *
 * Takes a GitHub issue body (markdown) and returns a structured review packet:
 *   - Parses the submission fields
 *   - eth_call the contract on the Dogechain public RPC (if any)
 *   - HEAD-checks each social link
 *   - Dedups against data/projects.json
 *   - Returns JSON: { ok, fields, checks[], issues[] }
 *
 * Designed to be:
 *   - Runnable locally:  node scripts/verify-submission.js '<issue-body>'
 *   - Callable from a GitHub Action
 *   - Dependency-free except for Node's built-in fetch (Node 18+)
 *
 * License: MIT
 */

const DOGECHAIN_RPC = 'https://rpc.dogechain.dog';
const RPC_TIMEOUT_MS = 5000;
const HTTP_TIMEOUT_MS = 8000;
const CONTRACT_CACHE = new Map(); // address -> { ok, name, symbol, decimals, totalSupply, err }

/* ────────────────────────── Issue body parser ────────────────────────── */

function parseIssueBody(body) {
  const fields = {
    name: null, tagline: null, description: null, category: null,
    website: null, twitter: null, telegram: null,
    contract: null, submitter: null,
  };
  if (!body) return fields;
  const lines = body.split('\n');
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    const m = line.match(/^\*\*(Name|Tagline|Description|Category|Website|X\s*\/\s*Twitter|Telegram|Contract(?:\s*\(.*?\))?|Submitted by):\*\*\s*(.*)$/i);
    if (m) {
      current = m[1].toLowerCase();
      const val = m[2].trim();
      const map = {
        'name': 'name', 'tagline': 'tagline', 'description': 'description',
        'category': 'category', 'website': 'website',
        'x / twitter': 'twitter', 'telegram': 'telegram',
        'contract (dogechain, optional)': 'contract',
        'submitted by': 'submitter',
      };
      const key = map[current];
      if (key) fields[key] = val || null;
      current = key;
    } else if (current && line && !line.startsWith('#') && !line.startsWith('<!--')) {
      // Continuation of a multi-line field
      if (fields[current]) fields[current] += ' ' + line;
      else fields[current] = line;
    }
  }
  // Normalize twitter
  if (fields.twitter) {
    fields.twitter = fields.twitter.replace(/^@/, '').trim();
    if (fields.twitter && !/^https?:\/\//.test(fields.twitter))
      fields.twitter = 'https://x.com/' + fields.twitter;
  }
  // Normalize telegram
  if (fields.telegram) {
    if (/^https?:\/\//.test(fields.telegram)) {
      // already a full URL, leave it
    } else {
      fields.telegram = 'https://t.me/' + fields.telegram.replace(/^t\.me\//, '').replace(/^@/, '').trim();
    }
  }
  // Validate contract
  if (fields.contract && !/^0x[0-9a-fA-F]{40}$/.test(fields.contract.trim())) {
    fields.contract = null;
  } else if (fields.contract) {
    fields.contract = fields.contract.trim().toLowerCase();
  }
  return fields;
}

/* ────────────────────────── Contract verifier ────────────────────────── */

async function rpcCall(method, params) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), RPC_TIMEOUT_MS);
  try {
    const res = await fetch(DOGECHAIN_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    if (j.error) throw new Error(j.error.message);
    return j.result;
  } finally {
    clearTimeout(t);
  }
}

function decodeString(hex) {
  if (!hex || hex === '0x') return '';
  const data = hex.slice(2);
  // Solidity dynamic string ABI: offset(32) + length(32) + utf8_bytes(padded 32)
  if (data.length < 128) {
    // Try fixed-length fallback: 32 bytes of utf-8 right-padded with zeros
    let out = '';
    for (let i = 0; i < 64; i += 2) {
      const code = parseInt(data.slice(i, i + 2), 16);
      if (code) out += String.fromCharCode(code);
    }
    return out;
  }
  const len = parseInt(data.slice(64, 128), 16);
  if (!len || len > 1024) return '';
  const strHex = data.slice(128, 128 + Math.min(len * 2, 4096));
  let out = '';
  for (let i = 0; i < strHex.length; i += 2) {
    const code = parseInt(strHex.slice(i, i + 2), 16);
    if (code) out += String.fromCharCode(code);
  }
  return out;
}

async function verifyContract(address) {
  if (CONTRACT_CACHE.has(address)) return CONTRACT_CACHE.get(address);
  const out = { ok: false, name: null, symbol: null, decimals: null, totalSupply: null, err: null };
  try {
    // balanceOf(self) — 0x70a08231 + address padded
    const probe = address.replace(/^0x/, '').toLowerCase().padStart(64, '0');
    const probeData = '0x70a08231000000000000000000000000' + probe;
    const probeResult = await rpcCall('eth_call', [{ to: address, data: probeData }, 'latest']);
    if (!probeResult || probeResult === '0x') throw new Error('not a contract');

    // name() 0x06fdde03
    try { out.name = decodeString(await rpcCall('eth_call', [{ to: address, data: '0x06fdde03' }, 'latest'])); } catch {}
    // symbol() 0x95d89b41
    try { out.symbol = decodeString(await rpcCall('eth_call', [{ to: address, data: '0x95d89b41' }, 'latest'])); } catch {}
    // decimals() 0x313ce567
    try {
      const r = await rpcCall('eth_call', [{ to: address, data: '0x313ce567' }, 'latest']);
      out.decimals = r && r !== '0x' ? parseInt(r, 16) : null;
    } catch {}
    // totalSupply() 0x18160ddd
    try {
      const r = await rpcCall('eth_call', [{ to: address, data: '0x18160ddd' }, 'latest']);
      out.totalSupply = r && r !== '0x' ? BigInt(r).toString() : null;
    } catch {}
    out.ok = !!(out.name || out.symbol);
  } catch (e) {
    out.err = e.message || String(e);
  }
  CONTRACT_CACHE.set(address, out);
  return out;
}

/* ────────────────────────── Social HEAD checks ────────────────────────── */

async function headCheck(url) {
  if (!url) return { ok: false, status: null, err: 'no url' };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': 'pulse-submission-verifier/1.0 (+dogechain-pulse)' },
    });
    return { ok: res.ok, status: res.status, err: null };
  } catch (e) {
    // Some sites reject HEAD; fall back to GET with range
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: ctrl.signal,
        headers: { 'User-Agent': 'pulse-submission-verifier/1.0', 'Range': 'bytes=0-0' },
      });
      return { ok: res.ok, status: res.status, err: null };
    } catch (e2) {
      return { ok: false, status: null, err: e2.message || String(e2) };
    }
  } finally {
    clearTimeout(t);
  }
}

/* ────────────────────────── Dedup against data/projects.json ─────────── */

function dedupCheck(fields, projects) {
  if (!Array.isArray(projects)) return { ok: true, dupOf: null };
  const nameLower = (fields.name || '').toLowerCase().trim();
  for (const p of projects) {
    if (!p || !p.name) continue;
    if (p.name.toLowerCase().trim() === nameLower) {
      return { ok: false, dupOf: p.id || p.name };
    }
    if (fields.contract && Array.isArray(p.contracts)) {
      for (const c of p.contracts) {
        if ((c.address || '').toLowerCase() === fields.contract) {
          return { ok: false, dupOf: p.id || p.name };
        }
      }
    }
  }
  return { ok: true, dupOf: null };
}

/* ────────────────────────── Public API ────────────────────────────────── */

async function verify(issueBody, projects, options = {}) {
  const fields = parseIssueBody(issueBody);
  const checks = [];

  // 1. Name present
  if (fields.name && fields.name.length >= 2) {
    checks.push({ name: 'name', ok: true, detail: fields.name });
  } else {
    checks.push({ name: 'name', ok: false, detail: 'missing or too short' });
  }

  // 2. Tagline length
  if (!fields.tagline) {
    checks.push({ name: 'tagline', ok: false, detail: 'missing' });
  } else if (fields.tagline.length > 80) {
    checks.push({ name: 'tagline', ok: false, detail: 'too long (' + fields.tagline.length + ' > 80)' });
  } else {
    checks.push({ name: 'tagline', ok: true, detail: fields.tagline });
  }

  // 3. Description length
  if (!fields.description) {
    checks.push({ name: 'description', ok: false, detail: 'missing' });
  } else if (fields.description.length > 400) {
    checks.push({ name: 'description', ok: false, detail: 'too long (' + fields.description.length + ' > 400)' });
  } else {
    checks.push({ name: 'description', ok: true, detail: 'ok' });
  }

  // 4. Category is one of the allowed
  const allowed = ['defi', 'nft', 'gaming', 'social', 'infra', 'tooling', 'bridge', 'meme'];
  if (!fields.category) {
    checks.push({ name: 'category', ok: false, detail: 'missing' });
  } else if (!allowed.includes(fields.category.toLowerCase())) {
    checks.push({ name: 'category', ok: false, detail: 'not in allowed: ' + allowed.join(', ') });
  } else {
    checks.push({ name: 'category', ok: true, detail: fields.category });
  }

  // 5. Contract (if provided) — verify on-chain
  if (fields.contract) {
    const r = await verifyContract(fields.contract);
    checks.push({
      name: 'contract',
      ok: r.ok,
      detail: r.ok
        ? `name="${r.name || '?'}" symbol="${r.symbol || '?'}" decimals=${r.decimals} supply=${r.totalSupply}`
        : ('verification failed: ' + (r.err || 'no name/symbol'))
    });
  } else {
    checks.push({ name: 'contract', ok: true, detail: 'none provided (skipped)' });
  }

  // 6. Socials — HEAD checks
  for (const k of ['website', 'twitter', 'telegram']) {
    const url = fields[k];
    if (!url) {
      checks.push({ name: k, ok: true, detail: 'none provided (skipped)' });
    } else {
      const r = await headCheck(url);
      checks.push({ name: k, ok: r.ok, detail: r.ok ? `HTTP ${r.status}` : `failed: ${r.err || r.status}` });
    }
  }

  // 7. Dedup
  const dup = dedupCheck(fields, projects);
  checks.push({
    name: 'dedup',
    ok: dup.ok,
    detail: dup.ok ? 'no duplicate in data/projects.json' : `duplicate of: ${dup.dupOf}`,
  });

  // Summary
  const passed = checks.filter(c => c.ok).length;
  const total = checks.length;
  const hardFails = checks.filter(c => !c.ok && ['name', 'category', 'dedup'].includes(c.name));

  return {
    fields,
    checks,
    summary: { passed, total, hardFails: hardFails.length, verdict: hardFails.length === 0 && passed >= total - 2 ? 'looks good' : 'needs review' },
  };
}

/* ────────────────────────── CLI ──────────────────────────────────────── */

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('verify-submission.js')) {
  const body = process.argv[2];
  if (!body) {
    console.error('Usage: node verify-submission.js "<issue-body>"');
    process.exit(1);
  }
  // Optional: pass path to projects.json as 2nd arg
  const { readFileSync } = await import('node:fs');
  let projects = [];
  try {
    const path = process.argv[3] || './data/projects.json';
    projects = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(projects)) projects = projects.projects || [];
  } catch (e) {
    console.error('Could not load projects.json:', e.message);
  }
  const result = await verify(body, projects);
  console.log(JSON.stringify(result, null, 2));
}

export { verify, parseIssueBody, verifyContract, headCheck, dedupCheck };
