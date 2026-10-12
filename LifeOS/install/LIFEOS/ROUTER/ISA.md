---
task: "Jev routes every prompt to a lane"
slug: 20261009-router
phase: complete
progress: 9/9
started: 2026-10-09T13:30:00Z
updated: 2026-10-09T13:30:00Z
parent: 20261009-as3
---

# Router — ISA

## Problem

Every prompt ran on whatever model the session started on. Bulk work (SDS sheets, job descriptions) burned frontier tokens; judgment work sometimes ran on a cheap rung; nothing used the OpenAI subscription's ladder; sensitive data had no lane that stays on the box.

## Vision

The principal types; ~0.3s later a `🧭 ROUTER` line says which lane runs it and why, the statusline lights that model and agent, and the work lands on the cheapest lane that does it well — Terra for the JD batch, Fable for the strategy call, the local model for the lab results — without the principal ever naming a model.

## Out of Scope

Changing the main loop's model (no hook can). Training a learned lane model — the scorer is hand-weighted until the ledger has enough labeled outcomes. Gemini/Grok at the edge (Arbol refuses them).

## Constraints

Sensitive data never reaches Jev or a cloud lane. The UserPromptSubmit hook is synchronous (upstream #1957) and fails open. Model IDs live only in TOOLS/models.ts. Every decision is ledgered without prompt text.

## Goal

Each prompt resolves to exactly one lane + effort + strategy within the hook timeout, the private lane catches sensitive input before any network call, and the same signals route identically on the laptop and at the edge.

## Claims

- [x] ISC-1: Every lane resolves a model and an agent file.
- [x] ISC-2: Lane selection matches intent: bulk → Luna/Terra, exhaustive → Astra, judgment → Opus/Fable, acks → inline.
- [x] ISC-3: Credentials, RESTRICTED text and high-sensitivity prompts pin the private lane; a lane pin cannot override it.
- [x] ISC-4: Fallback chains skip spent vendors and lanes whose ceiling is below the data class; combo reviewers are cross-vendor.
- [x] ISC-5: The hook emits a ROUTER line for a real prompt.
- [x] ISC-6: Anti: the hook never blocks a prompt — garbage stdin exits 0 with no output.
- [x] ISC-7: Anti: the decision ledger stores no prompt text.
- [x] ISC-8: The edge Worker routes with the same Score.ts the hook uses.
- [x] ISC-9: Live Jev answers the full question set through at least one transport.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity | tier |
|-----|------|-------|-----------|------|------------|----------|------|
| ISC-1 | bash | wiring audit exits 0 | exit 0 | LIFEOS_DIR=$(mktemp -d) LIFEOS_JEV_ENV_FILE=/dev/null TYPESAFE_API_KEY= OPENROUTER_API_KEY= bun Router.ts audit | literal | critical |  |
| ISC-2 | bun-test | lane selection suite | 0 fail | bun test Router.test.ts -t "lane selection" | literal |  |  |
| ISC-3 | bun-test | private lane suite | 0 fail | bun test Router.test.ts -t "private pinned lane" | literal | critical |  |
| ISC-4 | bun-test | strategies suite | 0 fail | bun test Router.test.ts -t "strategies" | literal |  |  |
| ISC-5 | bash | hook output carries the ROUTER line | grep match | echo '{"prompt":"Rewrite these 60 job descriptions"}' \| LIFEOS_DIR=$(mktemp -d) LIFEOS_JEV_ENV_FILE=/dev/null TYPESAFE_API_KEY= OPENROUTER_API_KEY= bun ../../hooks/RouterFrontDoor.hook.ts \| grep -q "ROUTER:" | literal |  |  |
| ISC-6 | bash | fail-open on malformed input | exit 0 | echo not-json \| LIFEOS_DIR=$(mktemp -d) LIFEOS_JEV_ENV_FILE=/dev/null TYPESAFE_API_KEY= OPENROUTER_API_KEY= bun ../../hooks/RouterFrontDoor.hook.ts | derived: fail-open |  |  |
| ISC-7 | bash | routed prompt absent from decisions.jsonl | no match | D=$(mktemp -d); echo '{"prompt":"zebra-canary-7781 build it"}' \| LIFEOS_DIR=$D LIFEOS_JEV_ENV_FILE=/dev/null OPENROUTER_API_KEY= TYPESAFE_API_KEY= bun ../../hooks/RouterFrontDoor.hook.ts >/dev/null; ! grep -rq zebra-canary-7781 $D/MEMORY/OBSERVABILITY | derived: privacy | critical |  |
| ISC-8 | bash | router-edge imports ROUTER/Score | grep match | grep -q "ROUTER/Score" ../CLOUDFLARE/workers/router-edge/src/index.ts | cross: 20261009-arbol |  |  |
| ISC-9 | bash | jev ping with real keys | exit 0 | bun ../DECISIONS/Jev.ts ping | literal |  | deep |

## Decisions

- 2026-10-09 hand-weighted scorer over a learned model: no labeled outcomes yet; `Decisions.ts outcome` collects them.
- 2026-10-09 refined: bulk volume caps at Terra (Sol only when genuinely max-hard) — Jev reads bulk extraction as `exhaustive`, which would otherwise send SDS batches to Astra.
- 2026-10-09 refined: private-lane threshold 0.6 (was 0.35) — job descriptions scored 0.43 on `sensitive` and were wrongly pinned local.

## Remaining Work

- [ ] Train lane + effort models from `decisions.jsonl` outcomes once ≥500 labeled rows exist — needs labels first
- [ ] Confirm OpenAI model ID strings against the account's model list (CROSS_VENDOR) — principal's account

## Verification

- 2026-10-09: every deterministic row run by `bun ../BUNKER/Bunker.ts test --isa ISA.md`; judged/attested rows listed as named exceptions.
