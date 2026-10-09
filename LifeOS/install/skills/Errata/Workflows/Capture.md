# Capture Workflow

1. Take the principal's words exactly as written. That string is the record.
2. Pick `--system` if obvious; omit it if not.
3. `bun ~/.claude/LIFEOS/ERRATA/Errata.ts capture "<verbatim>" [--system X] --session "$SESSION_ID"`
4. Reply with the id in one line. If the same theme already has open errata (`list --open --system X`), say how many: recurrence is the signal.
