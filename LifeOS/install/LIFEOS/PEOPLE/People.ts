#!/usr/bin/env bun
/**
 * PEOPLE — the one local people system. One record per person, a typed
 * interaction ledger, customer state, and a business-only projection as the
 * single way data about people leaves this module.
 *
 * Everything here is RESTRICTED by data class (DataClassification.md): the
 * Router pins any prompt that pulls People records to the private lane, and
 * nothing in this file calls a network or a model.
 *
 *   bun People.ts add "Ada Lovelace" [--email a@x] [--org "Analytical"] [--tags friend,customer]
 *   bun People.ts who <query>                    fuzzy find by name/email/org/tag
 *   bun People.ts log <person-id> --kind call|email|meeting|message|intro --note "…"
 *   bun People.ts customer <person-id> --state lead|active|churned [--value 1200]
 *   bun People.ts show <person-id>
 *   bun People.ts projection                     business-only view (no notes, no personal fields)
 *   bun People.ts tick                           hourly: stale-relationship nudges (com.lifeos.people)
 *
 * Apple Contacts two-way sync is macOS-only and stays in the private tree
 * (it needs Contacts.framework entitlements); this file is the store it syncs to.
 *
 * Stores: USER/PEOPLE/people.jsonl · USER/PEOPLE/interactions.jsonl
 */

import { join } from "path";
import { Ledger, args, type Row } from "../TOOLS/lib/Ledger";

export interface Person extends Row {
  name: string;
  email?: string;
  org?: string;
  tags: string[];
  customer?: { state: "lead" | "active" | "churned"; value?: number; since: string };
  cadenceDays?: number;
}
export interface Interaction extends Row { person: string; kind: "call" | "email" | "meeting" | "message" | "intro"; note?: string }

export const people = new Ledger<Person>(join("USER", "PEOPLE", "people.jsonl"), "p");
export const interactions = new Ledger<Interaction>(join("USER", "PEOPLE", "interactions.jsonl"), "ix");

export function who(q: string): Person[] {
  const s = q.toLowerCase();
  return people.all().filter((p) => [p.name, p.email, p.org, ...p.tags].some((f) => f?.toLowerCase().includes(s)));
}

function lastTouch(id: string): number {
  const ix = interactions.all().filter((i) => i.person === id).at(-1);
  return ix ? Date.parse(ix.ts) : 0;
}

if (import.meta.main) {
  const { pos: [cmd, a1], flags } = args();
  switch (cmd) {
    case "add":
      if (!a1) { console.error('add "<name>"'); process.exit(2); }
      console.log(people.add({ name: a1, email: flags.email, org: flags.org, tags: flags.tags ? flags.tags.split(",") : [], cadenceDays: flags.cadence ? Number(flags.cadence) : undefined }).id);
      break;
    case "who":
      for (const p of who(a1 ?? "")) console.log(`${p.id} ${p.name}${p.org ? ` · ${p.org}` : ""}${p.tags.length ? ` [${p.tags.join(",")}]` : ""}`);
      break;
    case "log":
      if (!a1 || !people.get(a1) || !flags.kind) { console.error("log <person-id> --kind … --note …"); process.exit(2); }
      console.log(interactions.add({ person: a1, kind: flags.kind as Interaction["kind"], note: flags.note }).id);
      break;
    case "customer":
      if (!a1 || !people.get(a1) || !flags.state) { console.error("customer <person-id> --state lead|active|churned"); process.exit(2); }
      people.update(a1, { customer: { state: flags.state as "lead", value: flags.value ? Number(flags.value) : undefined, since: new Date().toISOString() } });
      console.log("ok");
      break;
    case "show": {
      const p = a1 && people.get(a1);
      if (!p) { console.error("show <person-id>"); process.exit(2); }
      console.log(JSON.stringify(p, null, 2));
      for (const i of interactions.all().filter((i) => i.person === a1)) console.log(`  ${i.ts.slice(0, 10)} ${i.kind} ${i.note ?? ""}`);
      break;
    }
    case "projection":
      // The single way out: business fields only — no notes, no personal email, no tags beyond "customer".
      console.log(JSON.stringify(people.all().filter((p) => p.customer).map((p) => ({ id: p.id, name: p.name, org: p.org ?? null, customer: p.customer })), null, 2));
      break;
    case "tick": {
      const now = Date.now();
      for (const p of people.all().filter((p) => p.cadenceDays)) {
        const days = Math.floor((now - lastTouch(p.id)) / 86400_000);
        if (days > p.cadenceDays!) console.log(`reach out: ${p.name} (${days}d since last touch, cadence ${p.cadenceDays}d)`);
      }
      break;
    }
    default:
      console.error("usage: People.ts add|who|log|customer|show|projection|tick");
      process.exit(2);
  }
}
