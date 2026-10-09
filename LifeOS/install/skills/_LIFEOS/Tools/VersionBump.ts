#!/usr/bin/env bun
/**
 * VersionBump — the Ledger's private tooling (DOCUMENTATION/Ledger/LedgerSystem.md),
 * rebuilt: ClassifyChange + UpdateLifeosVersion + Bump{Skill,SystemPrompt}Versions +
 * UpdateIndex + the `/vb` coordinator, in one CLI.
 *
 *   bun VersionBump.ts classify [--since v7.40.4]       patch | feature | major + why
 *   bun VersionBump.ts bump <patch|feature|major> [--yes]   umbrella + touched component lines
 *   bun VersionBump.ts index                             regenerate SYSTEMUPDATES index.json + CHANGELOG.md
 *   bun VersionBump.ts vb --title "four to eight words" [--level L] [--yes] [--commit] [--tag]
 *
 * Gates (LedgerSystem § scheme): MAJOR needs `--yes` after a human conversation;
 * FEATURE needs `--yes` (the one-line confirm); PATCH auto-applies with a notice.
 * Every version is exactly Major.Feature.Patch.
 *
 * Repo: the git repo containing LIFEOS_DIR (your private LifeOS repo).
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join, relative } from "path";
import { spawnSync } from "child_process";
import { homedir } from "os";

const LIFEOS = (() => { const v = process.env.LIFEOS_DIR; return v && !/^\$\{?HOME/.test(v) ? v : join(homedir(), ".claude", "LIFEOS"); })();
const git = (args: string[], cwd = LIFEOS) => spawnSync("git", args, { cwd, encoding: "utf-8" });
const repoRoot = () => git(["rev-parse", "--show-toplevel"]).stdout.trim();
const UPDATES = () => join(LIFEOS, "MEMORY", "SYSTEMUPDATES");

export type Level = "patch" | "feature" | "major";

export function bumpVersion(v: string, level: Level): string {
  const m = v.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`not Major.Feature.Patch: ${v}`);
  const [M, F, P] = m.slice(1).map(Number);
  return level === "major" ? `${M + 1}.0.0` : level === "feature" ? `${M}.${F + 1}.0` : `${M}.${F}.${P + 1}`;
}

function lastTag(): string | null {
  const r = git(["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*"]);
  return r.status === 0 ? r.stdout.trim() : null;
}

/** name-status since a tag (or HEAD~1), repo-relative, plus uncommitted changes. */
export function changes(since?: string | null): { status: string; path: string }[] {
  const base = since ?? lastTag();
  const out = new Map<string, string>();
  const parse = (txt: string) => { for (const l of txt.split("\n").filter(Boolean)) { const [s, ...p] = l.split("\t"); out.set(p.at(-1)!, s[0]); } };
  if (base) parse(git(["diff", "--name-status", `${base}...HEAD`]).stdout);
  parse(git(["diff", "--name-status", "HEAD"]).stdout);
  for (const f of git(["ls-files", "--others", "--exclude-standard"]).stdout.split("\n").filter(Boolean)) out.set(f, "A");
  return [...out].map(([path, status]) => ({ path, status }));
}

