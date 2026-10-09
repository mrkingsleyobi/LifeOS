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

import { classifyText } from "../../hooks/lib/egress-class-core";
import { CLASS_RANK, type DataClass } from "../../hooks/lib/data-classification";
import type { EffortLevel, HarnessEffort } from "../TOOLS/models";
import { ask } from "../DECISIONS/Jev";
import { decide, loadRegistry, record, withinBudget, effectiveMode, type Mode } from "../DECISIONS/Decisions";
import { QUESTIONS, type Signals, type NoulId } from "./LaneQuestions";
import { heuristicSignals, SENSITIVE_SHAPES } from "./Heuristics";
import { LANES, LADDER, modelForLane, type LaneId } from "./Lanes";
import { resolveChain, reviewerFor, fusionPanel, type Strategy, type ChainCheck } from "./Strategies";

export interface RouteInput { prompt: string; prevTail?: string; sessionId?: string }

export interface RouteDecision {
  lane: LaneId;
  label: string;
  model: string;
  agent: string | null;
  tier: EffortLevel;
  effort: HarnessEffort;
  strategy: Strategy;
  combo?: { producer: LaneId; reviewer: LaneId };
  fusion?: { members: LaneId[]; synthesizer: LaneId };
  chain: ChainCheck[];
  /** Hand-off probability (the gate). */
  p: number;
  intelligence: number;
  tokens: number;
  dataClass: DataClass;
  source: "jev" | "fallback" | "fast-path" | "pinned";
  mode: Mode;
  verdict: "act" | "do-not-act";
  latencyMs: number;
  jevModel?: string;
  reasons: string[];
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));

// ── 0–3: deterministic paths ────────────────────────────────────────────────
const SYSTEM_TEXT = /^\s*<(?:task-notification|system-reminder|command-name|local-command|bash-|user-prompt-submit-hook)/;
const DEPTH = /\b(?:think (?:deeply|hard|really hard|carefully)|ultrathink|max(?:imum)? intelligence)\b/i;
const PIN = /(?:^|\s)(?:@|\/lane\s+)(inline|luna|terra|sol|astra|haiku|sonnet|opus|fable|gemini|grok|cyber|helios|private|local)\b/i;
const STRAT = /(?:^|\s)\/(fusion|combo)\b/i;
const ACK = /^(?:ok(?:ay)?|k|thanks?|thank you|thx|ty|nice|great|cool|perfect|lgtm|yes|yep|no|nope|sure|got it|👍|🙏)[.!\s]*$/i;

export function shouldSkip(prompt: string): boolean {
  const t = prompt.trim();
  return !t || SYSTEM_TEXT.test(t) || (t.startsWith("/") && !PIN.test(t) && !STRAT.test(t));
}

export function dataClassOf(prompt: string): DataClass {
  const c = classifyText(prompt);
  if (c === "PUBLIC" && SENSITIVE_SHAPES.some((re) => re.test(prompt))) return "CONFIDENTIAL";
  return c;
}

// ── 5: the scorer (pure — unit-tested) ──────────────────────────────────────
export interface Score { intelligence: number; tokens: number; handoff: number; effort: HarnessEffort; tier: EffortLevel }

export function score(s: Signals): Score {
  const pos = 0.25 * s.reasoning + 0.2 * s.judgment + 0.2 * s.expertHard + 0.2 * s.costlyError + 0.15 * s.weighMany;
  const neg = 0.4 * s.scriptable + 0.3 * s.decided + 0.3 * s.quickOnce;
  const intelligence = clamp(0.1 + pos - 0.3 * neg + 0.15 * s.askDepth);
  const tokens = clamp(0.4 * s.bulk + 0.25 * s.breadth + 0.2 * s.exhaustive + 0.15 * s.longOutput);
  // A recognised specialist domain is substantive work in its own right.
  const specialist = s.domain !== "general" ? 0.75 * s.domainP : 0;
  const substance = Math.max(s.build, s.exhaustive, s.review, s.reasoning, s.bulk, s.judgment * 0.8, specialist);
  const handoff = clamp(substance * (1 - s.bareReaction) * (1 - 0.3 * s.corrects));
  const e = 0.35 * s.costlyError + 0.25 * s.weighMany + 0.25 * s.askDepth + 0.15 * (1 - s.quickOnce) - 0.15 * s.breadth;
  const effort: HarnessEffort = e >= 0.62 ? "xhigh" : e >= 0.42 ? "high" : e >= 0.24 ? "medium" : "low";
  let tier: EffortLevel = intelligence >= 0.72 ? "max" : intelligence >= 0.5 ? "high" : intelligence >= 0.3 ? "medium" : "low";
  // Risky changes (deploys, secrets, migrations) never run below the high rung.
  if (s.risky >= 0.6 && s.build >= 0.5 && (tier === "low" || tier === "medium")) tier = "high";
  // Real build work (not bulk, not a script) floors at the medium rung.
  else if (tier === "low" && s.build >= 0.6 && s.bulk < 0.5 && s.scriptable < 0.7) tier = "medium";
  return { intelligence, tokens, handoff, effort, tier };
}

