#!/usr/bin/env bun
/**
 * MODELS — the tables code imports when it needs to name a model.
 *
 * Doctrine lives in OPERATIONAL_RULES § Model selection and Algorithm §Spend, never here.
 * This file holds data, not policy.
 *
 * Prefer a tier ALIAS ("opus"/"sonnet"/"haiku"/"fable") everywhere: the `claude` CLI resolves
 * an alias to the latest model in that tier, so an alias never goes stale and a pinned ID
 * always will. Import CURRENT only where an exact ID is contractually required — a REST path,
 * or a drift check that must name the expected latest.
 *
 * ON A NEW RELEASE: bump CURRENT (one edit), then `bun UpdateModels.ts --check`.
 */

export type ClaudeTier = "opus" | "sonnet" | "haiku" | "fable";

/** Intent levels. Consumers name a level, never a model name. */
export type EffortLevel = "max" | "high" | "medium" | "low";

/**
 * Level → tier. THE SINGLE EDIT POINT on a lineup change: if Fable leaves the subscription,
 * set `max: "opus"` and every consumer follows. `max` and `high` are distinct models, which is
 * what makes the Inference.ts max→high fallback a real degrade rather than a no-op.
 */
export const EFFORT_MODEL: Record<EffortLevel, ClaudeTier> = {
  max: "fable",   // top rung (~2× Opus)
  high: "opus",
  medium: "sonnet",
  low: "haiku",
};

/**
 * Do Agent dispatches execute Fable when asked (explicitly or by inheritance)?
 * CarrierProbe.ts compares live observation against this value and /ic fails on a stale
 * (>30d) or contradicted probe. Flip ONLY on transcript evidence — a subagent's self-report
 * is not evidence. Last probe: 2026-07-12 (true).
 */
export const DISPATCH_EXECUTES_FABLE = true;

/**
 * Three separate "level" dials — this file maps 1↔2:
 *   1. MODEL RUNG (EFFORT_MODEL): which Claude model runs.
 *   2. REASONING EFFORT (HarnessEffort): how hard a model thinks. Claude Code owns it
 *      (`/effort`, settings, `--effort`); a hook can read it but cannot set the main loop's
 *      value. LifeOS runs uniformly at `high`.
 *   3. COMPOSITION (ultracode): whether to fan a task into a multi-agent Workflow. Not an
 *      effort level; orthogonal to 1 and 2.
 */
export type HarnessEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** Every rung thinks at `high`; the MODEL rung still varies. Consumed by Inference.ts. */
export const UNIFORM_HARNESS_EFFORT: HarnessEffort = "high";

/** Auto-tracking alias for an effort level (preferred — never drifts). */
export function modelForEffort(level: EffortLevel): string {
  return EFFORT_MODEL[level];
}

/** Pinned ID for an effort level (only where an exact ID is required). */
export function pinnedModelForEffort(level: EffortLevel): string {
  return CURRENT[EFFORT_MODEL[level]];
}

/**
 * Current Claude model IDs. THE SINGLE EDIT POINT on a model release. Verify the exact string
 * against the models overview before bumping; `bun UpdateModels.ts --apply <tier> <id>`
 * rewrites these safely.
 */
export const CURRENT: Record<ClaudeTier, string> = {
  fable: "claude-fable-5-1",
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-5-5",
};

/** Pinned ID for a Claude tier. */
export function currentModel(tier: ClaudeTier): string {
  return CURRENT[tier];
}

/**
 * Cross-vendor pins — these vendors have no alias mechanism, so the literal ID is required
 * (GeminiSearch puts it in a REST path). Tracked on their own vendors' cadence and NEVER
 * auto-bumped to a Claude model; recorded here so the drift scan can tell an intentional
 * non-Claude pin from a stale Claude one.
 */
export const CROSS_VENDOR: Record<string, string> = {
  // ── OpenAI tier ladder (Router lanes; Tier-2 egress, RESTRICTED-capable). Max → High → Medium → Low.
  astra: "gpt-6-astra",                // MAX    — exhaustive coverage, needle-in-haystack, frontier ceiling ($10/$50)
  sol: "gpt-6.1-sol",                  // HIGH   — settled builds with a pass/fail test writable in advance ($2/$10)
  terra: "gpt-5.6-terra",              // MEDIUM — decided approach, small local choices; bulk docs (SDS/JD) ($2/$12)
  luna: "gpt-6-luna",                  // LOW    — very basic, high-volume token work ($0.10/$0.50)
  forge: "gpt-6.1-sol",                // OpenAI (Tier-2 egress); build + audit modes — rides the SOL rung
  helios: "gpt-5.6-cyber",             // OpenAI Trusted Access Program (blue+red cyber model; Tier-2 egress) — the offensive-security agent's finder; access tested + principal-approved. Lights the statusline CYBER lane (*cyber* match)
  codexResearcher: "gpt-6.1-sol",      // OpenAI (Tier-2 egress)
  codexResearcherFast: "gpt-6-luna",   // OpenAI (Tier-2 egress); breadth-first sweep rung
  geminiResearcher: "gemini-3.8-flash",// Google (Tier-2 egress; PUBLIC ceiling) — research lane only
  gemini: "gemini-4-argon",            // Google (Tier-2 egress; PUBLIC ceiling) — general Gemini agent; S+ on the 2026-10 tier list
  gene: "z-ai/glm-5.3",                // OpenRouter broker (Tier-2); US+ZDR pin => INTERNAL, unpinned => PUBLIC
  grok: "grok-4.7",                    // xAI (Tier-2 egress; PUBLIC ceiling — HARD: context-recording incident; principal-approved 2026-08-12, non-sensitive tasks only, never reasoning/audit lanes)
};

/** OpenAI rung → CROSS_VENDOR key. The Router's OpenAI ladder; edit CROSS_VENDOR, not this. */
export const OPENAI_TIER: Record<EffortLevel, "astra" | "sol" | "terra" | "luna"> = {
  max: "astra",
  high: "sol",
  medium: "terra",
  low: "luna",
};

/**
 * PRIVATE PINNED LANE — sensitive data never leaves the box. A llama.cpp server
 * (`llama-server`, OpenAI-compatible /v1/chat/completions) on loopback. NOT
 * LocalIntelligence: that skill is about on-device capability; this lane is a
 * data-boundary guarantee the Router enforces. Endpoint/model override via
 * LIFEOS_PRIVATE_LANE_URL / LIFEOS_PRIVATE_LANE_MODEL.
 */
export const PRIVATE_LANE = {
  url: "http://127.0.0.1:8080",
  model: "qwen3.8-27b",
  fallbacks: ["qwen3.6-27b", "gemma-4-31b"],
} as const;

/**
 * Dated/pinned Claude-ID pattern — matches claude-{tier}-{major}[-{minor}][-date], covering
 * both the Claude 5 lineup ("claude-sonnet-5") and older two-part IDs ("claude-opus-4-8").
 * Used by the drift scanner to find pinned IDs that may be stale.
 */
export const CLAUDE_ID_PATTERN = /claude-(opus|sonnet|haiku|fable)-\d+(?:-\d+)?(?:-\d{8})?/g;
