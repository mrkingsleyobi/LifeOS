---
task: "LifeOS running while the laptop sleeps"
slug: 20261009-arbol
phase: complete
progress: 4/4
started: 2026-10-09T13:30:00Z
updated: 2026-10-09T13:30:00Z
parent: 20261009-as3
---

# Arbol + Workers — ISA

## Problem

Arbol, the Bunker cloud planes, Lockbox and the edge router existed only as docs; nothing ran while the laptop slept.

## Vision

Six Workers keep watching, grading and answering around the clock, sharing one decision core and one probe evaluator with the laptop.

## Constraints

Pinned toolchain ≥2 weeks old. Private lane never runs in the cloud. Secrets only via `wrangler secret`. This tree never ships (private-infra containment zone).

## Goal

Every Worker typechecks under strict Workers types, bundles, and its pure logic is unit-tested.

## Claims

- [x] ISC-1: Arbol's cron matcher handles steps, ranges and lists.
- [x] ISC-2: Shared probe compiler covers status, contains, header and HEAD detection.
- [x] ISC-3: All Workers typecheck.
- [x] ISC-4: Anti: the Workers tree is excluded from any public release.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity | tier |
|-----|------|-------|-----------|------|------------|----------|------|
| ISC-1 | bun-test | cron | 0 fail | bun test edge.test.ts -t "arbol cron" | literal |  |  |
| ISC-2 | bun-test | curl compiler | 0 fail | bun test edge.test.ts -t "curl compiler" | literal |  |  |
| ISC-3 | bash | tsc | exit 0 | npx tsc -p tsconfig.json --noEmit | literal |  | deep |
| ISC-4 | bash | containment zone lists CLOUDFLARE | grep match | grep -q "LIFEOS/CLOUDFLARE/\*\*" ../../hooks/lib/containment-zones.ts | derived: privacy | critical |  |

## Decisions

- 2026-10-09 wrangler 4.140.0 + workers-types 5.20260924.1 (wrangler's peer floor) + typescript 5.9.3.

## Verification

- 2026-10-09: every deterministic row run by `bun ../BUNKER/Bunker.ts test --isa ISA.md`; judged/attested rows listed as named exceptions.
