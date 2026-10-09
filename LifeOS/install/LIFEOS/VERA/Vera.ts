#!/usr/bin/env bun
/**
 * VERA — versioned ideal-state profiles of people.
 *
 * A profile is never edited in place. It is a CLAIM LEDGER: each line asserts
 * one thing about a person (their ideal state, their current state, or a piece
 * of evidence), with a source. A projection folds the ledger into the profile
 * as of any version, so "what did we believe about X in June" is a query, not
 * an archaeology dig. Retracting a claim is a new claim, not a deletion.
 *
 *   bun Vera.ts claim <person> --kind ideal|current|evidence --text "…" [--source "1:1 2026-10-02"]
 *   bun Vera.ts retract <claim-id> [--why "…"]
 *   bun Vera.ts profile <person> [--as-of 2026-09-01]     projection → markdown
 *   bun Vera.ts diff <person> --from 2026-06-01 [--to now]
 *   bun Vera.ts gap <person>                              ideal vs current, side by side
 *
 * <person> is a People id (LIFEOS/PEOPLE) or "self" for the principal.
 * RESTRICTED data class: nothing here calls a network or a cloud model; a
 * synthesis pass, if wanted, goes through the private lane.
 *
 * Store: USER/VERA/claims.jsonl
 */

import { join } from "path";
import { Ledger, args, type Row } from "../TOOLS/lib/Ledger";

export interface Claim extends Row {
  person: string;
  kind: "ideal" | "current" | "evidence";
  text: string;
  source?: string;
  retracts?: string;
  why?: string;
}

export const claims = new Ledger<Claim>(join("USER", "VERA", "claims.jsonl"), "vc");

/** Fold the ledger for a person as of a timestamp: retractions remove earlier claims. */
export function project(person: string, asOf = Date.now()): Claim[] {
  const rows = claims.all().filter((c) => c.person === person && Date.parse(c.ts) <= asOf);
  const retracted = new Set(rows.filter((c) => c.retracts).map((c) => c.retracts!));
  return rows.filter((c) => !c.retracts && !retracted.has(c.id));
}

function render(person: string, live: Claim[], asOf: string): string {
  const sec = (k: Claim["kind"], title: string) => {
    const items = live.filter((c) => c.kind === k);
    return `## ${title}\n${items.length ? items.map((c) => `- ${c.text}${c.source ? ` _(${c.source})_` : ""} \`${c.id}\``).join("\n") : "- —"}\n`;
  };
  return `# Vera — ${person} (as of ${asOf})\n\n${sec("ideal", "Ideal state")}\n${sec("current", "Current state")}\n${sec("evidence", "Evidence")}`;
}

if (import.meta.main) {
  const { pos: [cmd, a1], flags } = args();
  const when = (s?: string) => (!s || s === "now" ? Date.now() : Date.parse(s));
  switch (cmd) {
    case "claim":
      if (!a1 || !flags.text || !["ideal", "current", "evidence"].includes(flags.kind)) { console.error("claim <person> --kind ideal|current|evidence --text …"); process.exit(2); }
      console.log(claims.add({ person: a1, kind: flags.kind as Claim["kind"], text: flags.text, source: flags.source }).id);
      break;
    case "retract": {
      const c = a1 && claims.get(a1);
      if (!c) { console.error("retract <claim-id>"); process.exit(2); }
      console.log(claims.add({ person: c.person, kind: c.kind, text: `(retracts ${c.id})`, retracts: c.id, why: flags.why }).id);
      break;
    }
    case "profile":
      if (!a1) { console.error("profile <person>"); process.exit(2); }
      console.log(render(a1, project(a1, when(flags["as-of"])), flags["as-of"] ?? new Date().toISOString().slice(0, 10)));
      break;
    case "diff": {
      if (!a1 || !flags.from) { console.error("diff <person> --from <date>"); process.exit(2); }
      const before = new Set(project(a1, when(flags.from)).map((c) => c.id));
      const after = project(a1, when(flags.to));
      const afterIds = new Set(after.map((c) => c.id));
      for (const c of after.filter((c) => !before.has(c.id))) console.log(`+ [${c.kind}] ${c.text}`);
      for (const id of [...before].filter((id) => !afterIds.has(id))) console.log(`- ${claims.get(id)?.text ?? id}`);
      break;
    }
    case "gap": {
      if (!a1) { console.error("gap <person>"); process.exit(2); }
      const live = project(a1);
      const ideal = live.filter((c) => c.kind === "ideal"), cur = live.filter((c) => c.kind === "current");
      const n = Math.max(ideal.length, cur.length);
      for (let i = 0; i < n; i++) console.log(`${(ideal[i]?.text ?? "").padEnd(50).slice(0, 50)} │ ${cur[i]?.text ?? ""}`);
      break;
    }
    default:
      console.error("usage: Vera.ts claim|retract|profile|diff|gap");
      process.exit(2);
  }
}
