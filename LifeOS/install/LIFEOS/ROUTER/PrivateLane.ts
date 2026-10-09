#!/usr/bin/env bun
/**
 * PRIVATE PINNED LANE — sensitive work runs on a local llama.cpp server and
 * can never leave the box.
 *
 * Contract (enforced here, not just documented):
 *   • the endpoint MUST resolve to loopback (127.0.0.0/8, ::1, localhost) or a
 *     unix-domain socket path — anything else is refused before a byte is sent
 *   • no cloud fallback, ever: if llama-server is down, the call fails loudly
 *   • the prompt is not logged; the ledger records only lane, model, latency
 *
 * Start the server (example — any GGUF works; Qwen3.8-27B is the default pin):
 *   llama-server -m ~/models/Qwen3.8-27B-Q5_K_M.gguf --host 127.0.0.1 --port 8080 -c 32768 --jinja
 *
 * CLI:
 *   bun PrivateLane.ts health
 *   echo "<prompt>" | bun PrivateLane.ts run [--system "<sys>"] [--max-tokens 2048]
 *                                            [--file <path>]… [--out <path>]
 *
 * --file  the LOCAL process reads the file and appends it to the prompt, so the
 *         caller (a cloud agent) never has to open sensitive content itself.
 * --out   write the answer to a local file and print only the path — the answer
 *         stays on the box too.
 */

import { readFileSync, writeFileSync } from "fs";

import { PRIVATE_LANE } from "../TOOLS/models";

export const laneUrl = () => (process.env.LIFEOS_PRIVATE_LANE_URL || PRIVATE_LANE.url).replace(/\/+$/, "");
export const laneModel = () => process.env.LIFEOS_PRIVATE_LANE_MODEL || PRIVATE_LANE.model;

export function isLoopback(url: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^\[|\]$/g, "");
    return h === "localhost" || h === "::1" || /^127\.\d+\.\d+\.\d+$/.test(h);
  } catch { return false; }
}

function assertLocal() {
  if (!isLoopback(laneUrl())) throw new Error(`PRIVATE LANE REFUSED: ${laneUrl()} is not loopback — sensitive data never leaves the box`);
}

export async function health(): Promise<{ ok: boolean; model?: string; detail?: string }> {
  assertLocal();
  try {
    const r = await fetch(`${laneUrl()}/v1/models`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return { ok: false, detail: `HTTP ${r.status}` };
    const j: any = await r.json();
    return { ok: true, model: j?.data?.[0]?.id ?? laneModel() };
  } catch (e: any) {
    return { ok: false, detail: `llama-server unreachable at ${laneUrl()} (${e?.message ?? e})` };
  }
}

export async function complete(prompt: string, opts: { system?: string; maxTokens?: number; timeoutMs?: number } = {}): Promise<string> {
  assertLocal();
  const messages = [
    ...(opts.system ? [{ role: "system", content: opts.system }] : []),
    { role: "user", content: prompt },
  ];
  const r = await fetch(`${laneUrl()}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: laneModel(), messages, max_tokens: opts.maxTokens ?? 2048, temperature: 0.2, stream: false }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 600_000),
  });
  if (!r.ok) throw new Error(`private lane HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j: any = await r.json();
  return j?.choices?.[0]?.message?.content ?? "";
}

if (import.meta.main) {
  const [cmd] = process.argv.slice(2);
  const flag = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
  try {
    if (cmd === "health") {
      const h = await health();
      console.log(JSON.stringify({ url: laneUrl(), ...h }));
      process.exit(h.ok ? 0 : 1);
    } else if (cmd === "run") {
      let prompt = (await new Response(Bun.stdin.stream()).text()).trim();
      const files = process.argv.flatMap((a: string, i: number) => (a === "--file" ? [process.argv[i + 1]] : []));
      for (const f of files) prompt += `\n\n--- FILE: ${f} ---\n${readFileSync(f, "utf-8")}`;
      if (!prompt) { console.error("prompt on stdin (or --file) required"); process.exit(2); }
      const answer = await complete(prompt, { system: flag("--system"), maxTokens: Number(flag("--max-tokens") ?? 2048) });
      const out = flag("--out");
      if (out) { writeFileSync(out, answer + "\n", { mode: 0o600 }); console.log(`written: ${out} (${answer.length} chars, stayed on this machine)`); }
      else process.stdout.write(answer + "\n");
    } else {
      console.error("usage: PrivateLane.ts health | run [--system s] [--max-tokens n] < prompt");
      process.exit(2);
    }
  } catch (e: any) {
    console.error(String(e?.message ?? e));
    process.exit(1);
  }
}
