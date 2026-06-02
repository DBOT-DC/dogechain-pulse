// ═══════════════════════════════════════════════════════════════════
// Pulse Submission Bot — Cloudflare Worker
// Listens for GitHub Issues labeled 'pulse-submission', validates the
// body, and opens a PR adding the project to data/projects.json.
// ═══════════════════════════════════════════════════════════════════

const GITHUB_API = 'https://api.github.com';
const REPO_OWNER = 'DBOT-DC';
const REPO_NAME  = 'dogechain-pulse';
const DATA_PATH  = 'data/projects.json';
const DOGECHAIN_RPC = 'https://rpc.dogechain.dog';
const CATEGORIES = ['defi','nft','gaming','social','infra','tooling','bridge','meme'];

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Pulse bot is listening. POST GitHub webhook payloads here.', { status: 200 });
    }

    // Verify webhook signature if secret is set
    const sigHeader = request.headers.get('X-Hub-Signature-256');
    if (env.WEBHOOK_SECRET && sigHeader) {
      const body = await request.clone().text();
      const valid = await verifySignature(body, sigHeader, env.WEBHOOK_SECRET);
      if (!valid) return new Response('Invalid signature', { status: 401 });
    }

    const payload = await request.json();
    if (payload.action !== 'opened' || !payload.issue) {
      return new Response('Ignored (not an issue.opened event)', { status: 200 });
    }
    const issue = payload.issue;
    if (!issue.labels?.some(l => l.name === 'pulse-submission')) {
      return new Response('Ignored (not a pulse-submission)', { status: 200 });
    }

    try {
      const result = await handleSubmission(issue, env);
      return new Response(JSON.stringify(result, null, 2), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    } catch (e) {
      console.error(e);
      // Comment on the issue with the error
      await ghFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/issues/${issue.number}/comments`, env, {
        method: 'POST', body: JSON.stringify({
          body: `❌ **Pulse bot failed to process this submission:**\n\n\`\`\`\n${e.message || e}\n\`\`\`\n\nPlease fix the issue body or report this to a maintainer.`
        })
      });
      return new Response(`Error: ${e.message}`, { status: 500 });
    }
  }
};

async function handleSubmission(issue, env) {
  // 1. Parse the issue body
  const fields = parseIssueBody(issue.body || '');
  const errors = validate(fields);
  if (errors.length) {
    await commentOnIssue(issue, env,
      `❌ **Submission rejected — please fix:**\n\n${errors.map(e => `- ${e}`).join('\n')}\n\n` +
      `Re-edit this issue and the bot will re-run on the next save.`
    );
    return { ok: false, errors };
  }

  // 2. Verify contract (if provided) by calling symbol() on Dogechain RPC
  let contractVerified = false;
  let contractNote = '';
  if (fields.contract) {
    try {
      const sym = await callErc20Symbol(fields.contract);
      if (sym) {
        contractVerified = true;
        contractNote = `name/symbol returned by eth_call: ${sym}`;
      } else {
        contractNote = '⚠️ Contract provided but symbol() did not return a value — not a standard ERC-20';
      }
    } catch (e) {
      contractNote = `⚠️ Contract verification failed: ${e.message}`;
    }
  }

  // 3. Build the JSON snippet
  const slug = slugify(fields.name);
  const project = {
    id: slug,
    name: fields.name,
    tagline: fields.tagline,
    description: fields.description || '',
    category: fields.category,
    logo: '🪙',
    color: '#8a8a8a',
    website: fields.website || null,
    twitter: normalizeTwitter(fields.twitter) || null,
    telegram: fields.telegram || null,
    github: fields.github || null,
    contracts: fields.contract ? [{
      chain: 'Dogechain', type: 'Token',
      address: fields.contract, symbol: '',
      verified: contractVerified,
      verifiedNote: contractNote
    }] : [],
    metrics: null,
    tags: ['community-submitted'],
    addedAt: new Date().toISOString(),
    addedBy: fields.submitter || 'pulse-submission',
    featured: false,
    pending: true
  };

  // 4. Get current projects.json
  const ref = await ghFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/git/ref/heads/main`, env);
  const mainSha = ref.object.sha;
  const fileRes = await ghFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${DATA_PATH}?ref=main`, env);
  const currentContent = JSON.parse(atob(fileRes.content));
  const existingIds = new Set(currentContent.projects.map(p => p.id));
  if (existingIds.has(slug)) {
    await commentOnIssue(issue, env, `❌ A project with id \`${slug}\` already exists. Please close this issue and open a new one with a different name.`);
    return { ok: false, error: 'duplicate id' };
  }

  // 5. Create branch
  const branch = `pulse/submission-${slug}-${Date.now().toString(36)}`;
  await ghFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/git/refs`, env, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: mainSha })
  });

  // 6. Update projects.json
  currentContent.projects.push(project);
  currentContent.generatedAt = new Date().toISOString();
  const newContent = btoa(JSON.stringify(currentContent, null, 2) + '\n');
  await ghFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${DATA_PATH}`, env, {
    method: 'PUT',
    body: JSON.stringify({
      message: `Add: ${fields.name} (from issue #${issue.number})`,
      content: newContent,
      branch,
      sha: fileRes.sha
    })
  });

  // 7. Open PR
  const pr = await ghFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/pulls`, env, {
    method: 'POST',
    body: JSON.stringify({
      title: `[Pulse] Add ${fields.name}`,
      head: branch,
      base: 'main',
      body: `Closes #${issue.number}\n\n` +
            `**Submission from community:**\n\n` +
            `| Field | Value |\n|---|---|\n` +
            `| Name | ${fields.name} |\n` +
            `| Tagline | ${fields.tagline} |\n` +
            `| Category | ${fields.category} |\n` +
            `| Contract | ${fields.contract || '—'} |\n` +
            `| Contract verified | ${contractVerified ? '✓' : '✗'} |\n` +
            `| Submitter | ${fields.submitter || 'anonymous'} |\n\n` +
            (contractNote ? `**Verification:** ${contractNote}\n\n` : '') +
            `Auto-generated by the Pulse submission bot. Review the data, then merge.`
    })
  });

  // 8. Comment on the issue
  await commentOnIssue(issue, env,
    `✅ **Submission processed!**\n\n` +
    `PR opened: [#${pr.number} ${pr.title}](${pr.html_url})\n\n` +
    (contractVerified ? '' : `⚠️ **Note:** contract verification ${contractNote ? 'failed' : 'was not provided'}. The submission is marked \`pending: true\` and will need manual review.\n\n`) +
    `A maintainer will review and merge. Thanks for contributing to Dogechain Pulse! 🐾`
  );

  return { ok: true, pr: pr.html_url, slug, contractVerified };
}

