---
task: "One MCP door into LifeOS"
slug: 20261009-lockbox
phase: complete
progress: 3/3
started: 2026-10-09T13:30:00Z
updated: 2026-10-09T13:30:00Z
parent: 20261009-as3
---

# Lockbox — ISA

## Problem

Every non-terminal client (Hermes, phone, outside agents) needed its own bespoke way in, each with its own auth story.

## Vision

One MCP endpoint; a client sees only the tools its scope grants; acting needs a code that only reaches the principal's phone.

## Constraints

Three scopes (read/ask/act). Act is confirmed server-side; the client never sees the code. The relay listens on loopback only and requires a ≥24-char secret.

## Goal

Clients speak MCP to Lockbox, see tools by scope, ask the DA through the tunnel (queued when offline), and act only with out-of-band confirmation.

## Claims

- [x] ISC-1: Anti: the relay refuses to start without a strong secret.
- [x] ISC-2: Tools are filtered by scope; act tools invisible to a read/ask client; da.ask queues offline.
- [x] ISC-3: The Worker typechecks under strict Workers types.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity | tier |
|-----|------|-------|-----------|------|------------|----------|------|
| ISC-1 | bash | serve without secret exits 2 | exit 2 → probe inverts | ! LOCKBOX_RELAY_SECRET= timeout 5 bun Relay.ts serve | derived: auth | critical |  |
| ISC-2 | manual | wrangler dev JSON-RPC session | observed | — | literal |  |  |
| ISC-3 | bash | tsc over CLOUDFLARE | exit 0 | cd ../CLOUDFLARE && npx tsc -p tsconfig.json --noEmit | cross: 20261009-arbol |  | deep |

## Decisions

- 2026-10-09 Lockbox reaches Bunker and the router over service bindings, never public URLs.

## Verification

- 2026-10-09: every deterministic row run by `bun ../BUNKER/Bunker.ts test --isa ISA.md`; judged/attested rows listed as named exceptions.
