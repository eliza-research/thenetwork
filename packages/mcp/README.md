# packages/mcp: the remote MCP server and its OAuth server

This package is the MCP server (Model Context Protocol) for the four apps, and the OAuth 2.1 authorization server that signs a person in for it. The design is in [connector tools](../../spec/connectorTools.md) and [browser authorization](../../spec/oauthBrowserAuthorization.md) specifications.

**Warning: no tool sends a text, signs anyone up or takes a phone number or a code.** The person signs in on the site's own page with the platform phone code. The AI client and the agent never see the phone number or the code.

## 1. What it serves

Each site's Pages router forwards `/mcp`, `/oauth/*` and `/.well-known/oauth-*` to the shared backend. So each site is its own issuer. ntwrk.party serves the connector of every app, each app at its own path: `https://ntwrk.party/mcp` for The Network and `https://ntwrk.party/mcp/<app>` for slop, peon and friends. The skills name these endpoints. The path is the OAuth resource, so it fixes the app of the authorization request, the grant and each token. Each other site serves only its own app at `/mcp`.

| Path (on each site, for example `https://slop.date`) | What it does |
|---|---|
| `POST /mcp` | The MCP endpoint (Streamable HTTP). A client registered on this site is bound to this site's app. |
| `POST /mcp/openai` | The MCP server on the public OpenAI surface (ChatGPT, Codex). It excludes slop.date on all hosts. |
| `POST /mcp/<app>[/openai]` | ntwrk.party only: the full endpoint of another app (`slop`, `peon` or `friends`). The `/openai` form is available for peon and friends. Other sites answer 404. |
| `GET /.well-known/oauth-protected-resource/mcp[/<app>][/openai]` | RFC 9728 metadata of each endpoint. |
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
| `prepare_signup` | `profile:write` | Network/Friends only: a temporary approved first name and optional `homeCity` (`nyc` or `sf`) for a verified connection. The OAuth signup form collects its own enrollment fields and consent. The draft holds no age, text consent, phone, gender or match preferences. It never creates a person or membership. |
| `check_status` | `membership:read` | The signed-in person's own state in the client's one app: `not_joined`, `invited`, `onboarding`, `active`, `stopped` or `on_hold`. No age, no member id, no other app. |
| `read_profile` | `profile:read` | The active member's own saved first name, about text, interests and general location in the connected app. The browser requires explicit approval for this permission. This call leaves the profile and conversation unchanged. |
| `get_updates` | `membership:read` | The member's unseen updates for the connected app. Reading them marks them seen. |
| `prepare_signup` | `profile:write` | Network/Friends only, for a person who is not joined or invited: the approved first name and optional `homeCity` (`nyc` or `sf`), one draft per grant, for at most 10 minutes. The Finish signup page does not show the draft, so the person enters the approved details on that page. When the person opens that page, the server deletes the draft if the person is banned or has an age that the app does not allow; a person who already has a membership keeps the draft until its deadline. Nothing reads the draft fields. A join, an under-age refusal, a recorded age that the app does not allow, a ban, erasure or the deadline deletes it. It holds no age, text consent, phone, gender or dating preferences, and it never creates a person or membership. |
| `submit_profile` | `profile:write` | Sends the person's approved `about` text of 10–1200 characters to their active or onboarding membership in the connected app. The service treats it as profile intake. Keep phone numbers, email addresses and codes out of the text. The server limits profile and draft calls to five per grant in a 24-hour window. Sending a profile only adds: it never pauses or closes anything the person asked for, even when the text leaves it out. The answer lists what is active (`looking_for`) and, in `check_with_person`, each thing that the text said the person no longer wants or that the person closed in the last 30 days. The agent asks the person about each one and changes nothing by itself. |
| `list_looking_for` | `profile:read` | The active member's own active and paused wants, requests and job posts in the connected app, each with a `ref` like `INT-DPJKAAMBLCNE`, and what they closed in the last 30 days. Each summary passes the output leak gate or is left out. This call changes nothing. |
| `pause_looking_for` | `profile:write` | Pauses the one thing that `ref` names, only after the person asked in the conversation. The app texts the person a confirmation with UNDO. At most three agent changes for each person a day, across all grants. A job post cannot be paused here. Texts off, a stopped or held membership, or an unknown ref change nothing. |
| `resume_looking_for` | `profile:write` | Turns one paused thing back on, with the same limit and a confirmation text. A thing that the person closed cannot be resumed here, and a person under 18 cannot resume through the agent. The connector never closes anything: the person replies CLOSE to the app's text or texts the close command. See [standing changes](../../spec/standingIntentManagement.md). |
| `my_photos` | `photos:use` | slop.date only, for an active adult member: each of the person's own photos by number, its name if they gave one, the day it was added (`addedOn`), and the first name and state (`asked`, `checking`, `ready`, `taken_back`) of each match who was offered it. Never a photo, a thumbnail, an id, a link or a rating. The browser requires explicit approval for this permission, and it is never a default scope. This call changes nothing. |
| `photo_request` | `photos:use` | slop.date only, for an active adult member: passes the person's own `words` (1–300 characters) about sending, naming or taking back a photo. The service reads them as on the text line and texts the person the proposal with its check link. The answer has a `status` (`texted`, `done`, `refused`, `unavailable`) and a text with no link. The agent can never confirm a send: only the person's YES to that text, or Send on the check page, is consent. See [photo relay](../../spec/photoRelayItem.md). |

