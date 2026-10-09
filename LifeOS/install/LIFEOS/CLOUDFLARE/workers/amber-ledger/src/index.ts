/**
 * amber-ledger — Synapse's journal at the edge. Capture contract:
 * LIFEOS/DOCUMENTATION/Synapse/SynapseSystem.md § The Capture Contract.
 *
 *   POST /capture        write-ahead: the row exists before anything grades it.
 *                        Idempotent on dedup key → { id, duplicate }. The id is
 *                        the `source_amber_id` every downstream artifact carries.
 *   GET  /captures       ?limit&status&since → { captures: [...] }   (Pulse /synapse reads this)
 *   GET  /capture/:id
 *   GET  /stats          { total, by_source:[{source,n}], by_status:[{status,n}] }
 *   POST /grade          grade + route pending rows now (also runs on cron)
 *   POST /routed/:id     { actions: [...] } — the CLI reports what it executed
 *
 * Privacy gate: `personal` captures are refused here (they live in the local
 * ledger only). Auth: bearer AMBER_TOKEN for everything.
 */

import { bearer, err, json, jev } from "../../../shared/edge";
import { GRADE_VERSION, ROUTES, dedupKey, gradeQuestions, routedActions, scoreToPct, type Route } from "../../../../SYNAPSE/Grade";

interface Env { DB: D1Database; AMBER_KV: KVNamespace; AMBER_TOKEN: string; OPENROUTER_API_KEY?: string; TYPESAFE_API_KEY?: string }

interface CaptureIn {
  source: string; external_id: string; url?: string; content?: string; captured_at?: string;
  content_kind?: string; title?: string; author?: string; privacy_class?: "public" | "personal";
}

async function capture(env: Env, c: CaptureIn) {
  if (!c.source || !c.external_id) throw new Error("source and external_id are required");
  if (!c.url && !c.content) throw new Error("url or content is required");
  if (c.privacy_class === "personal") throw new Error("personal captures stay in the local ledger");
  const key = await dedupKey(c);
  const existing = await env.DB.prepare("SELECT id FROM captures WHERE dedup_key = ?").bind(key).first<{ id: string }>();
  if (existing) return { id: existing.id, duplicate: true };
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO captures (id, dedup_key, source, external_id, url, content, title, author, content_kind, privacy_class, captured_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
  ).bind(id, key, c.source, c.external_id, c.url ?? null, c.content?.slice(0, 200_000) ?? null, c.title ?? null, c.author ?? null, c.content_kind ?? "other", "public", c.captured_at ?? new Date().toISOString()).run();
  return { id, duplicate: false };
}

async function gradePending(env: Env, limit = 20) {
  const telos = (await env.AMBER_KV.get("telos:summary")) ?? "";
  const qs = gradeQuestions(telos);
  const { results } = await env.DB.prepare("SELECT id, url, content, title FROM captures WHERE status = 'captured' ORDER BY captured_at LIMIT ?").bind(limit).all<{ id: string; url: string | null; content: string | null; title: string | null }>();
  let graded = 0, failed = 0;
  for (const r of results) {
    let text = r.content ?? "";
    if (!text && r.url) {
      try { text = (await (await fetch(r.url, { signal: AbortSignal.timeout(10_000), headers: { "user-agent": "LifeOS-Synapse/1.0" } })).text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 60_000); }
      catch { text = r.title ?? r.url; }
    }
    const a = await jev(env, { content: `${r.title ? `${r.title}\n\n` : ""}${text}` }, qs);
    if (!a.ok) { failed++; if (a.reason !== "no-key") await env.DB.prepare("UPDATE captures SET status = 'grade_failed' WHERE id = ?").bind(r.id).run(); continue; }
    const score = scoreToPct(a.answers.relevance.score);
    const route = (ROUTES as readonly string[]).includes(a.answers.route.choice) ? (a.answers.route.choice as Route) : "none";
    const actions = routedActions(route, score);
    await env.DB.prepare("UPDATE captures SET status = 'graded', score = ?, route = ?, content_kind = CASE WHEN content_kind = 'other' THEN ? ELSE content_kind END, excerpt = ?, grade_version = ?, routed_actions = ? WHERE id = ?")
      .bind(score, route, a.answers.kind.choice ?? "other", text.slice(0, 280), GRADE_VERSION, JSON.stringify(actions), r.id).run();
    graded++;
  }
  return { graded, failed, pending: results.length - graded - failed };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (!bearer(req, env.AMBER_TOKEN)) return err(401, "unauthorized");
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (req.method === "POST" && p === "/capture") return json(await capture(env, (await req.json()) as CaptureIn), 201);
      if (req.method === "GET" && p === "/captures") {
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 500);
        const status = url.searchParams.get("status");
        const since = url.searchParams.get("since") ?? "1970-01-01";
        const q = status
          ? env.DB.prepare("SELECT id, source, external_id, url, title, author, content_kind, captured_at, status, score, route, excerpt, grade_version, routed_actions FROM captures WHERE status = ? AND captured_at > ? ORDER BY captured_at DESC LIMIT ?").bind(status, since, limit)
          : env.DB.prepare("SELECT id, source, external_id, url, title, author, content_kind, captured_at, status, score, route, excerpt, grade_version, routed_actions FROM captures WHERE captured_at > ? ORDER BY captured_at DESC LIMIT ?").bind(since, limit);
        return json({ captures: (await q.all()).results });
      }
      const one = p.match(/^\/capture\/([0-9a-f-]{36})$/);
      if (req.method === "GET" && one) {
        const r = await env.DB.prepare("SELECT * FROM captures WHERE id = ?").bind(one[1]).first();
        return r ? json(r) : err(404, "no such capture");
      }
      if (req.method === "GET" && p === "/stats") {
        const total = (await env.DB.prepare("SELECT COUNT(*) AS n FROM captures").first<{ n: number }>())?.n ?? 0;
        const by_source = (await env.DB.prepare("SELECT source, COUNT(*) AS n FROM captures GROUP BY source ORDER BY n DESC").all()).results;
        const by_status = (await env.DB.prepare("SELECT status, COUNT(*) AS n FROM captures GROUP BY status").all()).results;
        return json({ total, by_source, by_status });
      }
      if (req.method === "POST" && p === "/grade") return json(await gradePending(env, Number(url.searchParams.get("limit") ?? 20)));
      const routed = p.match(/^\/routed\/([0-9a-f-]{36})$/);
      if (req.method === "POST" && routed) {
        const { actions } = (await req.json()) as { actions: string[] };
        await env.DB.prepare("UPDATE captures SET status = 'routed', routed_actions = ? WHERE id = ?").bind(JSON.stringify(actions ?? []), routed[1]).run();
        return json({ ok: true });
      }
      if (req.method === "PUT" && p === "/telos") { await env.AMBER_KV.put("telos:summary", (await req.text()).slice(0, 8000)); return json({ ok: true }); }
    } catch (e) {
      return err(400, String((e as Error).message ?? e));
    }
    return err(404, "not found");
  },

  async scheduled(_ev: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(gradePending(env));
  },
} satisfies ExportedHandler<Env>;
