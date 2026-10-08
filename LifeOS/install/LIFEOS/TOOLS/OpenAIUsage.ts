#!/usr/bin/env bun
/**
 * OpenAIUsage — OpenAI/Codex rate-limit windows for the statusline's OAI bar.
 *
 * Ground truth is the codex CLI's own rollout logs
 * (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl). Every token_count event carries
 * `rate_limits.{primary,secondary}` = {used_percent, window_minutes, resets_at}.
 * The newest event across the newest rollouts is the live account state. No network,
 * no credentials, no model call — same read-only posture as ModelMix.ts.
 *
 * Output (default): shell `key=value` lines the statusline `eval`s.
 *   oai_present=true|false   oai_wk_pct=<int>   oai_wk_reset=<epoch s>
 *   oai_5h_pct=<int>         oai_5h_reset=<epoch s>
 * `--json` prints the same fields as JSON.
 *
 * NOTE (verified 2026-10-08): only ChatGPT-login Codex sessions carry plan rate limits. Sessions authenticated with an API key
 * log `rate_limits: null`, so this tool reports `oai_present=false` for them and the OAI WK bar stays hidden; it appears
 * under a ChatGPT (e.g. Max) login. The primary/secondary shape below follows the format and has not been seen live with real limits.
 *
 * A window whose reset time has already passed reads 0% — the logged number is
 * pre-reset data (same clamp the Anthropic scoped bar applies).
 */

import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
const sessionsDir = () => process.env.CODEX_SESSIONS_DIR || join(HOME, ".codex", "sessions");

const TAIL_BYTES = 256 * 1024;
const MAX_ROLLOUTS = 12;
const WEEK_MIN = 7 * 24 * 60;

export interface Window { pct: number; resetsAt: number; windowMinutes: number }
export interface OpenAIUsage { present: boolean; fiveHour: Window | null; weekly: Window | null }

const sortedDesc = (dir: string) => readdirSync(dir).sort().reverse();
/** A stray file (.DS_Store) where a directory is expected must not abort the whole scan. */
const safeDesc = (dir: string) => { try { return sortedDesc(dir); } catch { return []; } };

/** Newest-first rollout paths, by the YYYY/MM/DD directory layout then filename. */
function newestRollouts(root: string, limit: number): string[] {
  const out: string[] = [];
  for (const y of sortedDesc(root)) {
    if (!/^\d{4}$/.test(y)) continue;
    for (const m of safeDesc(join(root, y))) {
      for (const d of safeDesc(join(root, y, m))) {
        const dir = join(root, y, m, d);
        for (const f of safeDesc(dir)) {
          if (/^rollout-.*\.jsonl$/.test(f)) out.push(join(dir, f));
          if (out.length >= limit) return out;
        }
      }
    }
  }
  return out;
}

function tailText(path: string): string {
  const size = statSync(path).size;
  const offset = Math.max(0, size - TAIL_BYTES);
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(size - offset);
    const n = readSync(fd, buf, 0, buf.length, offset);
    return buf.subarray(0, n).toString("utf-8");
  } finally { closeSync(fd); }
}

function toWindow(w: any, now: number): Window | null {
  if (!w || typeof w !== "object") return null;
  const pct = Number(w.used_percent ?? w.used_percentage);
  if (!Number.isFinite(pct)) return null;
  const resetsAt = Number(w.resets_at ?? 0) || 0;
  const expired = resetsAt > 0 && resetsAt <= now;
  return {
    pct: expired ? 0 : Math.max(0, Math.min(100, Math.round(pct))),
    resetsAt,
    windowMinutes: Number(w.window_minutes ?? 0) || 0,
  };
}

export function readOpenAIUsage(now = Math.floor(Date.now() / 1000)): OpenAIUsage {
  const none: OpenAIUsage = { present: false, fiveHour: null, weekly: null };
  const root = sessionsDir();
  if (!existsSync(root)) return none;
  let rollouts: string[];
  try { rollouts = newestRollouts(root, MAX_ROLLOUTS); } catch { return none; }

  for (const p of rollouts) {
    let lines: string[];
    try { lines = tailText(p).split("\n"); } catch { continue; }
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"rate_limits"')) continue;
      let rl: any;
      try { rl = JSON.parse(lines[i])?.payload?.rate_limits; } catch { continue; } // clipped tail line
      if (!rl) continue;
      const wins = [toWindow(rl.primary, now), toWindow(rl.secondary, now)].filter(Boolean) as Window[];
      if (!wins.length) continue;
      // Identify by window length, not slot: a plan with a single window reports it as primary.
      const weekly = wins.find(w => w.windowMinutes >= WEEK_MIN) ?? null;
      const fiveHour = wins.find(w => w.windowMinutes > 0 && w.windowMinutes < WEEK_MIN) ?? null;
      return { present: !!(weekly || fiveHour), fiveHour, weekly };
    }
  }
  return none;
}

if (import.meta.main) {
  const u = readOpenAIUsage();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(u));
  } else {
    console.log(`oai_present=${u.present}`);
    console.log(`oai_wk_pct=${u.weekly?.pct ?? 0}`);
    console.log(`oai_wk_reset=${u.weekly?.resetsAt ?? 0}`);
    console.log(`oai_5h_pct=${u.fiveHour?.pct ?? 0}`);
    console.log(`oai_5h_reset=${u.fiveHour?.resetsAt ?? 0}`);
  }
}