Every input schema has `additionalProperties: false`. Public tools take `app` only, `prepare_signup` accepts `firstName` and optional `homeCity`, `submit_profile` accepts `about`, `get_updates` accepts `update_token`, `pause_looking_for` and `resume_looking_for` accept `ref`, and `photo_request` accepts `words`. A call with any other field (for example `phone` or `code`) is refused. It is not ignored.

A draft is claimed only by a same-origin POST to `/oauth/signup-draft` with the normal app phone-session cookie. No draft ID, personal facts or credentials enter a URL. The JSON body may carry an optional `rid`, the ID of an OAuth authorization request (22 URL-safe base64 characters). Without it, the claim or discard is for the host's app. With it, the request must be stored, its app must be one that the host serves (ntwrk.party serves every app; an app site only its own), and it must be live in this browser (same app and resource, not expired, matching browser cookie, existing client); the claim or discard is then for that request's app, with that app's phone session. Any failed check returns 403 `not_allowed` and never falls back to the host's app. A `rid` is not a draft ID and does not authorize anything by itself; the body is read only after the origin check, at most 16 KiB. The claim rechecks the live grant, scope, app and verified phone/person binding, and returns the same draft on a retry or revisit. A deliberate same-origin discard (sent after successful Join) scrubs the fields; an unavailable response does not lose them. Conflicting assistant drafts fail closed. Revocation and expiry scrub payloads; deletion follows the grant. The form never overwrites edits or prechecks consent. An opaque, non-authorizing view marker derived from the verified app/phone binding detects account switches; it is never accepted as an auth credential. Authentication transitions clear the old form and invalidate in-flight responses. Updated forms also send their reviewed account marker with Join; the server rejects a changed account before any age, person, membership or consent write. The page clears the old fields and loads the current account for review without another phone code. Older clients may omit the marker; it never authorizes a request. Slop and Peon are excluded; Slop's adult/private-pilot rules remain unchanged. A grant created before Join still becomes invalid when a person is created, so it must be reauthorized for later profile tools.



Ntwrk, Friends and Slop use the native connector authorization link for browser enrollment. The person verifies their phone, confirms the app enrollment and text consent, then chooses whether to allow the connector. An exact signup request keeps the browser and the resulting app membership bound together. A separate connection that the person approved before joining still expires when the phone gains a person. See [the signup handoff](../../spec/agentPhoneHandoff.md) and [signup drafts](../../spec/mcpSignupDraft.md). A person who allowed access without joining gets `not_joined` from `check_status`, with a next step that says to disconnect the app in the agent, connect it again and choose Finish signup. See [connector browser authorization](../../spec/oauthBrowserAuthorization.md) and [connector tools](../../spec/connectorTools.md).


## 3. Rules it keeps

