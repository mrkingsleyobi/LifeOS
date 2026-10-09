/**
 * bunker-health — Bunker's two always-on planes at the edge.
 *
 *   Observability  every 5 min: run each adopted app's FAST cloud probes
 *                  (compiled from its ISA ## Test Strategy by `bunker sync-cloud`);
 *                  top of the hour: DEEP probes too. Uptime counters per app.
 *   Security       hourly outsider scan of every app: required headers, TLS,
 *                  exposed files (.env, .git), auth boundaries on protected paths.
 *                  Same system as Arbol's security scanner, by design.
 *
 * Routes:
 *   GET  /status      summary the Pulse /bunker page reads (BAYS / PROBES / SECURITY / UPTIME)
 *   GET  /status/:app per-app detail
 *   PUT  /manifest    bearer MANIFEST_TOKEN — written by `bunker sync-cloud`
 *   POST /run         bearer — run a cycle now
 *
 * KV (BUNKER): manifest · app:<name> · summary
 */

import { bearer, err, json } from "../../../shared/edge";
import { runProbe, securityScan, type Probe, type ProbeResult, type SecurityFinding } from "../../../shared/probes";

interface Env { BUNKER: KVNamespace; MANIFEST_TOKEN: string; ALERT_WEBHOOK?: string }
interface ManifestApp { app: string; type: string; url: string; protected: string[]; probes: Probe[] }
interface Manifest { apps: ManifestApp[]; compiledAt: string }
interface AppState {
  app: string; url: string; type: string;
  probes: ProbeResult[]; deepAt?: string;
  security: SecurityFinding[]; securityAt?: string;
  up: number; checks: number; lastAt: string;
  grade: "green" | "orange" | "red";
  since: string;                                  // when the grade last changed
  history: ("green" | "degraded" | "red")[];      // last 288 ticks (24h at 5 min)
}

function grade(s: Pick<AppState, "probes" | "security">): AppState["grade"] {
  if (s.probes.some((p) => !p.ok && p.severity === "critical") || s.security.some((f) => f.severity === "critical")) return "red";
  if (s.probes.some((p) => !p.ok) || s.security.some((f) => f.severity === "high")) return "orange";
  return "green";
}

async function cycle(env: Env, deep: boolean, security: boolean) {
  const manifest = await env.BUNKER.get<Manifest>("manifest", "json");
  if (!manifest) return { apps: 0 };
  const alerts: string[] = [];
  for (const a of manifest.apps) {
    const prev = await env.BUNKER.get<AppState>(`app:${a.app}`, "json");
    const wanted = a.probes.filter((p) => p.tier === "fast" || deep);
    const fresh = await Promise.all(wanted.map((p) => runProbe(p)));
    // Deep verdicts carry forward between hourly runs.
    const carried = deep ? [] : (prev?.probes ?? []).filter((r) => a.probes.find((p) => p.isc === r.isc)?.tier === "deep");
    const probes = [...fresh, ...carried];
    const sec = security ? await securityScan(a.app, a.url, a.protected) : prev?.security ?? [];
    const upNow = fresh.length === 0 || fresh.every((r) => r.ok || r.severity !== "critical");
    const state: AppState = {
      app: a.app, url: a.url, type: a.type, probes, security: sec,
      deepAt: deep ? new Date().toISOString() : prev?.deepAt,
      securityAt: security ? new Date().toISOString() : prev?.securityAt,
      up: (prev?.up ?? 0) + (upNow ? 1 : 0), checks: (prev?.checks ?? 0) + 1,
      lastAt: new Date().toISOString(), grade: "green", since: "", history: [],
    };
    state.grade = grade(state);
    state.since = prev && prev.grade === state.grade ? prev.since : state.lastAt;
    const tick: AppState["history"][number] = state.grade === "orange" ? "degraded" : state.grade;
    state.history = [...(prev?.history ?? []), tick].slice(-288);
    if (prev && prev.grade !== state.grade && state.grade !== "green") alerts.push(`${a.app}: ${prev.grade} → ${state.grade}`);
    await env.BUNKER.put(`app:${a.app}`, JSON.stringify(state));
  }
  await env.BUNKER.put("summary", JSON.stringify(await summarize(env, manifest)));
  if (alerts.length && env.ALERT_WEBHOOK) await fetch(env.ALERT_WEBHOOK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: `Bunker: ${alerts.join("; ")}` }) });
  return { apps: manifest.apps.length, alerts };
}

