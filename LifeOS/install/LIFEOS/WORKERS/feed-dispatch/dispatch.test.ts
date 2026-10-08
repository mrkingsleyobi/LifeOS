import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import worker, { dispatchTick, MAX_ATTEMPTS, MAX_IMMEDIATE, sendDigest, STALE_MS, type Env } from "./src/index";
import { channels, clean, formatAlert, formatDigest } from "./src/deliver";

const HOOK = "https://discord.com/api/webhooks/123456/abc_DEF-ghi";
let db: Database, env: Env, calls: { url: string; body: any; headers: any }[], mode: { discord: number; email: number };
const NOW = 10 * STALE_MS;

const stmt = (d: Database, sql: string, args: unknown[] = []): any => ({
  bind: (...a: unknown[]) => stmt(d, sql, a),
  run: async () => ({ meta: { changes: d.prepare(sql).run(...(args as any[])).changes } }),
  all: async () => ({ results: d.prepare(sql).all(...(args as any[])) }),
});
const fakeFetch = (async (url: string, init: any) => {
  calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
  const status = url.includes("discord") ? mode.discord : mode.email;
  return new Response("{}", { status });
}) as any;
const one = (sql: string) => db.query(sql).get() as any;
const rows = (sql: string) => db.query(sql).all() as any[];

let n = 0;
function addRated(o: Partial<{ id: string; title: string; url: string; tier: string; q: number; imp: number; nov: number; urg: number; labels: string[]; flagged: number; rated_at: number; summary: string }> = {}) {
  const id = o.id ?? `it${++n}`;
  db.prepare("INSERT INTO items (id, source_id, guid, title, url, fetched_at) VALUES (?, 1, ?, ?, ?, ?)").run(id, id, o.title ?? `Title ${id}`, o.url ?? `https://a.example/${id}`, NOW);
  db.prepare("INSERT INTO ratings (item_id, version, summary_short, summary_medium, tier, quality_score, importance, novelty, urgency, labels, flagged, model, rated_at) VALUES (?, 1, ?, 'm', ?, ?, ?, ?, ?, ?, ?, 'm', ?)")
    .run(id, o.summary ?? "short summary", o.tier ?? "A", o.q ?? 70, o.imp ?? 5, o.nov ?? 5, o.urg ?? 3, JSON.stringify(o.labels ?? []), o.flagged ?? 0, o.rated_at ?? NOW - 1000);
  return id;
}
const urgentSecurity = (o: any = {}) => addRated({ tier: "S", urg: 9, labels: ["Security"], ...o });

beforeEach(() => {
  db = new Database(":memory:");
  for (const f of ["../feed-ingest/schema.sql", "../feed-rate/schema.sql", "schema.sql"]) db.exec(readFileSync(join(import.meta.dir, f), "utf-8"));
  db.exec("INSERT INTO sources (id, url) VALUES (1, 'https://a.example/f')");
  calls = []; mode = { discord: 204, email: 200 }; n = 0;
  env = { DISPATCH_TOKEN: "tok", DB: { prepare: (sql: string) => stmt(db, sql) }, DISCORD_WEBHOOK_URL: HOOK, RESEND_API_KEY: "rk", EMAIL_FROM: "feed@x.test", EMAIL_TO: "me@x.test" };
});

