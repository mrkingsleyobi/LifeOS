import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ISASync writes the meta onto the work.json row. LIFEOS_DIR is read at import time, so set it first and import dynamically.
let dir: string, U: typeof import("./isa-utils");
const saved = { LIFEOS_DIR: process.env.LIFEOS_DIR, PLUGIN: process.env.CLAUDE_PLUGIN_ROOT };
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "isa-sync-")); delete process.env.CLAUDE_PLUGIN_ROOT; process.env.LIFEOS_DIR = dir;
  mkdirSync(join(dir, "MEMORY", "STATE"), { recursive: true }); mkdirSync(join(dir, "MEMORY", "WORK", "demo"), { recursive: true });
  U = await import("./isa-utils");
});
afterAll(() => { rmSync(dir, { recursive: true, force: true }); for (const [k, v] of [["LIFEOS_DIR", saved.LIFEOS_DIR], ["CLAUDE_PLUGIN_ROOT", saved.PLUGIN]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

const ISA = (extra: string, body = "") => `---\nslug: demo\ntask: Demo run\nphase: climbing\nprogress: 0/1\n${extra}---\n\n## Claims\n- [ ] ISC-1: something\n\n${body}`;
const sync = (content: string) => {
  const p = join(dir, "MEMORY", "WORK", "demo", "ISA.md"); writeFileSync(p, content);
  U.syncToWorkJson(U.parseFrontmatter(content)!, p, content, "sess-1");
  return U.readRegistry().sessions.demo;
};

describe("syncToWorkJson carries the Pulse metadata", () => {
  test("a rich ISA puts meta on the row", () => {
    const row = sync(ISA('principal_stated_goal: "Ship it"\ndensity_score: 0.3\ndivergence_risk: high\ncapabilities_invoked:\n  - ISA\n  - Forge\n', "## Decisions\n- 2026-01-01 00:00: chose A\n\n## Verification\n- Forge audit: pass\n"));
    expect(row.meta).toMatchObject({ goal: "Ship it", densityScore: 0.3, divergenceRisk: "high", capabilities: ["ISA", "Forge"], auditVerdict: "pass", decisionCount: 1 });
  });
  test("an ISA with none of the fields adds no meta key (rows stay byte-identical to before)", () => {
    const row = sync(ISA(""));
    expect("meta" in row).toBe(false);
  });
});
