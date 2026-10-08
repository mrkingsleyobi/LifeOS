import { describe, expect, test } from "bun:test";
import { decide, effortOf, heuristicProbs, loadConfig, privacyGate, redact, scoreOf } from "./Policy";
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
