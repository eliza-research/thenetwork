# Development PostgreSQL: create the login that startup uses

Date: 2026-10-29. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Tested code: `bb499288f530a60750643ff96c0f45d83985bf75`.

## Requirement and cause

This is a reproduced setup defect under the approved Slop scope and CONTRIBUTING.md section 3.1.
[CONTRIBUTING.md section 4](../../CONTRIBUTING.md#4-setup) requires the development database startup command.
[The Observatory guide](../observatory.md) uses the same helper for local development.

Fresh setup fails when the operating-system login differs from `USER`, or from the helper's `postgres` fallback.
`initdb` defaults to the operating-system login when `-U` is absent.
The helper then connects as `process.env.USER ?? "postgres"`, which names a role that does not exist.
Existing database tests reuse a running server, so they do not detect this first-start failure.

Pass the helper's existing login expression to `initdb -U`.
This changes only the login created for a fresh development cluster.
It preserves the current local trust setting, startup connection, and database URL.

Other implementations considered:

1. Change all connection URLs to the operating-system login. This ignores the configured login and the existing fallback.
2. Create the requested role after initialization. This needs another connection using the operating-system role, then extra database changes.

The explicit `initdb` option sets the intended role before the first connection.

## measurement

Environment: Windows, Bun 1.4.2, TypeScript 5.9.3, PostgreSQL 16.15.
One integration case exercises the real startup CLI, migrations, database queries, shutdown, and restart.
It uses two fresh private clusters: `USER` absent, then `USER=bootstrap_<process-id>`.
The latter differs from the operating-system login. Process IDs and free loopback ports provide isolation only.
The same final fixture ran before and after the production change. There are no SQL or process mocks.

| Observation | Before | After |
|---|---|---|
| Fresh startup uses the expected login and migrates `network.members` | 0/2 | 2/2 |
| Saved row and login survive shutdown and restart | Not reached | 2/2 |
| New integration case | 0 pass, 1 fail | 1 pass, 0 fail |
| Assertions reached | 1 | 15 |
| Elapsed time | 26.29s | 50.50s |

Before, both fresh starts report a missing login. The default case reports `role "postgres" does not exist`.
After, each cluster stores row `42`, restarts through the production command, and returns that row under the expected login.

The new file is necessary because a test that reuses the normal development cluster cannot exercise initial cluster creation.
It adds one integration case, as required by CONTRIBUTING.md section 12.1.

### Pipeline comparison

Both cold runs use `USER=postgres`, port 54349, and separate empty task directories.
The helper initializes each directory. The operating-system login differs from `postgres`.
The command is `bun run sim --only pipeline --json <output-file>`.
This block uses its fixed scripted scenario; no sampled seeds or model request settings apply.

| Run | Blocking gates | Tracked result | Time |
|---|---|---|---|
| Base, fresh cluster | Only the dry-run gate ran, 1/1 | Database path skipped | 12.3s |
| Base, working existing cluster | 15/15 | 0 off target | 11.4s |
| Fix, fresh cluster | 15/15 | 0 off target | 31.1s |

The base cold run exits zero despite the skip. It is not a successful full pipeline run.
Its skip message names the helper's default port, 54339; this experiment actually configured port 54349.
All 16 gate records after the fix equal the working base records after excluding elapsed milliseconds.
The records include 62 outbound rows, 57 delivered messages, 62 provider calls, and 53 inbound rows.
The provider is the repository's local fake transport. No real messages are sent.

## safety_gates

All 15 pipeline blocking gates pass after the fix.
The records preserve zero lost messages, zero duplicated messages, and zero forbidden sends after STOP.
Minor-contact, review, restart, retry, quiet-hours, and daily-cap checks retain their working base results.
Review approval uses the test scenario's simulated staff actions.
No production credentials, live-send flags, gate thresholds, or corpora changed.

## Validation

Commands ran with PostgreSQL binaries on PATH, `PG_BIN_DIR` set, and `REQUIRE_PG=1`.
The full suites used the task's existing local cluster on port 54339 with `USER=postgres`.
The new test overrides its child processes with fresh private directories and free loopback ports.
It stops each private cluster, checks its directory boundary, and removes only its generated directory.
Port 54329 was not used.

| Command | Result |
|---|---|
| `bun run typecheck` | Exit 0 |
| `bun run test:integration` | 676 pass, 8 skip, 6 fail; 13756 assertions; 690 tests, 69 files; 661.55s |
| `bun run test:e2e` | 42 pass, 1 skip, 0 fail; 654 assertions; 43 tests, 3 files; 112.33s |

All eleven files from `bun run security` executed in the integration suite, which includes that suite.
The six failures match the previously recorded Windows baseline: absolute `/bin/bash`, SIGTERM exit status, and four site path comparisons.
The eight integration skips require the opt-in reconciliation setting. The end-to-end skip requires external origins.
No new full baseline integration run was performed for this patch; its paired before/after proof is the cold-start case and pipeline run.
The full integration suite is not green on this machine. Keep the PR draft pending maintainer-approved Linux CI.

The local combined branch includes this fix and the seventeen prior contributions.
At `0ba61b2a24b5f4bacf9141f0aefec3743cb2174b`, the new case passed with 15 assertions in 58.11 seconds.
Its pipeline passed 15/15 blocking gates, with the same 16 records, in 14 seconds. Typecheck passed.
This is affected-path combined validation, not a new full combined integration run.
The session's full-simulation allowance was used earlier; only the affected pipeline block ran for this patch.

### Reproduce

Install Bun 1.4.2 and PostgreSQL 16. Put PostgreSQL programs on PATH.
Run `bun install --frozen-lockfile`.
Run the following from the repository root with `REQUIRE_PG=1`:

```text
bun test --conditions eliza-source --timeout 120000 packages/observatory/test/dev-pg.integration.test.ts
bun run sim --only pipeline --json runs/dev-pg-pipeline.json
bun run typecheck
bun run test:integration
bun run test:e2e
```

The first command should report two fresh starts, two persisted restarts, and one passing case.
To reproduce the failure, apply only the new test to base `a0ed7bc` and run the first command.
Use a fresh private `OBSERVATORY_PG_DIR` and a free non-54329 port for a cold pipeline run.
Set `USER=postgres` when the operating-system login differs. Stop that cluster with the helper's `down` command afterward.
Do not use an existing data directory for the cold comparison.

## llm_evidence

N/A: this patch changes local PostgreSQL initialization, with no model-backed behavior.
Model API calls: 0. API cost: $0. No mocked model output is used as proof.
Authorship: OpenAI / `gpt-6-astra`, client `codex`.

## agent_clients

N/A: the affected workflow is the local development CLI, not an agent connector or member conversation.
Bun 1.4.2 drove the actual PostgreSQL CLI and production helper on Windows.
No external agent-client or other operating-system result is claimed.

## Limits and attempts

One production implementation was measured. Fixture environment and SQL result types were corrected before the final paired measurement.
The final fixture remained unchanged across that pair. No gates or thresholds were relaxed.
The two configurations are deterministic reproductions, not a population sample; no confidence interval applies.

The fix affects fresh clusters only. It does not repair an existing cluster created with the wrong login.
The test selects an available port before launching PostgreSQL; another local process could claim it in that interval.
The restart checks validate persisted data; they do not claim crash-recovery coverage.
There are no UI, deployment, authentication-policy, dependency, or member-data changes.
All test data is synthetic. Raw logs and database files remain outside the commit.
