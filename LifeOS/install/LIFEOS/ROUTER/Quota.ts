#!/usr/bin/env bun
/**
 * QUOTA — subscription headroom per vendor, read from local ground truth only
 * (no network on the hot path). Two consumers:
 *   • the Router's fallback chains skip a vendor whose window is nearly spent
 *   • the statusline's usage bars (Anthropic 5H/WK/FB, OpenAI WK + plan)
 *
 * ANTHROPIC — the statusline's OAuth usage cache (/tmp/pai-usage-$USER.json):
 *   five_hour / seven_day utilization, plus limits[] for the scoped FABLE week.
 * OPENAI — the codex CLI's own rollout logs (~/.codex/sessions/YYYY/MM/DD/
 *   rollout-*.jsonl). Each `token_count` event carries rate_limits.primary
 *   (5h) and .secondary (weekly): { used_percent, window_minutes,
 *   resets_at | resets_in_seconds }. The newest event across the newest
 *   rollouts is the current picture. Plan comes from ~/.codex/auth.json's
 *   id_token claim (chatgpt_plan_type), e.g. "pro".
 *
 * CLI:
 *   bun Quota.ts --shell     # oai_wk=4 oai_wk_reset=… oai_5h=… oai_plan=PRO
 *   bun Quota.ts --json
 */

import { existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync, closeSync, fstatSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const HOME = process.env.HOME || homedir();
const CACHE_DIR = join(process.env.XDG_CACHE_HOME || join(HOME, ".cache"), "lifeos-statusline");
const OAI_CACHE = join(CACHE_DIR, "openai-usage.json");
const OAI_TTL_MS = 60_000;

export interface Window { pct: number; resetsAt: number | null }
export interface OpenAIQuota { fiveHour: Window | null; week: Window | null; plan: string | null; observedAt: number | null }
export interface AnthropicQuota { fiveHour: Window | null; week: Window | null; fable: Window | null }

const codexDir = () => process.env.CODEX_HOME || join(HOME, ".codex");

/** Newest-first rollout files, walking at most the last few day directories. */
function newestRollouts(limit = 6): string[] {
  const root = join(codexDir(), "sessions");
  const out: string[] = [];
  const desc = (d: string): string[] => { try { return (readdirSync(d) as string[]).sort().reverse(); } catch { return []; } };
  for (const y of desc(root)) for (const m of desc(join(root, y))) for (const d of desc(join(root, y, m))) {
    const dir = join(root, y, m, d);
    const files = desc(dir).filter((f: string) => f.startsWith("rollout-") && f.endsWith(".jsonl"))
      .map((f: string) => join(dir, f))
      .sort((a: string, b: string) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    out.push(...files);
    if (out.length >= limit) return out.slice(0, limit);
  }
  return out;
}

function tail(path: string, bytes = 256 * 1024): string {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    return buf.toString("utf-8");
  } finally { closeSync(fd); }
}

function toWindow(w: any, eventTs: number): Window | null {
  if (!w || typeof w.used_percent !== "number") return null;
  let resetsAt: number | null = null;
  if (typeof w.resets_at === "number") resetsAt = w.resets_at > 1e12 ? Math.floor(w.resets_at / 1000) : w.resets_at;
  else if (typeof w.resets_in_seconds === "number") resetsAt = Math.floor(eventTs / 1000) + w.resets_in_seconds;
  return { pct: Math.round(w.used_percent), resetsAt };
}

/** Assign primary/secondary to 5h/week by window length (older codex omits window_minutes). */
function splitWindows(rl: any, ts: number): { fiveHour: Window | null; week: Window | null } {
  const ws = [rl?.primary, rl?.secondary].filter(Boolean);
  let fiveHour: Window | null = null, week: Window | null = null;
  for (const [i, w] of ws.entries()) {
    const mins = w.window_minutes;
    const isWeek = typeof mins === "number" ? mins >= 1440 : i === 1;
    if (isWeek) week = toWindow(w, ts); else fiveHour = toWindow(w, ts);
  }
  return { fiveHour, week };
}

export function readCodexPlan(): string | null {
  try {
    const auth = JSON.parse(readFileSync(join(codexDir(), "auth.json"), "utf-8"));
    const tok: string | undefined = auth?.tokens?.id_token ?? auth?.id_token;
    if (!tok) return auth?.OPENAI_API_KEY ? "API" : null;
    const payload = JSON.parse(Buffer.from(tok.split(".")[1], "base64url").toString("utf-8"));
    const plan = payload?.["https://api.openai.com/auth"]?.chatgpt_plan_type ?? payload?.chatgpt_plan_type;
    return plan ? String(plan).toUpperCase() : null;
  } catch { return null; }
}

export function readOpenAIQuota(useCache = true): OpenAIQuota {
  if (useCache) {
    try {
      const c = JSON.parse(readFileSync(OAI_CACHE, "utf-8"));
      if (Date.now() - c.cachedAt < OAI_TTL_MS) return c.q;
    } catch {}
  }
  let best: { ts: number; rl: any } | null = null;
  for (const f of newestRollouts()) {
    let text = "";
    try { text = tail(f); } catch { continue; }
    const lines = text.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      if (!l.includes("rate_limits")) continue;
      try {
        const ev = JSON.parse(l);
        const p = ev.payload ?? ev.msg ?? ev;
        const rl = p.rate_limits ?? p.info?.rate_limits;
        if (!rl) continue;
        const ts = Date.parse(ev.timestamp ?? "") || statSync(f).mtimeMs;
        if (!best || ts > best.ts) best = { ts, rl };
        break;
      } catch { /* partial first line of the tail window */ }
    }
  }
  const q: OpenAIQuota = best
    ? { ...splitWindows(best.rl, best.ts), plan: (best.rl.plan_type ? String(best.rl.plan_type).toUpperCase() : null) ?? readCodexPlan(), observedAt: best.ts }
    : { fiveHour: null, week: null, plan: readCodexPlan(), observedAt: null };
  if (!q.plan) q.plan = readCodexPlan();
  // A window whose reset already passed is stale pre-reset data — clamp to 0.
  const now = Date.now() / 1000;
  for (const k of ["fiveHour", "week"] as const) if (q[k]?.resetsAt && q[k]!.resetsAt! <= now) q[k] = { pct: 0, resetsAt: null };
  try { mkdirSync(CACHE_DIR, { recursive: true }); writeFileSync(OAI_CACHE, JSON.stringify({ cachedAt: Date.now(), q })); } catch {}
  return q;
}

