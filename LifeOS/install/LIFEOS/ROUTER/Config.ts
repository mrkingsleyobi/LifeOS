/** Node-side config + hashing (kept out of Policy.ts so the Worker can import Policy unchanged). */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LanesConfig } from "./Policy";

export const loadConfig = (): LanesConfig =>
  JSON.parse(readFileSync(join(import.meta.dir, "lanes.json"), "utf-8"));

export const hashPrompt = (p: string) => createHash("sha256").update(p).digest("hex").slice(0, 12);
