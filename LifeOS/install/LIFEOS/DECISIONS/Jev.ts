#!/usr/bin/env bun
/**
 * JEV — typed client for TypeSafe's decision model (System One).
 *
 * Jev answers typed questions with probabilities, never prose:
 *   noul   — yes/no            → { noul: P(yes) }
 *   choice — one of ≤255 opts  → { choice, probabilities, confidence }
 *   score  — 2–10 rubric levels→ { score, legend, probabilities, confidence }
 *
 * Two transports, same body:
 *   typesafe   POST https://api.typesafe.ai/v1/systemone     (TYPESAFE_API_KEY, model "jev-latest")
 *   openrouter POST https://openrouter.ai/api/alpha/decisions (OPENROUTER_API_KEY, model "typesafe/jev-1.13")
 * Selected by LIFEOS_JEV_TRANSPORT, else whichever key is present (TypeSafe first).
 * OpenRouter requests carry provider { zdr: true, data_collection: "deny" }.
 *
 * Limits honoured here: 32k tokens for state + the longest question. State is
 * truncated head+tail before send; emails/phones are redacted; credential-shaped
 * text never reaches Jev (callers must route it to the private lane instead).
 *
 * CLI (the DA uses Jev as a tool through this):
 *   bun Jev.ts noul   "<state>" "<question>"
 *   bun Jev.ts choice "<state>" "<question>" opt1="desc" opt2="desc" …
 *   bun Jev.ts score  "<state>" "<question>" "level0" "level1" …
 *   bun Jev.ts ping
 */

import { mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { SECRET_VALUE_SHAPES } from "../../hooks/lib/egress-class-core";

/** A transport that rejected our key is benched for an hour so every prompt doesn't pay its round-trip. */
const BENCH_MS = 60 * 60 * 1000;
const benchFile = (t: string) => join(process.env.XDG_CACHE_HOME || join(process.env.HOME || homedir(), ".cache"), "lifeos-statusline", `jev-benched-${t}`);
function benched(t: string): boolean {
  try { return Date.now() - statSync(benchFile(t)).mtimeMs < BENCH_MS; } catch { return false; }
}
function bench(t: string) {
  try { const f = benchFile(t); mkdirSync(join(f, ".."), { recursive: true }); writeFileSync(f, new Date().toISOString()); } catch {}
}

export type { NoulQ, ChoiceQ, ScoreQ, Question, NoulA, ChoiceA, ScoreA, Answer, AnswersFor } from "./JevTypes";
import type { Question, AnswersFor } from "./JevTypes";

export interface JevResult<Q extends Record<string, Question>> {
  ok: true;
  answers: AnswersFor<Q>;
  model: string;
  transport: Transport;
  latencyMs: number;
  usage: { inputTokens: number; outputTokens: number; cost: number };
}
export interface JevFailure { ok: false; reason: "no-key" | "secret-in-state" | "timeout" | "http" | "parse" | "incomplete"; detail: string; latencyMs: number }

export type Transport = "typesafe" | "openrouter";

const ENDPOINT: Record<Transport, string> = {
  typesafe: "https://api.typesafe.ai/v1/systemone",
  openrouter: "https://openrouter.ai/api/alpha/decisions",
};
const DEFAULT_MODEL: Record<Transport, string> = {
  typesafe: "jev-latest",
  openrouter: "typesafe/jev-1.13",
};

/** Rough token estimate (≈4 chars/token) — enough to stay under the 32k state window. */
const STATE_CHAR_BUDGET = 24_000 * 4;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?:\+?\d[\s().-]?){7,15}\d/g;

export function redact(text: string): string {
  return text.replace(EMAIL, "[email]").replace(PHONE, "[phone]");
}

export function containsSecret(text: string): boolean {
  return SECRET_VALUE_SHAPES.some((re) => re.test(text));
}

function fitState(state: string): string {
  if (state.length <= STATE_CHAR_BUDGET) return state;
  const half = Math.floor(STATE_CHAR_BUDGET / 2);
  return `${state.slice(0, half)}\n…[truncated]…\n${state.slice(-half)}`;
}

/** Keys from the canonical ~/.claude/.env (hooks don't always inherit the shell env). process.env wins. */
function envWithFile(): NodeJS.ProcessEnv {
  const path = process.env.LIFEOS_JEV_ENV_FILE ?? join(process.env.HOME || homedir(), ".claude", ".env");
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync(path, "utf-8").split("\n")) {
      const m = line.match(/^\s*(?:export\s+)?(TYPESAFE_API_KEY|OPENROUTER_API_KEY|LIFEOS_JEV_TRANSPORT|LIFEOS_JEV_MODEL)\s*=\s*["']?([^"'\n]*)["']?\s*$/);
      if (m) out[m[1]] = m[2];
    }
  } catch { /* no .env */ }
  return { ...out, ...process.env };
}

/** Transports to try, in order. A forced transport is tried alone. */
export function transports(env = envWithFile()): { transport: Transport; key: string }[] {
  const all: { transport: Transport; key: string }[] = [];
  if (env.TYPESAFE_API_KEY) all.push({ transport: "typesafe", key: env.TYPESAFE_API_KEY });
  if (env.OPENROUTER_API_KEY) all.push({ transport: "openrouter", key: env.OPENROUTER_API_KEY });
  const forced = env.LIFEOS_JEV_TRANSPORT as Transport | undefined;
  if (forced) return all.filter((t) => t.transport === forced);
  const live = all.filter((t) => !benched(t.transport));
  return live.length ? live : all;
}

