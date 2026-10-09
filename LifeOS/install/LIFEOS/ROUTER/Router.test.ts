import { describe, expect, test, beforeAll } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

beforeAll(() => {
  // Ledger + state writes go to a throwaway tree; no Jev keys → heuristic path.
  process.env.LIFEOS_DIR = mkdtempSync(join(tmpdir(), "router-test-"));
  delete process.env.TYPESAFE_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  process.env.LIFEOS_JEV_ENV_FILE = "/dev/null";
  process.env.XDG_CACHE_HOME = process.env.LIFEOS_DIR;
  process.env.CODEX_HOME = join(process.env.LIFEOS_DIR, "codex");
});

import { decideLane, score, route, shouldSkip } from "./FrontDoor";
import { heuristicSignals } from "./Heuristics";
import { resolveChain, reviewerFor, fusionPanel } from "./Strategies";
import { LANES, modelForLane, ROSTER_ORDER, AGENT_ORDER } from "./Lanes";
import { isLoopback } from "./PrivateLane";
import { ask } from "../DECISIONS/Jev";
import { effectiveMode, DEFAULT_CALLERS } from "../DECISIONS/Decisions";
import type { Signals } from "./LaneQuestions";

const base = (o: Partial<Signals> = {}): Signals => ({
  build: 0.1, exhaustive: 0.1, risky: 0.1, review: 0.1, scriptable: 0.1, decided: 0.1, reasoning: 0.1, judgment: 0.1, expertHard: 0.1,
  breadth: 0.1, costlyError: 0.1, weighMany: 0.1, quickOnce: 0.5, askDepth: 0.1,
  approves: 0.1, bareReaction: 0.05, corrects: 0.05, newRequest: 0.9,
  bulk: 0.1, longOutput: 0.1, sensitive: 0.05, domain: "general", domainP: 0.5, ...o,
});
const noQuota = () => false;

describe("lane selection", () => {
  test("bulk low-intelligence work goes to Luna", () => {
    expect(decideLane(base({ bulk: 0.9, breadth: 0.9, scriptable: 0.8 }), "PUBLIC", { quota: noQuota }).lane).toBe("luna");
  });
  test("bulk medium work goes to Terra", () => {
    const s = base({ bulk: 0.9, breadth: 0.8, reasoning: 0.6, judgment: 0.3, costlyError: 0.4, quickOnce: 0.2, scriptable: 0.1 });
    expect(decideLane(s, "PUBLIC", { quota: noQuota }).lane).toBe("terra");
  });
  test("settled testable build at high intelligence goes to Sol", () => {
    const s = base({ build: 0.9, decided: 0.8, reasoning: 0.7, expertHard: 0.6, costlyError: 0.5, weighMany: 0.4, quickOnce: 0.2, scriptable: 0.1, judgment: 0.2 });
    expect(decideLane(s, "PUBLIC", { quota: noQuota }).lane).toBe("sol");
  });
  test("exhaustive sweeps go to Astra", () => {
    expect(decideLane(base({ exhaustive: 0.9, reasoning: 0.8, judgment: 0.4 }), "PUBLIC", { quota: noQuota }).lane).toBe("astra");
  });
  test("trivial sweeps stay on Sol (cost), not Astra", () => {
    expect(decideLane(base({ exhaustive: 0.9, scriptable: 0.8, quickOnce: 0.8 }), "PUBLIC", { quota: noQuota }).lane).toBe("sol");
  });
  test("judgment-heavy max work goes to Fable", () => {
    const s = base({ judgment: 0.95, reasoning: 0.95, expertHard: 0.9, weighMany: 0.9, costlyError: 0.4, quickOnce: 0.05, decided: 0.05 });
    expect(decideLane(s, "PUBLIC", { quota: noQuota }).lane).toBe("fable");
  });
  test("judgment at high tier goes to Opus", () => {
    const s = base({ judgment: 0.8, reasoning: 0.7, weighMany: 0.5, quickOnce: 0.3 });
    expect(decideLane(s, "PUBLIC", { quota: noQuota }).lane).toBe("opus");
  });
  test("bulk volume is capped below Astra even when Jev reads it as exhaustive", () => {
    const d = decideLane(base({ bulk: 0.95, exhaustive: 0.9, breadth: 0.9, reasoning: 0.7, quickOnce: 0.2 }), "PUBLIC", { quota: noQuota });
    expect(["luna", "terra", "sol"]).toContain(d.lane);
  });
  test("bare reactions stay inline", () => {
    expect(decideLane(base({ bareReaction: 0.95 }), "PUBLIC", { quota: noQuota }).lane).toBe("inline");
  });
});

describe("private pinned lane", () => {
  test("sensitive signal pins private, never a cloud lane", () => {
    const d = decideLane(base({ sensitive: 0.8, exhaustive: 0.9 }), "PUBLIC", { quota: noQuota });
    expect(d.lane).toBe("private");
    expect(d.strategy).toBe("private");
  });
  test("borderline sensitivity (job descriptions) stays on cloud lanes", () => {
    expect(decideLane(base({ sensitive: 0.43, bulk: 0.9 }), "PUBLIC", { quota: noQuota }).lane).not.toBe("private");
  });
  test("RESTRICTED class pins private", () => {
    expect(decideLane(base(), "RESTRICTED", { quota: noQuota }).lane).toBe("private");
  });
  test("credential in prompt routes private without Jev", async () => {
    const d = await route({ prompt: "debug this: sk-ant-abcdefghijklmnopqrstuvwxyz0123" });
    expect(d?.lane).toBe("private");
    expect(d?.source).toBe("fast-path");
  });
  test("a lane pin cannot move sensitive data off the box", async () => {
    const d = await route({ prompt: "@astra summarize my wife's medical record and lab results" });
    expect(d?.lane).toBe("private");
  });
  test("private lane refuses non-loopback endpoints", () => {
    expect(isLoopback("http://127.0.0.1:8080")).toBe(true);
    expect(isLoopback("http://localhost:8080")).toBe(true);
    expect(isLoopback("http://[::1]:8080")).toBe(true);
    expect(isLoopback("http://10.0.0.5:8080")).toBe(false);
    expect(isLoopback("https://api.example.com")).toBe(false);
  });
});

