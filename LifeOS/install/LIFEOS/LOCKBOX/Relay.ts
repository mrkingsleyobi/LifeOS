#!/usr/bin/env bun
/**
 * LOCKBOX RELAY — the laptop half of Lockbox. Listens on loopback only; the
 * Lockbox Worker reaches it through a Cloudflare Tunnel guarded by an Access
 * service token, and every request must also carry LOCKBOX_RELAY_SECRET.
 *
 *   POST /da/ask  { question, client }   → { answer } via `claude -p` — the
 *                 RouterFrontDoor hook fires inside that session, so a remote
 *                 question is routed by Jev exactly like a typed one
 *   POST /da/act  { action, args }       → runs ONE allowlisted command (no shell
 *                 interpolation: argv arrays only)
 *   GET  /health
 *
 * Then drains questions Lockbox queued while the laptop slept:
 *   bun Relay.ts drain   (pulls ask:* from the Worker's KV via `wrangler kv`)
 *
 * Run:  LOCKBOX_RELAY_SECRET=… bun ~/.claude/LIFEOS/LOCKBOX/Relay.ts serve
 * Tunnel: cloudflared tunnel route dns <tunnel> relay.<domain>; ingress → http://127.0.0.1:31338
 */

import { spawnSync } from "child_process";
import { join } from "path";
import { timingSafeEqual } from "crypto";

const PORT = Number(process.env.LOCKBOX_RELAY_PORT ?? 31338);
const SECRET = process.env.LOCKBOX_RELAY_SECRET ?? "";
const L = join(import.meta.dir, "..");

/** action → argv (no shell). Args are passed as discrete argv entries, never interpolated. */
const ACTIONS: Record<string, (a: Record<string, string>) => string[]> = {
  "errata.capture": (a) => ["bun", join(L, "ERRATA", "Errata.ts"), "capture", String(a.verbatim ?? ""), "--source", "app", "--system", String(a.system ?? "lockbox")],
  "socrates.run": () => ["bun", join(L, "SOCRATES", "Socrates.ts"), "run"],
  "bunker.test": (a) => ["bun", join(L, "BUNKER", "Bunker.ts"), "test", ...(a.app ? ["--app", String(a.app)] : [])],
  "achilles.due": () => ["bun", join(L, "ACHILLES", "Achilles.ts"), "due"],
};

function authorized(req: Request): boolean {
  const got = Buffer.from(req.headers.get("x-lockbox-secret") ?? "");
  const want = Buffer.from(SECRET);
  return SECRET.length >= 24 && got.length === want.length && timingSafeEqual(got, want);
}

export function ask(question: string): { answer: string; ok: boolean } {
  const r = spawnSync("claude", ["-p", "--output-format", "text"], { input: question, encoding: "utf-8", timeout: 140_000, maxBuffer: 8 << 20 });
  return { ok: r.status === 0, answer: (r.stdout || r.stderr || "").trim() };
}

if (import.meta.main) {
  const cmd = process.argv[2] ?? "serve";
  if (cmd === "serve") {
    if (SECRET.length < 24) { console.error("LOCKBOX_RELAY_SECRET must be set (≥24 chars)"); process.exit(2); }
    Bun.serve({
      hostname: "127.0.0.1",
      port: PORT,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/health") return Response.json({ ok: true });
        if (!authorized(req)) return new Response("unauthorized", { status: 401 });
        const body = (await req.json().catch(() => ({}))) as Record<string, any>;
        if (req.method === "POST" && url.pathname === "/da/ask") {
          if (typeof body.question !== "string" || !body.question.trim()) return new Response("question required", { status: 400 });
          return Response.json(ask(`[Remote question via Lockbox from ${String(body.client ?? "client")}]\n${body.question}`));
        }
        if (req.method === "POST" && url.pathname === "/da/act") {
          const build = ACTIONS[String(body.action)];
          if (!build) return new Response("action not allowlisted", { status: 403 });
          const [bin, ...argv] = build((body.args ?? {}) as Record<string, string>);
          const r = spawnSync(bin, argv, { encoding: "utf-8", timeout: 300_000 });
          return Response.json({ ok: r.status === 0, exit: r.status, output: (r.stdout + r.stderr).slice(-4000) });
        }
        return new Response("not found", { status: 404 });
      },
    });
    console.log(`Lockbox relay on http://127.0.0.1:${PORT}`);
  } else if (cmd === "drain") {
    const ns = process.env.LOCKBOX_KV_ID;
    if (!ns) { console.error("set LOCKBOX_KV_ID"); process.exit(2); }
    const keys = JSON.parse(spawnSync("wrangler", ["kv", "key", "list", "--namespace-id", ns, "--prefix", "ask:", "--remote"], { encoding: "utf-8" }).stdout || "[]") as { name: string }[];
    for (const k of keys) {
      const q = JSON.parse(spawnSync("wrangler", ["kv", "key", "get", k.name, "--namespace-id", ns, "--remote"], { encoding: "utf-8" }).stdout || "{}");
      const a = ask(q.question ?? "");
      spawnSync("wrangler", ["kv", "key", "put", k.name.replace(/^ask:/, "answer:"), JSON.stringify({ ...q, ...a, answeredAt: new Date().toISOString() }), "--namespace-id", ns, "--remote"]);
      spawnSync("wrangler", ["kv", "key", "delete", k.name, "--namespace-id", ns, "--remote"]);
      console.log(`answered ${k.name}`);
    }
    if (!keys.length) console.log("no queued questions");
  } else {
    console.error("usage: Relay.ts serve | drain");
    process.exit(2);
  }
}
