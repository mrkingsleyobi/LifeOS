---
name: Jev
version: 1.0.0
description: "Ask TypeSafe's Jev decision model typed questions and get probabilities back instead of prose — yes/no (noul), pick-one (choice, ≤255 options), rubric (score, 2–10 levels). The engine under the Router and the Decisions system. USE WHEN classify this, is this X, which of these, score against a rubric, gate a decision, judge outputs, triage a list, route this work, which model should run this, explain the router's pick, register a decision caller, shadow vs enforce, decisions report. NOT FOR generating text, explanations, or anything needing free-form output (Jev cannot write); NOT FOR content routed to the private lane."
---

## Customization

**Before executing, check for user customizations at:**
`~/.claude/LIFEOS/USER/CUSTOMIZATIONS/SKILLS/Jev/`

If this directory exists, load and apply any `PREFERENCES.md` or additional reference files found there. These override default behavior.

# Jev — judgment as a tool

Jev answers **typed questions** with **calibrated probabilities**. It never writes prose. A call costs ~$0.00004 and takes ~0.3–1s. Use it wherever code or the DA would otherwise make a fuzzy call by vibes: classification, gating, triage, rubric scoring, routing.

The DA and Jev split the work. Jev decides fast and cheap. The DA does what Jev can't: reading files, writing answers, explaining.

## The three primitives

| Type | Ask | Get back |
|------|-----|----------|
| `noul` | a yes/no question | `noul`: P(yes), 0–1 |
| `choice` | pick one of up to 255 options (name → description) | `choice`, `probabilities` per option, `confidence` |
| `score` | place content on a 2–10 level rubric (least → most) | `score` (can be fractional), `probabilities`, `confidence` |

## Tools

```bash
J=~/.claude/LIFEOS/DECISIONS/Jev.ts
bun $J ping                                                       # which transport is live
bun $J noul   "<state>" "Does this email ask for a refund?"
bun $J choice "<state>" "Which team owns this ticket?" billing="payments, invoices" infra="servers, deploys" product="features, UX"
bun $J score  "<state>" "How production-ready is this PR?" "broken" "works locally" "tested" "reviewed+tested" "shippable"

R=~/.claude/LIFEOS/ROUTER/Router.ts
bun $R resolve "<prompt>"          # which lane/model/effort/strategy the Router would pick, with reasons
bun $R lanes                       # the lane table
bun $R status                      # last decision + Anthropic 5H/WK/FB + OpenAI WK quotas
bun $R audit                       # lane mix, fallback rate, wiring check

D=~/.claude/LIFEOS/DECISIONS/Decisions.ts
bun $D status | report | alerts | drift
bun $D enforce <caller> --agreement 0.91 --model jev-1.13   # promote a measured caller
bun $D shadow <caller>
bun $D outcome <ledger-id> agree|disagree                   # label a past call (builds agreement)
```

From TypeScript, import `ask` from `LIFEOS/DECISIONS/Jev.ts`. The answer types are inferred from the question types.

## Workflow Routing

| Request | Workflow |
|---|---|
| one yes/no, pick-one, or rubric judgment | `Workflows/Ask.md` |
| grade or triage many items | `Workflows/Judge.md` |
| explain or override the Router's pick | `Workflows/Route.md` |
| turn a fuzzy code path into a governed caller | `Workflows/Gate.md` |

## Examples

```bash
# Gate: is this inbound email a sales pitch? Act only above 0.8.
bun ~/.claude/LIFEOS/DECISIONS/Jev.ts noul "$(cat email.txt)" "Is \`state\` an unsolicited sales pitch?"

# Triage: route a support ticket to a team
bun ~/.claude/LIFEOS/DECISIONS/Jev.ts choice "$TICKET" "Which team owns this?" billing="payments, invoices" infra="outages, deploys" product="features, UX"

# Why did the Router send my last prompt to Terra?
bun ~/.claude/LIFEOS/ROUTER/Router.ts resolve "Rewrite these 60 job descriptions into our template"
```

## Gotchas

- **Jev cannot explain itself.** If the principal asks *why*, the explanation comes from the question design and the probabilities, never from Jev. Don't present a made-up rationale as Jev's.
- **The answer space must be closed.** A `choice` without an "other / none of these" option forces a pick even when nothing fits. Add one whenever inputs can fall outside the list.
- **Probabilities are not certainty.** A noul at 0.55 is a coin flip with a lean. The Router's own gate is 0.5 for hand-off and 0.6 for the private lane, so borderline cases fall back to safe defaults.
- **Bulk is not exhaustive.** Jev reads "process 300 SDS sheets" as high on both `bulk` and `exhaustive`. The Router caps bulk at Terra on purpose. Don't "fix" a bulk job up to Astra.
- **Headless keys.** Hooks don't always inherit the shell env. Keys belong in `~/.claude/.env`, which Jev.ts reads directly.
- **A 401 benches a transport for an hour.** After rotating a key, delete `~/.cache/lifeos-statusline/jev-benched-*` to retry right away.

## Boundaries

- **Never send private-lane content to Jev.** Jev.ts refuses credential-shaped state on its own. Personal, medical, financial and customer data is the private lane's job, and the Router pins it before Jev sees anything.
- Emails and phone numbers are redacted before every call. OpenRouter calls carry `zdr: true, data_collection: "deny"`.
- Keys: `TYPESAFE_API_KEY` and/or `OPENROUTER_API_KEY` in `~/.claude/.env`. TypeSafe is tried first. A transport that returns 401/403 is benched for an hour and the next one is tried.
