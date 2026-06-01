# FeedBar — edge API (server) — project instructions

Repo: `gableend/feedbar-edge-api` (public) · feeds.bar · Market Moat Labs (B2C)

> FeedsBar is a **multi-repo product**. This repo is the server side. Siblings:
> - `feedsbar-client` — macOS client (Swift, thin)
> - `feedbar-workers` — Google Cloud workers / background jobs
> - `FeedsBarWebsite` — marketing site
> Shared product context belongs in whichever you treat as the FeedsBar "home" repo.

## What this is
Server-side / edge API for FeedBar — a B2C real-time market signal layer. Runs as Netlify
functions.

> **Important:** ingestion has moved to `feedbar-workers` (FeedsBarServer v2, Google Cloud Run).
> The Netlify ingestion functions here are **deprecated and disabled** — do not re-enable them.
> This repo's remaining role is non-ingestion API surface; confirm exactly what's still live.

## Stack
TypeScript (100%) · Netlify functions (`netlify/functions`) · `src/`, `types/`.

## Layout
```
netlify/functions   ← deployed edge/serverless endpoints
src                 ← API logic
types               ← shared TypeScript types
netlify.toml        ← build & function config
```

## Conventions for Claude
- This repo is **backend only** — UI lives in `feedsbar-client` / `FeedsBarWebsite`. Flag any
  change that assumes a frontend.
- Keep shared request/response shapes in `types/` so the Swift client and workers stay in sync.
- No README yet — if you learn the architecture, capture it here rather than letting it stay tribal.

## Project memory
Append-only, dated. Stays with this repo.

### 2026-06-01
- CLAUDE.md seeded via Claude HQ setup. README was empty; details inferred from repo structure —
  verify and expand.
