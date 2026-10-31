# Deployment

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

## Remaining launch runbook

Production Turnstile public key configuration, rollback details, rotations, and seed
regeneration are tracked in #15/#17 and
will be filled in as those mechanisms are deployed. Public writes remain gated until the
matching public Turnstile site key is configured and launch checks are complete.
