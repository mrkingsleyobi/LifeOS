#!/usr/bin/env bun
/**
 * SOCRATES — the standing-question ledger.
 *
 * A standing question is asked again on a schedule against a named source of
 * state, and answered THREE-valued: yes / no / unknown. Unknown is a real
 * answer ("the evidence doesn't settle it"), never coerced into yes or no.
 * When an answer matches the question's trigger, the action router opens a
 * ticket: Achilles (security exposure) or Upgrades (system improvement).
 *
 * Judgment runs on the right lane for the data:
 *   • state classifies PUBLIC/INTERNAL → Jev noul (P(yes)); yes ≥ 0.7, no ≤ 0.3
 *   • state is sensitive               → the private lane (local llama.cpp)
 *
 * Sources: cmd:<shell> | file:<path> | url:<https://…>
 *
 *   bun Socrates.ts add "<question>" --source "url:https://example.com/robots.txt" --every 1d --act-on yes --route achilles
 *   bun Socrates.ts list
 *   bun Socrates.ts run [--all] [--id q-…]        (default: only the due ones)
 *   bun Socrates.ts history <id>
 *
 * Stores: MEMORY/SOCRATES/questions.jsonl · MEMORY/SOCRATES/answers.jsonl
 */

import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";
import { Ledger, args, type Row } from "../TOOLS/lib/Ledger";
import { ask } from "../DECISIONS/Jev";
import { record } from "../DECISIONS/Decisions";
import { classifyText } from "../../hooks/lib/egress-class-core";
import { complete as privateComplete } from "../ROUTER/PrivateLane";
import { addUpgrade } from "../TOOLS/Upgrades";
import { achilles } from "../ACHILLES/Achilles";

export type Tri = "yes" | "no" | "unknown";

export interface Question extends Row {
  question: string;
  source: string;
  everyHours: number;
  actOn?: Tri;
  route?: "achilles" | "upgrades";
  active: boolean;
}
export interface Answer extends Row { qid: string; answer: Tri; p?: number; lane: "jev" | "private" | "none"; detail?: string }

export const questions = new Ledger<Question>(join("MEMORY", "SOCRATES", "questions.jsonl"), "q");
export const answers = new Ledger<Answer>(join("MEMORY", "SOCRATES", "answers.jsonl"), "a");

const hours = (s = "1d") => { const m = s.match(/^(\d+)([hdw])$/); if (!m) return 24; return Number(m[1]) * ({ h: 1, d: 24, w: 168 } as const)[m[2] as "h" | "d" | "w"]; };

export function triFromP(p: number): Tri { return p >= 0.7 ? "yes" : p <= 0.3 ? "no" : "unknown"; }

async function readSource(src: string): Promise<string> {
  const [kind, ...rest] = src.split(":");
  const target = rest.join(":");
  if (kind === "cmd") return execSync(target, { encoding: "utf-8", timeout: 30_000, maxBuffer: 4 << 20 });
  if (kind === "file") return readFileSync(target, "utf-8");
  if (kind === "url") { const r = await fetch(target, { signal: AbortSignal.timeout(15_000) }); return `HTTP ${r.status}\n${(await r.text()).slice(0, 60_000)}`; }
  throw new Error(`unknown source kind: ${kind}`);
}

export async function answer(q: Question): Promise<Answer> {
  let state: string;
  try { state = await readSource(q.source); }
  catch (e: any) { return answers.add({ qid: q.id, answer: "unknown", lane: "none", detail: `source failed: ${e?.message ?? e}` }); }

  const cls = classifyText(state);
  if (cls === "PUBLIC" || cls === "INTERNAL") {
    const r = await ask(state, { q: { type: "noul", instructions: `Given \`state\`, is the answer to this question yes? ${q.question}` } }, { timeoutMs: 10_000 });
    if (r.ok) {
      const p = r.answers.q.noul;
      record({ caller: "socrates-answer", mode: "shadow", verdict: "do-not-act", p, source: "jev", jevModel: r.model, cost: r.usage.cost, reason: q.id });
      return answers.add({ qid: q.id, answer: triFromP(p), p, lane: "jev" });
    }
    return answers.add({ qid: q.id, answer: "unknown", lane: "none", detail: `jev ${r.reason}` });
  }
  // Sensitive state never leaves the box.
  try {
    const out = await privateComplete(`Answer with exactly one word: yes, no, or unknown.\nQuestion: ${q.question}\n\nState:\n${state.slice(0, 40_000)}`, { maxTokens: 5 });
    const w = out.trim().toLowerCase().match(/^(yes|no|unknown)/)?.[1] as Tri | undefined;
    return answers.add({ qid: q.id, answer: w ?? "unknown", lane: "private" });
  } catch (e: any) {
    return answers.add({ qid: q.id, answer: "unknown", lane: "none", detail: `private lane: ${e?.message ?? e}` });
  }
}

function act(q: Question, a: Answer) {
  if (!q.actOn || a.answer !== q.actOn) return;
  const title = `Socrates: "${q.question}" → ${a.answer}`;
  if (q.route === "achilles") achilles.add({ asset: q.source, severity: "medium", title, source: "socrates", status: "open", evidence: [a.id] });
  else addUpgrade({ claim: title, source: "autonomous", evidence: [q.id, a.id] });
  console.log(`  ↳ routed to ${q.route ?? "upgrades"}`);
}

export function due(q: Question, now = Date.now()): boolean {
  const last = answers.all().filter((a) => a.qid === q.id).at(-1);
  return q.active && (!last || now - Date.parse(last.ts) >= q.everyHours * 3600_000);
}

if (import.meta.main) {
  const { pos: [cmd, a1], flags } = args();
  switch (cmd) {
    case "add": {
      if (!a1 || !flags.source) { console.error('add "<question>" --source kind:target [--every 1d] [--act-on yes|no|unknown] [--route achilles|upgrades]'); process.exit(2); }
      const q = questions.add({ question: a1, source: flags.source, everyHours: hours(flags.every), actOn: flags["act-on"] as Tri | undefined, route: flags.route as Question["route"], active: true });
      console.log(q.id);
      break;
    }
    case "list":
      for (const q of questions.all()) {
        const last = answers.all().filter((a) => a.qid === q.id).at(-1);
        console.log(`${q.id} every ${q.everyHours}h  last=${last?.answer ?? "—"}${last?.p !== undefined ? ` (p ${last.p.toFixed(2)})` : ""}  ${q.question}`);
      }
      break;
    case "run": {
      const qs = questions.all().filter((q) => (flags.id ? q.id === flags.id : flags.all ? q.active : due(q)));
      for (const q of qs) {
        const a = await answer(q);
        console.log(`${q.id} → ${a.answer}${a.p !== undefined ? ` (p ${a.p.toFixed(2)})` : ""} via ${a.lane}${a.detail ? ` — ${a.detail}` : ""}`);
        act(q, a);
      }
      if (!qs.length) console.log("nothing due");
      break;
    }
    case "history":
      for (const a of answers.all().filter((a) => a.qid === a1)) console.log(`${a.ts} ${a.answer} ${a.p ?? ""} ${a.lane}`);
      break;
    default:
      console.error("usage: Socrates.ts add|list|run|history");
      process.exit(2);
  }
}
