---
task: "Versioned ideal-state profiles of people"
slug: 20261009-vera
phase: complete
progress: 3/3
started: 2026-10-09T13:30:00Z
updated: 2026-10-09T13:30:00Z
parent: 20261009-as3
---

# Vera — ISA

## Problem

What we believed about a person's goals was overwritten in place, so 'what did we think in June' was unanswerable.

## Vision

A profile is a projection of an append-only claim ledger; any date is a query; a retraction is history, not deletion.

## Constraints

RESTRICTED; no network, no cloud model; synthesis only through the private lane.

## Goal

Profiles project from claims as of any time, retractions remove claims from the projection but keep them in history.

## Claims

- [x] ISC-1: Retraction removes from the projection, keeps history.
- [x] ISC-2: The CLI renders a profile.
- [x] ISC-3: Anti: Vera makes no network calls.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity | tier |
|-----|------|-------|-----------|------|------------|----------|------|
| ISC-1 | bun-test | projection | 0 fail | bun test ../TOOLS/lib/subsystems.test.ts -t "vera" | literal | critical |  |
| ISC-2 | bash | claim then profile | grep match | D=$(mktemp -d); LIFEOS_DIR=$D bun Vera.ts claim self --kind ideal --text "probe ideal" >/dev/null && LIFEOS_DIR=$D bun Vera.ts profile self \| grep -q "probe ideal" | literal |  |  |
| ISC-3 | bash | no fetch in Vera.ts | no match | ! grep -q "fetch(" Vera.ts | derived: privacy | critical |  |

## Decisions

- 2026-10-09 people are keyed by People ids or `self`.

## Verification

- 2026-10-09: every deterministic row run by `bun ../BUNKER/Bunker.ts test --isa ISA.md`; judged/attested rows listed as named exceptions.
