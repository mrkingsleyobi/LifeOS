import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ModelMix resolves HOME at import time, so the fixture HOME must exist before the module loads.
const HOME = mkdtempSync(join(tmpdir(), "mm-home-"));
let CODEX = mkdtempSync(join(tmpdir(), "mm-codex-"));
const LIFEOS = mkdtempSync(join(tmpdir(), "mm-lifeos-"));
process.env.HOME = HOME; process.env.CODEX_SESSIONS_DIR = CODEX; process.env.LIFEOS_DIR = LIFEOS;
const mm = await import("./ModelMix.ts");
// Every test gets its own codex directory: rollouts are stamped "now", so a shared one would leak across time windows.
beforeEach(() => { CODEX = mkdtempSync(join(tmpdir(), "mm-codex-")); process.env.CODEX_SESSIONS_DIR = CODEX; });

const pad = (n: number) => String(n).padStart(2, "0");
let seq = 0;
/** A codex rollout stamped "now" in local time (as codex does), naming `model` in a turn_context and ending at `out` output tokens. */
function rollout(model: string | null, out: number, whenMs = Date.now()) {
  const d = new Date(whenMs);
  const dir = join(CODEX, String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate()));
  mkdirSync(dir, { recursive: true });
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  const id = `${String(++seq).padStart(8, "0")}-aaaa-bbbb-cccc-dddddddddddd`;
  const lines = [JSON.stringify({ type: "session_meta", payload: { id } })];
  if (model) lines.push(JSON.stringify({ type: "turn_context", payload: { model } }));
  lines.push(JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { output_tokens: out } }, rate_limits: null } }));
  const p = join(dir, `rollout-${stamp}-${id}.jsonl`);
  writeFileSync(p, lines.join("\n") + "\n");
  const t = whenMs / 1000; utimesSync(p, t, t);
}

function session(id: string, agents: string[], opusTokens: number) {
  const proj = join(HOME, ".claude", "projects", "slug");
  mkdirSync(join(proj, id, "subagents"), { recursive: true });
  writeFileSync(join(proj, `${id}.jsonl`), JSON.stringify({ type: "assistant", message: { id: "m1", model: "claude-opus-5-5", usage: { output_tokens: opusTokens } } }) + "\n");
  agents.forEach((a, i) => {
    writeFileSync(join(proj, id, "subagents", `agent-${i}.meta.json`), JSON.stringify({ agentType: a }));
    writeFileSync(join(proj, id, "subagents", `agent-${i}.jsonl`), "{}\n"); // its mtime is "now": the attribution window
  });
}

describe("laneForOpenAIModel", () => {
  test("lane names inside the id; unknown gpt-* falls into the SOL (forge) bucket; non-OpenAI is null", () => {
    const L = mm.laneForOpenAIModel;
    expect([L("gpt-6-luna"), L("gpt-5.6-terra"), L("gpt-6-astra"), L("gpt-5.6-cyber")]).toEqual(["luna", "terra", "astra", "cyber"]);
    expect([L("gpt-6.1-sol"), L("gpt-5.6-sol"), L("gpt-5.5")]).toEqual(["forge", "forge", "forge"]);
    expect([L("gemini-3.1-pro"), L("grok-4.6"), L("claude-opus-5"), L("")]).toEqual([null, null, null, null]);
  });
});

describe("computeMix per-lane attribution (fixture of real Codex 0.160.0 rollout shape)", () => {
  test("each lane gets its own share; one denominator sums to 100", () => {
    session("s-mix", ["Luna", "Astra"], 600);
    rollout("gpt-6-luna", 300); rollout("gpt-6-astra", 100);
    const m = mm.computeMix("s-mix");
    expect(m.laneTokens).toMatchObject({ luna: 300, astra: 100, terra: 0, forge: 0 });
    expect(m.pct.high).toBe(60);
    expect(m.lanePct).toMatchObject({ luna: 30, astra: 10, terra: 0, forge: 0 });
    expect(Object.values(m.pct).reduce((a, b) => a + b, 0) + Object.values(m.lanePct).reduce((a, b) => a + b, 0)).toBe(100);
    expect(m.crossVendor).toBe(true);
  });
  test("Sol still lands in the forge (SOL) bucket, and forgeTokens/forgePct mirror it", () => {
    session("s-sol", ["Sol"], 100);
    rollout("gpt-6.1-sol", 100);
    const m = mm.computeMix("s-sol");
    expect(m.forgeTokens).toBe(100);
    expect(m.forgePct).toBe(50);
    expect(m.lanePct.forge).toBe(50);
  });
  test("a rollout with no readable model falls back to forge, never to a guessed lane", () => {
    session("s-nomodel", ["Luna"], 0);
    rollout(null, 40);
    const m = mm.computeMix("s-nomodel");
    expect(m.laneTokens.forge).toBe(40);
    expect(m.laneTokens.luna).toBe(0);
  });
  test("a rollout outside the dispatch window is ignored", () => {
    session("s-old", ["Terra"], 50);
    rollout("gpt-5.6-terra", 999, Date.now() - 3 * 3_600_000);
    expect(mm.computeMix("s-old").laneTokens.terra).toBe(0);
  });
  test("only a SOL dispatch lights the SOL (forge) flag; a Luna/Terra/Astra-only session does not", () => {
    session("s-luna-only", ["Luna"], 0);
    expect(mm.computeMix("s-luna-only")).toMatchObject({ crossVendor: true, forgeUsed: false });
    session("s-sol-used", ["Luna", "Sol"], 0);
    expect(mm.computeMix("s-sol-used").forgeUsed).toBe(true);
  });
  test("a session with no OpenAI dispatch reports zero lanes", () => {
    session("s-claude", [], 200);
    const m = mm.computeMix("s-claude");
    expect(m.laneTokens).toEqual({ forge: 0, luna: 0, terra: 0, astra: 0, cyber: 0 });
    expect(m.crossVendor).toBe(false);
  });
  test("two rollouts for the same lane add up", () => {
    session("s-two", ["Luna"], 0);
    rollout("gpt-6-luna", 25); rollout("gpt-6-luna", 75);
    expect(mm.computeMix("s-two").laneTokens.luna).toBe(100);
  });
});

describe("the shell contract the statusline evals", () => {
  test("prints mix_luna/terra/astra/cyber/forge as integers, each matching the statusline's grep", () => {
    session("s-cli", ["Luna", "Terra"], 100);
    rollout("gpt-6-luna", 60); rollout("gpt-5.6-terra", 40);
    const r = Bun.spawnSync(["bun", join(import.meta.dir, "ModelMix.ts"), "--session", "s-cli"], { env: { ...process.env, HOME, CODEX_SESSIONS_DIR: CODEX, LIFEOS_DIR: LIFEOS } });
    const out = r.stdout.toString();
    const accepted = out.split("\n").filter((l) => /^mix_(low|medium|high|max|forge|forge_used|luna|terra|astra|cyber)=[0-9]+$/.test(l));
    for (const k of ["mix_luna=30", "mix_terra=20", "mix_astra=0", "mix_cyber=0", "mix_forge=0", "mix_high=50"]) expect(accepted).toContain(k);
  });
});
