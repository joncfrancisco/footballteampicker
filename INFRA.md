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
this stack owns; the zone is read as `data`. Web ACL `footballteampicker-site`: a per-IP rate
rule (2,000/5 min, all paths) plus three AWS managed groups; see § Write protection. The
`/api/` scope-down rate rule is off (`waf_api_rate_enabled`) because the Free plan rejected it.

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
  list atlases under `m/img/<listId>/atlas-<hash>.webp` (or `.jpg`). The API never invalidates: lists and browse catch up
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

## Character-list uploads

The editor builds a 128 px, 16-column atlas in WebP, falling back to JPEG at quality 0.85.
`POST /api/uploads` checks Turnstile, records `UPLOAD#tmp/<uuid>` / `META` with a hashed
upload token and ten-minute expiry, and returns a presigned S3 POST. Its policy fixes the
temporary key and MIME type and caps the object at 1,500,000 bytes. The bucket permits direct
POSTs only from the production origin and expires `tmp/` after one day.

List saves reuse the verified upload session, avoiding a second human challenge. The API atomically consumes the upload session,
checks MIME/magic bytes, file size, and header dimensions against the tile grid, and publishes
the validated bytes under the list's immutable content hash. It never copies a mutable object
after validation. Saved lists contain neither upload tokens nor raw edit tokens. Failed saves
keep the editor open; retrying builds a new upload session.

Existing owned atlases and verified seed atlases can be reused without uploading. Edits use
the current version as an optimistic concurrency check. Custom lists require 11–150 characters;
a verified seed remix may retain the seed's larger roster and its required disclaimer. Old
atlases remain after edits and list deletion because saved teams still reference them.

## Moderation

Reports, auto-hide, operator takedown/restore, and the policy are documented in
[MODERATION.md](MODERATION.md). Alerts use SNS `footballteampicker-alerts`
(`arn:aws:sns:us-east-1:020949219706:footballteampicker-alerts`); its email subscription
requires manual confirmation. The API has only `sns:Publish` on this topic. The bootstrap
boundary's matching permission was added out of band; Terraform cannot change the boundary.
Reporter hashes use the out-of-band SecureString `/footballteampicker/ip-salt`.

User-uploaded fan art of third-party characters is expected, and takedown requests are honored
within days. Quarantined portraits are private recovery copies under `private/takedown/`.
CloudFront's object permission is restricted to `m/*`; it cannot read that recovery prefix.

## Monitoring and budget

CloudWatch alarms send both ALARM and OK transitions to `footballteampicker-alerts`:

| Alarm                              | Signal                                                         |
| ---------------------------------- | -------------------------------------------------------------- |
| `footballteampicker-api-errors`    | Lambda `Errors` ≥5 in 5 minutes                                |
| `footballteampicker-api-throttles` | Lambda `Throttles` >0 in each of three 5-minute periods        |
| `footballteampicker-cdn-errors`    | Default CloudFront `5xxErrorRate` >5% in both 5-minute periods |
| `footballteampicker-waf-blocks`    | WAF `BlockedRequests` >10,000 in one hour; informational       |

All treat absent error data as not breaching. CloudFront uses `Region=Global`; the global
WAF ACL's metrics use `WebACL` and `Rule=ALL` without a Region dimension. No paid additional
CloudFront metrics or Route 53 health check are enabled.

Budget `footballteampicker-monthly` has a $5 monthly limit, filtered to `app=footballteampicker`,
and emails the owner at 50% actual and 100% forecast. Billing must first expose and activate
the `app` cost-allocation tag; newly created resource tags can take about 24 hours to appear.
At the 2026-10-31 setup check the tag was not yet available, so activation and email delivery
verification remain launch tasks. The $10 actual-spend action attaches the bootstrap-owned
deny-all policy only to `footballteampicker-api`. The execution role can attach/detach only
that policy on that role. Budget data can lag hours; this is a backstop rather than a timely cap.

Request logs contain a normalized route, HTTP status, and latency in milliseconds. They
contain no raw URL, request body, IP, authorization header, or Turnstile/edit token. Unexpected
errors log only their type. Lambda JSON logging retains data for 30 days in
`/aws/lambda/footballteampicker-api`.

After confirming the SNS subscription, test each alarm with `aws cloudwatch set-alarm-state`
to ALARM and then OK, confirm the emails, and inspect alarm action history. These four alarms
only notify; test-firing them does not pause the API. The kill-switch alarm is a separate test
and should follow its runbook.

## Write protection and cost exposure

CloudFront subscription `arn:aws:pricingplanmanager::020949219706:subscription:sub_3LSIhlHgrqIv9iqdglt0jjw9WuW`
was verified `ACTIVE`, tier `FREE`, on 2026-10-31. It includes only distribution
`E374QW7TXASG40` and its WAF ACL; the shared Route 53 zone remains outside the plan.
The original ACL with the nested API rate rule was rejected; the fallback all-path rule
and three managed groups was accepted. Usage notices at 50/80/100% are automatic per the
[plan documentation](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html).
Verify the account notification recipient separately before launch.

Hourly DynamoDB counters allow 50 list saves/deletes, 50 atlas uploads, 200 team saves,
and 20 reports per client IP. Keys contain only a salted SHA-256 hash, window, and operation;
TTL removes them after the following hour. Verification precedes counter writes. Upload
sessions are single use, expire after ten minutes, and authorize only one list save.