function parseIssueBody(body) {
  const out = {};
  const lines = body.split('\n');
  for (const line of lines) {
    const m = line.match(/^\*\*([^*]+):\*\*\s*(.+?)$/);
    if (m) out[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return out;
}

function validate(f) {
  const errs = [];
  if (!f.name || f.name.length < 2) errs.push('Name is required (min 2 chars)');
  if (!f.tagline || f.tagline.length < 5) errs.push('Tagline is required (min 5 chars)');
  if (!f.category) errs.push('Category is required');
  else if (!CATEGORIES.includes(f.category)) errs.push(`Category must be one of: ${CATEGORIES.join(', ')}`);
  if (f.contract && !/^0x[a-fA-F0-9]{40}$/.test(f.contract)) errs.push('Contract must be a 0x + 40 hex address');
  return errs;
}

async function callErc20Symbol(addr) {
  const res = await fetch(DOGECHAIN_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_call', params: [{ to: addr, data: '0x95d89b41' }, 'latest'], id: 1 })
  });
  const j = await res.json();
  if (!j.result || j.result === '0x' || j.result.length < 130) return null;
  const raw = hexToBytes(j.result);
  const length = parseInt(bytesToHex(raw.slice(32, 64)), 16);
  if (length > 256) return null;
  return new TextDecoder().decode(raw.slice(64, 64 + length)).replace(/\0+$/, '').trim();
}

function hexToBytes(h) {
  const out = new Uint8Array((h.length - 2) / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(2 + i * 2, 2), 16);
  return out;
}
function bytesToHex(b) { return '0x' + Array.from(b).map(x => x.toString(16).padStart(2,'0')).join(''); }

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}
function normalizeTwitter(v) {
  if (!v) return null;
  if (v.startsWith('http')) return v;
  if (v.startsWith('@')) return `https://x.com/${v.slice(1)}`;
  return `https://x.com/${v}`;
}

async function commentOnIssue(issue, env, body) {
  return ghFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/issues/${issue.number}/comments`, env, {
    method: 'POST', body: JSON.stringify({ body })
  });
}

async function ghFetch(path, env, opts = {}) {
  const url = path.startsWith('http') ? path : `${GITHUB_API}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'pulse-submission-bot',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {})
    }
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GitHub ${res.status}: ${txt.slice(0, 500)}`);
  }
  return res.json();
}

async function verifySignature(payload, header, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const expected = 'sha256=' + Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return expected === header;
}
