/**
 * isa-meta — the ISA fields and sections Pulse surfaces as badges, strips and panels
 * (DOCUMENTATION/Pulse/PulseMetadata.md): principal_stated_goal, density_score / divergence_risk,
 * current_state / ideal_state, capabilities_invoked, and the ## Decisions / ## Verification sections.
 *
 * Pure and tolerant: every field is optional, an older ISA that lacks them yields an empty meta, and nothing
 * here throws. The text is untrusted (an ISA can quote web pages), so every string is single-line, length-capped
 * and stripped of control characters before it is stored; React escapes it again on render.
 *
 * Format source: DOCUMENTATION/ISA/ISAFormat.md (frontmatter fields, ## Decisions, ## Verification).
 */

export type Risk = "low" | "medium" | "high";
export type Verdict = "pass" | "concerns" | "fail";

export interface IsaMeta {
  goal?: string;
  densityScore?: number;      // 0..1
  divergenceRisk?: Risk;
  currentState?: string;
  idealState?: string;
  capabilities?: string[];    // capabilities_invoked, in order, de-duplicated
  /** Forge audit verdict parsed from ## Verification. INFERRED: the spec says only that it is "recorded in ## Verification". */
  auditVerdict?: Verdict;
  decisions?: { text: string; dead?: boolean; refined?: boolean }[];   // newest last, capped
  decisionCount?: number;
  verification?: string[];    // one-line provenance stubs, capped
  verificationCount?: number;
}

// Keep these caps in step with Observability/src/lib/isa-meta.ts (sanitizeMeta), which re-applies them on the UI side.
const CAPS = { line: 400, short: 200, cap: 40, capName: 60, decisions: 8, verification: 12 };

