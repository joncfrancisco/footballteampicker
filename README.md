# Depth Chart

A tier-list-style lineup builder where the tiers are positions. Pick a character list (a game
or IP) and a sport (football, soccer, basketball, hockey or baseball), then build a team by
dragging characters onto the playing surface or into a depth chart, and share it by link or
PNG. Lives at `depthchart.joncfrancis.co`. The plans are in
[#1](https://github.com/joncfrancisco/footballteampicker/issues/1) (football) and
[#44](https://github.com/joncfrancisco/footballteampicker/issues/44) (more sports).

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

The local API (`api/src/local.ts`) runs the same API code as production in a plain Node
server, with an in-memory store, Cloudflare's always-pass Turnstile test secret, and the
published `/m/*` objects served from memory. Data resets when it restarts.

## Checks

```sh
npm run typecheck
npm run lint       # ESLint + Prettier (npm run format to fix)
npm test           # Vitest across shared/, api/, web/
npm run e2e        # Playwright, Chromium (first run: npx -w web playwright install chromium)
npm run build
```

CI runs all of these on every PR, plus `terraform fmt -check` and `validate` on `infra/`.

## Sports

A sport is data, not code (#44). `shared/src/sports/<sport>.ts` holds a `SportDef`: its units
(depth rows, with variants such as football's front or baseball's DH), formations in 0–100
coordinates, optional sections (situational units like special teams or the power play, and
staff) and an optional batting order. The lineup rules, the API's validation, the builder,
the depth chart and the PNG export all read it. Each sport names a playing surface in
`web/src/field/surfaces.ts` (markings, panes and direction of play).

To add a sport: write its `SportDef`, register it in `shared/src/sports/index.ts`, and add or
reuse a surface. `shared/src/sports/sports.test.ts`, `web/src/field/surfaces.test.ts` and
`web/e2e/sports.spec.ts` then check its data, defaults and that every formation fits a phone.

Teams are `{ schemaVersion: 2, sport, units, sections }`. Football teams saved before #44 have
no `sport`; every reader (`PublishedTeam`, `TeamInput`, drafts) treats them as football and
upgrades them on read, so old links keep working.
