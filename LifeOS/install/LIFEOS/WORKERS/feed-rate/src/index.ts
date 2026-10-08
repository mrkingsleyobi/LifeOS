/**
 * arbol-a-feed-rate — Feed stage 3 (rate): unrated items in D1 → model → append-only ratings.
 *
 *   scheduled()   cron → rate a bounded batch of unrated items (newest first)
 *   POST /rate    Authorization: Bearer $RATE_TOKEN   (rate a batch now)
 *   GET  /rated?since=<ms>&limit=<n>   Bearer   → items in feed-route's input shape
 *   GET  /healthz
 *
 * Feed text is untrusted and ratings drive notifications, so: strict output validation, a fixed
 * label taxonomy, and an injection cap (see rate.ts). Bounded work per tick; items that keep
 * failing are skipped after 3 attempts. Delivery is NOT here — feed-route decides, a dispatcher delivers.
 */
import { authorized, json } from "../../_shared/arbol";
import { callModel, type ProviderEnv } from "./provider";
import { applyInjectionCap, buildUserPrompt, extractJson, looksInjected, SYSTEM_PROMPT, validateRating, type ItemInput } from "./rate";

interface Stmt { bind(...v: unknown[]): Stmt; run(): Promise<{ meta: { changes: number } }>; all<T = any>(): Promise<{ results: T[] }> }
export interface Env extends ProviderEnv { RATE_TOKEN: string; DB: { prepare(sql: string): Stmt } }
interface Pending extends ItemInput { id: string }

export const BATCH = 10, MAX_ATTEMPTS = 3, RUBRIC_VERSION = 1;

export async function rateBatch(env: Env, nowMs = Date.now(), fetchFn: typeof fetch = fetch) {
  const summary = { rated: 0, flagged: 0, failed: 0, skipped: 0, error: undefined as string | undefined };
  if (!env.RATER_MODEL || !env.RATER_API_KEY) return { ...summary, error: "rater not configured" };

  const { results } = await env.DB.prepare(
    `SELECT i.id, i.title, i.url, i.author, i.published_at, i.summary FROM items i
     LEFT JOIN ratings r ON r.item_id = i.id AND r.version = ?
     LEFT JOIN rate_failures f ON f.item_id = i.id
     WHERE r.item_id IS NULL AND COALESCE(f.count, 0) < ? ORDER BY i.fetched_at DESC LIMIT ?`,
  ).bind(RUBRIC_VERSION, MAX_ATTEMPTS, BATCH).all<Pending>();

  await Promise.all(results.map(async (item) => {
    // Provider trouble (timeout, 429, 5xx, bad key) is not the item's fault: retry next tick without counting it
    // toward the poison-item cap. Only unusable model OUTPUT counts.
    let text: string;
    try { text = await callModel(env, SYSTEM_PROMPT, buildUserPrompt(item), fetchFn); } catch { summary.failed++; return; }
    try {
      const valid = validateRating(extractJson(text));
      if (!valid) throw new Error("invalid rating output");
      const flagged = looksInjected(item);
      const r = flagged ? applyInjectionCap(valid) : { ...valid, flagged: false };
      await env.DB.prepare(
        `INSERT OR IGNORE INTO ratings (item_id, version, summary_short, summary_medium, tier, quality_score, importance, novelty, urgency, labels, flagged, model, rated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(item.id, RUBRIC_VERSION, r.summary_short, r.summary_medium, r.tier, r.quality_score, r.importance, r.novelty, r.urgency, JSON.stringify(r.labels), r.flagged ? 1 : 0, env.RATER_MODEL, nowMs).run();
      summary.rated++;
      if (r.flagged) summary.flagged++;
    } catch (e) {
      summary.failed++;
      try {
        await env.DB.prepare(
          "INSERT INTO rate_failures (item_id, count, last_error, last_at) VALUES (?, 1, ?, ?) ON CONFLICT(item_id) DO UPDATE SET count = count + 1, last_error = excluded.last_error, last_at = excluded.last_at",
        ).bind(item.id, String((e as Error).message).slice(0, 200), nowMs).run();
      } catch { /* failure bookkeeping must never break the batch */ }
    }
  }));
  return summary;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/healthz") return json({ ok: true, configured: !!(env.RATER_MODEL && env.RATER_API_KEY) });
    const isRate = req.method === "POST" && url.pathname === "/rate", isRated = req.method === "GET" && url.pathname === "/rated";
    if (!isRate && !isRated) return json({ error: "not found" }, 404);
    if (!authorized(req, env.RATE_TOKEN)) return json({ error: "unauthorized" }, 401);
    if (isRate) return json(await rateBatch(env));

    // Keyset cursor (rated_at, item_id): a whole batch shares one rated_at, so rated_at alone would skip rows at a page edge.
    const since = Number(url.searchParams.get("since") ?? 0) || 0, sinceId = url.searchParams.get("since_id"); // without since_id the old strict `rated_at > since` meaning is kept
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100) || 100, 1), 200);
    const { results } = await env.DB.prepare(
      `SELECT r.item_id AS id, r.tier, r.quality_score, r.importance, r.novelty, r.urgency, r.labels, r.flagged, r.rated_at, i.title, i.url
       FROM ratings r JOIN items i ON i.id = r.item_id
       WHERE r.version = ? AND (r.rated_at > ? OR (? IS NOT NULL AND r.rated_at = ? AND r.item_id > ?)) ORDER BY r.rated_at, r.item_id LIMIT ?`,
    ).bind(RUBRIC_VERSION, since, sinceId, since, sinceId ?? "", limit).all<any>();
    const last = results.at(-1);
    return json({ items: results.map((x) => ({ ...x, labels: JSON.parse(x.labels), flagged: !!x.flagged })), next: last ? { since: last.rated_at, since_id: last.id } : null });
  },

  async scheduled(_e: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    ctx.waitUntil(rateBatch(env).then(() => undefined));
  },
};
