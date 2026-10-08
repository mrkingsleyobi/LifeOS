/**
 * One model call, two wire formats. Public feed text only, so Tier-2 egress is fine here.
 * Neither format has been exercised live from this repo; both follow the providers' published
 * request shapes. RATER_MODEL is deliberately NOT defaulted in code — set it in wrangler vars.
 */
export interface ProviderEnv { RATER_PROVIDER?: string; RATER_MODEL?: string; RATER_API_KEY?: string; RATER_BASE_URL?: string }

export async function callModel(env: ProviderEnv, system: string, user: string, fetchFn: typeof fetch = fetch, timeoutMs = 20_000): Promise<string> {
  const provider = env.RATER_PROVIDER ?? "openai";
  if (!env.RATER_MODEL || !env.RATER_API_KEY) throw new Error("rater not configured");
  const signal = AbortSignal.timeout(timeoutMs);

  if (provider === "anthropic") {
    const res = await fetchFn(`${env.RATER_BASE_URL ?? "https://api.anthropic.com"}/v1/messages`, {
      method: "POST", signal,
      headers: { "x-api-key": env.RATER_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: env.RATER_MODEL, max_tokens: 700, system, messages: [{ role: "user", content: user }] }),
    });
    if (!res.ok) throw new Error(`provider ${res.status}`);
    const text = ((await res.json()) as any)?.content?.find?.((b: any) => b?.type === "text")?.text;
    if (typeof text !== "string") throw new Error("empty provider response");
    return text;
  }
  if (provider === "openai") {
    const res = await fetchFn(`${env.RATER_BASE_URL ?? "https://api.openai.com/v1"}/chat/completions`, {
      method: "POST", signal,
      headers: { Authorization: `Bearer ${env.RATER_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model: env.RATER_MODEL, max_completion_tokens: 700, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    if (!res.ok) throw new Error(`provider ${res.status}`);
    const text = ((await res.json()) as any)?.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new Error("empty provider response");
    return text;
  }
  throw new Error(`unknown RATER_PROVIDER '${provider}'`);
}
