# Deployment

How to stand up, deploy, operate and recover the stack. What each resource is: [INFRA.md](INFRA.md).

## One-time bootstrap

With admin credentials for account `020949219706`, in this order:

1. `bootstrap/bootstrap.sh`: CI roles, the permissions boundary, the budget execution role and
   deny policy, the `production` GitHub environment (deployable only from `main`) and the
   `AWS_ROLE_ARN` / `AWS_PLAN_ROLE_ARN` variables. Idempotent; re-run after editing its JSON.
2. Secrets, set out of band and never in Terraform state (see § Secrets and keys):
   `/footballteampicker/turnstile-secret` and `/footballteampicker/ip-salt`.
3. Merge to `main` (or run the Deploy workflow) to apply `infra/` and publish the site.
4. Subscribe the distribution to the CloudFront Free plan (§ CloudFront Free plan bootstrap).
5. Confirm the SNS email subscription for `footballteampicker-alerts`, and activate the `app`
   cost-allocation tag in Billing once it appears (re-running bootstrap does it).

## Normal deploy

Open a PR and wait for CI and the read-only Terraform plan. Merge to `main`; the production
workflow rebuilds the app, applies Terraform, publishes immutable seed atlases, uploads the
site, invalidates the SPA shell, and smoke-tests the site and API. Terraform applies run
only in GitHub Actions using `footballteampicker-gha-deploy`. See [INFRA.md](INFRA.md) for
ownership and [MODERATION.md](MODERATION.md) for takedown/restore.

## CloudFront Free plan bootstrap

The existing nested `/api/` WAF rate statement was rejected by the Free subscription API on
2026-10-31. The Free-compatible configuration uses the 2,000-request/five-minute all-paths
IP rule plus AWS IP reputation, known-bad-input, and common-rule groups. The common group's
body-size rule counts oversized JSON rather than rejecting legitimate list saves. The API
scope-down rule can be enabled for a compatible tier with `waf_api_rate_enabled`; it defaults
off as allowed by #17.

The subscription was created and verified ACTIVE on 2026-10-31; its ARN is in INFRA.md.
For disaster recovery, create a Free subscription with admin credentials:

```sh
aws pricing-plan-manager create-subscription --region us-east-1 \
  --plan-family CloudFront --plan-tier FREE --approval-mode IMMEDIATE \
  --resource-arns \
    arn:aws:cloudfront::020949219706:distribution/E374QW7TXASG40 \
    arn:aws:wafv2:us-east-1:020949219706:global/webacl/footballteampicker-site/b750b8b8-0be8-43f5-b252-006dd9042074
```

Verify the returned subscription reaches `ACTIVE` with `planTier=FREE`. The shared Route 53
zone must not be associated. Record the subscription ARN in [INFRA.md](INFRA.md).

