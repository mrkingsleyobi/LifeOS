#!/usr/bin/env bun
/**
 * InstallSubsystemJobs — scheduled jobs for the rebuilt subsystems, one installer
 * for all of them (launchd on macOS, systemd --user service+timer on Linux).
 *
 *   bun InstallSubsystemJobs.ts --list
 *   bun InstallSubsystemJobs.ts --only people,socrates [--dry-run]
 *   bun InstallSubsystemJobs.ts --all
 *   bun InstallSubsystemJobs.ts --uninstall --only people
 *
 * Every job is a plain CLI call that is safe to run twice. Logs land in
 * MEMORY/STATE/<label>.log. Services.ts lists each one (category + purpose).
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { spawnSync } from "child_process";

const HOME = homedir();
const L = join(HOME, ".claude", "LIFEOS");
const BUN = (() => { const r = spawnSync("bash", ["-lc", "command -v bun"], { encoding: "utf-8" }); return r.stdout.trim() || join(HOME, ".bun", "bin", "bun"); })();

export interface Job {
  key: string;
  label: string;
  title: string;
  purpose: string;
  argv: string[];                       // run with bun
  every?: number;                       // seconds (interval jobs)
  daily?: { hour: number; minute: number };
  keepAlive?: boolean;                  // long-running service
}

export const JOBS: Job[] = [
  { key: "people", label: "com.lifeos.people", title: "People tick", purpose: "Hourly: stale-relationship nudges from the People store.", argv: [join(L, "PEOPLE/People.ts"), "tick"], every: 3600 },
  { key: "socrates", label: "com.lifeos.socrates", title: "Socrates", purpose: "Hourly: answer every due standing question (Jev or private lane), route hits to Achilles/Upgrades.", argv: [join(L, "SOCRATES/Socrates.ts"), "run"], every: 3600 },
  { key: "achilles-due", label: "com.lifeos.achilles-due", title: "Achilles SLA ping", purpose: "Daily 08:10: findings at or past their remediation SLA.", argv: [join(L, "ACHILLES/Achilles.ts"), "due"], daily: { hour: 8, minute: 10 } },
  { key: "achilles-kev", label: "com.lifeos.achilles-kev", title: "Achilles KEV sync", purpose: "Daily 06:40: CISA Known Exploited Vulnerabilities ∩ your inventory → findings.", argv: [join(L, "ACHILLES/Achilles.ts"), "kev"], daily: { hour: 6, minute: 40 } },
  { key: "errata-enrich", label: "com.lifeos.errata-enrich", title: "Errata enrich", purpose: "Daily 05:20: pull app reports, enrich open errata on the Luna lane.", argv: [join(L, "ERRATA/Errata.ts"), "enrich"], daily: { hour: 5, minute: 20 } },
  { key: "amberroute", label: "com.lifeos.amberroute", title: "Synapse router", purpose: "Every 30 min: grade local captures, execute routed_actions (knowledge notes, upgrades, work issues).", argv: [join(L, "SYNAPSE/Synapse.ts"), "route"], every: 1800 },
  { key: "lockbox-relay", label: "com.lifeos.lockbox-relay", title: "Lockbox relay", purpose: "Keep-alive loopback relay that answers Lockbox da.ask / act over the Cloudflare Tunnel.", argv: [join(L, "LOCKBOX/Relay.ts"), "serve"], keepAlive: true },
  { key: "bunker-test", label: "com.lifeos.bunker-test", title: "Bunker deep test", purpose: "Nightly 02:30: every registered app's full ISA Test Strategy, deep rows included.", argv: [join(L, "BUNKER/Bunker.ts"), "test"], daily: { hour: 2, minute: 30 } },
];

export function plist(j: Job): string {
  const sched = j.keepAlive ? "<key>KeepAlive</key><true/>"
    : j.every ? `<key>StartInterval</key><integer>${j.every}</integer>`
    : `<key>StartCalendarInterval</key><dict><key>Hour</key><integer>${j.daily!.hour}</integer><key>Minute</key><integer>${j.daily!.minute}</integer></dict>`;
  const log = join(L, "MEMORY", "STATE", `${j.label}.log`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${j.label}</string>
  <key>ProgramArguments</key><array><string>${BUN}</string>${j.argv.map((a) => `<string>${a}</string>`).join("")}</array>
  ${sched}
  <key>RunAtLoad</key>${j.keepAlive ? "<true/>" : "<false/>"}
  <key>ThrottleInterval</key><integer>60</integer>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${join(HOME, ".bun/bin")}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict></plist>
`;
}

export function systemdUnits(j: Job): { service: string; timer: string | null } {
  const log = join(L, "MEMORY", "STATE", `${j.label}.log`);
  const service = `[Unit]\nDescription=LifeOS ${j.title}\n\n[Service]\n${j.keepAlive ? "Type=simple\nRestart=always\nRestartSec=10" : "Type=oneshot"}\nExecStart=${BUN} ${j.argv.join(" ")}\nStandardOutput=append:${log}\nStandardError=append:${log}\n${j.keepAlive ? "\n[Install]\nWantedBy=default.target\n" : ""}`;
  const timer = j.keepAlive ? null
    : `[Unit]\nDescription=LifeOS ${j.title} timer\n\n[Timer]\n${j.every ? `OnBootSec=120\nOnUnitActiveSec=${j.every}` : `OnCalendar=*-*-* ${String(j.daily!.hour).padStart(2, "0")}:${String(j.daily!.minute).padStart(2, "0")}:00`}\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n`;
  return { service, timer };
}

function install(j: Job, dry: boolean) {
  mkdirSync(join(L, "MEMORY", "STATE"), { recursive: true });
  if (process.platform === "darwin") {
    const p = join(HOME, "Library", "LaunchAgents", `${j.label}.plist`);
    if (dry) return console.log(`# ${p}\n${plist(j)}`);
    mkdirSync(join(HOME, "Library", "LaunchAgents"), { recursive: true });
    spawnSync("launchctl", ["bootout", `gui/${process.getuid?.()}`, p]);
    writeFileSync(p, plist(j));
    const r = spawnSync("launchctl", ["bootstrap", `gui/${process.getuid?.()}`, p], { encoding: "utf-8" });
    console.log(`${j.label}: ${r.status === 0 ? "loaded" : `launchctl: ${r.stderr.trim()}`}`);
  } else {
    const dir = join(HOME, ".config", "systemd", "user");
    const u = systemdUnits(j);
    if (dry) return console.log(`# ${j.label}.service\n${u.service}${u.timer ? `\n# ${j.label}.timer\n${u.timer}` : ""}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${j.label}.service`), u.service);
    if (u.timer) writeFileSync(join(dir, `${j.label}.timer`), u.timer);
    spawnSync("systemctl", ["--user", "daemon-reload"]);
    const r = spawnSync("systemctl", ["--user", "enable", "--now", u.timer ? `${j.label}.timer` : `${j.label}.service`], { encoding: "utf-8" });
    console.log(`${j.label}: ${r.status === 0 ? "enabled" : `systemctl: ${(r.stderr || "").trim()}`}`);
  }
}

function uninstall(j: Job) {
  if (process.platform === "darwin") {
    const p = join(HOME, "Library", "LaunchAgents", `${j.label}.plist`);
    spawnSync("launchctl", ["bootout", `gui/${process.getuid?.()}`, p]);
    if (existsSync(p)) rmSync(p);
  } else {
    const dir = join(HOME, ".config", "systemd", "user");
    spawnSync("systemctl", ["--user", "disable", "--now", `${j.label}.timer`, `${j.label}.service`]);
    for (const ext of ["service", "timer"]) { const f = join(dir, `${j.label}.${ext}`); if (existsSync(f)) rmSync(f); }
    spawnSync("systemctl", ["--user", "daemon-reload"]);
  }
  console.log(`${j.label}: removed`);
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1].split(",") : null;
  const pick = JOBS.filter((j) => argv.includes("--all") || (only?.includes(j.key) ?? false));
  if (argv.includes("--list") || (!pick.length && !argv.includes("--all"))) {
    for (const j of JOBS) console.log(`${j.key.padEnd(14)} ${j.label.padEnd(28)} ${j.purpose}`);
    if (!argv.includes("--list")) console.log("\npass --only a,b or --all");
  } else for (const j of pick) argv.includes("--uninstall") ? uninstall(j) : install(j, argv.includes("--dry-run"));
}
