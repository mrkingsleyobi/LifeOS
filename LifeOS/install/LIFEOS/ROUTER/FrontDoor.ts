#!/usr/bin/env bun
/**
 * FRONT DOOR — decides lane, effort, and strategy for one prompt.
 *
 * Pipeline (cheapest first):
 *   0. skip      slash commands, empty, system-injected text → no decision
 *   1. pinned    explicit "@sol" / "/lane astra" / "/fusion" / "/combo" in the prompt
 *   2. private   credential-shaped or RESTRICTED text → Private Pinned Lane, no Jev call
 *   3. depth     "think deeply"/"ultrathink" → max tier, xhigh, Fable (chain → Opus)
 *   4. signals   ONE Jev call answers every lane question (~0.3s);
 *                on timeout / no key / over budget → Heuristics.ts, source:"fallback"
 *   5. score     intelligence I ∈ [0,1], token volume T ∈ [0,1], effort E,
 *                hand-off gate H (≥ threshold or the work stays inline)
 *   6. lane      domain specialist → tier × vendor ladder → strategy → fallback chain
 *   7. govern    Decisions registry: shadow = advice only, enforce = directive
 *
 * The intelligence/token trade-off in one line: the work's INTELLIGENCE picks
 * the rung, its TOKEN VOLUME and shape pick the vendor. Judgment and taste go
 * to the Anthropic ladder (Opus/Fable); settled builds, bulk docs, and
 * exhaustive sweeps go to the OpenAI ladder (Luna → Terra → Sol → Astra),
 * where volume is cheaper and the second subscription spreads quota.
 */


import type { DataClass } from "../../hooks/lib/data-classification";
import { ask } from "../DECISIONS/Jev";
import { decide, loadRegistry, record, withinBudget, effectiveMode } from "../DECISIONS/Decisions";
import { QUESTIONS, type Signals, type NoulId } from "./LaneQuestions";
import { heuristicSignals } from "./Heuristics";
import { LANES, type LaneId } from "./Lanes";
import { resolveChain, type Strategy } from "./Strategies";
import { exhausted } from "./Quota";
import {
  ACK, DEPTH, PIN, STRAT, dataClassOf, decideLane, finalize, shouldSkip,
  type RouteDecision, type RouteInput,
} from "./Score";

export { score, vendorFor, decideLane, shouldSkip, dataClassOf, routerLine } from "./Score";
export type { RouteDecision, RouteInput, Score } from "./Score";

