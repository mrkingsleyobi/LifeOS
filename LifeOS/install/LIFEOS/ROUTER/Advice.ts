/**
 * Advice — the one line the hook injects into the session in `advise` mode. Pure.
 * Built only from fixed strings, our own enums and numbers: nothing from the user's prompt is echoed back,
 * so the advice cannot carry injected text. It is advice, not a rule: the session keeps its judgment.
 */
import { LANES, laneModel } from "../TOOLS/models";
import type { Decision } from "./Policy";

const OPENAI_GOOGLE_XAI = "Astra, Sol, Terra, Luna, Helios, Gemini, Grok";

export function advice(d: Decision): string {
  if (d.private) {
    return `ROUTER (advisory): sensitive content detected (${d.reason}). Keep ALL work on the Anthropic session model; do not dispatch ${OPENAI_GOOGLE_XAI}, and do not send this to any third-party tool.`;
  }
  if (d.inline) return "ROUTER (advisory): light work; handle it inline in this session, no dispatch needed.";
  const lane = LANES[d.lane];
  const agent = lane?.agent ?? d.lane;
  const fb = d.fallback.length ? ` Fallback: ${d.fallback.join(" > ")}.` : "";
  const extra = d.lane === "cyber" ? " Helios requires authorization context (pentest scope, CTF, or defensive work); without it, stay on Anthropic models." : "";
  const fusion = d.fusion ? " This is audit-grade: also get a second opinion from the other top lane." : "";
  return `ROUTER (advisory): ${d.reason}, effort ${d.effort}. Work you delegate fits Agent(${agent}) (${laneModel(d.lane)}).${fb}${extra}${fusion} The main-loop model is unchanged and this is advice, not a rule: use judgment.`;
}