describe("channels and formatting", () => {
  test("only real Discord webhook URLs count (no arbitrary POST targets)", () => {
    expect(channels({ DISCORD_WEBHOOK_URL: "https://evil.example/api/webhooks/1/a" })).toEqual([]);
    expect(channels({ DISCORD_WEBHOOK_URL: "http://discord.com/api/webhooks/1/a" })).toEqual([]);
    expect(channels({ DISCORD_WEBHOOK_URL: HOOK })).toEqual(["discord"]);
    expect(channels({ RESEND_API_KEY: "k", EMAIL_FROM: "a@x", EMAIL_TO: "b@x" })).toEqual(["email"]);
    expect(channels({ RESEND_API_KEY: "k" })).toEqual([]);
  });
  test("untrusted text is neutralized: mentions, control characters, newlines, bad links", () => {
    const a = formatAlert({ id: "x", tier: "S", title: "Hi @everyone\r\nBcc: attacker@evil.test", summary_short: "line1\nline2", url: "javascript:alert(1)", labels: ["AI"] });
    expect(a.subject).not.toMatch(/[\r\n]/);
    expect(a.text).not.toContain("@everyone");
    expect(a.text).not.toContain("javascript:");
    expect(clean("a\u0000b\u2028c", 10)).toBe("a b c");
  });
  test("a model-written summary cannot form a masked link or a suppressed-embed autolink", () => {
    const a = formatAlert({ id: "x", tier: "A", title: "Normal title", summary_short: "Read [the report](https://evil.example/login) or <https://evil.example/x> now", url: "https://ok.example/1" });
    expect(a.text).not.toMatch(/\]\(|<https?:/);
    expect(a.text).toContain("(the report)");
  });
  test("digest lists items and keeps good links only", () => {
    const d = formatDigest("daily", [{ id: "1", tier: "A", title: "One", url: "https://ok.example/1", summary_short: "s" }, { id: "2", tier: "B", title: "Two", url: "ftp://no" }]);
    expect(d.subject).toBe("Feed daily digest (2)");
    expect(d.text).toContain("https://ok.example/1");
    expect(d.text).not.toContain("ftp://");
  });
});

