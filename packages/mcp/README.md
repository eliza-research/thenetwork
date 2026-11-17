# packages/mcp: the remote MCP server and its OAuth server

This package is the MCP server (Model Context Protocol) for the four apps, and the OAuth 2.1 authorization server that signs a person in for it. The design is in [connector tools](../../spec/connectorTools.md) and [browser authorization](../../spec/oauthBrowserAuthorization.md) specifications.

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
| `GET /oauth/authorize`, `POST /oauth/authorize/{phone,code,signup,consent,cancel}` | Phone verification, optional app enrollment, explicit connector approval and cancellation. |
| `POST /oauth/token`, `POST /oauth/revoke` | Tokens (authorization code with PKCE S256, refresh with rotation) and RFC 7009 revocation. |
| `GET /oauth/consents`, `POST /oauth/consents/revoke` | The person's list of connected assistants. The person can remove each one. |

## 2. Tools

| Tool | Sign-in | What it returns |
|---|---|---|
| `app_info` | none | Public facts about one app or all apps on this surface. Never anything about a person. |
| `start_signup` | none | The join link, the text keyword and plain instructions for the person. It takes only `app`. |
| `prepare_signup` | `profile:write` | Network/Friends only: a temporary approved first name and optional `homeCity` (`nyc` or `sf`) for a verified connection. The OAuth signup form collects its own enrollment fields and consent. The draft holds no age, text consent, phone, gender or dating preferences. It never creates a person or membership. |
| `check_status` | `membership:read` | The signed-in person's own state in the client's one app: `not_joined`, `invited`, `onboarding`, `active`, `stopped` or `on_hold`. No age, no member id, no other app. |
| `read_profile` | `profile:read` | The active member's own saved first name, about text, interests and general location in the connected app. The browser requires explicit approval for this permission. This call leaves the profile and conversation unchanged. |
| `get_updates` | `membership:read` | The member's unseen updates for the connected app. Reading them marks them seen. |
| `submit_profile` | `profile:write` | Founder decision 10 (agent-first sign-up): the profile the person told their own agent, in their words (`about`, 10-1200 characters), delivered to their own member on the client's one app as if they had texted it (the Network reads it with the same rules: wants, availability, an age that can only lower, minors, abuse). Only for a live member (`active` or `onboarding`); it never creates a member. A phone number (a run of 10 or more digits however it is grouped, or 7 or more outside 5-digit groups, even touching letters), an email address or a code written as one 4- or 6-10 digit number is refused and stored nowhere. A standalone 5-digit zip is accepted, so a 5-digit code or a code split into short groups ("12 34 56") is not told apart and passes; street addresses are not filtered here. At most 5 accepted profiles per grant a day. The service side is `NetworkService.submitProfile`. |

Every input schema has `additionalProperties: false`. Public tools still take `app` only; `prepare_signup` alone also accepts `firstName` and optional `homeCity`, `submit_profile` accepts `about`, and `get_updates` accepts `update_token`. A call with any other field (for example `phone` or `code`) is refused. It is not ignored.

A draft is claimed only by a same-origin POST to `/oauth/signup-draft` with the normal app phone-session cookie. No draft ID, personal facts or credentials enter a URL. The claim rechecks the live grant, scope, app and verified phone/person binding, and returns the same draft on a retry or revisit. A deliberate same-origin discard (sent after successful Join) scrubs the fields; an unavailable response does not lose them. Conflicting assistant drafts fail closed. Revocation and expiry scrub payloads; deletion follows the grant. The form never overwrites edits or prechecks consent. An opaque, non-authorizing view marker derived from the verified app/phone binding detects account switches; it is never accepted as an auth credential. Authentication transitions clear the old form and invalidate in-flight responses. Updated forms also send their reviewed account marker with Join; the server rejects a changed account before any age, person, membership or consent write. The page clears the old fields and loads the current account for review without another phone code. Older clients may omit the marker; it never authorizes a request. Slop and Peon are excluded; Slop's adult/private-pilot rules remain unchanged. A grant created before Join still becomes invalid when a person is created, so it must be reauthorized for later profile tools.


Ntwrk, Friends and Slop use the native connector authorization link for browser enrollment. The person verifies their phone, confirms the app enrollment and text consent, then chooses whether to allow the connector. An exact signup request keeps the browser and the resulting app membership bound together. A separate connection that the person approved before joining still expires when the phone gains a person. See [the signup handoff](../../spec/agentPhoneHandoff.md).