- **Protocol.** MCP 2026-07-28: stateless POST, `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` checked against the body (400, -32020), `server/discover`, `resultType`. Older clients (2025-03-26 to 2025-11-25) use `initialize`. GET and DELETE answer 405. No session ids.
- **OAuth.** PKCE S256 only. Redirect URIs are https, or http on a loopback host only; no fragment, no wildcard. An unknown client or redirect URI gets an error page, never a redirect. Every redirect carries `iss` (RFC 9207). Access tokens last 15 minutes. Refresh tokens rotate; a reused refresh token or code ends the whole grant. A grant lasts at most 90 days.
- **Storage.** Tokens, codes and client secrets are stored as sha256 hashes only. A grant keeps the platform's keyed hash of the number (`phone_key`, HMAC with PLATFORM_HASH_KEY), never the number; check_status finds the person through `platform.people.phone_hash`. A sign-in request keeps the number only while it is open (at most 10 minutes, then swept). Leaving an app or deleting everything deletes that app's grants; revoked and expired grants are deleted after 30 days, and registered clients that never got a grant after a day.
- **A grant made before the number had a person** never follows a person made later (who may be a new owner of the number): it answers `invalid_grant`, and the person connects again.
- **One app per client.** A token is valid only at the resource it was issued for (RFC 8707). A token is for the app of its path: a peon token is refused at slop.date, at `https://ntwrk.party/mcp/slop` and at `/mcp/openai`.
- **New owner.** If the phone now belongs to another person than when access was granted, the grant is revoked.
- **OpenAI surface.** Public ChatGPT and Codex connections use the OpenAI endpoints of The Network, peon and friends. The surface excludes Slop endpoints and app facts. The separately approved private adult Slop pilot uses `https://slop.date/mcp`.
- **Abuse.** An MCP call with a verified token counts against its grant, a call without one against its address; a token request counts against the grant of its code or refresh token. A coarse per-address ceiling sits above these, so many people behind one hosted assistant do not share one budget. Registration counts per address, with a higher hourly limit when every redirect URI belongs to a known assistant. The browser authorization pages keep their per-address limit ([connector tools](../../spec/connectorTools.md), "Request limits count each person's grant"). The platform OTP limits apply to the sign-in. The "text me a code" answer is the same for every number and takes at least 700 ms.
- **Audit.** `oauth.audit` keeps one row for each registration, consent, denial, code, token, refresh, revocation and replay. It never holds a token, a code, a secret or a phone number.

## 4. How the backend mounts it

`createServiceMcp(svc, { databaseUrl, proxySecret })` in `packages/network/service/serve.ts` builds the handler on the Network service's own platform parts (the same people store, OTP service, accounts and sessions as `/api/*`) and applies `db/oauth.sql`. `deploy/backend/server.ts` passes it to `createBackend({ mcp })`, which sends these paths to it after `normalizeEdge`. `scripts/platform-dev.ts` does the same in dev, with each local site origin as the issuer.

- Outside dev it needs `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` and a database. Without them it stays off (404 `mcp_not_enabled`).
- When a person leaves an app or deletes everything (the platform's forget path), every OAuth grant of that app is erased (`forgetPerson`).
- When the platform records an age reading for a phone (a stated age, a birth date, a join, an age that a chat states, or a number change), the phone's signup draft of each app that does not allow the lowest recorded age is deleted at once (`discardAgeRefusedSignupDrafts`, set as the one age listener of both account services in `packages/network/service/serve.ts`; a newer connector replaces it). A failure is logged and does not fail the step that recorded the age.
- When staff ban a person or a number, the signup drafts of every banned number are deleted in every app at once (`discardSignupDrafts`, called from the service's ban listener after every membership is restricted and before the ban is complete; a failure leaves the ban pending for a staff retry).
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
No deployment, credentials or phone provider is enabled by this setting.
The normal account, age, consent and OAuth checks remain in force.
The public Slop OpenAI plugin remains unavailable.
Cloud SSO keeps its separate origin and callback restrictions.

### Private ChatGPT development pilot

`MCP_PRIVATE_OPENAI_APPS=<app>` permits a private ChatGPT DCR connection to `/mcp`
in an owned, declared development runtime. slop.date does not need it: its ChatGPT
connector is open in every environment. It defaults off. Production, staging,
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

### The slop.date ChatGPT connector

A person can add `https://slop.date/mcp` as a connector in ChatGPT. Its issuer is
`https://slop.date`. A DCR client whose redirects all use `chatgpt.com` or
`chat.openai.com` is a full-surface slop.date connection for every person, with the
same tools, account checks and revocation as every other connector
([spec/connectorTools.md](../../spec/connectorTools.md)). No allowlist applies.
Slop.date is not in the public OpenAI
plugin and has no `/mcp/openai` surface, because that plugin must suit ages 13 to 17
([spec/agentEntry.md](../../spec/agentEntry.md), `plugins/build.ts`). A CIMD client
from an OpenAI host stays unavailable on slop.date.

The person enters their own phone and code and accepts the terms and text consent
only in the site flow. Never enable the development pilot or use fictional OTP on
the deployed service.

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
