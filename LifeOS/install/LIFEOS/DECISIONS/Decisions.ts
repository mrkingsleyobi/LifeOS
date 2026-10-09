#!/usr/bin/env bun
/**
 * DECISIONS — the judgment system. Every fuzzy call code makes is one typed
 * question answered with a probability and an act / do-not-act verdict.
 * Jev (./Jev.ts) is the engine underneath; this file is the governance.
 *
 *   caller registry   — who may ask, at what threshold, under what budget
 *   shadow | enforce  — a new caller starts in SHADOW: it always returns
 *                       "do not act" while its answers are logged against
 *                       outcomes. It moves to ENFORCE only with a registry row
 *                       recording its agreement rate, the date, and the Jev
 *                       model it was measured on — or an explicit principal
 *                       override. If the served Jev model drifts from the
 *                       measured one, the caller falls back to SHADOW.
 *   ledger            — one JSONL line per call: MEMORY/OBSERVABILITY/decisions.jsonl
 *   budgets           — daily call + dollar cap per caller
 *
 * Registry: defaults below, overlaid by USER/CONFIG/decisions.json (private).
 *
 * CLI: bun Decisions.ts status|report|alerts|drift|callers
 *      bun Decisions.ts enforce <caller> (--agreement 0.91 --model jev-1.13 | --principal)
 *      bun Decisions.ts shadow <caller>
 *      bun Decisions.ts outcome <ledger-id> <agree|disagree>
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";

export type Mode = "shadow" | "enforce";

export interface Caller {
  id: string;
  purpose: string;
  mode: Mode;
  /** Act when the decisive probability ≥ threshold. */
  threshold: number;
  budget: { callsPerDay: number; usdPerDay: number };
  /** Evidence required for ENFORCE (unless principalOverride). */
  measured?: { agreement: number; on: string; jevModel: string; n?: number };
  principalOverride?: { by: string; on: string; note?: string };
}

export interface LedgerRow {
  id: string;
  ts: string;
  caller: string;
  mode: Mode;
  verdict: "act" | "do-not-act";
  p: number;
  pick?: string;
  jevModel?: string;
  latencyMs?: number;
  cost?: number;
  source: "jev" | "fallback" | "fast-path" | "pinned";
  reason?: string;
  outcome?: "agree" | "disagree";
  session?: string;
}

const LIFEOS = () => {
  const v = process.env.LIFEOS_DIR;
  if (v && !/^\$\{?HOME/.test(v)) return v;
  return join(homedir(), ".claude", "LIFEOS");
};
const registryPath = () => join(LIFEOS(), "USER", "CONFIG", "decisions.json");
export const ledgerPath = () => join(LIFEOS(), "MEMORY", "OBSERVABILITY", "decisions.jsonl");

/** Shipped callers. The principal turned the router on directly (2026-10-09), so it enforces on override. */
export const DEFAULT_CALLERS: Record<string, Caller> = {
  "dispatch-advisor": {
    id: "dispatch-advisor",
    purpose: "UserPromptSubmit router — lane + effort per prompt (Glance-style front door)",
    mode: "enforce",
    threshold: 0.5,
    budget: { callsPerDay: 2000, usdPerDay: 0.5 },
    principalOverride: { by: "principal", on: "2026-10-09", note: "route my work across OpenAI + Anthropic tiers" },
  },
  "private-lane-gate": {
    id: "private-lane-gate",
    purpose: "Does this prompt carry personal/sensitive data that must stay on the box?",
    mode: "enforce",
    threshold: 0.6,
    budget: { callsPerDay: 2000, usdPerDay: 0.25 },
    principalOverride: { by: "principal", on: "2026-10-09", note: "fail toward the private lane" },
  },
  "satisfaction-capture": {
    id: "satisfaction-capture",
    purpose: "Was the principal unhappy with a system we built? (Errata door)",
    mode: "shadow",
    threshold: 0.7,
    budget: { callsPerDay: 500, usdPerDay: 0.1 },
  },
  "socrates-answer": {
    id: "socrates-answer",
    purpose: "Three-valued answers to standing questions (Socrates)",
    mode: "shadow",
    threshold: 0.75,
    budget: { callsPerDay: 200, usdPerDay: 0.1 },
  },
};

export function loadRegistry(): Record<string, Caller> {
  const reg = structuredClone(DEFAULT_CALLERS);
  try {
    const user = JSON.parse(readFileSync(registryPath(), "utf-8")) as Record<string, Partial<Caller>>;
    for (const [id, row] of Object.entries(user)) reg[id] = { ...(reg[id] ?? { id, purpose: "", mode: "shadow", threshold: 0.5, budget: { callsPerDay: 100, usdPerDay: 0.05 } }), ...row, id } as Caller;
  } catch { /* no overlay */ }
  return reg;
}

function saveOverlay(id: string, patch: Partial<Caller>) {
  const p = registryPath();
  let cur: Record<string, Partial<Caller>> = {};
  try { cur = JSON.parse(readFileSync(p, "utf-8")); } catch {}
  cur[id] = { ...(cur[id] ?? {}), ...patch };
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(cur, null, 2) + "\n");
}

