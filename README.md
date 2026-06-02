# 🐾 Dogechain Pulse

> **Discover the Dogechain Network.**

A community-driven, open-source directory of projects, protocols, and people building on the [Dogechain Network](https://dogechain.dog) (chain ID 2000). No accounts. No server. No gatekeepers.

🌐 **Live (canonical):** **[www.dbot.dog/dogechain-pulse/](https://www.dbot.dog/dogechain-pulse/)** ← deployed and live
🌐 **Standalone:** [dogechain-pulse.vercel.app](https://dogechain-pulse.vercel.app) ← same code, alternate origin
📦 **Data API:** [`data/projects.json`](./data/projects.json) — free, public, versioned
💻 **Source:** [github.com/DBOT-DC/dogechain-pulse](https://github.com/DBOT-DC/dogechain-pulse)

### Deployment modes (one codebase, two URLs)

The same code runs in two modes:

| Mode | URL | When to use |
|---|---|---|
| **Canonical (path prefix)** | `https://www.dbot.dog/dogechain-pulse/` | This is the official URL. Set up via a Vercel rewrite on the `www.dbot.dog` project (see `vercel-rewrite.json` for the exact config). |
| **Standalone (apex)** | `https://dogechain-pulse.vercel.app/` | The Vercel-hosted apex. Always-on, no DNS required. Useful for forks, demos, and the auto-deploy preview. |

The site auto-detects which mode it's in via `base-href.js` and sets the `<base>` tag accordingly. All relative URLs (CSS, JS, icon, `fetch('./data/projects.json')`) resolve correctly in both modes — no rebuild needed.

Future DBOT projects follow the same pattern: `www.dbot.dog/<project-slug>/` for canonical, `<project-slug>.vercel.app` for standalone.

### 🚀 Deploy your own (one click)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/DBOT-DC/dogechain-pulse&project-name=dogechain-pulse)

One click. ~30 seconds. After that, every push to `main` auto-deploys.

---

## Why this exists

Dogechain is a working EVM chain with real DeFi, real tokens, and a real community — but no good discovery surface. The official blog has been silent since May 2024. New projects launch and die in obscurity. DOGE holders outside the chain have no single landing page to find what's happening.

**Pulse is that landing page.** The community curates it.

## Features

- 📚 **Directory** — 26+ real Dogechain projects across 8 categories (DeFi, NFT, Gaming, Social, Infra, Tooling, Bridge, Meme)
- 🔍 **Search** by name, tagline, contract, or category
- 🏷 **Filter** by category, with live counts
- ⬆ **Community upvotes** (30/day per browser — anti-spam without auth)
- 🌟 **Spotlight** — the highest-voted project gets the daily banner
- 📈 **Live stats** — projects, categories, total TVL, votes, latest block
- ➕ **Submit a project** — opens a prefilled GitHub Issue for permanent inclusion
- ⌨ **Keyboard** — `/` to search, `Esc` to close, `Enter` to open a card
- 🔌 **Public API** — `data/projects.json` is a free, versioned, read-only directory
- 📱 **Responsive** — desktop, tablet, mobile (380px+), dark theme
- ♿ **Accessible** — semantic HTML, ARIA, focus management, reduced-motion support
- 🖨 **Print-friendly** — clean print stylesheet for offline use

## Stack

- **Vanilla HTML / CSS / JS** — no build step, no dependencies, no framework
- **One external call at runtime:** the public Dogechain RPC for live block height
- ~30 KB total (gzipped)
- **No backend, no auth, no accounts, no tracking**
- **Deploy anywhere static:** Vercel, Netlify, Cloudflare Pages, GitHub Pages, S3, or just open the file

## Run it locally

```bash
# Option 1: open directly (works for everything except fetch-from-disk restrictions in some browsers)
open index.html

# Option 2: serve it (recommended — needed for fetch to work in some browsers)
python3 -m http.server 8000
# → http://localhost:8000
```

## Project layout

```
dogechain-pulse/
├── SPEC.md                  # full spec
├── README.md                # you are here
├── LICENSE                  # MIT
├── index.html               # the entire frontend
├── app.js                   # ~650 lines — voting, search, submit, routing
├── styles.css               # ~530 lines — design system + responsive
├── data/
│   └── projects.json        # canonical directory (the "DB") — public, versioned
├── vercel.json              # deploy config + security headers
├── sitemap.xml              # SEO
├── robots.txt               # SEO
├── manifest.json            # PWA manifest
├── icon.svg                 # PWA icon
├── .well-known/
│   └── security.txt         # security disclosure
├── .github/
│   ├── workflows/validate.yml  # CI: validate projects.json on PR
│   └── ISSUE_TEMPLATE/pulse-submission.md  # submission template
└── .gitignore
```

## Public API

```bash
# All projects
curl https://pulse.dogechain.dog/data/projects.json
```

**Schema:** see [SPEC.md](./SPEC.md#data-schema-projectsjson).

Anyone can read it. Anyone can fork it. Submit a PR to add a new project to the canonical list.

## Submitting a project

1. Click **+ Submit a project** in the header
2. Fill out the form
3. A prefilled GitHub Issue is opened with your data
4. A maintainer reviews and merges — your project goes live

Submissions also save locally in your browser so you can see your submission immediately with a "pending" badge while the maintainer reviews.

### For maintainers: getting notified of new submissions

**Option 1 (easiest): GitHub email notifications.** Two clicks:

1. Go to https://github.com/DBOT-DC/dogechain-pulse/subscription
2. Check **"Subscribed to issues you create or are assigned to"** OR click **"Watch → Custom → Issues"** to subscribe to all issues
3. (Optional) On https://github.com/settings/notifications, check the box for **"Email"** under Issues

You'll now get an email every time someone files a `pulse-submission` issue.

**Option 2 (richer): automatic verification + Telegram DM.** When a submission lands, a watchdog script on the DBOT server:

- Pulls the issue body
- `eth_call`s the contract on the Dogechain public RPC (verifies it's a real ERC-20, gets name/symbol/decimals/supply)
- HEAD-checks the website, twitter, telegram, github links
- Dedups against `data/projects.json` (catches duplicate names and contract addresses)
- DMs `@PennybagsCX` on Telegram with a parsed review packet (✅/❌ per check + the issue link)

This means the maintainer sees a clean review in Telegram, not a wall of GitHub email. Setup: the `pulse-submissions-watch` skill in `~/.hermes/skills/` runs as a Hermes cron job every 15 minutes. No server to maintain — it's a 200-line Node script + a bash wrapper, both open source and committed to the repo:

- `scripts/verify-submission.js` — the verifier (eth_call, social checks, dedup). MIT licensed, runnable standalone.
- `~/.hermes/skills/pulse-submissions-watch/watch-submissions.mjs` — the poller + DM sender.
- `~/.hermes/scripts/pulse-submissions-watchdog.sh` — the bash wrapper.


## Contributing

The whole point is that the community owns this. To add a project:

```bash
# Fork the repo
gh repo fork DBOT-DC/dogechain-pulse

# Add your project to data/projects.json
# (follow the schema in SPEC.md)

# Open a PR
gh pr create --title "Add: <Project Name>" --body "..."
```

CI will automatically validate your JSON against the schema.

## Deployment

This site is configured for Vercel out of the box (`vercel.json` with security headers and caching rules). It also works on:

- **Netlify** — drop the folder, no config needed
- **Cloudflare Pages** — connect the repo, no build command
- **GitHub Pages** — push to `gh-pages` branch
- **Any static host** — it's just files

## Roadmap

**v1 (shipped):**
- Directory, search, filter, sort, voting, submit-a-project, detail modal, live stats, About/Methodology/Stats pages, shareable `/project/<id>` routes, mobile responsive, accessibility, PWA manifest, security headers, SEO (sitemap, robots, OG), CI validation, MIT licensed

**v1.5 (next, when traffic justifies it):**
- Optional wallet-signed voting (kills the 30/day localStorage budget)
- Plausible / CF Web Analytics for opt-in traffic insight
- Custom domain `pulse.dogechain.dog`
- Real OG image generation for shareable links

**v2 (future):**
- Per-project activity feeds (recent tweets, commits, votes)
- "Watchlist" / following
- Telegram bot for `/pulse add` submissions
- Embeddable trending widget for third-party sites
- Auto-derive TVL/holders per project from on-chain calls

## License

MIT. Fork it, run it, ship your own version for your own community. The chain needs more signal, not more gatekeepers.

---

Built and maintained by [**DBOT**](https://dbot.dog) — the Dogechain community agent. 🐶🤖
