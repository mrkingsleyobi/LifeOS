---
task: "Capture journal grade route resurface"
slug: 20261009-synapse
phase: complete
progress: 4/4
started: 2026-10-09T13:30:00Z
updated: 2026-10-09T13:30:00Z
parent: 20261009-as3
---

# Synapse — ISA

## Problem

Captures from every input died in their own pipelines; nothing journaled them first; promoted notes never carried `source_amber_id`, so Pulse couldn't join notes to ledger rows (upstream #2245).

## Vision

Any signal is safe the instant it's caught, graded against what the principal is actually doing, and routed to where it belongs; the weak ones still live forever.

## Constraints

Write-ahead before grading. Personal captures never leave the box. Routing is conditional on score; preservation never is.

## Goal

Every capture is journaled locally first, deduped, graded against TELOS, and routed — with promoted notes carrying source_amber_id.

## Claims

- [x] ISC-1: Dedup ignores tracking params and fragments.
- [x] ISC-2: Routing fires only above the bar.
- [x] ISC-3: Personal captures never leave the box; promoted notes carry source_amber_id in kb-v3.
- [x] ISC-4: The cloud ledger refuses personal captures and grades public ones (amber-ledger Worker).

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity | tier |
|-----|------|-------|-----------|------|------------|----------|------|
| ISC-1 | bun-test | dedup | 0 fail | bun test ../TOOLS/lib/subsystems.test.ts -t "synapse" | literal |  |  |
| ISC-2 | bun-test | conditional routing | 0 fail | bun test ../TOOLS/lib/subsystems.test.ts -t "synapse" | literal |  |  |
| ISC-3 | bun-test | privacy + join key | 0 fail | bun test ../TOOLS/lib/subsystems.test.ts -t "synapse" | literal | critical |  |
| ISC-4 | manual | wrangler dev round-trip | observed | — | cross: 20261009-arbol |  |  |

## Decisions

- 2026-10-09 the local JSONL journal is the write-ahead log; the D1 ledger mirrors public rows and owns the cloud id.

## Verification

- 2026-10-09: every deterministic row run by `bun ../BUNKER/Bunker.ts test --isa ISA.md`; judged/attested rows listed as named exceptions.
