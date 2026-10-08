import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import worker, { type Env } from "./src/index";
import { MAX_RAW, senderAllowed, type EmailMessage } from "./src/email";

let db: Database, env: Env, queued: unknown[];
const d1 = (d: Database) => ({ prepare: (sql: string) => ({ bind: (...a: unknown[]) => ({ run: async () => ({ meta: { changes: d.prepare(sql).run(...(a as any[])).changes } }) }) }) });
const pending: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) };

function mail(raw: string, from = "me@example.com", headers: Record<string, string> = {}): EmailMessage & { rejected?: string } {
  const bytes = new TextEncoder().encode(raw);
  const m: any = {
    from, to: "cap-7f3a9c@capture.example.com", rawSize: bytes.length, headers: new Headers(headers),
    raw: new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }),
    setReject(r: string) { m.rejected = r; },
  };
  return m;
}
const rfc = (lines: string[]) => lines.join("\r\n");
const simple = rfc([
  "From: Me <me@example.com>", "To: cap-7f3a9c@capture.example.com", "Subject: Worth reading",
  "Message-ID: <abc123@example.com>", "Date: Tue, 07 Oct 2026 09:00:00 +0000",
  "Content-Type: text/plain; charset=utf-8", "", "Look at this https://Example.org/post/?utm_source=nl#top it is great.",
]);
const count = () => (db.query("SELECT count(*) AS n FROM captures").get() as any).n;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(readFileSync(join(import.meta.dir, "schema.sql"), "utf-8"));
  queued = [];
  env = { CAPTURE_TOKEN: "t", DB: d1(db), ALLOWED_SENDERS: "me@example.com,@trusted.org", GRADE_QUEUE: { send: async (m) => void queued.push(m) } };
});

describe("senderAllowed", () => {
  test("exact address and @domain entries, case-insensitive", () => {
    expect(senderAllowed("Me@Example.com", "me@example.com")).toBe(true);
    expect(senderAllowed("a@trusted.org", "@trusted.org")).toBe(true);
    expect(senderAllowed("a@evil-trusted.org", "@trusted.org")).toBe(false);
  });
  test("fails closed when unset or empty", () => {
    expect(senderAllowed("me@example.com", undefined)).toBe(false);
    expect(senderAllowed("me@example.com", " , ")).toBe(false);
  });
});

describe("email capture", () => {
  test("journals a forwarded link with a normalized url", async () => {
    const m = mail(simple);
    await worker.email(m, env, ctx);
    await Promise.all(pending);
    expect(m.rejected).toBeUndefined();
    const row = db.query("SELECT * FROM captures").get() as any;
    expect(row.source).toBe("email");
    expect(row.url).toBe("https://example.org/post");
    expect(row.title).toBe("Worth reading");
    expect(row.content_kind).toBe("article");
    expect(row.privacy_class).toBe("public");
    expect(queued).toHaveLength(1);
  });
  test("same Message-ID forwarded twice is one row", async () => {
    await worker.email(mail(simple), env, ctx);
    await worker.email(mail(simple), env, ctx);
    expect(count()).toBe(1);
  });
  test("rejects non-allowlisted senders and writes nothing", async () => {
    const m = mail(simple, "stranger@evil.com");
    await worker.email(m, env, ctx);
    expect(m.rejected).toBe("sender not allowed");
    expect(count()).toBe(0);
  });
  test("fails closed with no allowlist configured", async () => {
    env.ALLOWED_SENDERS = undefined;
    const m = mail(simple);
    await worker.email(m, env, ctx);
    expect(m.rejected).toBeDefined();
    expect(count()).toBe(0);
  });
  test("REQUIRE_AUTH_RESULTS rejects without a dkim/dmarc pass, accepts with one", async () => {
    env.REQUIRE_AUTH_RESULTS = "true";
    const bad = mail(simple, "me@example.com", { "authentication-results": "mx; spf=fail" });
    await worker.email(bad, env, ctx);
    expect(bad.rejected).toBe("sender authentication failed");
    const good = mail(simple, "me@example.com", { "authentication-results": "mx; dkim=pass header.d=example.com" });
    await worker.email(good, env, ctx);
    expect(good.rejected).toBeUndefined();
    expect(count()).toBe(1);
  });
  test("rejects oversize messages before parsing", async () => {
    const m = mail(simple);
    (m as any).rawSize = MAX_RAW + 1;
    await worker.email(m, env, ctx);
    expect(m.rejected).toBe("message too large");
  });
  test("html-only and base64 bodies are decoded; no link → note", async () => {
    const html = rfc([
      "From: me@example.com", "Subject: Idea", "Message-ID: <h1@example.com>",
      "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: base64", "",
      btoa("<p>Build a <b>capture</b> inbox</p><script>x()</script>"),
    ]);
    await worker.email(mail(html), env, ctx);
    const row = db.query("SELECT content, content_kind, url FROM captures").get() as any;
    expect(row.content).toContain("Build a capture inbox");
    expect(row.content).not.toContain("x()");
    expect(row.content_kind).toBe("note");
    expect(row.url).toBeNull();
  });
  test("an empty message is rejected, not journaled", async () => {
    const m = mail(rfc(["From: me@example.com", "Message-ID: <e@example.com>", "Content-Type: text/plain", "", ""]));
    await worker.email(m, env, ctx);
    expect(m.rejected).toMatch(/not capturable/);
    expect(count()).toBe(0);
  });
});
