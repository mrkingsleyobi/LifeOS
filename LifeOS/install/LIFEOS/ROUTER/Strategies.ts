/**
 * STRATEGIES — the model-stack shapes the Router composes lanes into.
 * "Think in ANDs, not ORs": a decision is a lane PLUS how it combines.
 *
 *   tiered        one lane, picked by intelligence tier (the default)
 *   combo         producer → reviewer on the OTHER vendor (cross-vendor eye;
 *                 a lane never reviews its own work)
 *   fusion        fan the same task to N frontier lanes in parallel, then a
 *                 synthesizer fuses the answers (max-tier, costly-error work)
 *   fallback      every decision carries an ordered chain; a lane is skipped
 *                 when its vendor quota is spent or its data ceiling is below
 *                 the prompt's data class
 *   private       Private Pinned Lane — sensitive data runs ONLY on the local
 *                 llama.cpp model. No combo, no fusion, no cloud fallback.
 */

import { CLASS_RANK, type DataClass } from "../../hooks/lib/data-classification";
import { LANES, type LaneId } from "./Lanes";

export type Strategy = "tiered" | "combo" | "fusion" | "private";

/** Ordered fallbacks per lane (the lane itself is always first). */
export const FALLBACK: Record<LaneId, LaneId[]> = {
  astra: ["astra", "fable", "opus", "sol"],
  fable: ["fable", "opus", "astra", "sol"],
  opus: ["opus", "sol", "sonnet", "fable"],
  sol: ["sol", "opus", "terra", "sonnet"],
  terra: ["terra", "sonnet", "luna", "haiku"],
  sonnet: ["sonnet", "terra", "haiku", "luna"],
  luna: ["luna", "haiku", "terra"],
  haiku: ["haiku", "luna", "sonnet"],
  gemini: ["gemini", "opus", "sol"],
  grok: ["grok", "gemini", "sonnet"],
  cyber: ["cyber", "opus", "sol"],
  inline: ["inline"],
  private: ["private"],
};

/** Is this vendor (or the scoped Fable week) too spent to route to? Injected — Strategies does no I/O. */
export type QuotaFn = (v: "anthropic" | "openai" | "fable") => boolean;

export interface ChainCheck { lane: LaneId; ok: boolean; why?: string }

/** Walk a lane's chain against the data class + live quota; first OK lane wins. */
export function resolveChain(lane: LaneId, dataClass: DataClass, quota: QuotaFn = () => false): { pick: LaneId; chain: ChainCheck[] } {
  const chain: ChainCheck[] = [];
  for (const id of FALLBACK[lane]) {
    const l = LANES[id];
    if (CLASS_RANK[dataClass] < CLASS_RANK[l.ceiling]) { chain.push({ lane: id, ok: false, why: `ceiling ${l.ceiling} < ${dataClass}` }); continue; }
    if (id === "fable" && quota("fable")) { chain.push({ lane: id, ok: false, why: "FB week spent" }); continue; }
    if ((l.vendor === "anthropic" || l.vendor === "openai") && quota(l.vendor)) { chain.push({ lane: id, ok: false, why: `${l.vendor} quota spent` }); continue; }
    chain.push({ lane: id, ok: true });
    return { pick: id, chain };
  }
  // Nothing passed — inline is always available (and RESTRICTED-capable).
  chain.push({ lane: "inline", ok: true, why: "chain exhausted" });
  return { pick: "inline", chain };
}

/** Cross-vendor reviewer for a producer lane (Combo). */
export function reviewerFor(producer: LaneId): LaneId {
  const v = LANES[producer].vendor;
  if (v === "openai") return LANES[producer].tier === "max" ? "fable" : "opus";
  if (v === "anthropic") return LANES[producer].tier === "max" ? "astra" : "sol";
  return "opus";
}

/** Fusion panel: frontier lanes across vendors, filtered by data class. Opus synthesizes. */
export function fusionPanel(dataClass: DataClass): { members: LaneId[]; synthesizer: LaneId } {
  const candidates: LaneId[] = ["fable", "astra", "gemini"];
  const members = candidates.filter((id) => CLASS_RANK[dataClass] >= CLASS_RANK[LANES[id].ceiling]);
  return { members, synthesizer: "opus" };
}
