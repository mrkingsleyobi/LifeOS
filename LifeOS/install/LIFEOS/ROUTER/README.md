# Router

Decides which lane (model) and effort a prompt deserves. **Shadow mode: it logs, it does not enforce.**

```
prompt → privacy gate (local, deterministic) ─ hit ─► private lane (Anthropic only, no Jev, no gateway)
              │ pass
              ▼
        redact → Jev (11 boolean questions) ─ timeout/incomplete ─► heuristic fallback
              ▼
        Policy: intelligence score → band → lane (+ effort, fallback chain, fusion flag)
              ▼
        MEMORY/OBSERVABILITY/router-shadow.jsonl   (hash + sizes, never the prompt)
```

| File | Role |
|---|---|
| `lanes.json` | All tunables: bands, weights, effort cutoffs, fallback chains, fusion, private lane |
| `Policy.ts` | Pure decision logic and the privacy gate |
| `Jev.ts` | Jev client (11 questions, one call) |
| `Router.ts` | CLI: `resolve`, `lanes`, `status`, `audit` |
| `JevCore.ts`, `Config.ts` | Wire call with no node imports (shared with the Worker) / node-side config + hashing |
| `worker/` | `arbol-a-router-decide`: Cloudflare Worker edge running the same Policy + Jev, so the Jev key stays off your machine |
| `omniroute/` | Generated OmniRoute combos for the OpenAI lanes |
| `../../hooks/RouterShadow.hook.ts` | UserPromptSubmit hook that runs `resolve` and logs |

## Modes
- **Tiered:** score bands in `lanes.json` pick luna → terra → sol → fable → astra (opus replaces sol for code changes).
- **Combo / Fallback chain:** `fallbackChains` per lane; the OpenAI part is mirrored as OmniRoute `fallbackTier` links.
- **Fusion:** `fusion.enabled` (off). Astra + Fable second opinion for audits, once shadow data justifies it.
- **Private pinned lane:** `privacyGate` runs first. A hit never reaches Jev or OmniRoute and only ever resolves to Anthropic lanes.

## Cloud edge (Cloudflare Worker)
`worker/` is an Arbol-style Action Worker (`arbol-a-router-decide`): `POST /route` with a bearer token returns the same decision JSON as `Router.ts resolve`. Stateless, no storage, the prompt is never logged.

```bash
cd LIFEOS/ROUTER/worker
wrangler secret put ROUTER_TOKEN          # shared secret the client sends
wrangler secret put AI_GATEWAY_API_KEY    # Jev key lives here, not on the laptop
wrangler deploy
# then on the client:
export ROUTER_WORKER_URL=https://arbol-a-router-decide.<subdomain>.workers.dev
export ROUTER_WORKER_TOKEN=<same token>
```

**Privacy contract:** the client runs the privacy gate locally first; a prompt that hits it is never sent to the Worker. The Worker re-checks as a second line of defense, but by then the text has already left the machine. With no `ROUTER_WORKER_URL` set nothing changes: direct Jev, then heuristic.

Status: unit-tested with a mocked Jev, bundles to ~9 KB with no node imports, typechecks. **Not deployed** — no Cloudflare credentials in this session.

## Verification status
Checked live on 2026-10-08 with the account's own credentials:
- **Jev: confirmed through OpenRouter.** `POST /api/alpha/decisions`, model `typesafe/jev-1.13`, `noul` questions with the required `criteria`. Bulk work routed to `luna`, a hard design question to `fable` at high effort (score 0.80), "say thanks" to `luna`, and a defensive-CTF security prompt to `cyber`, all with `source: jev` at roughly 500-700 ms (one cold call hit the 1.5 s timeout and fell back to the heuristic, as designed). The native TypeSafe key (`TYPESAFE_API_KEY`) still returned **401** and the Vercel gateway (`AI_GATEWAY_API_KEY`) **403 `customer_verification_required`**; both are supported but unconfirmed. Credential order is OpenRouter, native, gateway; `JEV_PROVIDER` forces one.
- **OpenAI lane IDs: confirmed** in the account's `GET /v1/models` and in OpenRouter's catalog: `gpt-6-astra`, `gpt-6.1-sol`, `gpt-5.6-terra`, `gpt-6-luna`.
- **`gpt-5.6-cyber` (Helios): not found in either catalog.** It is an OpenAI Trusted Access model, so it may be hidden; its pin is unverified. It is now a routable specialty lane (below).
- OpenAI API calls currently fail with `insufficient_quota` (no API credits); a ChatGPT subscription does not add API credits, though it does cover the Codex CLI.

## Specialty lane: cyber (Helios)
Not part of the intelligence ladder. When Jev's `isSecurityWork` answer is at least 0.6 (`lanes.json` -> `specialtyLanes`) the prompt routes to `cyber` (agent Helios, `gpt-5.6-cyber`, fallback `sol` then `fable`). It is checked **after** the privacy gate and Jev's sensitivity flag, so security work that contains credentials or other sensitive material stays on Anthropic lanes. The router only routes: Helios itself refuses work without authorization context.

## Not verified yet — read before enabling anything
1. **Jev native/gateway flavors**: see above. The native request shape comes from third-party write-ups, not TypeSafe's own API reference.
2. **OmniRoute combo schema** comes from one third-party article. Verify field names and provider slugs against your OmniRoute version, then import `omniroute/combos.json`.
3. **Enforcement is dispatch-time only.** A hook cannot change the main-loop model. Moving from shadow to enforce means the Algorithm dispatching `Agent(<Lane>)` per the decision, not the hook.
4. **Weights are a first guess.** Compare `Router.ts audit` to what you actually needed, then tune `lanes.json`.
5. **Anthropic traffic is not routed through OmniRoute** (subscription terms); only the OpenAI lanes are.

Tests: `bun test` in this directory.
