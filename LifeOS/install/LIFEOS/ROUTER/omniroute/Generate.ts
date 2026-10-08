#!/usr/bin/env bun
/**
 * Generate OmniRoute combos from lanes.json + models.ts, so lane order and model IDs have ONE
 * source of truth. Writes omniroute/combos.json.
 *
 * Only non-Anthropic lanes become combos: Claude traffic stays on its native path (subscription
 * terms / BillingPathAssertion), and the private lane never touches a gateway. A chain step that
 * lands on an Anthropic lane ends the combo chain; LifeOS (Router fallback list) takes it from there.
 *
 * Combo shape follows a third-party OmniRoute write-up (name, targets[{provider,model}],
 * fallbackTier, fallbackDelayMs) — NOT verified against OmniRoute's own docs/version. Check it
 * (and the `provider` slugs) before importing.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { LANES, laneModel } from "../../TOOLS/models";
import { loadConfig } from "../Config";

const cfg = loadConfig();
// Lanes disabled in lanes.json (e.g. cyber, whose model 404s on the owner account) get no combo.
const enabled = (lane: string) => cfg.specialtyLanes?.[lane]?.enabled !== false;
const isOpenAI = (lane: string) => LANES[lane]?.vendor === "openai" && enabled(lane);
const combos = Object.keys(LANES).filter(isOpenAI).map((lane) => {
  // The chain ends at the first Anthropic step: that hand-off is LifeOS's, not the gateway's, so never skip past it to a later OpenAI lane.
  const chain = cfg.fallbackChains[lane] ?? [];
  const firstAnthropic = chain.findIndex((l) => LANES[l]?.vendor === "anthropic");
  const next = (firstAnthropic < 0 ? chain : chain.slice(0, firstAnthropic)).find(isOpenAI);
  return {
    name: `lifeos-${lane}`,
    targets: [{ provider: "openai", model: laneModel(lane) }],
    ...(next ? { fallbackTier: `lifeos-${next}`, fallbackDelayMs: 200 } : {}),
  };
});
writeFileSync(join(import.meta.dir, "combos.json"), JSON.stringify({ _generated: "bun omniroute/Generate.ts — do not hand-edit", combos }, null, 2) + "\n");
console.log(combos.map((c) => `${c.name} → ${c.fallbackTier ?? "(LifeOS fallback)"}`).join("\n"));
