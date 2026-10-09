#!/usr/bin/env bun
/**
 * BUNKER — the universal application harness (local front door).
 * Concept doc: LIFEOS/DOCUMENTATION/Bunker/BunkerSystem.md. "The harness speaks ISA."
 *
 *   bunker test [--isa <path>] [--app <name>]   run every deterministic probe in the ISA's ## Test Strategy;
 *                                               eval rows → named exceptions (EvalRunner owns them),
 *                                               manual rows → named exceptions (the principal owns them)
 *   bunker sync-cloud                           compile adopted apps' curl rows + security targets into the
 *                                               bunker-health Worker's manifest (PUT /manifest)
 *   bunker apps                                 the registry
 *
 * Registry (private): USER/CONFIG/bunker.json
 *   [{ "app": "aiharnesses", "type": "site", "url": "https://aiharnesses.ai",
 *      "isa": "~/Projects/aiharnesses/ISA.md", "protected": ["/admin"] }]
 *
 * Cloud: LIFEOS_BUNKER_URL + LIFEOS_BUNKER_TOKEN (the Worker's MANIFEST_TOKEN secret).
 */

import { spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { args, lifeosDir } from "../TOOLS/lib/Ledger";
import { parseTestStrategy, compileCurl, runProbe, type Probe } from "../CLOUDFLARE/shared/probes";

interface App { app: string; type: string; url: string; isa: string; protected?: string[] }

const expand = (p: string) => p.replace(/^~(?=\/)/, homedir());

export function loadApps(): App[] {
  try { return JSON.parse(readFileSync(join(lifeosDir(), "USER", "CONFIG", "bunker.json"), "utf-8")); }
  catch { return []; }
}

async function test(isaPath: string): Promise<boolean> {
  const rows = parseTestStrategy(readFileSync(isaPath, "utf-8"));
  if (!rows.length) { console.log(`${isaPath}: no ## Test Strategy rows`); return false; }
  let pass = 0, fail = 0, critical = false;
  const exceptions: string[] = [];
  for (const r of rows) {
    if (r.type === "eval") { exceptions.push(`${r.isc} eval → Skill("Evals") EvalRunner`); continue; }
    if (r.type === "manual") { exceptions.push(`${r.isc} manual → principal attests`); continue; }
    let ok = false, detail = "";
    if (r.type === "curl") {
      const p = compileCurl(r);
      if (p) { const res = await runProbe(p); ok = res.ok; detail = res.detail ?? `${res.status} ${res.ms}ms`; }
      else { detail = "uncompilable curl row"; }
    } else if (["bash", "bun-test", "bun-property", "screenshot"].includes(r.type)) {
      const cmd = r.type.startsWith("bun-") && !/^bun\b/.test(r.tool) ? `bun test ${r.tool}` : r.tool;
      const sh = spawnSync("bash", ["-c", cmd], { encoding: "utf-8", timeout: r.tier === "deep" ? 600_000 : 60_000 });
      ok = sh.status === 0;
      detail = ok ? "exit 0" : `exit ${sh.status}: ${(sh.stderr || sh.stdout || "").trim().split("\n").at(-1)?.slice(0, 120)}`;
    } else { exceptions.push(`${r.isc} unknown type ${r.type}`); continue; }
    ok ? pass++ : fail++;
    if (!ok && r.severity === "critical") critical = true;
    console.log(`${ok ? "✓" : "✗"} ${r.isc.padEnd(8)} ${r.type.padEnd(8)} ${r.check.slice(0, 60)}${ok ? "" : `  — ${detail}`}`);
  }
  for (const e of exceptions) console.log(`· ${e}`);
  console.log(`${pass}/${pass + fail} deterministic probes · ${exceptions.length} exception(s)${critical ? " · CRITICAL FAILING → app DOWN" : ""}`);
  return fail === 0;
}

async function syncCloud() {
  const base = process.env.LIFEOS_BUNKER_URL, tok = process.env.LIFEOS_BUNKER_TOKEN;
  if (!base || !tok) { console.error("set LIFEOS_BUNKER_URL and LIFEOS_BUNKER_TOKEN"); process.exit(2); }
  const apps = loadApps().map((a) => {
    const isa = expand(a.isa);
    const probes: Probe[] = existsSync(isa) ? parseTestStrategy(readFileSync(isa, "utf-8")).map(compileCurl).filter((p): p is Probe => !!p) : [];
    return { app: a.app, type: a.type, url: a.url, protected: a.protected ?? [], probes };
  });
  const r = await fetch(`${base.replace(/\/$/, "")}/manifest`, { method: "PUT", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify({ apps, compiledAt: new Date().toISOString() }) });
  console.log(r.ok ? `synced ${apps.length} app(s), ${apps.reduce((n, a) => n + a.probes.length, 0)} cloud probe(s)` : `sync failed: ${r.status} ${await r.text()}`);
  if (!r.ok) process.exit(1);
}

if (import.meta.main) {
  const { pos: [cmd], flags } = args();
  switch (cmd) {
    case "test": {
      const targets = flags.isa ? [flags.isa] : loadApps().filter((a) => !flags.app || a.app === flags.app).map((a) => expand(a.isa));
      if (!targets.length) { console.error("no ISA: pass --isa or register apps in USER/CONFIG/bunker.json"); process.exit(2); }
      let ok = true;
      for (const t of targets) { console.log(`── ${t}`); ok = (await test(t)) && ok; }
      process.exit(ok ? 0 : 1);
    }
    case "sync-cloud": await syncCloud(); break;
    case "apps": for (const a of loadApps()) console.log(`${a.app.padEnd(20)} ${a.type.padEnd(14)} ${a.url}`); break;
    default:
      console.error("usage: Bunker.ts test|sync-cloud|apps");
      process.exit(2);
  }
}
