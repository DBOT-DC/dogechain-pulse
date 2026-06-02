# Dogechain Pulse — SPEC

**Status:** v1 shipped
**Tagline:** Discover the Dogechain Network.
**Domain idea:** `pulse.dogechain.dog`

---

## Why

The Dogechain Network is a real, working EVM chain — but it has a discoverability problem:

- TVL is ~$240K across 13 DEXes (9 of which are dormant)
- No major aggregator (LI.FI, 1inch, 0x, etc.) supports the chain
- The official blog has been silent since May 2024
- New projects launch and die in obscurity
- DOGE holders outside the chain have no single landing page to find what's happening

**Pulse is that landing page.**

## Goals (v1)

1. **Directory** — every notable project on Dogechain has a public home with a card, contracts, socials, and metrics
2. **Discovery** — anyone landing on the site can find the active projects in 10 seconds
3. **Community-driven growth** — anyone can submit a project; submissions are live immediately (pending badge) and verified through community upvotes
4. **Live signal** — the chain is alive: show current block height, total DeFi TVL, vote counts
5. **Truly free to run** — no backend, no auth, no accounts. Static files. CDN-friendly.

## Non-goals (v1)

- No accounts, no login
- No moderation queue (community-driven: votes are the only signal)
- No server-side analytics
- No payments / monetization (revenue is a v2 problem)
- No mobile app
- No internationalization

## Features (v1)

### 1. Project directory
- Card grid: 1 column on mobile, 3 on desktop
- Each card shows: logo (emoji), name, tagline, category, description (3-line clamp), tags, metrics, links, upvote count
- Click card → detail modal with full description, contracts (copy-to-clipboard), all socials, metrics, and submission provenance
- Spotlight banner on the highest-voted project (resets daily by community vote)

### 2. Categories
- DeFi, NFT, Gaming, Social, Infra, Tooling
- Each category has icon + color
- Filter chips at the top: All + one per category with live counts

### 3. Search
- Single search input
- Matches name, tagline, description, tags, contract addresses, and category labels
- Case-insensitive substring

### 4. Sort
- Most upvoted (default)
- Newest
- A → Z

### 5. Voting
- One click = +1 vote
- Click again to unvote
- Daily vote budget per browser: **30 votes per day** (anti-spam)
- Budget resets at local midnight
- Stored in localStorage; no server needed
- Trending surfaced automatically (sort by votes)

### 6. Submit a project
- Modal form: name, tagline, description, category, website, twitter, telegram, contract, submitter name
- Validation: required fields marked; contract must match `0x[a-fA-F0-9]{40}`
- On submit: stored in localStorage as a "pending" project, added to the grid immediately
- Pending badge shown until community upvotes push it into the spotlight
- **Future:** submissions will flow into a GitHub Issues / PR workflow for permanent inclusion in the canonical `projects.json`

### 7. Live ecosystem stats (top strip)
- Projects listed (count)
- Categories (count of distinct categories represented)
- Total DeFi TVL (sum from project metrics)
- Community votes (total across all projects)
- Latest Dogechain block (fetched from public RPC, refreshed every 30s)

### 8. Keyboard
- `/` — focus search
- `Esc` — close any open modal
- `Enter` / `Space` — open focused card
- `Click on ▲` — vote

### 9. Public JSON API
- `data/projects.json` is the canonical directory
- Anyone can fetch it; it's a public read-only API
- See README for schema

## Tech

- **Single `index.html`** — all HTML, CSS, JS inline
- **One `data/projects.json`** — the canonical directory (serverless data layer)
- **No backend, no auth, no accounts**
- **No build step** — open the file, it works (or serve it with any static host)
- **No CDN dependencies at runtime** — all fonts are system, no Tailwind, no React
- **Public Dogechain RPC** (`https://rpc.dogechain.dog`) used only for the block height display

## File layout

```
dogechain-pulse/
├── SPEC.md
├── README.md
├── index.html              # the whole app
└── data/
    └── projects.json       # canonical project directory
```

## Data schema (`projects.json`)

```json
{
  "version": 1,
  "generatedAt": "ISO-8601",
  "categories": [{"id", "label", "icon", "color"}],
  "projects": [{
    "id": "string (unique slug)",
    "name": "string",
    "tagline": "string",
    "description": "string",
    "category": "category-id",
    "logo": "emoji or single char",
    "color": "#hex",
    "website": "url | null",
    "twitter": "url | null",
    "telegram": "url | null",
    "discord": "url | null",
    "github": "url | null",
    "contracts": [{"chain", "type", "address", "symbol?"}],
    "metrics": {"tvlUsd?", "volume24hUsd?", "circulating?"} | null,
    "tags": ["string"],
    "addedAt": "ISO-8601",
    "addedBy": "string (source / submitter)",
    "featured": false,
    "pending": false
  }]
}
```

## Verification (v1)

- ✅ Loads `data/projects.json` and renders 9 seeded real projects
- ✅ Submit flow: stores submission in localStorage and renders immediately with pending badge
- ✅ Vote flow: increments, persists, decrements on second click, respects daily budget
- ✅ Search/filter/sort all work
- ✅ Live block height refreshes from Dogechain RPC every 30s
- ✅ Detail modal: full info, copy-to-clipboard contracts, all socials
- ✅ No external runtime dependencies (verified — only the public RPC is called)
- ✅ Lighthouse-friendly: 1 file, no fonts, no scripts beyond the inline one

## Future (v2+)

- Authenticated voting (sign with wallet) — kills localStorage vote budget
- Submissions flow to GitHub PRs instead of localStorage
- Auto-derive TVL/holders per project from on-chain calls
- Per-project activity feed (recent tweets, commits, votes)
- "Following" / "Watchlist"
- Embeddable trending widget for third-party sites
- Telegram bot to submit via `/pulse add <name>`
- i18n
