---
task: "Open the same install from Pi"
slug: 20261009-pi-door
phase: climbing
progress: 2/3
started: 2026-10-09T13:30:00Z
updated: 2026-10-09T13:30:00Z
parent: 20261009-as3
---

# Pi front door — ISA

## Problem

Pi got LifeOS only via a manual PiSync copy; no hooks, no Router.

## Vision

Pi carries the same rules (APPEND_SYSTEM.md outranks AGENTS.md), the same skills, and an extension that runs the same guards and Router.

## Constraints

Managed skills are marked and the principal's own Pi skills are never overwritten. The shim fails open.

## Goal

Mount writes APPEND_SYSTEM.md, syncs marked skills, and generates the bridge extension; unmount removes only managed artifacts.

## Claims

- [x] ISC-1: The generated extension shim compiles.
- [x] ISC-2: Anti: unmount keeps the principal's own Pi skills.
- [ ] ISC-3: Pi's before_agent_start receives the Router context in a live Pi session.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity | tier |
|-----|------|-------|-----------|------|------------|----------|------|
| ISC-1 | bash | bun build the shim | exit 0 | P=$(mktemp -d); PI_AGENT_DIR=$P bun Mount.ts mount >/dev/null && bun build $P/extensions/lifeos-bridge.ts --target=bun --outdir=$(mktemp -d) >/dev/null | literal |  |  |
| ISC-2 | bash | own skill survives a mount/unmount cycle | exit 0 | P=$(mktemp -d); mkdir -p $P/skills/mine; printf -- "---\nname: mine\n---\n" > $P/skills/mine/SKILL.md; PI_AGENT_DIR=$P bun Mount.ts mount >/dev/null && PI_AGENT_DIR=$P bun Mount.ts unmount >/dev/null && test -f $P/skills/mine/SKILL.md | literal | critical |  |
| ISC-3 | manual | pi session shows ROUTER line in context | observed | — | literal |  |  |

## Decisions

- 2026-10-09 append to Pi's system prompt, never replace (`forceSystemPrompt` is not used).

## Remaining Work

- [ ] Confirm `event.systemPrompt` / `event.input` field names against the installed Pi version — the shim reads them defensively

## Verification

- 2026-10-09: every deterministic row run by `bun ../BUNKER/Bunker.ts test --isa ISA.md`; judged/attested rows listed as named exceptions.
