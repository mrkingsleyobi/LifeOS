#!/usr/bin/env bun
/**
 * Pulse calls Bunker at this path (modules/bunker.ts → `bun PULSE/Bunker/bin/bunker.ts data`).
 * The implementation lives in LIFEOS/BUNKER/Bunker.ts; this shim keeps the shipped
 * Pulse module's contract without moving code into the release-excluded Pulse tree.
 */
import { main } from "../../../BUNKER/Bunker";
await main();
