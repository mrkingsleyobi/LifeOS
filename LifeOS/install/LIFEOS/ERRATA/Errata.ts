#!/usr/bin/env bun
/**
 * ERRATA — the complaint ledger. One JSONL line per moment a human was unhappy
 * with a system we built, captured VERBATIM, enriched later, triaged into
 * Upgrades.
 *
 * Doors in:
 *   • SatisfactionCapture hook (low rating / explicit correction) → `capture`
 *   • /er slash command                                            → `capture`
 *   • app intake (Cloudflare worker errata-intake → `pull`)       → `pull`
 *   • backfill from FAILURES / ratings history                     → `backfill`
 *
 * Enrichment runs daily on the OpenAI lane (Luna by default, through the
 * Router's `run` verb), never inline at capture: the verbatim line is the
 * record, enrichment only adds { system, severity, theme }.
 *
 * Store: MEMORY/ERRATA/errata.jsonl
 *
 *   bun Errata.ts capture "<verbatim>" [--system Pulse] [--source er|hook|app|backfill] [--session id]
 *   bun Errata.ts list [--open] [--system X]
 *   bun Errata.ts enrich [--limit 50] [--lane luna]
 *   bun Errata.ts triage <id> [--claim "..."]        → Upgrades record (source: correction)
 *   bun Errata.ts pull                                 ← drain the cloud intake queue
 *   bun Errata.ts stats
 */

import { spawnSync } from "child_process";
import { join } from "path";
import { Ledger, args, type Row } from "../TOOLS/lib/Ledger";
import { addUpgrade } from "../TOOLS/Upgrades";

export interface Erratum extends Row {
  verbatim: string;
  source: "hook" | "er" | "app" | "backfill";
  system?: string;
  session?: string;
  severity?: "low" | "medium" | "high";
  theme?: string;
  status: "open" | "triaged" | "wontfix";
  upgrade?: string;
}

export const errata = new Ledger<Erratum>(join("MEMORY", "ERRATA", "errata.jsonl"), "er");

export function capture(verbatim: string, o: Partial<Erratum> = {}): Erratum {
  return errata.add({ verbatim, source: o.source ?? "er", system: o.system, session: o.session, status: "open" });
}

async function enrich(limit: number, lane: string) {
  const todo = errata.all().filter((e) => !e.theme && e.status === "open").slice(0, limit);
  if (!todo.length) return console.log("nothing to enrich");
  const brief = `For each complaint below, return one JSON object per line: {"id","system","severity":"low|medium|high","theme"} where theme is 2-5 words. Output JSONL only.\n\n` +
    todo.map((e) => JSON.stringify({ id: e.id, system: e.system ?? null, verbatim: e.verbatim })).join("\n");
  const r = spawnSync("bun", [join(import.meta.dir, "..", "ROUTER", "Router.ts"), "run", lane, "--effort", "low", "--sandbox", "read-only"], { input: brief, encoding: "utf-8" });
  let n = 0;
  for (const line of (r.stdout ?? "").split("\n")) {
    const m = line.match(/\{.*\}/);
    if (!m) continue;
    try {
      const j = JSON.parse(m[0]);
      if (todo.some((e) => e.id === j.id)) { errata.update(j.id, { system: j.system ?? undefined, severity: j.severity, theme: j.theme }); n++; }
    } catch {}
  }
  console.log(`enriched ${n}/${todo.length} on ${lane}${r.status ? ` (lane exit ${r.status})` : ""}`);
}

async function pull() {
  const url = process.env.LIFEOS_ERRATA_INTAKE_URL, tok = process.env.LIFEOS_ERRATA_INTAKE_TOKEN;
  if (!url || !tok) { console.error("set LIFEOS_ERRATA_INTAKE_URL and LIFEOS_ERRATA_INTAKE_TOKEN"); process.exit(2); }
  const res = await fetch(`${url.replace(/\/$/, "")}/drain`, { method: "POST", headers: { Authorization: `Bearer ${tok}` } });
  if (!res.ok) { console.error(`drain failed: ${res.status}`); process.exit(1); }
  const items = (await res.json()) as { verbatim: string; app?: string }[];
  for (const it of items) capture(it.verbatim, { source: "app", system: it.app });
  console.log(`pulled ${items.length}`);
}

if (import.meta.main) {
  const { pos: [cmd, a1], flags } = args();
  switch (cmd) {
    case "capture": {
      if (!a1) { console.error('capture "<verbatim>"'); process.exit(2); }
      const e = capture(a1, { system: flags.system, source: (flags.source as Erratum["source"]) ?? "er", session: flags.session });
      console.log(e.id);
      break;
    }
    case "list":
      for (const e of errata.all().filter((e) => (!flags.open || e.status === "open") && (!flags.system || e.system === flags.system)))
        console.log(`${e.id} ${e.status.padEnd(8)} ${(e.severity ?? "—").padEnd(6)} ${(e.system ?? "—").padEnd(12)} ${e.verbatim.slice(0, 90)}`);
      break;
    case "enrich": await enrich(Number(flags.limit ?? 50), flags.lane ?? "luna"); break;
    case "triage": {
      const e = a1 && errata.get(a1);
      if (!e) { console.error("triage <id>"); process.exit(2); }
      const u = addUpgrade({ claim: flags.claim ?? `${e.system ?? "System"}: ${e.theme ?? e.verbatim.slice(0, 120)}`, source: "correction", current_state: e.verbatim, session_id: e.session, evidence: [e.id] });
      errata.update(e.id, { status: "triaged", upgrade: u.id });
      console.log(`${e.id} → upgrade ${u.id}${u.created ? "" : ` (${u.reason})`}`);
      break;
    }
    case "pull": await pull(); break;
    case "stats": {
      const all = errata.all();
      const by = (k: keyof Erratum) => Object.entries(all.reduce((m, e) => ((m[String(e[k] ?? "—")] = (m[String(e[k] ?? "—")] ?? 0) + 1), m), {} as Record<string, number>)).map(([a, b]) => `${a}=${b}`).join(" ");
      console.log(`total ${all.length} · status ${by("status")} · system ${by("system")}`);
      break;
    }
    default:
      console.error("usage: Errata.ts capture|list|enrich|triage|pull|stats");
      process.exit(2);
  }
}
