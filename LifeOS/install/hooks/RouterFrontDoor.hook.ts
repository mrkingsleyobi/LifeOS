#!/usr/bin/env bun
// Normalize env path vars Claude Code may inject unexpanded (#1404).
for (const __k of ["LIFEOS_DIR", "LIFEOS_CONFIG_DIR", "PROJECTS_DIR"]) {
  const __v = process.env[__k];
  if (__v && /^\$\{?HOME\}?(\/|$)/.test(__v)) process.env[__k] = __v.replace(/^\$\{?HOME\}?/, process.env.HOME ?? "~");
}

/**
 * @version 1.0.0
 * TRIGGER: UserPromptSubmit (SYNC — an async UserPromptSubmit hook cannot
 * inject additionalContext; public issue #1957)
 *
 * RouterFrontDoor — Jev decides, per prompt, which lane runs the work.
 *
 * Reads the prompt + the tail of the previous assistant reply, asks
 * LIFEOS/ROUTER/FrontDoor.ts for a decision (one Jev call, ~0.3s; heuristic
 * fallback on timeout), writes router state for the statusline, and injects:
 *
 *   🧭 ROUTER: SOL · HIGH · high · tiered · delegate · Jev (p 0.76) · 0.34s
 *   ROUTE: lane=sol agent=Sol model=gpt-6.1-sol effort=high …
 *   DIRECTIVE: …dispatch instruction for the main loop…
 *
 * What it cannot do: change the main loop's model (no hook can). The router's
 * leverage is the DISPATCH — the main loop orchestrates, the named lane agent
 * does the substantive work at the routed model and effort.
 *
 * Failure mode: any error → stderr + exit 0 with no output. Never blocks a prompt.
 */

import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { route, routerLine, type RouteDecision } from "../LIFEOS/ROUTER/FrontDoor";
import { writeDecision } from "../LIFEOS/ROUTER/State";
import { LANES } from "../LIFEOS/ROUTER/Lanes";

const TAIL_BYTES = 128 * 1024;

async function readStdin(timeoutMs = 400): Promise<string> {
  const chunks: Buffer[] = [];
  const done = new Promise<void>((res) => {
    process.stdin.on("data", (c: Buffer | string) => chunks.push(Buffer.from(c)));
    process.stdin.on("end", () => res());
  });
  await Promise.race([done, new Promise((r) => setTimeout(r, timeoutMs))]);
  return Buffer.concat(chunks).toString("utf-8");
}

/** Text of the last assistant message in the transcript tail. */
export function lastAssistantTail(transcriptPath?: string, max = 800): string {
  if (!transcriptPath) return "";
  try {
    const fd = openSync(transcriptPath, "r");
    try {
      const size = fstatSync(fd).size;
      const start = Math.max(0, size - TAIL_BYTES);
      const buf = Buffer.alloc(size - start);
      readSync(fd, buf, 0, buf.length, start);
      const lines = buf.toString("utf-8").split("\n");
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].includes('"assistant"')) continue;
        try {
          const ev = JSON.parse(lines[i]);
          const content = ev?.message?.content;
          if (ev?.type !== "assistant" || !Array.isArray(content)) continue;
          const text = content.filter((c: any) => c?.type === "text").map((c: any) => c.text).join("\n").trim();
          if (text) return text.slice(-max);
        } catch { /* partial line */ }
      }
    } finally { closeSync(fd); }
  } catch { /* no transcript */ }
  return "";
}

const dispatch = (agent: string | null, effort: string) =>
  agent ? `Agent(subagent_type="${agent}") at effort ${effort}` : "the main loop";

export function directive(d: RouteDecision): string {
  const head = d.mode === "enforce" && d.verdict === "act" ? "DIRECTIVE" : "ADVICE (shadow — log only, do not treat as binding)";
  if (d.lane === "inline") return "";
  if (d.strategy === "private") {
    return `${head}: PRIVATE PINNED LANE. This prompt carries sensitive data (${d.dataClass}). Do NOT pass its content to any cloud agent, cross-vendor tool, web fetch, or Jev. Process it with ${dispatch("Private", d.effort)} or \`bun ~/.claude/LIFEOS/ROUTER/Router.ts run private < brief\` (loopback llama.cpp only). If the local lane is down, stop and say so — there is no cloud fallback.`;
  }
  const lines: string[] = [];
  if (d.strategy === "fusion" && d.fusion) {
    lines.push(`${head}: FUSION. Dispatch the same brief in parallel to ${d.fusion.members.map((m) => LANES[m].agent).join(", ")}; then have ${LANES[d.fusion.synthesizer].agent} fuse their answers (agreements, disagreements, the call). You verify and reply.`);
  } else if (d.strategy === "combo" && d.combo) {
    lines.push(`${head}: COMBO. ${LANES[d.combo.producer].agent} produces via ${dispatch(LANES[d.combo.producer].agent, d.effort)}; then ${LANES[d.combo.reviewer].agent} reviews the result (cross-vendor; a lane never reviews its own work). Fix confirmed findings before replying.`);
  } else {
    lines.push(`${head}: delegate the substantive work to ${dispatch(d.agent, d.effort)}. Keep orchestration, verification, and the reply in the main loop.`);
  }
  const fb = d.chain.filter((c) => !c.ok).map((c) => `${LANES[c.lane].label} skipped (${c.why})`);
  if (fb.length) lines.push(`FALLBACK: ${fb.join("; ")}.`);
  lines.push("Explicit principal instructions about model or agent always override this route.");
  return lines.join("\n");
}

async function main() {
  const raw = await readStdin();
  if (!raw) return;
  let input: any;
  try { input = JSON.parse(raw); } catch { return; }
  const prompt: string = typeof input?.prompt === "string" ? input.prompt : "";
  if (!prompt || process.env.LIFEOS_ROUTER === "off") return;

  const d = await route({ prompt, prevTail: lastAssistantTail(input.transcript_path), sessionId: input.session_id });
  if (!d) return;
  try { writeDecision(d, input.session_id); } catch (e) { console.error(`[RouterFrontDoor] state: ${e}`); }

  const ctx = [
    routerLine(d),
    `ROUTE: lane=${d.lane} agent=${d.agent ?? "—"} model=${d.model} tier=${d.tier} effort=${d.effort} strategy=${d.strategy} class=${d.dataClass} I=${d.intelligence.toFixed(2)} T=${d.tokens.toFixed(2)}`,
    directive(d),
  ].filter(Boolean).join("\n");

  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: ctx } }));
}

if (import.meta.main) {
  main().catch((e) => console.error(`[RouterFrontDoor] ${e?.message ?? e}`)).finally(() => process.exit(0));
}
