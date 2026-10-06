#!/usr/bin/env bash
# Runs wrangler as the ntwrk.love Cloudflare account (shawmakesmagic@gmail.com), isolated from other wrangler logins.
# Login once with: XDG_CONFIG_HOME=$HOME/.config/wrangler-ntwrk npx wrangler login
export XDG_CONFIG_HOME="$HOME/.config/wrangler-ntwrk"
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-50ad2052bbc6ca528d6993a689b419a4}"
exec npx -y wrangler "$@"
