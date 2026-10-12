/**
 * SCORE — the Router's pure decision core: no I/O, no network, no fs.
 * Imported by FrontDoor.ts (the hook path) AND by the router-edge Worker, so the
 * laptop and the edge can never route the same signals differently.
 */

import { classifyText } from "../../hooks/lib/egress-class-core";
import { CLASS_RANK, type DataClass } from "../../hooks/lib/data-classification";
import type { EffortLevel, HarnessEffort } from "../TOOLS/models";
import type { Signals } from "./LaneQuestions";
import { SENSITIVE_SHAPES } from "./Heuristics";
import { LANES, LADDER, modelForLane, type LaneId } from "./Lanes";
import { resolveChain, reviewerFor, fusionPanel, type Strategy, type ChainCheck, type QuotaFn } from "./Strategies";

export type Mode = "shadow" | "enforce";

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
export const SYSTEM_TEXT = /^\s*<(?:task-notification|system-reminder|command-name|local-command|bash-|user-prompt-submit-hook)/;
export const DEPTH = /\b(?:think (?:deeply|hard|really hard|carefully)|ultrathink|max(?:imum)? intelligence)\b/i;
export const PIN = /(?:^|\s)(?:@|\/lane\s+)(inline|luna|terra|sol|astra|haiku|sonnet|opus|fable|gemini|grok|cyber|helios|private|local)\b/i;
export const STRAT = /(?:^|\s)\/(fusion|combo)\b/i;
export const ACK = /^(?:ok(?:ay)?|k|thanks?|thank you|thx|ty|nice|great|cool|perfect|lgtm|yes|yep|no|nope|sure|got it|👍|🙏)[.!\s]*$/i;

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
export function decideLane(s: Signals, dataClass: DataClass, opts: { quota?: QuotaFn; threshold?: number; sensitiveThreshold?: number } = {}) {
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

export function finalize(base: ReturnType<typeof decideLane>, dataClass: DataClass, source: RouteDecision["source"], mode: Mode, verdict: RouteDecision["verdict"], latencyMs: number, jevModel?: string): RouteDecision {
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

/** The one-line ROUTER readout (statusline + additionalContext). */
export function routerLine(d: RouteDecision): string {
  const strat = d.strategy === "combo" && d.combo ? `combo ${LANES[d.combo.producer].label}→${LANES[d.combo.reviewer].label}`
    : d.strategy === "fusion" && d.fusion ? `fusion ${d.fusion.members.map((m) => LANES[m].label).join("+")}→${LANES[d.fusion.synthesizer].label}`
    : d.strategy;
  const src = d.source === "jev" ? `Jev (p ${d.p.toFixed(2)})` : d.source;
  return `🧭 ROUTER: ${d.label} · ${d.tier.toUpperCase()} · ${d.effort} · ${strat} · ${d.mode === "enforce" ? "delegate" : "advise"} · ${src} · ${(d.latencyMs / 1000).toFixed(2)}s`;
}
