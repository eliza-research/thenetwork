# Cloudflare backend hosting

The owner requested removal of Railway compute, with PostgreSQL retained on Railway.
The existing backend image now has a Cloudflare Container wrapper.
Its default inactive state prevents a second job processor from starting.

Validation used Bun 1.4.2, local PostgreSQL, and the repository's pinned Wrangler 4.136.3.
The Worker uses compatibility date 2026-09-28, supported by that local runtime.
No live deployment, database change, message send, or routing change occurred.

| Command or check | Result |
|---|---|
| `bun run typecheck` | Passed, including a separate Worker configuration |
| `REQUIRE_PG=1 bun test --conditions eliza-source --timeout 120000 deploy/backend/backend.test.ts deploy/router.test.ts` | 60 passed, 434 assertions |
| `REQUIRE_PG=1 bun run test:integration` | 678 passed, eight skipped, zero failed |
| `REQUIRE_PG=1 bun run test:e2e` | 42 passed, three skipped, zero failed |
| `REQUIRE_PG=1 bun run sim` | 330/330 blocking gates passed; 14 tracked metrics off target |
| `scripts/wrangler.sh deploy --dry-run --config deploy/cloudflare/wrangler.toml --env staging` | Built the existing backend image and bundled the Worker |
| Local Workerd, inactive `/healthz` | 503; no runtime credentials installed |

The integration skips belong to the optional isolated cleanup-reconciliation fixture.
The e2e skips remain in the existing suite. They do not prove those flows passed.
The simulation used the repository's pinned seeds and simulated review, with no model calls.
Real-LLM evidence and agent-client comparisons are not applicable to this hosting wrapper.
The backend and signed proxy integration exercised real HTTP and PostgreSQL.

Live acceptance remains open: establish Cloudflare-reachable PostgreSQL connections
with the existing restricted role, reconcile served source and schema, transfer
job ownership, verify signed site and service requests, then change routing.
The staff listener must remain private. Send and matching approvals must not change.
