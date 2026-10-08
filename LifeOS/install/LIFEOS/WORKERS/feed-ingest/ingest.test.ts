import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import worker, { pollDue, type Env } from "./src/index";
import { MAX_ERRORS, nextState } from "./src/breaker";
import { parseFeed } from "./src/parse";
import { pollSource, pollWithTiers, tiersFromEnv } from "./src/poll";
import { validateFeedUrl } from "./src/safe";

const RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>T</title>
<item><title>First &amp; best</title><link>https://a.example/1</link><guid>g-1</guid><dc:creator>Ann</dc:creator><pubDate>Tue, 07 Oct 2026 09:00:00 GMT</pubDate><description>&lt;p&gt;Hello &lt;b&gt;world&lt;/b&gt;&lt;/p&gt;</description></item>
<item><title>Second</title><link>https://a.example/2</link></item></channel></rss>`;
const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>T</title>
<entry><id>tag:x,1</id><title type="html">Atom one</title><link rel="self" href="https://b.example/self"/><link rel="alternate" href="https://b.example/1"/><updated>2026-10-06T10:00:00Z</updated><author><name>Bob</name></author><summary>Sum</summary></entry></feed>`;

describe("parseFeed", () => {
  test("RSS 2.0: decodes entities, strips html, reads dc:creator and dates", () => {
    const [a, b] = parseFeed(RSS);
    expect(a).toMatchObject({ guid: "g-1", url: "https://a.example/1", title: "First & best", author: "Ann", published: "2026-10-07T09:00:00.000Z", summary: "Hello world" });
    expect(b.guid).toBe("https://a.example/2"); // no guid → falls back to link
  });
  test("Atom: prefers the alternate link, reads author and updated", () => {
    expect(parseFeed(ATOM)).toEqual([{ guid: "tag:x,1", url: "https://b.example/1", title: "Atom one", author: "Bob", published: "2026-10-06T10:00:00.000Z", summary: "Sum" }]);
  });
  test("a single-item feed (object, not array) still parses", () => {
    expect(parseFeed(`<rss><channel><item><title>Only</title><link>https://c.example/</link></item></channel></rss>`)).toHaveLength(1);
  });
  test("HTML, garbage and empty channels yield nothing", () => {
    expect(parseFeed("<html><body>parked domain</body></html>")).toEqual([]);
    expect(parseFeed("not xml at all {{{")).toEqual([]);
    expect(parseFeed(`<rss><channel><title>x</title></channel></rss>`)).toEqual([]);
  });
  test("an entity-expansion bomb neither hangs nor explodes", () => {
    const bomb = `<?xml version="1.0"?><!DOCTYPE l [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;"><!ENTITY d "&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;"><!ENTITY e "&d;&d;&d;&d;&d;&d;&d;&d;&d;&d;">]><rss><channel><item><title>&e;</title><link>https://d.example/</link></item></channel></rss>`;
    const t0 = Date.now();
    const out = parseFeed(bomb);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect((out[0]?.title ?? "").length).toBeLessThanOrEqual(500);
  });
});

describe("circuit breaker", () => {
  const s = { error_count: 0, interval_min: 60 };
  test("ok resets errors and schedules the normal interval", () => {
    expect(nextState({ ...s, error_count: 4 }, "ok", 0)).toMatchObject({ error_count: 0, next_poll_at: 3_600_000, disabled: 0 });
  });
  test("200 with zero items is a soft failure that increments, never resets", () => {
    expect(nextState({ ...s, error_count: 2 }, "empty", 0).error_count).toBe(3);
  });
  test("failures back off exponentially, capped at 24h", () => {
    expect(nextState(s, "http_error", 0).next_poll_at).toBe(3_600_000 * 2);
    expect(nextState({ ...s, error_count: 8 }, "network_error", 0).next_poll_at).toBe(24 * 3_600_000);
  });
  test("disables at the error limit", () => {
    expect(nextState({ ...s, error_count: MAX_ERRORS - 1 }, "http_error", 0).disabled).toBe(1);
  });
});

describe("url safety", () => {
  test.each(["http://a.example/feed", "https://user:pw@a.example/f", "https://127.0.0.1/f", "https://10.0.0.5/f", "https://localhost/f", "https://printer.local/f", "https://a.example:8443/f", "https://intranet/f", "file:///etc/passwd", "https://[::1]/f"])("rejects %s", (u) => {
    expect(validateFeedUrl(u)).toBeNull();
  });
  test("accepts a normal https feed and drops the fragment", () => {
    expect(validateFeedUrl("https://blog.example.com/feed.xml#x")).toBe("https://blog.example.com/feed.xml");
  });
  test("a redirect to a disallowed host is blocked", async () => {
    const f = (async () => Object.defineProperty(new Response(RSS), "url", { value: "https://127.0.0.1/evil" })) as any;
    expect((await pollSource("https://a.example/feed", f)).outcome).toBe("blocked");
  });
  test("outcomes: ok / empty / http_error / network_error / oversize", async () => {
    const mk = (r: () => Response | Promise<Response>) => (async () => r()) as any;
    expect((await pollSource("https://a.example/f", mk(() => new Response(RSS)))).outcome).toBe("ok");
    expect((await pollSource("https://a.example/f", mk(() => new Response("<html></html>")))).outcome).toBe("empty");
    expect((await pollSource("https://a.example/f", mk(() => new Response("no", { status: 503 })))).outcome).toBe("http_error");
    expect((await pollSource("https://a.example/f", mk(() => { throw new Error("dns"); }))).outcome).toBe("network_error");
    expect((await pollSource("https://a.example/f", mk(() => new Response("x".repeat(2 * 1024 * 1024 + 1))))).outcome).toBe("http_error");
  });
});

