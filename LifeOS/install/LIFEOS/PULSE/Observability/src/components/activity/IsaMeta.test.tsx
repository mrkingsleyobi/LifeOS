import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CapabilitiesStrip, DecisionsPanel, DensityBadge, ForgeAuditBadge, GoalBadge, GoalPanel, IsaMetaBadges, IsaMetaDetail, JourneyStrip, VerificationPanel } from "./IsaMeta";

const html = (el: any) => renderToStaticMarkup(el);
const full = { goal: "Ship it", densityScore: 0.42, divergenceRisk: "medium" as const, currentState: "47 errors", idealState: "zero errors", capabilities: ["ISA", "Forge"],
  auditVerdict: "concerns" as const, decisions: [{ text: "chose A" }, { text: "tried B", dead: true }, { text: "refined: goal", refined: true }], decisionCount: 11, verification: ["ISC-1: ok"], verificationCount: 1 };

describe("badges", () => {
  test("each renders from its field and nothing without it (older ISAs look unchanged)", () => {
    expect(html(<GoalBadge meta={full} />)).toContain("GOAL");
    expect(html(<DensityBadge meta={full} />)).toContain("D 0.42");
    expect(html(<DensityBadge meta={full} />)).toContain("medium");
    expect(html(<ForgeAuditBadge meta={full} />)).toContain("audit ⚠");
    for (const C of [GoalBadge, DensityBadge, ForgeAuditBadge, IsaMetaBadges]) { expect(html(<C meta={undefined} />)).toBe(""); expect(html(<C meta={{}} />)).toBe(""); }
  });
  test("density shows a lone risk or a lone score", () => {
    expect(html(<DensityBadge meta={{ divergenceRisk: "high" }} />)).toContain("high");
    expect(html(<DensityBadge meta={{ densityScore: 0.9 }} />)).toContain("D 0.90");
  });
  test("verdict colours differ", () => {
    const a = html(<ForgeAuditBadge meta={{ auditVerdict: "pass" }} />), b = html(<ForgeAuditBadge meta={{ auditVerdict: "fail" }} />);
    expect(a).toContain("audit ✓"); expect(b).toContain("audit ✕"); expect(a).not.toBe(b);
  });
});

describe("strips and panels", () => {
  test("JourneyStrip: endpoints, dot progress, and the fallback when only one endpoint exists", () => {
    const out = html(<JourneyStrip meta={full} done={3} total={11} />);
    expect(out).toContain("47 errors"); expect(out).toContain("zero errors"); expect(out).toContain("3/11 verified");
    expect(out.match(/bg-emerald-400/g)).toHaveLength(Math.round((3 / 11) * 11));
    expect(html(<JourneyStrip meta={{ idealState: "only ideal" }} done={0} total={0} />)).toContain("—");
    expect(html(<JourneyStrip meta={{ goal: "g" }} done={1} total={2} />)).toBe("");   // neither endpoint: nothing
  });
  test("a huge claim count is drawn as at most 24 dots", () => {
    expect((html(<JourneyStrip meta={full} done={50} total={100} />).match(/rounded-full/g) ?? []).length).toBeLessThanOrEqual(24);
  });
  test("CapabilitiesStrip, GoalPanel, DecisionsPanel (with the 'earlier' note), VerificationPanel", () => {
    expect(html(<CapabilitiesStrip meta={full} />)).toContain("Forge");
    expect(html(<GoalPanel meta={full} />)).toContain("Ship it");
    const d = html(<DecisionsPanel meta={full} />);
    expect(d).toContain("Decisions (11)"); expect(d).toContain("+8 earlier"); expect(d).toContain("tried B");
    const v = html(<VerificationPanel meta={full} />);
    expect(v).toContain("ISC-1: ok"); expect(v).toContain("audit ⚠");
    for (const C of [CapabilitiesStrip, GoalPanel, DecisionsPanel, VerificationPanel]) expect(html(<C meta={{}} />)).toBe("");
  });
  test("IsaMetaDetail renders everything, and nothing without meta", () => {
    const out = html(<IsaMetaDetail meta={full} done={1} total={2} />);
    for (const id of ["journey-strip", "goal-panel", "capabilities-strip", "decisions-panel", "verification-panel"]) expect(out).toContain(id);
    expect(html(<IsaMetaDetail meta={undefined} done={0} total={0} />)).toBe("");
  });
});

describe("untrusted text is escaped, never interpreted", () => {
  test("markup in a goal, decision or capability is rendered as text", () => {
    const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const out = html(<IsaMetaDetail meta={{ goal: evil, currentState: evil, capabilities: [evil], decisions: [{ text: evil }], verification: [evil] }} done={0} total={0} />);
    expect(out).not.toContain("<script>"); expect(out).not.toContain("<img");
    expect(out).toContain("&lt;script&gt;");
  });
});
