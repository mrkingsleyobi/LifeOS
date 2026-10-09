#!/usr/bin/env bun
/**
 * CODEX FRONT DOOR — open the same LifeOS install from Codex CLI.
 *
 *   bun Mount.ts [mount]   write the managed LifeOS block into $CODEX_HOME/AGENTS.md,
 *                          symlink skills (→ $CODEX_HOME/skills) and commands
 *                          (→ $CODEX_HOME/prompts), install the hook bridge in
 *                          $CODEX_HOME/hooks.json, enable [features] codex_hooks
 *   bun Mount.ts status
 *   bun Mount.ts unmount   remove only what mount created (managed block, our
 *                          symlinks, our hooks.json entries)
 *
 * Symlink mirror, not a copy: one install, edited in one place. Codex trusts
 * hooks per config.toml; if Codex reports the hooks as untrusted, approve them
 * once in Codex (`/hooks`), mount never edits trust entries.
 *
 * NOTE: LIFEOS/TOOLS/CrossVendorAudit.ts deliberately runs codex with an
 * ISOLATED CODEX_HOME so the cross-vendor auditor does NOT load this persona.
 * Mounting here does not change that.
 */

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync, appendFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { doorContext, removeManaged, writeManaged } from "../TOOLS/lib/DoorContext";

const CODEX = process.env.CODEX_HOME ?? join(homedir(), ".codex");
const CLAUDE = process.env.LIFEOS_CLAUDE_DIR ?? join(homedir(), ".claude");
const BRIDGE = join(CLAUDE, "LIFEOS", "CODEX", "Bridge.ts");
const EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"] as const;
const TAG = "LIFEOS_BRIDGE";

function linkAll(srcDir: string, dstDir: string, filter: (name: string) => boolean): number {
  if (!existsSync(srcDir)) return 0;
  mkdirSync(dstDir, { recursive: true });
  let n = 0;
  for (const name of readdirSync(srcDir)) {
    if (!filter(name)) continue;
    const dst = join(dstDir, name);
    if (existsSync(dst) || isLink(dst)) {
      if (isLink(dst) && readlinkSync(dst).startsWith(CLAUDE)) rmSync(dst); else continue; // never clobber the principal's own files
    }
    symlinkSync(join(srcDir, name), dst);
    n++;
  }
  return n;
}
const isLink = (p: string) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };

function unlinkOurs(dir: string): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (isLink(p) && readlinkSync(p).startsWith(CLAUDE)) { rmSync(p); n++; }
  }
  return n;
}

function hooksFile(): { hooks: Record<string, any[]> } {
  try { return JSON.parse(readFileSync(join(CODEX, "hooks.json"), "utf-8")); } catch { return { hooks: {} }; }
}

function installHooks() {
  const f = hooksFile();
  f.hooks ??= {};
  for (const ev of EVENTS) {
    const groups = (f.hooks[ev] ?? []).filter((g: any) => !JSON.stringify(g).includes(TAG));
    groups.push({ hooks: [{ type: "command", command: `${TAG}=1 bun ${BRIDGE} ${ev}`, timeout: ev === "UserPromptSubmit" ? 8 : 15, statusMessage: "LifeOS" }] });
    f.hooks[ev] = groups;
  }
  writeFileSync(join(CODEX, "hooks.json"), JSON.stringify(f, null, 2) + "\n");
}

function removeHooks() {
  const f = hooksFile();
  for (const ev of Object.keys(f.hooks ?? {})) {
    f.hooks[ev] = f.hooks[ev].filter((g: any) => !JSON.stringify(g).includes(TAG));
    if (!f.hooks[ev].length) delete f.hooks[ev];
  }
  writeFileSync(join(CODEX, "hooks.json"), JSON.stringify(f, null, 2) + "\n");
}

function enableHooksFeature() {
  const p = join(CODEX, "config.toml");
  const cur = existsSync(p) ? readFileSync(p, "utf-8") : "";
  if (/codex_hooks\s*=\s*true/.test(cur)) return false;
  if (/^\[features\]/m.test(cur)) writeFileSync(p, cur.replace(/^\[features\]\s*$/m, "[features]\ncodex_hooks = true  # LifeOS front door"));
  else appendFileSync(p, `${cur && !cur.endsWith("\n") ? "\n" : ""}\n[features]\ncodex_hooks = true  # LifeOS front door\n`);
  return true;
}

if (import.meta.main) {
  const cmd = process.argv[2] ?? "mount";
  mkdirSync(CODEX, { recursive: true });
  if (cmd === "mount") {
    writeManaged(join(CODEX, "AGENTS.md"), doorContext("codex"));
    const skills = linkAll(join(CLAUDE, "skills"), join(CODEX, "skills"), (n) => existsSync(join(CLAUDE, "skills", n, "SKILL.md")));
    const prompts = linkAll(join(CLAUDE, "commands"), join(CODEX, "prompts"), (n) => n.endsWith(".md"));
    installHooks();
    const feat = enableHooksFeature();
    console.log(`Codex front door mounted at ${CODEX}: AGENTS.md block, ${skills} skill link(s), ${prompts} prompt link(s), hook bridge on ${EVENTS.length} events${feat ? ", codex_hooks enabled" : ""}`);
  } else if (cmd === "unmount") {
    removeManaged(join(CODEX, "AGENTS.md"));
    const n = unlinkOurs(join(CODEX, "skills")) + unlinkOurs(join(CODEX, "prompts"));
    removeHooks();
    console.log(`unmounted: ${n} link(s) removed, bridge hooks removed, AGENTS.md block removed`);
  } else if (cmd === "status") {
    const agents = existsSync(join(CODEX, "AGENTS.md")) && readFileSync(join(CODEX, "AGENTS.md"), "utf-8").includes("LIFEOS:BEGIN");
    const count = (d: string) => (existsSync(d) ? readdirSync(d).filter((n) => isLink(join(d, n)) && readlinkSync(join(d, n)).startsWith(CLAUDE)).length : 0);
    const hooks = EVENTS.filter((ev) => JSON.stringify(hooksFile().hooks?.[ev] ?? []).includes(TAG));
    console.log(JSON.stringify({ codexHome: CODEX, agentsBlock: agents, skillLinks: count(join(CODEX, "skills")), promptLinks: count(join(CODEX, "prompts")), bridgedEvents: hooks }, null, 2));
  } else {
    console.error("usage: Mount.ts [mount|status|unmount]");
    process.exit(2);
  }
}