The installed Terraform provider exposes a subscription resource, but the pricing-plan
service's financial write actions have no resource-level permissions or service-specific
condition keys. Keep those actions with an administrator rather than granting CI account-wide
authority to change other services' pricing plans. Plan changes are an explicit bootstrap
operation. See the [PricingPlanManager API guide](https://docs.aws.amazon.com/PricingPlanManager/latest/UserGuide/getting-started-pricingplanmanager-api.html)
and [IAM reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_pricing-plan-manager.html).

## Rollback

Revert the merge commit on `main` (`git revert -m 1 <sha>`, through a PR) and merge: the
deploy rebuilds the previous app, re-applies the previous Terraform and redeploys the Lambda.
Published teams and lists are untouched by app rollbacks. If a release wrote bad data, restore
DynamoDB to a point in time (INFRA.md § Backups and recovery) rather than reverting further.
If writes themselves are the problem, `bin/killswitch on` first: reading keeps working.

## Secrets and keys

| What               | Where                                                                                                                            | Effect of changing it                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Turnstile secret   | Secrets Manager `turnstile-secret`, referenced by SSM `/footballteampicker/turnstile-secret` (`secretsmanager:turnstile-secret`) | Must match the site key                            |
| Turnstile site key | GitHub `production` environment variable `TURNSTILE_SITE_KEY`                                                                    | Baked into the build; needs a deploy               |
| IP salt            | SSM SecureString `/footballteampicker/ip-salt`                                                                                   | Resets rate-limit windows and report deduplication |
| Load-test token    | SSM SecureString `/footballteampicker/loadtest-token`                                                                            | Exists only during a load-test window              |

**Turnstile.** Create a widget in Cloudflare (managed mode, hostname
`depthchart.joncfrancis.co`). Put the secret in the existing Secrets Manager secret
(`aws secretsmanager put-secret-value --secret-id turnstile-secret --secret-string <secret>`),
set the site key with `gh variable set TURNSTILE_SITE_KEY --env production --body <key>`, then
deploy. To rotate, do the same with a new widget or rotated secret. Running Lambda containers
cache the old secret, so replace them with a configuration update:
`aws lambda update-function-configuration --function-name footballteampicker-api --description "rotated $(date -u +%FT%TZ)"`
(the next deploy clears the description again). Production rejects Cloudflare's test keys.

**IP salt.** `aws ssm put-parameter --name /footballteampicker/ip-salt --type SecureString
--overwrite --value "$(openssl rand -hex 32)"`, then replace running containers as above. Rotate
only if it leaked: rotation resets hourly rate limits and lets an IP report the same list again
(auto-hide counts distinct salted reporters).

## Pause and resume writes

With operator credentials in account `020949219706`, run `bin/killswitch status`,
`bin/killswitch on` (pause), or `bin/killswitch off` (restore concurrency 50). Browsing,
published list/team links and image export read S3 and remain available. Clients receiving
429/503 retain their drafts and show the sharing-paused message. Deploys preserve a pause.

To test the automatic path, set `footballteampicker-write-spike` to ALARM using
`aws cloudwatch set-alarm-state --alarm-name footballteampicker-write-spike --state-value ALARM --state-reason 'operator smoke test'`.
Wait for API concurrency zero, verify an existing shared team still loads, restore with
`bin/killswitch off`, and set the alarm back to OK. Never test this during a planned load
window. SNS subscription filters can take up to 15 minutes to propagate after creation.

If the budget deny action fired, restoring concurrency alone does not restore writes.
Inspect the action with `aws budgets describe-budget-actions-for-budget --account-id 020949219706 --budget-name footballteampicker-monthly`.
After reviewing the cause and costs, use `aws budgets execute-budget-action` with that
budget, account, action ID and `--execution-type REVERSE_BUDGET_ACTION`, then reset the
action with `--execution-type RESET`. Verify the deny policy is detached before resuming.
Do not delete or modify the deny policy: the bootstrap budget role can attach only that policy.

Re-run `bootstrap/bootstrap.sh` with admin credentials when bootstrap policy JSON changes.
It creates the budget execution role and deny policy and grants CI only PassRole to Budgets.
Normal Terraform apply cannot change these bootstrap roles or the permissions boundary.

## Load-test window

The #18 load test runs against production, from one machine, so every request shares one IP.
A window relaxes exactly two things: WAF rate rules switch from Block to Count, and the API
accepts the `X-Loadtest-Token` header in place of Turnstile and the per-IP app limits. Lambda
reserved concurrency (50), the kill switch, the budget action and every other WAF rule stay
as they are, because those are what the test measures.

Only a manual deploy (`workflow_dispatch` with `loadtest_mode`) can open a window. Every push
to `main` closes it, and the deploy smoke test fails if `/api/health` reports a `loadtest`
value other than the one the run asked for. The token is a fresh SecureString
`/footballteampicker/loadtest-token` per window; the API ignores tokens shorter than 32
characters and reads the parameter only while `LOADTEST_TOKEN_PARAM` is set.

Needs operator AWS credentials, an authenticated `gh` and [k6](https://k6.io)
(`brew install k6`). Don't open a window while the kill switch is under test.

```sh
bin/loadtest open        # new token, deploy with loadtest_mode=true; health shows "loadtest":true
bin/loadtest run flow    # 100 users × 10 minutes, the real flow (~60k requests)
bin/loadtest run burst   # 100 full-team shares in the same second
bin/loadtest close       # deploy with loadtest_mode=false, delete the token
```

`flow` passes with zero 5xx, API p95 < 1 s, CloudFront p95 time-to-first-byte < 300 ms and

> 99% checks; `burst` passes when every share succeeds within 3 retries. Afterwards confirm
> in CloudWatch that `footballteampicker-api` had no `Throttles` during `flow` and the kill
> switch didn't trip (`bin/killswitch status`), and record the numbers in INFRA.md
> § Capacity and load test. The test saves roughly 300–400 teams titled "Load test …"; they're
> unlisted and harmless, like any team nobody has the link to.

The #17 flood check runs outside a window, with WAF blocking: `k6 run loadtest/flood.js`
sends 50 requests/s to `/api/health` from one IP and passes when WAF answers 403 within five
minutes. Your IP is then blocked from the whole site for about five minutes.

Rehearse any script locally first: `LOADTEST_TOKEN=<32+ characters> npm run dev`, then run it
with `BASE_URL=http://[::1]:5173` (Vite listens on IPv6 localhost) and the same token.

## Takedowns

Reports, auto-hide, `bin/takedown`, `bin/moderation-queue` and restores are in
[MODERATION.md](MODERATION.md).

## Regenerate the League of Legends seed

Each Riot patch: `bin/seed-lol` (or `bin/seed-lol <version>` to pin), check the diff in
`seed/league-of-legends/`, open a PR and merge. The deploy uploads the new atlas next to the
old ones under `m/seeds/demo-lol/` and deletes nothing, so saved teams keep the portraits
they were built with.

## Launch checklist

Public writes stay gated until all of these are done:

- [ ] Production Turnstile widget: secret and `TURNSTILE_SITE_KEY` set, deployed (#17)
- [ ] SNS email subscription confirmed (ops alarms only; reports aren't emailed, #53); each
      #14 alarm test-fired to ALARM and back to OK with emails received; kill-switch path
      tested per § Pause and resume writes (#14, #17)
- [ ] `app` cost-allocation tag active, so the budget sees the stack's spend (#14)
- [ ] Load test passed and recorded in INFRA.md (§ Load-test window, #18)
- [ ] Single-IP flood gets WAF 403s within five minutes (`loadtest/flood.js`, #17)
