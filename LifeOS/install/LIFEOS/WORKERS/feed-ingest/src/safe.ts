/**
 * Feed URLs are user-supplied and fetched server-side, so they are validated before storage and
 * again after redirects. Workers cannot reach private networks, but a poller should still refuse
 * credentials-in-URL, IP literals, non-standard ports and internal-looking hostnames.
 */
export function validateFeedUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== "443") return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || /^\d+(\.\d+){3}$/.test(h) || h.includes(":") || h.startsWith("[")) return null; // IP literal / single-label host
  if (/(^|\.)(localhost|local|internal|lan|home|corp|intranet)$/.test(h)) return null;
  u.hash = "";
  return u.toString();
}
