/** Feed routing engine — pure. Rules are data (rules.json); this only evaluates them. */
export interface Item {
  id: string;
  tier?: string; quality_score?: number; importance?: number; novelty?: number; urgency?: number;
  labels?: string[];
}
export type Cond = { field: string; gte?: number; lte?: number; in?: string[]; has?: string; eq?: string | number };
export interface Rule { name: string; when: { all: Cond[] }; destinations: string[]; priority: Priority }
export type Priority = "immediate" | "daily" | "weekly" | "archive";
export interface RuleSet { rules: Rule[]; default: { name: string; destinations: string[]; priority: Priority } }
export interface Route { id: string; rule: string; destinations: string[]; priority: Priority }

function holds(item: Item, c: Cond): boolean {
  const v = (item as unknown as Record<string, unknown>)[c.field];
  if (v === undefined || v === null) return false; // unknown never matches
  if (c.gte !== undefined && !(typeof v === "number" && v >= c.gte)) return false;
  if (c.lte !== undefined && !(typeof v === "number" && v <= c.lte)) return false;
  if (c.in !== undefined && !c.in.includes(String(v))) return false;
  if (c.eq !== undefined && v !== c.eq) return false;
  if (c.has !== undefined && !(Array.isArray(v) && v.some((x) => String(x).toLowerCase() === c.has!.toLowerCase()))) return false;
  return true;
}

export function route(item: Item, set: RuleSet): Route {
  const hit = set.rules.find((r) => r.when.all.every((c) => holds(item, c)));
  const r = hit ?? set.default;
  return { id: item.id, rule: r.name, destinations: r.destinations, priority: r.priority };
}

export function validItem(v: unknown): v is Item {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  const num = (x: unknown) => x === undefined || (typeof x === "number" && Number.isFinite(x));
  return typeof o.id === "string" && o.id.length > 0 && o.id.length <= 128
    && (o.tier === undefined || typeof o.tier === "string")
    && num(o.quality_score) && num(o.importance) && num(o.novelty) && num(o.urgency)
    && (o.labels === undefined || (Array.isArray(o.labels) && o.labels.every((l) => typeof l === "string")));
}
