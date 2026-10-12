---
task: "One local record per person"
slug: 20261009-people
phase: climbing
progress: 3/4
started: 2026-10-09T13:30:00Z
updated: 2026-10-09T13:30:00Z
parent: 20261009-as3
---

# People — ISA

## Problem

People data lived in contacts, notes, and memory with no single record and no way to share a business view safely.

## Vision

One record per person, every interaction logged, and exactly one door out: the business projection.

## Constraints

RESTRICTED; no network; the projection is the only export.

## Goal

People can be found by name, org or tag, interactions logged, and only business fields leave via the projection.

## Claims

- [x] ISC-1: who() finds by name, org and tag.
- [x] ISC-2: Anti: the projection carries no personal fields.
- [x] ISC-3: Anti: People makes no network calls.
- [ ] ISC-4: Apple Contacts two-way sync.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity | tier |
|-----|------|-------|-----------|------|------------|----------|------|
| ISC-1 | bun-test | lookup | 0 fail | bun test ../TOOLS/lib/subsystems.test.ts -t "people" | literal |  |  |
| ISC-2 | bash | projection omits email and notes | no match | D=$(mktemp -d); P=$(LIFEOS_DIR=$D bun People.ts add "Probe Person" --email probe@x.io --tags customer); LIFEOS_DIR=$D bun People.ts customer $P --state active >/dev/null; ! (LIFEOS_DIR=$D bun People.ts projection \| grep -q probe@x.io) | derived: privacy | critical |  |
| ISC-3 | bash | no fetch in People.ts | no match | ! grep -q "fetch(" People.ts | derived: privacy |  |  |
| ISC-4 | manual | sync round-trip on macOS | observed | — | literal |  |  |

## Decisions

- 2026-10-09 store first, sync later: the store is the contract a sync writes to.

## Remaining Work

- [ ] Apple Contacts two-way sync (needs Contacts.framework entitlements on macOS)

## Verification

- 2026-10-09: every deterministic row run by `bun ../BUNKER/Bunker.ts test --isa ISA.md`; judged/attested rows listed as named exceptions.
