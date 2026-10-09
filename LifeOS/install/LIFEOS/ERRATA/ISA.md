---
task: "Every complaint captured verbatim and triaged"
slug: 20261009-errata
phase: complete
progress: 4/4
started: 2026-10-09T13:30:00Z
updated: 2026-10-09T13:30:00Z
parent: 20261009-as3
---

# Errata — ISA

## Problem

Complaints about systems we built were said once in a conversation and lost; recurring annoyances never became upgrades.

## Vision

`/er the share button does nothing` is one line; a week later Pulse shows it recurring three times and it's an Upgrades record with the three verbatims as evidence.

## Constraints

Capture is verbatim and model-free; enrichment runs later on the OpenAI Luna lane; app intake is per-app keyed and rate-limited.

## Goal

Every complaint door (hook, /er, app, backfill) writes a verbatim ledger line, and triage turns one into an Upgrades record.

## Claims

- [x] ISC-1: Capture stores the principal's exact words.
- [x] ISC-2: The CLI captures and lists.
- [x] ISC-3: Pulse renders the Errata view.
- [x] ISC-4: App intake accepts keyed reports and drains once (errata-intake Worker).

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity | tier |
|-----|------|-------|-----------|------|------------|----------|------|
| ISC-1 | bun-test | verbatim capture | 0 fail | bun test ../TOOLS/lib/subsystems.test.ts -t "errata" | literal | critical |  |
| ISC-2 | bash | capture then list | grep match | D=$(mktemp -d); LIFEOS_DIR=$D bun Errata.ts capture "probe complaint" --system Probe >/dev/null && LIFEOS_DIR=$D bun Errata.ts list \| grep -q "probe complaint" | literal |  |  |
| ISC-3 | bun-test | pulse view | 0 fail | bun test ../TOOLS/lib/subsystems.test.ts -t "pulse-ledgers" | cross: 20261009-as3 |  |  |
| ISC-4 | manual | wrangler dev: 202 on key, 401 without, drain empties | observed | — | literal |  |  |

## Decisions

- 2026-10-09 enrichment on Luna, not inline: capture must never wait on or be altered by a model.

## Verification

- 2026-10-09: every deterministic row run by `bun ../BUNKER/Bunker.ts test --isa ISA.md`; judged/attested rows listed as named exceptions.
