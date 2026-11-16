# OAuth refresh issuance: PostgreSQL failure recovery

Historical record. The [original revision](https://github.com/eliza-research/thenetwork/blob/1e2caa5028ade43ec7cb6a90de16466584f7ead0/docs/results/2026-10-13-oauth-refresh-atomic.md) retains the commands and toolchain used for the observations. Updated command spellings here describe the current project where the same entrypoints exist.

Date: 2026-10-13. Automated Codex/agent work under Nubs's standing project approval.

A failed replacement-token or audit insert consumed the original refresh token before returning HTTP 500. Retrying that original token then triggered the existing replay policy, which revokes the grant. The repair commits refresh consumption, both replacement tokens and the success audit in one PostgreSQL transaction. A failed write now leaves the original state intact for retry. Replay revocation remains unchanged.

## Method

The same three integration cases run through an actual loopback the former runtime HTTP server and `PgOAuthStore`, with PostgreSQL triggers failing the access-token insert, refresh-token insert or success-audit insert. Each case reconstructs the handler/store against the same database, expires the access token using the fixture clock, checks durable rollback, retries the original refresh token and checks replay revocation of the newest tokens.

Platform identity and OTP use the existing fictional harness. This is real HTTP/Postgres protocol qualification, not a personal-account, provider, full-platform restart or deployed signup test. No live member data, SMS, model calls or provider credentials are used.

- Runtime: the former runtime 1.4.2, normal CI's pinned PostgreSQL 16 service (`ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d`).
- Command before and after: `pnpm run test:integration` (`pnpm exec vitest run --testTimeout 120000 ./deploy ./packages ./sites`).
- Sample: three deterministic fault cases. Seeds, LLM provider/model, request settings and model cost: N/A; this path makes no model requests.
- Fixture databases: random owned `mcp_test_*` databases on the CI loopback PostgreSQL service. No production database is contacted.

## Observed results

| Injected failure | Before | After |
| --- | --- | --- |
| Access-token insert | HTTP 500; original refresh token marked rotated | HTTP 500; token rows/audit unchanged; original-token retry succeeds |
| Refresh-token insert | HTTP 500; rotation and an orphan access token persisted | HTTP 500; token rows/audit unchanged; original-token retry succeeds |
| Success-audit insert | HTTP 500; rotation and replacement pair persisted without a successful response | HTTP 500; token rows/audit unchanged; original-token retry succeeds |

Before: test-only commit `b2a73499fe23a503da4e5d22db2c92eaa012f138`, [CI integration job](https://github.com/eliza-research/thenetwork/actions/runs/38421129062/job/115378423803). All three cases failed the rollback assertion at `pg.test.ts:126`, after the expected HTTP 500. This was not a PostgreSQL readiness or setup failure. Summary: **533 pass, 3 fail**. Retrieved job log SHA256: `f96db1a122192fe8b3ec11d55393a3164e665b5a4f775904894a1395449d9550`.

After: repair commit `c2640b960a605fc402f08a88f2de7fbf36663daf`, [CI integration/E2E job](https://github.com/eliza-research/thenetwork/actions/runs/38423276470/job/115385924555). The test file is byte-identical to the baseline. All three fault cases passed. Summaries: **536 pass, 0 fail, 11,262 assertions** for integration; **40 pass, 0 fail, 555 assertions** for E2E. Retrieved job log SHA256: `bd5215c3e3c6cdd9bd597ce736dd2e9e7b02ec05eee51fc2b366377235fa6c4c`.

The complete normal CI run for repair commit `c2640b960a605fc402f08a88f2de7fbf36663daf` succeeded, including both integration/E2E and offline checks. Offline qualification passed **329/329 blocking gates**, with **14 existing tracked off-target results** disclosed; simulation elapsed time was 556.8 seconds. Offline job log SHA256: `04b74d6448827be9e5181f1ba2866671b75bfcfb0ab842a2a1f81df1269c6715`. The evidence-document commit will receive its own normal final-head checks in PR #74 before merge. CI success does not establish deployment or real-account acceptance.

## Design and limits

The existing store boundary owns the transaction; the memory store applies the corresponding update synchronously. Pair construction is shared by authorization-code exchange and refresh. PKCE, app/person/resource/scope validation, lifetimes and whole-grant revocation on refresh replay remain intact.

Handler-specific database access would couple the protocol layer to PostgreSQL. Compensating rollback after visible consumption would retain a race/failure window. A store transaction avoids both alternatives.

This covers database failure before commit. Losing an HTTP response after a successful commit, and authorization-code consume/mint atomicity, are outside this repair. Custom `OAuthStore` adapters must implement the expanded atomic rotate contract. The results do not explain the cause of any particular real ChatGPT disconnect. Production deployment, personal Terms/consent and same-account/assistant/history acceptance remain independently gated.
