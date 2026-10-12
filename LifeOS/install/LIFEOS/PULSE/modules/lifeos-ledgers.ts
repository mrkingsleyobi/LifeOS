/**
 * LifeOS ledgers — the Pulse surface for the subsystems whose public modules
 * were never shipped: Router, Achilles, Helios, Socrates, Vera, Errata.
 *
 * Every route returns ONE generic view shape, rendered by a single client
 * component (Observability/src/components/SubsystemView.tsx), so a subsystem
 * page is a few lines and all its logic stays here, reading the same JSONL
 * stores the CLIs write. Read-only: Pulse displays, the CLIs compute.
 *
 *   GET /api/router · /api/achilles · /api/helios · /api/socrates · /api/vera · /api/errata
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { LANES, modelForLane, ROSTER_ORDER } from "../../ROUTER/Lanes";
import { readAnthropicQuota, readOpenAIQuota } from "../../ROUTER/Quota";
import { readLedger } from "../../DECISIONS/Decisions";
import { achilles, dueAt } from "../../ACHILLES/Achilles";
import { questions, answers } from "../../SOCRATES/Socrates";
import { claims } from "../../VERA/Vera";
import { errata } from "../../ERRATA/Errata";
import { lifeosDir } from "../../TOOLS/lib/Ledger";

type Dim = "ok" | "warn" | "err" | "blue" | "neutral";
export interface View {
  title: string;
  subtitle: string;
  generated_at: string;
  stats: { label: string; value: string | number; sub?: string; dim?: Dim }[];
  sections: { title: string; columns: string[]; rows: { cells: (string | number)[]; dim?: Dim }[]; empty?: string }[];
}

const ago = (iso?: string | number) => {
  if (!iso) return "—";
  const ms = Date.now() - (typeof iso === "number" ? iso : Date.parse(iso));
  const m = Math.floor(ms / 60_000);
  return m < 60 ? `${m}m` : m < 2880 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
};
const view = (v: Omit<View, "generated_at">): View => ({ ...v, generated_at: new Date().toISOString() });

function routerView(): View {
  const rows = readLedger().filter((r) => r.caller === "dispatch-advisor");
  const day = rows.filter((r) => Date.now() - Date.parse(r.ts) < 86400_000);
  const mix: Record<string, number> = {};
  for (const r of day) mix[r.pick ?? "?"] = (mix[r.pick ?? "?"] ?? 0) + 1;
  const fb = day.filter((r) => r.source === "fallback").length;
  const cost = day.reduce((n, r) => n + (r.cost ?? 0), 0);
  let last: any = null;
  try { last = JSON.parse(readFileSync(join(lifeosDir(), "MEMORY", "STATE", "router", "last.json"), "utf-8")); } catch {}
  const a = readAnthropicQuota(), o = readOpenAIQuota();
  const pct = (w?: { pct: number } | null) => (w ? `${w.pct}%` : "—");
  return view({
    title: "Router", subtitle: "Jev picks the lane, effort and strategy for every prompt",
    stats: [
      { label: "Decisions 24h", value: day.length },
      { label: "Fallback", value: day.length ? `${Math.round((100 * fb) / day.length)}%` : "—", dim: fb / Math.max(1, day.length) > 0.3 ? "warn" : "ok", sub: "heuristic, Jev unreachable" },
      { label: "Jev spend 24h", value: `$${cost.toFixed(4)}` },
      { label: "Last pick", value: last?.label ?? "—", sub: last ? `${last.strategy} · ${ago(last.at)} ago` : undefined, dim: "blue" },
      { label: "Anthropic", value: `5H ${pct(a.fiveHour)} · WK ${pct(a.week)}`, sub: `FB ${pct(a.fable)}` },
      { label: "OpenAI", value: `WK ${pct(o.week)}`, sub: o.plan ?? undefined },
    ],
    sections: [
      { title: "Lane mix (24h)", columns: ["Lane", "Picks", "Share"], rows: Object.entries(mix).sort((x, y) => y[1] - x[1]).map(([k, v]) => ({ cells: [LANES[k as keyof typeof LANES]?.label ?? k, v, `${Math.round((100 * v) / day.length)}%`] })), empty: "No routed prompts yet" },
      { title: "Lanes", columns: ["Lane", "Vendor", "Tier", "Model", "Agent", "Ceiling", "$ in/out"], rows: ROSTER_ORDER.map((id) => { const l = LANES[id]; return { cells: [l.label, l.vendor, l.tier, modelForLane(id), l.agent ?? "—", l.ceiling, `${l.costIn}/${l.costOut}`] }; }) },
      { title: "Recent decisions", columns: ["When", "Lane", "Mode", "Source", "p", "Latency"], rows: rows.slice(-25).reverse().map((r) => ({ cells: [ago(r.ts), LANES[r.pick as keyof typeof LANES]?.label ?? r.pick ?? "—", r.mode, r.source, r.p.toFixed(2), r.latencyMs ? `${r.latencyMs}ms` : "—"], dim: r.source === "fallback" ? "warn" : undefined })) },
    ],
  });
}

function findingsView(onlyHelios: boolean): View {
  const all = achilles.all().filter((f) => !onlyHelios || f.source === "helios");
  const open = all.filter((f) => f.status === "open" || f.status === "fixing");
  const overdue = open.filter((f) => dueAt(f) < Date.now());
  const sevDim = (s: string): Dim => (s === "critical" ? "err" : s === "high" ? "warn" : s === "medium" ? "blue" : "neutral");
  return view({
    title: onlyHelios ? "Helios" : "Achilles",
    subtitle: onlyHelios ? "Security findings from the Helios agent (CYBER lane), authorized targets only" : "Vulnerability management — every finding, SLA-tracked to remediation",
    stats: [
      { label: "Open", value: open.length, dim: open.length ? "warn" : "ok" },
      { label: "Overdue", value: overdue.length, dim: overdue.length ? "err" : "ok", sub: "past SLA" },
      { label: "Critical open", value: open.filter((f) => f.severity === "critical").length, dim: open.some((f) => f.severity === "critical") ? "err" : "ok" },
      { label: "Fixed", value: all.filter((f) => f.status === "fixed").length },
    ],
    sections: [{
      title: "Open findings", columns: ["Severity", "Asset", "Finding", "Source", "Status", "Due"],
      rows: open.sort((a, b) => dueAt(a) - dueAt(b)).map((f) => {
        const d = Math.round((dueAt(f) - Date.now()) / 86400_000);
        return { cells: [f.severity, f.asset, f.title, f.source, f.status, d < 0 ? `overdue ${-d}d` : `${d}d`], dim: sevDim(f.severity) };
      }),
      empty: "No open findings",
    }],
  });
}

function socratesView(): View {
  const qs = questions.all(), as = answers.all();
  const latest = new Map(as.map((a) => [a.qid, a]));
  const tri = (t: string): Dim => (t === "yes" ? "ok" : t === "no" ? "err" : "warn");
  return view({
    title: "Socrates", subtitle: "Standing questions, answered on a schedule: yes / no / unknown",
    stats: [
      { label: "Questions", value: qs.filter((q) => q.active).length },
      { label: "Answers 24h", value: as.filter((a) => Date.now() - Date.parse(a.ts) < 86400_000).length },
      { label: "Unknown now", value: qs.filter((q) => latest.get(q.id)?.answer === "unknown").length, dim: "warn" },
    ],
    sections: [{
      title: "Standing questions", columns: ["Question", "Every", "Last answer", "p", "Lane", "When"],
      rows: qs.map((q) => { const a = latest.get(q.id); return { cells: [q.question, `${q.everyHours}h`, a?.answer ?? "—", a?.p?.toFixed(2) ?? "—", a?.lane ?? "—", ago(a?.ts)], dim: a ? tri(a.answer) : "neutral" }; }),
      empty: "No standing questions — bun LIFEOS/SOCRATES/Socrates.ts add",
    }],
  });
}

function veraView(): View {
  const all = claims.all();
  const people = [...new Set(all.map((c) => c.person))];
  return view({
    title: "Vera", subtitle: "Versioned ideal-state profiles — a claim ledger, never edited in place",
    stats: [{ label: "Profiles", value: people.length }, { label: "Claims", value: all.filter((c) => !c.retracts).length }, { label: "Retractions", value: all.filter((c) => c.retracts).length }],
    sections: [{
      title: "Profiles", columns: ["Person", "Ideal", "Current", "Evidence", "Last change"],
      rows: people.map((p) => { const mine = all.filter((c) => c.person === p && !c.retracts); return { cells: [p, mine.filter((c) => c.kind === "ideal").length, mine.filter((c) => c.kind === "current").length, mine.filter((c) => c.kind === "evidence").length, ago(all.filter((c) => c.person === p).at(-1)?.ts)] }; }),
      empty: "No profiles — bun LIFEOS/VERA/Vera.ts claim",
    }],
  });
}

function errataView(): View {
  const all = errata.all();
  const open = all.filter((e) => e.status === "open");
  const themes: Record<string, number> = {};
  for (const e of open) if (e.theme) themes[e.theme] = (themes[e.theme] ?? 0) + 1;
  return view({
    title: "Errata", subtitle: "Every moment you were unhappy with a system we built — verbatim",
    stats: [
      { label: "Open", value: open.length, dim: open.length ? "warn" : "ok" },
      { label: "This week", value: all.filter((e) => Date.now() - Date.parse(e.ts) < 7 * 86400_000).length },
      { label: "Triaged", value: all.filter((e) => e.status === "triaged").length, sub: "→ Upgrades" },
      { label: "Recurring themes", value: Object.values(themes).filter((n) => n > 1).length, dim: "err" },
    ],
    sections: [
      { title: "Recurring", columns: ["Theme", "Open"], rows: Object.entries(themes).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ cells: [t, n], dim: "err" })), empty: "Nothing recurring" },
      { title: "Open errata", columns: ["When", "System", "Severity", "Verbatim"], rows: open.slice(-40).reverse().map((e) => ({ cells: [ago(e.ts), e.system ?? "—", e.severity ?? "—", e.verbatim], dim: e.severity === "high" ? "err" : undefined })), empty: "No open errata" },
    ],
  });
}

const ROUTES: Record<string, () => View> = {
  "/api/router": routerView,
  "/api/achilles": () => findingsView(false),
  "/api/helios": () => findingsView(true),
  "/api/socrates": socratesView,
  "/api/vera": veraView,
  "/api/errata": errataView,
};

let running = false;
export async function start() { running = true; }
export async function stop() { running = false; }
export function health() { return { status: running ? "healthy" : "stopped", details: { routes: Object.keys(ROUTES) } }; }
export function handles(pathname: string): boolean { return pathname.replace(/\/$/, "") in ROUTES; }

export async function handleRequest(_req: Request, pathname: string): Promise<Response> {
  const fn = ROUTES[pathname.replace(/\/$/, "")];
  if (!fn) return Response.json({ error: "Not found" }, { status: 404 });
  try { return Response.json(fn()); }
  catch (e) { return Response.json({ error: String((e as Error)?.message ?? e) }, { status: 500 }); }
}

// Exposed for tests.
export const _views = ROUTES;
export const _exists = existsSync;
