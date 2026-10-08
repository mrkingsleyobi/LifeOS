/**
 * Jev — node-side client: finds a key (env or ~/.claude/.env) and delegates the wire call to JevCore.
 * Order: OPENROUTER_API_KEY, TYPESAFE_API_KEY (native), AI_GATEWAY_API_KEY (Vercel); JEV_PROVIDER=openrouter|native|gateway forces one. JEV_BASE_URL overrides the host.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { DEFAULT_BASE, evaluate, pickJev, type Flavor } from "./JevCore";
import type { Probs } from "./Policy";

export { QUESTIONS } from "./JevCore";

function fromDotenv(name: string): string | undefined {
  const f = join(process.env.HOME ?? homedir(), ".claude", ".env");
  if (!existsSync(f)) return undefined;
  const m = readFileSync(f, "utf-8").match(new RegExp(`^${name}=(.+)$`, "m"));
  return m?.[1]?.trim().replace(/^["']|["']$/g, "");
}

export function jevCredentials(): { key: string; flavor: Flavor } | undefined {
  const pick = (n: string) => process.env[n] || fromDotenv(n);
  return pickJev({ JEV_PROVIDER: pick("JEV_PROVIDER"), OPENROUTER_API_KEY: pick("OPENROUTER_API_KEY"), TYPESAFE_API_KEY: pick("TYPESAFE_API_KEY"), AI_GATEWAY_API_KEY: pick("AI_GATEWAY_API_KEY") });
}

export const jevConfigured = () => !!jevCredentials();

export async function askJev(redactedPrompt: string, timeoutMs: number): Promise<Probs | null> {
  const c = jevCredentials();
  if (!c) return null;
  return evaluate(c.key, process.env.JEV_BASE_URL ?? DEFAULT_BASE[c.flavor], redactedPrompt, timeoutMs, c.flavor);
}
