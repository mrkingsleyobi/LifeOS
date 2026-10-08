/** RSS 2.0 + Atom → normalized items. Pure; no I/O. */
import { XMLParser } from "fast-xml-parser";

export interface FeedItem { guid: string; url?: string; title?: string; author?: string; published?: string; summary?: string }
export const MAX_ITEMS = 100;

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", trimValues: true });
const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Text of a node that may be a string, number, or {#text, @_attrs}. */
function text(v: unknown, max: number): string | undefined {
  const raw = typeof v === "string" || typeof v === "number" ? String(v) : typeof v === "object" && v !== null ? (v as any)["#text"] : undefined;
  if (raw === undefined || raw === null) return undefined;
  const t = String(raw).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : undefined;
}

const iso = (v: unknown): string | undefined => {
  const t = text(v, 64);
  const ms = t ? Date.parse(t) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
};

function atomLink(l: unknown): string | undefined {
  const links = arr(l as any[]);
  const alt = links.find((x) => typeof x === "object" && (x["@_rel"] === undefined || x["@_rel"] === "alternate")) ?? links[0];
  return typeof alt === "string" ? alt : alt?.["@_href"];
}

export function parseFeed(xml: string): FeedItem[] {
  let doc: any;
  try { doc = parser.parse(xml); } catch { return []; }
  const out: FeedItem[] = [];

  for (const it of arr(doc?.rss?.channel?.item)) {
    const url = text(it.link, 2000);
    const title = text(it.title, 500);
    const guid = text(it.guid, 500) ?? url ?? title;
    if (!guid) continue;
    out.push({ guid, url, title, author: text(it["dc:creator"] ?? it.author, 200), published: iso(it.pubDate ?? it["dc:date"]), summary: text(it.description ?? it["content:encoded"], 2000) });
  }
  for (const e of arr(doc?.feed?.entry)) {
    const url = atomLink(e.link);
    const title = text(e.title, 500);
    const guid = text(e.id, 500) ?? url ?? title;
    if (!guid) continue;
    out.push({ guid, url, title, author: text(e.author?.name, 200), published: iso(e.published ?? e.updated), summary: text(e.summary ?? e.content, 2000) });
  }
  return out.slice(0, MAX_ITEMS);
}