export function pickTransport(env = envWithFile()) {
  return transports(env)[0] ?? null;
}

/** Validate that every asked question came back with the right answer type. */
function complete<Q extends Record<string, Question>>(questions: Q, answers: Record<string, any>): answers is AnswersFor<Q> {
  for (const [id, q] of Object.entries(questions)) {
    const a = answers?.[id];
    if (!a || a.type !== q.type) return false;
    if (q.type === "noul" && typeof a.noul !== "number") return false;
    if (q.type === "choice" && typeof a.choice !== "string") return false;
    if (q.type === "score" && typeof a.score !== "number") return false;
  }
  return true;
}

export async function ask<Q extends Record<string, Question>>(
  state: string | Record<string, unknown> | string[],
  questions: Q,
  opts: { timeoutMs?: number; model?: string; fetchImpl?: typeof fetch } = {},
): Promise<JevResult<Q> | JevFailure> {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const raw = typeof state === "string" ? state : JSON.stringify(state);
  if (containsSecret(raw)) return { ok: false, reason: "secret-in-state", detail: "credential-shaped text — route to the private lane", latencyMs: ms() };

  const ts = transports();
  if (!ts.length) return { ok: false, reason: "no-key", detail: "set TYPESAFE_API_KEY or OPENROUTER_API_KEY", latencyMs: ms() };

  const cleanState = typeof state === "string"
    ? fitState(redact(state))
    : JSON.parse(redact(JSON.stringify(state)));

  const deadline = Date.now() + (opts.timeoutMs ?? 2500);
  let last: JevFailure = { ok: false, reason: "http", detail: "no transport tried", latencyMs: 0 };
  for (const t of ts) {
    const remaining = deadline - Date.now();
    if (remaining <= 50) return { ok: false, reason: "timeout", detail: last.detail, latencyMs: ms() };
    const body: Record<string, unknown> = {
      model: opts.model ?? process.env.LIFEOS_JEV_MODEL ?? DEFAULT_MODEL[t.transport],
      state: cleanState,
      questions,
    };
    if (t.transport === "openrouter") body.provider = { zdr: true, data_collection: "deny" };

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), remaining);
    try {
      const res = await (opts.fetchImpl ?? fetch)(ENDPOINT[t.transport], {
        method: "POST",
        headers: { Authorization: `Bearer ${t.key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      if (!res.ok) {
        last = { ok: false, reason: "http", detail: `${t.transport} ${res.status} ${(await res.text()).slice(0, 200)}`, latencyMs: ms() };
        // Auth / quota / server errors on one transport → try the next one.
        if (res.status === 401 || res.status === 403) { bench(t.transport); continue; }
        if (res.status === 402 || res.status === 429 || res.status >= 500) continue;
        return last;
      }
      let json: any;
      try { json = await res.json(); } catch (e) { return { ok: false, reason: "parse", detail: String(e), latencyMs: ms() }; }
      if (!complete(questions, json.answers)) return { ok: false, reason: "incomplete", detail: "missing or mistyped answers", latencyMs: ms() };
      const u = json.usage ?? {};
      return {
        ok: true,
        answers: json.answers,
        model: json.model ?? String(body.model),
        transport: t.transport,
        latencyMs: ms(),
        usage: {
          inputTokens: u.input_tokens ?? u.inputTokens ?? 0,
          outputTokens: u.output_tokens ?? u.outputTokens ?? 0,
          cost: u.cost ?? 0,
        },
      };
    } catch (e: any) {
      if (e?.name === "AbortError") return { ok: false, reason: "timeout", detail: `${t.transport} timed out`, latencyMs: ms() };
      last = { ok: false, reason: "http", detail: `${t.transport}: ${String(e?.message ?? e)}`, latencyMs: ms() };
    } finally {
      clearTimeout(timer);
    }
  }
  return last;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (import.meta.main) {
  const [cmd, state, question, ...rest] = process.argv.slice(2);
  const out = (v: unknown) => console.log(JSON.stringify(v, null, 2));
  let qs: Record<string, Question> = {};
  switch (cmd) {
    case "ping":
      out({ transport: pickTransport()?.transport ?? null });
      process.exit(pickTransport() ? 0 : 1);
    case "noul":
      qs = { q: { type: "noul", instructions: question } };
      break;
    case "choice": {
      const criteria = Object.fromEntries(rest.map((kv: string) => {
        const i = kv.indexOf("=");
        return i < 0 ? [kv, kv] : [kv.slice(0, i), kv.slice(i + 1)];
      }));
      qs = { q: { type: "choice", instructions: question, criteria } };
      break;
    }
    case "score":
      qs = { q: { type: "score", instructions: question, criteria: rest } };
      break;
    default:
      console.error("usage: Jev.ts noul|choice|score|ping <state> <question> [criteria…]");
      process.exit(2);
  }
  if (!state || !question) { console.error("state and question are required"); process.exit(2); }
  const r = await ask(state, qs, { timeoutMs: 10_000 });
  out(r.ok ? { ...r.answers.q, model: r.model, latencyMs: r.latencyMs, cost: r.usage.cost } : r);
  process.exit(r.ok ? 0 : 1);
}