CloudWatch API invocations >50,000/hour or table consumed write units >100,000/hour
notify SNS, which invokes `footballteampicker-killswitch`. That function accepts only these
two ALARM messages from the account's own alert topic and sets API reserved concurrency
to zero. Its separate concurrency reservation is 1. API concurrency normally stays at 25;
Terraform ignores changes to that setting so a deploy cannot silently lift an active pause.
The API and switch log groups retain 30 days. Account concurrency was verified at 1,000.

SSM `/footballteampicker/turnstile-secret` is a SecureString containing the runtime reference
`secretsmanager:turnstile-secret`. Lambda resolves the existing Secrets Manager
secret without putting its value in Terraform, build output, or logs. The resolver supports
a plain secret string or a JSON field named secret/key/Turnstile secret key; explicit
`:SecretString:fieldName` references select other JSON fields. Production rejects test keys.

Cost examples use the AWS Price List API, us-east-1 rates checked 2026-10-31, before free
tiers: Arm Lambda $0.0000133334/GB-second and $0.20/million requests; DynamoDB writes
$0.625/million request units. At 256 MB and 250 ms, 50,000 invocations consume 3,125
GB-seconds: **$0.051667** including request charges. 100,000 write units cost **$0.0625**.
These are examples at the trigger thresholds, not a guaranteed spend ceiling: large roster
items consume multiple write units, alarms evaluate hourly and have delivery delay, and
logs, reads, S3, Secrets Manager, and SNS have separate charges. If all 25 slots run continuously,
one hour consumes 22,500 GB-seconds: **$0.300002 compute**, before request charges. Repeated
invalid requests can accumulate invocation charges even without writes. CloudFront and its
included WAF use the $0 Free plan with no overages; delivery can be slowed at excess usage.
Presigned uploads cap each object at 1.5 MB and require a verified session; reused presigned
forms can overwrite only that temporary key during their ten-minute lifetime.

## Capacity and load test (#18)

Sized for **100 concurrent users**. The model, from #18: 10-minute sessions, so 600
sessions/hour at peak and ~110k/month (4 peak hours a day, ~10 concurrent otherwise). A
session is ~10 requests and ~0.8 MB (HTML, bundle, one sprite atlas, browse index, ~2 writes),
less for returning visitors because the bundle and atlases are immutable. Writes average ~0.6/s
at peak; the worst case is all 100 users sharing in the same second.

That is **~1.1M requests and ~90 GB a month**, right at the Free plan allowance (1M requests,
100 GB). The plan absorbs a first spike of up to 3× and never bills overage; past the allowance
delivery may be slowed. One sprite atlas per list is what makes it fit: per-portrait images
would be ~19M requests a month.

| Piece       | Sizing                                                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reads       | All S3 via CloudFront `/m/*`; viewing, browsing and search never invoke Lambda                                                                                                                               |
| API Lambda  | Reserved concurrency 25; a write is ~250 ms, so 25 drains a 100-share burst in ~1 s                                                                                                                          |
| Client      | Retries a 429/503 that never reached the API (Lambda throttle, CloudFront) up to 3 times with jittered backoff; the unused Turnstile token is still valid. API answers and kill-switch pauses aren't retried |
| DynamoDB    | On-demand. A full team is ~1.1 KB (2 WRU), a 150-character list ~25 WRU                                                                                                                                      |
| Kill switch | Trips at 50,000 invocations/hour or 100,000 WRU/hour; peak is ~2,000 invocations/hour                                                                                                                        |

**Upgrade trigger:** if the plan's 50/80/100% usage emails show a month staying over the
allowance, move to **Pro, $15/month flat** (10M requests, 50 TB, still no overage). At 100
concurrent around the clock (~4.5M requests, ~350 GB a month) Pro is the right tier.

The test: `loadtest/flow.js` (100 virtual users × 10 minutes running home → list → build →
share 1 in 3 → open a team link → browse) and `loadtest/burst.js` (100 full teams with special
teams and staff in one second), run in a load-test window (DEPLOY.md). Both post the teams in
`loadtest/teams.json`, which `api/src/loadtest.test.ts` keeps valid against the shared rules.

**Results:** not yet run against production. A local rehearsal on 2026-10-31 passed both
scripts (burst 100/100 with no retries, flow 100% checks, no 5xx). Record the production
numbers here: 5xx count, API p95, CloudFront p95 TTFB, Lambda throttles, kill-switch state,
burst retries, and Free plan usage before and after.

## Deploys (`.github/workflows/deploy.yml`)

Push to `main` → CI (`ci.yml`) → in the `production` environment: build, `terraform apply`
(which also ships the API zip), sync `web/dist` (`assets/*` immutable, everything else
`no-cache`), invalidate `/index.html`, smoke-test the site and `/api/health` (body must be
`{"ok":true}` with the expected `loadtest` flag). `concurrency: deploy` serialises runs. A
manual run with `loadtest_mode` opens a load-test window (DEPLOY.md); any push closes it.
PRs get a read-only `terraform plan` in the job summary (`plan.yml`, `-lock=false` so a PR never blocks a deploy).
