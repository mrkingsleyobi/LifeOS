/**
 * Arbol ACTIONS — atomic units of work. JSON in → JSON out, passthrough pattern:
 * every action returns `{ ...upstream, <its fields> }`, so the last action in a
 * pipeline sees every field any earlier action produced.
 *
 * LLM actions name a LANE, never a model: the lane resolves through the same
 * models.ts the laptop uses (bundled at deploy), so a lineup bump is still one edit.
 */

import { CROSS_VENDOR, CURRENT } from "../../../../TOOLS/models";
import { jev, type JevEnv, type JevQuestion } from "../../../shared/edge";

export type Data = Record<string, unknown>;
export interface ActionEnv extends JevEnv { OPENAI_API_KEY?: string; ANTHROPIC_API_KEY?: string; ARBOL: KVNamespace }
export type Action = (input: Data, cfg: Record<string, any>, env: ActionEnv) => Promise<Data>;

const OPENAI_LANES = new Set(["luna", "terra", "sol", "astra"]);
const ANTHROPIC_LANES = new Set(["haiku", "sonnet", "opus", "fable"]);

/** Template `{field}` from the running data object. */
export const tpl = (s: string, d: Data) => s.replace(/\{(\w+)\}/g, (_, k) => (d[k] === undefined ? "" : typeof d[k] === "string" ? (d[k] as string) : JSON.stringify(d[k])));

export const ACTIONS: Record<string, Action> = {
  /** A_FETCH { url } → { content, status, fetched_url } */
  async A_FETCH(input, cfg) {
    const url = tpl(cfg.url ?? "{url}", input);
    const r = await fetch(url, { headers: { "user-agent": "LifeOS-Arbol/1.0" }, signal: AbortSignal.timeout(20_000) });
    const text = await r.text();
    return { ...input, content: text.slice(0, cfg.maxChars ?? 200_000), status: r.status, fetched_url: url };
  },

  /** A_RSS { content } → { items: [{ title, link, published }] } — tolerant RSS/Atom item extraction */
  async A_RSS(input) {
    const xml = String(input.content ?? "");
    const pick = (block: string, tag: string) => block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`))?.[1]?.trim();
    const items = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/g)].map((m) => ({
      title: pick(m[0], "title"),
      link: pick(m[0], "link") ?? m[0].match(/<link[^>]*href="([^"]+)"/)?.[1],
      published: pick(m[0], "pubDate") ?? pick(m[0], "updated") ?? pick(m[0], "published"),
    }));
    return { ...input, items };
  },

  /** A_NEW_ONLY { items } → { items } filtered to ones not seen before (KV-backed by cfg.key) */
  async A_NEW_ONLY(input, cfg, env) {
    const key = `seen:${cfg.key}`;
    const seen = new Set((await env.ARBOL.get<string[]>(key, "json")) ?? []);
    const items = ((input.items as { link?: string }[]) ?? []).filter((i) => i.link && !seen.has(i.link));
    for (const i of items) seen.add(i.link!);
    await env.ARBOL.put(key, JSON.stringify([...seen].slice(-2000)));
    return { ...input, items };
  },

  /** A_JEV { content } → { judgment } — typed questions, probabilities out (cfg.questions) */
  async A_JEV(input, cfg, env) {
    const questions = cfg.questions as Record<string, JevQuestion>;
    const r = await jev(env, cfg.state ? tpl(cfg.state, input) : String(input.content ?? "").slice(0, 90_000), questions);
    return { ...input, judgment: r.ok ? r.answers : null, judgment_error: r.ok ? undefined : r.reason, judgment_cost: r.ok ? r.cost : 0 };
  },

  /** A_LLM { …fields } → { [cfg.as ?? "output"]: text } on a named lane (cfg.lane, cfg.prompt template) */
  async A_LLM(input, cfg, env) {
    const lane: string = cfg.lane ?? "luna";
    const prompt = tpl(cfg.prompt, input);
    let text = "";
    if (OPENAI_LANES.has(lane)) {
      if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
      const r = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ model: CROSS_VENDOR[lane], input: prompt, reasoning: { effort: cfg.effort ?? "low" }, max_output_tokens: cfg.maxTokens ?? 2000 }),
      });
      const j = (await r.json()) as any;
      if (!r.ok) throw new Error(`openai ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
      text = j.output_text ?? (j.output ?? []).flatMap((o: any) => o.content ?? []).filter((c: any) => c.type === "output_text").map((c: any) => c.text).join("");
    } else if (ANTHROPIC_LANES.has(lane)) {
      if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing");
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: CURRENT[lane as keyof typeof CURRENT], max_tokens: cfg.maxTokens ?? 2000, messages: [{ role: "user", content: prompt }] }),
      });
      const j = (await r.json()) as any;
      if (!r.ok) throw new Error(`anthropic ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
      text = (j.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
    } else {
      // The private lane never runs in the cloud. Gemini/Grok are not wired at the edge.
      throw new Error(`lane ${lane} is not available in Arbol`);
    }
    return { ...input, [cfg.as ?? "output"]: text };
  },

  /** A_KV_WRITE → writes cfg.field (or the whole object) under a templated key */
  async A_KV_WRITE(input, cfg, env) {
    const key = tpl(cfg.key, input);
    await env.ARBOL.put(key, JSON.stringify(cfg.field ? input[cfg.field] : input), cfg.ttl ? { expirationTtl: cfg.ttl } : undefined);
    return { ...input, written: key };
  },

  /** A_WEBHOOK → POST the object (or cfg.field) to a URL from an env var name (cfg.urlEnv) */
  async A_WEBHOOK(input, cfg, env) {
    const url = (env as unknown as Record<string, string>)[cfg.urlEnv];
    if (!url) return { ...input, webhook: "skipped (no url)" };
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cfg.field ? input[cfg.field] : input) });
    return { ...input, webhook: r.status };
  },
};