/** Which vendor ladder the work belongs on. */
export function vendorFor(s: Signals, sc: Score): { vendor: "openai" | "anthropic"; why: string } {
  if (s.exhaustive >= 0.6) return { vendor: "openai", why: "exhaustive coverage / needle search" };
  if (s.review >= 0.6 && sc.tier === "max") return { vendor: "anthropic", why: "second opinion on max work → Fable" };
  const judgmentHeavy = s.judgment >= 0.55 || (s.reasoning >= 0.6 && s.build < 0.5) || s.weighMany >= 0.65;
  if (judgmentHeavy && sc.tokens < 0.45) return { vendor: "anthropic", why: "judgment/taste-centred" };
  if (sc.tokens >= 0.45) return { vendor: "openai", why: `token-heavy (T=${sc.tokens.toFixed(2)})` };
  if (s.build >= 0.6 && (s.decided >= 0.5 || s.scriptable >= 0.5)) return { vendor: "openai", why: "settled build with a testable target" };
  if (s.build >= 0.6) return { vendor: "openai", why: "build/change work" };
  return { vendor: "anthropic", why: "default in-family" };
}

/** Pure decision from signals — everything except I/O and governance. */
export function decideLane(s: Signals, dataClass: DataClass, opts: { quota?: (v: "anthropic" | "openai" | "fable") => boolean; threshold?: number; sensitiveThreshold?: number } = {}) {
  const sc = score(s);
  const reasons: string[] = [];
  const threshold = opts.threshold ?? 0.5;
  const sensitiveThreshold = opts.sensitiveThreshold ?? 0.6;

  // Sensitivity: a Jev "sensitive" yes OR RESTRICTED text pins the private lane.
  if (s.sensitive >= sensitiveThreshold || CLASS_RANK[dataClass] <= CLASS_RANK.RESTRICTED) {
    reasons.push(`sensitive (p=${s.sensitive.toFixed(2)}, class ${dataClass}) → private pinned lane`);
    return { sc, lane: "private" as LaneId, strategy: "private" as Strategy, reasons, chain: [{ lane: "private" as LaneId, ok: true }] };
  }

  if (sc.handoff < threshold) {
    reasons.push(`hand-off p=${sc.handoff.toFixed(2)} < ${threshold} → stays inline`);
    return { sc, lane: "inline" as LaneId, strategy: "tiered" as Strategy, reasons, chain: [{ lane: "inline" as LaneId, ok: true }] };
  }

  let lane: LaneId;
  if (s.domain === "security" && s.domainP >= 0.5) { lane = "cyber"; reasons.push("security domain → Helios/CYBER"); }
  else if (s.domain === "public_culture" && s.domainP >= 0.5 && dataClass === "PUBLIC") { lane = "grok"; reasons.push("public culture → GROK"); }
  else if (s.domain === "grounded_research" && s.domainP >= 0.6 && dataClass === "PUBLIC" && sc.tier !== "max") { lane = "gemini"; reasons.push("grounded public research → GEMINI"); }
  else {
    const v = vendorFor(s, sc);
    lane = LADDER[v.vendor][sc.tier];
    if (s.bulk >= 0.7) {
      // Bulk processing (SDS sheets, JDs, records) is volume, not intelligence:
      // it stays on the cheap OpenAI rungs — Terra at most unless the work is genuinely hard.
      lane = sc.tier === "low" ? "luna" : sc.tier === "max" ? "sol" : "terra";
      reasons.push(`bulk volume (p=${s.bulk.toFixed(2)}) → capped at ${LANES[lane].label}`);
    } else if (s.exhaustive >= 0.6) {
      // Exhaustive sweeps / needle search are Astra's job; only trivial ones drop to Sol.
      lane = sc.tier === "low" ? "sol" : "astra";
    }
    reasons.push(`I=${sc.intelligence.toFixed(2)} → ${sc.tier}; ${v.why} → ${LANES[lane].label}`);
  }

  let strategy: Strategy = "tiered";
  if (sc.tier === "max" && s.costlyError >= 0.6 && s.judgment >= 0.5) { strategy = "fusion"; reasons.push("max tier + costly error + judgment → fusion"); }
  else if ((s.risky >= 0.5 && s.build >= 0.5) || (s.build >= 0.6 && s.costlyError >= 0.5 && s.bulk < 0.7)) { strategy = "combo"; reasons.push("risky/costly build → combo (cross-vendor review)"); }

  const { pick, chain } = resolveChain(lane, dataClass, opts.quota);
  if (pick !== lane) reasons.push(`fallback ${LANES[lane].label} → ${LANES[pick].label}`);
  return { sc, lane: pick, strategy, reasons, chain };
}