// ---- worker + real SQL ----
let db: Database, env: Env;
const stmt = (d: Database, sql: string, args: unknown[] = []): any => ({
  bind: (...a: unknown[]) => stmt(d, sql, a),
  run: async () => ({ meta: { changes: d.prepare(sql).run(...(args as any[])).changes } }),
  all: async () => ({ results: d.prepare(sql).all(...(args as any[])) }),
});
const post = (path: string, body: unknown, token = "tok") =>
  worker.fetch(new Request(`https://x.test${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }), env);
const feedFetch = (map: Record<string, () => Response>) => (async (u: string) => (map[u] ?? (() => new Response("", { status: 404 })))()) as any;
const one = (sql: string) => db.query(sql).get() as any;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(readFileSync(join(import.meta.dir, "schema.sql"), "utf-8"));
  env = { INGEST_TOKEN: "tok", DB: { prepare: (sql: string) => stmt(db, sql) } };
});

describe("arbol-a-feed-ingest", () => {
  test("auth, validation and routing", async () => {
    expect((await post("/sources", { url: "https://a.example/f" }, "bad")).status).toBe(401);
    expect((await post("/sources", { url: "http://a.example/f" })).status).toBe(400);
    expect((await worker.fetch(new Request("https://x.test/nope"), env)).status).toBe(404);
  });
  test("adds a source once (idempotent) and clamps the interval", async () => {
    expect((await post("/sources", { url: "https://a.example/f", interval_min: 1 })).status).toBe(201);
    expect((await post("/sources", { url: "https://a.example/f" })).status).toBe(200);
    expect(one("SELECT count(*) AS n FROM sources").n).toBe(1);
    expect(one("SELECT interval_min FROM sources").interval_min).toBe(15);
  });
  test("polls a due source, stores items once, and a re-poll adds nothing", async () => {
    await post("/sources", { url: "https://a.example/f" });
    const f = feedFetch({ "https://a.example/f": () => new Response(RSS) });
    expect(await pollDue(env, 1000, f)).toMatchObject({ polled: 1, newItems: 2, failed: 0 });
    expect(one("SELECT error_count, last_status FROM sources")).toEqual({ error_count: 0, last_status: "ok" });
    db.exec("UPDATE sources SET next_poll_at = 0");
    expect((await pollDue(env, 2000, f)).newItems).toBe(0);
    expect(one("SELECT count(*) AS n FROM items").n).toBe(2);
  });
  test("a not-yet-due source is skipped", async () => {
    await post("/sources", { url: "https://a.example/f" });
    await pollDue(env, 1000, feedFetch({ "https://a.example/f": () => new Response(RSS) }));
    expect((await pollDue(env, 1500, feedFetch({}))).polled).toBe(0);
  });
  test("a parked domain (200, no items) counts as an error and eventually disables", async () => {
    await post("/sources", { url: "https://dead.example/f" });
    const f = feedFetch({ "https://dead.example/f": () => new Response("<html>for sale</html>") });
    for (let i = 0; i < MAX_ERRORS; i++) { db.exec("UPDATE sources SET next_poll_at = 0"); await pollDue(env, 1000 + i, f); }
    expect(one("SELECT error_count, disabled, last_status FROM sources")).toEqual({ error_count: MAX_ERRORS, disabled: 1, last_status: "empty" });
    db.exec("UPDATE sources SET next_poll_at = 0");
    expect((await pollDue(env, 9999, f)).polled).toBe(0); // disabled sources are not polled
  });
  test("one failing source does not stop the batch", async () => {
    await post("/sources", { url: "https://bad.example/f" });
    await post("/sources", { url: "https://a.example/f" });
    const f = feedFetch({ "https://bad.example/f": () => { throw new Error("boom"); }, "https://a.example/f": () => new Response(RSS) });
    const r = await pollDue(env, 1000, f);
    expect(r.newItems).toBe(2);
    expect(r.failed).toBe(1);
  });
});

describe("fetch-tier fallback", () => {
  const READER = "https://reader.example/fetch?u={url}";
  const SELF = "https://proxy.example/{url}";
  const tiers = tiersFromEnv({ READER_PROXY_URL: READER, SELF_PROXY_URL: SELF, PROXY_AUTH_TOKEN: "ptok" });
  const FEED = "https://a.example/f?x=1&y=2";
  const calls: { url: string; auth: string | null }[] = [];
  const router = (direct: () => Response, reader: () => Response = () => new Response("no", { status: 500 }), self: () => Response = () => new Response("no", { status: 500 })) =>
    (async (u: any, init: any) => {
      const url = String(u);
      calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
      if (url.startsWith("https://reader.example/")) return reader();
      if (url.startsWith("https://proxy.example/")) return self();
      return direct();
    }) as any;
  beforeEach(() => { calls.length = 0; });

  test("direct success never touches a proxy", async () => {
    const r = await pollWithTiers(FEED, tiers, router(() => new Response(RSS)));
    expect(r.outcome).toBe("ok");
    expect(r.via).toBeUndefined();
    expect(calls).toHaveLength(1);
  });
  test("403 falls to the reader proxy; the URL is encoded and the token goes only to the proxy", async () => {
    const r = await pollWithTiers(FEED, tiers, router(() => new Response("no", { status: 403 }), () => new Response(RSS)));
    expect(r).toMatchObject({ outcome: "ok", via: "reader-proxy" });
    expect(calls[0]).toEqual({ url: FEED, auth: null });
    expect(calls[1]).toEqual({ url: `https://reader.example/fetch?u=${encodeURIComponent(FEED)}`, auth: "Bearer ptok" });
  });
  test("reader fails → self-hosted proxy; all fail → the direct error stands", async () => {
    const ok = await pollWithTiers(FEED, tiers, router(() => new Response("no", { status: 429 }), undefined, () => new Response(RSS)));
    expect(ok.via).toBe("self-proxy");
    calls.length = 0;
    const bad = await pollWithTiers(FEED, tiers, router(() => new Response("no", { status: 429 })));
    expect(bad).toMatchObject({ outcome: "http_error", status: 429 });
    expect(calls).toHaveLength(3);
  });
  test("an empty 200 triggers the tiers; 404 and network errors do not", async () => {
    expect((await pollWithTiers(FEED, tiers, router(() => new Response("<html/>"), () => new Response(RSS)))).via).toBe("reader-proxy");
    calls.length = 0;
    await pollWithTiers(FEED, tiers, router(() => new Response("gone", { status: 404 })));
    await pollWithTiers(FEED, tiers, router(() => { throw new Error("dns"); }));
    expect(calls).toHaveLength(2);
  });
  test("a feed URL that fails SSRF validation is never handed to a proxy", async () => {
    const r = await pollWithTiers("https://127.0.0.1/f", tiers, router(() => new Response(RSS)));
    expect(r.outcome).toBe("blocked");
    expect(calls).toHaveLength(0);
  });
  test("invalid templates are ignored (http, no {url}, credentials, junk)", () => {
    expect(tiersFromEnv({ READER_PROXY_URL: "http://r.example/{url}", SELF_PROXY_URL: "https://r.example/fixed" })).toEqual([]);
    expect(tiersFromEnv({ READER_PROXY_URL: "https://u:p@r.example/{url}", SELF_PROXY_URL: "not a url {url}" })).toEqual([]);
    expect(tiersFromEnv({})).toEqual([]);
  });
  test("a proxy that redirects off https is refused", async () => {
    const f = (async (u: any) => {
      const url = String(u);
      if (!url.startsWith("https://reader.example/")) return new Response("no", { status: 403 });
      const r = new Response(RSS); Object.defineProperty(r, "url", { value: "http://evil.example/x" }); return r;
    }) as any;
    expect((await pollWithTiers(FEED, tiers, f)).outcome).toBe("http_error");
  });
  test("pollDue records last_status 'ok+reader-proxy' and resets the error count", async () => {
    await post("/sources", { url: "https://a.example/f" });
    db.exec("UPDATE sources SET error_count = 3");
    const f = feedFetch({ "https://a.example/f": () => new Response("no", { status: 403 }), "https://reader.example/fetch?u=https%3A%2F%2Fa.example%2Ff": () => new Response(RSS) });
    const r = await pollDue({ ...env, READER_PROXY_URL: READER } as Env, 1000, f);
    expect(r).toMatchObject({ polled: 1, newItems: 2, failed: 0 });
    expect(one("SELECT last_status, error_count FROM sources")).toEqual({ last_status: "ok+reader-proxy", error_count: 0 });
  });
});

describe("review fixes", () => {
  test("a source whose processing throws still backs off and counts toward auto-disable (it must not stay due forever)", async () => {
    await post("/sources", { url: "https://a.example/f" });
    db.exec("CREATE TRIGGER boom BEFORE INSERT ON items BEGIN SELECT RAISE(ABORT, 'disk full'); END");
    const f = feedFetch({ "https://a.example/f": () => new Response(RSS) });
    const r = await pollDue(env, 1000, f);
    expect(r.failed).toBe(1);
    const row = one("SELECT error_count, next_poll_at, last_status FROM sources");
    expect(row.error_count).toBe(1); expect(row.next_poll_at).toBeGreaterThan(1000); expect(row.last_status).toBe("internal_error");
    expect((await pollDue(env, 1001, f)).polled).toBe(0); // no longer due, so it cannot starve healthy sources
  });
});