Draft reads/writes and canonical phone-age recording share an independent keyed-phone age guard. The normal age-floor write awaits cleanup of every supported app whose minimum Join age exceeds the canonical floor, including phones with no person and refusals without a subsequent browser request. Known low age also scrubs/refuses on access; unknown age is not inferred. `onAgeLowered(personId)` remains separate. Memory serializes per key; PostgreSQL uses a session advisory lock across store instances, with a separate no-connection-waiter queue from `withLock` to avoid recursive join-lock waits. Callbacks may only perform eligibility/read/write/cleanup, never acquire `withLock`. The usual four-connection people pool leaves room for the outer join lock, age guard and normal queries; a custom smaller pool must be qualified separately. The normal MCP composition installs the single age-floor cleanup consumer before serving; adapters missing the contract refuse draft access.

## 3. Rules it keeps

- **Protocol.** MCP 2026-07-28: stateless POST, `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` checked against the body (400, -32020), `server/discover`, `resultType`. Older clients (2025-03-26 to 2025-11-25) use `initialize`. GET and DELETE answer 405. No session ids.
- **OAuth.** PKCE S256 only. Redirect URIs are https, or http on a loopback host only; no fragment, no wildcard. An unknown client or redirect URI gets an error page, never a redirect. Every redirect carries `iss` (RFC 9207). Access tokens last 15 minutes. Refresh tokens rotate; a reused refresh token or code ends the whole grant. A grant lasts at most 90 days.
- **Storage.** Tokens, codes and client secrets are stored as sha256 hashes only. A grant keeps the platform's keyed hash of the number (`phone_key`, HMAC with PLATFORM_HASH_KEY), never the number; check_status finds the person through `platform.people.phone_hash`. A sign-in request keeps the number only while it is open (at most 10 minutes, then swept). Leaving an app or deleting everything deletes that app's grants; revoked and expired grants are deleted after 30 days, and registered clients that never got a grant after a day.
- **A grant made before the number had a person** never follows a person made later (who may be a new owner of the number): it answers `invalid_grant`, and the person connects again.
- **One app per client.** A token is valid only at the resource it was issued for (RFC 8707). A peon token is refused at slop.date and at `/mcp/openai`.
- **New owner.** If the phone now belongs to another person than when access was granted, the grant is revoked.
- **OpenAI surface.** `/mcp/openai`, and every client whose redirect URI is on chatgpt.com or openai.com, never lists or offers slop. Such a client cannot register on slop.date.
- **Abuse.** Rate limits per IP for registration, authorize, token and MCP calls, and per grant for `check_status` and `submit_profile`. The platform OTP limits apply to the sign-in. The "text me a code" answer is the same for every number and takes at least 700 ms.
- **Audit.** `oauth.audit` keeps one row for each registration, consent, denial, code, token, refresh, revocation and replay. It never holds a token, a code, a secret or a phone number.

## 4. How the backend mounts it

`createServiceMcp(svc, { databaseUrl, proxySecret })` in `packages/network/service/serve.ts` builds the handler on the Network service's own platform parts (the same people store, OTP service, accounts and sessions as `/api/*`) and applies `db/oauth.sql`. `deploy/backend/server.ts` passes it to `createBackend({ mcp })`, which sends these paths to it after `normalizeEdge`. `scripts/platform-dev.ts` does the same in dev, with each local site origin as the issuer.

