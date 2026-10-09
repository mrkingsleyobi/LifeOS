---
task: "Every fuzzy call is a governed typed question"
slug: 20261009-decisions
phase: complete
progress: 4/4
started: 2026-10-09T13:30:00Z
updated: 2026-10-09T13:30:00Z
parent: 20261009-as3
---

# Decisions — ISA

## Problem

Code made fuzzy calls by keyword or vibes, with no record of what it decided, at what confidence, or whether it was right.

## Vision

Any fuzzy call in LifeOS is one typed Jev question with a probability, a threshold, a budget and a ledger line; new callers prove themselves in shadow before they act.

## Constraints

A caller acts only in ENFORCE; ENFORCE needs measured agreement on a named Jev model or an explicit principal override; a Jev model change drops measured callers to SHADOW.

## Goal

Jev calls are typed end to end, refuse credential-shaped state, fail over between transports, and every verdict passes through the shadow/enforce gate.

## Claims

- [x] ISC-1: Typed answers parse; incomplete answers are failures, not guesses.
- [x] ISC-2: Credential-shaped state never leaves for Jev.
- [x] ISC-3: Measured ENFORCE drifts to SHADOW on a new Jev model; unmeasured ENFORCE stays SHADOW.
- [x] ISC-4: The status CLI reports every caller's mode and budget.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity | tier |
|-----|------|-------|-----------|------|------------|----------|------|
| ISC-1 | bun-test | jev client suite | 0 fail | bun test ../ROUTER/Router.test.ts -t "jev client" | literal | critical |  |
| ISC-2 | bun-test | secret refusal | 0 fail | bun test ../ROUTER/Router.test.ts -t "refuses credential" | literal | critical |  |
| ISC-3 | bun-test | governance suite | 0 fail | bun test ../ROUTER/Router.test.ts -t "decisions governance" | literal |  |  |
| ISC-4 | bash | status lists dispatch-advisor | grep match | LIFEOS_DIR=$(mktemp -d) LIFEOS_JEV_ENV_FILE=/dev/null TYPESAFE_API_KEY= OPENROUTER_API_KEY= bun Decisions.ts status \| grep -q dispatch-advisor | literal |  |  |

## Decisions

- 2026-10-09 dispatch-advisor and private-lane-gate ship ENFORCE on a principal override (the principal asked for routing); satisfaction-capture and socrates-answer ship SHADOW.

## Verification

- 2026-10-09: every deterministic row run by `bun ../BUNKER/Bunker.ts test --isa ISA.md`; judged/attested rows listed as named exceptions.
