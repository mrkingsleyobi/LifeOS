/**
 * JevCore — the Jev wire call with no node imports (shared by the CLI/hook and the Worker).
 * See `evaluate` for the two wire flavors. NOT confirmed live from this repo.
 */
import type { Probs } from "./Policy";

export const QUESTIONS: Record<string, string> = {
  needsDeepReasoning: "Does completing this request require deep multi-step reasoning, not just retrieval or reformatting?",
  coreSystemOrArchitecture: "Does the request change or design core system architecture, doctrine, or foundational infrastructure?",
  needsJudgmentUnderAmbiguity: "Does it require judgment calls under ambiguity or contested evidence?",
  multiStepPlanning: "Does it require planning and sequencing several dependent steps?",
  highStakesOrIrreversible: "Would a wrong answer be costly, public, or hard to reverse?",
  creativeOrStrategic: "Is it primarily creative or strategic work?",
  bulkRepetitiveTemplated: "Is it bulk, repetitive, templated work, such as producing many similar documents (job descriptions, SDS sheets) from a pattern?",
  formatBoundFromGivenContent: "Is the output fully determined by content already provided, such as summarizing, extracting, converting, or classifying it?",
  simpleLookupOrChat: "Is it a simple lookup, acknowledgement, or casual chat?",
  isCodeChange: "Does it ask to write, modify, or debug source code?",
  isSecurityWork: "Is the request about security work: vulnerability research, penetration testing, malware or exploit analysis, a CTF, threat modeling, or defensive security engineering?",
  containsSensitiveOrPrivateData: "Does the text contain personal, confidential, financial, health, or credential information?",
};

/**
 * Three flavors of the same System One model:
 *  - "native":     POST https://api.typesafe.ai/v1/systemone, model "jev-latest", type "noul", answer at .noul
 *  - "gateway":    POST https://ai-gateway.vercel.sh/v1/evaluate, model "typesafe-ai/jev", type "boolean", answer at .probability
 *  - "openrouter": POST https://openrouter.ai/api/alpha/decisions, model "typesafe/jev-1.13", type "noul" WITH required
 *                  criteria {true,false}, answer at .noul (schema from OpenRouter's Decisions API reference)
 * Third-party write-ups back "native"; "gateway" and "openrouter" follow their providers' docs. None is confirmed live from
 * this repo yet (native 401, gateway 403 billing at the time of writing; openrouter is tested in the repo's live check log).
 */
export type Flavor = "native" | "gateway" | "openrouter";
export const DEFAULT_BASE: Record<Flavor, string> = { native: "https://api.typesafe.ai", gateway: "https://ai-gateway.vercel.sh", openrouter: "https://openrouter.ai" };
const SHAPE: Record<Flavor, { path: string; model: string; type: string; criteria: boolean; field: "noul" | "probability" }> = {
  native: { path: "/v1/systemone", model: "jev-latest", type: "noul", criteria: false, field: "noul" },
  gateway: { path: "/v1/evaluate", model: "typesafe-ai/jev", type: "boolean", criteria: false, field: "probability" },
  openrouter: { path: "/api/alpha/decisions", model: "typesafe/jev-1.13", type: "noul", criteria: true, field: "noul" },
};

export interface JevEnv { JEV_PROVIDER?: string; OPENROUTER_API_KEY?: string; TYPESAFE_API_KEY?: string; AI_GATEWAY_API_KEY?: string }
/** Pick the credential to use. JEV_PROVIDER forces one; otherwise openrouter, then native, then gateway (first one configured). */
export function pickJev(env: JevEnv): { key: string; flavor: Flavor } | undefined {
  const keys: Record<Flavor, string | undefined> = { openrouter: env.OPENROUTER_API_KEY, native: env.TYPESAFE_API_KEY, gateway: env.AI_GATEWAY_API_KEY };
  const forced = env.JEV_PROVIDER as Flavor | undefined;
  if (forced && forced in keys) return keys[forced] ? { key: keys[forced]!, flavor: forced } : undefined;
  for (const f of ["openrouter", "native", "gateway"] as Flavor[]) if (keys[f]) return { key: keys[f]!, flavor: f };
  return undefined;
}

export async function evaluate(key: string, base: string, redactedPrompt: string, timeoutMs: number, flavor: Flavor = "gateway"): Promise<Probs | null> {
  const sh = SHAPE[flavor];
  const questions = Object.fromEntries(
    Object.entries(QUESTIONS).map(([k, instructions]) => [k, {
      type: sh.type, instructions,
      ...(sh.criteria ? { criteria: { true: "Yes: the answer to the question is yes.", false: "No: the answer to the question is no." } } : {}),
    }]),
  );
  try {
    const res = await fetch(`${base}${sh.path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: sh.model, state: redactedPrompt, questions }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const answers = ((await res.json()) as any)?.answers ?? {};
    const out: Probs = {};
    for (const k of Object.keys(QUESTIONS)) {
      const a = answers[k];
      const p = Number(a?.[sh.field] ?? a?.noul ?? a?.probability);
      if (!Number.isFinite(p)) return null; // incomplete answer -> caller falls back, never half-trusts
      out[k] = Math.max(0, Math.min(1, p));
    }
    return out;
  } catch { return null; }
}
