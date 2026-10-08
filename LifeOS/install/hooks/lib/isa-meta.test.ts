import { describe, expect, test } from "bun:test";
import { extractIsaMeta, hasMeta, oneLine, parseVerdict } from "./isa-meta";

// Synthetic ISAs shaped from DOCUMENTATION/ISA/ISAFormat.md (no real ISA was available in the sandbox).
const FULL = `---
slug: demo
principal_stated_goal: "Ship the lane router without breaking the statusline"   # why
density_score: 0.42
divergence_risk: medium
current_state: "47 type errors blocking deploy"
ideal_state: "Zero type errors, deploy passes CI"
capabilities_invoked:
  - ISA
  - Forge        # delegate
  - ISA
iteration: 2
---

## Goal
x

## Decisions
- 2026-02-24 02:00: Chose X over Y because Z
- 2026-02-24 02:30: ❌ DEAD END: Tried B — failed because C
- 2026-02-24 03:00: refined: Goal sharpened

## Verification
- ISC-1: screenshot pass — proof/layout.png
- ISC-2: \`bun test\` 14/14 green — commit a1b2c3d
- Forge audit: concerns — two advisory findings

## Changelog
- nothing
`;

describe("extractIsaMeta", () => {
  test("reads every surfaced field", () => {
    const m = extractIsaMeta(FULL);
    expect(m).toMatchObject({ goal: "Ship the lane router without breaking the statusline", densityScore: 0.42, divergenceRisk: "medium",
      currentState: "47 type errors blocking deploy", idealState: "Zero type errors, deploy passes CI", auditVerdict: "concerns", decisionCount: 3, verificationCount: 3 });
    expect(m.capabilities).toEqual(["ISA", "Forge"]);                        // de-duplicated, order kept, comment stripped
    expect(m.decisions!.map(d => [!!d.dead, !!d.refined])).toEqual([[false, false], [true, false], [false, true]]);
  });
  test("a legacy ISA with none of the fields yields an empty meta (backwards compatible)", () => {
    const m = extractIsaMeta("---\nslug: old\nprogress: 1/2\n---\n\n## Goal\nold\n");
    expect(m).toEqual({}); expect(hasMeta(m)).toBe(false);
  });
  test("inline capability lists, null values and out-of-range numbers", () => {
    const m = extractIsaMeta("---\ncapabilities_invoked: [ISA, \"Forge\"]\nprincipal_stated_goal: null\ndensity_score: 7\ndivergence_risk: extreme\n---\n");
    expect(m.capabilities).toEqual(["ISA", "Forge"]); expect(m.goal).toBeUndefined();
    expect(m.densityScore).toBe(1); expect(m.divergenceRisk).toBeUndefined();   // clamped / unknown enum rejected
    expect(extractIsaMeta("---\ndensity_score: abc\n---\n").densityScore).toBeUndefined();
  });
  test("untrusted text: control characters and newlines collapse, lengths are capped", () => {
    const m = extractIsaMeta(`---\nprincipal_stated_goal: "a\\u0007b ${"x".repeat(900)}"\n---\n\n## Decisions\n- ${"y".repeat(900)}\n`);
    expect(m.goal!.length).toBeLessThanOrEqual(400); expect(m.decisions![0].text.length).toBeLessThanOrEqual(400);
    expect(oneLine("a\n\n b\t\u0000c", 50)).toBe("a b c");
  });
  test("lists are capped: only the newest decisions and verification lines are kept, counts stay exact", () => {
    const body = (n: number) => Array.from({ length: n }, (_, i) => `- item ${i}`).join("\n");
    const m = extractIsaMeta(`---\nslug: s\n---\n\n## Decisions\n${body(30)}\n\n## Verification\n${body(30)}\n`);
    expect(m.decisionCount).toBe(30); expect(m.decisions).toHaveLength(8); expect(m.decisions![7].text).toBe("item 29");
    expect(m.verificationCount).toBe(30); expect(m.verification).toHaveLength(12);
  });
  test("the section end is the next H2, and ### subsections or other headings do not leak in", () => {
    const m = extractIsaMeta("---\nslug: s\n---\n\n## Decisions\n- a\n### sub\n- b\n\n## Other\n- not a decision\n");
    expect(m.decisions!.map(d => d.text)).toEqual(["a", "b"]);
  });
  test("never throws on garbage", () => {
    for (const x of ["", "---", "---\n---", "## Decisions", "\u0000\u0001", null as any, undefined as any, 42 as any]) expect(() => extractIsaMeta(x)).not.toThrow();
  });
});

describe("parseVerdict", () => {
  test("needs 'audit' and a verdict word on one line; the latest audit wins", () => {
    expect(parseVerdict(["Forge audit: fail", "Forge audit: pass"])).toBe("pass");
    expect(parseVerdict(["ISC-1: screenshot pass", "ISC-2: failed once then ok"])).toBeUndefined();   // not an audit line
    expect(parseVerdict(["Cross-vendor audit — concerns raised"])).toBe("concerns");
    expect(parseVerdict(["Forge audit passed"])).toBe("pass");
  });
});
