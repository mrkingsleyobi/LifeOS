---
last_updated: 2026-10-09
convention: pai-freshness-v1
version: 1.0.0
---

# Session restore (`/rs`)

Bring back Claude, Codex and Pi sessions that a closed terminal, crash or reboot killed. Claims and probes: `LIFEOS/SESSIONS/ISA.md`.

```bash
bun ~/.claude/LIFEOS/TOOLS/Sessions.ts list [--hours 48] [--all]
bun ~/.claude/LIFEOS/TOOLS/Sessions.ts restore <n|id-prefix> [--print]
bun ~/.claude/LIFEOS/TOOLS/Sessions.ts restore-all [--kitty]     # one kitty tab per session
```

Ground truth is each harness's own transcripts: Claude `~/.claude/projects/*/<id>.jsonl`, Codex rollout `session_meta`, and the Pi session header. A session counts as **live** when its transcript moved in the last 2 minutes, or when a process of that harness sits in its cwd and it's the newest session there. Everything else in the window is restorable with `claude --resume <id>`, `codex resume <id>` or `pi --session <file>`. Each `list` rewrites the snapshot at `MEMORY/STATE/live-sessions.json`.
