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
const isOpenAI = (lane: string) => LANES[lane]?.vendor === "openai";
const combos = Object.keys(LANES).filter(isOpenAI).map((lane) => {
  const next = (cfg.fallbackChains[lane] ?? []).find(isOpenAI);
  return {
    name: `lifeos-${lane}`,
    targets: [{ provider: "openai", model: laneModel(lane) }],
    ...(next ? { fallbackTier: `lifeos-${next}`, fallbackDelayMs: 200 } : {}),
  };
});
writeFileSync(join(import.meta.dir, "combos.json"), JSON.stringify({ _generated: "bun omniroute/Generate.ts — do not hand-edit", combos }, null, 2) + "\n");
console.log(combos.map((c) => `${c.name} → ${c.fallbackTier ?? "(LifeOS fallback)"}`).join("\n"));
