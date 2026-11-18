# Staff ban and existing credentials

On November 14, 2026 we ran the Postgres staff safety, OAuth,
Cloud session, and Cloud connector test files. Current main returned
HTTP 200 for existing cookies after both ban scopes and for an issued
OAuth access token after a canonical ban. The patched run passed 32
tests. An unrelated account stayed authorized. An old browser cookie,
an access token, a refresh token, and an unused code no longer authorize
after the applicable ban. No external client or model is needed to
exercise these database and HTTP checks.

Run `bun test --conditions eliza-source --timeout 120000` with
`packages/network/test/service-safety.test.ts`,
`packages/mcp/test/pg.test.ts`,
`packages/platform/test/cloud-auth.pg.test.ts`, and
`packages/mcp/test/cloud-oauth-continuation.integration.test.ts`.
The staff safety suite uses its fixed simulated clock and seed 1. The
Vibespec checks passed Quint simulation and replay for both affected
modules. All 14 Dafny obligations passed. Human review remains due.
