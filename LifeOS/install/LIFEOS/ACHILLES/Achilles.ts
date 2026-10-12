#!/usr/bin/env bun
/**
 * ACHILLES — vulnerability management. One registry for every finding,
 * whoever found it (Helios, the Bunker/Arbol security plane, KEV sync,
 * Socrates, manual), with SLA-driven remediation pings.
 *
 * SLA by severity: critical 2d · high 7d · medium 30d · low 90d.
 *
 *   bun Achilles.ts add --asset api.example.com --severity high --title "…" [--source helios] [--evidence url]
 *   bun Achilles.ts list [--open] [--asset X]
 *   bun Achilles.ts status <id> open|fixing|fixed|accepted [--note "…"]
 *   bun Achilles.ts due                         SLA-breached + due-soon findings (the remediation ping)
 *   bun Achilles.ts kev                         CISA KEV ∩ USER/CONFIG/achilles-inventory.json
 *
 * Inventory (private): USER/CONFIG/achilles-inventory.json
 *   [{ "asset": "nas.home", "vendor": "Synology", "product": "DiskStation Manager" }, …]
 *
 * Store: MEMORY/SECURITY/ACHILLES/findings.jsonl
 */

import { readFileSync } from "fs";
import { join } from "path";
import { Ledger, args, lifeosDir, type Row } from "../TOOLS/lib/Ledger";

export type Severity = "critical" | "high" | "medium" | "low";
export interface Finding extends Row {
  asset: string;
  severity: Severity;
  title: string;
  source: "helios" | "scanner" | "kev" | "socrates" | "manual";
  status: "open" | "fixing" | "fixed" | "accepted";
  evidence?: string[];
  cve?: string;
  notes?: string[];
  closedAt?: string;
}

export const SLA_DAYS: Record<Severity, number> = { critical: 2, high: 7, medium: 30, low: 90 };
export const achilles = new Ledger<Finding>(join("MEMORY", "SECURITY", "ACHILLES", "findings.jsonl"), "ach");

export function dueAt(f: Finding): number { return Date.parse(f.ts) + SLA_DAYS[f.severity] * 86400_000; }

const KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";

async function kevSync() {
  let inv: { asset: string; vendor: string; product: string }[] = [];
  try { inv = JSON.parse(readFileSync(join(lifeosDir(), "USER", "CONFIG", "achilles-inventory.json"), "utf-8")); }
  catch { console.error("no USER/CONFIG/achilles-inventory.json — nothing to match"); process.exit(2); }
  const kev = (await (await fetch(KEV_URL, { signal: AbortSignal.timeout(20_000) })).json()) as { vulnerabilities: any[] };
  const known = new Set(achilles.all().map((f) => `${f.asset}|${f.cve}`));
  let n = 0;
  for (const v of kev.vulnerabilities) {
    for (const it of inv) {
      if (v.vendorProject?.toLowerCase() !== it.vendor.toLowerCase()) continue;
      if (!String(v.product ?? "").toLowerCase().includes(it.product.toLowerCase()) && !it.product.toLowerCase().includes(String(v.product ?? "").toLowerCase())) continue;
      if (known.has(`${it.asset}|${v.cveID}`)) continue;
      achilles.add({ asset: it.asset, severity: v.knownRansomwareCampaignUse === "Known" ? "critical" : "high", title: `${v.cveID} ${v.vulnerabilityName}`, source: "kev", status: "open", cve: v.cveID, evidence: [KEV_URL] });
      n++;
    }
  }
  console.log(`KEV: ${kev.vulnerabilities.length} entries, ${n} new finding(s) against ${inv.length} inventory item(s)`);
}

if (import.meta.main) {
  const { pos: [cmd, a1, a2], flags } = args();
  switch (cmd) {
    case "add": {
      if (!flags.asset || !flags.title || !(flags.severity in SLA_DAYS)) { console.error("add --asset --severity critical|high|medium|low --title"); process.exit(2); }
      console.log(achilles.add({ asset: flags.asset, severity: flags.severity as Severity, title: flags.title, source: (flags.source as Finding["source"]) ?? "manual", status: "open", evidence: flags.evidence ? [flags.evidence] : [], cve: flags.cve }).id);
      break;
    }
    case "list":
      for (const f of achilles.all().filter((f) => (!flags.open || f.status === "open" || f.status === "fixing") && (!flags.asset || f.asset === flags.asset)))
        console.log(`${f.id} ${f.severity.padEnd(8)} ${f.status.padEnd(8)} ${f.asset.padEnd(24)} ${f.title.slice(0, 80)}`);
      break;
    case "status": {
      if (!a1 || !["open", "fixing", "fixed", "accepted"].includes(a2)) { console.error("status <id> open|fixing|fixed|accepted"); process.exit(2); }
      const cur = achilles.get(a1);
      if (!cur) { console.error("no such finding"); process.exit(1); }
      achilles.update(a1, { status: a2 as Finding["status"], closedAt: a2 === "fixed" || a2 === "accepted" ? new Date().toISOString() : undefined, notes: flags.note ? [...(cur!.notes ?? []), flags.note] : cur!.notes });
      console.log(`${a1} → ${a2}`);
      break;
    }
    case "due": {
      const now = Date.now();
      const open = achilles.all().filter((f) => f.status === "open" || f.status === "fixing").sort((a, b) => dueAt(a) - dueAt(b));
      for (const f of open) {
        const d = Math.round((dueAt(f) - now) / 86400_000);
        if (d <= 3) console.log(`${d < 0 ? `OVERDUE ${-d}d` : `due in ${d}d`}  ${f.severity} ${f.asset} — ${f.title.slice(0, 70)} (${f.id})`);
      }
      if (!open.length) console.log("no open findings");
      break;
    }
    case "kev": await kevSync(); break;
    default:
      console.error("usage: Achilles.ts add|list|status|due|kev");
      process.exit(2);
  }
}
