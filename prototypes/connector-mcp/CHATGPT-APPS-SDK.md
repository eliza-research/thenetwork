# ChatGPT notes for The Network connector (as of 2026-10-05)

Read [docs/research/connectors-and-loveofyourlife.md](../../docs/research/connectors-and-loveofyourlife.md) for sources. These are build notes for this prototype, not a submission.

## Naming

On 2026-07-09 OpenAI renamed ChatGPT "apps" to **plugins** and the App Directory to the **Plugin Directory** (secondary sources). Under the hood a plugin still bundles a remote MCP server ("app"), optional UI and skills. The Apps SDK docs remain at developers.openai.com/apps-sdk.

## What this prototype already does for ChatGPT

- Remote MCP over Streamable HTTP, stateless JSON responses (`src/http.ts`).
- RFC 9728 protected resource metadata at `/.well-known/oauth-protected-resource[/mcp]`; 401 with `WWW-Authenticate: Bearer resource_metadata="…", scope="…"`.
- AS metadata shape with `code_challenge_methods_supported: ["S256"]`, `client_id_metadata_document_supported: true` (CIMD, preferred by ChatGPT), `authorization_response_iss_parameter_supported: true` (RFC 9207). With `iss` support ChatGPT uses redirect `https://chatgpt.com/connector_platform_oauth_redirect`; otherwise `https://chatgpt.com/connector/oauth/{callback_id}`. Both are allowlisted in `ALLOWED_REDIRECTS`.
- Per-tool `securitySchemes` (`oauth2` with the tool's scope) under `_meta`. ChatGPT also needs `_meta["mcp/www_authenticate"]` on an auth-failure tool error to show its account-linking UI. TODO: emit that from the tool layer when a token lacks scope in stateful mode.
- Annotations on every tool: `readOnlyHint`, `destructiveHint`, `openWorldHint` explicit booleans. `network_respond` is `destructiveHint: true, openWorldHint: true` because accepting can lead to a message to another member; ChatGPT will ask for confirmation each time, which is intended.
- UI: `network_get_updates` sets `_meta.ui.resourceUri` (MCP Apps, SEP-1865) and the legacy alias `_meta["openai/outputTemplate"]` to `ui://the-network/updates.html`, served as `text/html;profile=mcp-app`. The widget renders cards from `structuredContent` and calls `network_respond` through the `ui/*` postMessage bridge. CSP declares no connect or resource domains (all data comes through tools).
- Tool status strings: `openai/toolInvocation/invoking` and `invoked`.

## Gaps before submission

1. **Audience policy (blocker).** Plugin guidelines (Oct 2026) require plugins to be suitable for general audiences including ages 13–17; 18+ experiences "will arrive once appropriate age verification and controls are in place". The Network is adults-only (PRD 17.4). Options: (a) ask OpenAI whether an adults-only service whose plugin content is general-audience (no romance, no mature content) and whose account linking requires an existing 18+ member is acceptable; (b) exclude the romance category from everything the ChatGPT surface returns; (c) wait for OpenAI's 18+ controls. Do not submit claiming general-audience suitability without (a).
2. **Real authorization server.** Eliza Cloud must publish AS metadata, support PKCE S256, CIMD (plus DCR fallback), refresh rotation, audience-bound tokens, and the redirect URIs above (PRD 30.2 gap).
3. **Reviewer demo account** with no MFA/OTP: a seeded synthetic member in a synthetic world (never real people), entered under "Review details".
4. **Listing:** display name (30 chars), subtitle (30), description (4,000), developer name, category, website/support/privacy/terms URLs, icon, country targeting. Verified developer identity; org owner or Apps Management Write role. One active review at a time.
5. **No digital sales.** No membership, credits or upgrade links inside ChatGPT. The Network has no membership fee (PRD 18), so this is fine, but keep Commons/payments out of the plugin.
6. **Privacy policy** covering data categories, purposes, recipients and retention, including what the connector receives from ChatGPT (`share_context`) and the audit receipts.
7. **Elicitation.** Not confirmed for ChatGPT. Without it, medium-risk confirmations use `host_respond` plus ChatGPT's own destructive-tool confirmation; high-risk always goes to The Network's channel.
8. **EEA/UK/CH availability** has been limited by OpenAI for some apps; check at submission.

## Local try-out

```
cd prototypes/connector-mcp && bun install && bun run start
# MCP Inspector → http://localhost:8787/mcp, header Authorization: Bearer dev-ava
```
ChatGPT developer mode needs a public HTTPS URL (tunnel) and a working OAuth server; the stubs here return 501 for /oauth/authorize and /oauth/token.
