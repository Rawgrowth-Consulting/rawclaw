# Rawclaw v3 — Working Backup

**This repo is a personal backup of Pedro's in-progress v3 work.**
**It is NOT the authoritative source of truth.**

The real canonical repo lives at
`github.com/Rawgrowth-Consulting/rawclaw` (branch `v3`), which Pedro
will push to as soon as Chris grants write access. This backup exists
only so the 14-day trial work is not trapped on a single laptop while
that access is pending.

## Why this repo

- **Cold-storage checkpoint** of the `v3` branch between commits.
- Protects against laptop loss, corrupted working tree, or an
  accidental `git clean -fdx` during dev.
- Lets Pedro review diffs from any browser without opening the laptop.

## Why NOT this repo

- Not reviewed by Chris/Scan/Ali.
- Not linked from any Rawgrowth infrastructure.
- Not wired to any CI, Vercel, or Hetzner.
- Not the place to open PRs or cut releases.
- History will be **force-pushed** whenever the real repo advances,
  so never rely on SHAs from here for anything lasting.

## Pointers to the real artifacts

- Authoritative brief package (PDFs):
  - `~/Downloads/Rawclaw v3 — Developer Brief (Pedro).pdf` (Chris's brief)
  - `~/Downloads/rawclaw-v3-cto-brief.pdf` (CTO brief for Chris)
  - `~/Downloads/rawclaw-v3-day1-reply.pdf` (engineering brief for Ali)
  - `~/Downloads/rawclaw-v3-execution-plan.pdf` (day-by-day plan)
- Canonical code repo: `github.com/Rawgrowth-Consulting/rawclaw`,
  branch `v3` (pending push-access grant).
- Local working tree: `~/rawclaw-research/rawclaw/`.

## What lives here

The full v3 branch, with 14 daily commits (D1 → D14 prep). Walks in
order:

```
D1  deploy mode + RLS migration + compose stack
D2  port portal onboarding + 6 schema migrations
D3  brand tokens + ESLint guards for §12 rules
D4  scrape pipeline + dashboard unlock gate
D5  voice pipeline (dual-path) + whisper.cpp bundled
D6  Telegram per-agent provisioning UX
D8  agent tree (ReactFlow) + add sub-agent modal
D9  per-agent panel + live activity feed + brand profile view
D10 file upload + RAG per agent
D11 agent_invoke MCP + add-department UI + Telegram stress script
D12 runtime brand-voice filter on telegram_reply
D13 Playwright smoke suite + v3 deploy + architecture docs
D14 build + lint pass prep
```

See `ARCHITECTURE-V3.md` and `DEPLOY-V3.md` for detail. See
`rawclaw-v3-execution-plan.pdf` for the full day-by-day plan.

## Contributing

Don't. Push directly to the canonical repo once access is granted.
