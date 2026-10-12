# LifeOS on Cloudflare Workers

The subsystems that must keep running while the laptop sleeps, or that need a front door the laptop can't provide. Upstream keeps the equivalent code private (`LIFEOS/ARBOL/**`, `LIFEOS/PULSE/Bunker/**`, Lockbox "designed, not built"). This directory is this install's own build of it. It sits in the `private-infra` containment zone and never ships in a public release.

| Worker | Subsystem | Triggers | Storage | Laptop side |
|--------|-----------|----------|---------|-------------|
| `bunker-health` | Bunker observability + security planes | cron */5 (deep + security hourly) | KV `BUNKER` | `bun LIFEOS/BUNKER/Bunker.ts sync-cloud` |
| `arbol` | Arbol: Actions → Pipelines → Flows | cron every minute, per-flow cron in `src/flows.ts` | KV `ARBOL` | none (fully cloud) |
| `router-edge` | Router for non-laptop doors (Hermes, phone, Codex/Pi) | HTTP | D1 `lifeos-router`, KV `ROUTER_KV` | pushes quota via `PUT /quota` |
| `errata-intake` | Errata app door | HTTP | D1 `lifeos-errata` | `bun LIFEOS/ERRATA/Errata.ts pull` |
| `lockbox` | Lockbox, the MCP door (read / ask / act) | HTTP `POST /mcp` | KV `LOCKBOX`, service bindings → bunker-health, router-edge | `bun LIFEOS/LOCKBOX/Relay.ts serve` behind a Cloudflare Tunnel |

Shared code: `shared/edge.ts` (Jev at the edge, bearer + Access JWT auth, constant-time compare) and `shared/probes.ts` (ISA Test Strategy parser + probe evaluator + security scan, the SAME code `Bunker.ts` runs locally). The router-edge Worker bundles `LIFEOS/ROUTER/Score.ts`, so the edge and the hook route identically.

## Deploy (order matters for the service bindings)

```bash
cd ~/.claude/LIFEOS/CLOUDFLARE
npm ci                     # wrangler 4.140.0, workers-types 5.20260924.1, typescript 5.9.3 (pinned)
npm run typecheck && bun test edge.test.ts

# 1. storage
npx wrangler kv namespace create BUNKER      # → id into workers/bunker-health/wrangler.toml
npx wrangler kv namespace create ARBOL       # → workers/arbol/wrangler.toml
npx wrangler kv namespace create ROUTER_KV   # → workers/router-edge/wrangler.toml
npx wrangler kv namespace create LOCKBOX     # → workers/lockbox/wrangler.toml
npx wrangler d1 create lifeos-router  && npx wrangler d1 execute lifeos-router --remote --file workers/router-edge/schema.sql
npx wrangler d1 create lifeos-errata  && npx wrangler d1 execute lifeos-errata --remote --file workers/errata-intake/schema.sql

# 2. secrets (each: npx wrangler secret put NAME -c workers/<w>/wrangler.toml)
#   bunker-health: MANIFEST_TOKEN [ALERT_WEBHOOK]
#   arbol:         ARBOL_TOKEN OPENROUTER_API_KEY OPENAI_API_KEY ANTHROPIC_API_KEY [BRIEF_WEBHOOK]
#   router-edge:   ROUTER_TOKEN OPENROUTER_API_KEY [TYPESAFE_API_KEY]
#   errata-intake: APP_KEYS DRAIN_TOKEN
#   lockbox:       CLIENTS RELAY_SECRET RELAY_ACCESS_ID RELAY_ACCESS_SECRET CONFIRM_WEBHOOK ROUTER_TOKEN

# 3. deploy — bindings first, Lockbox last
npm run deploy:bunker && npm run deploy:router && npm run deploy:errata && npm run deploy:arbol && npm run deploy:lockbox

# 4. wire the laptop (~/.claude/.env)
#   LIFEOS_BUNKER_URL / LIFEOS_BUNKER_TOKEN            → bun LIFEOS/BUNKER/Bunker.ts sync-cloud
#   LIFEOS_ERRATA_INTAKE_URL / LIFEOS_ERRATA_INTAKE_TOKEN
#   LOCKBOX_RELAY_SECRET (≥24 chars, same as the Worker's RELAY_SECRET)
```

## Lockbox remote reach

```
client ──MCP──▶ lockbox Worker ──(Access service token + RELAY_SECRET)──▶ Cloudflare Tunnel ──▶ 127.0.0.1:31338 Relay.ts ──▶ claude -p
                                                                                                                    └─ RouterFrontDoor hook routes it
```

- **read**: snapshots the laptop publishes to KV `snapshot:<section>` (`telos`, `work`, `upcoming`, `health-trends`), `bunker.status`, `router.route`.
- **ask**: `da.ask`. When the tunnel is down the question is queued in KV, and `bun Relay.ts drain` answers the queue on reconnect.
- **act**: `act.request` sends a 6-digit code to the principal's phone (`CONFIRM_WEBHOOK`). Only `act.confirm` with that code runs the allowlisted action on the laptop. The calling client never sees the code.

## What never runs here

- The **Private Pinned Lane**. Sensitive data is local-only by definition. Arbol's `A_LLM` refuses `private`. router-edge answers a private-lane decision with `onDevice` instead of routing it.
- **People / Vera** data. Those ledgers are RESTRICTED and stay in the USER tree.
