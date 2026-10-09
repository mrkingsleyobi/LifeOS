---
last_updated: 2026-10-09
last_updated_by: da
last_reviewed: 2026-10-09
last_reviewed_by: da
convention: pai-freshness-v1
version: 2.0.0
---

# The Router (v2 — Jev)

> **Who runs what, on which model, at what effort.** Every prompt gets one Jev call (~0.3s, ~$0.00004) that answers 23 typed questions with probabilities. A pure scorer turns those into an **intelligence** level, a **token-volume** level, an effort, and a lane. Agents are named for their model, so the lane, the agent and the statusline token are one word.
>
> v1 (the Opus/Fable mode-and-tier classifier, `TheRouter.hook.ts`) was retired 2026-07-11. v2 restores per-prompt routing with a decision model instead of a chat model: 10× faster, ~100× cheaper, and calibrated.

## The trade-off in one line

**Intelligence picks the rung; token volume and work shape pick the vendor.** Judgment, taste, and strategy go to the Anthropic ladder. Settled builds, bulk documents, and exhaustive sweeps go to the OpenAI ladder, where volume is cheaper and a second subscription spreads quota. The goal is the best work at the right performance → speed → cost point.

| Rung | OpenAI ladder | Anthropic ladder | Typical work |
|------|---------------|------------------|--------------|
| max | **Astra** | **Fable** | exhaustive coverage / needle search · top-rung judgment, second opinions |
| high | **Sol** | **Opus** | settled builds with a writable pass/fail test · design, synthesis |
| medium | **Terra** | **Sonnet** | decided approach at volume (SDS sheets, JDs) · utility writing |
| low | **Luna** | **Haiku** | very basic high-volume token work · cheap in-family lookups |

Specialist lanes: **Gemini** (grounded public research, PUBLIC ceiling), **Grok** (public culture / X, PUBLIC ceiling), **Cyber** (security work → the **Helios** agent), **Local** (the Private Pinned Lane), **Inline** (stays in the conversation).

## Pipeline (`LIFEOS/ROUTER/FrontDoor.ts`)

1. **Skip:** slash commands, system-injected text.
2. **Pinned:** `@sol`, `/lane astra`, `/fusion`, `/combo` in the prompt. A pin can never move sensitive data off the box.
3. **Ack:** bare acknowledgements stay inline with no Jev call.
4. **Private:** credential-shaped or RESTRICTED text goes to the local lane. Jev never sees it.
5. **Depth:** "think deeply" / "ultrathink" → max tier at xhigh, Fable (chain → Opus).
6. **Signals:** one Jev call answers all 23 questions (`LaneQuestions.ts`): nine about the work, five about effort, four about the previous reply (Glance's design), plus bulk, long output, sensitivity, and a domain choice. On timeout, no key, or over budget, `Heuristics.ts` produces the same vector, marked `source: fallback`.
7. **Score** (`Score.ts`, pure, shared with the edge Worker): intelligence I, tokens T, hand-off gate H, effort E. Risky builds floor at high. Real builds floor at medium. Bulk is capped at Terra (Sol only if genuinely max-hard).
8. **Strategy + chain:** tiered / combo / fusion / private, then the fallback chain against data-class ceilings and live quota.
9. **Govern** (`DECISIONS/Decisions.ts`): `dispatch-advisor` in ENFORCE → `DIRECTIVE`, in SHADOW → `ADVICE`. Every call gets a ledger line.

## Model-stack strategies (`Strategies.ts`)

| Strategy | When | Shape |
|----------|------|-------|
| **Tiered** | default | one lane by tier |
| **Combo** | risky or costly builds | producer → reviewer on the *other* vendor. A lane never reviews its own work. |
| **Fusion** | max tier + costly error + judgment, or `/fusion` | Fable + Astra (+ Gemini if PUBLIC) in parallel → Opus fuses |
| **Fallback chain** | always | e.g. `sol → opus → terra → sonnet`. A lane is skipped when its vendor's 5H/WK is ≥95%, the FB week is spent, or its ceiling is below the prompt's data class. |
| **Private Pinned Lane** | sensitive data | local llama.cpp only (`PrivateLane.ts`, loopback-enforced). No combo, no fusion, no cloud fallback. |

The Private Pinned Lane is **not** LocalIntelligence. It's a data-boundary guarantee: files and bulk sensitive content are read and processed only by the local model. It cannot un-send what was already typed into the main conversation. It stops that content from going any further.

## Surfaces

- **Hook:** `hooks/RouterFrontDoor.hook.ts`, UserPromptSubmit, **sync** (async UPS hooks can't inject context; upstream #1957). It emits the `🧭 ROUTER:` line, `ROUTE:` fields, and a `DIRECTIVE` / `ADVICE`.
- **DA contract:** `LIFEOS_SYSTEM_PROMPT.md` § Operational Rules, "The Router routes; I orchestrate."
- **Agents:** `agents/{Astra,Sol,Terra,Luna}.md` (codex via `Router.ts run`), `{Fable,Opus,Sonnet,Haiku}.md` (tier aliases), `Helios.md`, `Private.md`, `Gemini.md`, `Grok.md`.
- **Statusline:** models row (12 tokens), agents row (9 tokens), `🧭 ROUTER` row. A token is routed (bold underline), live (bold), used (plain), or idle (dim). The usage rows show Anthropic `5H · WK · FB · SUB` and OpenAI `WK · <plan>`.
- **CLI:** `bun LIFEOS/ROUTER/Router.ts lanes | resolve "<prompt>" | status | audit | run <lane>`
- **Edge:** `LIFEOS/CLOUDFLARE/workers/router-edge` gives the same Score.ts to Hermes, phone, and Codex/Pi doors, with a D1 ledger of metadata only.
- **Skill:** `skills/Jev` covers the DA using Jev directly for its own fuzzy calls.

## Edit points

| Change | Edit |
|--------|------|
| New model version | `LIFEOS/TOOLS/models.ts` (`CURRENT`, `CROSS_VENDOR`) |
| Rung / price / ceiling of a lane | `LIFEOS/ROUTER/Lanes.ts` |
| Routing behavior | `LIFEOS/ROUTER/Score.ts` (+ `Router.test.ts`) |
| Fallback order | `LIFEOS/ROUTER/Strategies.ts` `FALLBACK` |
| Turn routing off | `LIFEOS_ROUTER=off`, or `bun DECISIONS/Decisions.ts shadow dispatch-advisor` |

## Telemetry

- `MEMORY/OBSERVABILITY/decisions.jsonl`: one line per decision (caller, mode, verdict, p, pick, source, Jev model, latency, cost).
- `MEMORY/STATE/router/{last.json, sessions/<sid>.json}`: what the statusline lights.
- `bun Router.ts audit`: lane mix, fallback rate, average latency, wiring check.
- `bun Decisions.ts report | alerts | drift`: agreement, budget, and Jev model drift (measured callers drop to SHADOW on a new Jev model).
