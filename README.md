# Depth Chart

A tier-list-style lineup builder where the tiers are football positions. Pick a character
list (a game or IP), then build a team by dragging characters onto a field or into a depth
chart, and share it by link or PNG. Lives at `depthchart.joncfrancis.co`. The plan is in
[#1](https://github.com/joncfrancisco/footballteampicker/issues/1).

## Layout

```
web/      Vite + React + TypeScript SPA
api/      Lambda handler (TypeScript, bundled with esbuild)
shared/   types + zod schemas used by both
infra/    Terraform
seed/     built-in character lists (see seed/README.md)
bin/      ops scripts
```

## Run locally

Needs Node 22 (`.nvmrc`).

```sh
npm install
npm run dev        # SPA on http://localhost:5173, API on :8787 (proxied at /api)
```

The local API is the Lambda handler wrapped in a small Node server (`api/src/local.ts`),
so it runs the same code as production.

## Checks

```sh
npm run typecheck
npm run lint       # ESLint + Prettier (npm run format to fix)
npm test           # Vitest across shared/, api/, web/
npm run e2e        # Playwright, Chromium (first run: npx -w web playwright install chromium)
npm run build
```

CI runs all of these on every PR, plus `terraform fmt -check` and `validate` on `infra/`.
