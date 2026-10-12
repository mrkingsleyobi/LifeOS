---
name: Errata
version: 1.0.0
description: "The complaint ledger — capture, VERBATIM, every moment the principal is unhappy with a system we built, then enrich (OpenAI Luna lane, daily) and triage into Upgrades. USE WHEN /er, log this complaint, this is broken again, that annoyed me, file an erratum, errata stats, triage errata, drain app complaints. NOT FOR fixing the bug right now (just fix it, then capture if it recurred), feature ideas (use Upgrade), security findings (use Achilles via Helios)."
---

## Customization

**Before executing, check for user customizations at:**
`~/.claude/LIFEOS/USER/CUSTOMIZATIONS/SKILLS/Errata/`

# Errata

One JSONL line per complaint at `MEMORY/ERRATA/errata.jsonl`. **The principal's words are the record**. They're never paraphrased at capture. Enrichment adds `system`, `severity`, and `theme` later.

## Workflow Routing

| Request | Workflow |
|---|---|
| capture a complaint (`/er …`, or the principal is plainly unhappy with a system) | `Workflows/Capture.md` |
| enrich, triage into Upgrades, pull app reports, stats | `Workflows/Triage.md` |

## Examples

```bash
E=~/.claude/LIFEOS/ERRATA/Errata.ts
bun $E capture "the FB bar said 100% right after the subscription reset" --system StatusLine --session "$SESSION_ID"
bun $E enrich --limit 50            # Luna lane via Router.ts run
bun $E triage er-20261009-1c9830    # → Upgrades record (source: correction)
bun $E pull                         # drain the errata-intake Worker queue
```

## Gotchas

- **Verbatim means verbatim.** Pass the principal's exact words as the capture argument. If the complaint arrived across several messages, join them with ` / `, don't summarize.
- **Name the system** with `--system` when it's obvious (StatusLine, Pulse, Router, a Bunker app name). Enrichment guesses otherwise, and guesses drift.
- **Capture is not the fix.** If the problem is fixable now, fix it, then capture so the recurrence count is honest.
- **Enrichment runs on the OpenAI lane on purpose.** The complaint text is INTERNAL class, cleared for OpenAI. Anything with customer data in it goes `--source er` and is triaged by hand.
