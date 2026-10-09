# VersionBump Workflow (`/vb`)

1. `bun ~/.claude/skills/_LIFEOS/Tools/VersionBump.ts classify` and read the reasons back to the principal in one line.
2. PATCH: run `vb --title "…"` directly. FEATURE: one-line confirm, then `vb --title "…" --yes`. MAJOR: stop and have the conversation first.
3. Add `--commit --tag` when the principal wants the release cut (commits in the repo that holds LIFEOS_DIR, tags `v<version>`).
4. Report: new version, component lines bumped, registry count.