async function allStates(env: Env): Promise<AppState[]> {
  const m = await env.BUNKER.get<Manifest>("manifest", "json");
  if (!m) return [];
  return (await Promise.all(m.apps.map((a) => env.BUNKER.get<AppState>(`app:${a.app}`, "json")))).filter((s): s is AppState => !!s);
}

async function summarize(env: Env, manifest: Manifest) {
  const states = (await Promise.all(manifest.apps.map((a) => env.BUNKER.get<AppState>(`app:${a.app}`, "json")))).filter((s): s is AppState => !!s);
  const probes = states.flatMap((s) => s.probes);
  return {
    bays: { total: manifest.apps.length, green: states.filter((s) => s.grade === "green").length, failing: states.filter((s) => s.grade !== "green").length, unprobed: manifest.apps.filter((a) => !a.probes.length).length },
    probes: { passing: probes.filter((p) => p.ok).length, total: probes.length },
    security: { flagged: states.filter((s) => s.security.some((f) => f.severity === "critical" || f.severity === "high")).length, noTarget: 0 },
    uptime: { up: states.filter((s) => s.probes.every((p) => p.ok || p.severity !== "critical")).length, monitored: states.length },
    compiledAt: manifest.compiledAt,
    at: new Date().toISOString(),
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/status") {
      const summary = ((await env.BUNKER.get("summary", "json")) ?? { bays: { total: 0 } }) as Record<string, unknown>;
      // Summary is public (Lockbox reads it over a service binding); the per-app
      // roster — Pulse's site-health contract — needs the token.
      if (!bearer(req, env.MANIFEST_TOKEN)) return json(summary);
      const states = await allStates(env);
      const apps = states.map((s) => ({ name: s.app, type: s.type, url: s.url, state: s.grade === "orange" ? "degraded" : s.grade, pass: s.probes.filter((p) => p.ok).length, fail: s.probes.filter((p) => !p.ok).length, updated_at: s.lastAt, since: s.since, history: s.history.slice(-24).map((h) => ({ state: h })) }));
      return json({ ...summary, apps, total: apps.length, red: apps.filter((a) => a.state === "red").length, degraded: apps.filter((a) => a.state === "degraded").length, updatedAt: new Date().toISOString() });
    }
    if (req.method === "GET" && url.pathname === "/report") {
      // Pulse's Arbol security-report contract (modules/bunker.ts ArbolReport).
      if (!bearer(req, env.MANIFEST_TOKEN)) return err(401, "unauthorized");
      const states = await allStates(env);
      const checks = states.flatMap((s) => {
        const host = new URL(s.url).host;
        const fails = s.security.map((f) => ({ target: host, category: f.check.split(":")[0], check: f.check, status: "fail", evidence: f.detail, severity: f.severity }));
        return fails.length ? fails : s.securityAt ? [{ target: host, category: "scan", check: "outsider-scan", status: "pass", severity: "info" }] : [];
      });
      const ts = states.map((s) => s.securityAt).filter(Boolean).sort().at(-1) ?? new Date().toISOString();
      return json({ timestamp: ts, summary: { pass: checks.filter((c) => c.status === "pass").length, fail: checks.filter((c) => c.status === "fail").length, error: 0, skip: 0 }, checks });
    }
    if (req.method === "GET" && url.pathname.startsWith("/status/")) {
      const s = await env.BUNKER.get(`app:${decodeURIComponent(url.pathname.slice(8))}`, "json");
      return s ? json(s) : err(404, "unknown app");
    }
    if (!bearer(req, env.MANIFEST_TOKEN)) return err(401, "unauthorized");
    if (req.method === "PUT" && url.pathname === "/manifest") {
      const m = (await req.json()) as Manifest;
      if (!Array.isArray(m?.apps)) return err(400, "manifest.apps required");
      await env.BUNKER.put("manifest", JSON.stringify(m));
      return json({ ok: true, apps: m.apps.length });
    }
    if (req.method === "POST" && url.pathname === "/run") return json(await cycle(env, url.searchParams.has("deep"), url.searchParams.has("security")));
    return err(404, "not found");
  },

  async scheduled(ev: ScheduledController, env: Env, ctx: ExecutionContext) {
    const topOfHour = new Date(ev.scheduledTime).getUTCMinutes() < 5;
    ctx.waitUntil(cycle(env, topOfHour, topOfHour));
  },
} satisfies ExportedHandler<Env>;
