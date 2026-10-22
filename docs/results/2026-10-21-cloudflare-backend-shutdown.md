# Cloudflare backend deactivation

Deactivating the Worker previously blocked requests and cron but left an already
running backend scheduler alive until its idle timeout. The inactive request and
cron paths now send SIGTERM when runtime configuration is present. Rollback must
still verify the container is stopped before starting another writer.

Validation used Bun 1.4.2, the pinned Wrangler 4.136.3, real local Workerd and
Docker. A minimal HTTP process tested lifecycle only, without production data or
backend credentials. It became healthy, received deactivation, and exited with
code zero. Restarting it and invoking the disabled cron also reached
`stopped_with_code` with exit code zero. This is not production application acceptance.

`bun run typecheck` passed. The backend/router PostgreSQL integration command,
`REQUIRE_PG=1 bun test --conditions eliza-source --timeout 120000 ./deploy/backend/backend.test.ts ./deploy/router.test.ts`,
passed 60 tests and 434 assertions. The full simulation was already run for the
hosting change (330/330 blocking gates); it was not rerun for this lifecycle fix.