- Outside dev it needs `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` and a database. Without them it stays off (404 `mcp_not_enabled`).
- When a person leaves an app or deletes everything (the platform's forget path), every OAuth grant of that app is revoked (`revokeAllFor`).
- The OAuth checks (PKCE S256 only, code reuse revokes, no open redirect, refresh rotation, cross-app isolation) are in `test/oauth.test.ts`, part of the security suite in the integration suite (`pnpm run test:integration`; `pnpm run security` for the subset). `test/mcp.test.ts`, `test/pg.test.ts` and `test/updates.test.ts` drive the server over HTTP and on Postgres.

## 5. Run and test

### Isolated staging authority

`STAGING_SITE_ORIGINS` is an optional JSON object of app IDs and exact HTTPS origins.
It requires `PLATFORM_ENV=staging` and is refused in a production build.
A configured app uses only its declared staging host, issuer, resource and links.
Its Turnstile checks use that hostname. Unconfigured apps retain their existing behavior.

Use the same mapping in the backend and site build. Staging site builds also need
an explicit isolated backend origin and mappings for their linked apps.
See [the deployment guide](../../docs/deploy.md#isolated-staging-site-authorities).
No deployment, credentials, phone provider or custom ChatGPT pilot is enabled by this setting.
The normal account, age, consent and OAuth checks remain in force.
The public Slop OpenAI plugin remains unavailable.
Cloud SSO keeps its separate origin and callback restrictions.

### Private ChatGPT development pilot

`MCP_PRIVATE_OPENAI_APPS=slop` permits a private ChatGPT DCR connection to `/mcp`
in an owned, declared development runtime. It defaults off. Production, staging,
unknown environments, and `NODE_ENV=production` refuse this setting.
This does not enable the hosted Slop service or its public OpenAI plugin.
The public Slop `/mcp/openai` endpoint remains unavailable.

The pilot uses the existing phone account, OAuth sign-in, app/resource binding,
and profile tools. It adds no model service or account store. Use fictional phones,
fake OTP, and dry-run sends for local acceptance. Run the private ChatGPT scenario
in `tests/e2e/platform.e2e.test.ts` for the complete local service journey.

Disabling the pilot suspends private access; it does not delete accounts or revoke
consent. Use the normal disconnect/revoke flow to revoke a grant permanently.
Hosted ChatGPT acceptance needs a separately reviewed, reachable test endpoint and
the user's connector consent. A successful local OAuth case does not prove it.

### Real-account custom ChatGPT pilot (inactive by default)

The separate `MCP_CUSTOM_CHATGPT_SLOP=on` setting prepares an account-allowlisted
custom connector at `https://slop.date/mcp`. Its issuer stays `https://slop.date`.
Set `MCP_CUSTOM_CHATGPT_SLOP_PERSON_IDS` to the existing, explicitly approved
person IDs. Do not log or publish that list. Missing means off; invalid settings,
an empty allowlist, dev/unknown environments, and a mixed development pilot fail
startup. This mode requires explicit staging or production configuration and the
normal deployed database, Turnstile, phone verification and session checks.

Only DCR clients whose redirects all use the supported ChatGPT hosts qualify.
Client names do not establish trust. The current person must be allowlisted, have
the same phone identity, have an active/onboarding Slop membership without review,
have a stored age floor of at least 18, and have no hold or ban. These checks apply
at authorization, code exchange, refresh and authenticated MCP requests. Issued codes remain bound to the verified account even if the browser account changes.

This pilot offers onboarding only: `app_info`, `start_signup`, `check_status` and
`submit_profile`. `get_updates` is omitted and refused for pilot connections.
While enabled, unauthenticated Slop discovery also offers only those four tools;
authenticated non-pilot clients retain their existing tool access. Public OpenAI
plugin filtering and Slop's unavailable `/mcp/openai` surface remain unchanged.
CIMD does not inherit this exception.

Disable the flag or remove a person from the allowlist to suspend access after
the runtime reload/restart. Revocation remains available. Re-enabling can resume
an eligible, unrevoked grant; use the existing disconnect flow for permanent
withdrawal. No new account store, model service or OTP provider is added.

Preparing or testing this code does not approve activation. Before rollout,
review the private-connector policy, approve the named accounts, verify staging,
then obtain deployment approval. The person enters their own real phone/code and
accepts real Terms/consent only in the site flow. Never enable the development
pilot or use fictional OTP on the real deployed service.

```bash
pnpm run security                                               # the pending security suite (MCP OAuth with platform and backend checks)
PLATFORM_ENV=dev node --import tsx --env-file-if-exists=.env packages/mcp/src/dev-server.ts        # http://127.0.0.1:4849/mcp, memory stores, codes print to the log
node --import tsx --env-file-if-exists=.env plugins/build.ts --check                               # the plugin skill snapshots equal sites/skills
```

The dev server binds to 127.0.0.1 only. Use 555-01xx numbers only.

After phone verification (or an existing valid session), the person approves the
requesting client and its scopes before returning to the assistant. Every fresh
authorization requires this decision; existing tokens remain valid. Approval is
POST-only, bound to the browser and current account, and consumed atomically. The requested scopes still limit access;
`/oauth/consents` lists connected assistants and lets the person revoke them.
