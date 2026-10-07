#!/usr/bin/env bash
# Runs wrangler as the ntwrk.love Cloudflare account, isolated from other wrangler logins.
# Login once with: XDG_CONFIG_HOME=$HOME/.config/wrangler-ntwrk npx wrangler login
#
# Deploy guard (audit P1-13): nothing may be deployed to ntwrk.love (including mcp.ntwrk.love)
# without founder approval. `deploy`, `publish`, `versions upload/deploy`, `rollback`, `delete`,
# `triggers deploy`, secret writes and other commands that change Cloudflare resources are refused
# unless NTWRK_ALLOW_DEPLOY=1 is set. `deploy --dry-run` and read-only commands (whoami, dev,
# tail, types, list/get/info) always run.
set -euo pipefail

export XDG_CONFIG_HOME="$HOME/.config/wrangler-ntwrk"
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-50ad2052bbc6ca528d6993a689b419a4}"

# Positional words (subcommands), lowercased; flags and their values are ignored except --dry-run.
words=()
dry_run=0
for a in "$@"; do
  case "$a" in
    --dry-run|--dry-run=true) dry_run=1 ;;
    -*) ;;
    *) words+=("$(printf '%s' "$a" | tr '[:upper:]' '[:lower:]')") ;;
  esac
done
cmd="${words[0]:-}"
rest=" ${words[*]:1} "

mutating=0
case "$cmd" in
  deploy|publish)
    [ "$dry_run" = 1 ] || mutating=1 ;;
  delete|rollback)
    mutating=1 ;;
  versions)
    case "$rest" in
      *" upload "*) [ "$dry_run" = 1 ] || mutating=1 ;;
      *" deploy "*|*" secret "*) mutating=1 ;;
    esac ;;
  triggers|secret|secrets|secret:bulk|kv|kv:namespace|kv:key|kv:bulk|r2|d1|queues|pages|vectorize|hyperdrive|\
  dispatch-namespace|workflows|mtls-certificate|cert|secrets-store|pipelines|containers|route|routes|domains|ai)
    case "$rest" in
      *" put "*|*" create "*|*" delete "*|*" upload "*|*" deploy "*|*" bulk "*|*" execute "*|*" apply "*|\
      *" update "*|*" set "*|*" unset "*|*" insert "*|*" upsert "*|*" publish "*|*" rollback "*|*" add "*|*" remove "*)
        mutating=1 ;;
    esac
    # `wrangler secret put X`, `kv:key put`, `secret:bulk file.json`: the verb may be the first word.
    case "$cmd" in secret:bulk|kv:bulk) mutating=1 ;; esac ;;
esac

if [ "$mutating" = 1 ]; then
  if [ "${NTWRK_ALLOW_DEPLOY:-}" = "1" ]; then
    echo "scripts/wrangler.sh: NTWRK_ALLOW_DEPLOY=1 set; running mutating command: wrangler $*" >&2
  else
    cat >&2 <<MSG
scripts/wrangler.sh: refusing to run 'wrangler $*': it changes Cloudflare resources for ntwrk.love.
Deploys (including mcp.ntwrk.love) need founder approval first. Use --dry-run to check a deploy,
or, once approved, re-run with NTWRK_ALLOW_DEPLOY=1.
MSG
    exit 3
  fi
fi

exec npx -y wrangler "$@"
