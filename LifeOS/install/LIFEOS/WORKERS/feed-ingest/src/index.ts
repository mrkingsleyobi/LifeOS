/**
 * arbol-a-feed-ingest — the Feed poller: sources in D1, cron-driven, items out.
 *
 *   POST /sources  Authorization: Bearer $INGEST_TOKEN   { "url": "https://…", "name"?, "interval_min"? }
 *   POST /poll     Authorization: Bearer $INGEST_TOKEN   (poll due sources now)
 *   GET  /healthz
 *   scheduled()    cron trigger → same as POST /poll
 *
 * Ingest only. Summarize/rate/deliver are separate stages (feed-route consumes rated items).
 * Fetch tiers: direct first; on 401/403/429/503 or an empty body, optional READER_PROXY_URL then
 * SELF_PROXY_URL (https templates containing {url}; bearer PROXY_AUTH_TOKEN sent to proxies only).
 */
import { authorized, json, readJson, sha256Hex } from "../../_shared/arbol";
import { nextState } from "./breaker";
import { pollWithTiers, tiersFromEnv } from "./poll";
import { validateFeedUrl } from "./safe";

interface Stmt { bind(...v: unknown[]): Stmt; run(): Promise<{ meta: { changes: number } }>; all<T = any>(): Promise<{ results: T[] }> }
export interface Env { INGEST_TOKEN: string; READER_PROXY_URL?: string; SELF_PROXY_URL?: string; PROXY_AUTH_TOKEN?: string; DB: { prepare(sql: string): Stmt } }
interface Source { id: number; url: string; interval_min: number; error_count: number }

const BATCH = 10;
const MIN_INTERVAL = 15, MAX_INTERVAL = 24 * 60;

export async function pollDue(env: Env, nowMs = Date.now(), fetchFn: typeof fetch = fetch) {
  const { results } = await env.DB.prepare(
    "SELECT id, url, interval_min, error_count FROM sources WHERE disabled = 0 AND next_poll_at <= ? ORDER BY next_poll_at LIMIT ?",
  ).bind(nowMs, BATCH).all<Source>();

  const tiers = tiersFromEnv(env);
  const summary = { polled: 0, newItems: 0, failed: 0, disabled: 0 };
  await Promise.all(results.map(async (src) => {
    try {
      const { outcome, items, via } = await pollWithTiers(src.url, tiers, fetchFn);
      for (const it of items) {
        const id = (await sha256Hex(`${src.id}\n${it.guid}`)).slice(0, 32);
        const r = await env.DB.prepare(
          "INSERT OR IGNORE INTO items (id, source_id, guid, url, title, author, published_at, summary, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(id, src.id, it.guid, it.url ?? null, it.title ?? null, it.author ?? null, it.published ?? null, it.summary ?? null, nowMs).run();
        summary.newItems += r.meta.changes;
      }
      const n = nextState(src, outcome, nowMs, via);
      await env.DB.prepare("UPDATE sources SET error_count = ?, disabled = ?, next_poll_at = ?, last_status = ?, last_polled_at = ? WHERE id = ?")
        .bind(n.error_count, n.disabled, n.next_poll_at, n.last_status, nowMs, src.id).run();
      summary.polled++;
      if (outcome !== "ok") summary.failed++;
      if (n.disabled) summary.disabled++;
    } catch { summary.failed++; } // one bad source must never stop the batch
  }));
  return summary;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (req.method === "GET" && pathname === "/healthz") return json({ ok: true });
    if (req.method !== "POST" || (pathname !== "/sources" && pathname !== "/poll")) return json({ error: "not found" }, 404);
    if (!authorized(req, env.INGEST_TOKEN)) return json({ error: "unauthorized" }, 401);

    if (pathname === "/poll") return json(await pollDue(env));

    const body = await readJson(req, 4096);
    if (body instanceof Response) return body;
    const url = typeof body.url === "string" ? validateFeedUrl(body.url) : null;
    if (!url) return json({ error: "url must be a public https feed URL (no credentials, IPs, ports, or internal hosts)" }, 400);
    const interval = Number.isInteger(body.interval_min) ? Math.min(Math.max(body.interval_min as number, MIN_INTERVAL), MAX_INTERVAL) : 60;
    const name = typeof body.name === "string" ? body.name.slice(0, 200) : null;
    const r = await env.DB.prepare("INSERT OR IGNORE INTO sources (url, name, interval_min) VALUES (?, ?, ?)").bind(url, name, interval).run();
    return json({ url, added: r.meta.changes > 0 }, r.meta.changes > 0 ? 201 : 200);
  },

  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    ctx.waitUntil(pollDue(env).then(() => undefined));
  },
};
