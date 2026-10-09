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

describe("review fixes", () => {
  const fm = (lines: string, body = "") => `---\nslug: s\n${lines}\n---\n\n${body}`;
  test("a quoted goal keeps its inner quotes (YAML escapes honoured)", () => {
    expect(extractIsaMeta(fm('principal_stated_goal: "say \\"hi\\" now"')).goal).toBe('say "hi" now');
    expect(extractIsaMeta(fm("principal_stated_goal: 'it''s ok'")).goal).toBe("it's ok");
    expect(extractIsaMeta(fm('principal_stated_goal: "plain"   # trailing comment')).goal).toBe("plain");
  });
  test("block scalars (> folded, | literal) are read, never stored as the indicator", () => {
    const m = extractIsaMeta(fm("principal_stated_goal: >\n  ship the router\n  without breaking things\ncurrent_state: |-\n  line one\n  line two\nideal_state: done"));
    expect(m.goal).toBe("ship the router without breaking things");
    expect(m.currentState).toBe("line one line two");   // newlines collapse in oneLine
    expect(m.idealState).toBe("done");
    expect(extractIsaMeta(fm("principal_stated_goal: >")).goal).toBeUndefined();
  });
  test("a block list at the same indent as its key is read", () => {
    expect(extractIsaMeta(fm("capabilities_invoked:\n- ISA\n- Forge\niteration: 2")).capabilities).toEqual(["ISA", "Forge"]);
  });
  test("verdicts: negated, compound and unfinished audit lines", () => {
    expect(parseVerdict(["Forge audit: no concerns, pass"])).toBe("pass");
    expect(parseVerdict(["Forge audit: pass (0 concerns)"])).toBe("pass");
    expect(parseVerdict(["Forge audit: concerns found"])).toBe("concerns");
    expect(parseVerdict(["Audit pending; previous audit failed"])).toBeUndefined();
    expect(parseVerdict(["Forge audit: not run yet"])).toBeUndefined();
    expect(parseVerdict(["Forge audit: failed"])).toBe("fail");
  });
  test("a fenced code block cannot spoof a section (quoted example ISAs, injected web text)", () => {
    const m = extractIsaMeta(fm("", "Example:\n```\n## Decisions\n- fake decision\n## Verification\n- Forge audit: pass\n```\n\n## Decisions\n- real decision\n"));
    expect(m.decisions!.map(d => d.text)).toEqual(["real decision"]);
    expect(m.auditVerdict).toBeUndefined();
    expect(extractIsaMeta(fm("", "~~~\n## Decisions\n- fake\n~~~\n")).decisions).toBeUndefined();
    expect(() => extractIsaMeta(fm("", "```\n## Decisions\n- never closed"))).not.toThrow();   // unterminated fence swallows the rest, safely
  });
  test("indented sub-bullets continue their entry instead of becoming entries", () => {
    const m = extractIsaMeta(fm("", "## Decisions\n- chose A\n  - because B\n  - and C\n- chose D\n"));
    expect(m.decisionCount).toBe(2); expect(m.decisions!.map(d => d.text)).toEqual(["chose A", "chose D"]);
  });
});
