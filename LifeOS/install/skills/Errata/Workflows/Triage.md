# Triage Workflow

1. `bun ~/.claude/LIFEOS/ERRATA/Errata.ts pull` when `LIFEOS_ERRATA_INTAKE_URL` is set (app reports).
2. `enrich` adds system/severity/theme on the Luna lane.
3. `list --open`, then group by theme. A theme with ≥2 open errata is one Upgrades record, not several: `triage <id> --claim "<one-sentence change>"` on the clearest instance, then mark the rest with the same claim.
4. Report: new, triaged, themes recurring this week.