describe("dispatchTick", () => {
  test("with no delivery channel it consumes nothing", async () => {
    urgentSecurity();
    const r = await dispatchTick({ ...env, DISCORD_WEBHOOK_URL: undefined, RESEND_API_KEY: undefined }, NOW, fakeFetch);
    expect(r.error).toBe("no delivery channel configured");
    expect(one("SELECT count(*) AS n FROM deliveries").n).toBe(0);
  });
  test("an urgent security item is alerted on every channel, safely", async () => {
    urgentSecurity({ title: "Kernel bug @here" });
    expect(await dispatchTick(env, NOW, fakeFetch)).toMatchObject({ routed: 1, sent: 1 });
    const d = calls.find((c) => c.url.includes("discord"))!;
    expect(d.body.allowed_mentions).toEqual({ parse: [] });
    expect(d.body.content).toContain("[S] Kernel bug");
    const e = calls.find((c) => c.url.includes("resend"))!;
    expect(e.body).toMatchObject({ from: "feed@x.test", to: ["me@x.test"] });
    expect(e.headers.Authorization).toBe("Bearer rk");
    expect(one("SELECT status, attempts FROM deliveries WHERE destination = 'notify'")).toEqual({ status: "sent", attempts: 1 });
  });
  test("idempotent: a second tick sends nothing", async () => {
    urgentSecurity();
    await dispatchTick(env, NOW, fakeFetch);
    const before = calls.length;
    expect(await dispatchTick(env, NOW + 1000, fakeFetch)).toMatchObject({ routed: 0, sent: 0 });
    expect(calls.length).toBe(before);
  });
  test("one channel failing still delivers and records the error; both failing retries then gives up", async () => {
    urgentSecurity();
    mode.discord = 500;
    await dispatchTick(env, NOW, fakeFetch);
    expect(one("SELECT status, last_error FROM deliveries")).toEqual({ status: "sent", last_error: "discord 500" });

    db.exec("DELETE FROM deliveries"); calls = [];
    mode = { discord: 500, email: 500 };
    expect((await dispatchTick(env, NOW, fakeFetch)).failed).toBe(1);
    expect(one("SELECT status FROM deliveries").status).toBe("failed");
    mode = { discord: 204, email: 200 };
    expect(await dispatchTick(env, NOW + 1000, fakeFetch)).toMatchObject({ retried: 1, sent: 1 });
    expect(one("SELECT status FROM deliveries").status).toBe("sent");
  });
  test("a permanently failing alert stops being retried after MAX_ATTEMPTS", async () => {
    urgentSecurity(); mode = { discord: 500, email: 500 };
    for (let i = 0; i < MAX_ATTEMPTS + 3; i++) await dispatchTick(env, NOW + i * 1000, fakeFetch);
    expect(one("SELECT attempts, status FROM deliveries")).toEqual({ attempts: MAX_ATTEMPTS, status: "failed" });
  });
  test("two overlapping runs send one alert, not two (cron overlap or a manual POST /dispatch)", async () => {
    urgentSecurity();
    const results = await Promise.all([dispatchTick(env, NOW, fakeFetch), dispatchTick(env, NOW, fakeFetch)]);
    expect(results.reduce((n, r) => n + r.sent, 0)).toBe(1);
    expect(calls.filter((c) => c.url.includes("discord"))).toHaveLength(1);
    expect(one("SELECT count(*) AS n FROM deliveries WHERE destination = 'notify'").n).toBe(1);
  });
  test("destinations with no adapter are recorded as unsupported, never dropped", async () => {
    addRated({ tier: "A", q: 85, labels: ["AI"] });
    const r = await dispatchTick(env, NOW, fakeFetch);
    expect(r.unsupported).toBe(2);
    expect(rows("SELECT destination, status FROM deliveries ORDER BY destination")).toEqual([{ destination: "blog-draft", status: "unsupported" }, { destination: "social-post", status: "unsupported" }]);
    expect(calls).toHaveLength(0);
  });
  test("ordinary items are archived without any message", async () => {
    addRated({ tier: "C", q: 40 });
    await dispatchTick(env, NOW, fakeFetch);
    expect(one("SELECT destination, status FROM deliveries")).toEqual({ destination: "archive", status: "archived" });
    expect(calls).toHaveLength(0);
  });
  test("flagged (injection-capped) items are suppressed and never sent", async () => {
    urgentSecurity({ flagged: 1 });
    expect((await dispatchTick(env, NOW, fakeFetch)).suppressed).toBe(1);
    expect(calls).toHaveLength(0);
  });
  test("a stale backlog does not become an alert flood", async () => {
    urgentSecurity({ rated_at: NOW - STALE_MS - 1 });
    expect((await dispatchTick(env, NOW, fakeFetch)).stale).toBe(1);
    expect(calls).toHaveLength(0);
  });
  test(`more than ${MAX_IMMEDIATE} alerts in a tick: individual alerts, then one overflow summary`, async () => {
    for (let i = 0; i < 8; i++) urgentSecurity({ rated_at: NOW - 2000 + i });
    const r = await dispatchTick(env, NOW, fakeFetch);
    expect(r.sent).toBe(8);
    expect(calls.filter((c) => c.url.includes("discord"))).toHaveLength(MAX_IMMEDIATE + 1);
    expect(calls.find((c) => c.body.content?.includes("alert overflow"))).toBeTruthy();
    expect(one("SELECT count(*) AS n FROM deliveries WHERE status = 'sent'").n).toBe(8);
  });
});

