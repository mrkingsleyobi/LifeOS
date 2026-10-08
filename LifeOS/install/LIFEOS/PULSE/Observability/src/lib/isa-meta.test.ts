import { describe, expect, test } from "bun:test";
import { sanitizeMeta } from "./isa-meta";

describe("sanitizeMeta (work.json is a file on disk: re-validate before the UI trusts it)", () => {
  test("keeps a well-formed meta", () => {
    expect(sanitizeMeta({ goal: "g", densityScore: 0.5, divergenceRisk: "low", auditVerdict: "pass", capabilities: ["ISA"], decisions: [{ text: "d", dead: true }], decisionCount: 4, verification: ["v"], verificationCount: 2 }))
      .toEqual({ goal: "g", densityScore: 0.5, divergenceRisk: "low", auditVerdict: "pass", capabilities: ["ISA"], decisions: [{ text: "d", dead: true }], decisionCount: 4, verification: ["v"], verificationCount: 2 });
  });
  test("drops wrong types and unknown enums, never coerces", () => {
    expect(sanitizeMeta({ goal: 5, densityScore: "0.5", divergenceRisk: "extreme", auditVerdict: "ok", capabilities: "ISA", decisions: "x", decisionCount: -1, verificationCount: 1.5 })).toBeUndefined();
    expect(sanitizeMeta({ densityScore: 7 })!.densityScore).toBe(1);
    expect(sanitizeMeta({ densityScore: NaN })).toBeUndefined();
  });
  test("non-objects and empty objects give undefined", () => { for (const x of [null, undefined, "s", 3, [], {}]) expect(sanitizeMeta(x)).toBeUndefined(); });
  test("caps lengths and counts, strips control characters, keeps the newest list items", () => {
    const m = sanitizeMeta({ goal: "a\u0007b" + "x".repeat(900), capabilities: Array.from({ length: 80 }, (_, i) => `c${i}`),
      decisions: Array.from({ length: 20 }, (_, i) => ({ text: `d${i}` })), verification: Array.from({ length: 30 }, (_, i) => `v${i}`) })!;
    expect(m.goal!.length).toBe(400); expect(m.goal).not.toContain("\u0007");
    expect(m.capabilities).toHaveLength(40); expect(m.decisions).toHaveLength(8); expect(m.decisions![7].text).toBe("d19");
    expect(m.verification).toHaveLength(12); expect(m.verification![11]).toBe("v29");
  });
  test("junk list entries are skipped, not fatal", () => {
    expect(sanitizeMeta({ decisions: [null, 3, { text: "" }, { text: "ok", dead: "yes" }], capabilities: [1, "", "A"] }))
      .toEqual({ decisions: [{ text: "ok" }], capabilities: ["A"] });
  });
});
