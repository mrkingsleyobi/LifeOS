import { describe, expect, test } from "bun:test";
import { loadConfig } from "./Config";
import { decide, effortOf, heuristicProbs, privacyGate, redact, scoreOf } from "./Policy";
import { laneModel } from "../TOOLS/models";

const cfg = loadConfig();
const run = (prompt: string) => {
  const facts = { chars: prompt.length, depthWords: /think deeply/i.test(prompt) };
  return decide(heuristicProbs(prompt, facts), facts, "heuristic", cfg);
};

describe("routing", () => {
  test("bulk templated work goes to the cheap lane", () => {
    expect(run("Write 40 job descriptions from this template, one per role").lane).toBe("luna");
  });
  test("deep architecture work never lands in a cheap lane", () => {
    const d = run("Why should we redesign the router architecture? Weigh the trade-offs and plan a migration strategy for the core system.");
    expect(["sol", "opus", "fable", "astra"]).toContain(d.lane); // heuristic is coarse; Jev refines
    expect(d.private).toBe(false);
  });
  test("code change in the sol band routes to opus", () => {
    const p = { needsDeepReasoning: 0.9, needsJudgmentUnderAmbiguity: 0.9, isCodeChange: 0.9 };
    expect(scoreOf(p, cfg)).toBeGreaterThanOrEqual(0.45);
    expect(scoreOf(p, cfg)).toBeLessThan(0.65);
    expect(decide(p, { chars: 500, depthWords: false }, "jev", cfg).lane).toBe("opus");
  });
  test("depth words force xhigh effort", () => {
    expect(effortOf(0.1, true, cfg)).toBe("xhigh");
  });
  test("every lane and fallback target resolves to a model", () => {
    for (const b of cfg.bands) expect(laneModel(b.lane)).toBeTruthy();
    for (const chain of Object.values(cfg.fallbackChains)) for (const l of chain) expect(laneModel(l)).toBeTruthy();
  });
});

describe("privacy lane", () => {
  test.each([
    ["my api_key=abcd1234efgh5678 is failing", "credential"],
    ["summarize my TELOS goals", "TELOS"],
    ["look at ~/.claude/LIFEOS/USER/PRINCIPAL/RESUME.md", "USER-zone"],
    ["-----BEGIN RSA PRIVATE KEY-----", "private key"],
  ])("gate catches %s", (prompt) => {
    expect(privacyGate(prompt)).not.toBeNull();
  });
  test("ordinary prompts pass the gate", () => {
    expect(privacyGate("summarize this article about caching")).toBeNull();
  });
  test("Jev-flagged sensitivity stays on Anthropic lanes", () => {
    const d = decide({ containsSensitiveOrPrivateData: 0.9, bulkRepetitiveTemplated: 0.9 }, { chars: 100, depthWords: false }, "jev", cfg);
    expect(d.private).toBe(true);
    expect(["fable", "opus", "sonnet"]).toContain(d.lane);
  });
  test("redaction strips emails, numbers and urls", () => {
    const r = redact("mail bob@example.com or call +1 (555) 123-4567 at https://x.io/a");
    expect(r).not.toMatch(/bob@|555|x\.io/);
  });
});

import { afterEach } from "bun:test";
import { evaluate, QUESTIONS } from "./JevCore";

describe("Jev wire flavors", () => {
  const real = globalThis.fetch;
  afterEach(() => { globalThis.fetch = real; });
  const answersWith = (field: string, p: number) => ({ answers: Object.fromEntries(Object.keys(QUESTIONS).map((k) => [k, { [field]: p }])) });
  const capture = (resp: unknown) => { const c: { url?: string; body?: any } = {}; globalThis.fetch = (async (u: string, init: any) => { c.url = u; c.body = JSON.parse(init.body); return new Response(JSON.stringify(resp)); }) as any; return c; };

  test("native: systemone, jev-latest, noul questions, reads .noul", async () => {
    const c = capture(answersWith("noul", 0.3));
    const p = await evaluate("k", "https://api.typesafe.ai", "hello", 1000, "native");
    expect(c.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(c.body.model).toBe("jev-latest");
    expect(Object.values(c.body.questions as Record<string, any>).every((q) => q.type === "noul")).toBe(true);
    expect(p!.needsDeepReasoning).toBe(0.3);
  });
  test("gateway: evaluate, typesafe-ai/jev, boolean questions, reads .probability", async () => {
    const c = capture(answersWith("probability", 0.8));
    const p = await evaluate("k", "https://ai-gateway.vercel.sh", "hello", 1000, "gateway");
    expect(c.url).toBe("https://ai-gateway.vercel.sh/v1/evaluate");
    expect(c.body.model).toBe("typesafe-ai/jev");
    expect(Object.values(c.body.questions as Record<string, any>).every((q) => q.type === "boolean")).toBe(true);
    expect(p!.needsDeepReasoning).toBe(0.8);
  });
  test("a 401 or an incomplete answer returns null so the router falls back to the heuristic", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 401 })) as any;
    expect(await evaluate("bad", "https://api.typesafe.ai", "x", 1000, "native")).toBeNull();
    capture({ answers: { needsDeepReasoning: { noul: 0.5 } } });
    expect(await evaluate("k", "https://api.typesafe.ai", "x", 1000, "native")).toBeNull();
  });
});

