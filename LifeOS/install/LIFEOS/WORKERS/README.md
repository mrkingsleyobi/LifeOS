# Workers

Cloudflare Workers for the subsystems the docs describe but this repo did not ship. Arbol-style
naming: `arbol-a-{name}` for Actions. (Arbol's own tree is excluded from public releases, so these
live here instead.) The router edge is `../ROUTER/worker`.

| Worker | Subsystem | Does | Doesn't |
|---|---|---|---|
| `synapse-capture` | Synapse inputs #9 reader upvote, #10 gesture/webhook, #11 email | `POST /capture` and an Email Routing `email()` handler: contract validation, URL normalization, dedup, write-ahead append to a D1 ledger, optional queue fan-out | Grading, routing, attachments |
| `feed-route` | Feed `A_FEED_ROUTE` | `POST /route`: rated items → destination + priority from `rules.json` (first match wins) | Delivery (Discord/email/blog/social), ingest, summarize, rate, polling |

Shared helpers (auth, body cap, hashing) are in `_shared/arbol.ts`; nothing here imports Node.

## Email capture (#11) — decide before you deploy it
Email is personal by nature, and the contract says personal records never reach the cloud ledger without an explicit rule. The `email()` handler **is** that rule, in a narrow form: you forward on purpose to an unguessable capture address, the envelope sender must be in `ALLOWED_SENDERS` (unset = reject everything), only the subject and first 20k chars of the body are kept, attachments are dropped, and the row is stored as `public` because the ledger refuses anything else. **If you don't want email bodies in D1, don't route email to this Worker.**

Setup: Email Routing custom address (use a random local-part, e.g. `cap-7f3a9c@your.domain`) → "Send to a Worker" → `arbol-a-synapse-capture`; then `wrangler secret put ALLOWED_SENDERS` (comma list of `me@x.com` or `@x.org`). The envelope sender is forgeable, so the secret address is the real gate; `REQUIRE_AUTH_RESULTS=true` additionally demands a dkim/dmarc pass in `Authentication-Results`, but it is off by default because I have not verified that Cloudflare always adds that header. MIME parsing uses `postal-mime` pinned at 3.0.0 (a deliberately older release; 4.x was published days ago).

## Behavior worth knowing
- **Privacy:** `synapse-capture` refuses `privacy_class: "personal"` (403) and the schema's CHECK constraint backs that up. The contract says personal records never reach cloud storage without an explicit rule, and no such rule exists yet.
- **Append-only:** the ledger is `INSERT OR IGNORE` only; the Worker contains no UPDATE or DELETE.
- **Dedup:** normalized URL (tracking params, fragment, host case, trailing slash stripped) + content hash; falls back to `source` + `external_id`.
- **Rules reality check:** the Feed doc says only `quality_score` is written in the live deployment; tier, importance and urgency are planned. A rule field an item lacks never matches, so until those exist most items route to `archive`. Add a `quality_score`-only rule to `rules.json` if you want that to change.
- **Auth:** bearer token per Worker, constant-time compare. Tokens are secrets, never in `wrangler.jsonc`.

## Deploy (not done — no Cloudflare credentials in the authoring session)
```bash
cd synapse-capture
wrangler d1 create amber                       # paste database_id into wrangler.jsonc
wrangler d1 execute amber --remote --file=schema.sql
wrangler secret put CAPTURE_TOKEN
wrangler deploy

cd ../feed-route
wrangler secret put FEED_TOKEN
wrangler deploy
```
Optional queue fan-out for grading: create a queue, uncomment the `queues` block in `synapse-capture/wrangler.jsonc`.

Tests: `bun test` here. The capture tests run real SQL (`bun:sqlite`) against `schema.sql`; D1 itself has not been exercised.