/** Effective mode after the drift rule: measured enforcement on a different Jev model reverts to shadow. */
export function effectiveMode(c: Caller, servedJevModel?: string): Mode {
  if (c.mode !== "enforce") return "shadow";
  if (c.principalOverride) return "enforce";
  if (!c.measured) return "shadow";
  if (servedJevModel && !servedJevModel.startsWith(c.measured.jevModel)) return "shadow";
  return "enforce";
}

export function readLedger(): LedgerRow[] {
  try {
    return readFileSync(ledgerPath(), "utf-8").split("\n").filter(Boolean).map((l: string) => JSON.parse(l) as LedgerRow);
  } catch { return []; }
}

export function todaySpend(caller: string, rows = readLedger()): { calls: number; usd: number } {
  const day = new Date().toISOString().slice(0, 10);
  let calls = 0, usd = 0;
  for (const r of rows) if (r.caller === caller && r.ts.startsWith(day) && r.source === "jev") { calls++; usd += r.cost ?? 0; }
  return { calls, usd };
}

/** May this caller spend a Jev call right now? */
export function withinBudget(c: Caller): boolean {
  const s = todaySpend(c.id);
  return s.calls < c.budget.callsPerDay && s.usd < c.budget.usdPerDay;
}

export function record(row: Omit<LedgerRow, "id" | "ts">): LedgerRow {
  const full: LedgerRow = { id: crypto.randomUUID().slice(0, 12), ts: new Date().toISOString(), ...row };
  try {
    mkdirSync(dirname(ledgerPath()), { recursive: true });
    appendFileSync(ledgerPath(), JSON.stringify(full) + "\n");
  } catch { /* ledger is best-effort; never break the caller */ }
  return full;
}

