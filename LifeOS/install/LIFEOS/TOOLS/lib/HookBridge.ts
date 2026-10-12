/**
 * HookBridge — run LifeOS's Claude Code hooks from another harness (Codex, Pi).
 *
 * The same install, opened from a different front door, should get the same
 * guards and context: the Router's lane pick, Safety/PreToolGuard blocks,
 * SatisfactionCapture, LoadContext. Rather than port each hook, the bridge
 * replays the hooks registered in ~/.claude/hooks/hooks.json for a Claude event,
 * feeding them a Claude-shaped payload, and folds their outputs into one verdict:
 *
 *   { additionalContext: string[], block: { reason } | null }
 *
 * Tool names are mapped to Claude's vocabulary so `matcher` regexes keep working
 * (codex `shell`/`exec_command` → Bash, `apply_patch` → Edit; pi `bash`/`write`/
 * `edit`/`read` → Bash/Write/Edit/Read). `http` hooks are skipped (they need
 * the Pulse daemon, which a front door may not have). Hooks run with
 * LIFEOS_FRONT_DOOR=<door> so any hook can tell where it's running.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { spawnSync } from "child_process";

export type Door = "codex" | "pi";
export type ClaudeEvent = "SessionStart" | "UserPromptSubmit" | "PreToolUse" | "PostToolUse" | "Stop";

const TOOL_MAP: Record<string, string> = {
  shell: "Bash", exec_command: "Bash", local_shell: "Bash", bash: "Bash",
  apply_patch: "Edit", edit: "Edit", write: "Write", read: "Read",
  grep: "Grep", find: "Glob", ls: "Glob", web_search: "WebSearch",
};
export const claudeToolName = (t: string) => TOOL_MAP[t] ?? TOOL_MAP[t.toLowerCase()] ?? t;

export interface BridgeResult { additionalContext: string[]; block: { reason: string } | null; ran: string[] }

interface HookEntry { matcher?: string; hooks: { type: string; command?: string; timeout?: number }[] }

export function loadHooks(event: ClaudeEvent, hooksFile = process.env.LIFEOS_HOOKS_FILE ?? join(homedir(), ".claude", "hooks", "hooks.json")): HookEntry[] {
  try { return (JSON.parse(readFileSync(hooksFile, "utf-8")).hooks?.[event] ?? []) as HookEntry[]; }
  catch { return []; }
}

/** Hooks a door must never replay: they drive Claude-only UI/state. */
const SKIP = /KittyEnvPersist|TabState|ContextReduction\.hook\.sh/;

export function runBridge(door: Door, event: ClaudeEvent, payload: Record<string, unknown>, opts: { hooksFile?: string } = {}): BridgeResult {
  const out: BridgeResult = { additionalContext: [], block: null, ran: [] };
  const tool = typeof payload.tool_name === "string" ? claudeToolName(payload.tool_name) : undefined;
  const body = JSON.stringify({ ...payload, hook_event_name: event, ...(tool ? { tool_name: tool } : {}) });
  for (const entry of loadHooks(event, opts.hooksFile)) {
    if (entry.matcher && tool && !new RegExp(`^(?:${entry.matcher})$`).test(tool)) continue;
    if (entry.matcher && !tool && (event === "PreToolUse" || event === "PostToolUse")) continue;
    for (const h of entry.hooks) {
      if (h.type !== "command" || !h.command || SKIP.test(h.command)) continue;
      const cmd = h.command.replace(/\$HOME/g, homedir()).replace(/^~(?=\/)/, homedir());
      const r = spawnSync("bash", ["-c", cmd], {
        input: body, encoding: "utf-8", timeout: (h.timeout ?? 10) * 1000,
        env: { ...process.env, LIFEOS_FRONT_DOOR: door, CLAUDE_HOOK_EVENT: event },
      });
      out.ran.push(cmd.split("/").pop() ?? cmd);
      // Claude contract: exit 2 = block, stderr is the reason.
      if (r.status === 2) { out.block ??= { reason: (r.stderr || "blocked by a LifeOS hook").trim() }; continue; }
      const text = (r.stdout ?? "").trim();
      if (!text) continue;
      try {
        const j = JSON.parse(text);
        const hso = j.hookSpecificOutput ?? {};
        if (hso.additionalContext) out.additionalContext.push(String(hso.additionalContext));
        if (j.decision === "block" || hso.permissionDecision === "deny") out.block ??= { reason: String(j.reason ?? hso.permissionDecisionReason ?? "blocked by a LifeOS hook") };
        if (j.continue === false) out.block ??= { reason: String(j.stopReason ?? "stopped by a LifeOS hook") };
      } catch {
        // Plain stdout is context for SessionStart / UserPromptSubmit (Claude semantics).
        if (event === "SessionStart" || event === "UserPromptSubmit") out.additionalContext.push(text);
      }
    }
  }
  return out;
}

/** Codex speaks the same hook JSON as Claude: translate the folded result back. */
export function toCodexOutput(event: ClaudeEvent, r: BridgeResult): { stdout: string; exit: number; stderr: string } {
  if (r.block && (event === "PreToolUse")) return { stdout: "", exit: 2, stderr: r.block.reason };
  if (r.block) return { stdout: JSON.stringify({ continue: false, stopReason: r.block.reason }), exit: 0, stderr: "" };
  if (r.additionalContext.length && (event === "SessionStart" || event === "UserPromptSubmit"))
    return { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: r.additionalContext.join("\n\n") } }), exit: 0, stderr: "" };
  return { stdout: "", exit: 0, stderr: "" };
}
