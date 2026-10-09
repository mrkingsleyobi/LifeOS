/**
 * ISA metadata as the Pulse UI consumes it. The producer is hooks/lib/isa-meta.ts (ISASync writes it onto the
 * work.json row); this side re-validates before use, because work.json is a file on disk and may be old, hand-edited,
 * or from a different version. Anything that does not fit the shape is dropped, never coerced.
 */
export type Risk = "low" | "medium" | "high";
export type Verdict = "pass" | "concerns" | "fail";

export interface IsaMeta {
  goal?: string;
  densityScore?: number;
  divergenceRisk?: Risk;
  currentState?: string;
  idealState?: string;
  capabilities?: string[];
  auditVerdict?: Verdict;
  decisions?: { text: string; dead?: boolean; refined?: boolean }[];
  decisionCount?: number;
  verification?: string[];
  verificationCount?: number;
}

// The caps below mirror hooks/lib/isa-meta.ts (CAPS); change both together.
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max) : undefined);
const count = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < 100_000 ? (v as number) : undefined);

export function sanitizeMeta(x: unknown): IsaMeta | undefined {
  if (!x || typeof x !== "object" || Array.isArray(x)) return undefined;
  const m = x as Record<string, unknown>, out: IsaMeta = {};
  const goal = str(m.goal, 400); if (goal) out.goal = goal;
  if (typeof m.densityScore === "number" && Number.isFinite(m.densityScore)) out.densityScore = Math.max(0, Math.min(1, m.densityScore));
  if (m.divergenceRisk === "low" || m.divergenceRisk === "medium" || m.divergenceRisk === "high") out.divergenceRisk = m.divergenceRisk;
  const cs = str(m.currentState, 200); if (cs) out.currentState = cs;
  const is = str(m.idealState, 200); if (is) out.idealState = is;
  if (Array.isArray(m.capabilities)) { const c = m.capabilities.map(v => str(v, 60)).filter((v): v is string => !!v).slice(0, 40); if (c.length) out.capabilities = c; }
  if (m.auditVerdict === "pass" || m.auditVerdict === "concerns" || m.auditVerdict === "fail") out.auditVerdict = m.auditVerdict;
  if (Array.isArray(m.decisions)) {
    const d = m.decisions.flatMap((e: any) => { const t = str(e?.text, 400); return t ? [{ text: t, ...(e.dead === true ? { dead: true } : {}), ...(e.refined === true ? { refined: true } : {}) }] : []; }).slice(-8);
    if (d.length) out.decisions = d;
  }
  if (Array.isArray(m.verification)) { const v = m.verification.map(l => str(l, 400)).filter((l): l is string => !!l).slice(-12); if (v.length) out.verification = v; }
  const dc = count(m.decisionCount); if (dc !== undefined) out.decisionCount = dc;
  const vc = count(m.verificationCount); if (vc !== undefined) out.verificationCount = vc;
  return Object.keys(out).length ? out : undefined;
}