describe("security specialty lane (cyber / Helios)", () => {
  const facts = { chars: 200, depthWords: false };
  test("a security task routes to cyber when Jev is confident", () => {
    const d = decide({ isSecurityWork: 0.9, needsDeepReasoning: 0.5 }, facts, "jev", cfg);
    expect(d).toMatchObject({ lane: "cyber", private: false, fallback: ["sol", "fable"] });
    expect(laneModel(d.lane)).toBe("gpt-5.6-cyber");
  });
  test("below the threshold it routes by intelligence as usual", () => {
    expect(decide({ isSecurityWork: 0.4, bulkRepetitiveTemplated: 0.9 }, facts, "jev", cfg).lane).toBe("luna");
  });
  test("sensitivity beats the specialty lane: security work on secrets stays on Anthropic", () => {
    const d = decide({ isSecurityWork: 0.95, containsSensitiveOrPrivateData: 0.9 }, facts, "jev", cfg);
    expect(d.private).toBe(true);
    expect(["fable", "opus", "sonnet"]).toContain(d.lane);
  });
  test("the privacy gate still wins over everything for credential-bearing security prompts", () => {
    expect(privacyGate("pentest report: api_key=abcd1234efgh5678 was found in the repo")).not.toBeNull();
  });
  test("the heuristic recognizes security keywords", () => {
    expect(run("Analyze this CVE-2026-1234 exploit for the CTF").lane).toBe("cyber");
  });
});

import { pickJev } from "./JevCore";
describe("Jev credential picker + openrouter flavor", () => {
  test("order: openrouter, native, gateway; JEV_PROVIDER forces one; none → undefined", () => {
    expect(pickJev({ OPENROUTER_API_KEY: "o", TYPESAFE_API_KEY: "t", AI_GATEWAY_API_KEY: "g" })?.flavor).toBe("openrouter");
    expect(pickJev({ TYPESAFE_API_KEY: "t", AI_GATEWAY_API_KEY: "g" })?.flavor).toBe("native");
    expect(pickJev({ AI_GATEWAY_API_KEY: "g" })?.flavor).toBe("gateway");
    expect(pickJev({ OPENROUTER_API_KEY: "o", AI_GATEWAY_API_KEY: "g", JEV_PROVIDER: "gateway" })?.flavor).toBe("gateway");
    expect(pickJev({ JEV_PROVIDER: "native", OPENROUTER_API_KEY: "o" })).toBeUndefined();
    expect(pickJev({})).toBeUndefined();
  });
  test("openrouter: decisions endpoint, jev-1.13, noul questions WITH required criteria, reads .noul", async () => {
    const real = globalThis.fetch; const c: { url?: string; body?: any } = {};
    globalThis.fetch = (async (u: string, init: any) => { c.url = u; c.body = JSON.parse(init.body); return new Response(JSON.stringify({ answers: Object.fromEntries(Object.keys(QUESTIONS).map((k) => [k, { type: "noul", noul: 0.7 }])), usage: { input_tokens: 5, output_tokens: 0 } })); }) as any;
    try {
      const p = await evaluate("k", "https://openrouter.ai", "hello", 1000, "openrouter");
      expect(c.url).toBe("https://openrouter.ai/api/alpha/decisions");
      expect(c.body.model).toBe("typesafe/jev-1.13");
      for (const q of Object.values(c.body.questions as Record<string, any>)) { expect(q.type).toBe("noul"); expect(Object.keys(q.criteria).sort()).toEqual(["false", "true"]); }
      expect(p!.isSecurityWork).toBe(0.7);
    } finally { globalThis.fetch = real; }
  });
});

import { resolve } from "./Router";
import { jevEgressOn } from "./Policy";

describe("Jev egress is opt-in (privacy)", () => {
  const real = globalThis.fetch; const saved = { ...process.env };
  afterEach(() => { globalThis.fetch = real; for (const k of ["OPENROUTER_API_KEY", "ROUTER_JEV_EGRESS", "JEV_PROVIDER", "ROUTER_WORKER_URL", "ROUTER_WORKER_TOKEN"]) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
  const arm = () => { let calls = 0; const answers = Object.fromEntries(Object.keys(QUESTIONS).map((k) => [k, { noul: 0.1 }])); globalThis.fetch = (async () => { calls++; return new Response(JSON.stringify({ answers })); }) as any; return () => calls; };

  test("jevEgressOn: default off; env overrides lanes.json; only exactly 'on' enables", () => {
    expect(jevEgressOn(cfg)).toBe(false);
    expect(jevEgressOn(cfg, "on")).toBe(true);
    expect(jevEgressOn({ ...cfg, jev: { ...cfg.jev, egress: "on" } })).toBe(true);
    expect(jevEgressOn({ ...cfg, jev: { ...cfg.jev, egress: "on" } }, "off")).toBe(false);
    expect(jevEgressOn(cfg, "yes")).toBe(false);
  });
  test("a key in the environment alone does NOT send the prompt anywhere", async () => {
    process.env.OPENROUTER_API_KEY = "k"; delete process.env.ROUTER_JEV_EGRESS; delete process.env.ROUTER_WORKER_URL; process.env.JEV_PROVIDER = "openrouter";
    const calls = arm();
    const d = await resolve("Please plan my weekend and mention my doctor appointment");
    expect(calls()).toBe(0);
    expect(d.source).toBe("heuristic");
  });
  test("ROUTER_JEV_EGRESS=on enables it; the privacy gate still stops sensitive prompts first", async () => {
    process.env.OPENROUTER_API_KEY = "k"; process.env.ROUTER_JEV_EGRESS = "on"; process.env.JEV_PROVIDER = "openrouter";
    const calls = arm();
    expect((await resolve("Write 40 job descriptions from this template")).source).toBe("jev");
    expect(calls()).toBe(1);
    const gated = await resolve("my api_key=abcd1234efgh5678 stopped working");
    expect(gated.private).toBe(true);
    expect(calls()).toBe(1); // no second call: the gate fired before any network
  });
});
