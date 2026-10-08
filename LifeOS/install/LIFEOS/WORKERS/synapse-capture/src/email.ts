/**
 * Email capture (Synapse input #11). Forward a message to the capture address and it is journaled.
 *
 * POLICY — read this: a `personal` record never reaches the cloud ledger without an explicit rule.
 * Email is personal by nature, so this handler IS the explicit rule, and only in a narrow form:
 *   - the capture address is a deliberate act (you forwarded it on purpose),
 *   - the envelope sender must be on ALLOWED_SENDERS (unset = reject everything, fail closed),
 *   - only the subject and the first MAX_TEXT chars of the body are kept; attachments are dropped,
 *   - the record is stored as `public` because the ledger refuses anything else.
 * If you do not want email bodies in D1, do not deploy the email route.
 *
 * Spoofing: the envelope sender alone is forgeable. The real gate is an unguessable capture
 * address (Email Routing rule). REQUIRE_AUTH_RESULTS=true additionally demands a dkim/dmarc "pass"
 * in Authentication-Results; it is off by default because this repo has not verified that Cloudflare
 * always adds that header, and turning it on blindly would reject everything.
 */
import PostalMime from "postal-mime";
import { validate } from "./contract";
import { ingest, type Ctx, type IngestEnv } from "./ingest";

export interface EmailEnv extends IngestEnv { ALLOWED_SENDERS?: string; REQUIRE_AUTH_RESULTS?: string }
export interface EmailMessage {
  readonly from: string;
  readonly to: string;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
  readonly headers: Headers;
  setReject(reason: string): void;
}

export const MAX_RAW = 512 * 1024;
export const MAX_TEXT = 20_000;

/** Entries are full addresses ("me@x.com") or domains ("@x.com"). Unset/empty allows nobody. */
export function senderAllowed(from: string, list: string | undefined): boolean {
  const f = from.trim().toLowerCase();
  const entries = (list ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return entries.some((e) => (e.startsWith("@") ? f.endsWith(e) : f === e));
}

const htmlToText = (h: string) =>
  h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();

export async function handleEmail(message: EmailMessage, env: EmailEnv, ctx: Ctx): Promise<void> {
  if (!senderAllowed(message.from, env.ALLOWED_SENDERS)) return message.setReject("sender not allowed");
  if (env.REQUIRE_AUTH_RESULTS === "true" && !/\b(dmarc|dkim)=pass\b/i.test(message.headers.get("authentication-results") ?? "")) {
    return message.setReject("sender authentication failed");
  }
  if (message.rawSize > MAX_RAW) return message.setReject("message too large");

  let parsed;
  try { parsed = await PostalMime.parse(message.raw); } catch { return message.setReject("unparseable message"); }

  const subject = (parsed.subject ?? "").trim();
  const body = (parsed.text?.trim() || (parsed.html ? htmlToText(parsed.html) : "")).slice(0, MAX_TEXT);
  const content = [subject, body].filter(Boolean).join("\n\n");
  const link = body.match(/https?:\/\/[^\s<>"')\]]+/)?.[0];

  const v = validate({
    source: "email",
    external_id: parsed.messageId?.trim() || `${message.from}|${parsed.date ?? subject}`,
    url: link,
    content: content || undefined,
    content_kind: link ? "article" : "note",
    title: subject || undefined,
    author: message.from,
    privacy_class: "public", // the explicit rule — see header
    captured_at: Number.isFinite(Date.parse(parsed.date ?? "")) ? new Date(parsed.date!).toISOString() : undefined, // a bad Date header must not throw
  });
  // A URL we cannot normalize (e.g. malformed) should not sink the capture: retry as note-only.
  const v2 = v.ok || !link ? v : validate({ source: "email", external_id: parsed.messageId?.trim() || `${message.from}|${subject}`, content, content_kind: "note", title: subject || undefined, author: message.from, privacy_class: "public" });
  if (!v2.ok) return message.setReject(`not capturable: ${v2.error}`);
  await ingest(env, ctx, v2.capture);
}
