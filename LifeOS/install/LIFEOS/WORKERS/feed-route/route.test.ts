import { describe, expect, test } from "bun:test";
import rules from "./rules.json";
import worker, { type Env } from "./src/index";
import { route, type RuleSet } from "./src/rules";

const set = rules as RuleSet;
const env: Env = { FEED_TOKEN: "tok" };
const post = (body: unknown, token = "tok") =>
  worker.fetch(new Request("https://x.test/route", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }), env);

describe("rules", () => {
  test("critical security notifies immediately", () => {
    expect(route({ id: "a", tier: "S", urgency: 9, labels: ["security"] }, set)).toMatchObject({ rule: "Critical security", destinations: ["notify"], priority: "immediate" });
  });
  test("high-quality AI content fans out to blog + social, daily", () => {
    expect(route({ id: "b", tier: "A", quality_score: 85, labels: ["AI"] }, set)).toMatchObject({ destinations: ["blog-draft", "social-post"], priority: "daily" });
  });
  test("digest material is weekly", () => {
    expect(route({ id: "c", tier: "B", importance: 7 }, set)).toMatchObject({ rule: "Weekly digest material", priority: "weekly" });
  });
  test("first match wins (security + breaking → security rule)", () => {
    expect(route({ id: "d", tier: "S", urgency: 10, labels: ["Security", "Breaking"] }, set).rule).toBe("Critical security");
  });
  test("a missing field is unknown, not zero: quality-only items archive", () => {
    expect(route({ id: "e", quality_score: 95 }, set)).toMatchObject({ rule: "Everything else", priority: "archive" });
  });
  test("boundary: urgency 7 does not trigger the >=8 rule", () => {
    expect(route({ id: "f", tier: "S", urgency: 7, labels: ["Security"] }, set).priority).toBe("archive");
  });
});

describe("arbol-a-feed-route", () => {
  test("auth, route and body validation", async () => {
    expect((await post({ items: [{ id: "x" }] }, "bad")).status).toBe(401);
    expect((await post({ items: [] })).status).toBe(400);
    expect((await post({ items: [{ id: "x", urgency: "high" }] })).status).toBe(400);
    expect((await worker.fetch(new Request("https://x.test/nope"), env)).status).toBe(404);
  });
  test("routes a batch", async () => {
    const r = (await (await post({ items: [{ id: "1", tier: "S", urgency: 9, labels: ["Security"] }, { id: "2" }] })).json()) as any;
    expect(r.routes.map((x: any) => x.priority)).toEqual(["immediate", "archive"]);
  });
  test("caps batch size", async () => {
    expect((await post({ items: Array.from({ length: 201 }, (_, i) => ({ id: String(i) })) })).status).toBe(400);
  });
});
