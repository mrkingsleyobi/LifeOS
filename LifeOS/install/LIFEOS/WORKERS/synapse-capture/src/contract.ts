/**
 * The Synapse capture contract (DOCUMENTATION/Synapse/SynapseSystem.md § The Capture Contract),
 * as pure code: validate one record, normalize its URL, derive its dedup identity.
 */
import { sha256Hex } from "../../_shared/arbol";

export interface Capture {
  source: string;
  external_id: string;
  url?: string;
  content?: string;
  captured_at: string;
  content_kind: string;
  title?: string;
  author?: string;
  privacy_class: "public" | "personal";
}

export const MAX_CONTENT = 200_000;
const TRACKING = /^(utm_|fbclid$|gclid$|mc_(cid|eid)$|ref$|ref_src$)/i;

export function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString();
  } catch { return null; }
}

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : undefined);

export function validate(raw: Record<string, unknown>, now = () => new Date().toISOString()):
  { ok: true; capture: Capture } | { ok: false; error: string } {
  const source = str(raw.source, 64), external_id = str(raw.external_id, 256);
  if (!source) return { ok: false, error: "source required" };
  if (!external_id) return { ok: false, error: "external_id required" };
  const kind = str(raw.content_kind, 24);
  if (!kind || !/^[a-z][a-z-]*$/.test(kind)) return { ok: false, error: "content_kind required (lowercase, e.g. article|video|tweet|paper|note|tool)" };
  const pc = raw.privacy_class;
  if (pc !== "public" && pc !== "personal") return { ok: false, error: "privacy_class must be public or personal" };

  let url: string | undefined;
  if (raw.url !== undefined) {
    const n = typeof raw.url === "string" ? normalizeUrl(raw.url) : null;
    if (!n) return { ok: false, error: "url must be a valid http(s) URL" };
    url = n;
  }
  const content = raw.content === undefined ? undefined : typeof raw.content === "string" && raw.content.length <= MAX_CONTENT ? raw.content : null;
  if (content === null) return { ok: false, error: `content must be a string under ${MAX_CONTENT} chars` };
  if (!url && !content?.trim()) return { ok: false, error: "url or content required" };

  let captured_at = now();
  if (raw.captured_at !== undefined) {
    const t = typeof raw.captured_at === "string" ? Date.parse(raw.captured_at) : NaN;
    if (!Number.isFinite(t)) return { ok: false, error: "captured_at must be ISO-8601" };
    captured_at = new Date(t).toISOString();
  }
  return { ok: true, capture: { source, external_id, url, content, captured_at, content_kind: kind, title: str(raw.title, 500), author: str(raw.author, 200), privacy_class: pc } };
}

/** Dedup identity: normalized url + content hash; falls back to source + external_id. */
export async function dedupKey(c: Capture): Promise<string> {
  return c.url
    ? sha256Hex(`url\n${c.url}\n${await sha256Hex(c.content ?? "")}`)
    : sha256Hex(`ext\n${c.source}\n${c.external_id}`);
}