/** The classifier: deterministic rules, every verdict carries its reasons. */
export function classify(ch: { status: string; path: string }[]): { level: Level; reasons: string[] } {
  const reasons: string[] = [];
  const has = (re: RegExp, s?: string) => ch.filter((c) => re.test(c.path) && (!s || c.status === s));
  const removed = has(/(hooks\/[^/]+\.hook\.ts|LIFEOS\/TOOLS\/[^/]+\.ts|skills\/[^/]+\/SKILL\.md)$/, "D");
  // A schema change breaks readers only when an EXISTING schema moves; a new schema file is additive.
  const schema = has(/(ISA\/ISAFormat\.md|KnowledgeSchema\.ts|data-classification\.ts|LIFEOS\/ROUTER\/LaneQuestions\.ts)$/).filter((c) => c.status !== "A");
  if (removed.length) reasons.push(`removed contract(s): ${removed.map((c) => c.path).slice(0, 3).join(", ")}`);
  if (schema.length) reasons.push(`format/schema change: ${schema.map((c) => c.path).join(", ")}`);
  if (reasons.length) return { level: "major", reasons };
  const added = has(/(hooks\/[^/]+\.hook\.ts|skills\/[^/]+\/SKILL\.md|skills\/[^/]+\/Workflows\/[^/]+\.md|agents\/[^/]+\.md|commands\/[^/]+\.md|LIFEOS\/[A-Z]+\/[^/]+\.ts|workers\/[^/]+\/src\/index\.ts)$/, "A");
  if (added.length) return { level: "feature", reasons: [`${added.length} new capability file(s): ${added.map((c) => c.path).slice(0, 4).join(", ")}${added.length > 4 ? " …" : ""}`] };
  return { level: "patch", reasons: [`${ch.length} changed file(s), no new capability, no removed contract`] };
}

function setFrontmatterVersion(file: string, level: Level): string | null {
  const s = readFileSync(file, "utf-8");
  const m = s.match(/^(---\n[\s\S]*?^version:\s*)([\d.]+)([^\n]*\n[\s\S]*?\n---)/m);
  if (!m) return null;
  const next = bumpVersion(m[2], level);
  writeFileSync(file, s.replace(m[0], `${m[1]}${next}${m[3]}`));
  return next;
}