export function readAnthropicQuota(): AnthropicQuota {
  const path = `/tmp/pai-usage-${process.env.USER || "anon"}.json`;
  const out: AnthropicQuota = { fiveHour: null, week: null, fable: null };
  try {
    const j = JSON.parse(readFileSync(path, "utf-8"));
    const w = (o: any): Window | null => o ? { pct: Math.round(o.utilization ?? o.used_percentage ?? 0), resetsAt: o.resets_at ? Math.floor(Date.parse(o.resets_at) / 1000) : null } : null;
    out.fiveHour = w(j.five_hour);
    out.week = w(j.seven_day);
    const scoped = (j.limits ?? []).find((l: any) => /fable/i.test(l?.scope?.model?.display_name ?? ""));
    if (scoped) out.fable = { pct: Math.round(scoped.percent ?? 0), resetsAt: scoped.resets_at ? Math.floor(Date.parse(scoped.resets_at) / 1000) : null };
  } catch {}
  return out;
}

/** Is this vendor (or the scoped Fable week) too close to its cap to route new work to? */
export function exhausted(vendor: "anthropic" | "openai" | "fable", threshold = 95): boolean {
  if (vendor === "openai") {
    const q = readOpenAIQuota();
    return (q.week?.pct ?? 0) >= threshold || (q.fiveHour?.pct ?? 0) >= threshold;
  }
  const a = readAnthropicQuota();
  if (vendor === "fable") return (a.fable?.pct ?? 0) >= threshold;
  return (a.week?.pct ?? 0) >= threshold || (a.fiveHour?.pct ?? 0) >= threshold;
}

if (import.meta.main) {
  const q = readOpenAIQuota(!process.argv.includes("--fresh"));
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ openai: q, anthropic: readAnthropicQuota() }, null, 2));
  } else {
    const sh = (s: string) => `'${s.replace(/'/g, "")}'`;
    console.log([
      `oai_present=${q.week || q.fiveHour ? "true" : "false"}`,
      `oai_wk=${q.week?.pct ?? 0}`,
      `oai_wk_reset=${q.week?.resetsAt ?? 0}`,
      `oai_5h=${q.fiveHour?.pct ?? 0}`,
      `oai_5h_reset=${q.fiveHour?.resetsAt ?? 0}`,
      `oai_plan=${sh(q.plan ?? "")}`,
    ].join("\n"));
  }
}
