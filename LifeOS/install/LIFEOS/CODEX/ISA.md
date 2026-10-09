---
task: "Open the same install from Codex"
slug: 20261009-codex-door
phase: complete
progress: 3/3
started: 2026-10-09T13:30:00Z
updated: 2026-10-09T13:30:00Z
parent: 20261009-as3
---

# Codex front door — ISA

## Problem

Codex sessions ran without LifeOS context, skills, Router, or guards.

## Vision

`codex` in any repo is the same DA: same rules, same skills, the Router's line on every prompt, the same guard stopping `rm -rf /`.

## Constraints

Symlinks, not copies. Never clobber the principal's own AGENTS.md text, skills or hooks. CrossVendorAudit keeps its isolated CODEX_HOME.

## Goal

Mount writes a managed AGENTS.md block, links skills and prompts, and bridges LifeOS hooks into Codex; unmount removes only what mount created.

## Claims

- [x] ISC-1: The bridge maps tool names and folds a blocking hook into exit 2.
- [x] ISC-2: The managed block round-trips without touching the principal's text.
- [x] ISC-3: Mount then unmount leaves the CODEX_HOME as it was.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity | tier |
|-----|------|-------|-----------|------|------------|----------|------|
| ISC-1 | bun-test | hookbridge | 0 fail | bun test ../TOOLS/lib/subsystems.test.ts -t "hookbridge" | literal | critical |  |
| ISC-2 | bun-test | doorcontext | 0 fail | bun test ../TOOLS/lib/subsystems.test.ts -t "doorcontext" | literal |  |  |
| ISC-3 | bash | round-trip in a temp CODEX_HOME | exit 0 | C=$(mktemp -d); echo mine > $C/AGENTS.md; CODEX_HOME=$C bun Mount.ts mount >/dev/null && CODEX_HOME=$C bun Mount.ts unmount >/dev/null && test "$(cat $C/AGENTS.md)" = mine | literal |  |  |

## Decisions

- 2026-10-09 bridge via Codex hooks.json (same event names and JSON as Claude) rather than per-hook ports.

## Verification

- 2026-10-09: every deterministic row run by `bun ../BUNKER/Bunker.ts test --isa ISA.md`; judged/attested rows listed as named exceptions.
