/**
 * JevCore — the Jev wire call with no node imports (shared by the CLI/hook and the Worker).
 * Wire format follows Vercel AI Gateway's documented evaluate endpoint:
 *   POST {base}/v1/evaluate  { model:"typesafe-ai/jev", state, questions:{name:{type:"boolean",instructions}} }
 *   -> answers[name].probability
 * NOT yet exercised against a live key from this repo — the first shadow run is the test.
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
  containsSensitiveOrPrivateData: "Does the text contain personal, confidential, financial, health, or credential information?",
};

export async function evaluate(key: string, base: string, redactedPrompt: string, timeoutMs: number): Promise<Probs | null> {
  const questions = Object.fromEntries(
    Object.entries(QUESTIONS).map(([k, instructions]) => [k, { type: "boolean", instructions }]),
  );
  try {
    const res = await fetch(`${base}/v1/evaluate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "typesafe-ai/jev", state: redactedPrompt, questions }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const answers = ((await res.json()) as any)?.answers ?? {};
    const out: Probs = {};
    for (const k of Object.keys(QUESTIONS)) {
      const a = answers[k];
      const p = Number(a?.probability ?? a?.noul);
      if (!Number.isFinite(p)) return null; // incomplete answer -> caller falls back, never half-trusts
      out[k] = Math.max(0, Math.min(1, p));
    }
    return out;
  } catch { return null; }
}
