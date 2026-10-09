/**
 * errata-intake — the app door into Errata (LIFEOS/ERRATA/Errata.ts).
 * Contract: LIFEOS/DOCUMENTATION/Errata/ErrataIntake.md (principal's private tree).
 *
 * Every Bunker app can carry a "this is wrong" affordance that POSTs here. The
 * text is stored VERBATIM. No model touches it at intake. Enrichment happens
 * daily on the laptop's OpenAI lane after `bun Errata.ts pull` drains the queue.
 *
 *   POST /report  { verbatim }   header X-App-Key: <per-app key>   → 202
 *   POST /drain                  bearer DRAIN_TOKEN → undrained rows, marked drained
 *
 * Abuse limits: 4 KB per report, 30 reports per app key per hour.
 */

import { bearer, err, json, safeEqual } from "../../../shared/edge";

interface Env { DB: D1Database; APP_KEYS: string; DRAIN_TOKEN: string }

function appFor(key: string | null, env: Env): string | null {
  if (!key) return null;
  let keys: Record<string, string> = {};
  try { keys = JSON.parse(env.APP_KEYS); } catch { return null; }
  for (const [app, k] of Object.entries(keys)) if (safeEqual(k, key)) return app;
  return null;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "POST" && url.pathname === "/report") {
      const app = appFor(req.headers.get("x-app-key"), env);
      if (!app) return err(401, "unknown app key");
      const body = (await req.json().catch(() => null)) as { verbatim?: unknown } | null;
      const verbatim = typeof body?.verbatim === "string" ? body.verbatim : "";
      if (!verbatim.trim()) return err(400, "verbatim required");
      if (verbatim.length > 4096) return err(413, "report too long (4 KB max)");
      const hourAgo = new Date(Date.now() - 3600_000).toISOString();
      const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM intake WHERE app = ? AND ts > ?").bind(app, hourAgo).first<{ n: number }>();
      if ((recent?.n ?? 0) >= 30) return err(429, "rate limited");
      await env.DB.prepare("INSERT INTO intake (ts, app, verbatim) VALUES (?, ?, ?)").bind(new Date().toISOString(), app, verbatim).run();
      return json({ ok: true }, 202);
    }

    if (req.method === "POST" && url.pathname === "/drain") {
      if (!bearer(req, env.DRAIN_TOKEN)) return err(401, "unauthorized");
      const { results } = await env.DB.prepare("SELECT id, ts, app, verbatim FROM intake WHERE drained = 0 ORDER BY ts LIMIT 500").all<{ id: number; ts: string; app: string; verbatim: string }>();
      if (results.length) {
        const ids = results.map((r) => r.id);
        await env.DB.prepare(`UPDATE intake SET drained = 1 WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).run();
      }
      return json(results);
    }

    return err(404, "not found");
  },
} satisfies ExportedHandler<Env>;