/** One line, no control characters, capped. */
export function oneLine(s: unknown, max: number): string {
  return String(s ?? "").replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function frontmatterBlock(content: string): string | null {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : null;
}

function scalar(block: string, key: string): string | undefined {
  const m = block.match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"));
  if (!m) return undefined;
  let v = m[1].trim();
  if (/^[>|][+-]?\d*$/.test(v)) {                       // block scalar: `>` folded or `|` literal; the text is the indented lines below
    const rest = block.slice((m.index ?? 0) + m[0].length).split(/\r?\n/).slice(1);
    const body: string[] = [];
    for (const l of rest) { if (l.trim() === "" ) { body.push(""); continue; } if (!/^[ \t]+/.test(l)) break; body.push(l.trim()); }
    v = (v.startsWith(">") ? body.join(" ") : body.join("\n")).trim();
  } else if (v[0] === '"') {                            // double-quoted: honour backslash escapes
    let out = "", i = 1;
    for (; i < v.length && v[i] !== '"'; i++) {
      if (v[i] === "\\" && i + 1 < v.length) { i++; out += v[i] === "n" ? " " : v[i] === "t" ? " " : v[i]; } else out += v[i];
    }
    v = out;
  } else if (v[0] === "'") {                            // single-quoted: '' is a literal quote
    let out = "", i = 1;
    for (; i < v.length; i++) { if (v[i] === "'") { if (v[i + 1] === "'") { out += "'"; i++; } else break; } else out += v[i]; }
    v = out;
  } else v = v.replace(/\s+#.*$/, "");                  // plain scalar: strip a trailing comment
  return v === "" || v === "null" || v === "~" ? undefined : v;
}

/** A YAML list under `key:` — block form (`- a`) or inline form (`[a, b]`). */
function list(block: string, key: string): string[] {
  const inline = block.match(new RegExp(`^${key}:[ \\t]*\\[(.*?)\\]`, "m"));
  if (inline) return inline[1].split(",").map(x => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  const m = block.match(new RegExp(`^${key}:[ \\t]*\\r?\\n((?:[ \\t]*-[^\\n]*\\r?\\n?)+)`, "m"));
  if (!m) return [];
  return m[1].split(/\r?\n/).map(l => l.replace(/^[ \t]*-[ \t]*/, "").replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

/** Fenced code blocks are quoted material, not structure: a `## Decisions` inside one must not be read as the real section. */
const stripFences = (s: string) => s.replace(/^(```|~~~)[^\n]*\n[\s\S]*?(?:^\1[ \t]*$|(?![\s\S]))/gm, "");

/** Body of an H2 section (`## Name`), up to the next H2 or EOF. */
function section(content: string, name: string): string | null {
  const m = stripFences(content).match(new RegExp(`^##[ \\t]+${name}[ \\t]*\\r?\\n([\\s\\S]*?)(?=^##[ \\t]|(?![\\s\\S]))`, "mi"));
  return m ? m[1] : null;
}

/** Top-level bullets only: an indented sub-bullet continues the entry above it, it is not a new entry. */
const bullets = (body: string) => body.split(/\r?\n/).filter(l => /^[-*]\s+\S/.test(l)).map(l => l.replace(/^[-*]\s+/, ""));

export function parseVerdict(lines: string[]): Verdict | undefined {
  // Last audit line wins (a re-audit supersedes an earlier one). Only the text AFTER the word "audit" counts, split into
  // clauses; a verdict word negated by "no/zero/0/without" ("no concerns") is not a verdict, and an unfinished audit has none.
  for (const l of [...lines].reverse()) {
    const at = l.search(/\baudit\b/i);
    if (at < 0 || /\b(pending|in progress|not (?:yet )?run|todo|tbd)\b/i.test(l)) continue;
    for (const clause of l.slice(at + 5).split(/[;,]/)) {
      for (const m of clause.matchAll(/\b(pass(?:ed)?|concerns?|fail(?:ed)?)\b/gi)) {
        if (/(?:\bno|\bzero|\bwithout|\b0|\bnot)\s+$/i.test(clause.slice(0, m.index))) continue;
        const w = m[1].toLowerCase();
        return w.startsWith("pass") ? "pass" : w.startsWith("concern") ? "concerns" : "fail";
      }
    }
  }
  return undefined;
}

export function extractIsaMeta(content: string): IsaMeta {
  const meta: IsaMeta = {};
  if (typeof content !== "string" || !content) return meta;
  try {
    const fm = frontmatterBlock(content);
    if (fm) {
      const goal = scalar(fm, "principal_stated_goal"); if (goal) meta.goal = oneLine(goal, CAPS.line);
      const ds = scalar(fm, "density_score"); if (ds !== undefined && Number.isFinite(Number(ds))) meta.densityScore = Math.max(0, Math.min(1, Number(ds)));
      const dr = scalar(fm, "divergence_risk")?.toLowerCase(); if (dr === "low" || dr === "medium" || dr === "high") meta.divergenceRisk = dr;
      const cs = scalar(fm, "current_state"); if (cs) meta.currentState = oneLine(cs, CAPS.short);
      const is = scalar(fm, "ideal_state"); if (is) meta.idealState = oneLine(is, CAPS.short);
      const caps = [...new Set(list(fm, "capabilities_invoked").map(c => oneLine(c, CAPS.capName)).filter(Boolean))].slice(0, CAPS.cap);
      if (caps.length) meta.capabilities = caps;
    }
    const dec = section(content, "Decisions");
    if (dec) {
      const all = bullets(dec);
      meta.decisionCount = all.length;
      meta.decisions = all.slice(-CAPS.decisions).map(t => ({
        text: oneLine(t, CAPS.line),
        ...(/DEAD END|❌/.test(t) ? { dead: true } : {}),
        ...(/\brefined:/i.test(t) ? { refined: true } : {}),
      }));
    }
    const ver = section(content, "Verification");
    if (ver) {
      const all = bullets(ver);
      meta.verificationCount = all.length;
      meta.verification = all.slice(-CAPS.verification).map(l => oneLine(l, CAPS.line));
      const v = parseVerdict(all); if (v) meta.auditVerdict = v;
    }
  } catch { /* tolerant by contract: a malformed ISA yields whatever was parsed so far */ }
  return meta;
}

/** True when there is anything worth carrying on the work.json row. */
export const hasMeta = (m: IsaMeta) => Object.keys(m).length > 0;