function finalize(base: ReturnType<typeof decideLane>, dataClass: DataClass, source: RouteDecision["source"], mode: Mode, verdict: RouteDecision["verdict"], latencyMs: number, jevModel?: string): RouteDecision {
  const l = LANES[base.lane];
  let effort = base.sc.effort;
  if (!l.efforts.includes(effort)) effort = l.efforts[0];
  const d: RouteDecision = {
    lane: base.lane, label: l.label, model: modelForLane(base.lane), agent: l.agent,
    tier: base.lane === "inline" ? base.sc.tier : l.tier, effort, strategy: base.strategy, chain: base.chain,
    p: base.sc.handoff, intelligence: base.sc.intelligence, tokens: base.sc.tokens, dataClass,
    source, mode, verdict, latencyMs, jevModel, reasons: base.reasons,
  };
  if (base.strategy === "combo") d.combo = { producer: base.lane, reviewer: reviewerFor(base.lane) };
  if (base.strategy === "fusion") d.fusion = fusionPanel(dataClass);
  return d;
}

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
    const base = decideLane(s, dataClass);
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
      if (strat === "fusion" && !pin) { const r = resolveChain("fable", dataClass); base.lane = r.pick; base.chain = r.chain; }
    }
    const d = finalize(base, dataClass, "pinned", "enforce", "act", ms());
    record({ caller: "dispatch-advisor", mode: "enforce", verdict: "act", p: 1, pick: d.lane, source: "pinned", session: input.sessionId, latencyMs: d.latencyMs });
    return d;
  }

  // 1b. bare acknowledgements never pay for a Jev call
  if (ACK.test(prompt.trim())) {
    const s = heuristicSignals(prompt, prevTail);
    return finalize(decideLane(s, dataClass), dataClass, "fast-path", "enforce", "do-not-act", ms());
  }

  // 2. private pinned lane — secrets / RESTRICTED never go to Jev or a cloud lane
  if (dataClass === "RESTRICTED") {
    const s = heuristicSignals(prompt, prevTail);
    s.sensitive = 1;
    const d = finalize(decideLane(s, dataClass), dataClass, "fast-path", "enforce", "act", ms());
    record({ caller: "private-lane-gate", mode: "enforce", verdict: "act", p: 1, pick: "private", source: "fast-path", reason: "RESTRICTED text", session: input.sessionId });
    return d;
  }

  // 3. depth phrase
  if (DEPTH.test(prompt)) {
    const s = heuristicSignals(prompt, prevTail);
    Object.assign(s, { reasoning: 0.95, judgment: Math.max(s.judgment, 0.7), costlyError: Math.max(s.costlyError, 0.6), askDepth: 0.95, weighMany: 0.8, scriptable: 0.05, decided: 0.1, quickOnce: 0.05, bareReaction: 0.02 });
    const base = decideLane(s, dataClass);
    if (base.lane !== "private" && base.strategy !== "fusion") { const r = resolveChain("fable", dataClass); base.lane = r.pick; base.chain = r.chain; }
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
  const base = decideLane(s, dataClass, { threshold, sensitiveThreshold });
  if (base.lane === "private") record({ caller: "private-lane-gate", mode: "enforce", verdict: "act", p: s.sensitive, pick: "private", source, session: input.sessionId });
  const gov = decide("dispatch-advisor", base.sc.handoff, { pick: base.lane, jevModel, latencyMs: ms(), cost, session: input.sessionId, reason: base.reasons.join("; "), source });
  return finalize(base, dataClass, source, gov.mode, gov.verdict, ms(), jevModel);
}

/** The one-line ROUTER readout (statusline + additionalContext). */
export function routerLine(d: RouteDecision): string {
  const strat = d.strategy === "combo" && d.combo ? `combo ${LANES[d.combo.producer].label}→${LANES[d.combo.reviewer].label}`
    : d.strategy === "fusion" && d.fusion ? `fusion ${d.fusion.members.map((m) => LANES[m].label).join("+")}→${LANES[d.fusion.synthesizer].label}`
    : d.strategy;
  const src = d.source === "jev" ? `Jev (p ${d.p.toFixed(2)})` : d.source;
  return `🧭 ROUTER: ${d.label} · ${d.tier.toUpperCase()} · ${d.effort} · ${strat} · ${d.mode === "enforce" ? "delegate" : "advise"} · ${src} · ${(d.latencyMs / 1000).toFixed(2)}s`;
}
