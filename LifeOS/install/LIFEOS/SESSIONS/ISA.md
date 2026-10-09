---
task: "Bring back killed sessions"
slug: 20261009-sessions
phase: complete
progress: 2/2
started: 2026-10-09T13:30:00Z
updated: 2026-10-09T13:30:00Z
parent: 20261009-as3
---

# Session restore — ISA

## Problem

A closed terminal or reboot lost which Claude, Codex and Pi sessions were mid-flight.

## Vision

`/rs` lists what died in the last two days across all three harnesses and brings any of them back in its own directory.

## Constraints

Ground truth is each harness's own transcripts; nothing depends on a registry that a crash could skip writing.

## Goal

Sessions are discovered from transcripts, classified live vs restorable, and resumed with the right command per harness.

## Claims

- [x] ISC-1: Resume commands are right per harness.
- [x] ISC-2: The CLI lists without error on a machine with no sessions.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity | tier |
|-----|------|-------|-----------|------|------------|----------|------|
| ISC-1 | bun-test | resumeArgv | 0 fail | bun test ../TOOLS/lib/subsystems.test.ts -t "sessions" | literal |  |  |
| ISC-2 | bash | list on an empty HOME | exit 0 | HOME=$(mktemp -d) LIFEOS_DIR=$(mktemp -d) bun ../TOOLS/Sessions.ts list | literal |  |  |

## Decisions

- 2026-10-09 live = transcript moved <2 min, or a harness process sits in the session's cwd and it's the newest there.

## Verification

- 2026-10-09: every deterministic row run by `bun ../BUNKER/Bunker.ts test --isa ISA.md`; judged/attested rows listed as named exceptions.
