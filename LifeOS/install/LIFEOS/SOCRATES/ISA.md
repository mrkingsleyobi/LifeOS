---
task: "Standing questions answered on a schedule"
slug: 20261009-socrates
phase: complete
progress: 4/4
started: 2026-10-09T13:30:00Z
updated: 2026-10-09T13:30:00Z
parent: 20261009-as3
---

# Socrates — ISA

## Problem

Questions the principal keeps re-asking (is the site still up, did the vendor fix it, is the price still above X) had no home and no memory.

## Vision

A question asked once is answered every hour forever, three-valued, with the evidence lane recorded, and a yes that matters becomes a ticket without a human noticing.

## Constraints

Unknown is a real answer, never coerced. Sensitive state is judged on the private lane only.

## Goal

Due questions are answered yes/no/unknown from their named source and hits route to Achilles or Upgrades.

## Claims

- [x] ISC-1: Probabilities map to yes/no/unknown with a real unknown band.
- [x] ISC-2: Anti: a failing source answers unknown, never yes or no.
- [x] ISC-3: The CLI registers and lists questions.
- [x] ISC-4: A live public question is answered by Jev.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity | tier |
|-----|------|-------|-----------|------|------------|----------|------|
| ISC-1 | bun-test | three-valued | 0 fail | bun test ../TOOLS/lib/subsystems.test.ts -t "socrates" | literal |  |  |
| ISC-2 | bun-test | source failure | 0 fail | bun test ../TOOLS/lib/subsystems.test.ts -t "socrates" | derived: honesty | critical |  |
| ISC-3 | bash | add then list | grep match | D=$(mktemp -d); LIFEOS_DIR=$D bun Socrates.ts add "Probe?" --source "file:/etc/hostname" >/dev/null && LIFEOS_DIR=$D bun Socrates.ts list \| grep -q Probe | literal |  |  |
| ISC-4 | bash | run against a public URL | exit 0 | D=$(mktemp -d); LIFEOS_DIR=$D bun Socrates.ts add "Does the page mention Example Domain?" --source "url:https://example.com" >/dev/null && LIFEOS_DIR=$D bun Socrates.ts run \| grep -q "via jev" | literal |  | deep |

## Decisions

- 2026-10-09 the hourly cloud half runs as an Arbol flow (P_SOCRATES_PUBLIC) for public URLs only.

## Verification

- 2026-10-09: every deterministic row run by `bun ../BUNKER/Bunker.ts test --isa ISA.md`; judged/attested rows listed as named exceptions.