describe("digests", () => {
  test("weekly-material items queue, then send once as a weekly digest, best first", async () => {
    addRated({ id: "low", tier: "B", imp: 7, q: 50, title: "Lower" });
    addRated({ id: "high", tier: "A", imp: 8, q: 90, title: "Higher" });
    expect((await dispatchTick(env, NOW, fakeFetch)).queued).toBe(2);
    expect(calls).toHaveLength(0);
    expect((await sendDigest(env, "daily", NOW, fakeFetch)).sent).toBe(0); // wrong bucket
    const r = await sendDigest(env, "weekly", NOW, fakeFetch);
    expect(r.sent).toBe(2);
    const text = calls.find((c) => c.url.includes("resend"))!.body.text as string;
    expect(text.indexOf("Higher")).toBeLessThan(text.indexOf("Lower"));
    expect((await sendDigest(env, "weekly", NOW, fakeFetch)).sent).toBe(0); // already sent
    expect(one("SELECT count(*) AS n FROM deliveries WHERE status = 'queued'").n).toBe(0);
  });
  test("a failed digest stays queued for the next run", async () => {
    addRated({ tier: "B", imp: 7 });
    await dispatchTick(env, NOW, fakeFetch);
    mode = { discord: 500, email: 500 };
    expect((await sendDigest(env, "weekly", NOW, fakeFetch)).sent).toBe(0);
    expect(one("SELECT status FROM deliveries WHERE destination = 'digest'").status).toBe("queued");
  });
  test("cron routing: daily/weekly crons send digests, anything else dispatches", async () => {
    addRated({ tier: "B", imp: 7, rated_at: Date.now() - 1000 }); // the cron path uses the real clock
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) };
    const realFetch = globalThis.fetch; globalThis.fetch = fakeFetch;
    try {
      await worker.scheduled({ cron: "*/10 * * * *" }, env, ctx); await Promise.all(pending);
      expect(one("SELECT count(*) AS n FROM deliveries WHERE status = 'queued'").n).toBe(1);
      await worker.scheduled({ cron: "0 8 * * 1" }, env, ctx); await Promise.all(pending);
      expect(one("SELECT status FROM deliveries WHERE destination = 'digest'").status).toBe("sent");
    } finally { globalThis.fetch = realFetch; }
  });
});

describe("on-demand digest endpoint", () => {
  const dig = (q: string, t = "tok") => worker.fetch(new Request(`https://x.test/digest${q}`, { method: "POST", headers: { Authorization: `Bearer ${t}` } }), env);
  test("auth and priority validation", async () => {
    expect((await dig("?priority=weekly", "bad")).status).toBe(401);
    expect((await dig("")).status).toBe(400);
    expect((await dig("?priority=hourly")).status).toBe(400);
  });
  test("sends the queued weekly digest once", async () => {
    addRated({ tier: "B", imp: 7, title: "Worth a read" });
    await dispatchTick(env, NOW, fakeFetch);
    const realFetch = globalThis.fetch; globalThis.fetch = fakeFetch;
    try {
      expect(((await (await dig("?priority=weekly")).json()) as any).sent).toBe(1);
      expect(((await (await dig("?priority=weekly")).json()) as any).sent).toBe(0);
    } finally { globalThis.fetch = realFetch; }
    expect(calls.some((c) => String(c.body.content ?? c.body.text).includes("Worth a read"))).toBe(true);
  });
});

describe("endpoints", () => {
  test("auth, routing and healthz", async () => {
    const post = (t: string) => worker.fetch(new Request("https://x.test/dispatch", { method: "POST", headers: { Authorization: `Bearer ${t}` } }), env);
    expect((await post("bad")).status).toBe(401);
    expect((await worker.fetch(new Request("https://x.test/nope"), env)).status).toBe(404);
    const h = (await (await worker.fetch(new Request("https://x.test/healthz"), env)).json()) as any;
    expect(h.channels).toEqual(["discord", "email"]);
  });
});

