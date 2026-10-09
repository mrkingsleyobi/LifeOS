# Gate Workflow

Add a new decision caller

Any new code path that makes a fuzzy call becomes a **caller** in `USER/CONFIG/decisions.json`: `{ id, purpose, mode: "shadow", threshold, budget }`. It runs in SHADOW, logging verdicts to `MEMORY/OBSERVABILITY/decisions.jsonl` without acting, until `outcome` labels show agreement. Then `enforce --agreement N --model M`. If the Jev model changes, the caller drops back to SHADOW automatically.
