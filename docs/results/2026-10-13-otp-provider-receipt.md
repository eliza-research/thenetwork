# OTP provider receipt retention

Historical record. The [original revision](https://github.com/eliza-research/thenetwork/blob/1e2caa5028ade43ec7cb6a90de16466584f7ead0/docs/results/2026-10-13-otp-provider-receipt.md) retains the commands and toolchain used for the observations. Updated command spellings here describe the current project where the same entrypoints exist.

Date: 2026-10-13. Attribution: Automated. Base: `4da00ca`.
Reproduced issue: [#68](https://github.com/eliza-research/thenetwork/issues/68).

Blooio returns both a message ID and a chat ID. The OTP adapter kept only the
message ID. Its status endpoint requires both IDs. This prevented a private,
status-only check of the exact accepted request.

The adapter now passes the optional chat ID through the existing OTP service.
The Postgres store keeps it in nullable `provider_chat_id` beside `provider_ref`.
Migration 0034 adds the column. Existing challenges and providers can omit it.
The code adds no status polling, send retry, fallback, public endpoint or log.

Two alternatives were rejected: storing a JSON receipt would retain more data
than required; a separate delivery table/worker would duplicate the existing
challenge and client for a single lookup.

## Closed integration evidence

the former runtime 1.4.2. Local Postgres on port 54339, isolated per-process test databases.
No live provider or model call. Provider/model/seed/request settings: N/A;
this change retains transport metadata and does not change inference.
The provider fixture uses real local HTTP, including the existing canonical
Blooio client. The database tests use the normal migrations and PgPeopleStore.

With `REQUIRE_PG=1` and `OBSERVATORY_PG_DIR` pointing at the owned local cluster:

```sh
pnpm exec vitest run --testTimeout 120000 packages/platform/test/blooio-otp.integration.test.ts
```

Before the source fix: 5 passed, 1 failed, 120 assertions. The new test failed
because the reloaded challenge had no `providerChatId` despite a send response
containing it. After: 6 passed, 0 failed, 138 assertions.

The test reloads the challenge through a new PgPeopleStore, reads both saved
locators, and calls only `/chats/<chat>/messages/<message>/status` over HTTP.
The response is status-only. The send count stays unchanged. Auth responses
and ordinary logs contain no code, key, message ID or chat ID. A receipt without
a chat ID still verifies normally. Existing cases cover provider binding,
Twilio verification, expiry, attempt limits, one-use codes and uncertain sends.

```sh
pnpm exec vitest run --testTimeout 120000 packages/platform/test/blooio-otp.integration.test.ts packages/platform/test/db.test.ts packages/observatory/test/migrations.test.ts
node node_modules/typescript/bin/tsc --noEmit -p .
```

Broader result: 21 passed, 0 failed, 264 assertions. Root TypeScript check passed.
The migration suite includes repeat application and database role guards.

## Acceptance limits

These results prove local HTTP/PG retention and status lookup. They do not prove
live delivery, deployment, OAuth completion, Cloud account mapping or chat-history
continuity. No live code was requested for this patch. Old challenges cannot gain
a missing chat ID retroactively. The field follows existing OTP challenge
retention and deletion; no new public metadata access is introduced.