describe("draft delivery (blog-draft / social-post)", () => {
  const DRAFT = { DRAFT_MODEL: "openai/gpt-6-sol", DRAFT_API_KEY: "dk", DRAFT_BASE_URL: "https://openrouter.ai/api/v1" };
  const aiItem = (o: any = {}) => addRated({ tier: "S", q: 95, labels: ["AI"], title: "Big AI news", ...o });
  let modelCalls: any[];
  const f = (reply: () => Response) => (async (url: string, init: any) => {
    if (url.includes("openrouter")) { modelCalls.push(JSON.parse(init.body)); return reply(); }
    return fakeFetch(url, init);
  }) as any;
  const model = (draft: string) => () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ draft }) } }] }));
  beforeEach(() => { modelCalls = []; });

  test("without DRAFT_* nothing changes: still unsupported, no model call", async () => {
    aiItem();
    const r = await dispatchTick(env, NOW, f(model("x".repeat(50))));
    expect(r.unsupported).toBe(2); expect(modelCalls).toHaveLength(0);
  });
  test("with DRAFT_* both destinations are drafted, labelled NOT PUBLISHED, and sent for review", async () => {
    aiItem();
    const r = await dispatchTick({ ...env, ...DRAFT }, NOW, f(model("A short draft about the news that is long enough.")));
    expect(r).toMatchObject({ drafted: 2, unsupported: 0 });
    expect(rows("SELECT destination, status FROM deliveries ORDER BY destination")).toEqual([{ destination: "blog-draft", status: "sent" }, { destination: "social-post", status: "sent" }]);
    const msg = calls.find(c => c.url.includes("discord"))!.body.content as string;
    expect(msg).toContain("NOT PUBLISHED"); expect(msg).toContain("DRAFT");
    expect(modelCalls[0].provider).toEqual({ data_collection: "deny" });
  });
  test("model output is untrusted: links removed, mentions and link syntax defused, only the item URL survives", async () => {
    aiItem({ url: "https://a.example/real" });
    await dispatchTick({ ...env, ...DRAFT }, NOW, f(model("Read [this](https://evil.example/x) now @everyone and visit http://evil.example/y for a prize!")));
    const msg = calls.find(c => c.url.includes("discord"))!.body.content as string;
    expect(msg).not.toContain("evil.example"); expect(msg).not.toContain("](");
    expect(msg).not.toContain("@everyone"); expect(msg).toContain("Source: https://a.example/real");
    expect(calls.find(c => c.url.includes("discord"))!.body.allowed_mentions).toEqual({ parse: [] });
  });
  test("bad model output retries until the attempt cap, then fails; never sends garbage", async () => {
    aiItem();
    const e = { ...env, ...DRAFT };
    for (let i = 0; i < MAX_ATTEMPTS; i++) await dispatchTick(e, NOW + i, f(() => new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }))));
    expect(rows("SELECT destination, status, attempts FROM deliveries ORDER BY destination")).toEqual([{ destination: "blog-draft", status: "failed", attempts: MAX_ATTEMPTS }, { destination: "social-post", status: "failed", attempts: MAX_ATTEMPTS }]);
    expect(calls.filter(c => c.url.includes("discord"))).toHaveLength(0);
  });
  test("a too-short draft is rejected; drafts are capped per tick; a sent draft is never re-sent", async () => {
    aiItem(); aiItem(); aiItem();
    await dispatchTick({ ...env, ...DRAFT }, NOW, f(model("tiny")));
    expect(rows("SELECT status FROM deliveries WHERE status='sent'")).toHaveLength(0);
    calls.length = 0; modelCalls.length = 0;
    const r = await dispatchTick({ ...env, ...DRAFT }, NOW + 1, f(model("A perfectly reasonable draft body for this item.")));
    expect(r.drafted).toBe(3); expect(modelCalls).toHaveLength(3); // 6 queued, cap 3 per tick
    await dispatchTick({ ...env, ...DRAFT }, NOW + 2, f(model("A perfectly reasonable draft body for this item.")));
    await dispatchTick({ ...env, ...DRAFT }, NOW + 3, f(model("A perfectly reasonable draft body for this item.")));
    expect(rows("SELECT status FROM deliveries WHERE status='sent'")).toHaveLength(6);
    modelCalls.length = 0; await dispatchTick({ ...env, ...DRAFT }, NOW + 4, f(model("A perfectly reasonable draft body for this item.")));
    expect(modelCalls).toHaveLength(0);
  });
});
