# Moderation

Public rules and the copyright/takedown contact are on `/about`. User-uploaded fan art of
third-party characters is expected; takedown requests are honored within days. There are no
ads, paywalls, or donations. The League of Legends seed and its remixes retain Riot's notice.

## Reports

Every report verifies a fresh Turnstile token. The API stores `REPORT#<list|team>#<id>` with
the reporter's salted network hash as its sort key and `status=open`; repeated reports from
the same network are deduplicated until resolved. Raw IPs are never stored in reports.
The salt is the SecureString `/footballteampicker/ip-salt`, set outside Terraform.

New reports publish the item link and reason to SNS `footballteampicker-alerts`. The email
subscription to `joncfrancisco@gmail.com` must be confirmed using the AWS confirmation email.
A notification failure leaves the report in DynamoDB for review. Check the queue even if
email delivery is unavailable.

At three distinct open reports, a user-created list is hidden, removed from the public
index, and its published JSON is deleted. Ordinary caches may retain it for up to 60 seconds;
use the takedown command for an immediate cache invalidation and portrait removal. An edit
cannot overwrite a moderation hide. Bundled seeds are reviewed through a code change and
redeploy rather than allowing reports to disable the bundled roster automatically.

## Operator commands

Use Node 22 and run `npm ci` in this repository. Authenticate a local AWS admin profile in
account `020949219706`, region `us-east-1`. These commands call AWS directly, never the public
API. They verify the account before touching data. On Windows, prefix the commands with
`node` (for example `node bin/moderation-queue`).

```sh
bin/moderation-queue
bin/takedown list ABCdef1234
bin/takedown team ABCdef1234
bin/takedown list ABCdef1234 --restore
bin/takedown team ABCdef1234 --restore
```

The queue prints one JSON line per open report, oldest first. It does not print edit tokens,
reporter hashes, or the salt. Review the reason and the public item before deciding what to
hide.

A list takedown sets `hidden`, removes its browse-index keys, deletes its published JSON,
copies every `m/img/<listId>/atlas-*` to `private/takedown/m/img/<listId>/`, and deletes the
public copies. CloudFront's media OAC can read only `m/*`, so the recovery copies cannot be
served through the distribution. A team takedown removes only its snapshot JSON; team
portraits belong to source lists and may be used by unrelated teams. If the portraits
themselves violate policy, take down the source list too. Shared seed atlases are not deleted
by a user-list takedown.

Restore copies the private portraits back before republishing the list, resolves its open
reports, and rebuilds browse from the current source records. Private recovery copies are
retained. A restored report can be filed again if a problem recurs. Both operations invalidate
the list/team JSON, the list's portrait prefix, and the browse index. Invalidations are also
requested if archival fails after hiding; failures exit nonzero and should be retried. Do not
manually remove the DynamoDB source item or its private recovery copies before deciding
whether restoration will be needed.

List/team JSON can be rebuilt from DynamoDB. User atlases otherwise have no backup or S3
version history. Do not delete an old public atlas during a normal list edit: saved teams
still point at it.
