/**
 * LOCKBOX — the one MCP door into LifeOS for every non-terminal client
 * (Relay, Hermes, Pulse modules, outside agents).
 *
 * Transport: MCP over HTTP — POST /mcp with JSON-RPC 2.0 (initialize,
 * tools/list, tools/call, ping). Remote reach is this Worker; the laptop is
 * reached only through a Cloudflare Tunnel guarded by an Access service token.
 *
 * Three scopes, granted per credential:
 *   read  curated read tools — snapshots the laptop pushes, Bunker status,
 *         the router's pick for a prompt. Never raw files.
 *   ask   da.ask — a question to the DA, answered by `claude -p` on the laptop
 *         (through LIFEOS/LOCKBOX/Relay.ts, so the Router/Jev hook still routes it).
 *         Queued in KV when the laptop is asleep.
 *   act   act.request → the Worker holds the action and sends a one-time code
 *         to the PRINCIPAL's phone (CONFIRM_WEBHOOK); act.confirm(code) runs it.
 *         The calling client never sees the code: confirmation is server-side.
 *
 * Credentials: Cloudflare Access identity (ACCESS_TEAM/ACCESS_AUD; the principal's
 * email gets all scopes) or a bearer from CLIENTS = {"<token>":{"client":"hermes","scopes":["read","ask"]}}.
 */

import { accessJwt, err, json, safeEqual } from "../../../shared/edge";

type Scope = "read" | "ask" | "act";
interface Env {
  LOCKBOX: KVNamespace;
  CLIENTS: string;
  PRINCIPAL_EMAIL?: string;
  ACCESS_TEAM?: string;
  ACCESS_AUD?: string;
  RELAY_URL?: string;              // https://relay.<domain> (Cloudflare Tunnel → 127.0.0.1:31338)
  RELAY_ACCESS_ID?: string;        // Access service token for the tunnel
  RELAY_ACCESS_SECRET?: string;
  RELAY_SECRET?: string;           // shared secret Relay.ts checks
  CONFIRM_WEBHOOK?: string;        // e.g. https://ntfy.sh/<private-topic>
  BUNKER: Fetcher;                 // service binding → lifeos-bunker-health
  ROUTER: Fetcher;                 // service binding → lifeos-router-edge
  ROUTER_TOKEN?: string;
}
interface Caller { client: string; scopes: Scope[] }

const SERVER = { name: "lifeos-lockbox", version: "1.0.0" };
const PROTOCOL = "2025-06-18";

async function identify(req: Request, env: Env): Promise<Caller | null> {
  const email = await accessJwt(req, env.ACCESS_TEAM, env.ACCESS_AUD);
  if (email && env.PRINCIPAL_EMAIL && email.toLowerCase() === env.PRINCIPAL_EMAIL.toLowerCase()) return { client: "principal", scopes: ["read", "ask", "act"] };
  const h = req.headers.get("authorization") ?? "";
  if (!h.startsWith("Bearer ")) return null;
  let clients: Record<string, Caller> = {};
  try { clients = JSON.parse(env.CLIENTS); } catch { return null; }
  for (const [tok, c] of Object.entries(clients)) if (safeEqual(tok, h.slice(7))) return c;
  return null;
}

// ── tools ───────────────────────────────────────────────────────────────────
interface Tool { name: string; scope: Scope; description: string; inputSchema: object; run: (args: any, env: Env, who: Caller) => Promise<unknown> }

const ACTIONS = ["errata.capture", "socrates.run", "bunker.test", "achilles.due"] as const;

