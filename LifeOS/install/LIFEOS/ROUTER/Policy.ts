/**
 * Policy — pure routing decision. No I/O, no model call, no node imports (it also runs inside the
 * Cloudflare Worker): probabilities in, lane out. File access lives in Config.ts.
 * Data (bands, weights, chains) lives in lanes.json; this file only applies it.
 */
export interface LanesConfig {
  mode: "shadow" | "enforce";
  bands: { max: number; lane: string }[];
  codeChangeOverride: { fromLane: string; toLane: string };
  weights: Record<string, number>;
  effort: { lowBelow: number; mediumBelow: number; highBelow: number };
  fallbackChains: Record<string, string[]>;
  fusion: { enabled: boolean; lanes: string[]; whenScoreAtLeast: number };
  privateLane: { allowedVendors: string[]; chain: string[] };
  jev: { timeoutMs: number; sensitiveThreshold: number };
}

export type Probs = Record<string, number>;
export interface Facts { chars: number; depthWords: boolean }
export interface Decision {
  lane: string;
  effort: "low" | "medium" | "high" | "xhigh";
  score: number;
  private: boolean;
  fusion: boolean;
  fallback: string[];
  source: "jev" | "heuristic" | "private-gate";
  reason: string;
}

/**
 * Deterministic privacy gate. Runs BEFORE anything leaves the box: a hit means the prompt is
 * never sent to Jev and never routed to a non-Anthropic lane. Conservative on purpose.
 */
const SENSITIVE: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  [/\b(sk|pk|xox[bap]|ghp|gho|AKIA|AIza)[-_A-Za-z0-9]{16,}/, "credential-like token"],
  [/\b(api[_-]?key|secret|password|passwd|token)\s*[:=]\s*\S{8,}/i, "credential assignment"],
  [/\b\d{3}-\d{2}-\d{4}\b/, "SSN-like number"],
  [/\b(?:\d[ -]?){13,16}\b/, "card-like number"],
  [/(^|[\s"'`(])~?\/?[^\s]*\bLIFEOS\/USER\//, "USER-zone path"],
  [/\bTELOS\b|\bPRINCIPAL_(IDENTITY|TELOS)\b/, "TELOS/identity material"],
  [/(^|[\s"'`(\/])\.env\b/, ".env reference"],
];
export function privacyGate(prompt: string): string | null {
  for (const [re, why] of SENSITIVE) if (re.test(prompt)) return why;
  return null;
}

/** Strip identifiers before a prompt goes to the Jev gateway. */
export function redact(prompt: string): string {
  return prompt
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[number]")
    .replace(/https?:\/\/\S+/g, "[url]");
}

export function scoreOf(p: Probs, cfg: LanesConfig): number {
  let s = 0;
  for (const [k, w] of Object.entries(cfg.weights)) s += w * (p[k] ?? 0);
  return Math.max(0, Math.min(1, s));
}

export function effortOf(score: number, depthWords: boolean, cfg: LanesConfig): Decision["effort"] {
  if (depthWords) return "xhigh";
  const e = cfg.effort;
  return score < e.lowBelow ? "low" : score < e.mediumBelow ? "medium" : score < e.highBelow ? "high" : "xhigh";
}

export function laneFor(score: number, p: Probs, cfg: LanesConfig): string {
  let lane = (cfg.bands.find(b => score < b.max) ?? cfg.bands[cfg.bands.length - 1]).lane;
  const o = cfg.codeChangeOverride;
  if (lane === o.fromLane && (p.isCodeChange ?? 0) >= 0.5) lane = o.toLane;
  return lane;
}

/** Keyword/length fallback when Jev is unreachable — coarse by design, always labeled `heuristic`. */
export function heuristicProbs(prompt: string, f: Facts): Probs {
  const t = prompt.toLowerCase();
  const has = (re: RegExp) => (re.test(t) ? 0.9 : 0);
  return {
    needsDeepReasoning: has(/\b(why|trade-?off|design|architect|root cause|prove|strategy|rethink)\b/),
    coreSystemOrArchitecture: has(/\b(architecture|doctrine|core|hook|router|system prompt)\b/),
    needsJudgmentUnderAmbiguity: f.chars > 1200 ? 0.6 : 0,
    multiStepPlanning: has(/\b(plan|steps|roadmap|migrate|refactor)\b/),
    highStakesOrIrreversible: has(/\b(delete|production|deploy|publish|release|security)\b/),
    creativeOrStrategic: has(/\b(brainstorm|idea|positioning|narrative)\b/),
    bulkRepetitiveTemplated: has(/\b(sds|jds?|job descriptions?|batch|each of|for every|bulk|template)\b/),
    formatBoundFromGivenContent: has(/\b(summari[sz]e|extract|reformat|convert|translate|classify)\b/),
    simpleLookupOrChat: f.chars < 80 ? 0.8 : 0,
    isCodeChange: has(/\b(implement|fix|bug|function|refactor|test|code)\b/),
  };
}

export function decide(p: Probs, f: Facts, source: "jev" | "heuristic", cfg: LanesConfig): Decision {
  const sensitive = (p.containsSensitiveOrPrivateData ?? 0) >= cfg.jev.sensitiveThreshold;
  if (sensitive) return privateDecision("Jev flagged sensitive content", cfg, "jev");
  const score = scoreOf(p, cfg);
  const lane = laneFor(score, p, cfg);
  return {
    lane, score, source,
    effort: effortOf(score, f.depthWords, cfg),
    private: false,
    fusion: cfg.fusion.enabled && score >= cfg.fusion.whenScoreAtLeast,
    fallback: cfg.fallbackChains[lane] ?? [],
    reason: `intelligence ${score.toFixed(2)} → ${lane}`,
  };
}

export function privateDecision(why: string, cfg: LanesConfig, source: Decision["source"] = "private-gate"): Decision {
  const [lane, ...rest] = cfg.privateLane.chain;
  return { lane, effort: "high", score: 1, private: true, fusion: false, fallback: rest, source, reason: `private lane: ${why}` };
}
