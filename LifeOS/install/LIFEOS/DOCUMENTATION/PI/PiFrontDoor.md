---
last_updated: 2026-10-09
convention: pai-freshness-v1
version: 1.0.0
---

# Pi front door

The same LifeOS install, opened from the Pi coding agent. Claims and probes: `LIFEOS/PI/ISA.md`. It supersedes the manual `TOOLS/PiSync.sh` copy.

```bash
bun ~/.claude/LIFEOS/PI/Mount.ts            # mount | status | unmount
```

| Piece | Where | How |
|-------|-------|-----|
| Context | `~/.pi/agent/APPEND_SYSTEM.md` | Managed block appended to Pi's system prompt. It outranks AGENTS.md. |
| Skills | `~/.pi/agent/skills/<kebab-name>/` | Copied with Pi's kebab `name:` and a `lifeos-managed: true` marker. Your own Pi skills, which have no marker, are never touched. |
| Hooks | `~/.pi/agent/extensions/lifeos-bridge.ts` | A generated shim. `session_start` → SessionStart, `before_agent_start` → UserPromptSubmit (context appended to the system prompt, never replacing it), `tool_call` → PreToolUse (`{ block, reason }`), `tool_result` → PostToolUse, `agent_end` → Stop. Each one calls `PI/Bridge.ts`. |

The shim reads `event.systemPrompt`, `event.prompt` and `event.input` defensively. Confirm those field names against your installed Pi version (`LIFEOS/PI/ISA.md` § Remaining Work).
