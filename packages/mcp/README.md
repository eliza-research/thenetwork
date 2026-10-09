# packages/mcp: the remote MCP server and its OAuth server

This package is the MCP server (Model Context Protocol) for the four apps, and the OAuth 2.1 authorization server that signs a person in for it. The design is in [docs/research/2026-10-08-skills-plugins-deploy.md](../../docs/research/2026-10-08-skills-plugins-deploy.md) section 3. The scope is PRD Section 40.

**Warning: no tool sends a text, signs anyone up or takes a phone number or a code.** The person signs in on the site's own page with the platform phone code. The AI client and the agent never see the phone number or the code.

## 1. What it serves

Each site's Worker forwards `/mcp`, `/oauth/*` and `/.well-known/oauth-*` to the shared backend. So each site is its own issuer and its own MCP resource.

| Path (on each site, for example `https://slop.date`) | What it does |
|---|---|
| `POST /mcp` | The MCP endpoint (Streamable HTTP). A client registered on this site is bound to this site's app. |
| `POST /mcp/openai` | The same server for the public OpenAI plugin. It hides slop. slop.date answers 404 here. |
| `GET /.well-known/oauth-protected-resource[/mcp[/openai]]` | RFC 9728 metadata. |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 metadata. The issuer is the site origin. |
| `POST /oauth/register` | RFC 7591 dynamic client registration. |
| `GET /oauth/authorize`, `POST /oauth/authorize/{phone,code,consent}` | The person's sign-in and consent pages. |
| `POST /oauth/token`, `POST /oauth/revoke` | Tokens (authorization code with PKCE S256, refresh with rotation) and RFC 7009 revocation. |
| `GET /oauth/consents`, `POST /oauth/consents/revoke` | The person's list of connected assistants. The person can remove each one. |

## 2. Tools

| Tool | Sign-in | What it returns |
|---|---|---|
| `app_info` | none | Public facts about one app or all apps on this surface. Never anything about a person. |
| `start_signup` | none | The join link, the text keyword and plain instructions for the person. It takes only `app`. |
| `check_status` | `membership:read` | The signed-in person's own state in the client's one app: `not_joined`, `invited`, `waitlisted`, `onboarding`, `active`, `stopped` or `on_hold`. No age, no member id, no other app. |
| `submit_profile` | `profile:write` | Founder decision 10 (agent-first sign-up): the profile the person told their own agent, in their words (`about`, 10-1200 characters), delivered to their own member on the client's one app as if they had texted it (the Network reads it with the same rules: wants, availability, an age that can only lower, minors, abuse). Only for a live member (`active` or `onboarding`); it never creates a member. A phone number, an email address or a 4-10 digit code in it is refused and stored nowhere. At most 5 accepted profiles per grant a day. The service side is `NetworkService.submitProfile`. |

Every input schema has `app` only (`submit_profile`: `app` and `about`) and `additionalProperties: false`. A call with any other field (for example `phone` or `code`) is refused. It is not ignored.

## 3. Rules it keeps

- **Protocol.** MCP 2026-07-28: stateless POST, `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` checked against the body (400, -32020), `server/discover`, `resultType`. Older clients (2025-03-26 to 2025-11-25) use `initialize`. GET and DELETE answer 405. No session ids.
- **OAuth.** PKCE S256 only. Redirect URIs are https, or http on a loopback host only; no fragment, no wildcard. An unknown client or redirect URI gets an error page, never a redirect. Every redirect carries `iss` (RFC 9207). Access tokens last 15 minutes. Refresh tokens rotate; a reused refresh token or code ends the whole grant. A grant lasts at most 90 days.
- **Storage.** Tokens, codes and client secrets are stored as sha256 hashes only. A grant keeps the platform's keyed hash of the number (`phone_key`, HMAC with PLATFORM_HASH_KEY), never the number; check_status finds the person through `platform.people.phone_hash`. A sign-in request keeps the number only while it is open (at most 10 minutes, then swept). Leaving an app or deleting everything deletes that app's grants; revoked and expired grants are deleted after 30 days, and registered clients that never got a grant after a day.
- **Sign-in needs an account.** The code goes only to a number with a membership or an invite on some app; any other number gets the same page and no text (so no grant is made before the number has a person). A grant made before that rule never follows a person made later (who may be a new owner of the number): it answers `invalid_grant`, and the person connects again.
- **The person hears about it.** A new consent texts "<assistant> is now connected to your <app> account. Reply DISCONNECT to remove it." in the person's thread on that app (PRD 11.5). By text, DISCONNECT, "disconnect <name>" and "which assistants are connected?" work (`assistantsOf`, `disconnect`). A staff phone change moves the grants to the new number (`rekeyPhone`).
- **One app per client.** A token is valid only at the resource it was issued for (RFC 8707). A peon token is refused at slop.date and at `/mcp/openai`.
- **New owner.** If the phone now belongs to another person than at consent time, the grant is revoked.
- **OpenAI surface.** `/mcp/openai`, and every client whose redirect URI is on chatgpt.com or openai.com, never lists or offers slop. Such a client cannot register on slop.date.
- **Turnstile.** `createMcpHandler` refuses to start without a Turnstile verifier outside `PLATFORM_ENV=dev`, as the platform API does.
- **Abuse.** Rate limits per IP for registration, authorize, token and MCP calls, and per grant for `check_status` and `submit_profile`. The platform OTP limits apply to the sign-in. The "text me a code" answer is the same for every number and takes at least 700 ms.
- **Audit.** `oauth.audit` keeps one row for each registration, consent, denial, code, token, refresh, revocation and replay. It never holds a token, a code, a secret or a phone number.

## 4. How the backend mounts it

`createServiceMcp(svc, { databaseUrl, proxySecret })` in `packages/network/service/serve.ts` builds the handler on the Network service's own platform parts (the same people store, OTP service, accounts and sessions as `/api/*`) and applies `db/oauth.sql`. `deploy/backend/server.ts` passes it to `createBackend({ mcp })`, which sends these paths to it after `normalizeEdge`. `scripts/platform-dev.ts` does the same in dev, with each local site origin as the issuer.

- Outside dev it needs `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` and a database. Without them it stays off (404 `mcp_not_enabled`).
- When a person leaves an app or deletes everything (the platform's forget path), every OAuth grant of that app is revoked (`revokeAllFor`).
- The OAuth checks (PKCE S256 only, code reuse revokes, no open redirect, refresh rotation, cross-app isolation) are in `test/oauth.test.ts`, part of the security suite kept pending the founder's decision (`bun run security`).

## 5. Run and test

```bash
bun run security                                               # the pending security suite (MCP OAuth with platform and backend checks)
PLATFORM_ENV=dev bun run packages/mcp/src/dev-server.ts        # http://127.0.0.1:4849/mcp, memory stores, codes print to the log
bun run plugins/build.ts --check                               # the plugin skill snapshots equal sites/skills
```

The dev server binds to 127.0.0.1 only. Use 555-01xx numbers only.
