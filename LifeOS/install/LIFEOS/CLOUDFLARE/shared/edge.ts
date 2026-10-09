/**
 * Shared edge helpers for LifeOS Workers.
 *
 *   jev()          Jev decision call from the edge (OpenRouter /api/alpha/decisions
 *                  or TypeSafe /v1/systemone) — same wire format as LIFEOS/DECISIONS/Jev.ts
 *   bearer()       constant-time bearer-token check
 *   accessJwt()    Cloudflare Access JWT verification (team domain + audience)
 *   json()/err()   response helpers
 */

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

export const err = (status: number, message: string) => json({ error: message }, status);

/** Constant-time string compare (no early exit on first mismatch). */
export function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

export function bearer(req: Request, expected: string | undefined): boolean {
  if (!expected) return false;
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") && safeEqual(h.slice(7), expected);
}

// ── Cloudflare Access JWT ───────────────────────────────────────────────────
type Jwk = JsonWebKey & { kid: string };
let jwksCache: { at: number; keys: Jwk[] } | null = null;

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

/** Verify Cf-Access-Jwt-Assertion against the team's certs. Returns the email claim or null. */
export async function accessJwt(req: Request, teamDomain: string | undefined, aud: string | undefined): Promise<string | null> {
  const token = req.headers.get("cf-access-jwt-assertion");
  if (!token || !teamDomain || !aud) return null;
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  const header = JSON.parse(new TextDecoder().decode(b64url(h)));
  const payload = JSON.parse(new TextDecoder().decode(b64url(p)));
  if (!(Array.isArray(payload.aud) ? payload.aud : [payload.aud]).includes(aud)) return null;
  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
  if (!jwksCache || Date.now() - jwksCache.at > 3600_000) {
    const r = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
    jwksCache = { at: Date.now(), keys: ((await r.json()) as { keys: Jwk[] }).keys };
  }
  const jwk = jwksCache.keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(s), new TextEncoder().encode(`${h}.${p}`));
  return ok ? String(payload.email ?? payload.sub ?? "") : null;
}

// ── Jev from the edge ───────────────────────────────────────────────────────
export type JevQuestion =
  | { type: "noul"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export interface JevEnv { OPENROUTER_API_KEY?: string; TYPESAFE_API_KEY?: string }

export async function jev(env: JevEnv, state: unknown, questions: Record<string, JevQuestion>, timeoutMs = 4000): Promise<{ ok: true; answers: Record<string, any>; model: string; cost: number } | { ok: false; reason: string }> {
  const tries: { url: string; key: string; model: string; extra?: object }[] = [];
  if (env.TYPESAFE_API_KEY) tries.push({ url: "https://api.typesafe.ai/v1/systemone", key: env.TYPESAFE_API_KEY, model: "jev-latest" });
  if (env.OPENROUTER_API_KEY) tries.push({ url: "https://openrouter.ai/api/alpha/decisions", key: env.OPENROUTER_API_KEY, model: "typesafe/jev-1.13", extra: { provider: { zdr: true, data_collection: "deny" } } });
  if (!tries.length) return { ok: false, reason: "no-key" };
  let last = "no transport";
  for (const t of tries) {
    try {
      const r = await fetch(t.url, {
        method: "POST",
        headers: { authorization: `Bearer ${t.key}`, "content-type": "application/json" },
        body: JSON.stringify({ model: t.model, state, questions, ...t.extra }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) { last = `${r.status}`; if (r.status === 401 || r.status === 403 || r.status >= 500) continue; return { ok: false, reason: last }; }
      const j = (await r.json()) as { answers?: Record<string, any>; model?: string; usage?: { cost?: number } };
      if (!j.answers || Object.keys(questions).some((k) => !j.answers![k])) return { ok: false, reason: "incomplete" };
      return { ok: true, answers: j.answers, model: j.model ?? t.model, cost: j.usage?.cost ?? 0 };
    } catch (e) { last = String(e); }
  }
  return { ok: false, reason: last };
}
