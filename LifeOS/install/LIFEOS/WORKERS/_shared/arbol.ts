/**
 * Shared Arbol-style Worker helpers. No node imports, no globals beyond Web APIs, so every Worker
 * in this folder bundles for the Workers runtime unchanged.
 */
export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Constant-time compare so a token check does not leak length/prefix through timing. */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export const authorized = (req: Request, token: string | undefined): boolean =>
  !!token && safeEqual(req.headers.get("Authorization") ?? "", `Bearer ${token}`);

/** Read a JSON object body with a byte cap. Returns a Response on failure so callers can `return` it. */
export async function readJson(req: Request, maxBytes: number): Promise<Record<string, unknown> | Response> {
  const raw = await req.text();
  if (raw.length > maxBytes) return json({ error: "payload too large" }, 413);
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : json({ error: "json object required" }, 400);
  } catch { return json({ error: "invalid json" }, 400); }
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
