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
    // Claude Haiku 5.5 ("claude-haiku-5-5"): thinking is on by default and counts toward max_tokens, so leave
    // headroom and drop effort to "low" for this simple rating task. Sampling params are NOT sent (non-default
    // values 400 on this model) and there is no assistant prefill. Refusals have no server-side fallback here.
    const res = await fetchFn(`${env.RATER_BASE_URL ?? "https://api.anthropic.com"}/v1/messages`, {
      method: "POST", signal,
      headers: { "x-api-key": env.RATER_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: env.RATER_MODEL, max_tokens: 2000, output_config: { effort: "low" }, system, messages: [{ role: "user", content: user }] }),
    });
    if (!res.ok) throw new Error(`provider ${res.status}`);
    const j = (await res.json()) as any;
    if (j?.stop_reason === "refusal") throw new Error("model refused");
    const text = j?.content?.find?.((b: any) => b?.type === "text")?.text; // skips any thinking blocks
    if (typeof text !== "string") throw new Error("empty provider response");
    return text;
  }
  if (provider === "openai") {
    const res = await fetchFn(`${env.RATER_BASE_URL ?? "https://api.openai.com/v1"}/chat/completions`, {
      method: "POST", signal,
      headers: { Authorization: `Bearer ${env.RATER_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: env.RATER_MODEL, max_completion_tokens: 700, response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        // OpenRouter is a broker: route only to providers that do not retain or train on the data (repo doctrine, OpenRouter.ts).
        ...((env.RATER_BASE_URL ?? "").includes("openrouter.ai") ? { provider: { data_collection: "deny" } } : {}),
      }),
    });
    if (!res.ok) throw new Error(`provider ${res.status}`);
    const text = ((await res.json()) as any)?.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new Error("empty provider response");
    return text;
  }
  throw new Error(`unknown RATER_PROVIDER '${provider}'`);
}
