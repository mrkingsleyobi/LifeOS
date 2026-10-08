#!/usr/bin/env bash
# Deploy the LifeOS Workers to Cloudflare. Idempotent: reuses D1 databases and re-deploys Workers.
#
#   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... bash deploy.sh [--dry-run] [--skip-schema]
#   --skip-schema: skip the D1 schema step (already applied; Cloudflare may throttle repeated D1 imports with error 971)
#   (CF_API_TOKEN / CF_ACCOUNT_ID are accepted too.)
#
# The token needs: Workers Scripts:Edit, D1:Edit. (Queues only if you enable the optional queue.)
#
# Everything deploys INERT: no delivery channel, no rater key, no feed sources, email allowlist empty.
# Turn things on afterwards with `wrangler secret put` (see README.md). Per-Worker access tokens are
# generated here and written to ./.deploy-tokens.env (mode 600, gitignored); they are shown nowhere else.
set -euo pipefail
DRY=0; SKIP_SCHEMA=0
for a in "$@"; do case "$a" in --dry-run) DRY=1;; --skip-schema) SKIP_SCHEMA=1;; esac; done
export CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-${CF_API_TOKEN:-}}" CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-${CF_ACCOUNT_ID:-}}"
[ -n "$CLOUDFLARE_API_TOKEN" ] && [ -n "$CLOUDFLARE_ACCOUNT_ID" ] || { echo "set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID" >&2; exit 2; }
WR="bunx wrangler@4.143.1"            # pinned: a release a few weeks old, not whatever is newest
HERE="$(cd "$(dirname "$0")" && pwd)"; ROUTER="$HERE/../ROUTER/worker"
TOKENS="$HERE/.deploy-tokens.env"
say() { printf '\n== %s\n' "$*" >&2; }   # stderr: ensure_db's stdout is captured as the database id
run() { if [ "$DRY" = 1 ]; then echo "[dry-run] $*"; else "$@"; fi; }

db_id() { # name -> uuid (empty if absent)
  curl -sS "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database?name=$1" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | python3 -c "import json,sys; r=[x for x in json.load(sys.stdin).get('result',[]) if x['name']=='$1']; print(r[0]['uuid'] if r else '')"
}
ensure_db() { local id; id="$(db_id "$1")"; if [ -z "$id" ]; then say "create D1 $1"; run $WR d1 create "$1" >/dev/null; id="$(db_id "$1")"; fi; echo "$id"; }

if [ "$DRY" = 1 ]; then AMBER="<amber-id>"; FEED="<feed-id>"; else AMBER="$(ensure_db amber)"; FEED="$(ensure_db feed)"; fi

ADMIN="$(mktemp -d)"; trap 'rm -rf "$ADMIN"' EXIT
if [ "$SKIP_SCHEMA" = 1 ]; then say "skip schemas (--skip-schema)"; else
say "apply schemas (idempotent: CREATE ... IF NOT EXISTS)"
cat > "$ADMIN/wrangler.jsonc" <<JSON
{ "name": "d1-admin", "compatibility_date": "2026-10-01", "d1_databases": [
  { "binding": "AMBER", "database_name": "amber", "database_id": "$AMBER" },
  { "binding": "FEED",  "database_name": "feed",  "database_id": "$FEED" } ] }
JSON
( cd "$ADMIN"
  run $WR d1 execute amber --remote -c wrangler.jsonc --file "$HERE/synapse-capture/schema.sql"
  for s in feed-ingest feed-rate feed-dispatch; do run $WR d1 execute feed --remote -c wrangler.jsonc --file "$HERE/$s/schema.sql"; done )
fi

touch "$TOKENS"; chmod 600 "$TOKENS"
token_for() { # VAR -> value (generated once, reused on re-runs so existing clients keep working)
  grep -q "^$1=" "$TOKENS" || echo "$1=$(openssl rand -hex 32)" >> "$TOKENS"
  grep "^$1=" "$TOKENS" | cut -d= -f2-
}

deploy() { # dir db_id secret_var
  local dir="$1" id="$2" var="$3"
  say "deploy $(basename "$dir")"
  ( cd "$dir"
    [ -f package.json ] && run bun install --frozen-lockfile   # postal-mime / fast-xml-parser must resolve before bundling
    if [ -n "$id" ]; then sed "s/REPLACE_WITH_D1_ID/$id/" wrangler.jsonc > wrangler.deploy.jsonc; else cp wrangler.jsonc wrangler.deploy.jsonc; fi
    trap 'rm -f wrangler.deploy.jsonc' EXIT
    run $WR deploy -c wrangler.deploy.jsonc
    if [ "$DRY" = 1 ]; then echo "[dry-run] set secret $var"; else printf '%s' "$(token_for "$var")" | $WR secret put "$var" -c wrangler.deploy.jsonc >/dev/null; fi )
}
[ -f "$ROUTER/wrangler.jsonc" ] && deploy "$ROUTER" "" ROUTER_TOKEN || echo "(skipping the router Worker: $ROUTER has no wrangler.jsonc)"
deploy "$HERE/synapse-capture"  "$AMBER" CAPTURE_TOKEN
deploy "$HERE/feed-ingest"      "$FEED"  INGEST_TOKEN
deploy "$HERE/feed-rate"        "$FEED"  RATE_TOKEN
deploy "$HERE/feed-route"       ""       FEED_TOKEN
deploy "$HERE/feed-dispatch"    "$FEED"  DISPATCH_TOKEN

say "done"
echo "Tokens: $TOKENS (keep private)."
echo "Turn on, as needed:  wrangler secret put TYPESAFE_API_KEY|AI_GATEWAY_API_KEY (router), RATER_API_KEY + RATER_MODEL var (rate),"
echo "                     DISCORD_WEBHOOK_URL / RESEND_API_KEY+EMAIL_FROM+EMAIL_TO (dispatch), ALLOWED_SENDERS (capture email)."
