# Dogechain Pulse

> Discover the Dogechain Network.

A community-driven directory of projects, protocols, and people building on **Dogechain** (chain ID 2000). Open-source, no accounts, no server.

## Why this exists

Dogechain is a working EVM chain with ~$240K TVL, 13 DEXes (9 dormant), and a real discovery problem. New projects launch and die in silence. DOGE holders outside the chain have no place to find what's happening.

Pulse is that place. The community curates it.

## Run it

```bash
# Option 1: open directly (works for everything except fetch-from-disk restrictions)
open index.html

# Option 2: serve it (recommended — needed for fetch to work in some browsers)
python3 -m http.server 8000
# → http://localhost:8000
```

## Features

- 📚 **Directory** of every notable Dogechain project, with contracts, socials, and metrics
- 🔍 **Search** by name, tagline, contract, or category
- 🏷️ **Filter** by category (DeFi, NFT, Gaming, Social, Infra, Tooling)
- ⬆️ **Community upvotes** (30/day per browser — anti-spam without auth)
- 🌟 **Spotlight rotation** — highest-voted project gets the banner
- 📈 **Live stats strip** — projects, categories, total TVL, votes, latest block height
- ➕ **Submit a project** — community-driven intake; live immediately with a "pending" badge
- ⌨️ **Keyboard** — `/` to search, `Esc` to close, `Enter` to open a card
- 🔌 **Public API** — `data/projects.json` is the canonical directory; fetch it from anywhere

## Public API

```bash
# All projects
curl https://pulse.dogechain.dog/data/projects.json
```

Schema: see [SPEC.md](./SPEC.md#data-schema-projectsjson).

Anyone can read it. Anyone can fork it. Submit a PR to add a new project to the canonical list.

## File layout

```
dogechain-pulse/
├── SPEC.md             # full spec
├── README.md           # you are here
├── index.html          # the entire frontend
└── data/
    └── projects.json   # canonical project directory (the "DB")
```

## Stack

- Vanilla HTML / CSS / JS — **no build step**
- No backend, no auth, no accounts
- One external call at runtime: the public Dogechain RPC (`rpc.dogechain.dog`) for the block height
- ~46KB total

## Roadmap

v1 (this):
- Directory, search, filter, sort, voting, submit-a-project, detail modal, live stats

v2 (next):
- Authenticated voting via wallet signature (kills the 30/day budget)
- Submissions flow to a GitHub PR workflow instead of localStorage
- Auto-derive per-project TVL / holder count from on-chain calls
- Telegram bot for `/pulse add` submissions
- Embeddable trending widget for third-party sites

## License

MIT. Fork it, run it, ship your own version for your own community. The chain needs more signal, not more gatekeepers.
