/**
 * router-edge — the Router for every front door that isn't this laptop's
 * Claude Code session: Hermes, the phone, Codex/Pi front doors, Lockbox clients.
 *
 * Same decision core as the hook path (LIFEOS/ROUTER/Score.ts, bundled at
 * deploy), same Jev questions, same fallback heuristics, so a prompt routes
 * identically from any door. The Jev key lives here as a secret, never on the
 * client.
 *
 *   POST /route   { prompt, prevTail?, client?, quota? }  → RouteDecision + ROUTER line
 *   GET  /ledger?since=ISO&limit=100                      → decision rows (D1)
 *   PUT  /quota   { anthropic, openai, fable }            ← the laptop pushes exhaustion flags
 *
 * Auth: bearer ROUTER_TOKEN, or a Cloudflare Access identity (ACCESS_TEAM + ACCESS_AUD).
 * Privacy: RESTRICTED text never reaches Jev; a private-lane decision tells the
 * client to process on-device — the edge has no private lane by definition.
 */

import { accessJwt, bearer, err, json, jev } from "../../../shared/edge";
import { QUESTIONS, type Signals, type NoulId } from "../../../../ROUTER/LaneQuestions";
import { heuristicSignals } from "../../../../ROUTER/Heuristics";
import { ACK, dataClassOf, decideLane, finalize, routerLine, shouldSkip, type RouteDecision } from "../../../../ROUTER/Score";

interface Env {
  DB: D1Database;
  ROUTER_KV: KVNamespace;
  ROUTER_TOKEN: string;
  OPENROUTER_API_KEY?: string;
  TYPESAFE_API_KEY?: string;
  ACCESS_TEAM?: string;
  ACCESS_AUD?: string;
}

type Quota = { anthropic?: boolean; openai?: boolean; fable?: boolean };

async function authed(req: Request, env: Env): Promise<boolean> {
  return bearer(req, env.ROUTER_TOKEN) || !!(await accessJwt(req, env.ACCESS_TEAM, env.ACCESS_AUD));
}

async function route(env: Env, body: { prompt: string; prevTail?: string; client?: string; quota?: Quota }): Promise<RouteDecision | null> {
  const t0 = Date.now();
  const prompt = String(body.prompt ?? "");
  if (shouldSkip(prompt)) return null;
  const prevTail = String(body.prevTail ?? "").slice(-800);
  const dataClass = dataClassOf(prompt);
  const stored = (await env.ROUTER_KV.get<Quota>("quota", "json")) ?? {};
  const q = { ...stored, ...body.quota };
  const quota = (v: "anthropic" | "openai" | "fable") => !!q[v];

  if (ACK.test(prompt.trim())) return finalize(decideLane(heuristicSignals(prompt, prevTail), dataClass, { quota }), dataClass, "fast-path", "enforce", "do-not-act", Date.now() - t0);

  let s: Signals | null = null;
  let source: RouteDecision["source"] = "fallback";
  let jevModel: string | undefined;
  if (dataClass !== "RESTRICTED") {
    const r = await jev(env, { prompt, previous_reply_tail: prevTail }, QUESTIONS);
    if (r.ok) {
      const a = r.answers;
      const nouls = Object.fromEntries(Object.entries(a).filter(([k]) => k !== "domain").map(([k, v]) => [k, (v as { noul: number }).noul])) as Record<NoulId, number>;
      s = { ...nouls, domain: a.domain.choice, domainP: a.domain.probabilities?.[a.domain.choice] ?? a.domain.confidence ?? 0.5 };
      source = "jev"; jevModel = r.model;
    }
  }
  s ??= heuristicSignals(prompt, prevTail);
  if (dataClass === "RESTRICTED") s.sensitive = 1;
  const base = decideLane(s, dataClass, { quota });
  const verdict = base.sc.handoff >= 0.5 || base.lane === "private" ? "act" : "do-not-act";
  return finalize(base, dataClass, source, "enforce", verdict, Date.now() - t0, jevModel);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (!(await authed(req, env))) return err(401, "unauthorized");
    const url = new URL(req.url);

    if (req.method === "POST" && url.pathname === "/route") {
      const body = (await req.json()) as { prompt: string; prevTail?: string; client?: string; quota?: Quota };
      const d = await route(env, body);
      if (!d) return json({ skipped: true });
      // Ledger: decision metadata only — never the prompt text.
      await env.DB.prepare("INSERT INTO decisions (ts, client, lane, tier, effort, strategy, source, p, intelligence, tokens, data_class, latency_ms, jev_model) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(new Date().toISOString(), body.client ?? "unknown", d.lane, d.tier, d.effort, d.strategy, d.source, d.p, d.intelligence, d.tokens, d.dataClass, d.latencyMs, d.jevModel ?? null).run();
      const onDevice = d.lane === "private" ? "Process on-device only (private pinned lane). Do not send this content to any cloud model." : undefined;
      return json({ ...d, line: routerLine(d), onDevice });
    }

    if (req.method === "GET" && url.pathname === "/ledger") {
      const since = url.searchParams.get("since") ?? "1970-01-01";
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 1000);
      const { results } = await env.DB.prepare("SELECT * FROM decisions WHERE ts > ? ORDER BY ts DESC LIMIT ?").bind(since, limit).all();
      return json(results);
    }

    if (req.method === "PUT" && url.pathname === "/quota") {
      const q = (await req.json()) as Quota;
      await env.ROUTER_KV.put("quota", JSON.stringify({ anthropic: !!q.anthropic, openai: !!q.openai, fable: !!q.fable }), { expirationTtl: 3600 });
      return json({ ok: true });
    }

    return err(404, "not found");
  },
} satisfies ExportedHandler<Env>;
