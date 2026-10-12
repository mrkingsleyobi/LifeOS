#!/usr/bin/env bun
/**
 * LANES — the Router's lane registry. One row per place work can run.
 *
 * Agents are named for their model (Astra runs Astra, Sol runs Sol …), so a
 * lane id, its agent file, and its statusline token are the same word.
 *
 * Model IDs are NEVER written here — they resolve from models.ts (CURRENT,
 * CROSS_VENDOR, PRIVATE_LANE), which stays the one edit point on a release.
 * This file holds the policy-shaped facts the Router scores against: tier,
 * intelligence, speed, price, and the data-class ceiling of each route.
 *
 * Prices are USD per 1M tokens (in/out), from the 2026-10 model tier list.
 * Refresh them with the lineup; the Router only uses them for relative cost.
 */

import { CURRENT, CROSS_VENDOR, PRIVATE_LANE, type EffortLevel, type HarnessEffort } from "../TOOLS/models";
import type { DataClass } from "../../hooks/lib/data-classification";

export type Vendor = "session" | "anthropic" | "openai" | "google" | "xai" | "local";

export type LaneId =
  | "inline"
  | "luna" | "terra" | "sol" | "astra"
  | "haiku" | "sonnet" | "opus" | "fable"
  | "gemini" | "grok" | "cyber"
  | "private";

export interface Lane {
  id: LaneId;
  /** Statusline / ROUTER-line label. */
  label: string;
  vendor: Vendor;
  /** Agent file in agents/ that runs this lane (null = no dispatch). */
  agent: string | null;
  /** Intelligence rung this lane occupies within its vendor ladder. */
  tier: EffortLevel;
  /** 1–5 relative capability (5 = frontier ceiling). */
  intelligence: number;
  /** 1–5 relative throughput (5 = fastest). */
  speed: number;
  costIn: number;
  costOut: number;
  /** Most sensitive data class this route may process (DataClassification.md). */
  ceiling: DataClass;
  /** Harness/codex effort values this lane accepts. */
  efforts: HarnessEffort[];
  /** What the lane is FOR — read by the scorer and printed by `Router.ts lanes`. */
  role: string;
}

const EFF_ALL: HarnessEffort[] = ["low", "medium", "high", "xhigh"];

