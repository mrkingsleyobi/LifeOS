/**
 * Jev — node-side client: finds the key (env or ~/.claude/.env) and delegates the wire call to
 * JevCore. Overridable: JEV_BASE_URL, AI_GATEWAY_API_KEY.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { evaluate } from "./JevCore";
import type { Probs } from "./Policy";

export { QUESTIONS } from "./JevCore";

function envKey(): string | undefined {
  if (process.env.AI_GATEWAY_API_KEY) return process.env.AI_GATEWAY_API_KEY;
  const f = join(process.env.HOME ?? homedir(), ".claude", ".env");
  if (!existsSync(f)) return undefined;
  const m = readFileSync(f, "utf-8").match(/^AI_GATEWAY_API_KEY=(.+)$/m);
  return m?.[1]?.trim().replace(/^["']|["']$/g, "");
}

export const jevConfigured = () => !!envKey();

export async function askJev(redactedPrompt: string, timeoutMs: number): Promise<Probs | null> {
  const key = envKey();
  if (!key) return null;
  return evaluate(key, process.env.JEV_BASE_URL ?? "https://ai-gateway.vercel.sh", redactedPrompt, timeoutMs);
}
