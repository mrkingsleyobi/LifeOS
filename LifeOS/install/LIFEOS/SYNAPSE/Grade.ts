/**
 * SYNAPSE GRADE — the common grade shape, pure (no I/O). Shared by the
 * amber-ledger Worker (cloud grading of public captures) and the local amber
 * CLI (grading of personal captures through the private lane or Jev).
 *
 * "Not 'is this good?' but 'is this good for what the principal is doing?'"
 * One Jev call per capture: a 5-level TELOS-relevance score + a 10-way route
 * choice + a content-kind choice. The route only fires when the score clears
 * the bar; preservation never depends on it.
 */

import type { ChoiceQ, ScoreQ } from "../DECISIONS/JevTypes";

export const GRADE_VERSION = "synapse-grade-1";
export const ROUTE_THRESHOLD = 60;

export const ROUTES = [
  "knowledge", "learning", "help_understand", "project_integration", "tech_upgrade",
  "telos_modification", "work_item", "reminder", "blog_seed", "none",
] as const;
export type Route = (typeof ROUTES)[number];

/** Route → the routed_actions the ledger records (and the CLI executes). */
export const ROUTE_ACTIONS: Record<Route, string[]> = {
  knowledge: ["knowledge_note"],
  learning: ["knowledge_note"],
  help_understand: ["knowledge_note"],
  project_integration: ["work_issue:project", "knowledge_note"],
  tech_upgrade: ["upgrade"],
  telos_modification: ["telos_proposal"],
  work_item: ["work_issue:queue"],
  reminder: ["reminder"],
  blog_seed: ["blog_seed", "knowledge_note"],
  none: [],
};

export function gradeQuestions(telosSummary: string): { relevance: ScoreQ; route: ChoiceQ; kind: ChoiceQ } {
  const ctx = telosSummary ? `The principal's mission, goals and current projects:\n${telosSummary.slice(0, 6000)}\n\n` : "";
  return {
    relevance: {
      type: "score",
      instructions: `${ctx}How useful is \`content\` for what the principal is trying to do right now?`,
      criteria: [
        "Irrelevant or noise",
        "Mildly interesting, no connection to current goals",
        "Related to a goal or interest",
        "Directly useful to an active project or goal",
        "Changes how the principal should act on a goal",
      ],
    },
    route: {
      type: "choice",
      instructions: `${ctx}Where does \`content\` belong?`,
      criteria: {
        knowledge: "A durable idea or fact worth keeping as a knowledge note",
        learning: "Something the principal is learning; study material",
        help_understand: "Explains something the principal is confused about",
        project_integration: "Should be built into or change an active project",
        tech_upgrade: "Improves the principal's AI/LifeOS system or tooling",
        telos_modification: "Suggests changing the principal's goals, mission or strategies",
        work_item: "A concrete task someone should do",
        reminder: "Time-bound: an event, deadline or follow-up",
        blog_seed: "An idea worth writing a post about",
        none: "None of these",
      },
    },
    kind: {
      type: "choice",
      instructions: "What kind of content is `content`?",
      criteria: { article: "article or blog post", video: "video or transcript", tweet: "social post", paper: "research paper", note: "personal note or thought", tool: "software tool or repo", other: "anything else" },
    },
  };
}

/** Map a 0..4 rubric position (can be fractional) to 0..100. */
export const scoreToPct = (s: number) => Math.max(0, Math.min(100, Math.round((s / 4) * 100)));

export function routedActions(route: Route, score: number): string[] {
  return score >= ROUTE_THRESHOLD ? ROUTE_ACTIONS[route] : [];
}

/** Dedup identity: normalized URL + content hash, else source:external_id. */
export async function dedupKey(c: { url?: string | null; content?: string | null; source: string; external_id: string }): Promise<string> {
  const norm = (u: string) => {
    try {
      const x = new URL(u);
      x.hash = "";
      for (const k of [...x.searchParams.keys()]) if (/^utm_|^fbclid$|^gclid$|^ref$/.test(k)) x.searchParams.delete(k);
      return `${x.host.replace(/^www\./, "")}${x.pathname.replace(/\/$/, "")}${x.search}`.toLowerCase();
    } catch { return u.trim().toLowerCase(); }
  };
  if (c.url) return `u:${norm(c.url)}`;
  if (c.content) {
    const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(c.content.trim()));
    return `c:${[...new Uint8Array(h)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  }
  return `s:${c.source}:${c.external_id}`;
}
