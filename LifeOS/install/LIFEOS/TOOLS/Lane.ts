#!/usr/bin/env bun
/**
 * Lane — resolve a router lane to its model, so lane agents never restate an ID.
 *   bun Lane.ts model <lane>   → model string (OpenAI pin, or Claude tier alias)
 *   bun Lane.ts list           → "<lane> <vendor> <rank> <model>" per line, low→high
 */
import { LANES, laneModel } from "./models";

const [cmd, arg] = process.argv.slice(2);
try {
  if (cmd === "model" && arg) console.log(laneModel(arg));
  else if (cmd === "list") for (const [k, l] of Object.entries(LANES)) console.log(`${k} ${l.vendor} ${l.rank} ${laneModel(k)}`);
  else { console.error("usage: Lane.ts model <lane> | list"); process.exit(2); }
} catch (e) { console.error((e as Error).message); process.exit(1); }
