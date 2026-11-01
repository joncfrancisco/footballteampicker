# Moderation

Public rules are on `/about`. Copyright/DMCA requests and appeals come in through Report
(no public email); the agent escalates them to Jon. User-uploaded fan art of
third-party characters is expected; takedown requests are honored within days. There are no
ads, paywalls, or donations. The League of Legends seed and its remixes retain Riot's notice.

## Reports

Every report verifies a fresh Turnstile token. The API stores `REPORT#<list|team>#<id>` with
the reporter's salted network hash as its sort key and `status=open`; repeated reports from
the same network are deduplicated until resolved. Raw IPs are never stored in reports.
The salt is the SecureString `/footballteampicker/ip-salt`, set outside Terraform.

Reports are not emailed. The DynamoDB queue is the only record, and the daily moderation
agent (`moderation/agent.md`) works it and sends one digest. `bin/moderation-queue` shows the
same queue on demand.

At three distinct open reports, a user-created list is hidden, removed from the public
index, and its published JSON is deleted. Ordinary caches may retain it for up to 60 seconds;
use the takedown command for an immediate cache invalidation and portrait removal. An edit
cannot overwrite a moderation hide. Bundled seeds are reviewed through a code change and
redeploy rather than allowing reports to disable the bundled roster automatically.

## Operator commands

Use Node 22 and run `npm ci` in this repository. These commands call AWS directly, never the
public API, and verify account `020949219706` (region `us-east-1`) before touching data. On
Windows, prefix the commands with `node` (for example `node bin/moderation queue`).

They run as either an admin profile or the moderator role (#50). The role can do everything
except `restore` and `reindex`; IAM enforces that, and the commands refuse up front.

```sh
bin/moderation queue [--json]                                   # open reports
bin/moderation takedown <list|team> <id> [--note "<why>"]       # hide; resolves its reports
bin/moderation dismiss <list|team> <id> --note "<why>"          # resolve without hiding
bin/moderation log [--since 24h|7d|<ISO>]                       # who resolved what
bin/moderation restore <list|team> <id> [--note "<why>"]        # admin only
bin/moderation reindex                                          # admin only, once (see below)
```

`takedown`, `dismiss` and `restore` take `--dry-run`, which prints what would change and writes
nothing. `bin/moderation-queue` and `bin/takedown <list|team> <id> [--restore]` still work.

The plain queue prints one JSON line per open report, oldest first. `--json` prints one array
grouped by item: report count, reasons, the public link, and the item's title, description,
tags, character names and atlas URL, so a decision needs one call. It never prints edit tokens,
reporter hashes or the salt. Review the reason and the public item before deciding what to hide.

Every resolution records `action` (`takedown`, `dismiss` or `restore`), `resolvedBy` (the
caller's ARN, which tells the moderator agent apart from an admin), `resolvedAt` and `note` on
each report. Open reports live in the GSI1 partition `REPORT#open` and resolved ones in
`REPORT#resolved` (sorted by `resolvedAt`), so neither the queue nor the log scans the table.
Reports filed before that index existed need `bin/moderation reindex` once, as an admin.

A list takedown sets `hidden`, removes its browse-index keys, deletes its published JSON,
copies every `m/img/<listId>/atlas-*` to `private/takedown/m/img/<listId>/`, and deletes the
public copies. CloudFront's media OAC can read only `m/*`, so the recovery copies cannot be
served through the distribution. A team takedown removes only its snapshot JSON; team
portraits belong to source lists and may be used by unrelated teams. If the portraits
themselves violate policy, take down the source list too. Shared seed atlases are not deleted
by a user-list takedown.

Restore copies the private portraits back before republishing the list, resolves any open
reports, and rebuilds browse from the current source records. Private recovery copies are
retained. A restored report can be filed again if a problem recurs. Both operations invalidate
the list/team JSON, the list's portrait prefix, and the browse index. Invalidations are also
requested if archival fails after hiding; failures exit nonzero and should be retried. Do not
manually remove the DynamoDB source item or its private recovery copies before deciding
whether restoration will be needed.

List/team JSON can be rebuilt from DynamoDB. User atlases otherwise have no backup or S3
version history. Do not delete an old public atlas during a normal list edit: saved teams
still point at it.

## Moderator role (#50)

`footballteampicker-moderator` can moderate and nothing else: read the queue and the reported
items, take a list or team down, and dismiss reports (#51). It can't restore, because restore
reads the private recovery copies under `private/` and the role is explicitly denied them. It
can't edit content, delete source records, scan the table, read rate-limit or upload items,
or touch Lambda, IAM, WAF, CloudFront configuration, secrets, budgets or alerts.

The role and its only caller, the IAM user `footballteampicker-moderator-agent`, live in
`bootstrap/` (admin only), not `infra/`, so CI can never widen them. The user's only permission
is `sts:AssumeRole` on the role; sessions last at most an hour. The role also carries the
permissions boundary.

One residual gap: `UpdateItem` may set `hidden`, so a hand-crafted call could clear the flag on
a list. That alone republishes nothing (the role can't write `m/l/` or `m/t/`), but the owner's
next edit would. The commands never do this, and `bin/moderation log` shows every resolution.

**Set up or change it** (admin credentials):

```sh
bootstrap/bootstrap.sh            # creates or updates the user, role and policies
bootstrap/check-moderator.sh      # IAM policy simulator: what it can and can't do
```

**Credentials for the daily agent (#52).** Create an access key for the user and put it only in
the agent's cloud environment, never in the repo, Terraform or chat:

```sh
aws iam create-access-key --user-name footballteampicker-moderator-agent
```

Put the key in the environment as `MODERATOR_AWS_ACCESS_KEY_ID` and
`MODERATOR_AWS_SECRET_ACCESS_KEY` (not the standard `AWS_*` names, which would make the AWS SDK
use the user's key directly instead of the role). Each run starts with `moderation/setup.sh`,
which writes a `moderator` profile that assumes the role and checks the resulting identity;
`moderation/as-moderator <command>` then runs a command as the role. The agent's instructions
are in [moderation/agent.md](moderation/agent.md).

Rotate the key every 90 days: create a second key, update the environment, confirm a run, then
`aws iam delete-access-key --user-name footballteampicker-moderator-agent --access-key-id <old>`.
To cut the agent off immediately, `aws iam update-access-key --status Inactive` on its key.
