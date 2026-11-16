# Production Cloud → Network identity handoff — source/local only

Historical record. The [original revision](https://github.com/eliza-research/thenetwork/blob/1e2caa5028ade43ec7cb6a90de16466584f7ead0/docs/results/2026-10-18-production-cloud-network-handoff.md) retains the commands and toolchain used for the observations. Updated command spellings here describe the current project where the same entrypoints exist.

This implements the previously missing Network consumer contract against a separate, small Cloud producer artifact pinned to Cloud source `15c603c00b63cffaea986b71ec4ffec3bcae8205`. No production database, feature flag, OAuth grant, phone, model or delivery provider was changed. The current live Network sites still use OTP. Hosted original-account/agent/history acceptance remains open.

## Producer and consumer

The new contract names exactly `ntwrk.party`, `slop.date`, `friends.help`, and `peon.biz`, paired with `cloud.eliza.app` and `api.eliza.app`. Each target binds its app, HTTPS origin, membership-only audience, API resource and exact callback. The new Cloud route uses `/api/auth/sso-bridge/network/{mint,exchange,validate}`. Existing generic Eliza SSO routes, `esso_` codes and general Steward tokens are unchanged.

A verified Cloud bearer and explicit Continue action mint a domain-separated `enso_` code. The producer resolves the canonical primary Cloud user/org, globally unique canonical phone and matching verified phone projection, lifecycle and original Steward authority. The personal agent is derived by the existing Cloud helper. The code uses the existing Postgres SSO table, storing a hash, PKCE challenge, verified identity context and original issue/expiry. Atomic claim burns it before verifier/target checks. Codes last at most 60 seconds and cannot extend the original session or owner expiry.

Exchange and validation require the existing service HMAC and exact app Origin. Exchange returns a minimal signed `ensd_` membership delegation, never a general Cloud token. Validation rechecks primary owner/org/phone/lifecycle and primary logout markers. The Network seals this proof in its HttpOnly identity cookie, binds it to its app/session, rechecks its own phone hold/ban/suppression and resolves its own current person. It does not merge accounts, infer Cloud IDs from matching UUIDs, create another agent, or copy history.

The Network production consumer requires explicit `NETWORK_CLOUD_AUTH_MODE=production-v1`, `NETWORK_CLOUD_AUTH_ENABLED=true`, the exact production Cloud origins and existing service authority. It refuses staging overrides and arbitrary site origins. The existing local/staging bridge remains separate and unchanged. Both production feature flags remain unset in actual services.

## OAuth authority

The approved nullable `cloud_authority` JSON column extends the **existing** `oauth.grants` table. Cloud grants persist a Network-sealed delegation bound to app/resource/phone hash, original issue time and capped expiry. The phone and Cloud identity details remain inside the authenticated encryption, not tool output or URLs. `grant_cloud_` IDs require authority. All non-null authority rows, including non-prefixed imported rows, have immutable authority, identity scope and expiry bounds; they cannot be renamed into legacy rows. Existing genuine OTP grants with NULL authority remain compatible.

Creation, code exchange, bearer use and refresh validate current Cloud authority. Access/refresh tokens cannot outlive the grant or original Cloud expiry. Refresh and revoke lock the same parent first; a refresh that waits past expiry or loses authority rolls back rather than publishing valid tokens. OAuth website-session reuse calls the platform's validated session owner and avoids independently rotating a Cloud cookie without its sealed companion. The production mode refuses the old OAuth OTP/session-creation shortcut.

The schema edit is a repeatable `9001_oauth_schema` source migration, applied only to controlled test databases. **The column/guards must be reviewed and legitimately applied before deploying this consumer, even with the feature off**, because the store's insert/read shape changes. No live migration was run.

## Local receipts

Pinned the former runtime 1.4.2 and the retained isolated PostgreSQL cluster on port 54428:

- Seven real-PG producer cases passed 71 assertions: four targets, concurrent single-use exchange, wrong PKCE, cross-app/origin/resource/audience/callback, tamper, stale code, logout, owner/org/phone/lifecycle and original expiry.
- Actual producer plus four-app Network website/sealed-authority/MCP HTTP pipeline passed one controlled test and 188 assertions. Primary owner and Network store were controlled memory fixtures in this join; this is not live account proof.
- The real-PG Cloud-grant, existing OAuth/PG and staging bridge regression suite passed 41 tests and 430 assertions. It includes concurrent revoke/refresh, immutable authority, non-prefixed downgrade refusal, expiry caps and a real lock wait across the authority deadline.
- Existing platform and site API-client regression passed 47 tests and 513 assertions.
- The actual new Hono route passed 11 assertions for default-off, exact target/origin, bearer mint and signed exchange. Its owner adapter and rate-limit seams were controlled, and that limit is retained in the artifact receipt.
- Network TypeScript checks passed. Sparse Cloud TypeScript/TSX files were syntax-transpiled only; **full Cloud owning types, router generation, Worker build, frontend render and hosted flow are not yet qualified**.

Independent review found and verified fixes for primary phone ownership evidence and non-null grant downgrade. Pinned Cloud schemas declare unique phones and Steward subjects in both canonical and identity tables; deployed constraints still require the normal schema qualification. A failed initial JSONB encoding test and an owned lazy-SQL assertion timeout were corrected; only the owned test process was interrupted. No other job was restarted or signaled.

## Validation I/O and integration gate

There is no validation cache, retry or background loop. Each website request, MCP bearer use and refresh adds one bounded Cloud validation request. Cloud validation reads its primary logout marker, canonical Steward owner and the joined current user/org/phone projection. Consent creation may validate twice at its separate current-session and pre-grant fences. Exchanges also retain before/after-sign owner checks. These are bounded observations across systems, not a distributed atomicity guarantee.

Cloud artifacts and exact pinned-file integration patches live under `/Users/nubs/.local/state/network-production-handoff-20261018/cloud-source`; they remain outside the busy Cloud checkout. Root must review their hashes and rebase the small mounts/exports/environment declaration onto the then-current qualified Cloud successor, regenerate its router and qualify normal types/build/startup. The explicit Continue page follows the incumbent SSO components and passed the mechanical UI detector; it has not been browser-rendered. Cloud remains the sole publisher, phone and owned-browser operator. A real returning owner must then prove same original Cloud user/org/personal agent/history and Network person/app/member through actual website and GPT usage. Google/MCP scopes, matching and background import remain deferred.