describe("strategies", () => {
  test("fallback chain skips a spent vendor", () => {
    const r = resolveChain("sol", "PUBLIC", (v) => v === "openai");
    expect(r.pick).toBe("opus");
    expect(r.chain[0]).toMatchObject({ lane: "sol", ok: false });
  });
  test("fable week spent falls to opus", () => {
    expect(resolveChain("fable", "PUBLIC", (v) => v === "fable").pick).toBe("opus");
  });
  test("public-ceiling lanes are skipped for confidential data", () => {
    expect(resolveChain("gemini", "CONFIDENTIAL", noQuota).pick).toBe("opus");
  });
  test("combo reviewer is always the other vendor", () => {
    expect(LANES[reviewerFor("sol")].vendor).toBe("anthropic");
    expect(LANES[reviewerFor("opus")].vendor).toBe("openai");
  });
  test("fusion panel drops public-only members for internal data", () => {
    expect(fusionPanel("INTERNAL").members).not.toContain("gemini");
    expect(fusionPanel("PUBLIC").members).toContain("gemini");
  });
  test("risky build gets a combo", () => {
    const d = decideLane(base({ build: 0.9, risky: 0.9, costlyError: 0.8 }), "PUBLIC", { quota: noQuota });
    expect(d.strategy).toBe("combo");
  });
});

describe("front door", () => {
  test("skips slash commands and system text", () => {
    expect(shouldSkip("/clear")).toBe(true);
    expect(shouldSkip("<task-notification>x</task-notification>")).toBe(true);
    expect(shouldSkip("/lane sol do it")).toBe(false);
  });
  test("heuristic fallback answers every question", () => {
    const s = heuristicSignals("Process these 300 SDS sheets into a CSV");
    expect(s.bulk).toBeGreaterThan(0.5);
    expect(score(s).tokens).toBeGreaterThan(0.45);
  });
  test("depth phrase forces max tier at xhigh", async () => {
    const d = await route({ prompt: "think deeply about how the memory system should evolve" });
    expect(d?.tier).toBe("max");
    expect(d?.effort).toBe("xhigh");
  });
});

describe("wiring", () => {
  test("every lane resolves a model", () => {
    for (const id of Object.keys(LANES) as (keyof typeof LANES)[]) expect(modelForLane(id)).toBeTruthy();
  });
  test("roster and agent panel only name real lanes", () => {
    for (const id of [...ROSTER_ORDER, ...AGENT_ORDER]) expect(LANES[id]).toBeDefined();
  });
});

describe("jev client", () => {
  test("parses typed answers through an injected fetch", async () => {
    process.env.TYPESAFE_API_KEY = "test";
    const fake = (async () => new Response(JSON.stringify({
      model: "jev-1.13-20260917",
      answers: { a: { type: "noul", noul: 0.9 }, b: { type: "choice", choice: "x", probabilities: { x: 0.8, y: 0.2 }, confidence: 0.7 } },
      usage: { input_tokens: 100, output_tokens: 0, cost: 0.0000042 },
    }))) as unknown as typeof fetch;
    const r = await ask("hello", { a: { type: "noul", instructions: "?" }, b: { type: "choice", instructions: "?", criteria: { x: "x", y: "y" } } }, { fetchImpl: fake });
    delete process.env.TYPESAFE_API_KEY;
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.answers.a.noul).toBe(0.9); expect(r.answers.b.choice).toBe("x"); }
  });
  test("refuses credential-shaped state", async () => {
    process.env.TYPESAFE_API_KEY = "test";
    const r = await ask("ghp_abcdefghijklmnopqrstuvwx", { a: { type: "noul", instructions: "?" } });
    delete process.env.TYPESAFE_API_KEY;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("secret-in-state");
  });
  test("incomplete answers are a failure, not a guess", async () => {
    process.env.TYPESAFE_API_KEY = "test";
    const fake = (async () => new Response(JSON.stringify({ answers: {} }))) as unknown as typeof fetch;
    const r = await ask("x", { a: { type: "noul", instructions: "?" } }, { fetchImpl: fake });
    delete process.env.TYPESAFE_API_KEY;
    expect(r.ok).toBe(false);
  });
});

describe("decisions governance", () => {
  test("measured enforcement drifts to shadow on a new Jev model", () => {
    const c = { ...DEFAULT_CALLERS["satisfaction-capture"], mode: "enforce" as const, measured: { agreement: 0.9, on: "2026-10-01", jevModel: "jev-1.13" } };
    expect(effectiveMode(c, "jev-1.13-20260917")).toBe("enforce");
    expect(effectiveMode(c, "jev-1.14-20261101")).toBe("shadow");
  });
  test("unmeasured enforce without override stays shadow", () => {
    const c = { ...DEFAULT_CALLERS["socrates-answer"], mode: "enforce" as const };
    expect(effectiveMode(c)).toBe("shadow");
  });
});
