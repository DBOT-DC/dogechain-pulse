# Deploying Dogechain Pulse

Two paths. Pick the one you want.

## Path A — Vercel Dashboard Import (3 clicks, no token in code)

Fastest. You do the import once in the Vercel UI; GitHub auto-deploy is then wired for you forever.

1. Go to **https://vercel.com/new**
2. Under **Import Git Repository**, search for `DBOT-DC/dogechain-pulse` → click **Import**
3. On the project setup screen, Vercel auto-detects it as a static site (no framework preset needed):
   - **Framework Preset:** Other
   - **Build Command:** *(leave empty)*
   - **Output Directory:** `.` *(default)*
   - **Install Command:** *(leave empty)*
4. Click **Deploy**

That's it. Vercel deploys it in ~30 seconds and gives you a `*.vercel.app` URL. Every push to `main` auto-deploys.

To add the custom domain `pulse.dogechain.dog`:
- Project Settings → Domains → Add `pulse.dogechain.dog`
- Vercel gives you a CNAME target; add it to your DNS

## Path B — Deploy Hook (one secret, fully automated, no token)

If you want deploys to run via a GitHub Action (so you can extend the pipeline later) and avoid putting a Vercel token in the repo:

1. Deploy the project first via Path A (Vercel creates a project for you)
2. In Vercel: **Project Settings → Git → Deploy Hooks → Create Hook**
   - Branch: `main`
   - Name: `github-push`
   - Vercel gives you a URL like `https://api.vercel.com/v1/integrations/deploy/prj_xxx/yyy`
3. In GitHub: **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `VERCEL_DEPLOY_HOOK`
   - Value: *(paste the URL from step 2)*
4. From now on, every push to `main` triggers `.github/workflows/deploy.yml` which POSTs to the hook → Vercel deploys.

## Path C — Vercel CLI (full programmatic control)

Use this if you want CI to build, run tests, and deploy atomically.

1. Vercel: **Account Settings → Tokens → Create Token** with full scope. Copy the token.
2. Vercel: **Project Settings → General → Project ID** and **Account Settings → General → Team ID**. Copy both.
3. In GitHub: **Settings → Secrets and variables → Actions**, add three secrets:
   - `VERCEL_TOKEN` — the token from step 1
   - `VERCEL_ORG_ID` — `team_f6mg2AXANLWsOvelJb49WN4l` (already known for DBOT org)
   - `VERCEL_PROJECT_ID` — the project ID from step 2 (created automatically after Path A)
4. Push to `main` → `.github/workflows/deploy-cli.yml` runs `vercel deploy --prod --yes`.

## Vercel Project Settings to Review

After import, double-check:

- **Build & Development Settings**
  - Framework Preset: `Other`
  - Build Command: *(empty)*
  - Output Directory: `.`
  - Install Command: *(empty)*
  - Node.js Version: `20.x`

- **Domains**
  - Add `pulse.dogechain.dog` if you own the domain
  - Vercel auto-issues a free `*.vercel.app` subdomain

- **Environment Variables**
  - None needed for v1 — the app is fully client-side

- **Git**
  - Production Branch: `main`
  - Auto-deploy on push: ✅ (on by default after import)

## Health Check

After your first deploy, verify the live site:

```bash
curl -sI https://<your-deployment>.vercel.app/ | head -3
# Expect: HTTP/2 200

curl -s https://<your-deployment>.vercel.app/data/projects.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'{len(d[\"projects\"])} projects, {len(d[\"categories\"])} categories')"
# Expect: 26 projects, 8 categories

curl -sI https://<your-deployment>.vercel.app/og-image.png | head -3
# Expect: HTTP/2 200, content-type: image/png
```

If all three return OK, the deploy is clean.

## Troubleshooting

- **404 on `/data/projects.json`** — make sure `vercel.json` is at the repo root (it is).
- **Wrong MIME type for CSS/JS** — Vercel auto-detects by extension; if something's off, check `vercel.json` headers.
- **GitHub Action fails with "no VERCEL_DEPLOY_HOOK"** — that's expected if you haven't set the secret yet. It's a no-op.
- **Build hangs** — there is no build step. If Vercel tries to build, you've accidentally selected a framework preset. Switch to "Other".
