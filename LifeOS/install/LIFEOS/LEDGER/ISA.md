---
task: "Every change versioned recorded and tagged"
slug: 20261009-ledger
phase: complete
progress: 2/2
started: 2026-10-09T13:30:00Z
updated: 2026-10-09T13:30:00Z
parent: 20261009-as3
---

# Ledger tooling — ISA

## Problem

The Ledger's record format shipped but its tooling (`/vb`, classify, bump, index) lived in a private skill.

## Vision

`/vb` says patch/feature/major with reasons, bumps every touched line, records the change, rebuilds the changelog and tags the release.

## Constraints

Exactly Major.Feature.Patch. MAJOR needs a conversation; FEATURE a one-line confirm; PATCH auto-applies.

## Goal

Changes classify deterministically, bumps are gated by level, and the registry index matches what Pulse reads.

## Claims

- [x] ISC-1: Bumps and classification follow the scheme.
- [x] ISC-2: Anti: a FEATURE bump without --yes refuses.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity | tier |
|-----|------|-------|-----------|------|------------|----------|------|
| ISC-1 | bun-test | ledger | 0 fail | bun test ../TOOLS/lib/subsystems.test.ts -t "ledger" | literal | critical |  |
| ISC-2 | bash | bump feature exits 3 | exit 3 | D=$(mktemp -d); echo 1.0.0 > $D/VERSION; LIFEOS_DIR=$D bun ../../skills/_LIFEOS/Tools/VersionBump.ts bump feature; test $? -eq 3 | derived: gate |  |  |

## Decisions

- 2026-10-09 a NEW schema file is additive (feature); only a modified or removed schema is major.

## Verification

- 2026-10-09: every deterministic row run by `bun ../BUNKER/Bunker.ts test --isa ISA.md`; judged/attested rows listed as named exceptions.
