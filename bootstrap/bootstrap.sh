#!/usr/bin/env bash
# One-time, admin-only setup that the CI roles must never be able to change: this repo's two
# CI roles, the permissions boundary for roles the stack creates, and the GitHub environment.
# The state bucket and GitHub's OIDC provider are account-wide and owned by doorbell's bootstrap.
# Idempotent; re-run it after editing any JSON in this directory.
#
# Run with admin credentials (not from CI):  bootstrap/bootstrap.sh
set -euo pipefail
cd "$(dirname "$0")"
export AWS_REGION=us-east-1

ACCOUNT=020949219706
REPO=joncfrancisco/footballteampicker
BOUNDARY_ARN=arn:aws:iam::$ACCOUNT:policy/footballteampicker-boundary
TAGS=(Key=app,Value=footballteampicker Key=managed-by,Value=bootstrap)

# Ceiling for every role infra/ creates (the API's Lambda role). The deploy role can only
# create or change those roles with this boundary attached, so it can't grant itself more.
if aws iam get-policy --policy-arn "$BOUNDARY_ARN" >/dev/null 2>&1; then
    # Keep at most 5 versions: drop the oldest non-default before adding one.
    old=$(aws iam list-policy-versions --policy-arn "$BOUNDARY_ARN" \
        --query 'Versions[?!IsDefaultVersion].VersionId' --output text | tr '\t' '\n' | sort -V |
        awk '{ v[NR] = $0 } END { for (i = 1; i <= NR - 3; i++) print v[i] }')
    for v in $old; do aws iam delete-policy-version --policy-arn "$BOUNDARY_ARN" --version-id "$v"; done
    aws iam create-policy-version --policy-arn "$BOUNDARY_ARN" \
        --policy-document file://boundary.json --set-as-default >/dev/null
else
    aws iam create-policy --policy-name footballteampicker-boundary --tags "${TAGS[@]}" \
        --description "Ceiling for roles created by footballteampicker infra/" \
        --policy-document file://boundary.json >/dev/null
fi
echo "boundary: $BOUNDARY_ARN"

role() {
    local name=$1 trust=$2 policy=$3 desc=$4
    if aws iam get-role --role-name "$name" >/dev/null 2>&1; then
        aws iam update-assume-role-policy --role-name "$name" --policy-document "file://$trust"
    else
        aws iam create-role --role-name "$name" --description "$desc" \
            --assume-role-policy-document "file://$trust" --max-session-duration 3600 \
            --tags "${TAGS[@]}" >/dev/null
    fi
    aws iam put-role-policy --role-name "$name" --policy-name footballteampicker \
        --policy-document "file://$policy"
    echo "role: $name"
}

role footballteampicker-gha-plan   trust-plan.json   policy-plan.json \
    "footballteampicker CI: terraform plan on pull requests (read-only)"
role footballteampicker-gha-deploy trust-deploy.json policy-deploy.json \
    "footballteampicker CI: apply and deploy from the production environment"

# Budget execution is a bootstrap role outside the CI-created api* namespace. It can attach
# only this deny-only policy to the API role; it cannot grant permissions or affect other apps.
BUDGET_DENY_ARN=arn:aws:iam::$ACCOUNT:policy/footballteampicker-api-budget-deny
if ! aws iam get-policy --policy-arn "$BUDGET_DENY_ARN" >/dev/null 2>&1; then
    aws iam create-policy --policy-name footballteampicker-api-budget-deny --tags "${TAGS[@]}" \
        --description "Budget backstop: deny all API role activity" \
        --policy-document file://budget-deny.json >/dev/null
fi
role footballteampicker-budget-action trust-budget.json policy-budget.json \
    "footballteampicker: budget action may attach only the API deny policy"

# GitHub: the deploy role is only usable from the production environment, which only main
# can deploy to. The plan role ARN is a repo variable because PR jobs have no environment.
gh api -X PUT "repos/$REPO/environments/production" --input - >/dev/null <<JSON
{"deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}
JSON
gh api "repos/$REPO/environments/production/deployment-branch-policies" -q '.branch_policies[].name' |
    grep -qx main || gh api -X POST "repos/$REPO/environments/production/deployment-branch-policies" \
    -f name=main -f type=branch >/dev/null
gh variable set AWS_ROLE_ARN --repo "$REPO" --env production \
    --body "arn:aws:iam::$ACCOUNT:role/footballteampicker-gha-deploy"
gh variable set AWS_PLAN_ROLE_ARN --repo "$REPO" \
    --body "arn:aws:iam::$ACCOUNT:role/footballteampicker-gha-plan"
echo "github: environment production (main only), AWS_ROLE_ARN, AWS_PLAN_ROLE_ARN"

# Cost allocation by app=footballteampicker (for the monthly budget). Shared across stacks, so
# it may already be active; a key only becomes activatable ~24h after the first tagged resource.
if aws ce update-cost-allocation-tags-status \
    --cost-allocation-tags-status TagKey=app,Status=Active >/dev/null 2>&1; then
    echo "cost allocation tag: app (active)"
else
    echo "cost allocation tag: app not activatable yet; re-run after the first tagged resources exist"
fi
