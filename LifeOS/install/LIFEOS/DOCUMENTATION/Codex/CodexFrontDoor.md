---
last_updated: 2026-10-09
convention: pai-freshness-v1
version: 1.0.0
---

# Codex front door

The same LifeOS install, opened from Codex CLI. Claims and probes: `LIFEOS/CODEX/ISA.md`.

```bash
bun ~/.claude/LIFEOS/CODEX/Mount.ts          # mount (idempotent; re-run after a LifeOS update)
bun ~/.claude/LIFEOS/CODEX/Mount.ts status
bun ~/.claude/LIFEOS/CODEX/Mount.ts unmount  # removes only what mount created
```

| Piece | Where | How |
|-------|-------|-----|
| Context | `$CODEX_HOME/AGENTS.md` | Managed block (`LIFEOS:BEGIN … END`): identity, constitutional rules, routing table, and how to reach Router lanes without an Agent tool (`Router.ts run <lane>`). Text outside the block is yours and survives every remount. |
| Skills | `$CODEX_HOME/skills/*` | Symlinks into `~/.claude/skills`. One install, edited in one place. |
| Commands | `$CODEX_HOME/prompts/*.md` | Symlinks into `~/.claude/commands` (`/er`, `/vb`, `/rs` …). |
| Hooks | `$CODEX_HOME/hooks.json` | One `LIFEOS_BRIDGE` entry per event (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop) → `CODEX/Bridge.ts`, which replays the LifeOS hooks from `~/.claude/hooks/hooks.json` (`TOOLS/lib/HookBridge.ts`). Codex speaks the same hook JSON as Claude, so the Router's `🧭 ROUTER` line and every guard work unchanged. `[features] codex_hooks = true` is set in `config.toml`. |

Tool names are mapped so hook matchers keep working: `shell`/`exec_command` → Bash, `apply_patch` → Edit. `http` hooks (Pulse) are skipped. Hooks see `LIFEOS_FRONT_DOOR=codex`.

If Codex lists the hooks as untrusted, approve them once inside Codex. Mount never edits trust entries. `CrossVendorAudit.ts` still runs codex with an isolated `CODEX_HOME`, so the cross-vendor auditor never loads this persona.
