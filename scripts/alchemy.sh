#!/usr/bin/env bash
set -euo pipefail

export ALCHEMY_FAST_DISTILLED="${ALCHEMY_FAST_DISTILLED:-1}"

value_flag() {
  case "$1" in
    -c|--config|--stage|--env-file|--profile|--log-level|--log-format|--include|--exclude|--provider|--since|--backend) return 0 ;;
    *) return 1 ;;
  esac
}

switch_flag() {
  case "$1" in
    --fast-distilled|--no-input|--help|-h|--version|-v|--yes|-y|--force|--dry-run|--adopt|--detect-drift|--completions) return 0 ;;
    *) return 1 ;;
  esac
}

decide() {
  local mode="$1"; shift
  local words=() help=0 skip_next=0 end_opts=0 last="" a
  for a in "$@"; do
    if [ "$end_opts" = 1 ]; then
      words+=("$(printf '%s' "$a" | tr '[:upper:]' '[:lower:]')")
      continue
    fi
    if [ "$skip_next" = 1 ]; then skip_next=0; continue; fi
    if [ -n "$last" ] && { [ "$a" = true ] || [ "$a" = false ]; }; then
      local v=0; [ "$a" = true ] && v=1
      case "$last" in help) help=$v ;; esac
      last=""; continue
    fi
    last=""
    if [ "$a" = "--" ]; then end_opts=1; continue; fi
    local flag=""
    case "$a" in -*) flag="$(printf '%s' "${a%%=*}" | tr -d '_-' | tr '[:upper:]' '[:lower:]')" ;; esac
    case "$flag" in
      help|h) case "$a" in --help|-h) help=1; last=help ;; --help=true|-h=true) help=1 ;; *) help=0 ;; esac; continue ;;
      nohelp|noh) help=0; continue ;;
    esac
    case "$a" in
      --*=*) ;;
      -*)
        if value_flag "$a"; then skip_next=1
        elif switch_flag "$a"; then :
        elif [ "$mode" = value ]; then skip_next=1; fi ;;
      *) words+=("$(printf '%s' "$a" | tr '[:upper:]' '[:lower:]')") ;;
    esac
  done
  local cmd="${words[0]:-}" w1="${words[1]:-}" ok=0
  case "$cmd" in
    "") ok=1 ;;
    plan|dev) ok=1 ;;
    provider)
      case "$w1" in
        ""|check-env) ok=1 ;;
      esac ;;
  esac
  [ "$help" = 1 ] && ok=1
  echo "$ok"
}

allowed=0
if [ "$(decide switch "$@")" = 1 ] && [ "$(decide value "$@")" = 1 ]; then allowed=1; fi

if [ "$allowed" != 1 ]; then
  if [ "${NTWRK_ALLOW_DEPLOY:-}" = "1" ]; then
    echo "scripts/alchemy.sh: NTWRK_ALLOW_DEPLOY=1 set; running: alchemy $*" >&2
  else
    cat >&2 <<MSG
scripts/alchemy.sh: refusing to run 'alchemy $*': it is not on the read-only list, so it may change
Cloudflare resources. Deploys need founder approval first. Use 'plan' or 'dev' for read-only work, or,
once approved, re-run with NTWRK_ALLOW_DEPLOY=1.
MSG
    exit 3
  fi
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
if [ -x "$REPO_ROOT/node_modules/.bin/alchemy" ]; then
  exec "$REPO_ROOT/node_modules/.bin/alchemy" "$@"
fi
if command -v corepack >/dev/null 2>&1; then
  exec corepack pnpm@10.24.0 exec alchemy "$@"
fi
exec pnpm exec alchemy "$@"
