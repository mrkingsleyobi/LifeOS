#!/usr/bin/env bun
/**
 * @version 1.0.0
 * TRIGGER: UserPromptSubmit
 * RouterShadow — runs the lane Router on every prompt and LOGS the decision. In `shadow` mode (the default,
 * lanes.json "mode") it emits nothing on stdout and changes nothing. In `advise` mode it also injects ONE line of
 * advice into the session (built only from fixed strings; nothing from the prompt is echoed) and the session decides
 * whether to dispatch the lane agent; a hook cannot change the main-loop model. The log
 * (MEMORY/OBSERVABILITY/router-shadow.jsonl) holds a short prompt hash and sizes, never the text (a short or common prompt can be guessed from its hash).
 *
 * Why shadow: a UserPromptSubmit hook cannot set the main loop's model, and the Jev wire format
 * has not yet been exercised live. Compare `bun LIFEOS/ROUTER/Router.ts audit` against what you
 * actually ran before anything enforces.
 *
 * Failure mode: any error exits 0 silently — never blocks a prompt. Network is bounded by
 * lanes.json jev.timeoutMs; the privacy gate runs before any network call.
 */
import { homedir } from "node:os";
import { join } from "node:path";

const LIFEOS_DIR = process.env.LIFEOS_DIR || join(process.env.HOME ?? homedir(), ".claude", "LIFEOS");

async function readStdin(timeoutMs = 300): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    const t = setTimeout(() => resolve(data), timeoutMs);
    process.stdin.on("data", (c: Buffer) => { data += c.toString(); });
    process.stdin.on("end", () => { clearTimeout(t); resolve(data); });
    process.stdin.on("error", () => { clearTimeout(t); resolve(data); });
  });
}

try {
  const input = JSON.parse((await readStdin()) || "{}") as { prompt?: string; session_id?: string };
  const prompt = (input.prompt ?? "").trim();
  // Skip slash commands, acknowledgements, and harness-injected text.
  if (prompt.length >= 3 && !prompt.startsWith("/") && !/^<(task-notification|system-reminder|wake)/.test(prompt)) {
    const { resolve, logShadow } = await import(join(LIFEOS_DIR, "ROUTER", "Router.ts"));
    const decision = await resolve(prompt);
    logShadow(prompt, decision, input.session_id);
    const { loadConfig } = await import(join(LIFEOS_DIR, "ROUTER", "Config.ts"));
    if (loadConfig().mode === "advise") {
      const { advice } = await import(join(LIFEOS_DIR, "ROUTER", "Advice.ts"));
      process.stdout.write(`<router-advice>\n${advice(decision)}\n</router-advice>\n`);
    }
  }
} catch { /* shadow only — never block */ }
process.exit(0);
