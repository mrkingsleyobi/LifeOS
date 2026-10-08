/**
 * Audit — compare what the router advised with what the session actually dispatched.
 * For each logged decision, look at the first subagent start in the same session within WINDOW_MS.
 * No dispatch in the window is consistent with an `inline` decision and is reported separately otherwise.
 */
export interface LoggedDecision { ts: string; session?: string; lane: string; inline?: boolean; private?: boolean; source?: string }
export interface DispatchEvent { timestamp: string; event: string; session_id?: string; subagent_type?: string }

const LANE_AGENTS: Record<string, string[]> = {
  luna: ["Luna", "CodexResearcherFast"], terra: ["Terra"], sol: ["Sol", "Forge", "CodexResearcher"],
  opus: ["Opus"], fable: ["Fable", "Max"], astra: ["Astra"], cyber: ["Helios"],
};
export const WINDOW_MS = 10 * 60_000;

export interface Comparison {
  decisions: number; withDispatch: number; agreed: number; inlineConsistent: number; noDispatch: number;
  agreementRate: number | null; byLane: Record<string, { decisions: number; agreed: number; dispatchedOther: number }>;
}

export function compareDecisions(decisions: LoggedDecision[], events: DispatchEvent[]): Comparison {
  const starts = events.filter((e) => e.event === "subagent_start" && e.session_id && e.subagent_type)
    .map((e) => ({ t: Date.parse(e.timestamp), s: e.session_id!, a: e.subagent_type! })).filter((e) => Number.isFinite(e.t)).sort((x, y) => x.t - y.t);
  const out: Comparison = { decisions: 0, withDispatch: 0, agreed: 0, inlineConsistent: 0, noDispatch: 0, agreementRate: null, byLane: {} };
  for (const d of decisions) {
    const t0 = Date.parse(d.ts);
    if (!Number.isFinite(t0) || !d.session) continue;
    out.decisions++;
    const row = (out.byLane[d.lane] ??= { decisions: 0, agreed: 0, dispatchedOther: 0 });
    row.decisions++;
    const hit = starts.find((e) => e.s === d.session && e.t >= t0 && e.t - t0 <= WINDOW_MS);
    if (!hit) { if (d.inline || d.private) out.inlineConsistent++; else out.noDispatch++; continue; }
    out.withDispatch++;
    if ((LANE_AGENTS[d.lane] ?? []).some((a) => a.toLowerCase() === hit.a.toLowerCase())) { out.agreed++; row.agreed++; } else row.dispatchedOther++;
  }
  out.agreementRate = out.withDispatch ? Math.round((out.agreed / out.withDispatch) * 100) / 100 : null;
  return out;
}
