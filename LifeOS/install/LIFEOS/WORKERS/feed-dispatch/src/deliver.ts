/**
 * Delivery adapters + message formatting. Feed text is untrusted, so everything that reaches a
 * human channel is sanitized: control characters stripped, mentions neutralized, plain text only
 * (no HTML email), links limited to http(s). Neither provider's wire format has been exercised live.
 */
export interface DeliverEnv {
  DISCORD_WEBHOOK_URL?: string;
  RESEND_API_KEY?: string; EMAIL_FROM?: string; EMAIL_TO?: string;
}
export interface AlertItem { id: string; title?: string | null; url?: string | null; tier: string; summary_short?: string | null; labels?: string[]; quality_score?: number }

const DISCORD_HOST = /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;

export const channels = (env: DeliverEnv): string[] => [
  ...(env.DISCORD_WEBHOOK_URL && DISCORD_HOST.test(env.DISCORD_WEBHOOK_URL) ? ["discord"] : []),
  ...(env.RESEND_API_KEY && env.EMAIL_FROM && env.EMAIL_TO ? ["email"] : []),
];

/**
 * Strip control chars, collapse whitespace, defuse @mentions, neutralize link syntax, cap length.
 * The summary comes from a model that read untrusted text, so it can carry a masked link like
 * [click here](https://evil.example) that Discord would render as a normal-looking link; brackets and
 * angle brackets become parentheses so no masked link or suppressed-embed autolink can be formed.
 */
export const clean = (s: string | null | undefined, max: number) =>
  (s ?? "").replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ")
    .replace(/[\[<]/g, "(").replace(/[\]>]/g, ")").replace(/@/g, "@\u200b").trim().slice(0, max);
const safeUrl = (u: string | null | undefined) => (u && /^https?:\/\/[^\s<>"]+$/.test(u) ? u.slice(0, 500) : "");

export function formatAlert(it: AlertItem): { subject: string; text: string } {
  const title = clean(it.title, 200) || "(untitled)";
  const lines = [`[${it.tier}] ${title}`, clean(it.summary_short, 400), safeUrl(it.url), it.labels?.length ? `Labels: ${it.labels.map((l) => clean(l, 30)).join(", ")}` : ""].filter(Boolean);
  return { subject: `[Feed ${it.tier}] ${title}`.slice(0, 150), text: lines.join("\n") };
}

export function formatDigest(kind: string, items: AlertItem[]): { subject: string; text: string } {
  const body = items.map((it) => {
    const url = safeUrl(it.url);
    return `- [${it.tier}] ${clean(it.title, 150) || "(untitled)"}${it.summary_short ? ` — ${clean(it.summary_short, 200)}` : ""}${url ? `\n  ${url}` : ""}`;
  }).join("\n");
  return { subject: `Feed ${kind} digest (${items.length})`, text: `${items.length} item${items.length === 1 ? "" : "s"}\n\n${body}` };
}

async function discord(env: DeliverEnv, text: string, fetchFn: typeof fetch) {
  const res = await fetchFn(env.DISCORD_WEBHOOK_URL!, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ content: text.slice(0, 1900), allowed_mentions: { parse: [] } }),
  });
  if (!res.ok) throw new Error(`discord ${res.status}`);
}

async function email(env: DeliverEnv, subject: string, text: string, fetchFn: typeof fetch) {
  const res = await fetchFn("https://api.resend.com/emails", {
    method: "POST", signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [env.EMAIL_TO], subject: clean(subject, 150), text: text.slice(0, 20_000) }),
  });
  if (!res.ok) throw new Error(`email ${res.status}`);
}

/** Send to every configured channel. Delivered if at least one succeeds; errors are reported, not swallowed. */
export async function send(env: DeliverEnv, msg: { subject: string; text: string }, fetchFn: typeof fetch = fetch): Promise<{ ok: boolean; error?: string }> {
  const ch = channels(env);
  if (!ch.length) return { ok: false, error: "no delivery channel configured" };
  const results = await Promise.allSettled(ch.map((c) => (c === "discord" ? discord(env, `**${msg.subject}**\n${msg.text}`, fetchFn) : email(env, msg.subject, msg.text, fetchFn))));
  const errors = results.flatMap((r) => (r.status === "rejected" ? [String(r.reason?.message ?? r.reason)] : []));
  return { ok: errors.length < ch.length, error: errors.length ? errors.join("; ").slice(0, 200) : undefined };
}
