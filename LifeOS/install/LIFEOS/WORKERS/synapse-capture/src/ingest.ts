/** The one write path into the amber ledger — shared by HTTP capture and email capture. */
import { dedupKey, type Capture } from "./contract";

export interface D1Like { prepare(sql: string): { bind(...v: unknown[]): { run(): Promise<{ meta: { changes: number } }> } } }
export interface IngestEnv {
  DB: D1Like;
  /** Optional: grade/route consumers subscribe to this. Absent = journal only. */
  GRADE_QUEUE?: { send(msg: unknown): Promise<void> };
}
export interface Ctx { waitUntil(p: Promise<unknown>): void }

export async function ingest(env: IngestEnv, ctx: Ctx, c: Capture): Promise<{ id: string; duplicate: boolean }> {
  const id = (await dedupKey(c)).slice(0, 32);
  // WRITE-AHEAD: the row exists before any grader or router can see it. Append-only: ignore dupes, never update.
  const res = await env.DB.prepare(
    `INSERT OR IGNORE INTO captures (id, source, external_id, url, content, content_kind, title, author, privacy_class, captured_at, ingested_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, c.source, c.external_id, c.url ?? null, c.content ?? null, c.content_kind, c.title ?? null, c.author ?? null, c.privacy_class, c.captured_at, new Date().toISOString()).run();
  const inserted = res.meta.changes > 0;
  if (inserted && env.GRADE_QUEUE) ctx.waitUntil(env.GRADE_QUEUE.send({ id }).catch(() => {})); // best effort; the ledger row is the source of truth
  return { id, duplicate: !inserted };
}
