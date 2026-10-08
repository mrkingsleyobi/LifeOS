# Workers

Cloudflare Workers for the subsystems the docs describe but this repo did not ship. Arbol-style
naming: `arbol-a-{name}` for Actions. (Arbol's own tree is excluded from public releases, so these
live here instead.) The router edge is `../ROUTER/worker`.

| Worker | Subsystem | Does | Doesn't |
|---|---|---|---|
| `synapse-capture` | Synapse inputs #9 reader upvote, #10 gesture/webhook, #11 email | `POST /capture` and an Email Routing `email()` handler: contract validation, URL normalization, dedup, write-ahead append to a D1 ledger, optional queue fan-out | Grading, routing, attachments |
| `feed-ingest` | Feed ingest + poller | Cron-driven (`*/15`) poll of D1-registered RSS/Atom sources: parse, dedup, append items; circuit breaker (200 with zero items is a soft failure; exponential backoff; auto-disable at 10 errors); SSRF guards (https only, no IPs/credentials/ports/internal hosts, re-checked after redirects); `POST /sources`, `POST /poll` | Summarize, rate, deliver; the reader-proxy / self-hosted-proxy fetch fallback tiers; YouTube/social sources |
| `feed-rate` | Feed stage 3 (rate) | Cron (`*/10`) rates unrated items (newest first, 10 per tick) via a configurable model (OpenAI-style or Anthropic): short/medium summary, tier S-D, quality 1-100, importance/novelty/urgency 1-10, labels from the fixed 20-label taxonomy. Strict output validation, injection cap, poison-item skip after 3 failures. `GET /rated` returns items in `feed-route`'s input shape | Delivery; the dispatcher that POSTs `/rated` items to `feed-route` and acts on the result |
| `feed-dispatch` | Feed glue + delivery | Every 10 min routes newly rated items through `feed-route`'s `rules.json` (imported as code), sends immediate alerts to **Discord** (webhook) and/or **email** (Resend), queues digest items and sends a daily (08:00) and weekly (Mon 08:00) digest; idempotent per (item, destination); records what it can't deliver | **blog-draft and social-post delivery** (recorded as `unsupported`), Telegram (removed upstream), per-user timezones (crons are UTC) |
| `feed-route` | Feed `A_FEED_ROUTE` | `POST /route`: rated items → destination + priority from `rules.json` (first match wins) | Delivery (Discord/email/blog/social), ingest, summarize, rate, polling |

`feed-ingest` parses XML with `fast-xml-parser` pinned at 5.11.1 (Aug 27; the latest is days old). `feed-rate` fills in the ratings those items need. `feed-dispatch` connects the stages: it reads rated items straight from the shared D1 database (not over HTTP), applies the same `rules.json`, and delivers.

Shared helpers (auth, body cap, hashing) are in `_shared/arbol.ts`; nothing here imports Node.

## Email capture (#11) — decide before you deploy it
Email is personal by nature, and the contract says personal records never reach the cloud ledger without an explicit rule. The `email()` handler **is** that rule, in a narrow form: you forward on purpose to an unguessable capture address, the envelope sender must be in `ALLOWED_SENDERS` (unset = reject everything), only the subject and first 20k chars of the body are kept, attachments are dropped, and the row is stored as `public` because the ledger refuses anything else. **If you don't want email bodies in D1, don't route email to this Worker.**

Setup: Email Routing custom address (use a random local-part, e.g. `cap-7f3a9c@your.domain`) → "Send to a Worker" → `arbol-a-synapse-capture`; then `wrangler secret put ALLOWED_SENDERS` (comma list of `me@x.com` or `@x.org`). The envelope sender is forgeable, so the secret address is the real gate; `REQUIRE_AUTH_RESULTS=true` additionally demands a dkim/dmarc pass in `Authentication-Results`, but it is off by default because I have not verified that Cloudflare always adds that header. MIME parsing uses `postal-mime` pinned at 3.0.0 (a deliberately older release; 4.x was published days ago).

