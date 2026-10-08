import { parseFeed, type FeedItem } from "./parse";
import type { Outcome } from "./breaker";
import { validateFeedUrl } from "./safe";

export const MAX_BYTES = 2 * 1024 * 1024;

export interface PollResult { outcome: Outcome; items: FeedItem[]; status?: number; via?: string }

const HEADERS = { "User-Agent": "LifeOS-Feed/1", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.1" };

/** Fetch + parse one URL. `accept` decides whether the post-redirect URL is allowed (feeds: full SSRF check; proxies: https only). */
async function fetchOnce(target: string, fetchFn: typeof fetch, timeoutMs: number, accept: (u: string) => boolean, extra: Record<string, string> = {}): Promise<PollResult> {
  try {
    const res = await fetchFn(target, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs), headers: { ...HEADERS, ...extra } });
    if (res.url && !accept(res.url)) return { outcome: "blocked", items: [] }; // redirected somewhere we would not have accepted
    if (!res.ok) return { outcome: "http_error", items: [], status: res.status };
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) return { outcome: "http_error", items: [], status: res.status };
    const body = await res.text();
    if (body.length > MAX_BYTES) return { outcome: "http_error", items: [], status: res.status };
    const items = parseFeed(body);
    return { outcome: items.length ? "ok" : "empty", items, status: res.status }; // 200 + zero items is a soft failure, not a success
  } catch {
    return { outcome: "network_error", items: [] };
  }
}

export async function pollSource(url: string, fetchFn: typeof fetch = fetch, timeoutMs = 8000): Promise<PollResult> {
  if (!validateFeedUrl(url)) return { outcome: "blocked", items: [] };
  return fetchOnce(url, fetchFn, timeoutMs, (u) => !!validateFeedUrl(u));
}

// ---- fetch-tier fallback: direct -> reader proxy -> self-hosted proxy ----------------------------

export interface Tier { name: string; template: string; token?: string }
const BLOCKED_STATUS = new Set([401, 403, 429, 503]); // "they refuse us" — not 404/410 (feed is gone, a proxy will not help)

/** Tiers from optional env. No defaults: nothing is sent to a third party unless the operator configures it. */
export function tiersFromEnv(env: { READER_PROXY_URL?: string; SELF_PROXY_URL?: string; PROXY_AUTH_TOKEN?: string }): Tier[] {
  const out: Tier[] = [];
  for (const [name, template] of [["reader-proxy", env.READER_PROXY_URL], ["self-proxy", env.SELF_PROXY_URL]] as const) {
    if (!template || !template.includes("{url}")) continue;
    let u: URL;
    try { u = new URL(template.replace("{url}", "x")); } catch { continue; }
    if (u.protocol !== "https:" || u.username || u.password) continue; // no http, no creds in the URL (token goes in a header)
    out.push({ name, template, token: env.PROXY_AUTH_TOKEN || undefined });
  }
  return out;
}

export const proxyUrl = (t: Tier, feedUrl: string) => t.template.replace("{url}", encodeURIComponent(feedUrl));

/** Direct first (free). Proxies only when the site refuses us (401/403/429/503) or returns an empty body. */
export async function pollWithTiers(url: string, tiers: Tier[], fetchFn: typeof fetch = fetch, timeoutMs = 8000): Promise<PollResult> {
  const direct = await pollSource(url, fetchFn, timeoutMs); // also enforces validateFeedUrl before any tier sees the URL
  if (direct.outcome === "ok" || direct.outcome === "blocked") return direct;
  const refused = direct.outcome === "empty" || (direct.outcome === "http_error" && direct.status !== undefined && BLOCKED_STATUS.has(direct.status));
  if (!refused) return direct;
  for (const t of tiers) {
    // The token goes only to the proxy, never to the feed site.
    const r = await fetchOnce(proxyUrl(t, url), fetchFn, timeoutMs, (u) => u.startsWith("https://"), t.token ? { Authorization: `Bearer ${t.token}` } : {});
    if (r.outcome === "ok") return { ...r, via: t.name };
  }
  return direct;
}
