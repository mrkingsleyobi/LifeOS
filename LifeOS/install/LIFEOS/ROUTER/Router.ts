#!/usr/bin/env bun
/**
 * Router — decides which lane (model) and effort a prompt deserves.
 *   bun Router.ts resolve "<prompt>"   → decision JSON (also appends to the shadow log)
 *   bun Router.ts lanes                → the ladder with resolved models
 *   bun Router.ts status               → mode, Jev configured?, log size
 *   bun Router.ts audit                → lane/source/private counts from the shadow log
 *
 * Order: privacy gate (deterministic, nothing leaves the box) → Jev (redacted prompt) →
 * heuristic fallback → Policy. SHADOW MODE: the decision is logged, never enforced. A hook cannot
 * set the main loop's model, so enforcement is dispatch-time only (see README.md).
 * The log stores a hash and sizes, never the prompt text.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { LANES, laneModel } from "../TOOLS/models";
import { askJev, jevConfigured } from "./Jev";
import { loadConfig, hashPrompt } from "./Config";
import { decide, heuristicProbs, jevEgressOn, privacyGate, privateDecision, redact, type Decision } from "./Policy";

const HOME = process.env.HOME ?? homedir();
const LIFEOS_DIR = process.env.LIFEOS_DIR || join(HOME, ".claude", "LIFEOS");
export const SHADOW_LOG = join(LIFEOS_DIR, "MEMORY", "OBSERVABILITY", "router-shadow.jsonl");
const DEPTH = /\b(think (deeply|hard)|ultrathink|deep(ly)? analy[sz]e)\b/i;

async function viaWorker(prompt: string, timeoutMs: number): Promise<Decision | null> {
  const url = process.env.ROUTER_WORKER_URL, token = process.env.ROUTER_WORKER_TOKEN;
  if (!url || !token) return null;
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/route`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok ? ((await res.json()) as Decision) : null;
  } catch { return null; }
}

export async function resolve(prompt: string): Promise<Decision & { latencyMs: number }> {
  const t0 = Date.now();
  const cfg = loadConfig();
  const facts = { chars: prompt.length, depthWords: DEPTH.test(prompt) };
  const gate = privacyGate(prompt);
  const d: Decision = gate
    ? privateDecision(gate, cfg)
    : await (async () => {
        // Optional cloud edge (worker/): keeps the Jev key off this machine. Reached ONLY after the
        // local privacy gate above passed. Any failure falls through to direct Jev, then heuristic.
        const edge = await viaWorker(prompt, cfg.jev.timeoutMs + 500);
        if (edge) return edge;
        // Direct third-party egress needs explicit consent (ROUTER_JEV_EGRESS=on or lanes.json jev.egress). Reaching the
        // Worker above is its own explicit opt-in (ROUTER_WORKER_URL), so it is not gated here.
        const jev = jevEgressOn(cfg, process.env.ROUTER_JEV_EGRESS) ? await askJev(redact(prompt), cfg.jev.timeoutMs) : null;
        return decide(jev ?? heuristicProbs(prompt, facts), facts, jev ? "jev" : "heuristic", cfg);
      })();
  return { ...d, latencyMs: Date.now() - t0 };
}

export function logShadow(prompt: string, d: Decision & { latencyMs: number }, session?: string) {
  mkdirSync(dirname(SHADOW_LOG), { recursive: true });
  appendFileSync(SHADOW_LOG, JSON.stringify({ ts: new Date().toISOString(), session, h: hashPrompt(prompt), chars: prompt.length, ...d }) + "\n");
}

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "resolve" && rest.length) {
    const prompt = rest.join(" ");
    const d = await resolve(prompt);
    logShadow(prompt, d);
    console.log(JSON.stringify({ ...d, model: laneModel(d.lane) }, null, 2));
  } else if (cmd === "lanes") {
    for (const [k, l] of Object.entries(LANES)) console.log(`${String(l.rank).padStart(2)}  ${k.padEnd(6)} ${l.vendor.padEnd(9)} ${laneModel(k)}`);
  } else if (cmd === "status") {
    const n = existsSync(SHADOW_LOG) ? readFileSync(SHADOW_LOG, "utf-8").split("\n").filter(Boolean).length : 0;
    console.log(JSON.stringify({ mode: loadConfig().mode, jevConfigured: jevConfigured(), jevEgress: jevEgressOn(loadConfig(), process.env.ROUTER_JEV_EGRESS), shadowLog: SHADOW_LOG, decisions: n }, null, 2));
  } else if (cmd === "audit") {
    const rows = existsSync(SHADOW_LOG) ? readFileSync(SHADOW_LOG, "utf-8").split("\n").filter(Boolean).map(l => JSON.parse(l)) : [];
    const by = (k: string) => rows.reduce((a: Record<string, number>, r) => ((a[r[k]] = (a[r[k]] ?? 0) + 1), a), {});
    console.log(JSON.stringify({ total: rows.length, lane: by("lane"), source: by("source"), effort: by("effort"), private: rows.filter(r => r.private).length }, null, 2));
  } else { console.error("usage: Router.ts resolve <prompt> | lanes | status | audit"); process.exit(2); }
}
