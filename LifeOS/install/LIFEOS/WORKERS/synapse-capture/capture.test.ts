import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import worker, { type Env } from "./src/index";
import { dedupKey, normalizeUrl, validate } from "./src/contract";

// Real SQL against the real schema: bun:sqlite adapted to the slice of the D1 API the Worker uses.
let db: Database, queued: unknown[], env: Env;
const d1 = (d: Database) => ({ prepare: (sql: string) => ({ bind: (...a: unknown[]) => ({ run: async () => ({ meta: { changes: d.prepare(sql).run(...(a as any[])).changes } }) }) }) });
const pending: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) };
const post = (body: unknown, token = "tok") =>
  worker.fetch(new Request("https://x.test/capture", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }), env, ctx);
const base = { source: "reader-upvote", external_id: "r-1", url: "https://Example.com/post/?utm_source=x#frag", content_kind: "article", privacy_class: "public" };

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(readFileSync(join(import.meta.dir, "schema.sql"), "utf-8"));
  queued = [];
  env = { CAPTURE_TOKEN: "tok", DB: d1(db), GRADE_QUEUE: { send: async (m) => void queued.push(m) } };
});

describe("contract", () => {
  test("normalizes urls (tracking params, fragment, host case, trailing slash)", () => {
    expect(normalizeUrl("https://Example.com/a/?b=2&utm_campaign=z&a=1#x")).toBe("https://example.com/a?a=1&b=2");
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
  });
  test("requires url or content, valid kind, and privacy_class", () => {
    expect(validate({ ...base, url: undefined, content: undefined }).ok).toBe(false);
    expect(validate({ ...base, content_kind: "Article!" }).ok).toBe(false);
    expect(validate({ ...base, privacy_class: "secret" }).ok).toBe(false);
  });
  test("same item via different tracking params dedups to one key", async () => {
    const a = (validate(base) as any).capture, b = (validate({ ...base, url: "https://example.com/post?utm_medium=y" }) as any).capture;
    expect(await dedupKey(a)).toBe(await dedupKey(b));
  });
  test("falls back to source+external_id without a url", async () => {
    const a = (validate({ ...base, url: undefined, content: "hi" }) as any).capture;
    const b = (validate({ ...base, url: undefined, content: "different text" }) as any).capture;
    expect(await dedupKey(a)).toBe(await dedupKey(b));
  });
});

describe("arbol-a-synapse-capture", () => {
  test("rejects bad token / unknown route / bad body", async () => {
    expect((await post(base, "nope")).status).toBe(401);
    expect((await worker.fetch(new Request("https://x.test/other"), env, ctx)).status).toBe(404);
    expect((await post({ source: "x" })).status).toBe(400);
  });
  test("write-ahead: row exists, and downstream is queued after", async () => {
    const r = await post(base);
    expect(r.status).toBe(201);
    await Promise.all(pending);
    const row = db.query("SELECT url, privacy_class FROM captures").get() as any;
    expect(row.url).toBe("https://example.com/post");
    expect(queued).toHaveLength(1);
  });
  test("idempotent: a repeat is one row, 200, not re-queued", async () => {
    await post(base);
    const r = await post({ ...base, url: "https://example.com/post?utm_source=other" });
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).duplicate).toBe(true);
    expect((db.query("SELECT count(*) AS n FROM captures").get() as any).n).toBe(1);
    expect(queued).toHaveLength(1);
  });
  test("personal records are refused and never written", async () => {
    const r = await post({ ...base, privacy_class: "personal" });
    expect(r.status).toBe(403);
    expect((db.query("SELECT count(*) AS n FROM captures").get() as any).n).toBe(0);
  });
  test("a failing queue never fails the capture", async () => {
    env.GRADE_QUEUE = { send: async () => { throw new Error("queue down"); } };
    expect((await post(base)).status).toBe(201);
  });
  test("caps payload size", async () => {
    expect((await post({ ...base, content: "x".repeat(300_000) })).status).toBe(413);
  });
});