export const LANES: Record<LaneId, Lane> = {
  inline: {
    id: "inline", label: "INLINE", vendor: "session", agent: null, tier: "high",
    intelligence: 4, speed: 5, costIn: 0, costOut: 0, ceiling: "RESTRICTED", efforts: EFF_ALL,
    role: "Stays in the current conversation — acknowledgements, quick answers, follow-ups on the thread",
  },

  // ── OpenAI ladder: Astra (max) → Sol (high) → Terra (medium) → Luna (low)
  luna: {
    id: "luna", label: "LUNA", vendor: "openai", agent: "Luna", tier: "low",
    intelligence: 2, speed: 5, costIn: 0.1, costOut: 0.5, ceiling: "RESTRICTED", efforts: EFF_ALL,
    role: "Very basic, high-volume token work — reformatting, extraction, bulk SDS/JD passes",
  },
  terra: {
    id: "terra", label: "TERRA", vendor: "openai", agent: "Terra", tier: "medium",
    intelligence: 3, speed: 4, costIn: 2, costOut: 12, ceiling: "RESTRICTED", efforts: EFF_ALL,
    role: "Decided approach, small local choices — templated docs, routine edits at volume",
  },
  sol: {
    id: "sol", label: "SOL", vendor: "openai", agent: "Sol", tier: "high",
    intelligence: 4, speed: 3, costIn: 2, costOut: 10, ceiling: "RESTRICTED", efforts: EFF_ALL,
    role: "Settled builds with a pass/fail test writable in advance — the OpenAI workhorse builder",
  },
  astra: {
    id: "astra", label: "ASTRA", vendor: "openai", agent: "Astra", tier: "max",
    intelligence: 5, speed: 2, costIn: 10, costOut: 50, ceiling: "RESTRICTED", efforts: EFF_ALL,
    role: "Exhaustive coverage and needle-in-a-haystack search across a large corpus",
  },

  // ── Anthropic ladder: Fable (max) → Opus (high) → Sonnet (medium) → Haiku (low)
  haiku: {
    id: "haiku", label: "HAIKU", vendor: "anthropic", agent: "Haiku", tier: "low",
    intelligence: 2, speed: 5, costIn: 0.1, costOut: 0.5, ceiling: "RESTRICTED", efforts: EFF_ALL,
    role: "Cheap lookups and classification that must stay in-family",
  },
  sonnet: {
    id: "sonnet", label: "SONNET", vendor: "anthropic", agent: "Sonnet", tier: "medium",
    intelligence: 4, speed: 4, costIn: 2, costOut: 10, ceiling: "RESTRICTED", efforts: EFF_ALL,
    role: "Utility writing, summarization, vision triage",
  },
  opus: {
    id: "opus", label: "OPUS", vendor: "anthropic", agent: "Opus", tier: "high",
    intelligence: 5, speed: 3, costIn: 4, costOut: 20, ceiling: "RESTRICTED", efforts: EFF_ALL,
    role: "Most judgment work — design, taste, synthesis; max-level work at xhigh",
  },
  fable: {
    id: "fable", label: "FABLE", vendor: "anthropic", agent: "Fable", tier: "max",
    intelligence: 5, speed: 2, costIn: 10, costOut: 50, ceiling: "RESTRICTED", efforts: ["high", "xhigh"],
    role: "Top-rung reasoning and second opinions on max-level work",
  },

  // ── Cross-vendor specialist lanes
  gemini: {
    id: "gemini", label: "GEMINI", vendor: "google", agent: "Gemini", tier: "high",
    intelligence: 5, speed: 3, costIn: 2, costOut: 10, ceiling: "PUBLIC", efforts: EFF_ALL,
    role: "Grounded, cited takes on public material; third-vendor panel seat",
  },
  grok: {
    id: "grok", label: "GROK", vendor: "xai", agent: "Grok", tier: "high",
    intelligence: 4, speed: 4, costIn: 2, costOut: 6, ceiling: "PUBLIC", efforts: EFF_ALL,
    role: "Public-data lane — X/culture/current events; never sensitive, never audit",
  },
  cyber: {
    id: "cyber", label: "CYBER", vendor: "openai", agent: "Helios", tier: "high",
    intelligence: 5, speed: 3, costIn: 2, costOut: 10, ceiling: "RESTRICTED", efforts: EFF_ALL,
    role: "Offensive/defensive security work on authorized targets (Helios agent)",
  },

  // ── Private Pinned Lane: sensitive data never leaves the box
  private: {
    id: "private", label: "LOCAL", vendor: "local", agent: "Private", tier: "medium",
    intelligence: 3, speed: 3, costIn: 0, costOut: 0, ceiling: "RESTRICTED", efforts: EFF_ALL,
    role: "Pinned local llama.cpp model — anything sensitive; can never leave your box",
  },
};

/** Resolve a lane to its concrete model id (single source: models.ts). */
export function modelForLane(id: LaneId): string {
  switch (id) {
    case "inline": return "session";
    case "haiku": case "sonnet": case "opus": case "fable": return CURRENT[id];
    case "cyber": return CROSS_VENDOR.helios;
    case "private": return process.env.LIFEOS_PRIVATE_LANE_MODEL || PRIVATE_LANE.model;
    default: return CROSS_VENDOR[id];
  }
}

/** Vendor ladders, low → max. */
export const LADDER: Record<"openai" | "anthropic", Record<EffortLevel, LaneId>> = {
  openai: { low: "luna", medium: "terra", high: "sol", max: "astra" },
  anthropic: { low: "haiku", medium: "sonnet", high: "opus", max: "fable" },
};

/** Display order for the statusline model roster. */
export const ROSTER_ORDER: LaneId[] = [
  "haiku", "sonnet", "opus", "luna", "terra", "sol", "astra", "gemini", "grok", "cyber", "fable", "private",
];

/** Display order for the statusline agent panel. */
export const AGENT_ORDER: LaneId[] = ["astra", "fable", "opus", "sol", "terra", "luna", "gemini", "grok", "cyber"];
