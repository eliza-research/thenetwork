# Dev Postgres creates the selected login

Historical record. The [original revision](https://github.com/eliza-research/thenetwork/blob/1e2caa5028ade43ec7cb6a90de16466584f7ead0/docs/results/2026-11-14-dev-postgres-login.md) retains the commands and toolchain used for the observations. Updated command spellings here describe the current project where the same entrypoints exist.

On November 14, 2026 the startup integration test passed one case
and failed the fresh-cluster case when USER was unset. The init tool
created the OS login, while the former runtime tried the postgres fallback.
With one resolved login for init, readiness, and connections,
both integration tests pass. The new test starts owned loopback
clusters with USER unset and with a synthetic override. It queries
the actual current user from the returned URL.

Run `pnpm exec vitest run apps/observatory/test/dev-pg-env.integration.test.ts`.
No seeded workload, provider, agent client, or data beyond the
test databases was used.
