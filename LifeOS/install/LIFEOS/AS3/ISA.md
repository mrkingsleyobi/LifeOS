---
task: "The far-end capability target for this LifeOS"
slug: 20261009-as3
phase: complete
progress: 17/17
started: 2026-10-09T13:30:00Z
updated: 2026-10-09T13:30:00Z
children:
  - 20261009-router
  - 20261009-decisions
  - 20261009-errata
  - 20261009-socrates
  - 20261009-achilles
  - 20261009-vera
  - 20261009-people
  - 20261009-synapse
  - 20261009-lockbox
  - 20261009-bunker
  - 20261009-arbol
  - 20261009-codex-door
  - 20261009-pi-door
  - 20261009-sessions
  - 20261009-ledger
---

# AS3 — ISA (root)

## Problem

Capabilities were added one by one with no single statement of where the whole system is going, so nothing said whether a new piece moved it closer.

## Vision

Every LifeOS capability traces to a claim here, and this file going green means every subsystem underneath it is holding its own claims.

## Constraints

Children inherit these constraints: sensitive data stays on the box; every decision is ledgered without its content; every capability has an executable probe.

## Goal

Every rebuilt subsystem's ISA passes its deterministic rows, run from here.

## Claims

- [x] ISC-1: Bridge: Router holds its claims.
- [x] ISC-2: Bridge: Decisions holds its claims.
- [x] ISC-3: Bridge: Errata holds its claims.
- [x] ISC-4: Bridge: Socrates holds its claims.
- [x] ISC-5: Bridge: Achilles holds its claims.
- [x] ISC-6: Bridge: Vera holds its claims.
- [x] ISC-7: Bridge: People holds its claims.
- [x] ISC-8: Bridge: Synapse holds its claims.
- [x] ISC-9: Bridge: Lockbox holds its claims.
- [x] ISC-10: Bridge: Bunker holds its claims.
- [x] ISC-11: Bridge: Arbol + Workers holds its claims.
- [x] ISC-12: Bridge: Codex front door holds its claims.
- [x] ISC-13: Bridge: Pi front door holds its claims.
- [x] ISC-14: Bridge: Session restore holds its claims.
- [x] ISC-15: Bridge: Ledger tooling holds its claims.
- [x] ISC-16: Jobs for every scheduled subsystem render for launchd and systemd.
- [x] ISC-17: WorkSync mirrors only this session's rows.

## Not yet specified

- fog: the principal's own AS3 maturity claims (TELOS-level outcomes) — written by the principal from USER/TELOS, not derived here

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity | tier |
|-----|------|-------|-----------|------|------------|----------|------|
| ISC-1 | bash | child ISA ROUTER passes its deterministic rows | exit 0 | bun ../BUNKER/Bunker.ts test --isa ../ROUTER/ISA.md | cross: 20261009-router | critical |  |
| ISC-2 | bash | child ISA DECISIONS passes its deterministic rows | exit 0 | bun ../BUNKER/Bunker.ts test --isa ../DECISIONS/ISA.md | cross: 20261009-decisions | critical |  |
| ISC-3 | bash | child ISA ERRATA passes its deterministic rows | exit 0 | bun ../BUNKER/Bunker.ts test --isa ../ERRATA/ISA.md | cross: 20261009-errata |  |  |
| ISC-4 | bash | child ISA SOCRATES passes its deterministic rows | exit 0 | bun ../BUNKER/Bunker.ts test --isa ../SOCRATES/ISA.md | cross: 20261009-socrates |  |  |
| ISC-5 | bash | child ISA ACHILLES passes its deterministic rows | exit 0 | bun ../BUNKER/Bunker.ts test --isa ../ACHILLES/ISA.md | cross: 20261009-achilles |  |  |
| ISC-6 | bash | child ISA VERA passes its deterministic rows | exit 0 | bun ../BUNKER/Bunker.ts test --isa ../VERA/ISA.md | cross: 20261009-vera |  |  |
| ISC-7 | bash | child ISA PEOPLE passes its deterministic rows | exit 0 | bun ../BUNKER/Bunker.ts test --isa ../PEOPLE/ISA.md | cross: 20261009-people |  |  |
| ISC-8 | bash | child ISA SYNAPSE passes its deterministic rows | exit 0 | bun ../BUNKER/Bunker.ts test --isa ../SYNAPSE/ISA.md | cross: 20261009-synapse |  |  |
| ISC-9 | bash | child ISA LOCKBOX passes its deterministic rows | exit 0 | bun ../BUNKER/Bunker.ts test --isa ../LOCKBOX/ISA.md | cross: 20261009-lockbox |  |  |
| ISC-10 | bash | child ISA BUNKER passes its deterministic rows | exit 0 | bun ../BUNKER/Bunker.ts test --isa ../BUNKER/ISA.md | cross: 20261009-bunker |  |  |
| ISC-11 | bash | child ISA CLOUDFLARE passes its deterministic rows | exit 0 | bun ../BUNKER/Bunker.ts test --isa ../CLOUDFLARE/ISA.md | cross: 20261009-arbol |  |  |
| ISC-12 | bash | child ISA CODEX passes its deterministic rows | exit 0 | bun ../BUNKER/Bunker.ts test --isa ../CODEX/ISA.md | cross: 20261009-codex-door |  |  |
| ISC-13 | bash | child ISA PI passes its deterministic rows | exit 0 | bun ../BUNKER/Bunker.ts test --isa ../PI/ISA.md | cross: 20261009-pi-door |  |  |
| ISC-14 | bash | child ISA SESSIONS passes its deterministic rows | exit 0 | bun ../BUNKER/Bunker.ts test --isa ../SESSIONS/ISA.md | cross: 20261009-sessions |  |  |
| ISC-15 | bash | child ISA LEDGER passes its deterministic rows | exit 0 | bun ../BUNKER/Bunker.ts test --isa ../LEDGER/ISA.md | cross: 20261009-ledger |  |  |
| ISC-16 | bun-test | jobs | 0 fail | bun test ../TOOLS/lib/subsystems.test.ts -t "jobs" | literal |  |  |
| ISC-17 | bun-test | worksync | 0 fail | bun test ../TOOLS/lib/subsystems.test.ts -t "worksync" | literal |  |  |

## Decisions

- 2026-10-09 AS3 starts as the roll-up of the rebuilt subsystems; principal outcome claims are added as they are articulated.

## Verification

- 2026-10-09: every deterministic row run by `bun ../BUNKER/Bunker.ts test --isa ISA.md`; judged/attested rows listed as named exceptions.