/** Turn a probability into a governed verdict. Shadow callers never act. */
export function decide(callerId: string, p: number, extra: Partial<LedgerRow> = {}): LedgerRow {
  const c = loadRegistry()[callerId];
  if (!c) throw new Error(`unknown caller ${callerId}`);
  const mode = effectiveMode(c, extra.jevModel);
  const verdict = mode === "enforce" && p >= c.threshold ? "act" : "do-not-act";
  return record({ caller: callerId, mode, verdict, p, source: "jev", ...extra });
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (import.meta.main) {
  const [cmd, a1, a2] = process.argv.slice(2);
  const flag = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
  const reg = loadRegistry();
  const rows = readLedger();
  switch (cmd ?? "status") {
    case "callers":
    case "status": {
      for (const c of Object.values(reg)) {
        const s = todaySpend(c.id, rows);
        const why = c.principalOverride ? `override ${c.principalOverride.on}` : c.measured ? `agree ${c.measured.agreement} on ${c.measured.jevModel}` : "unmeasured";
        console.log(`${c.id.padEnd(22)} ${effectiveMode(c).toUpperCase().padEnd(8)} θ=${c.threshold}  today ${s.calls}/${c.budget.callsPerDay} calls $${s.usd.toFixed(4)}/$${c.budget.usdPerDay}  (${why})`);
      }
      break;
    }
    case "report": {
      const by: Record<string, { n: number; act: number; fb: number; agree: number; judged: number; ms: number }> = {};
      for (const r of rows) {
        const b = (by[r.caller] ??= { n: 0, act: 0, fb: 0, agree: 0, judged: 0, ms: 0 });
        b.n++; if (r.verdict === "act") b.act++; if (r.source === "fallback") b.fb++;
        if (r.outcome) { b.judged++; if (r.outcome === "agree") b.agree++; }
        b.ms += r.latencyMs ?? 0;
      }
      for (const [id, b] of Object.entries(by)) {
        console.log(`${id.padEnd(22)} n=${b.n} act=${b.act} fallback=${b.fb} agreement=${b.judged ? (b.agree / b.judged).toFixed(2) : "—"} (${b.judged} judged) avg=${Math.round(b.ms / b.n)}ms`);
      }
      break;
    }
    case "alerts": {
      let n = 0;
      for (const c of Object.values(reg)) {
        const s = todaySpend(c.id, rows);
        if (s.calls >= c.budget.callsPerDay * 0.9 || s.usd >= c.budget.usdPerDay * 0.9) { n++; console.log(`BUDGET ${c.id}: ${s.calls} calls, $${s.usd.toFixed(4)}`); }
        const recent = rows.filter((r) => r.caller === c.id).slice(-50);
        const fb = recent.filter((r) => r.source === "fallback").length;
        if (recent.length >= 10 && fb / recent.length > 0.3) { n++; console.log(`FALLBACK ${c.id}: ${fb}/${recent.length} recent calls fell back (Jev unreachable?)`); }
      }
      if (!n) console.log("no alerts");
      break;
    }
    case "drift": {
      const served = [...rows].reverse().find((r) => r.jevModel)?.jevModel;
      for (const c of Object.values(reg)) {
        if (c.measured && served && !served.startsWith(c.measured.jevModel)) console.log(`DRIFT ${c.id}: measured on ${c.measured.jevModel}, now served ${served} → SHADOW`);
      }
      console.log(`served Jev model: ${served ?? "unknown"}`);
      break;
    }
    case "enforce": {
      if (!a1 || !reg[a1]) { console.error("enforce <caller> (--agreement N --model M | --principal)"); process.exit(2); }
      if (process.argv.includes("--principal")) {
        saveOverlay(a1, { mode: "enforce", principalOverride: { by: "principal", on: new Date().toISOString().slice(0, 10) } });
      } else {
        const agreement = Number(flag("--agreement")), jevModel = flag("--model");
        if (!(agreement > 0) || !jevModel) { console.error("--agreement and --model required (or --principal)"); process.exit(2); }
        saveOverlay(a1, { mode: "enforce", measured: { agreement, jevModel, on: new Date().toISOString().slice(0, 10) } });
      }
      console.log(`${a1} → ENFORCE`);
      break;
    }
    case "shadow":
      if (!a1) { console.error("shadow <caller>"); process.exit(2); }
      saveOverlay(a1, { mode: "shadow", principalOverride: undefined });
      console.log(`${a1} → SHADOW`);
      break;
    case "outcome": {
      if (!a1 || (a2 !== "agree" && a2 !== "disagree")) { console.error("outcome <ledger-id> agree|disagree"); process.exit(2); }
      const all = readLedger();
      const hit = all.find((r) => r.id === a1);
      if (!hit) { console.error("no such ledger id"); process.exit(1); }
      hit!.outcome = a2;
      writeFileSync(ledgerPath(), all.map((r) => JSON.stringify(r)).join("\n") + "\n");
      console.log(`recorded ${a2} for ${a1}`);
      break;
    }
    default:
      console.error("usage: Decisions.ts status|report|alerts|drift|callers|enforce|shadow|outcome");
      process.exit(2);
  }
}