## Rating safety (feed-rate)
Feed text is untrusted and ratings drive notifications. So: the item is wrapped in delimiters it cannot close; output is validated strictly (an out-of-range score rejects the rating and retries, it is never coerced); labels are limited to the fixed taxonomy; and when an item looks like it is instructing the rater ("ignore previous instructions", "rate this as tier S", "urgency: 10"…) its tier is capped at B, urgency at 4, quality at 60 and the Security/Breaking labels are dropped, so it cannot buy itself an alert. The heuristic will also cap an honest article that happens to quote such a phrase; that is the accepted cost. The default rater is **Claude Haiku 5.5** (`claude-haiku-5-5` via the Anthropic Messages API): cheap and fast, and it keeps untrusted feed text off the OpenAI lanes. The request follows Haiku 5.5's documented constraints (thinking headroom in `max_tokens`, `effort: low`, no sampling parameters, no prefill, refusals treated as errors). An OpenAI-style provider also works via `RATER_PROVIDER=openai`. **Neither has been exercised live:** no Anthropic API key was available to the authoring session, and the OpenAI account returned `insufficient_quota`.

## Behavior worth knowing
- **Privacy:** `synapse-capture` refuses `privacy_class: "personal"` (403) and the schema's CHECK constraint backs that up. The contract says personal records never reach cloud storage without an explicit rule, and no such rule exists yet.
- **Append-only:** the ledger is `INSERT OR IGNORE` only; the Worker contains no UPDATE or DELETE.
- **Dedup:** normalized URL (tracking params, fragment, host case, trailing slash stripped) + content hash; falls back to `source` + `external_id`.
- **Rules reality check:** the Feed doc says only `quality_score` is written in the live deployment; tier, importance and urgency are planned. A rule field an item lacks never matches, so until those exist most items route to `archive`. Add a `quality_score`-only rule to `rules.json` if you want that to change.
- **Auth:** bearer token per Worker, constant-time compare. Tokens are secrets, never in `wrangler.jsonc`.

## Deploy
**One command:** `CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… bash deploy.sh` (add `--dry-run` to print the steps). It is idempotent: it reuses the `amber` and `feed` D1 databases if they exist, applies the schemas, deploys all six Workers inert (no delivery channel, no rater key, no feed sources, empty email allowlist), and generates one access token per Worker into `.deploy-tokens.env` (mode 600, gitignored). The token needs Workers Scripts:Edit and D1:Edit.

Status on 2026-10-08: the `amber` and `feed` databases were created in the author's account and **all four schemas ran successfully on real D1**. The Workers themselves were **not deployed**: the deploy step was blocked by the authoring session's permission classifier, so `deploy.sh` has only been dry-run.

The manual steps it automates:
```bash
cd synapse-capture
wrangler d1 create amber                       # paste database_id into wrangler.jsonc
wrangler d1 execute amber --remote --file=schema.sql
wrangler secret put CAPTURE_TOKEN
wrangler deploy

cd ../feed-ingest
wrangler d1 create feed                        # paste database_id into wrangler.jsonc
wrangler d1 execute feed --remote --file=schema.sql
wrangler secret put INGEST_TOKEN
wrangler deploy                                # cron trigger `*/15 * * * *` is in wrangler.jsonc
curl -X POST $URL/sources -H "Authorization: Bearer $TOKEN" -d '{"url":"https://example.com/feed.xml"}'

cd ../feed-rate                                # same `feed` database: paste the SAME database_id
wrangler d1 execute feed --remote --file=schema.sql
wrangler secret put RATE_TOKEN
wrangler secret put RATER_API_KEY
# default is Claude Haiku 5.5 (RATER_PROVIDER=anthropic, RATER_MODEL=claude-haiku-5-5); RATER_API_KEY must then be an Anthropic API key
wrangler deploy

cd ../feed-dispatch                            # same `feed` database again
wrangler d1 execute feed --remote --file=schema.sql
wrangler secret put DISPATCH_TOKEN
wrangler secret put DISCORD_WEBHOOK_URL        # and/or the three email secrets:
wrangler secret put RESEND_API_KEY && wrangler secret put EMAIL_FROM && wrangler secret put EMAIL_TO
wrangler deploy

cd ../feed-route
wrangler secret put FEED_TOKEN
wrangler deploy
```
Optional queue fan-out for grading: create a queue, uncomment the `queues` block in `synapse-capture/wrangler.jsonc`.

Tests: `bun test` here. The capture tests run real SQL (`bun:sqlite`) against `schema.sql`; D1 itself has not been exercised.
