---
name: rs
description: Restore sessions — list Claude/Codex/Pi sessions that were killed (closed terminal, crash, reboot) and resume them.
argument-hint: [number | id-prefix | all]
---

1. Run `bun ~/.claude/LIFEOS/TOOLS/Sessions.ts list` and show the numbered list.
2. With an argument: `bun ~/.claude/LIFEOS/TOOLS/Sessions.ts restore $ARGUMENTS --print` and give the principal the command (resuming inside this session would nest harnesses). For `all`, run `restore-all --kitty` when inside kitty, otherwise `restore-all` and show the commands.
