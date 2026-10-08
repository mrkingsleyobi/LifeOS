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
| `omniroute/` | Generated OmniRoute combos for the OpenAI lanes |
| `../../hooks/RouterShadow.hook.ts` | UserPromptSubmit hook that runs `resolve` and logs |

## Modes
- **Tiered:** score bands in `lanes.json` pick luna → terra → sol → fable → astra (opus replaces sol for code changes).
- **Combo / Fallback chain:** `fallbackChains` per lane; the OpenAI part is mirrored as OmniRoute `fallbackTier` links.
- **Fusion:** `fusion.enabled` (off). Astra + Fable second opinion for audits, once shadow data justifies it.
- **Private pinned lane:** `privacyGate` runs first. A hit never reaches Jev or OmniRoute and only ever resolves to Anthropic lanes.

## Not verified yet — read before enabling anything
1. **Jev wire format** follows Vercel AI Gateway's documented `/v1/evaluate`; never run live from here. Needs `AI_GATEWAY_API_KEY`. Until set, every decision is `source: heuristic`.
2. **OmniRoute combo schema** comes from one third-party article. Verify field names and provider slugs against your OmniRoute version, then import `omniroute/combos.json`.
3. **OpenAI model IDs** are from the tier-list names, unprobed against `codex`.
4. **Enforcement is dispatch-time only.** A hook cannot change the main-loop model. Moving from shadow to enforce means the Algorithm dispatching `Agent(<Lane>)` per the decision, not the hook.
5. **Weights are a first guess.** Compare `Router.ts audit` to what you actually needed, then tune `lanes.json`.
6. **Anthropic traffic is not routed through OmniRoute** (subscription terms); only the OpenAI lanes are.

Tests: `bun test` in this directory.
