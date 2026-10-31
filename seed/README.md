# Seed rosters

Built-in character lists, bundled with the web app. Each folder is one list:
`list.json` plus a sprite atlas (`atlas-<hash>.webp`, one request for every portrait).
Characters reference their tile by `atlasIndex` (row-major, `atlas.columns` per row).

| List | Generator | Source |
|---|---|---|
| `league-of-legends/` | `bin/seed-lol [version]` | Riot Data Dragon, patch in `list.json` → `source.version` |

Regenerate rather than hand-edit. League of Legends assets are used under Riot Games'
"Legal Jibber Jabber" policy: the site must stay free and non-commercial, and must show
`list.json` → `disclaimer` wherever the list appears.
