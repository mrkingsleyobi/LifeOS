---
task: "The harness speaks ISA"
slug: 20261009-bunker
phase: complete
progress: 4/4
started: 2026-10-09T13:30:00Z
updated: 2026-10-09T13:30:00Z
parent: 20261009-as3
---

# Bunker — ISA

## Problem

The Bunker concept shipped; its CLI did not, so the shipped Pulse Bunker tab had nothing to render and no app was held to its ISA.

## Vision

Every app's ISA is its test suite; `bunker test` runs it locally, `sync-cloud` makes the cloud run it forever, and Pulse shows every bay's grade and security pill.

## Constraints

One probe evaluator shared by local and cloud. Judged and attested rows are reported, never executed by Bunker.

## Goal

Bunker runs an ISA's deterministic rows, serves the Pulse snapshot, and compiles curl rows into the cloud health worker.

## Claims

- [x] ISC-1: Deterministic rows run; eval/manual rows are named exceptions.
- [x] ISC-2: The Test Strategy parser honours column order, escaped pipes, severity and tier.
- [x] ISC-3: `bunker data` emits the snapshot shape the Pulse tab renders.
- [x] ISC-4: The cloud planes serve Pulse's site-health and security-report contracts.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity | tier |
|-----|------|-------|-----------|------|------------|----------|------|
| ISC-1 | bun-test | runIsa | 0 fail | bun test ../TOOLS/lib/subsystems.test.ts -t "bunker" | literal | critical |  |
| ISC-2 | bun-test | parser + compiler | 0 fail | bun test ../CLOUDFLARE/edge.test.ts -t "ISA Test Strategy parser" | literal |  |  |
| ISC-3 | bash | data has apps + summary | exit 0 | D=$(mktemp -d); mkdir -p $D/USER/CONFIG; echo "[]" > $D/USER/CONFIG/bunker.json; LIFEOS_DIR=$D bun Bunker.ts data \| grep -q '"summary"' | literal |  |  |
| ISC-4 | manual | wrangler dev: sync-cloud → /status + /report | observed | — | cross: 20261009-arbol |  |  |

## Decisions

- 2026-10-09 PULSE/Bunker/bin/bunker.ts is a shim to BUNKER/Bunker.ts so the shipped module works unchanged.

## Verification

- 2026-10-09: every deterministic row run by `bun ../BUNKER/Bunker.ts test --isa ISA.md`; judged/attested rows listed as named exceptions.