// ── the async front door ────────────────────────────────────────────────────
export async function route(input: RouteInput, opts: { jevTimeoutMs?: number; noJev?: boolean } = {}): Promise<RouteDecision | null> {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const { prompt } = input;
  if (shouldSkip(prompt)) return null;

  const caller = loadRegistry()["dispatch-advisor"];
  const dataClass = dataClassOf(prompt);
  const prevTail = (input.prevTail ?? "").slice(-800);

  // 1. explicit pins
  const pin = prompt.match(PIN)?.[1]?.toLowerCase();
  const strat = prompt.match(STRAT)?.[1]?.toLowerCase() as Strategy | undefined;
  if (pin || strat) {
    const s = heuristicSignals(prompt, prevTail);
    const base = decideLane(s, dataClass, { quota: exhausted });
    if (pin) {
      const lane = (pin === "helios" ? "cyber" : pin === "local" ? "private" : pin) as LaneId;
      // A pin can never move sensitive data off the box.
      if (base.lane !== "private" || lane === "private") {
        base.lane = lane; base.chain = [{ lane, ok: true }]; base.reasons.unshift(`pinned by prompt → ${LANES[lane].label}`);
        if (lane === "private") base.strategy = "private";
      }
    }
    if (strat && base.strategy !== "private") {
      base.strategy = strat; base.reasons.unshift(`/${strat} requested`);
      // Fusion's primary seat is the top in-family lane unless a lane was pinned.
      if (strat === "fusion" && !pin) { const r = resolveChain("fable", dataClass, exhausted); base.lane = r.pick; base.chain = r.chain; }
    }
    const d = finalize(base, dataClass, "pinned", "enforce", "act", ms());
    record({ caller: "dispatch-advisor", mode: "enforce", verdict: "act", p: 1, pick: d.lane, source: "pinned", session: input.sessionId, latencyMs: d.latencyMs });
    return d;
  }

  // 1b. bare acknowledgements never pay for a Jev call
  if (ACK.test(prompt.trim())) {
    const s = heuristicSignals(prompt, prevTail);
    return finalize(decideLane(s, dataClass, { quota: exhausted }), dataClass, "fast-path", "enforce", "do-not-act", ms());
  }

  // 2. private pinned lane — secrets / RESTRICTED never go to Jev or a cloud lane
  if (dataClass === "RESTRICTED") {
    const s = heuristicSignals(prompt, prevTail);
    s.sensitive = 1;
    const d = finalize(decideLane(s, dataClass, { quota: exhausted }), dataClass, "fast-path", "enforce", "act", ms());
    record({ caller: "private-lane-gate", mode: "enforce", verdict: "act", p: 1, pick: "private", source: "fast-path", reason: "RESTRICTED text", session: input.sessionId });
    return d;
  }

  // 3. depth phrase
  if (DEPTH.test(prompt)) {
    const s = heuristicSignals(prompt, prevTail);
    Object.assign(s, { reasoning: 0.95, judgment: Math.max(s.judgment, 0.7), costlyError: Math.max(s.costlyError, 0.6), askDepth: 0.95, weighMany: 0.8, scriptable: 0.05, decided: 0.1, quickOnce: 0.05, bareReaction: 0.02 });
    const base = decideLane(s, dataClass, { quota: exhausted });
    if (base.lane !== "private" && base.strategy !== "fusion") { const r = resolveChain("fable", dataClass, exhausted); base.lane = r.pick; base.chain = r.chain; }
    base.reasons.unshift("depth phrase → max tier");
    const d = finalize(base, dataClass, "fast-path", effectiveMode(caller), "act", ms());
    d.effort = "xhigh";
    record({ caller: "dispatch-advisor", mode: d.mode, verdict: "act", p: 1, pick: d.lane, source: "fast-path", reason: "depth phrase", session: input.sessionId });
    return d;
  }

  // 4. signals — Jev, else heuristics
  let s: Signals | null = null;
  let source: RouteDecision["source"] = "fallback";
  let jevModel: string | undefined;
  let cost = 0;
  if (!opts.noJev && withinBudget(caller)) {
    const r = await ask({ prompt, previous_reply_tail: prevTail }, QUESTIONS, { timeoutMs: opts.jevTimeoutMs ?? 2500 });
    if (r.ok) {
      const a = r.answers as Record<string, any>;
      const nouls = Object.fromEntries(Object.entries(a).filter(([k]) => k !== "domain").map(([k, v]) => [k, v.noul])) as Record<NoulId, number>;
      s = { ...nouls, domain: a.domain.choice, domainP: a.domain.probabilities?.[a.domain.choice] ?? a.domain.confidence ?? 0.5 };
      source = "jev"; jevModel = r.model; cost = r.usage.cost;
    }
  }
  s ??= heuristicSignals(prompt, prevTail);

  // 5–7. score, lane, govern
  const threshold = caller?.threshold ?? 0.5;
  const sensitiveThreshold = loadRegistry()["private-lane-gate"]?.threshold ?? 0.6;
  const base = decideLane(s, dataClass, { threshold, sensitiveThreshold, quota: exhausted });
  if (base.lane === "private") record({ caller: "private-lane-gate", mode: "enforce", verdict: "act", p: s.sensitive, pick: "private", source, session: input.sessionId });
  const gov = decide("dispatch-advisor", base.sc.handoff, { pick: base.lane, jevModel, latencyMs: ms(), cost, session: input.sessionId, reason: base.reasons.join("; "), source });
  return finalize(base, dataClass, source, gov.mode, gov.verdict, ms(), jevModel);
}

