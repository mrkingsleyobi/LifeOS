/**
 * arbol-a-feed-dispatch — the glue: rated items → feed-route rules → delivery.
 *
 *   cron every 10 min   dispatch: route newly rated items; send immediate alerts; queue digest items
 *   cron 08:00 daily    daily digest        cron 08:00 Mondays   weekly digest
 *   POST /dispatch   Authorization: Bearer $DISPATCH_TOKEN   (run a dispatch tick now)
 *   POST /digest?priority=daily|weekly   same auth   (send that digest now)
 *   GET  /healthz
 *
 * Decides nothing itself: routing is feed-route's rules.json, imported as code (no HTTP hop).
 * Idempotent per (item, destination). blog-draft / social-post become review-only DRAFTS when DRAFT_MODEL +
 * DRAFT_API_KEY are set (nothing is ever published); otherwise, and for anything else it cannot deliver, it is recorded
 * as `unsupported`, never silently dropped. Safety valves: flagged (injection-capped) items are
 * suppressed, items rated >24h ago are skipped (a backlog must not become an alert flood), and at
 * most MAX_IMMEDIATE alerts go out per tick with one overflow summary.
 */
import rules from "../../feed-route/rules.json";
import { route, type RuleSet } from "../../feed-route/src/rules";
import { authorized, json } from "../../_shared/arbol";
import { draftsEnabled, formatDraft, makeDraft, type DraftEnv, type DraftKind } from "./draft";
import { channels, formatAlert, formatDigest, send, type AlertItem, type DeliverEnv } from "./deliver";

interface Stmt { bind(...v: unknown[]): Stmt; run(): Promise<{ meta: { changes: number } }>; all<T = any>(): Promise<{ results: T[] }> }
export interface Env extends DeliverEnv, DraftEnv { DISPATCH_TOKEN: string; DB: { prepare(sql: string): Stmt } }

export const MAX_IMMEDIATE = 5, BATCH = 50, STALE_MS = 24 * 3_600_000, MAX_ATTEMPTS = 3, DIGEST_MAX = 50, MAX_DRAFTS = 3, PENDING_STUCK_MS = 15 * 60_000; // a "pending" alert this old lost its worker mid-send

interface Rated extends Omit<AlertItem, "labels"> { rated_at: number; flagged: number; labels: string; importance: number; novelty: number; urgency: number }

const upsert = (env: Env, id: string, dest: string, priority: string, status: string, now: number, error?: string) =>
  env.DB.prepare("INSERT OR IGNORE INTO deliveries (item_id, destination, priority, status, attempts, last_error, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)")
    .bind(id, dest, priority, status, error ?? null, now).run();

