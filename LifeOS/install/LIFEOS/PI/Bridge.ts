#!/usr/bin/env bun
/**
 * Pi → LifeOS hook bridge. Called by the generated shim
 * (~/.pi/agent/extensions/lifeos-bridge.ts) with a Claude event name and a
 * JSON payload on stdin; prints the folded verdict { additionalContext, block }.
 * Fails open: any error prints an empty verdict.
 */

import { runBridge, type ClaudeEvent } from "../TOOLS/lib/HookBridge";

try {
  const raw = await new Response(Bun.stdin.stream()).text();
  const v = runBridge("pi", process.argv[2] as ClaudeEvent, raw.trim() ? JSON.parse(raw) : {});
  process.stdout.write(JSON.stringify({ additionalContext: v.additionalContext, block: v.block }));
} catch {
  process.stdout.write(JSON.stringify({ additionalContext: [], block: null }));
}
