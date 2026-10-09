/**
 * LANE QUESTIONS — what the Router asks Jev about every prompt, in ONE call.
 *
 * The first eighteen mirror Glance's published design (nine about the work,
 * five about effort, four about the previous reply). The router adds the
 * axes this install routes on: token volume, data sensitivity (the Private
 * Pinned Lane gate), and a domain choice for the specialist lanes.
 *
 * Instructions reference state fields in backticks, per the Jev convention:
 * state = { prompt, previous_reply_tail }.
 *
 * Every question here is billable input on every prompt. Add one only when a
 * scorer weight in FrontDoor.ts reads it.
 */

import type { NoulQ, ChoiceQ } from "../DECISIONS/JevTypes";

const n = (instructions: string): NoulQ => ({ type: "noul", instructions });

export const WORK = {
  build: n("Does `prompt` ask to build, change, fix, or write code or files?"),
  exhaustive: n("Does `prompt` require finding every instance of something across a large corpus, or exhaustive coverage?"),
  risky: n("Does `prompt` touch deploys, secrets, authentication, data migrations, or irreplaceable data?"),
  review: n("Does `prompt` ask to review, audit, critique, or give a second opinion on existing work?"),
  scriptable: n("Could the task in `prompt` be done by a careful deterministic script with no judgment?"),
  decided: n("Is the approach for `prompt` already decided, leaving only execution?"),
  reasoning: n("Does `prompt` require real multi-step reasoning to answer well?"),
  judgment: n("Does `prompt` center on judgment, taste, strategy, or design trade-offs?"),
  expertHard: n("Would `prompt` be hard for a senior domain expert?"),
} as const;

export const EFFORT = {
  breadth: n("Is the work in `prompt` mostly breadth (many similar items) rather than depth?"),
  costlyError: n("Would a subtle error in the answer to `prompt` be costly?"),
  weighMany: n("Must many considerations be weighed together to answer `prompt`?"),
  quickOnce: n("Could `prompt` be done quickly once it is understood?"),
  askDepth: n("Does `prompt` explicitly ask for depth, rigor, or careful thinking?"),
} as const;

export const THREAD = {
  approves: n("Is `prompt` approving or accepting a proposal made in `previous_reply_tail`?"),
  bareReaction: n("Is `prompt` only a bare reaction or acknowledgement (thanks, ok, nice) with no new request?"),
  corrects: n("Does `prompt` correct or push back on `previous_reply_tail`?"),
  newRequest: n("Is `prompt` a new request unrelated to `previous_reply_tail`?"),
} as const;

export const ROUTER = {
  bulk: n("Does `prompt` involve processing many documents or a large volume of text, such as batches of SDS sheets, job descriptions, or records?"),
  longOutput: n("Will a good answer to `prompt` require a long output (thousands of words or many files)?"),
  sensitive: n("Does `prompt` contain or ask to process personal, medical, financial, legal, customer, or otherwise private data about real people or businesses?"),
} as const;

export const DOMAIN: { domain: ChoiceQ } = {
  domain: {
    type: "choice",
    instructions: "Which specialist area does `prompt` belong to?",
    criteria: {
      general: "General work — none of the specialist areas below",
      security: "Offensive or defensive security: pentesting, exploits, vulnerability analysis, threat hunting",
      public_culture: "Public social media, X/Twitter, memes, or very current public events",
      grounded_research: "Research on public topics that benefits from cited web sources",
    },
  },
};

export const QUESTIONS = { ...WORK, ...EFFORT, ...THREAD, ...ROUTER, ...DOMAIN };
export type QuestionId = keyof typeof QUESTIONS;
export type NoulId = Exclude<QuestionId, "domain">;
export type Domain = "general" | "security" | "public_culture" | "grounded_research";

/** The probability vector the scorer reads — from Jev, or from the heuristic fallback. */
export type Signals = Record<NoulId, number> & { domain: Domain; domainP: number };