async function relay(env: Env, path: string, body: unknown): Promise<Response> {
  return fetch(`${env.RELAY_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-access-client-id": env.RELAY_ACCESS_ID ?? "",
      "cf-access-client-secret": env.RELAY_ACCESS_SECRET ?? "",
      "x-lockbox-secret": env.RELAY_SECRET ?? "",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(150_000),
  });
}

const TOOLS: Tool[] = [
  {
    name: "lifeos.snapshot", scope: "read",
    description: "Curated LifeOS snapshot the laptop publishes (telos summary, current work, upcoming). Pass a section name.",
    inputSchema: { type: "object", properties: { section: { type: "string", enum: ["telos", "work", "upcoming", "health-trends"] } }, required: ["section"] },
    run: async (a, env) => (await env.LOCKBOX.get(`snapshot:${a.section}`, "json")) ?? { missing: `no ${a.section} snapshot published yet` },
  },
  {
    name: "bunker.status", scope: "read",
    description: "Bunker summary: bays, ISA probes, security flags, uptime.",
    inputSchema: { type: "object", properties: {} },
    run: async (_a, env) => (await env.BUNKER.fetch("https://bunker/status")).json(),
  },
  {
    name: "router.route", scope: "read",
    description: "Which LifeOS lane (model/agent/effort/strategy) the Router would pick for a prompt.",
    inputSchema: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] },
    run: async (a, env, who) => (await env.ROUTER.fetch("https://router/route", { method: "POST", headers: { authorization: `Bearer ${env.ROUTER_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ prompt: a.prompt, client: `lockbox:${who.client}` }) })).json(),
  },
  {
    name: "da.ask", scope: "ask",
    description: "Ask the principal's Digital Assistant a question. Answered on the principal's machine; queued if it is offline.",
    inputSchema: { type: "object", properties: { question: { type: "string", maxLength: 4000 } }, required: ["question"] },
    run: async (a, env, who) => {
      if (env.RELAY_URL) {
        try {
          const r = await relay(env, "/da/ask", { question: a.question, client: who.client });
          if (r.ok) return r.json();
        } catch { /* laptop asleep — queue */ }
      }
      const id = crypto.randomUUID();
      await env.LOCKBOX.put(`ask:${id}`, JSON.stringify({ question: a.question, client: who.client, at: new Date().toISOString() }), { expirationTtl: 7 * 86400 });
      return { queued: id, note: "The assistant is offline; the question is queued and will be answered when it reconnects." };
    },
  },
  {
    name: "act.request", scope: "act",
    description: `Request an action (${ACTIONS.join(", ")}). Nothing runs until the principal confirms out-of-band.`,
    inputSchema: { type: "object", properties: { action: { type: "string", enum: [...ACTIONS] }, args: { type: "object" } }, required: ["action"] },
    run: async (a, env, who) => {
      if (!(ACTIONS as readonly string[]).includes(a.action)) throw new Error("action not allowlisted");
      const id = crypto.randomUUID().slice(0, 8);
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
      await env.LOCKBOX.put(`act:${id}`, JSON.stringify({ action: a.action, args: a.args ?? {}, client: who.client, code }), { expirationTtl: 600 });
      if (env.CONFIRM_WEBHOOK) await fetch(env.CONFIRM_WEBHOOK, { method: "POST", body: `Lockbox: ${who.client} wants ${a.action}. Code ${code} (request ${id}, 10 min).` });
      return { pending: id, expiresIn: 600, note: "The principal received a confirmation code. Call act.confirm with it." };
    },
  },
  {
    name: "act.confirm", scope: "act",
    description: "Confirm a pending action with the code the principal received.",
    inputSchema: { type: "object", properties: { pending: { type: "string" }, code: { type: "string" } }, required: ["pending", "code"] },
    run: async (a, env, who) => {
      const p = await env.LOCKBOX.get<{ action: string; args: object; client: string; code: string }>(`act:${a.pending}`, "json");
      if (!p || p.client !== who.client) throw new Error("no such pending action");
      await env.LOCKBOX.delete(`act:${a.pending}`); // single use, right or wrong
      if (!safeEqual(String(a.code), p.code)) throw new Error("wrong code — request again");
      if (!env.RELAY_URL) throw new Error("relay not configured");
      const r = await relay(env, "/da/act", { action: p.action, args: p.args, client: who.client });
      return r.json();
    },
  },
];

// ── JSON-RPC ────────────────────────────────────────────────────────────────
const rpc = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcErr = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

async function handle(msg: any, env: Env, who: Caller) {
  const visible = TOOLS.filter((t) => who.scopes.includes(t.scope));
  switch (msg.method) {
    case "initialize": return rpc(msg.id, { protocolVersion: PROTOCOL, serverInfo: SERVER, capabilities: { tools: { listChanged: false } } });
    case "ping": return rpc(msg.id, {});
    case "tools/list": return rpc(msg.id, { tools: visible.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const t = visible.find((x) => x.name === msg.params?.name);
      if (!t) return rpcErr(msg.id, -32602, "unknown tool or scope not granted");
      try {
        const out = await t.run(msg.params?.arguments ?? {}, env, who);
        return rpc(msg.id, { content: [{ type: "text", text: JSON.stringify(out) }] });
      } catch (e) {
        return rpc(msg.id, { isError: true, content: [{ type: "text", text: String((e as Error).message ?? e) }] });
      }
    }
    default:
      return msg.id === undefined ? null : rpcErr(msg.id, -32601, "method not found");
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== "/mcp") return err(404, "not found");
    if (req.method !== "POST") return err(405, "POST JSON-RPC to /mcp");
    const who = await identify(req, env);
    if (!who) return err(401, "unauthorized");
    const body = await req.json().catch(() => null);
    if (!body) return json(rpcErr(null, -32700, "parse error"), 400);
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map((m) => handle(m, env, who)))).filter(Boolean);
      return out.length ? json(out) : new Response(null, { status: 202 });
    }
    const out = await handle(body, env, who);
    return out ? json(out) : new Response(null, { status: 202 });
  },
} satisfies ExportedHandler<Env>;
