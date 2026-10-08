import { afterEach, describe, expect, test } from "bun:test";
import worker, { type Env } from "./src/index";
import { QUESTIONS } from "../JevCore";

const env: Env = { ROUTER_TOKEN: "t0ken", AI_GATEWAY_API_KEY: "k" };
const call = (body: unknown, token = "t0ken", path = "/route", method = "POST") =>
  worker.fetch(new Request(`https://x.test${path}`, { method, headers: { Authorization: `Bearer ${token}` }, body: method === "POST" ? JSON.stringify(body) : undefined }), env);

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const mockJev = (p: number) => {
  const answers = Object.fromEntries(Object.keys(QUESTIONS).map((k) => [k, { probability: p }]));
  globalThis.fetch = (async () => new Response(JSON.stringify({ answers }))) as any;
};

describe("arbol-a-router-decide", () => {
  test("rejects a bad token", async () => expect((await call({ prompt: "hi there" }, "nope")).status).toBe(401));
  test("rejects unknown routes", async () => expect((await call({}, "t0ken", "/other")).status).toBe(404));
  test("healthz needs no auth", async () => expect((await worker.fetch(new Request("https://x.test/healthz"), env)).status).toBe(200));
  test("validates the body", async () => expect((await call({ nope: 1 })).status).toBe(400));
  test("privacy gate short-circuits before Jev", async () => {
    let jevCalled = false;
    globalThis.fetch = (async () => { jevCalled = true; return new Response("{}"); }) as any;
    const r = await (await call({ prompt: "my api_key=abcd1234efgh5678 broke" })).json() as any;
    expect(r.private).toBe(true);
    expect(jevCalled).toBe(false);
  });
  test("uses Jev when available", async () => {
    mockJev(0.1);
    const r = await (await call({ prompt: "summarize these notes into bullets" })).json() as any;
    expect(r.source).toBe("jev");
  });
  test("falls back to heuristic when Jev errors", async () => {
    globalThis.fetch = (async () => new Response("boom", { status: 500 })) as any;
    const r = await (await call({ prompt: "summarize these notes into bullets" })).json() as any;
    expect(r.source).toBe("heuristic");
  });
  test("Jev-flagged sensitive stays private", async () => {
    mockJev(0.95);
    const r = await (await call({ prompt: "plain looking text about something" })).json() as any;
    expect(r.private).toBe(true);
  });
  test("caps payload size", async () => expect((await call({ prompt: "x".repeat(40_000) })).status).toBe(413));
});
