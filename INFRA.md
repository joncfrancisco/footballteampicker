# Infrastructure

Everything lives in AWS account `020949219706`, `us-east-1`. Full write-up comes with #15;
this records the pieces that exist so far.

## CI access (`bootstrap/`)

Applied by hand with admin credentials (`bootstrap/bootstrap.sh`, idempotent). CI can't change
any of it.

| Thing                                | Purpose                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `footballteampicker-gha-deploy` role | Assumed via GitHub OIDC from the `production` environment only (which only `main` can use). Applies `infra/` and deploys.       |
| `footballteampicker-gha-plan` role   | Assumed from `pull_request` jobs. Read-only, plus the state lockfile.                                                           |
| `footballteampicker-boundary` policy | Permissions boundary every role `infra/` creates must carry, so the deploy role can't mint a role with more than the API needs. |
| GitHub environment `production`      | Deployment branches: `main`. Variable `AWS_ROLE_ARN`. Repo variable `AWS_PLAN_ROLE_ARN`.                                        |

The deploy role is scoped to this stack: names `footballteampicker-*` where the ARN carries a
name; tag `app=footballteampicker` for CloudFront distributions and ACM certs (ID-only ARNs);
Route 53 changes limited to `depthchart.joncfrancis.co` and `_*.depthchart.joncfrancis.co`.

Shared, not owned here: the state bucket `tfstate-020949219706` (this stack's key is
`footballteampicker/infra.tfstate`, S3 native lockfile) and the account's GitHub OIDC provider,
both from doorbell's bootstrap.

**IAM Access Analyzer**: two expected external-access findings, one per CI role (each trusts the
GitHub OIDC provider), the same as doorbell's roles.

## Tags

Every Terraform resource gets `app=footballteampicker` and `managed-by=terraform` (provider
`default_tags`). `app` is the cost-allocation tag; re-run `bootstrap/bootstrap.sh` to activate it
once the first tagged resources have existed for ~24 hours.

## Static site (`infra/`, #4)

`depthchart.joncfrancis.co` → Route 53 A/AAAA alias → CloudFront `E374QW7TXASG40` → S3
`footballteampicker-site-020949219706` via OAC. ACM cert (us-east-1) DNS-validated by a CNAME
this stack owns; the zone is read as `data`. Web ACL `footballteampicker-site` with two
per-IP rate rules (2,000/5 min all paths, 300/5 min `/api/`), action from `waf_rate_action`.

- Managed policies only (`CachingOptimized`, `SecurityHeadersPolicy`), so the CSP is a
  build-time `<meta>` (`web/vite.config.ts`).
- SPA routing is the `footballteampicker-spa-rewrite` CloudFront Function (extensionless path →
  `/index.html`), not custom error responses, so real 404s stay 404s. CloudFront has
  `s3:ListBucket` on the site bucket for the same reason (missing object → 404, not 403).
- Behaviour budget is 5 (Free plan): default, `/api/*`, `/m/*`, `/t/*` + `/l/*`.

## API (`infra/api.tf`)

Lambda `footballteampicker-api` (Node 22, arm64, 256 MB, 10 s, reserved concurrency 25 of the
account's 1,000) behind CloudFront `/api/*` (managed `CachingDisabled` +
`AllViewerExceptHostHeader`). Its function URL uses `AWS_IAM` auth and CloudFront signs with a
Lambda OAC, so calling the URL directly returns 403. Role `footballteampicker-api` carries the
`footballteampicker-boundary`. Logs: `/aws/lambda/footballteampicker-api`, 30 days.

Writes only: `POST /api/lists`, `PUT`/`DELETE /api/lists/:id` (edit token), `POST /api/teams`,
`POST /api/reports`. Each write checks a Cloudflare Turnstile token first; the secret is the
SecureString `/footballteampicker/turnstile-secret`, set out of band and read at runtime. Until
it exists, writes answer 503 `writes_unavailable` (fail closed).

## Data (`infra/data.tf`)

- DynamoDB `footballteampicker`: single table (`PK`/`SK`), GSI1 (`PUBLIC` / `createdAt`) for
  the browse index, on-demand, PITR, TTL on `expiresAt`, deletion protection.
- S3 `footballteampicker-media-020949219706` behind CloudFront `/m/*` (OAC, `CachingOptimized`):
  every read is one of these objects, published by the API after each write:
  `m/t/<id>.json` (immutable), `m/l/<id>.json` and `m/browse/index.json` (`max-age=60`),
  and from #10 list atlases under `m/a/`. The API never invalidates: lists and browse catch up
  within a minute and teams never change. Takedowns invalidate from the admin script (#13).
- Saved seed teams use `m/seeds/<seedId>/atlas-<hash>.webp`. Deploy uploads new seed atlases
  without deleting old ones, so a saved team keeps its original portraits across seed updates.

## Sharing configuration

The production GitHub environment variable `TURNSTILE_SITE_KEY` is the public Cloudflare
site key, embedded in the web build as `VITE_TURNSTILE_SITE_KEY`. The matching secret remains
in the SecureString above. Without a site key the UI pauses sharing; without the secret the
API rejects writes. Local development uses Cloudflare's public test keys only.

The browser sends `X-Amz-Content-Sha256` for the exact UTF-8 JSON body on every write. Lambda
function URL OAC needs this body hash before the request can reach the handler. Retries on
429/503 render a fresh Turnstile widget, up to three retries with jittered backoff; consumed
tokens are never replayed. An unchanged team reuses the last saved ID in this browser.

Shared teams read `/m/t/<id>.json` and render their saved character snapshot, including names,
two-way flags and atlas tiles. Formation/view changes stay local. Remix separately loads the
current list, clears removed characters, and keeps offense when a two-way flag was disabled.

## Deploys (`.github/workflows/deploy.yml`)

Push to `main` → CI (`ci.yml`) → in the `production` environment: build, `terraform apply`
(which also ships the API zip), sync `web/dist` (`assets/*` immutable, everything else
`no-cache`), invalidate `/index.html`, smoke-test the site and `/api/health` (body must be
`{"ok":true}`). `concurrency: deploy` serialises runs. PRs get a read-only `terraform plan` in
the job summary (`plan.yml`, `-lock=false` so a PR never blocks a deploy).