export function bump(level: Level, ch = changes()): { umbrella: string; components: string[] } {
  const vf = join(LIFEOS, "VERSION");
  const umbrella = bumpVersion(readFileSync(vf, "utf-8"), level);
  writeFileSync(vf, umbrella + "\n");
  const components: string[] = [];
  const root = repoRoot();
  // Each touched skill bumps its own line (patch, or feature when it gained a workflow).
  const touchedSkills = new Set(ch.map((c) => c.path.match(/skills\/([^/]+)\//)?.[1]).filter(Boolean) as string[]);
  for (const s of touchedSkills) {
    const f = [join(root, "LifeOS/install/skills", s, "SKILL.md"), join(LIFEOS, "..", "skills", s, "SKILL.md")].find(existsSync);
    if (!f) continue;
    const gained = ch.some((c) => c.status === "A" && c.path.includes(`skills/${s}/Workflows/`));
    const v = setFrontmatterVersion(f, gained ? "feature" : "patch");
    if (v) components.push(`skill ${s} → ${v}`);
  }
  if (ch.some((c) => c.path.endsWith("LIFEOS_SYSTEM_PROMPT.md"))) {
    const v = setFrontmatterVersion(join(LIFEOS, "LIFEOS_SYSTEM_PROMPT.md"), "patch");
    if (v) components.push(`system prompt → ${v}`);
  }
  return { umbrella, components };
}

/** Regenerate index.json + CHANGELOG.md from the per-change files (UpdateIndex). */
export function regenerateIndex(): number {
  const dir = UPDATES();
  const files: string[] = [];
  const walk = (d: string) => { for (const e of existsSync(d) ? readdirSync(d, { withFileTypes: true }) : []) { const p = join(d, e.name); if (e.isDirectory() && /^\d{2,4}$/.test(e.name)) walk(p); else if (e.name.endsWith(".md") && /^\d{4}/.test(e.name)) files.push(p); } };
  walk(dir);
  const field = (fm: string, k: string) => fm.match(new RegExp(`^${k}:\\s*"?([^"\\n]*)"?`, "m"))?.[1];
  const updates = files.map((f) => {
    const fm = readFileSync(f, "utf-8").match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
    const files_affected = [...fm.matchAll(/^\s+-\s+"?([^"\n]+)"?/gm)].map((m) => m[1]);
    return { id: field(fm, "id"), timestamp: field(fm, "timestamp"), title: field(fm, "title"), significance: field(fm, "significance"), change_type: field(fm, "change_type"), version: field(fm, "version"), files_affected, path: relative(dir, f) };
  }).sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  const count = (k: "significance" | "change_type") => updates.reduce((m, u) => ((m[String(u[k])] = (m[String(u[k])] ?? 0) + 1), m), {} as Record<string, number>);
  writeFileSync(join(dir, "index.json"), JSON.stringify({ last_updated: new Date().toISOString(), total_updates: updates.length, by_significance: count("significance"), by_change_type: count("change_type"), updates }, null, 2) + "\n");
  const byVersion = new Map<string, typeof updates>();
  for (const u of updates) byVersion.set(u.version ?? "unversioned", [...(byVersion.get(u.version ?? "unversioned") ?? []), u]);
  writeFileSync(join(dir, "CHANGELOG.md"), `# LifeOS Changelog\n\nGenerated from MEMORY/SYSTEMUPDATES by VersionBump.ts — do not edit by hand.\n\n${[...byVersion].map(([v, us]) => `## ${v}\n\n${us.map((u) => `- ${String(u.timestamp).slice(0, 10)} · **${u.title}** (${u.significance}, ${u.change_type})`).join("\n")}`).join("\n\n")}\n`);
  return updates.length;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const cmd = argv[0];
  switch (cmd) {
    case "classify": {
      const c = classify(changes(flag("--since")));
      console.log(`${c.level.toUpperCase()}\n${c.reasons.map((r) => `  · ${r}`).join("\n")}`);
      break;
    }
    case "bump": {
      const level = argv[1] as Level;
      if (!["patch", "feature", "major"].includes(level)) { console.error("bump <patch|feature|major>"); process.exit(2); }
      if (level !== "patch" && !argv.includes("--yes")) { console.error(`${level.toUpperCase()} needs --yes (${level === "major" ? "after a human conversation" : "one-line confirm"})`); process.exit(3); }
      const r = bump(level);
      console.log(`LIFEOS ${r.umbrella}${r.components.length ? `\n  ${r.components.join("\n  ")}` : ""}`);
      break;
    }
    case "index": console.log(`indexed ${regenerateIndex()} update(s)`); break;
    case "vb": {
      const title = flag("--title");
      if (!title) { console.error('vb --title "<4-8 word title>"'); process.exit(2); }
      const ch = changes();
      const c = classify(ch);
      const level = (flag("--level") as Level | undefined) ?? c.level;
      console.log(`classified ${c.level.toUpperCase()}${level !== c.level ? ` (overridden → ${level.toUpperCase()})` : ""}: ${c.reasons.join("; ")}`);
      if (level !== "patch" && !argv.includes("--yes")) { console.error(`${level.toUpperCase()} bump needs --yes`); process.exit(3); }
      const r = bump(level, ch);
      const sig = level === "major" ? "major" : level === "feature" ? "moderate" : "minor";
      const rec = spawnSync("bun", [join(LIFEOS, "TOOLS", "CreateUpdate.ts"), "--title", title, "--significance", sig, "--change-type", "multi_area", "--version", r.umbrella, "--files", ch.map((x) => x.path).slice(0, 40).join(",")], { encoding: "utf-8", env: { ...process.env, LIFEOS_DIR: LIFEOS } });
      if (rec.status !== 0) { console.error(rec.stderr || rec.stdout); process.exit(1); }
      const n = regenerateIndex();
      console.log(`LIFEOS ${r.umbrella} · ${r.components.length} component line(s) · registry ${n} update(s)`);
      if (argv.includes("--commit")) {
        const root = repoRoot();
        git(["add", "-A"], root);
        const cm = git(["commit", "-m", `release ${r.umbrella}: ${title}`], root);
        console.log(cm.status === 0 ? `committed release ${r.umbrella}` : (cm.stderr || cm.stdout).trim());
        if (argv.includes("--tag")) console.log(git(["tag", `v${r.umbrella}`], root).status === 0 ? `tagged v${r.umbrella}` : "tag failed");
      }
      break;
    }
    default:
      console.error("usage: VersionBump.ts classify|bump|index|vb");
      process.exit(2);
  }
}
