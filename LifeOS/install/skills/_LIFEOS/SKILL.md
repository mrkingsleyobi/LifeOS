---
name: _LIFEOS
version: 1.0.0
description: "Private release management for this LifeOS install — the Ledger's tooling: classify a change (patch | feature | major), bump the umbrella LIFEOS/VERSION and every touched component line, record it in MEMORY/SYSTEMUPDATES, regenerate the index + changelog, commit and tag. USE WHEN /vb, version bump, cut a release, what version is this change, regenerate the changelog, ledger index. NOT FOR deploying apps (Bunker), upgrades backlog (Upgrade/Upgrades), public releases (this install has no public payload)."
---

# _LIFEOS — release management (private)

The Ledger's concepts are public (`LIFEOS/DOCUMENTATION/Ledger/LedgerSystem.md`). This is this install's own tooling for them. The underscore prefix keeps it CONFIDENTIAL and out of any release.

## Workflow Routing

| Request | Workflow |
|---|---|
| `/vb`, bump the version, cut a release | `Workflows/VersionBump.md` |

## Examples

```bash
T=~/.claude/skills/_LIFEOS/Tools/VersionBump.ts
bun $T classify                                   # FEATURE · 9 new capability file(s): …
bun $T vb --title "Router and Jev lane routing" --yes --commit --tag
bun $T index                                      # rebuild index.json + CHANGELOG.md
```

## Gotchas

- **MAJOR is a conversation, not a flag.** Only pass `--yes` on a major after the principal agreed in this session. The classifier calls removed hooks/tools/skills and schema files (ISAFormat, KnowledgeSchema, data-classification, LaneQuestions) major on purpose.
- **Titles are 4–8 real words.** `CreateUpdate.ts` rejects anything else; write what changed, not "misc fixes".
- **Run `index` after hand-editing a record**, or Pulse `/ledger` shows the stale view.
