# CLAUDE.md

Depth Chart (`depthchart.joncfrancis.co`): a tier-list-style lineup builder. Layout and local
commands are in [README.md](README.md).

Before touching infrastructure, deploys or production, read:

- [INFRA.md](INFRA.md): every AWS resource, the data layout, capacity model, costs and gotchas
- [DEPLOY.md](DEPLOY.md): bootstrap, deploys, rollback, secrets, kill switch, load-test window,
  launch checklist
- [MODERATION.md](MODERATION.md): reports, takedowns and the content policy

Rules that aren't obvious from the code:

- Terraform is applied only by GitHub Actions on `main`. Never run `terraform apply` locally.
- Bootstrap resources (`bootstrap/`) and the permissions boundary need admin credentials; CI
  can't change them.
- Published teams (`m/t/<id>.json`) are immutable and shared by link, so any change to the team
  shape must keep reading every older published team.
- The CloudFront Free plan allows managed policies only, 5 behaviours and 5 WAF rules.
- Run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` before a PR.
