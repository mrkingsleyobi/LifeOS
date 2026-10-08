/**
 * arbol-a-feed-route — the `A_FEED_ROUTE` action from the Feed design: rated items in, routing
 * decisions out. It DECIDES; it does not deliver. Discord/email/blog/social delivery stays with the
 * dispatcher that consumes these decisions.
 *
 *   POST /route  Authorization: Bearer $FEED_TOKEN   { "items": [ { id, tier?, quality_score?, importance?, urgency?, labels? } ] }
 *   GET  /healthz
 */
import rules from "../rules.json";
import { authorized, json, readJson } from "../../_shared/arbol";
import { route, validItem, type RuleSet } from "./rules";

export interface Env { FEED_TOKEN: string }
const MAX_BODY = 256 * 1024, MAX_ITEMS = 200;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (req.method === "GET" && pathname === "/healthz") return json({ ok: true, rules: (rules as RuleSet).rules.length });
    if (req.method !== "POST" || pathname !== "/route") return json({ error: "not found" }, 404);
    if (!authorized(req, env.FEED_TOKEN)) return json({ error: "unauthorized" }, 401);

    const body = await readJson(req, MAX_BODY);
    if (body instanceof Response) return body;
    const items = body.items;
    if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) return json({ error: `items: 1-${MAX_ITEMS} required` }, 400);
    if (!items.every(validItem)) return json({ error: "invalid item (id required; scores must be numbers; labels strings)" }, 400);
    return json({ routes: items.map((i) => route(i, rules as RuleSet)) });
  },
};
