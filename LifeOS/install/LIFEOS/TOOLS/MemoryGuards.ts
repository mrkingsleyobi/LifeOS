/**
 * Shared guards for the memory tools (TelosReviewer, WisdomMonthly, Recall): credential scrubbing, prompt-wrapper
 * sanitizing, and sampling a file's most relevant slice. One copy, so a fix lands everywhere at once.
 */

const PEM = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g;
const NAMED = /(["']?[\w.-]*(?:api[_-]?key|apikey|access[_-]?key|token|secret|passw(?:or)?d|authorization|credential)[\w.-]*["']?)\s*[:=]\s*("[^"\n]*"|'[^'\n]*'|\S+)/gi;

/** Credential-shaped strings never leave the machine, even inside a private-lane prompt. Conservative: it over-redacts rather than leaks. */
export function scrub(s: string): string {
  return s
    .replace(PEM, "[REDACTED]")
    .replace(/\b(sk|rk|pk)[-_][A-Za-z0-9_-]{16,}/g, "[REDACTED]")        // OpenAI/Anthropic/Stripe (sk-..., sk_live_...)
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "[REDACTED]")
    .replace(/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "[REDACTED]")             // Slack
    .replace(/\bAIza[0-9A-Za-z_-]{30,}/g, "[REDACTED]")                   // Google API keys
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]")
    .replace(/https:\/\/discord(?:app)?\.com\/api\/webhooks\/\S+/g, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, "Bearer [REDACTED]")
    .replace(NAMED, "$1=[REDACTED]");                                      // any key/token/secret/password assignment, JSON or env style, any case
}

/** Remove the prompt-wrapper tags from untrusted text. Loops until stable: one pass turns `<</evidence>/evidence>` into `</evidence>`. */
export function stripTags(s: string, names: string[]): string {
  const re = new RegExp(`<\\s*/?\\s*(${names.join("|")})\\s*>`, "gi");
  for (let prev = ""; prev !== s; ) { prev = s; s = s.replace(re, ""); }
  return s;
}

/**
 * The slice of a file to show the model. Append-only logs (.jsonl) are sampled from the END, where the recent entries are;
 * everything else from the start. The first line of a tail is dropped because it is usually cut in half.
 */
export function sample(text: string, max: number, path: string): string {
  if (text.length <= max) return text;
  if (!/\.jsonl?$/.test(path)) return text.slice(0, max);
  const tail = text.slice(-max), nl = tail.indexOf("\n");
  return nl >= 0 ? tail.slice(nl + 1) : tail;
}
