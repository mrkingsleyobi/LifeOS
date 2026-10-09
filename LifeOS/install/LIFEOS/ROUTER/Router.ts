#!/usr/bin/env bun
/**
 * ROUTER — who runs what, on which model, at what effort.
 *
 *   bun Router.ts lanes                         the lane table (model ids resolved live)
 *   bun Router.ts resolve "<prompt>" [--no-jev] [--json]
 *   bun Router.ts status [--session <id>]       last decision, session lane counts, quotas
 *   bun Router.ts audit                         ledger stats + wiring checks (agents, models)
 *   bun Router.ts run <lane> [--effort high] [--slug s] < prompt
 *                                               execute on a lane: OpenAI → ForgeProgress.ts
 *                                               (codex exec), Anthropic → claude -p,
 *                                               private → PrivateLane.ts (loopback only)
 */

import { existsSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { spawnSync } from "child_process";
import { LANES, modelForLane, type LaneId } from "./Lanes";
import { route, routerLine } from "./FrontDoor";
import { readSession, stateDir } from "./State";
import { readAnthropicQuota, readOpenAIQuota } from "./Quota";
import { readLedger } from "../DECISIONS/Decisions";
import { complete } from "./PrivateLane";

const HERE = dirname(import.meta.path);
const flag = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const [cmd, arg] = process.argv.slice(2);

switch (cmd ?? "status") {
  case "lanes": {
    console.log("LANE      VENDOR     TIER    INT SPD  $IN/$OUT     CEILING      AGENT     MODEL");
    for (const l of Object.values(LANES)) {
      console.log(`${l.label.padEnd(9)} ${l.vendor.padEnd(10)} ${l.tier.padEnd(7)} ${l.intelligence}   ${l.speed}   ${`${l.costIn}/${l.costOut}`.padEnd(12)} ${l.ceiling.padEnd(12)} ${(l.agent ?? "—").padEnd(9)} ${modelForLane(l.id)}`);
    }
    break;
  }
  case "resolve": {
    if (!arg) { console.error('resolve "<prompt>"'); process.exit(2); }
    const d = await route({ prompt: arg, prevTail: flag("--prev") }, { noJev: process.argv.includes("--no-jev") });
    if (!d) { console.log("skipped (slash command / system text / empty)"); break; }
    if (process.argv.includes("--json")) console.log(JSON.stringify(d, null, 2));
    else {
      console.log(routerLine(d));
      console.log(`  I=${d.intelligence.toFixed(2)} T=${d.tokens.toFixed(2)} class=${d.dataClass} model=${d.model} agent=${d.agent ?? "—"}`);
      for (const r of d.reasons) console.log(`  · ${r}`);
      console.log(`  chain: ${d.chain.map((c) => `${LANES[c.lane].label}${c.ok ? "✓" : `✗(${c.why})`}`).join(" → ")}`);
    }
    break;
  }
  case "status": {
    const sid = flag("--session");
    let last: any = null;
    try { last = JSON.parse(await Bun.file(join(stateDir(), "last.json")).text()); } catch {}
    if (last) console.log(`${routerLine(last)}  (${Math.round((Date.now() - last.at) / 1000)}s ago)`);
    else console.log("no decisions yet");
    if (sid) console.log("session lanes:", JSON.stringify(readSession(sid).lanes));
    const a = readAnthropicQuota(), o = readOpenAIQuota();
    console.log(`anthropic 5H ${a.fiveHour?.pct ?? "—"}% WK ${a.week?.pct ?? "—"}% FB ${a.fable?.pct ?? "—"}%   openai WK ${o.week?.pct ?? "—"}% 5H ${o.fiveHour?.pct ?? "—"}% ${o.plan ?? ""}`);
    break;
  }
  case "audit": {
    const rows = readLedger().filter((r) => r.caller === "dispatch-advisor");
    const by: Record<string, number> = {};
    let fb = 0, ms = 0;
    for (const r of rows) { by[r.pick ?? "?"] = (by[r.pick ?? "?"] ?? 0) + 1; if (r.source === "fallback") fb++; ms += r.latencyMs ?? 0; }
    console.log(`decisions: ${rows.length}  fallback: ${rows.length ? Math.round((100 * fb) / rows.length) : 0}%  avg: ${rows.length ? Math.round(ms / rows.length) : 0}ms`);
    console.log("lane mix:", Object.entries(by).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}=${v}`).join(" "));
    const agentsDir = join(homedir(), ".claude", "agents");
    const repoAgents = join(HERE, "..", "..", "agents");
    let bad = 0;
    for (const l of Object.values(LANES)) {
      if (!modelForLane(l.id)) { bad++; console.log(`MISSING MODEL ${l.id}`); }
      if (l.agent && !existsSync(join(agentsDir, `${l.agent}.md`)) && !existsSync(join(repoAgents, `${l.agent}.md`))) { bad++; console.log(`MISSING AGENT ${l.agent}.md (lane ${l.id})`); }
    }
    console.log(bad ? `${bad} wiring problem(s)` : "wiring OK — every lane has a model and an agent");
    process.exit(bad ? 1 : 0);
  }
  case "run": {
    const lane = arg as LaneId;
    if (!LANES[lane] || lane === "inline") { console.error(`run <lane> — one of ${Object.keys(LANES).filter((k) => k !== "inline").join(", ")}`); process.exit(2); }
    const prompt = (await new Response(Bun.stdin.stream()).text()).trim();
    if (!prompt) { console.error("prompt on stdin required"); process.exit(2); }
    const effort = flag("--effort") ?? "high";
    const l = LANES[lane];
    if (l.vendor === "local") { process.stdout.write((await complete(prompt)) + "\n"); break; }
    if (l.vendor === "openai") {
      const slug = flag("--slug") ?? `${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}_${lane}`;
      const r = spawnSync("bun", [join(HERE, "..", "TOOLS", "ForgeProgress.ts"), "--slug", slug, "--model", modelForLane(lane), "--reasoning-effort", effort, "--sandbox", flag("--sandbox") ?? "workspace-write"], { input: prompt, stdio: ["pipe", "inherit", "inherit"] });
      process.exit(r.status ?? 1);
    }
    if (l.vendor === "anthropic") {
      const r = spawnSync("claude", ["-p", "--model", modelForLane(lane), "--effort", effort], { input: prompt, stdio: ["pipe", "inherit", "inherit"] });
      process.exit(r.status ?? 1);
    }
    console.error(`${l.label} runs through its agent (${l.agent}) — dispatch Agent(subagent_type="${l.agent}")`);
    process.exit(2);
  }
  default:
    console.error("usage: Router.ts lanes|resolve|status|audit|run");
    process.exit(2);
}
