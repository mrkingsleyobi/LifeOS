/**
 * Jev — node-side client: finds a key (env or ~/.claude/.env) and delegates the wire call to JevCore.
 * TYPESAFE_API_KEY → native TypeSafe API; else AI_GATEWAY_API_KEY → Vercel gateway. JEV_BASE_URL overrides the host.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { DEFAULT_BASE, evaluate, type Flavor } from "./JevCore";
import type { Probs } from "./Policy";

export { QUESTIONS } from "./JevCore";

function fromDotenv(name: string): string | undefined {
  const f = join(process.env.HOME ?? homedir(), ".claude", ".env");
  if (!existsSync(f)) return undefined;
  const m = readFileSync(f, "utf-8").match(new RegExp(`^${name}=(.+)$`, "m"));
  return m?.[1]?.trim().replace(/^["']|["']$/g, "");
}

export function jevCredentials(): { key: string; flavor: Flavor } | undefined {
  const native = process.env.TYPESAFE_API_KEY || fromDotenv("TYPESAFE_API_KEY");
  if (native) return { key: native, flavor: "native" };
  const gw = process.env.AI_GATEWAY_API_KEY || fromDotenv("AI_GATEWAY_API_KEY");
  return gw ? { key: gw, flavor: "gateway" } : undefined;
}

export const jevConfigured = () => !!jevCredentials();

export async function askJev(redactedPrompt: string, timeoutMs: number): Promise<Probs | null> {
  const c = jevCredentials();
  if (!c) return null;
  return evaluate(c.key, process.env.JEV_BASE_URL ?? DEFAULT_BASE[c.flavor], redactedPrompt, timeoutMs, c.flavor);
}
