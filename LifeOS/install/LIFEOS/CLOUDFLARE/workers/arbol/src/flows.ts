/**
 * Arbol PIPELINES + FLOWS — data, not code. Add a flow by adding a row.
 * Flow cron is evaluated against the Worker's every-minute trigger.
 * Private-tree flows (real feeds, real recipients) belong in an overlay that
 * never ships; these are the reference set.
 */

export interface Step { action: string; cfg?: Record<string, any>; each?: string; limit?: number }
export interface Flow { name: string; cron: string; pipeline: string; source: Record<string, unknown> }

export const PIPELINES: Record<string, Step[]> = {
  /** Feed → new items → Jev relevance gate → Luna one-line summary → KV digest. */
  P_FEED_DIGEST: [
    { action: "A_FETCH" },
    { action: "A_RSS" },
    { action: "A_NEW_ONLY", cfg: { key: "feed-digest" } },
    {
      action: "A_JEV", each: "items", limit: 15,
      cfg: {
        state: "{title}",
        questions: { relevant: { type: "noul", instructions: "Is `state` about AI agents, security, or building with LLMs?" } },
      },
    },
    { action: "A_KV_WRITE", cfg: { key: "digest:latest", field: "items", ttl: 7 * 86400 } },
  ],

  /** Standing question against a public URL (the cloud half of Socrates). */
  P_SOCRATES_PUBLIC: [
    { action: "A_FETCH" },
    { action: "A_JEV", cfg: { questions: { answer: { type: "noul", instructions: "Given `state`, is the answer to this question yes? {question}" } } } },
    { action: "A_KV_WRITE", cfg: { key: "socrates:{qid}:latest" } },
  ],

  /** Weekly OpenAI-lane synthesis of whatever the digest kept. */
  P_WEEKLY_BRIEF: [
    { action: "A_LLM", cfg: { lane: "terra", effort: "low", as: "brief", prompt: "Write a 5-bullet weekly brief from these items (title + link each):\n{items}" } },
    { action: "A_KV_WRITE", cfg: { key: "brief:weekly", field: "brief" } },
    { action: "A_WEBHOOK", cfg: { urlEnv: "BRIEF_WEBHOOK", field: "brief" } },
  ],
};

export const FLOWS: Flow[] = [
  { name: "F_FEED_DIGEST", cron: "17 */2 * * *", pipeline: "P_FEED_DIGEST", source: { url: "https://danielmiessler.com/rss" } },
  {
    name: "F_SOCRATES_STATUSPAGE", cron: "*/30 * * * *", pipeline: "P_SOCRATES_PUBLIC",
    source: { qid: "anthropic-status", question: "Does the page report an ongoing incident?", url: "https://status.anthropic.com/api/v2/status.json" },
  },
];
