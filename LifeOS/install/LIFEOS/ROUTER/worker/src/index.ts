/**
 * arbol-a-router-decide — the router's cloud edge. Keeps the Jev key off the laptop.
 *
 *   POST /route   Authorization: Bearer $ROUTER_TOKEN   { "prompt": "...", "session"?: "..." }
 *   GET  /healthz
 *
 * Reuses the same pure Policy + JevCore as the local CLI, so a decision made here and one made
 * locally cannot drift. Stateless: no storage, and the prompt is NEVER logged (hash + sizes only).
 *
 * PRIVACY CONTRACT: clients must run the privacy gate locally BEFORE calling this Worker — a
 * prompt that hits the gate should never leave the machine. The Worker re-runs the gate as a
 * second line of defense, but by then the text has already been transmitted.
 */
import cfg from "../../lanes.json";
import { decide, heuristicProbs, privacyGate, privateDecision, redact, type LanesConfig } from "../../Policy";
import { DEFAULT_BASE, evaluate } from "../../JevCore";

export interface Env { ROUTER_TOKEN: string; TYPESAFE_API_KEY?: string; AI_GATEWAY_API_KEY?: string; JEV_BASE_URL?: string }

const MAX_BODY = 32 * 1024;
const DEPTH = /\b(think (deeply|hard)|ultrathink|deep(ly)? analy[sz]e)\b/i;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Constant-time compare so the token check does not leak length/prefix via timing. */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

async function sha12(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/healthz") return json({ ok: true, mode: (cfg as LanesConfig).mode });
    if (req.method !== "POST" || url.pathname !== "/route") return json({ error: "not found" }, 404);

    const auth = req.headers.get("Authorization") ?? "";
    if (!env.ROUTER_TOKEN || !safeEqual(auth, `Bearer ${env.ROUTER_TOKEN}`)) return json({ error: "unauthorized" }, 401);

    const raw = await req.text();
    if (raw.length > MAX_BODY) return json({ error: "payload too large" }, 413);
    let body: { prompt?: unknown; session?: unknown };
    try { body = JSON.parse(raw); } catch { return json({ error: "invalid json" }, 400); }
    if (typeof body.prompt !== "string" || !body.prompt.trim()) return json({ error: "prompt required" }, 400);

    const t0 = Date.now();
    const prompt = body.prompt;
    const c = cfg as LanesConfig;
    const facts = { chars: prompt.length, depthWords: DEPTH.test(prompt) };
    const gate = privacyGate(prompt);
    let decision;
    if (gate) {
      decision = privateDecision(gate, c);
    } else {
      const flavor = env.TYPESAFE_API_KEY ? "native" : "gateway";
      const key = env.TYPESAFE_API_KEY ?? env.AI_GATEWAY_API_KEY;
      const probs = key ? await evaluate(key, env.JEV_BASE_URL ?? DEFAULT_BASE[flavor], redact(prompt), c.jev.timeoutMs, flavor) : null;
      decision = decide(probs ?? heuristicProbs(prompt, facts), facts, probs ? "jev" : "heuristic", c);
    }
    const out = { ...decision, latencyMs: Date.now() - t0 };
    console.log(JSON.stringify({ h: await sha12(prompt), chars: prompt.length, lane: out.lane, source: out.source, private: out.private, ms: out.latencyMs }));
    return json(out);
  },
};
