# Dev Postgres creates the selected login

On November 14, 2026 the startup integration test passed one case
and failed the fresh-cluster case when USER was unset. The init tool
created the OS login, while Bun tried the postgres fallback.
With one resolved login for init, readiness, and connections,
both integration tests pass. The new test starts owned loopback
clusters with USER unset and with a synthetic override. It queries
the actual current user from the returned URL.

Run `bun test packages/observatory/test/dev-pg-env.integration.test.ts`.
No seeded workload, provider, agent client, or data beyond the
test databases was used.
