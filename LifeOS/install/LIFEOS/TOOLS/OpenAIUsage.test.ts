import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readOpenAIUsage } from "./OpenAIUsage";

let dir: string;
const saved = process.env.CODEX_SESSIONS_DIR;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "codex-")); process.env.CODEX_SESSIONS_DIR = dir; });
afterEach(() => { if (saved === undefined) delete process.env.CODEX_SESSIONS_DIR; else process.env.CODEX_SESSIONS_DIR = saved; });
const NOW = 1_800_000_000;
function rollout(day: string, name: string, lines: string[]) {
  const d = join(dir, "2026", "10", day); mkdirSync(d, { recursive: true });
  writeFileSync(join(d, `rollout-2026-10-${day}T10-00-00-${name}.jsonl`), lines.join("\n") + "\n");
}
const ev = (rl: unknown) => JSON.stringify({ payload: { type: "token_count", info: {}, rate_limits: rl } });

describe("OpenAIUsage", () => {
  test("no sessions directory: absent", () => {
    process.env.CODEX_SESSIONS_DIR = join(dir, "nope");
    expect(readOpenAIUsage(NOW).present).toBe(false);
  });
  test("API-key sessions log rate_limits: null (seen live): absent, not an error", () => {
    rollout("08", "a".repeat(8) + "-aaaa-aaaa-aaaa-" + "a".repeat(12), [ev(null)]);
    expect(readOpenAIUsage(NOW)).toEqual({ present: false, fiveHour: null, weekly: null });
  });
  test("a ChatGPT-login shape: weekly and 5-hour windows are told apart by length, not slot", () => {
    rollout("08", "b".repeat(8) + "-bbbb-bbbb-bbbb-" + "b".repeat(12), [ev({ primary: { used_percent: 13.2, window_minutes: 300, resets_at: NOW + 3600 }, secondary: { used_percent: 4.4, window_minutes: 10080, resets_at: NOW + 86400 } })]);
    const u = readOpenAIUsage(NOW);
    expect(u.weekly).toMatchObject({ pct: 4, windowMinutes: 10080 });
    expect(u.fiveHour).toMatchObject({ pct: 13, windowMinutes: 300 });
  });
  test("a plan with a single window reported as primary is still classified correctly", () => {
    rollout("08", "c".repeat(8) + "-cccc-cccc-cccc-" + "c".repeat(12), [ev({ primary: { used_percent: 50, window_minutes: 10080, resets_at: NOW + 100 } })]);
    expect(readOpenAIUsage(NOW).weekly?.pct).toBe(50);
  });
  test("an expired window reads 0%", () => {
    rollout("08", "d".repeat(8) + "-dddd-dddd-dddd-" + "d".repeat(12), [ev({ secondary: { used_percent: 90, window_minutes: 10080, resets_at: NOW - 5 } })]);
    expect(readOpenAIUsage(NOW).weekly?.pct).toBe(0);
  });
  test("the newest event wins, and a clipped trailing line is skipped", () => {
    rollout("08", "e".repeat(8) + "-eeee-eeee-eeee-" + "e".repeat(12), [ev({ secondary: { used_percent: 10, window_minutes: 10080, resets_at: NOW + 9 } }), ev({ secondary: { used_percent: 20, window_minutes: 10080, resets_at: NOW + 9 } }), '{"payload":{"rate_limits":{"seco']);
    expect(readOpenAIUsage(NOW).weekly?.pct).toBe(20);
  });
  test("newest rollout is preferred over an older one", () => {
    rollout("07", "f".repeat(8) + "-ffff-ffff-ffff-" + "f".repeat(12), [ev({ secondary: { used_percent: 11, window_minutes: 10080, resets_at: NOW + 9 } })]);
    rollout("08", "g".repeat(8) + "-gggg-gggg-gggg-" + "g".repeat(12), [ev({ secondary: { used_percent: 77, window_minutes: 10080, resets_at: NOW + 9 } })]);
    expect(readOpenAIUsage(NOW).weekly?.pct).toBe(77);
  });
});
