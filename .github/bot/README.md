# Pulse Submission Bot

When someone opens a `[Pulse] Submit: ...` issue, this bot parses the body and
opens a PR adding the project to `data/projects.json`.

## Architecture

- **Trigger:** GitHub Issue webhook (issues.opened with label `pulse-submission`)
- **Endpoint:** A Cloudflare Worker URL set as the webhook target
- **Action:** Validate → fork (optional) → create branch → commit to projects.json
  → open PR linking back to the issue
- **Auth:** Bot uses a GitHub PAT (fine-grained, repo scope only) stored as a CF Worker secret

## Deploy (one-time, ~5 min)

1. **Create a fine-grained PAT** at github.com/settings/tokens?type=beta
   - Repository access: `DBOT-DC/dogechain-pulse` only
   - Permissions: Contents (write), Issues (write), Pull requests (write)
2. **Install wrangler** if you don't have it: `npm i -g wrangler`
3. **Deploy the worker** (from repo root):
   ```bash
   cd .github/bot
   wrangler init --type javascript  # only first time
   cp worker.js src/index.js        # this file is the handler
   wrangler secret put GITHUB_TOKEN  # paste your PAT
   wrangler deploy
   ```
4. **Set the webhook** in the GitHub repo:
   - Settings → Webhooks → Add webhook
   - Payload URL: the URL `wrangler deploy` gave you
   - Content type: `application/json`
   - Events: "Issues", "Issue comments"
   - Active: ✅
5. **Test:** open an issue with title `[Pulse] Submit: Test` and the body filled.
   The bot should comment on the issue and open a PR.

## What the bot does

- Validates the issue body against the schema (name, tagline, category, etc.)
- If contract is provided, attempts a `eth_call` to check it's a real ERC-20
- Slugifies the project name
- Generates a JSON snippet
- Commits to a new branch `pulse/submission-<slug>`
- Opens a PR with: title `[Pulse] Add <name>`, body linking to the original issue

## What the bot does NOT do

- Auto-merge. Maintainer review is required.
- Validate URLs work (no social-media 404 checks in v1).
- Cross-reference existing projects for duplicates (maintainer catches in review).

## Local testing

```bash
curl -X POST http://localhost:8787 \
  -H "Content-Type: application/json" \
  -d @test-issue.json
```

See `test-issue.json` for a minimal payload.
