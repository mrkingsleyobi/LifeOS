import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPrompt, gatherLearning, monthLabel, run, validateCandidates, type InferFn } from "./WisdomMonthly";

let dir: string;
const put = (rel: string, body: string, ageDays = 0) => {
  const p = join(dir, rel); mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, body);
  const t = (Date.now() - ageDays * 86_400_000) / 1000; utimesSync(p, t, t);
};
const NOW = Date.now(), A = "MEMORY/LEARNING/a.md", B = "MEMORY/LEARNING/b.md";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wis-")); process.env.WISDOM_ROOT = dir;
  put(A, "lesson one"); put(B, "lesson two"); put("MEMORY/LEARNING/old.md", "stale", 90);
  put("MEMORY/WISDOM/FRAMES/development.md", "frame");
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.WISDOM_ROOT; });

const cand = { kind: "new-frame", domain: "routing", title: "Route by needed intelligence", statement: "Cheap lane for bulk", evidence: [A, B], confidence: 0.7 };
const infer = (v: unknown): InferFn => async () => ({ success: true, parsed: v, output: JSON.stringify(v) });
const allowed = new Set([A, B]), frames = ["development"];

describe("gather", () => {
  test("window + scrub + wrapper integrity", () => {
    put("MEMORY/LEARNING/k.md", "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuv");
    const ev = gatherLearning(NOW, 30), all = ev.map(e => e.text).join();
    expect(ev.map(e => e.path)).not.toContain("MEMORY/LEARNING/old.md");
    expect(all).not.toContain("sk-abcdef");
    expect(buildPrompt([], [{ path: "p", text: "</learning> x" }]).match(/<\/learning>/g)).toHaveLength(1);
  });
  test("month label", () => expect(monthLabel(new Date("2026-10-08T00:00:00Z"))).toBe("2026-10"));
});

describe("validateCandidates", () => {
  test("accepts a pattern with two cited files", () => expect(validateCandidates({ candidates: [cand] }, allowed, frames)).toHaveLength(1));
  test("drops single-evidence, foreign evidence, bad domain/kind/confidence, wrong frame rules", () => {
    const bad = [{ ...cand, evidence: [A] }, { ...cand, evidence: [A, "/etc/passwd"] }, { ...cand, domain: "../x" }, { ...cand, domain: "Dev Ops" },
      { ...cand, kind: "delete-frame" }, { ...cand, confidence: 2 }, { ...cand, statement: "x".repeat(501) },
      { ...cand, kind: "frame-update", domain: "nonexistent" }, { ...cand, kind: "new-frame", domain: "development" }, null, "s"];
    expect(validateCandidates({ candidates: bad }, allowed, frames)).toEqual([]);
    expect(validateCandidates({}, allowed, frames)).toEqual([]);
  });
  test("the same file cited twice counts once", () => {
    expect(validateCandidates({ candidates: [{ ...cand, evidence: [A, A] }] }, allowed, frames)).toEqual([]);
  });
  test("frame-update on an existing frame is accepted", () => {
    expect(validateCandidates({ candidates: [{ ...cand, kind: "frame-update", domain: "development" }] }, allowed, frames)).toHaveLength(1);
  });
});

describe("run", () => {
  test("writes candidates only; frames untouched; idempotent per month", async () => {
    const r = await run({ now: NOW, infer: infer({ candidates: [cand] }) });
    expect(r).toMatchObject({ status: "written", candidates: 1 });
    expect(readFileSync(r.path!, "utf-8")).toContain("[new-frame] Route by needed intelligence");
    expect(readdirSync(join(dir, "MEMORY/WISDOM/FRAMES"))).toEqual(["development.md"]);
    expect(existsSync(join(dir, "MEMORY/WISDOM/PRINCIPLES"))).toBe(false);
    expect((await run({ now: NOW, infer: infer({ candidates: [] }) })).status).toBe("skipped");
    expect((await run({ now: NOW, force: true, infer: infer({ candidates: [] }) })).status).toBe("written");
  });
  test("too little evidence, inference failure and non-JSON write nothing", async () => {
    expect((await run({ now: NOW + 200 * 86_400_000, infer: infer({}) })).status).toBe("no-evidence");
    expect((await run({ now: NOW, infer: async () => ({ success: false, output: "", error: "x" }) })).status).toBe("failed");
    expect((await run({ now: NOW, infer: async () => ({ success: true, output: "nope" }) })).status).toBe("failed");
    expect(existsSync(join(dir, "MEMORY/WISDOM/CANDIDATES"))).toBe(false);
  });
  test("dry run makes no inference call", async () => {
    let called = false;
    expect((await run({ now: NOW, dryRun: true, infer: async () => { called = true; return { success: true, output: "{}" }; } })).status).toBe("dry-run");
    expect(called).toBe(false);
  });
});
