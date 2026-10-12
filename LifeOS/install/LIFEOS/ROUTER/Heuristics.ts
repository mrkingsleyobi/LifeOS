/**
 * HEURISTICS — the no-network fallback that answers the lane questions when
 * Jev times out, has no key, is over budget, or returns an incomplete answer.
 *
 * It produces the SAME Signals vector Jev would, so FrontDoor's scorer never
 * branches on source. Probabilities are coarse on purpose (0.1 / 0.5 / 0.85):
 * keyword evidence is weak evidence, and the router's ledger marks these rows
 * source:"fallback" so they're never mistaken for measured judgments.
 */

import type { Signals, Domain } from "./LaneQuestions";

const LO = 0.1, MID = 0.5, HI = 0.85;
const has = (re: RegExp, s: string) => re.test(s);
const p = (re: RegExp, s: string, hit = HI, miss = LO) => (has(re, s) ? hit : miss);

/** Sensitive personal-data shapes beyond the credential patterns egress-class-core already owns. */
export const SENSITIVE_SHAPES: RegExp[] = [
  /\b\d{3}-\d{2}-\d{4}\b/,                                  // US SSN
  /\b(?:\d[ -]?){13,19}\b/,                                 // card / account numbers
  /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/,                       // IBAN
  /\b(?:passport|driver'?s licen[cs]e|national insurance|NHS number)\b/i,
  /\b(?:diagnos(?:is|ed)|prescription|medical record|lab results|therapy notes|HIPAA)\b/i,
  /\b(?:salary|payslip|tax return|bank statement|net worth|brokerage)\b/i,
  /\b(?:my (?:wife|husband|partner|kid|son|daughter|mother|father)'?s?)\b/i,
  /\b(?:customer list|client data|PII|personal data|confidential)\b/i,
];

export function heuristicSignals(prompt: string, prevTail = ""): Signals {
  const s = prompt.toLowerCase();
  const words = s.split(/\s+/).filter(Boolean).length;
  const short = words <= 6;

  const build = p(/\b(build|implement|add|create|write|fix|refactor|code|script|deploy|migrate|update|generate|scaffold|wire|hook)\b/, s);
  const exhaustive = p(/\b(every|all (?:the )?(?:instances|occurrences|files|places)|exhaustive|across the (?:repo|codebase|corpus)|find all|audit all|sweep|needle)\b/, s);
  const risky = p(/\b(deploy|prod(?:uction)?|secret|credential|auth|password|token|migration|drop table|rm -rf|force push|delete)\b/, s);
  const review = p(/\b(review|audit|critique|second opinion|sanity check|look over|evaluate)\b/, s);
  const bulk = p(/\b(sds|safety data sheets?|jds?|job descriptions?|batch|bulk|hundreds|thousands|spreadsheet|csv|each of (?:these|the)|all \d+|records)\b/, s);
  const scriptable = Math.max(bulk === HI ? MID : LO, p(/\b(rename|reformat|convert|extract|list|count|sort|dedupe|regex|template)\b/, s, MID));
  const decided = p(/\b(just|simply|exactly|as (?:discussed|planned)|per the plan|go ahead|do it)\b/, s, MID);
  const reasoning = p(/\b(why|how (?:should|would|do)|design|architect|plan|strategy|trade-?offs?|reason|prove|analy[sz]e|debug|root cause|figure out)\b/, s);
  const judgment = p(/\b(should (?:i|we)|best|recommend|taste|opinion|strategy|prioriti[sz]e|decide|choose|which (?:one|option)|positioning|thesis|design|architect(?:ure)?|approach)\b/, s);
  const expertHard = Math.max(reasoning === HI && judgment === HI ? HI : reasoning === HI ? MID : LO, p(/\b(novel|research-grade|frontier|unsolved|cryptograph|distributed|concurrency|multi-tenant|race condition|formal|theorem)\b/, s));

  const breadth = Math.max(bulk, exhaustive === HI ? MID : LO);
  const costlyError = Math.max(risky, p(/\b(legal|contract|financial|medical|security|compliance|irreversible|public release|billing|payments?|invoices?|charg(?:e|es|ing)|money|data loss)\b/, s));
  const weighMany = Math.max(judgment === HI && reasoning === HI ? HI : LO, p(/\b(trade-?offs?|considerations|pros and cons|holistic|end-to-end|whole system)\b/, s));
  const quickOnce = short ? HI : p(/\b(quick|simple|small|tiny|one-liner|just)\b/, s, MID);
  const askDepth = p(/\b(think (?:deeply|hard|carefully)|ultrathink|rigorous|thorough|deep dive|in depth|step by step|first principles)\b/, s);

  const bareReaction = p(/^(?:ok(?:ay)?|thanks?|thank you|nice|great|cool|perfect|lgtm|👍|yes|no|sure|got it)[.! ]*$/i, prompt.trim(), 0.95, 0.05);
  const approves = prevTail && p(/^(?:yes|yep|go|go ahead|do it|approved?|ship it|sounds good|proceed)\b/i, prompt.trim(), HI) === HI ? HI : LO;
  const corrects = p(/^(?:no[,.]|not quite|that'?s wrong|actually|instead)/i, prompt.trim(), HI);
  const newRequest = prevTail ? (approves === HI || corrects === HI ? LO : MID) : HI;

  const longOutput = Math.max(bulk === HI ? MID : LO, p(/\b(full|complete|entire|comprehensive|all files|whole (?:app|system|doc))\b/, s, MID));
  const sensitive = SENSITIVE_SHAPES.some((re) => re.test(prompt)) ? HI : LO;

  let domain: Domain = "general";
  if (has(/\b(pentest|exploit|cve-\d|vuln(?:erability)?|xss|sqli|rce|recon|red team|threat hunt|malware|payload|bug bounty|burp)\b/, s)) domain = "security";
  else if (has(/\b(tweet|x\.com|twitter|viral|meme|trending|on x\b)/, s)) domain = "public_culture";
  else if (has(/\b(research|sources?|cite|citations|latest news|what'?s new in|survey of)\b/, s)) domain = "grounded_research";

  return {
    build, exhaustive, risky, review, scriptable, decided, reasoning, judgment, expertHard,
    breadth, costlyError, weighMany, quickOnce, askDepth,
    approves, bareReaction, corrects, newRequest,
    bulk, longOutput, sensitive,
    domain, domainP: domain === "general" ? MID : HI,
  };
}
