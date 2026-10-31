#!/usr/bin/env bash
# Proves the moderator role (#50) can moderate and nothing else, using the IAM policy simulator
# against the live role (its inline policy plus the boundary). Run after bootstrap.sh with admin
# credentials; exits nonzero on the first wrong answer.
set -euo pipefail
export AWS_REGION=us-east-1
ROLE=arn:aws:iam::020949219706:role/footballteampicker-moderator
TABLE=arn:aws:dynamodb:us-east-1:020949219706:table/footballteampicker
BUCKET=arn:aws:s3:::footballteampicker-media-020949219706
DIST=arn:aws:cloudfront::020949219706:distribution/E374QW7TXASG40
failed=0

# check <allowed|denied> <action> <resource> [ContextKeyName=...,ContextKeyValues=...,ContextKeyType=...]...
check() {
    local want=$1 action=$2 resource=$3
    shift 3
    local got context=()
    [ $# -gt 0 ] && context=(--context-entries "$@")
    got=$(aws iam simulate-principal-policy --policy-source-arn "$ROLE" --action-names "$action" \
        --resource-arns "$resource" ${context[@]+"${context[@]}"} \
        --query 'EvaluationResults[0].EvalDecision' --output text)
    [ "$got" = allowed ] || got=denied
    if [ "$got" = "$want" ]; then echo "ok    $want  $action  $resource"; else
        echo "FAIL  expected $want, got $got: $action $resource $*"
        failed=1
    fi
}
keys() { echo "ContextKeyName=dynamodb:LeadingKeys,ContextKeyValues=$1,ContextKeyType=stringList"; }
attrs() { echo "ContextKeyName=dynamodb:Attributes,ContextKeyValues=$1,ContextKeyType=stringList"; }
prefix() { echo "ContextKeyName=s3:prefix,ContextKeyValues=$1,ContextKeyType=string"; }

# What moderation needs.
check allowed dynamodb:Query "$TABLE/index/GSI1" "$(keys 'REPORT#open')"
check allowed dynamodb:Query "$TABLE/index/GSI1" "$(keys PUBLIC)"
check allowed dynamodb:Query "$TABLE" "$(keys 'REPORT#list#abcdefghij')"
check allowed dynamodb:GetItem "$TABLE" "$(keys 'LIST#abcdefghij')"
check allowed dynamodb:BatchGetItem "$TABLE" "$(keys 'LIST#abcdefghij')"
check allowed dynamodb:UpdateItem "$TABLE" "$(keys 'REPORT#team#abcdefghij')" \
    "$(attrs PK,SK,status,GSI1PK,GSI1SK,resolvedAt,resolvedBy,action,note)"
check allowed dynamodb:UpdateItem "$TABLE" "$(keys 'LIST#abcdefghij')" "$(attrs PK,SK,hidden,version,GSI1PK,GSI1SK)"
check allowed s3:GetObject "$BUCKET/m/img/abcdefghij/atlas-x.webp"
check allowed s3:ListBucket "$BUCKET" "$(prefix m/img/abcdefghij/)"
check allowed s3:PutObject "$BUCKET/private/takedown/m/img/abcdefghij/atlas-x.webp"
check allowed s3:PutObject "$BUCKET/m/browse/index.json"
check allowed s3:DeleteObject "$BUCKET/m/l/abcdefghij.json"
check allowed s3:DeleteObject "$BUCKET/m/t/abcdefghij.json"
check allowed s3:DeleteObject "$BUCKET/m/img/abcdefghij/atlas-x.webp"
# The boundary also requires the distribution's app tag, which the simulator does not look up.
check allowed cloudfront:CreateInvalidation "$DIST" \
    "ContextKeyName=aws:ResourceTag/app,ContextKeyValues=footballteampicker,ContextKeyType=string"

# Restore: needs the private recovery copies.
check denied s3:GetObject "$BUCKET/private/takedown/m/img/abcdefghij/atlas-x.webp"
check denied s3:ListBucket "$BUCKET" "$(prefix private/takedown/m/img/abcdefghij/)"
check denied s3:PutObject "$BUCKET/m/l/abcdefghij.json"
check denied s3:PutObject "$BUCKET/m/t/abcdefghij.json"
check denied s3:PutObject "$BUCKET/m/img/abcdefghij/atlas-x.webp"
# Everything else in the table.
check denied dynamodb:Scan "$TABLE"
check denied dynamodb:PutItem "$TABLE" "$(keys 'LIST#abcdefghij')"
check denied dynamodb:DeleteItem "$TABLE" "$(keys 'LIST#abcdefghij')"
check denied dynamodb:UpdateItem "$TABLE" "$(keys 'LIST#abcdefghij')" "$(attrs PK,SK,title)"
check denied dynamodb:UpdateItem "$TABLE" "$(keys 'LIST#abcdefghij')" "$(attrs PK,SK,editTokenHash)"
check denied dynamodb:GetItem "$TABLE" "$(keys 'RATE#net#1#teams')"
check denied dynamodb:GetItem "$TABLE" "$(keys 'UPLOAD#x')"
# Everything outside moderation.
check denied s3:DeleteObject "$BUCKET/m/seeds/demo-lol/atlas.webp"
check denied s3:PutObject "arn:aws:s3:::footballteampicker-site-020949219706/index.html"
check denied lambda:PutFunctionConcurrency arn:aws:lambda:us-east-1:020949219706:function:footballteampicker-api
check denied lambda:UpdateFunctionCode arn:aws:lambda:us-east-1:020949219706:function:footballteampicker-api
check denied ssm:GetParameter arn:aws:ssm:us-east-1:020949219706:parameter/footballteampicker/ip-salt
check denied secretsmanager:GetSecretValue arn:aws:secretsmanager:us-east-1:020949219706:secret:turnstile-secret-abc
check denied sns:Publish arn:aws:sns:us-east-1:020949219706:footballteampicker-alerts
check denied cloudfront:UpdateDistribution "$DIST"
check denied wafv2:UpdateWebACL '*'
check denied iam:PutRolePolicy arn:aws:iam::020949219706:role/footballteampicker-moderator
check denied iam:CreateAccessKey arn:aws:iam::020949219706:user/footballteampicker-moderator-agent
check denied sts:AssumeRole arn:aws:iam::020949219706:role/footballteampicker-gha-deploy
check denied budgets:ModifyBudget '*'

[ "$failed" = 0 ] && echo "moderator role: all checks passed" || exit 1
