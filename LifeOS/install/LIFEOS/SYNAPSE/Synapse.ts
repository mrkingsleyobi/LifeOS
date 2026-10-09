#!/usr/bin/env bun
/**
 * SYNAPSE — the `amber` CLI. Capture → journal → grade → route → resurface.
 * Concept: LIFEOS/DOCUMENTATION/Synapse/SynapseSystem.md. Cloud journal:
 * LIFEOS/CLOUDFLARE/workers/amber-ledger. Shared grade shape: ./Grade.ts.
 *
 * Every capture is journaled LOCALLY first (MEMORY/SYNAPSE/amber.jsonl), before
 * anything else can fail — then mirrored to the cloud ledger when it's public.
 * `personal` captures never leave the box: graded on the private lane, routed locally.
 *
 *   amber capture <url|text> [--source cli] [--title …] [--kind article] [--personal]
 *   amber list [--status captured|graded|routed] [--limit 20]
 *   amber grade                      grade local-only rows (personal → private lane; offline public → Jev)
 *   amber route [--dry-run]          execute routed_actions for graded rows (cloud + local)
 *   amber flush                      push public rows captured while offline to the cloud ledger
 *   amber telos-push                 publish a TELOS summary the cloud grader scores against
 *   amber stats
 *
 * Route actions: knowledge_note → MEMORY/KNOWLEDGE/Ideas/<slug>.md (kb-v3, carries
 * `source_amber_id` — the join key Pulse /synapse reads; upstream #2245 was that
 * nothing wrote it) · upgrade → Upgrades store · work_issue:* → `gh issue create`
 * on LIFEOS_WORK_REPO (else queued) · reminder / blog_seed / telos_proposal → queues
 * under MEMORY/SYNAPSE/.
 *
 * Cloud: AMBER_LEDGER_URL + AMBER_TOKEN (or ~/.config/arbol/config.yaml auth_token).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { spawnSync } from "child_process";
import { Ledger, args, lifeosDir, type Row } from "../TOOLS/lib/Ledger";
import { ask } from "../DECISIONS/Jev";
import { complete as privateComplete } from "../ROUTER/PrivateLane";
import { addUpgrade } from "../TOOLS/Upgrades";
import { GRADE_VERSION, ROUTES, dedupKey, gradeQuestions, routedActions, scoreToPct, type Route } from "./Grade";

export interface Amber extends Row {
  amber_id: string;            // uuid; cloud id when mirrored, local uuid otherwise
  dedup_key: string;
  source: string;
  external_id: string;
  url?: string;
  content?: string;
  title?: string;
  content_kind: string;
  privacy_class: "public" | "personal";
  cloud: "mirrored" | "pending" | "never";
  status: "captured" | "graded" | "routed" | "grade_failed";
  score?: number;
  route?: Route;
  routed_actions?: string[];
  executed?: string[];
}

export const amber = new Ledger<Amber>(join("MEMORY", "SYNAPSE", "amber.jsonl"), "amb");

function cloud(): { base: string; token: string } | null {
  const base = process.env.AMBER_LEDGER_URL?.replace(/\/$/, "");
  let token = process.env.AMBER_TOKEN;
  if (!token) {
    try { token = readFileSync(join(homedir(), ".config", "arbol", "config.yaml"), "utf-8").match(/^\s*auth_token:\s*["']?([^"'\n]+)/m)?.[1]; } catch {}
  }
  return base && token ? { base, token } : null;
}

async function cloudReq(path: string, init: RequestInit = {}) {
  const c = cloud();
  if (!c) throw new Error("cloud ledger not configured (AMBER_LEDGER_URL + AMBER_TOKEN)");
  const r = await fetch(c.base + path, { ...init, headers: { authorization: `Bearer ${c.token}`, "content-type": "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`ledger ${path} ${r.status}: ${await r.text()}`);
  return r.json() as Promise<any>;
}

export async function capture(input: string, o: { source?: string; title?: string; kind?: string; personal?: boolean } = {}): Promise<Amber> {
  const isUrl = /^https?:\/\//.test(input.trim());
  const rec = { source: o.source ?? "cli", external_id: isUrl ? input.trim() : `cli-${Date.now()}`, url: isUrl ? input.trim() : undefined, content: isUrl ? undefined : input };
  const key = await dedupKey(rec);
  const dup = amber.all().find((a) => a.dedup_key === key);
  if (dup) return dup;
  const personal = !!o.personal;
  // 1. Write-ahead, locally, unconditionally.
  const row = amber.add({
    amber_id: crypto.randomUUID(), dedup_key: key, ...rec, title: o.title, content_kind: o.kind ?? (isUrl ? "article" : "note"),
    privacy_class: personal ? "personal" : "public", cloud: personal ? "never" : "pending", status: "captured",
  });
  // 2. Mirror public captures to the cloud ledger; its id becomes the amber id.
  if (!personal && cloud()) await mirror(row).catch(() => {});
  return amber.get(row.id)!;
}

async function mirror(row: Amber) {
  const r = await cloudReq("/capture", { method: "POST", body: JSON.stringify({ source: row.source, external_id: row.external_id, url: row.url, content: row.content, title: row.title, content_kind: row.content_kind, captured_at: row.ts, privacy_class: "public" }) });
  amber.update(row.id, { amber_id: r.id, cloud: "mirrored" });
}

function telosSummary(): string {
  const dir = join(lifeosDir(), "USER", "TELOS");
  return ["MISSION.md", "GOALS.md", "PROBLEMS.md", "STRATEGIES.md", "CHALLENGES.md"]
    .map((f) => { try { return `# ${f}\n${readFileSync(join(dir, f), "utf-8").replace(/^---[\s\S]*?---/, "").trim().slice(0, 1500)}`; } catch { return ""; } })
    .filter(Boolean).join("\n\n");
}

async function gradeLocal() {
  const todo = amber.all().filter((a) => a.status === "captured" && a.cloud !== "mirrored");
  const telos = telosSummary();
  for (const a of todo) {
    const text = `${a.title ?? ""}\n${a.content ?? a.url ?? ""}`.slice(0, 40_000);
    if (a.privacy_class === "personal") {
      // Personal: the private lane only. One-line JSON answer, parsed defensively.
      try {
        const out = await privateComplete(`Goals:\n${telos.slice(0, 4000)}\n\nItem:\n${text}\n\nReply with ONLY JSON: {"score": 0-4 usefulness for these goals, "route": one of ${ROUTES.join("|")}}`, { maxTokens: 60 });
        const j = JSON.parse(out.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
        const route = (ROUTES as readonly string[]).includes(j.route) ? (j.route as Route) : "none";
        const score = scoreToPct(Number(j.score) || 0);
        amber.update(a.id, { status: "graded", score, route, routed_actions: routedActions(route, score) });
        console.log(`${a.id} personal → ${route} (${score}) via private lane`);
      } catch (e: any) { console.log(`${a.id} personal → not graded (${e?.message ?? e}); stays captured`); }
      continue;
    }
    const r = await ask({ content: text }, gradeQuestions(telos), { timeoutMs: 15_000 });
    if (!r.ok) { console.log(`${a.id} → jev ${r.reason}; stays captured`); continue; }
    const score = scoreToPct(r.answers.relevance.score);
    const route = (ROUTES as readonly string[]).includes(r.answers.route.choice) ? (r.answers.route.choice as Route) : "none";
    amber.update(a.id, { status: "graded", score, route, routed_actions: routedActions(route, score), content_kind: r.answers.kind.choice });
    console.log(`${a.id} → ${route} (${score}) via Jev`);
  }
  if (!todo.length) console.log("nothing to grade locally");
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "idea";

export function writeIdeaNote(n: { amberId: string; title: string; url?: string | null; excerpt?: string | null; kind?: string; score?: number }): string {
  const dir = join(lifeosDir(), "MEMORY", "KNOWLEDGE", "Ideas");
  mkdirSync(dir, { recursive: true });
  let slug = slugify(n.title), path = join(dir, `${slug}.md`);
  for (let i = 2; existsSync(path); i++) path = join(dir, `${slug}-${i}.md`);
  const today = new Date().toISOString().slice(0, 10);
  const kind = ({ article: "blog", video: "video", paper: "paper", tweet: "tweet", note: "internal" } as Record<string, string>)[n.kind ?? ""] ?? "bookmark";
  writeFileSync(path, `---
id: idea-${n.amberId.slice(0, 8)}
type: idea
title: ${JSON.stringify(n.title)}
tags: [synapse]
status: inbox
quality: ${Math.max(1, Math.round((n.score ?? 50) / 20))}
quality_inferred: true
source_kind: ${kind}
${n.url ? `source_url: ${JSON.stringify(n.url)}\n` : ""}source_amber_id: ${n.amberId}
created: ${today}
updated: ${today}
convention: kb-v3
---

${n.excerpt ? `> ${n.excerpt.replace(/\n/g, " ")}\n` : ""}
_Promoted from the amber ledger by \`amber route\` (score ${n.score ?? "—"}). Add the idea in your own words._
`);
  return path;
}

function queue(name: string, row: object) {
  const p = join(lifeosDir(), "MEMORY", "SYNAPSE", `${name}.jsonl`);
  mkdirSync(join(p, ".."), { recursive: true });
  appendFileSync(p, JSON.stringify({ ts: new Date().toISOString(), ...row }) + "\n");
}

function execute(action: string, c: { amberId: string; title: string; url?: string | null; excerpt?: string | null; kind?: string; score?: number }, dry: boolean): string | null {
  if (dry) { console.log(`  would ${action}: ${c.title}`); return null; }
  if (action === "knowledge_note") return `knowledge_note:${writeIdeaNote(c).split("/").slice(-2).join("/")}`;
  if (action === "upgrade") { const u = addUpgrade({ claim: c.title, source: "autonomous", evidence: [c.amberId, c.url ?? ""].filter(Boolean) }); return `upgrade:${u.id}`; }
  if (action.startsWith("work_issue:")) {
    const type = action.split(":")[1];
    const repo = process.env.LIFEOS_WORK_REPO;
    if (repo) {
      const r = spawnSync("gh", ["issue", "create", "-R", repo, "--title", c.title.slice(0, 120), "--label", `Type:${type}`, "--body", `${c.url ?? ""}\n\n${c.excerpt ?? ""}\n\nsource_amber_id: ${c.amberId}`], { encoding: "utf-8" });
      if (r.status === 0) return `work_issue:${r.stdout.trim()}`;
    }
    queue("work-queue", { type, ...c });
    return `work_issue:queued`;
  }
  queue(action.replace(/[^a-z_]/g, ""), c);
  return `${action}:queued`;
}

async function route(dry: boolean) {
  let n = 0;
  // Cloud rows the edge grader has graded.
  if (cloud()) {
    const { captures } = await cloudReq("/captures?status=graded&limit=100");
    for (const c of captures as any[]) {
      const actions: string[] = c.routed_actions ? JSON.parse(c.routed_actions) : [];
      const done = actions.map((a) => execute(a, { amberId: c.id, title: c.title ?? c.url ?? c.excerpt?.slice(0, 80) ?? "untitled", url: c.url, excerpt: c.excerpt, kind: c.content_kind, score: c.score }, dry)).filter(Boolean) as string[];
      if (!dry) {
        await cloudReq(`/routed/${c.id}`, { method: "POST", body: JSON.stringify({ actions: done.length ? done : actions }) });
        const local = amber.all().find((x) => x.amber_id === c.id);
        if (local) amber.update(local.id, { status: "routed", score: c.score, route: c.route, routed_actions: actions, executed: done });
      }
      n++;
    }
  }
  // Local rows (personal + offline-graded).
  for (const a of amber.all().filter((x) => x.status === "graded" && x.cloud !== "mirrored")) {
    const done = (a.routed_actions ?? []).map((act) => execute(act, { amberId: a.amber_id, title: a.title ?? a.url ?? (a.content ?? "").slice(0, 80), url: a.url, excerpt: (a.content ?? "").slice(0, 280), kind: a.content_kind, score: a.score }, dry)).filter(Boolean) as string[];
    if (!dry) amber.update(a.id, { status: "routed", executed: done });
    n++;
  }
  console.log(`${dry ? "would route" : "routed"} ${n} capture(s)`);
}

if (import.meta.main) {
  const { pos: [cmd, a1], flags } = args();
  switch (cmd) {
    case "capture": {
      if (!a1) { console.error("capture <url|text>"); process.exit(2); }
      const r = await capture(a1, { source: flags.source, title: flags.title, kind: flags.kind, personal: flags.personal === "true" });
      console.log(`${r.amber_id} ${r.privacy_class} ${r.cloud}`);
      break;
    }
    case "list":
      for (const a of amber.all().filter((a) => !flags.status || a.status === flags.status).slice(-Number(flags.limit ?? 20)))
        console.log(`${a.amber_id.slice(0, 8)} ${a.status.padEnd(9)} ${a.privacy_class.padEnd(8)} ${String(a.score ?? "—").padStart(3)} ${(a.route ?? "").padEnd(18)} ${(a.title ?? a.url ?? a.content ?? "").slice(0, 70)}`);
      break;
    case "grade": await gradeLocal(); break;
    case "route": await route(flags["dry-run"] === "true"); break;
    case "flush": {
      const pending = amber.all().filter((a) => a.cloud === "pending");
      for (const a of pending) await mirror(a);
      console.log(`mirrored ${pending.length}`);
      break;
    }
    case "telos-push": {
      const c = cloud();
      if (!c) { console.error("cloud ledger not configured"); process.exit(2); }
      const r = await fetch(`${c.base}/telos`, { method: "PUT", headers: { authorization: `Bearer ${c.token}` }, body: telosSummary() });
      console.log(r.ok ? "TELOS summary published" : `failed ${r.status}`);
      break;
    }
    case "stats": {
      const all = amber.all();
      const by = (k: keyof Amber) => Object.entries(all.reduce((m, a) => ((m[String(a[k])] = (m[String(a[k])] ?? 0) + 1), m), {} as Record<string, number>)).map(([x, y]) => `${x}=${y}`).join(" ");
      console.log(`local ${all.length} · status ${by("status")} · privacy ${by("privacy_class")} · cloud ${by("cloud")}`);
      if (cloud()) console.log("cloud", JSON.stringify(await cloudReq("/stats")));
      break;
    }
    default:
      console.error("usage: amber capture|list|grade|route|flush|telos-push|stats");
      process.exit(2);
  }
}
