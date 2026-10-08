# Router

Decides which lane (model) and effort a prompt deserves. **It can log (`shadow`, the default) or log and advise the session (`advise`). A hook cannot change the model of the session you are typing into, so there is no stronger mode.**

```
prompt → privacy gate (local, deterministic) ─ hit ─► private lane (Anthropic only, no Jev, no gateway)
              │ pass
              ▼
        redact → Jev (11 boolean questions) ─ timeout/incomplete ─► heuristic fallback
              ▼
        Policy: intelligence score → band → lane (+ effort, fallback chain, fusion flag)
              ▼
        MEMORY/OBSERVABILITY/router-shadow.jsonl   (a short hash and sizes, never the prompt text; short or common prompts like "yes" can be guessed from the hash)
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

## Modes: shadow (default) and advise
Set `"mode"` in `lanes.json`.
- **`shadow`**: the hook logs each decision (prompt hash and sizes, never the text) and prints nothing. Use it to see what the router would do.
- **`advise`**: same logging, plus **one line** injected into the session in a `<router-advice>` block, e.g. `ROUTER (advisory): intelligence 0.80 → fable, effort high. Work you delegate fits Agent(Fable) …`. The session then decides whether to dispatch the lane agent; the main-loop model stays whatever you chose with `/model`. The advice is built only from fixed strings and the router's own enums, never from your prompt, so it cannot carry injected text. Light work (chat, simple lookups) gets "handle it inline"; sensitive content gets "keep ALL work on the Anthropic session model".

**Audit what actually happened:** `bun LIFEOS/ROUTER/Router.ts audit --compare` joins the decision log with the dispatch log (`subagent-events.jsonl`) and reports, per lane, how often the first agent dispatched in the same session within 10 minutes matched the advised lane (decisions with no dispatch count as consistent only when inline/private). Use it to tune `lanes.json` weights before trusting `advise` for everything. Installing: the hook ships in `hooks/hooks.json`; it takes effect on your machine when the hooks are installed or upgraded (`InstallHooks.ts`).

## Privacy: sending prompts to Jev is opt-in
Jev is a third party (reached via OpenRouter, TypeSafe or Vercel). The local privacy gate catches credentials, TELOS material, `USER` paths and `.env` references, **not** ordinary personal text, and redaction only strips emails, phone numbers and URLs. So direct egress is **off by default**: a Jev key sitting in your environment does nothing until you set `ROUTER_JEV_EGRESS=on` (or `jev.egress: "on"` in `lanes.json`); until then every decision is `heuristic`. Using the cloud edge (`ROUTER_WORKER_URL`) is its own explicit opt-in, and the Worker has a separate `JEV_EGRESS` var (`on` in `wrangler.jsonc`; set `off` for heuristic-only). `Router.ts status` shows the current state. Found by the 2026-10-08 security review; this repo's own data-classification doctrine allows broker routes for public data only.

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
- **Jev: confirmed through OpenRouter.** `POST /api/alpha/decisions`, model `typesafe/jev-1.13`, `noul` questions with the required `criteria`. Bulk work routed to `luna`, a hard design question to `fable` at high effort (score 0.80), "say thanks" to `luna` (inline), all with `source: jev` at roughly 500-700 ms. The native TypeSafe key (`TYPESAFE_API_KEY`) still returned **401** and the Vercel gateway (`AI_GATEWAY_API_KEY`) **403 `customer_verification_required`**; both are supported but unconfirmed. Credential order is OpenRouter, native, gateway; `JEV_PROVIDER` forces one.
- **OpenAI lane models: confirmed by real completions** (after credits were added): `gpt-6-luna`, `gpt-5.6-terra`, `gpt-6.1-sol` and `gpt-6-astra` each answered correctly under their own IDs via the Chat Completions API, and `gpt-6-luna` also rates feed items correctly both directly and through OpenRouter. The lane agents' execution path was then verified end to end with **Codex CLI 0.160.0**: the repo's own `ForgeProgress.ts` wrapper, with the model resolved by `Lane.ts`, ran `codex exec` against each of the four models and returned `success` in 2-4 s. Luna's `--sandbox read-only` held (a request to create a file was refused and no file appeared). Notes: the wrapper expects the CLI at `~/.bun/bin/codex` (`bun add -g @openai/codex`); a Codex call carries ~12k tokens of overhead, so lane dispatch suits real work, not one-liners. Codex ran here with an API key (`CODEX_API_KEY`); such sessions log `rate_limits: null`, so the statusline's **OAI WK bar only appears for ChatGPT-login (e.g. Max) Codex sessions**. The lane agents themselves were exercised through the wrapper, not through a Claude Code `Agent(...)` dispatch.
- **`gpt-5.6-cyber` (Helios): does not exist for this account.** A real call returned `404 model_not_found`, and no cyber or security model appears in OpenAI's or OpenRouter's lists (133 models on the account). It is an OpenAI Trusted Access model. The `cyber` lane is therefore **disabled** (`lanes.json` `specialtyLanes.cyber.enabled: false`) so the router never advises a model that cannot answer; security work routes by intelligence instead.

## Specialty lane: cyber (Helios) — currently disabled
Not part of the intelligence ladder. **Disabled until the model answers on your account** (see above); flip `specialtyLanes.cyber.enabled` to `true` once it does. When enabled and when Jev's `isSecurityWork` answer is at least 0.6 (`lanes.json` -> `specialtyLanes`) the prompt routes to `cyber` (agent Helios, `gpt-5.6-cyber`, fallback `sol` then `fable`). It is checked **after** the privacy gate and Jev's sensitivity flag, so security work that contains credentials or other sensitive material stays on Anthropic lanes. The router only routes: Helios itself refuses work without authorization context.

## Not verified yet — read before enabling anything
1. **Jev native/gateway flavors**: see above. The native request shape comes from third-party write-ups, not TypeSafe's own API reference.
2. **OmniRoute combo schema** comes from one third-party article. Verify field names and provider slugs against your OmniRoute version, then import `omniroute/combos.json`.
3. **Enforcement is dispatch-time only.** A hook cannot change the main-loop model. Moving from shadow to enforce means the Algorithm dispatching `Agent(<Lane>)` per the decision, not the hook.
4. **Weights are a first guess.** Compare `Router.ts audit` to what you actually needed, then tune `lanes.json`.
5. **Anthropic traffic is not routed through OmniRoute** (subscription terms); only the OpenAI lanes are.

Tests: `bun test` in this directory.
