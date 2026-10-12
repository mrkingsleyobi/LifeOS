/**
 * Assistant (DA) module — backs the Pulse Assistant tab
 * (Observability/src/app/assistant/page.tsx). pulse.ts already wires this file
 * (`existsSync(PULSE_DIR/Assistant/module.ts)` → startAssistant / assistantHealth
 * / handleAssistantRequest / stopAssistant, routes under `/assistant/*`), but
 * the module itself is a private, release-excluded piece (upstream #1419, #1173),
 * so a public install loads the page with no backend and every tab 404s.
 *
 * This is the generic, fail-soft rebuild. Every read degrades to a sensible
 * empty when its source file or tool is missing — a fresh install must render,
 * not error.
 *
 *   GET  /assistant/identity     getIdentity() + DA_IDENTITY.md frontmatter
 *   GET  /assistant/personality  DA_IDENTITY.md frontmatter `personality:`
 *   GET  /assistant/health       Hermes sidecar health (../modules/scheduled)
 *   GET  /assistant/tasks        unified scheduled jobs across executors
 *   GET  /assistant/diary        USER/DIGITAL_ASSISTANT/DA_DIARY.jsonl
 *   GET  /assistant/opinions     USER/DIGITAL_ASSISTANT/OPINIONS.md (raw)
 *   GET  /assistant/cron         DA-managed claude cron (fail-soft [])
 *   GET  /assistant/history      recent chat turns
 *   POST /assistant/ask { question } → routes through the Lockbox relay on
 *        loopback (which runs `claude -p`, so the Router/Jev hook fires), stores
 *        the turn in MEMORY/STATE/assistant/history.jsonl. Pulse never runs
 *        `claude -p` itself — that would block the daemon.
 *
 * Cron CRUD and trait patches the page offers need the private DA write tooling;
 * until that is rebuilt they return 501 with a clear reason, so the page
 * degrades instead of silently failing.
 */

import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";
import { getIdentity, getPrincipalName } from "../../../hooks/lib/identity";
import { localJobs, arbolJobs, hermesJobs, hermesHealth, type HermesHealth } from "../modules/scheduled";

const HOME = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
const LIFEOS = process.env.LIFEOS_DIR || join(HOME, "LIFEOS");
const USER = join(LIFEOS, "USER");
const STATE = join(LIFEOS, "MEMORY", "STATE", "assistant");
const DA_IDENTITY = join(USER, "DIGITAL_ASSISTANT", "DA_IDENTITY.md");
const RELAY_URL = `http://127.0.0.1:${process.env.LOCKBOX_RELAY_PORT ?? 31338}`;

const state: { running: boolean; startedAt: number; jobs: unknown } = { running: false, startedAt: 0, jobs: null };

// ── frontmatter ──────────────────────────────────────────────────────────────
function daFrontmatter(): Record<string, any> {
  try {
    const m = readFileSync(DA_IDENTITY, "utf8").match(/^---\n([\s\S]*?)\n---/);
    return m ? ((parseYaml(m[1]) as Record<string, any>) ?? {}) : {};
  } catch {
    return {};
  }
}
const asList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

// ── identity / personality ──────────────────────────────────────────────────
function identity() {
  const id = (() => { try { return getIdentity(); } catch { return { name: "Assistant", fullName: "Assistant", displayName: "Assistant", color: "#888888" } as any; } })();
  const fm = daFrontmatter();
  const has_avatar = ["avatar.png", "avatar.jpg", "AVATAR.png"].some((f) => existsSync(join(USER, "DIGITAL_ASSISTANT", f)));
  return {
    name: id.name,
    full_name: id.fullName ?? id.name,
    display_name: id.displayName ?? id.name,
    color: id.color ?? "#888888",
    role: fm.core?.role ?? fm.role ?? "Digital Assistant",
    origin_story: fm.core?.origin_story ?? fm.origin_story ?? "",
    has_avatar,
    principal: (() => { try { return getPrincipalName(); } catch { return ""; } })(),
    uptime_ms: state.startedAt ? Date.now() - state.startedAt : 0,
  };
}
function personality() {
  const p = daFrontmatter().personality ?? {};
  const prefs = p.preferences ?? {};
  return {
    base_description: p.base_description ?? p.description ?? "",
    traits: p.traits && typeof p.traits === "object" ? p.traits : {},
    anchors: Array.isArray(p.anchors) ? p.anchors.map((a: any) => ({ name: String(a?.name ?? ""), description: String(a?.description ?? "") })) : [],
    preferences: {
      what_i_love: asList(prefs.what_i_love),
      what_i_dislike: asList(prefs.what_i_dislike),
      working_style: asList(prefs.working_style),
      intellectual_interests: asList(prefs.intellectual_interests),
    },
    companion: p.companion ? { name: String(p.companion.name ?? ""), species: String(p.companion.species ?? ""), personality: String(p.companion.personality ?? "") } : null,
    relationship: { dynamic: p.relationship?.dynamic ?? "", interaction_style: p.relationship?.interaction_style ?? "" },
    autonomy: { can_initiate: asList(p.autonomy?.can_initiate), must_ask: asList(p.autonomy?.must_ask) },
    writing: { style: p.writing?.style ?? "", avoid: asList(p.writing?.avoid), prefer: asList(p.writing?.prefer) },
    voice: p.voice ? { provider: String(p.voice.provider ?? "") } : null,
  };
}

