# 🚀 One-Click Deploy for Dogechain Pulse

The repository is **100% deploy-ready**. Three paths to live:

## ⚡ Path A: Browser (Recommended, 60 seconds)

Just click this link while signed in to Vercel with the DBOT team account:

**https://vercel.com/new/clone?repository-url=https://github.com/DBOT-DC/dogechain-pulse&project-name=dogechain-pulse&team-slug=team_f6mg2AXANLWsOvelJb49WN4l**

That single URL pre-fills:
- ✅ GitHub repo: `DBOT-DC/dogechain-pulse`
- ✅ Project name: `dogechain-pulse`
- ✅ Vercel team: `team_f6mg2AXANLWsOvelJb49WN4l` (the DBOT team)

Then on the import screen:
- **Framework Preset:** Other
- **Build Command:** *(empty)*
- **Output Directory:** `.`
- **Install Command:** *(empty)*

Hit **Deploy**. ~30 seconds later, you have a live URL like `dogechain-pulse.vercel.app`.

## 🖥 Path B: Vercel CLI from this machine

If you can paste a `VERCEL_TOKEN` (vercel.com/account/tokens):

```bash
# In a new terminal:
export VERCEL_TOKEN=***paste-here***
cd ~/Documents/DBOT-Vault-Final/02-Projects/dogechain-pulse
vercel link --yes --token $VERCEL_TOKEN
vercel deploy --prod --yes --token $VERCEL_TOKEN
```

I can drive this end-to-end if you drop the token in `~/.hermes/.env`.

## 🔗 Path C: GitHub Action + Deploy Hook

After Path A creates the project, get a deploy hook:
1. Vercel project → Settings → Git → Deploy Hooks → Create
2. Branch: `main`, name: `github-push`
3. Vercel gives you a URL
4. Add it to GitHub: Settings → Secrets → New repo secret → `VERCEL_DEPLOY_HOOK`

Done. Every push to `main` now auto-deploys via `.github/workflows/deploy.yml` (already in the repo, just needs the secret).

## 🌐 Custom Domain

After Path A creates the project:
1. Vercel project → Settings → Domains → Add `pulse.dogechain.dog`
2. Vercel shows you the CNAME target (typically `cname.vercel-dns.com`)
3. Add the CNAME record in your DNS provider for `pulse.dogechain.dog`
4. Vercel auto-provisions the SSL cert in ~30s

## ❓ Troubleshooting

- **"Framework Preset" defaults to Next.js** — change to "Other"
- **Build hangs** — leave all build/output/install commands empty
- **404 on `/data/projects.json`** — ensure the file is committed in the repo (`git ls-files data/projects.json`)
- **Custom domain not working** — DNS takes 5-60 min to propagate; check `dig pulse.dogechain.dog CNAME`