export async function dispatchTick(env: Env, now = Date.now(), fetchFn: typeof fetch = fetch) {
  const out = { routed: 0, drafted: 0, sent: 0, queued: 0, unsupported: 0, suppressed: 0, stale: 0, failed: 0, retried: 0, error: undefined as string | undefined };
  if (!channels(env).length) return { ...out, error: "no delivery channel configured" }; // consume nothing: items wait

  // 1. Retry earlier failed alerts (bounded attempts, last 24h).
  const failed = await env.DB.prepare(
    `SELECT d.item_id AS id, i.title, i.url, r.tier, r.summary_short, r.labels FROM deliveries d JOIN items i ON i.id = d.item_id JOIN ratings r ON r.item_id = d.item_id
     WHERE d.destination = 'notify' AND (d.status = 'failed' OR (d.status = 'pending' AND d.created_at < ?)) AND d.attempts < ? AND d.created_at > ? LIMIT ?`,
  ).bind(now - PENDING_STUCK_MS, MAX_ATTEMPTS, now - STALE_MS, MAX_IMMEDIATE).all<any>();
  for (const f of failed.results) {
    const r = await send(env, formatAlert({ ...f, labels: JSON.parse(f.labels) }), fetchFn);
    await env.DB.prepare("UPDATE deliveries SET status = ?, attempts = attempts + 1, last_error = ?, sent_at = ? WHERE item_id = ? AND destination = 'notify'")
      .bind(r.ok ? "sent" : "failed", r.error ?? null, r.ok ? now : null, f.id).run();
    out.retried++; if (r.ok) out.sent++;
  }

  // 2. Route newly rated items (those with no delivery row yet), oldest first.
  const { results } = await env.DB.prepare(
    `SELECT r.item_id AS id, r.tier, r.quality_score, r.importance, r.novelty, r.urgency, r.labels, r.flagged, r.rated_at, r.summary_short, i.title, i.url
     FROM ratings r JOIN items i ON i.id = r.item_id
     WHERE NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.item_id = r.item_id) ORDER BY r.rated_at LIMIT ?`,
  ).bind(BATCH).all<Rated>();

  const alerts: { it: Rated; labels: string[] }[] = [];
  for (const it of results) {
    out.routed++;
    if (it.flagged) { await upsert(env, it.id, "*", "archive", "suppressed", now, "injection heuristic fired"); out.suppressed++; continue; }
    if (now - it.rated_at > STALE_MS) { await upsert(env, it.id, "stale", "archive", "skipped", now, "rated >24h ago"); out.stale++; continue; }
    const labels: string[] = JSON.parse(it.labels);
    const rt = route({ id: it.id, tier: it.tier, quality_score: it.quality_score, importance: it.importance, novelty: it.novelty, urgency: it.urgency, labels }, rules as RuleSet);
    for (const dest of rt.destinations) {
      if (dest === "archive") await upsert(env, it.id, dest, rt.priority, "archived", now);
      else if (dest === "digest" || (dest === "notify" && rt.priority !== "immediate")) { await upsert(env, it.id, dest === "notify" ? "digest" : dest, rt.priority, "queued", now); out.queued++; }
      // Only the run that actually inserts the row may send: a concurrent run (cron overlap, manual POST /dispatch)
      // loses the INSERT OR IGNORE race and must not send a duplicate alert.
      else if (dest === "notify") { if ((await upsert(env, it.id, dest, rt.priority, "pending", now)).meta.changes > 0) alerts.push({ it, labels }); }
      else if ((dest === "blog-draft" || dest === "social-post") && draftsEnabled(env)) { await upsert(env, it.id, dest, rt.priority, "queued", now); out.queued++; }
      else { await upsert(env, it.id, dest, rt.priority, "unsupported", now, "no delivery adapter for this destination"); out.unsupported++; }
    }
  }

  // 3. Send immediate alerts: cap per tick, one overflow summary for the rest.
  for (const { it, labels } of alerts.slice(0, MAX_IMMEDIATE)) {
    const r = await send(env, formatAlert({ ...it, labels }), fetchFn);
    await env.DB.prepare("UPDATE deliveries SET status = ?, attempts = 1, last_error = ?, sent_at = ? WHERE item_id = ? AND destination = 'notify'")
      .bind(r.ok ? "sent" : "failed", r.error ?? null, r.ok ? now : null, it.id).run();
    if (r.ok) out.sent++; else out.failed++;
  }
  const overflow = alerts.slice(MAX_IMMEDIATE);
  if (overflow.length) {
    const r = await send(env, formatDigest("alert overflow", overflow.map(({ it, labels }) => ({ ...it, labels }))), fetchFn);
    for (const { it } of overflow)
      await env.DB.prepare("UPDATE deliveries SET status = ?, attempts = 1, last_error = ?, sent_at = ? WHERE item_id = ? AND destination = 'notify'")
        .bind(r.ok ? "sent" : "failed", r.error ?? null, r.ok ? now : null, it.id).run();
    if (r.ok) out.sent += overflow.length; else out.failed += overflow.length;
  }

  // 4. Drafts (only when DRAFT_MODEL + DRAFT_API_KEY are set): a few per tick, sent for review, never published.
  if (draftsEnabled(env)) {
    const { results: q } = await env.DB.prepare(
      `SELECT d.item_id AS id, d.destination AS dest, d.attempts, i.title, i.url, r.summary_short, r.summary_medium, r.labels FROM deliveries d
       JOIN items i ON i.id = d.item_id JOIN ratings r ON r.item_id = d.item_id
       WHERE d.destination IN ('blog-draft','social-post') AND d.status = 'queued' AND d.created_at > ? ORDER BY d.created_at LIMIT ?`,
    ).bind(now - STALE_MS, MAX_DRAFTS).all<any>();
    for (const d of q) {
      const item = { ...d, labels: JSON.parse(d.labels) as string[] };
      let ok = false, error: string | undefined;
      try {
        const r = await send(env, formatDraft(d.dest as DraftKind, item, await makeDraft(env, d.dest as DraftKind, item, fetchFn)), fetchFn);
        ok = r.ok; error = r.error;
      } catch (e: any) { error = String(e?.message ?? e).slice(0, 200); }
      const attempts = d.attempts + 1;
      const status = ok ? "sent" : attempts >= MAX_ATTEMPTS ? "failed" : "queued"; // retry next tick until the attempt cap
      await env.DB.prepare("UPDATE deliveries SET status = ?, attempts = ?, last_error = ?, sent_at = ? WHERE item_id = ? AND destination = ?")
        .bind(status, attempts, error ?? null, ok ? now : null, d.id, d.dest).run();
      if (ok) out.drafted++; else out.failed++;
    }
  }
  return out;
}

export async function sendDigest(env: Env, priority: "daily" | "weekly", now = Date.now(), fetchFn: typeof fetch = fetch) {
  if (!channels(env).length) return { sent: 0, error: "no delivery channel configured" };
  const { results } = await env.DB.prepare(
    `SELECT d.item_id AS id, i.title, i.url, r.tier, r.summary_short, r.quality_score FROM deliveries d
     JOIN items i ON i.id = d.item_id JOIN ratings r ON r.item_id = d.item_id
     WHERE d.destination = 'digest' AND d.status = 'queued' AND d.priority = ? ORDER BY r.quality_score DESC LIMIT ?`,
  ).bind(priority, DIGEST_MAX).all<AlertItem>();
  if (!results.length) return { sent: 0 };
  const r = await send(env, formatDigest(priority, results), fetchFn);
  if (r.ok) for (const it of results)
    await env.DB.prepare("UPDATE deliveries SET status = 'sent', sent_at = ?, attempts = attempts + 1 WHERE item_id = ? AND destination = 'digest'").bind(now, it.id).run();
  return { sent: r.ok ? results.length : 0, error: r.error };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (req.method === "GET" && pathname === "/healthz") return json({ ok: true, channels: channels(env) });
    if (req.method !== "POST" || (pathname !== "/dispatch" && pathname !== "/digest")) return json({ error: "not found" }, 404);
    if (!authorized(req, env.DISPATCH_TOKEN)) return json({ error: "unauthorized" }, 401);
    if (pathname === "/digest") {
      // On-demand digest (the crons still send them at 08:00 UTC): POST /digest?priority=daily|weekly
      const priority = new URL(req.url).searchParams.get("priority");
      if (priority !== "daily" && priority !== "weekly") return json({ error: "priority must be daily or weekly" }, 400);
      return json(await sendDigest(env, priority));
    }
    return json(await dispatchTick(env));
  },

  async scheduled(event: { cron: string }, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    const job = event.cron === "0 8 * * *" ? sendDigest(env, "daily") : event.cron === "0 8 * * 1" ? sendDigest(env, "weekly") : dispatchTick(env);
    ctx.waitUntil(job.then(() => undefined));
  },
};
