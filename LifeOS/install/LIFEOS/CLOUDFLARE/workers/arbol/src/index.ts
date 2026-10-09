/**
 * ARBOL — LifeOS running while you sleep. Cloudflare Workers execution layer.
 * Concept: LIFEOS/DOCUMENTATION/Arbol/ArbolSystem.md
 *
 *   Action    A_*  one unit of work (src/actions.ts)
 *   Pipeline  P_*  ordered actions, Unix pipe model with passthrough
 *   Flow      F_*  source → pipeline → destination on a cron
 *
 * Flows live in src/flows.ts (data, not code). Every run writes a run record to
 * KV (run:<flow>:<ts>, 14-day TTL) and the latest to last:<flow>.
 *
 * Routes (bearer ARBOL_TOKEN):
 *   GET  /flows                 list flows + last run
 *   POST /run/:flow             run one flow now
 *   POST /pipeline/:name        run a pipeline on a JSON body (ad-hoc)
 */

import { bearer, err, json } from "../../../shared/edge";
import { ACTIONS, type ActionEnv, type Data } from "./actions";
import { FLOWS, PIPELINES, type Flow } from "./flows";

interface Env extends ActionEnv { ARBOL_TOKEN: string }

export async function runPipeline(name: string, input: Data, env: Env): Promise<Data> {
  const steps = PIPELINES[name];
  if (!steps) throw new Error(`unknown pipeline ${name}`);
  let data = input;
  for (const step of steps) {
    const act = ACTIONS[step.action];
    if (!act) throw new Error(`unknown action ${step.action}`);
    if (step.each) {
      // Fan an action over a list field, collecting results back into it.
      const list = (data[step.each] as Data[]) ?? [];
      const out: Data[] = [];
      for (const item of list.slice(0, step.limit ?? 20)) out.push(await act({ ...item }, step.cfg ?? {}, env));
      data = { ...data, [step.each]: out };
    } else {
      data = await act(data, step.cfg ?? {}, env);
    }
  }
  return data;
}

async function runFlow(f: Flow, env: Env) {
  const started = Date.now();
  let ok = true, error: string | undefined, out: Data = {};
  try { out = await runPipeline(f.pipeline, { ...f.source }, env); }
  catch (e) { ok = false; error = String(e); }
  const run = { flow: f.name, ok, error, ms: Date.now() - started, at: new Date().toISOString(), summary: Object.keys(out).filter((k) => k !== "content") };
  await env.ARBOL.put(`run:${f.name}:${run.at}`, JSON.stringify(run), { expirationTtl: 14 * 86400 });
  await env.ARBOL.put(`last:${f.name}`, JSON.stringify(run));
  return run;
}

/** Does a 5-field cron match this minute? Supports *, N, N-M, N/S, *\/S and comma lists. */
export function cronMatches(expr: string, d: Date): boolean {
  const vals = [d.getUTCMinutes(), d.getUTCHours(), d.getUTCDate(), d.getUTCMonth() + 1, d.getUTCDay()];
  return expr.trim().split(/\s+/).every((field, i) => field.split(",").some((part) => {
    const [range, stepS] = part.split("/");
    const step = Number(stepS ?? 1);
    const [lo, hi] = range === "*" ? [0, 99] : range.includes("-") ? range.split("-").map(Number) : [Number(range), stepS ? 99 : Number(range)];
    return vals[i] >= lo && vals[i] <= hi && (vals[i] - (range === "*" ? 0 : lo)) % step === 0;
  }));
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (!bearer(req, env.ARBOL_TOKEN)) return err(401, "unauthorized");
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/flows") {
      return json(await Promise.all(FLOWS.map(async (f) => ({ name: f.name, cron: f.cron, pipeline: f.pipeline, last: await env.ARBOL.get(`last:${f.name}`, "json") }))));
    }
    const m = url.pathname.match(/^\/(run|pipeline)\/([\w-]+)$/);
    if (req.method === "POST" && m?.[1] === "run") {
      const f = FLOWS.find((x) => x.name === m[2]);
      return f ? json(await runFlow(f, env)) : err(404, "unknown flow");
    }
    if (req.method === "POST" && m?.[1] === "pipeline") {
      try { return json(await runPipeline(m[2], (await req.json()) as Data, env)); }
      catch (e) { return err(400, String(e)); }
    }
    return err(404, "not found");
  },

  async scheduled(ev: ScheduledController, env: Env, ctx: ExecutionContext) {
    const now = new Date(ev.scheduledTime);
    for (const f of FLOWS) if (cronMatches(f.cron, now)) ctx.waitUntil(runFlow(f, env));
  },
} satisfies ExportedHandler<Env>;
