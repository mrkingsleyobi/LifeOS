#!/usr/bin/env bun
/**
 * SESSIONS — bring back killed Claude / Codex / Pi sessions (`/rs`).
 *
 * The live-sessions registry is rebuilt from each harness's own transcripts —
 * the only ground truth that survives a crash, a closed terminal, or a reboot:
 *   claude  ~/.claude/projects/<slug>/<sessionId>.jsonl     (cwd on every line)
 *   codex   ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl     (session_meta: id, cwd)
 *   pi      ~/.pi/agent/sessions/<dir>/*.jsonl               (header: type=session, id, cwd)
 *
 * A session is LIVE when its transcript moved in the last 2 minutes or a process
 * of that harness is running in its cwd and it's the newest session there;
 * otherwise it is RESTORABLE (within --hours, default 48).
 *
 *   bun Sessions.ts list [--hours 48] [--all]
 *   bun Sessions.ts restore <n|id-prefix> [--print]     exec the resume command (or print it)
 *   bun Sessions.ts restore-all [--kitty]               every restorable session; kitty → one tab each
 *
 * Registry snapshot: MEMORY/STATE/live-sessions.json (rewritten by every list).
 */

import { closeSync, existsSync, fstatSync, openSync, readdirSync, readFileSync, readlinkSync, readSync, statSync, writeFileSync, mkdirSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { spawnSync } from "child_process";

export type Harness = "claude" | "codex" | "pi";
export interface Session { harness: Harness; id: string; cwd: string; file: string; mtime: number; title: string; live?: boolean }

const H = () => process.env.HOME || homedir();
const LIFEOS = () => { const v = process.env.LIFEOS_DIR; return v && !/^\$\{?HOME/.test(v) ? v : join(H(), ".claude", "LIFEOS"); };

function head(file: string, bytes = 64 * 1024): string {
  const fd = openSync(file, "r");
  try { const n = Math.min(bytes, fstatSync(fd).size); const b = Buffer.alloc(n); readSync(fd, b, 0, n, 0); return b.toString("utf-8"); }
  finally { closeSync(fd); }
}

const firstUserText = (lines: string[], pick: (j: any) => string | undefined): string => {
  for (const l of lines) { try { const t = pick(JSON.parse(l)); if (t && !t.startsWith("<")) return t.replace(/\s+/g, " ").slice(0, 70); } catch {} }
  return "";
};

function claudeSessions(since: number): Session[] {
  const root = join(H(), ".claude", "projects");
  const out: Session[] = [];
  for (const proj of existsSync(root) ? readdirSync(root) : []) {
    const dir = join(root, proj);
    let files: string[] = [];
    try { files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")); } catch { continue; }
    for (const f of files) {
      const p = join(dir, f), st = statSync(p);
      if (st.mtimeMs < since) continue;
      const lines = head(p).split("\n");
      let cwd = "";
      for (const l of lines) { try { const j = JSON.parse(l); if (j.cwd) { cwd = j.cwd; break; } } catch {} }
      const title = firstUserText(lines, (j) => j.type === "user" ? (typeof j.message?.content === "string" ? j.message.content : j.message?.content?.find?.((c: any) => c.type === "text")?.text) : undefined);
      out.push({ harness: "claude", id: basename(f, ".jsonl"), cwd, file: p, mtime: st.mtimeMs, title });
    }
  }
  return out;
}

function walkJsonl(root: string, since: number, depth = 4): string[] {
  const out: string[] = [];
  const walk = (d: string, n: number) => {
    let es: import("fs").Dirent[] = [];
    try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = join(d, e.name);
      if (e.isDirectory() && n > 0) walk(p, n - 1);
      else if (e.name.endsWith(".jsonl")) { try { if (statSync(p).mtimeMs >= since) out.push(p); } catch {} }
    }
  };
  walk(root, depth);
  return out;
}

function codexSessions(since: number): Session[] {
  return walkJsonl(join(process.env.CODEX_HOME ?? join(H(), ".codex"), "sessions"), since).flatMap((p) => {
    const lines = head(p).split("\n");
    try {
      const meta = JSON.parse(lines[0]);
      const m = meta.payload ?? meta;
      if (!m.id) return [];
      const title = firstUserText(lines, (j) => j.payload?.type === "user_message" ? j.payload.message : j.payload?.role === "user" ? j.payload.content?.[0]?.text : undefined);
      return [{ harness: "codex" as const, id: m.id, cwd: m.cwd ?? "", file: p, mtime: statSync(p).mtimeMs, title }];
    } catch { return []; }
  });
}

function piSessions(since: number): Session[] {
  return walkJsonl(join(H(), ".pi", "agent", "sessions"), since, 2).flatMap((p) => {
    const lines = head(p).split("\n");
    try {
      const h = JSON.parse(lines[0]);
      if (h.type !== "session") return [];
      const title = firstUserText(lines, (j) => j.type === "message" && j.message?.role === "user" ? (typeof j.message.content === "string" ? j.message.content : j.message.content?.[0]?.text) : undefined);
      return [{ harness: "pi" as const, id: h.id ?? basename(p, ".jsonl"), cwd: h.cwd ?? "", file: p, mtime: statSync(p).mtimeMs, title }];
    } catch { return []; }
  });
}

/** cwd of every running harness process (Linux /proc; macOS lsof). */
function runningCwds(): Record<Harness, Set<string>> {
  const res: Record<Harness, Set<string>> = { claude: new Set(), codex: new Set(), pi: new Set() };
  const classify = (cmd: string): Harness | null => /(^|\/)claude(\s|$)/.test(cmd) ? "claude" : /(^|\/)codex(\s|$)/.test(cmd) ? "codex" : /(^|\/)pi(\s|$)/.test(cmd) ? "pi" : null;
  if (existsSync("/proc/self/cwd")) {
    for (const pid of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
      try {
        const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf-8").split("\0").slice(0, 2).join(" ");
        const h = classify(cmd) ?? (cmd.includes("@anthropic-ai/claude-code") ? "claude" : null);
        if (h) res[h].add(readlinkSync(`/proc/${pid}/cwd`));
      } catch {}
    }
  } else {
    const ps = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf-8" }).stdout ?? "";
    for (const line of ps.split("\n")) {
      const m = line.trim().match(/^(\d+)\s+(.*)$/);
      const h = m && classify(m[2]);
      if (!m || !h) continue;
      const cwd = (spawnSync("lsof", ["-a", "-p", m[1], "-d", "cwd", "-Fn"], { encoding: "utf-8" }).stdout ?? "").split("\n").find((l) => l.startsWith("n"))?.slice(1);
      if (cwd) res[h].add(cwd);
    }
  }
  return res;
}

export function scan(hours = 48): Session[] {
  const since = Date.now() - hours * 3600_000;
  const all = [...claudeSessions(since), ...codexSessions(since), ...piSessions(since)].sort((a, b) => b.mtime - a.mtime);
  const running = runningCwds();
  const newestPerCwd = new Set<string>();
  for (const s of all) {
    const key = `${s.harness}|${s.cwd}`;
    const newest = !newestPerCwd.has(key);
    newestPerCwd.add(key);
    s.live = Date.now() - s.mtime < 120_000 || (newest && running[s.harness].has(s.cwd));
  }
  try {
    mkdirSync(join(LIFEOS(), "MEMORY", "STATE"), { recursive: true });
    writeFileSync(join(LIFEOS(), "MEMORY", "STATE", "live-sessions.json"), JSON.stringify({ at: new Date().toISOString(), sessions: all }, null, 2));
  } catch {}
  return all;
}

export function resumeArgv(s: Session): string[] {
  if (s.harness === "claude") return ["claude", "--resume", s.id];
  if (s.harness === "codex") return ["codex", "resume", s.id];
  return ["pi", "--session", s.file];
}

const ago = (ms: number) => { const m = Math.floor((Date.now() - ms) / 60000); return m < 60 ? `${m}m` : m < 2880 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`; };
const shq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const cmd = argv[0] ?? "list";
  const sessions = scan(Number(flag("--hours") ?? 48));
  const restorable = sessions.filter((s) => !s.live);
  const pick = (k: string) => (/^\d+$/.test(k) ? restorable[Number(k) - 1] : sessions.find((s) => s.id.startsWith(k)));
  switch (cmd) {
    case "list": {
      const shown = argv.includes("--all") ? sessions : restorable;
      shown.forEach((s, i) => console.log(`${String(i + 1).padStart(2)} ${s.live ? "LIVE " : "     "}${s.harness.padEnd(6)} ${ago(s.mtime).padStart(4)}  ${s.id.slice(0, 8)}  ${s.cwd.replace(H(), "~").padEnd(32).slice(0, 32)}  ${s.title}`));
      if (!shown.length) console.log("no restorable sessions in the window");
      break;
    }
    case "restore": {
      const s = argv[1] ? pick(argv[1]) : undefined;
      if (!s) { console.error("restore <n|id-prefix> — run `list` for numbers"); process.exit(2); }
      const a = resumeArgv(s);
      if (argv.includes("--print")) { console.log(`cd ${shq(s.cwd)} && ${a.map(shq).join(" ")}`); break; }
      const r = spawnSync(a[0], a.slice(1), { cwd: s.cwd || undefined, stdio: "inherit" });
      process.exit(r.status ?? 0);
    }
    case "restore-all": {
      for (const s of restorable) {
        const a = resumeArgv(s);
        if (argv.includes("--kitty")) spawnSync("kitty", ["@", "launch", "--type=tab", "--cwd", s.cwd, "--tab-title", `${s.harness}:${s.title.slice(0, 20)}`, ...a], { stdio: "inherit" });
        else console.log(`cd ${shq(s.cwd)} && ${a.map(shq).join(" ")}`);
      }
      if (!restorable.length) console.log("nothing to restore");
      break;
    }
    default:
      console.error("usage: Sessions.ts list|restore|restore-all");
      process.exit(2);
  }
}
