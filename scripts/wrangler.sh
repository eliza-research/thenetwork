#!/usr/bin/env bash
# Runs a pinned wrangler as the ntwrk.love Cloudflare account, isolated from other wrangler logins.
# Login once with: XDG_CONFIG_HOME=$HOME/.config/wrangler-ntwrk ./scripts/wrangler.sh login
#
# Deploy guard (audit P1-13, sites-infra-4): nothing may be deployed or changed in Cloudflare without
# founder approval. This is an ALLOWLIST: only the read-only commands below run without approval.
# Every other command (deploy, versions upload, secret put, delete, kv/r2/d1 writes, anything new)
# exits 3 unless NTWRK_ALLOW_DEPLOY=1 is set. Flags may come before the command and may take a value
# ("--config x deploy"): a word the guard cannot place is treated as the command, so it fails closed.
#
# Read-only, always allowed:
#   whoami, login, logout, dev and pages dev (local only: never --remote), tail, types, docs, help, version (and --version, -v, --help, -h)
#   deploy --dry-run, versions upload --dry-run (the last --dry-run / --no-dry-run wins, as in wrangler)
#   <noun> list|view|get|info|status: versions, deployments, secret, kv, r2, d1, pages, queues,
#     vectorize, hyperdrive, workflows, containers, pipelines (kv key/namespace, r2 bucket/object,
#     pages project/deployment take one more noun first)
#
# The four sites are Cloudflare Pages projects in this account (founder decision 8): ntwrk-love,
# slop-date, peon-biz, friends-help. CLOUDFLARE_ACCOUNT_ID selects the account (required).
set -euo pipefail

# Pinned: the same version as WRANGLER_VERSION in .github/workflows/deploy-sites.yml (a test checks).
WRANGLER_VERSION="4.136.3"

export XDG_CONFIG_HOME="$HOME/.config/wrangler-ntwrk"
# The Eliza Labs Cloudflare account id comes from the environment (.env or the shell); no default here.
if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then echo "wrangler.sh: set CLOUDFLARE_ACCOUNT_ID (the Eliza Labs Cloudflare account id)" >&2; exit 2; fi
export CLOUDFLARE_ACCOUNT_ID

# Flags that take the next word as their value, and switches that never do. A flag on neither list is
# read both ways, and the command runs only if both readings are on the read-only list (fail closed:
# "--some-new-flag deploy whoami" must not slip a deploy past the guard).
value_flag() {
  case "$1" in
    -c|--config|-e|--env|--cwd|--env-file|--account-id|--name|--outdir|--outfile|--compatibility-date|\
    --compatibility-flags|--compatibility-flag|--log-level|--message|--tag|--preview-alias|--var|--define|\
    --alias|--assets|--site|--route|--routes|--port|--ip|--inspector-port|--local-protocol|--format|--search|\
    --status|--header|--method|--sampling-rate|--version-id|--deployment-id|--binding|--namespace-id|--path|\
    --file|--persist-to|--host|--local-upstream) return 0 ;;
    *) return 1 ;;
  esac
}
switch_flag() {
  case "$1" in
    --dry-run|--help|-h|--version|-v|--remote|--local|--json|--latest|--minify|--no-bundle|--keep-vars|\
    --live-reload|--show-interactive-dev-session|--experimental-json-config|--x-versions|--yes|-y|--force) return 0 ;;
    *) return 1 ;;
  esac
}

is_read_verb() { case "$1" in list|view|get|info|status) return 0 ;; *) return 1 ;; esac; }

# decide <mode> ARGS...: prints 1 when the command is read-only. mode "switch" reads unknown flags as
# switches; mode "value" reads them as taking the next word.
decide() {
  local mode="$1"; shift
  local words=() dry_run=0 remote=0 help=0 skip_next=0 a
  for a in "$@"; do
    if [ "$skip_next" = 1 ]; then skip_next=0; continue; fi
    case "$a" in
      # wrangler (yargs) takes the LAST value of a switch: "--dry-run --no-dry-run" is a real deploy.
      --dry-run|--dry-run=true) dry_run=1 ;;
      --no-dry-run|--dry-run=*) dry_run=0 ;;
      # "dev --remote" runs on Cloudflare (it uploads to the account): not read-only.
      --remote|--remote=true|-r) remote=1 ;;
      --no-remote|--remote=*) remote=0 ;;
      --help|-h) help=1 ;;
      --*=*) ;;
      -*)
        if value_flag "$a"; then skip_next=1
        elif switch_flag "$a"; then :
        elif [ "$mode" = value ]; then skip_next=1; fi ;;
      *) words+=("$(printf '%s' "$a" | tr '[:upper:]' '[:lower:]')") ;;
    esac
  done
  local cmd="${words[0]:-}" w1="${words[1]:-}" w2="${words[2]:-}" ok=0
  case "$cmd" in
    "") ok=1 ;;  # bare flags such as --version or --help only print
    whoami|login|logout|tail|types|docs|help|version) ok=1 ;;
    dev) [ "$remote" = 0 ] && ok=1 ;;
    deploy) [ "$dry_run" = 1 ] && ok=1 ;;
    versions|deployments|secret|queues|vectorize|hyperdrive|workflows|containers|pipelines|d1)
      if [ "$cmd" = versions ] && [ "$w1" = upload ] && [ "$dry_run" = 1 ]; then ok=1
      elif is_read_verb "$w1"; then ok=1; fi ;;
    kv|r2|pages)
      # "pages dev" serves a built dist locally (the advanced-mode _worker.js included): nothing is uploaded.
      if [ "$cmd" = pages ] && [ "$w1" = dev ] && [ "$remote" = 0 ]; then ok=1; fi
      case "$w1" in
        key|namespace|bucket|object|project|deployment) is_read_verb "$w2" && ok=1 ;;
        *) is_read_verb "$w1" && ok=1 ;;
      esac ;;
  esac
  # "<command> --help" only prints help.
  [ "$help" = 1 ] && ok=1
  echo "$ok"
}

allowed=0
if [ "$(decide switch "$@")" = 1 ] && [ "$(decide value "$@")" = 1 ]; then allowed=1; fi

if [ "$allowed" != 1 ]; then
  if [ "${NTWRK_ALLOW_DEPLOY:-}" = "1" ]; then
    echo "scripts/wrangler.sh: NTWRK_ALLOW_DEPLOY=1 set; running: wrangler $*" >&2
  else
    cat >&2 <<MSG
scripts/wrangler.sh: refusing to run 'wrangler $*': it is not on the read-only list, so it may change
Cloudflare resources. Deploys need founder approval first. Use --dry-run to check a deploy, or, once
approved, re-run with NTWRK_ALLOW_DEPLOY=1.
MSG
    exit 3
  fi
fi

exec bunx "wrangler@${WRANGLER_VERSION}" "$@"
