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
Checked live on 2026-10-08 with the account's own credentials (read-only):
- **OpenAI lane IDs: confirmed.** `gpt-6-astra`, `gpt-6.1-sol`, `gpt-5.6-terra`, `gpt-6-luna` all appear in the account's `GET /v1/models`. (`gpt-5.6-cyber`, the Helios pin, does **not** appear; it is a Trusted Access model that may be hidden from the list.)
- **Jev: still unconfirmed.** The client supports both the native TypeSafe API (`TYPESAFE_API_KEY`, `/v1/systemone`, `noul`) and the Vercel gateway (`AI_GATEWAY_API_KEY`, `/v1/evaluate`, `boolean`). Live results: the native endpoint with the account's `TYPESAFE_API_KEY` returned **401 authentication_error**; the Vercel gateway with `AI_GATEWAY_API_KEY` authenticated but returned **403 `customer_verification_required`** ("requires a valid credit card on file"), and still did after a card was reportedly added (possibly a different Vercel team, or verification pending). Until a call succeeds every decision is `source: heuristic`.

## Not verified yet — read before enabling anything
1. **Jev**: see above. The native request shape comes from third-party write-ups, not TypeSafe's own API reference.
2. **OmniRoute combo schema** comes from one third-party article. Verify field names and provider slugs against your OmniRoute version, then import `omniroute/combos.json`.
3. **Enforcement is dispatch-time only.** A hook cannot change the main-loop model. Moving from shadow to enforce means the Algorithm dispatching `Agent(<Lane>)` per the decision, not the hook.
4. **Weights are a first guess.** Compare `Router.ts audit` to what you actually needed, then tune `lanes.json`.
5. **Anthropic traffic is not routed through OmniRoute** (subscription terms); only the OpenAI lanes are.

Tests: `bun test` in this directory.