// ── tasks ────────────────────────────────────────────────────────────────────
function tasks() {
  const map = (jobs: any[], source: string) => jobs.map((j) => ({ name: j.title ?? j.id, schedule: j.cadence ?? "", status: j.state ?? "unknown", source, details: { id: j.id, purpose: j.purpose, lastRun: j.lastRun } }));
  let list: any[] = [];
  let hermes: HermesHealth | null = null;
  try { list = list.concat(map(localJobs(), "launchd")); } catch {}
  try { list = list.concat(map(arbolJobs(), "arbol")); } catch {}
  try { list = list.concat(map(hermesJobs(), "hermes")); } catch {}
  try { hermes = hermesHealth(); } catch {}
  const by_source: Record<string, number> = { da: 0, pulse: 0, "claude-code": 0, launchd: 0, arbol: 0, hermes: 0 };
  for (const t of list) by_source[t.source] = (by_source[t.source] ?? 0) + 1;
  return { tasks: list, count: list.length, by_source, hermes };
}

// ── diary / opinions / cron ──────────────────────────────────────────────────
function diary() {
  try {
    const entries = readFileSync(join(USER, "DIGITAL_ASSISTANT", "DA_DIARY.jsonl"), "utf8").split("\n").filter(Boolean).slice(-100).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }).reverse();
    return { entries };
  } catch { return { entries: [] }; }
}
function opinions() {
  for (const f of [join(USER, "DIGITAL_ASSISTANT", "OPINIONS.md"), join(USER, "OPINIONS.md")]) {
    try { return { raw: readFileSync(f, "utf8") }; } catch {}
  }
  return { raw: "" };
}
function cronList() {
  try { const j = JSON.parse(readFileSync(join(LIFEOS, "MEMORY", "CRON", "da-cron.json"), "utf8")); return { jobs: Array.isArray(j) ? j : j.jobs ?? [] }; } catch { return { jobs: [] }; }
}

// ── chat ─────────────────────────────────────────────────────────────────────
async function ask(question: string) {
  mkdirSync(STATE, { recursive: true });
  let answer = "", routed = false, via = "relay";
  try {
    const r = await fetch(`${RELAY_URL}/da/ask`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lockbox-secret": process.env.LOCKBOX_RELAY_SECRET ?? "" },
      body: JSON.stringify({ question, client: "pulse" }),
      signal: AbortSignal.timeout(150_000),
    });
    if (r.ok) { const j = (await r.json()) as any; answer = j.answer ?? ""; routed = j.ok ?? true; }
    else { via = "unavailable"; answer = `The Lockbox relay returned HTTP ${r.status}. Start it: bun ~/.claude/LIFEOS/LOCKBOX/Relay.ts serve`; }
  } catch {
    via = "unavailable";
    answer = `The Lockbox relay is not reachable on ${RELAY_URL}. Start it: LOCKBOX_RELAY_SECRET=… bun ~/.claude/LIFEOS/LOCKBOX/Relay.ts serve`;
  }
  const turn = { ts: new Date().toISOString(), question, answer, routed, via };
  try { appendFileSync(join(STATE, "history.jsonl"), JSON.stringify(turn) + "\n"); } catch {}
  return turn;
}
function history() {
  try {
    const turns = readFileSync(join(STATE, "history.jsonl"), "utf8").split("\n").filter(Boolean).slice(-50).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }).reverse();
    return { turns };
  } catch { return { turns: [] }; }
}

// ── pulse.ts contract ────────────────────────────────────────────────────────
export function startAssistant(_da?: unknown, jobs?: unknown) { state.running = true; state.startedAt = Date.now(); state.jobs = jobs ?? null; }
export function stopAssistant() { state.running = false; }
export function assistantHealth() { return { status: state.running ? "healthy" : "stopped", name: (() => { try { return identity().name; } catch { return "Assistant"; } })() }; }

const GETS: Record<string, () => unknown> = {
  "/assistant/identity": identity,
  "/assistant/personality": personality,
  "/assistant/health": () => { try { return hermesHealth(); } catch { return null; } },
  "/assistant/tasks": tasks,
  "/assistant/diary": diary,
  "/assistant/opinions": opinions,
  "/assistant/cron": cronList,
  "/assistant/history": history,
};

export async function handleAssistantRequest(req: Request, pathname: string): Promise<Response> {
  const p = pathname.replace(/\/$/, "");
  try {
    if (req.method === "GET" && GETS[p]) return Response.json(GETS[p]());
    if (req.method === "POST" && p === "/assistant/ask") {
      const body = (await req.json().catch(() => ({}))) as { question?: unknown };
      const q = typeof body.question === "string" ? body.question.trim() : "";
      if (!q) return Response.json({ error: "question required" }, { status: 400 });
      return Response.json(await ask(q));
    }
    // Write surfaces the page offers but the private DA write tooling backs.
    if (req.method !== "GET" && /^\/assistant\/(cron|personality\/traits)/.test(p)) {
      return Response.json({ error: "not implemented", reason: "DA write tooling (cron CRUD, trait patch) is private and not in this install" }, { status: 501 });
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message ?? e) }, { status: 500 });
  }
}
