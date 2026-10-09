#!/usr/bin/env bun
/**
 * Codex → LifeOS hook bridge. Registered by CODEX/Mount.ts in $CODEX_HOME/hooks.json:
 *   bun Bridge.ts <SessionStart|UserPromptSubmit|PreToolUse|PostToolUse|Stop>
 * Reads Codex's hook JSON on stdin (same shape as Claude's), replays the matching
 * LifeOS hooks, prints Codex-shaped output. Fails open: any bridge error → exit 0.
 */

import { runBridge, toCodexOutput, type ClaudeEvent } from "../TOOLS/lib/HookBridge";

const event = process.argv[2] as ClaudeEvent;
try {
  const raw = await new Response(Bun.stdin.stream()).text();
  const payload = raw.trim() ? JSON.parse(raw) : {};
  const out = toCodexOutput(event, runBridge("codex", event, payload));
  if (out.stdout) process.stdout.write(out.stdout);
  if (out.stderr) process.stderr.write(out.stderr);
  process.exit(out.exit);
} catch (e) {
  process.stderr.write(`[LifeOS bridge] ${String((e as Error)?.message ?? e)}\n`);
  process.exit(0);
}
