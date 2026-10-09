---
task: "Every finding tracked to remediation"
slug: 20261009-achilles
phase: complete
progress: 4/4
started: 2026-10-09T13:30:00Z
updated: 2026-10-09T13:30:00Z
parent: 20261009-as3
---

# Achilles — ISA

## Problem

Findings from Helios, the Bunker security plane, KEV and Socrates landed in different places and nobody tracked them to fixed.

## Vision

One registry; every finding has an SLA by severity; the overdue ones ping until fixed; a new KEV entry for a device you own appears the morning it's published.

## Constraints

RESTRICTED data class; findings carry evidence; status changes append notes, never delete.

## Goal

Findings from every source share one registry with SLA due dates and a daily KEV sync against the principal's inventory.

## Claims

- [x] ISC-1: SLA due dates follow severity (critical 2d … low 90d).
- [x] ISC-2: The CLI adds a finding and reports it due.
- [x] ISC-3: Helios findings surface in both the Achilles and Helios Pulse tabs.
- [x] ISC-4: KEV sync reads the live CISA catalog.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity | tier |
|-----|------|-------|-----------|------|------------|----------|------|
| ISC-1 | bun-test | SLA math | 0 fail | bun test ../TOOLS/lib/subsystems.test.ts -t "achilles" | literal |  |  |
| ISC-2 | bash | add then due | grep match | D=$(mktemp -d); LIFEOS_DIR=$D bun Achilles.ts add --asset a.test --severity critical --title probe >/dev/null && LIFEOS_DIR=$D bun Achilles.ts due \| grep -q "due in" | literal |  |  |
| ISC-3 | bun-test | pulse view | 0 fail | bun test ../TOOLS/lib/subsystems.test.ts -t "pulse-ledgers" | cross: 20261009-as3 |  |  |
| ISC-4 | bash | kev against a sample inventory | exit 0 | D=$(mktemp -d); mkdir -p $D/USER/CONFIG; echo '[{"asset":"edge","vendor":"Microsoft","product":"Windows"}]' > $D/USER/CONFIG/achilles-inventory.json; LIFEOS_DIR=$D bun Achilles.ts kev | literal |  | deep |

## Decisions

- 2026-10-09 KEV ransomware-linked entries file as critical, others high.

## Verification

- 2026-10-09: every deterministic row run by `bun ../BUNKER/Bunker.ts test --isa ISA.md`; judged/attested rows listed as named exceptions.
