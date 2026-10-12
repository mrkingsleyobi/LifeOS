#!/usr/bin/env bun
// Normalize env path vars Claude Code may inject unexpanded (#1404).
for (const __k of ["LIFEOS_DIR", "LIFEOS_CONFIG_DIR", "PROJECTS_DIR"]) {
  const __v = process.env[__k];
  if (__v && /^\$\{?HOME\}?(\/|$)/.test(__v)) process.env[__k] = __v.replace(/^\$\{?HOME\}?/, process.env.HOME ?? "~");
}

/**
 * @version 1.0.0
 * TRIGGER: SessionEnd (separate block, timeout 60)
 *
 * WorkSync — mirror this session's work state into GitHub Issues. The generic
 * rebuild of the maintainer's private ULWorkSync.hook.ts (HookSystem.md:123),
 * with the repo taken from config instead of hardcoded.
 *
 *   LIFEOS_WORK_REPO=owner/repo   (unset → the hook does nothing)
 *
 * One issue per ISA slug, found by a hidden marker `<!-- lifeos-work:<slug> -->`.
 * First sync creates it (label Type:session); later syncs comment the phase +
 * progress delta; `phase: complete` closes it. Uses the `gh` CLI. Fails open.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

const LIFEOS = process.env.LIFEOS_DIR || join(homedir(), ".claude", "LIFEOS");
const REPO = process.env.LIFEOS_WORK_REPO;

interface Row { task?: string; sessionUUID?: string; phase?: string; progress?: string; isa?: string; updatedAt?: string }

function gh(args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("gh", args, { encoding: "utf-8", timeout: 20_000 });
  return { ok: r.status === 0, out: (r.stdout || "").trim() };
}

export function rowsFor(work: any, sessionId: string): [string, Row][] {
  const s = work?.sessions ?? {};
  const entries: [string, Row][] = Array.isArray(s) ? s.map((r: any) => [r.slug ?? r.sessionUUID ?? "", r]) : Object.entries(s);
  return entries.filter(([, r]) => r?.sessionUUID === sessionId && r.task);
}

export function body(slug: string, r: Row): string {
  return `<!-- lifeos-work:${slug} -->\n**${r.task}**\n\n- phase: \`${r.phase ?? "?"}\`\n- progress: \`${r.progress ?? "?"}\`\n${r.isa ? `- ISA: \`${r.isa.replace(homedir(), "~")}\`\n` : ""}- session: \`${r.sessionUUID}\``;
}

async function main() {
  if (!REPO) return;
  const raw = await new Response(Bun.stdin.stream()).text();
  const sid = (() => { try { return JSON.parse(raw).session_id as string; } catch { return ""; } })();
  if (!sid) return;
  const wf = join(LIFEOS, "MEMORY", "STATE", "work.json");
  if (!existsSync(wf)) return;
  for (const [slug, r] of rowsFor(JSON.parse(readFileSync(wf, "utf-8")), sid)) {
    const found = gh(["issue", "list", "-R", REPO, "--state", "all", "--search", `"lifeos-work:${slug}" in:body`, "--json", "number,state", "--limit", "1"]);
    const issue = found.ok ? (JSON.parse(found.out || "[]")[0] as { number: number; state: string } | undefined) : undefined;
    const done = /^complete/i.test(r.phase ?? "");
    if (!issue) {
      gh(["issue", "create", "-R", REPO, "--title", r.task!.slice(0, 120), "--label", "Type:session", "--body", body(slug, r)]);
    } else {
      gh(["issue", "comment", String(issue.number), "-R", REPO, "--body", `Session update — phase \`${r.phase}\`, progress \`${r.progress}\``]);
      if (done && issue.state === "OPEN") gh(["issue", "close", String(issue.number), "-R", REPO, "--reason", "completed"]);
    }
  }
}

if (import.meta.main) {
  main().catch((e) => console.error(`[WorkSync] ${e?.message ?? e}`)).finally(() => process.exit(0));
}
