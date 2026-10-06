# ChatGPT notes for The Network connector (as of 2026-10-05)

Sources: [docs/research/connectors/chatgpt.md](../../docs/research/connectors/chatgpt.md) [O#] and the approved design [docs/research/mcp-server-design.md](../../docs/research/mcp-server-design.md). These are build notes for this prototype, not a submission.

## Naming and origin

- On 2026-07-09 OpenAI renamed ChatGPT "apps" to **plugins**, and the App Directory became the **Plugin Directory**. A plugin still wraps a remote MCP server.
- The permanent MCP origin is **https://mcp.ntwrk.love**, with resource `https://mcp.ntwrk.love/mcp`. ChatGPT treats an origin change as a new plugin [O11], so don't change it.
- Config comes from `MCP_ORIGIN` / `NETWORK_DOMAIN` (`src/config.ts`; repo `.env`).

## What the prototype does for ChatGPT

**Five tools, with the exact schemas and annotations from design §5:**

| Tool | readOnly | destructive | idempotent | openWorld |
|---|---|---|---|---|
| `ask_network_agent` | true | false | true | false |
| `tell_network_agent` | false | false | true | false |
| `share_profile_with_network` | false | false | true | false |
| `get_network_updates` | true | false | true | false |
| `respond_to_network_item` | false | **true** | true | false |

- Read and write are separate tools [O3 R1]. `respond_to_network_item` is the only accept/decline path, and ChatGPT prompts before every call to it.
- `share_profile_with_network` takes narrow typed fields only. It has no history, summary or catch-all field, and no romance value in `looking_for` [O3 R2].
- Every tool has `securitySchemes` (`oauth2` with its scope) and `openai/toolInvocation/*` status strings where the design defines them.

**Result minimization [O3 R4]:**
- `structuredContent` and `content` hold only opaque `itm_…` / `cnf_…` handles and human time strings ("expires in 2 days").
- Receipt ids, action ids and ISO timestamps are only in `_meta["network/receipt"]`.
- Item handles are per-grant HMACs, so ChatGPT and Claude see different ids for the same item.

**Teen-safe surface profile [O3 R6, R7].** The verified client (a CIMD URL on `chatgpt.com`, or a DCR client with the exact ChatGPT redirect) gets `teen_safe_directory`. It never returns:
- romance or dating
- bars, nightlife, alcohol-centric or 18+/21+ venues
- sponsored items

Enforcement runs at three points:
- query-level filtering
- polite `not_available_here` replies for out-of-profile requests
- a deterministic output classifier that blocks any leaked term

The profile is never derived from `clientInfo.name`.

**Members under 18 (any host):**
- Updates never include intro, group, relay or contact items.
- Accepting one returns `not_available_here` ("That isn't available.").
- People-involving `tell` requests and people-connecting `looking_for` values are refused.
- Romance is adult-only and isn't available through any connector.

**Confirmations (design §6):**
- Tier 1 is a two-step `pending_confirmation` that the host answers through `respond_to_network_item`.
- Tier 2 (new grant in its first 24 h, or an unverified client) and tier 3 (relay, contact swap, invites, safety) are confirmed only by the member's reply on the Network's own channel. A host `confirm` returns `confirm_in_network_app` and does nothing.

**Auth.** All three pieces ChatGPT needs for its sign-in UI exist [O5]:
- RFC 9728 metadata at `/.well-known/oauth-protected-resource[/mcp]`
- per-tool `securitySchemes`
- the runtime challenge: a missing scope on a ChatGPT grant returns `isError: true` with `_meta["mcp/www_authenticate"]: ["Bearer resource_metadata=\"…\", scope=\"…\", error=\"insufficient_scope\", error_description=\"…\""]`

Invalid or expired tokens get HTTP 401 for every host. Claude grants get HTTP 403 for missing scopes.

**AS metadata (RFC 8414, issuer `https://mcp.ntwrk.love`):**
- `code_challenge_methods_supported: ["S256"]`
- `client_id_metadata_document_supported: true`
- `token_endpoint_auth_methods_supported: ["none","private_key_jwt"]`
- `authorization_response_iss_parameter_supported: true`
- no `openid`/`email`/`profile` scopes, because ChatGPT would request them [O5]

With `iss` support, ChatGPT uses `https://chatgpt.com/connector_platform_oauth_redirect`.

**UI.** The `ui://network/item-card.html` MCP Apps card is linked from `get_network_updates` only when the client declares the `io.modelcontextprotocol/ui` extension. It shows at most two primary actions.

## Deviations from the design, and why

- **Tool errors don't carry `structuredContent: {error}`.** The SDK client validates `structuredContent` against `outputSchema` even when `isError` is set, so an `{error}` object fails validation. The error is in `content` text and in `_meta["network/error"]` (`{code, message, retryable}`) instead.
- **Sponsored items** are excluded from `general_assistant` too, not only from ChatGPT, because of Claude's ads-vehicle rule [A8 R4].

## Gaps before submission

1. **Authorization server.** `/oauth/authorize`, `/oauth/token` and `/oauth/revoke` return 501. DCR works in memory. Real phone-code login, consent, `at+jwt`, refresh rotation, `iss` on every redirect, CIMD fetch and grants are design §3.3–§3.7.
2. **Age policy text.** The PRD still says 18+. Terms and privacy must match the founder decision before listing (design §15 Q4, §7.5). Confirm with OpenAI that an invite-only service is acceptable (Q5).
3. **Reviewer tenant** with synthetic data and a password login (design §3.3).
4. **Listing**, privacy policy, and the 5 positive / 3 negative test cases [O4].
5. **Deployment.** `wrangler.toml` targets the `ntwrk.love` zone (`mcp.ntwrk.love/*`) with `NETWORK_MCP_ENABLED = "false"`. It isn't deployed. Production is a shard of `eliza-cloud-api` (design D1).

## Local try-out

```
cd prototypes/connector-mcp && bun run start
# MCP Inspector → http://localhost:8787/mcp
#   Authorization: Bearer dev-ava-chatgpt   (ChatGPT teen-safe profile)
#   Authorization: Bearer dev-ava           (Claude general profile)
#   Authorization: Bearer dev-kai           (16-year-old member)
# Validate the Worker without deploying (repo root):
./scripts/wrangler.sh deploy --dry-run -c prototypes/connector-mcp/wrangler.toml
```
