/**
 * arbol-a-synapse-capture — one HTTP door into Synapse for inputs that cannot write the local
 * ledger: reader upvote (#9), gesture/wearable trigger (#10), and any webhook (Shortcuts, Zapier).
 * Email capture (#11) is the `email()` handler below; see email.ts for its policy and README for setup.
 *
 *   POST /capture  Authorization: Bearer $CAPTURE_TOKEN   <capture contract JSON>
 *   GET  /healthz
 *
 * Contract behavior: write-ahead (INSERT before anything else), idempotent (dedup key),
 * async downstream (queue send via waitUntil, never on the capture path), privacy-gated
 * (`personal` is refused — no explicit cloud rule exists, so it stays local).
 */
import { authorized, json, readJson } from "../../_shared/arbol";
import { validate } from "./contract";
import { handleEmail, type EmailEnv, type EmailMessage } from "./email";
import { ingest, type Ctx } from "./ingest";

export interface Env extends EmailEnv { CAPTURE_TOKEN: string }

const MAX_BODY = 256 * 1024;

export default {
  async fetch(req: Request, env: Env, ctx: Ctx): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (req.method === "GET" && pathname === "/healthz") return json({ ok: true });
    if (req.method !== "POST" || pathname !== "/capture") return json({ error: "not found" }, 404);
    if (!authorized(req, env.CAPTURE_TOKEN)) return json({ error: "unauthorized" }, 401);

    const body = await readJson(req, MAX_BODY);
    if (body instanceof Response) return body;
    const v = validate(body);
    if (!v.ok) return json({ error: v.error }, 400);
    const c = v.capture;
    if (c.privacy_class === "personal") {
      return json({ error: "personal records are not accepted by the cloud ledger; keep them local" }, 403);
    }

    const { id, duplicate } = await ingest(env, ctx, c);
    return json({ id, duplicate }, duplicate ? 200 : 201);
  },

  /** Email Routing entry point (input #11). See email.ts for the policy. */
  async email(message: EmailMessage, env: Env, ctx: Ctx): Promise<void> {
    await handleEmail(message, env, ctx);
  },
};
