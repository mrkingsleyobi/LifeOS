/**
 * arbol-a-synapse-capture — one HTTP door into Synapse for inputs that cannot write the local
 * ledger: reader upvote (#9), gesture/wearable trigger (#10), and any webhook (Shortcuts, Zapier).
 * Email capture (#11) is NOT here: it needs MIME parsing and a sender allowlist (see README).
 *
 *   POST /capture  Authorization: Bearer $CAPTURE_TOKEN   <capture contract JSON>
 *   GET  /healthz
 *
 * Contract behavior: write-ahead (INSERT before anything else), idempotent (dedup key),
 * async downstream (queue send via waitUntil, never on the capture path), privacy-gated
 * (`personal` is refused — no explicit cloud rule exists, so it stays local).
 */
import { authorized, json, readJson } from "../../_shared/arbol";
import { dedupKey, validate } from "./contract";

interface D1Like { prepare(sql: string): { bind(...v: unknown[]): { run(): Promise<{ meta: { changes: number } }> } } }
export interface Env {
  CAPTURE_TOKEN: string;
  DB: D1Like;
  /** Optional: grade/route consumers subscribe to this. Absent = journal only. */
  GRADE_QUEUE?: { send(msg: unknown): Promise<void> };
}
interface Ctx { waitUntil(p: Promise<unknown>): void }

const MAX_BODY = 256 * 1024;

export default {
  async fetch(req: Request, env: Env, ctx: Ctx): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (req.method === "GET" && pathname === "/healthz") return json({ ok: true });
    if (req.method !== "POST" || pathname !== "/capture") return json({ error: "not found" }, 404);
    if (!authorized(req, env.CAPTURE_TOKEN)) return json({ error: "unauthorized" }, 401);

    const body = await readJson(req, MAX_BODY);
    if (body instanceof Response) return body;
    const v = validate(body);
    if (!v.ok) return json({ error: v.error }, 400);
    const c = v.capture;
    if (c.privacy_class === "personal") {
      return json({ error: "personal records are not accepted by the cloud ledger; keep them local" }, 403);
    }

    const id = (await dedupKey(c)).slice(0, 32);
    // WRITE-AHEAD: the row exists before any grader or router can see it. Append-only: ignore dupes, never update.
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO captures (id, source, external_id, url, content, content_kind, title, author, privacy_class, captured_at, ingested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, c.source, c.external_id, c.url ?? null, c.content ?? null, c.content_kind, c.title ?? null, c.author ?? null, c.privacy_class, c.captured_at, new Date().toISOString()).run();

    const inserted = res.meta.changes > 0;
    if (inserted && env.GRADE_QUEUE) ctx.waitUntil(env.GRADE_QUEUE.send({ id }).catch(() => {})); // best effort; the ledger row is the source of truth
    return json({ id, duplicate: !inserted }, inserted ? 201 : 200);
  },
};
