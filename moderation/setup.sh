#!/usr/bin/env bash
# Setup script for the depthchart-moderation cloud environment (#52). The environment holds
# only the moderator agent user's access key, in MODERATOR_AWS_ACCESS_KEY_ID and
# MODERATOR_AWS_SECRET_ACCESS_KEY. This writes a profile that assumes the moderator role, so
# every AWS call runs as footballteampicker-moderator, then checks that it does.
# Run from the repository root:  moderation/setup.sh
set -euo pipefail
: "${MODERATOR_AWS_ACCESS_KEY_ID:?not set in the environment}"
: "${MODERATOR_AWS_SECRET_ACCESS_KEY:?not set in the environment}"

mkdir -p ~/.aws && chmod 700 ~/.aws
umask 077
cat > ~/.aws/credentials <<INI
[moderator-agent]
aws_access_key_id = $MODERATOR_AWS_ACCESS_KEY_ID
aws_secret_access_key = $MODERATOR_AWS_SECRET_ACCESS_KEY
INI
cat > ~/.aws/config <<'INI'
[profile moderator]
role_arn = arn:aws:iam::020949219706:role/footballteampicker-moderator
source_profile = moderator-agent
role_session_name = moderation-agent
duration_seconds = 3600
region = us-east-1
INI

npm ci --no-audit --no-fund
arn=$(moderation/as-moderator node --input-type=module -e '
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
const id = await new STSClient({}).send(new GetCallerIdentityCommand({}));
console.log(id.Arn);' 2>&1) || { echo "moderator identity check failed: $arn" >&2; exit 1; }
case $arn in
*:assumed-role/footballteampicker-moderator/*) echo "moderator: $arn" ;;
*) echo "expected the moderator role, got: $arn" >&2; exit 1 ;;
esac
