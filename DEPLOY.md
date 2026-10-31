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

After that WAF configuration is deployed, create a Free subscription with admin credentials:

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

## Remaining launch runbook

Production Turnstile key configuration, kill-switch and budget-action procedures, load-test
windows, rollback details, rotations, and seed regeneration are tracked in #15/#17/#18 and
will be filled in as those mechanisms are deployed. Public writes remain gated until the
matching public Turnstile site key is configured and launch checks are complete.
