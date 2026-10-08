import { parseFeed, type FeedItem } from "./parse";
import type { Outcome } from "./breaker";
import { validateFeedUrl } from "./safe";

export const MAX_BYTES = 2 * 1024 * 1024;

export async function pollSource(url: string, fetchFn: typeof fetch = fetch, timeoutMs = 8000): Promise<{ outcome: Outcome; items: FeedItem[] }> {
  if (!validateFeedUrl(url)) return { outcome: "blocked", items: [] };
  try {
    const res = await fetchFn(url, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": "LifeOS-Feed/1", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.1" } });
    if (res.url && !validateFeedUrl(res.url)) return { outcome: "blocked", items: [] }; // redirected somewhere we would not have accepted
    if (!res.ok) return { outcome: "http_error", items: [] };
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) return { outcome: "http_error", items: [] };
    const body = await res.text();
    if (body.length > MAX_BYTES) return { outcome: "http_error", items: [] };
    const items = parseFeed(body);
    return { outcome: items.length ? "ok" : "empty", items }; // 200 + zero items is a soft failure, not a success
  } catch {
    return { outcome: "network_error", items: [] };
  }
}
