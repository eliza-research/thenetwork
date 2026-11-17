# STOP hint interval — 22 October 2026

Historical record. The [original revision](https://github.com/eliza-research/thenetwork/blob/1e2caa5028ade43ec7cb6a90de16466584f7ead0/docs/results/2026-10-22-stop-hint-cooldown.md) retains the commands and toolchain used for the observations. Updated command spellings here describe the current project where the same entrypoints exist.

A person who sent STOP could receive two START hints one minute apart.
The two messages crossed a fixed 30-day counting boundary.
The accepted requirement limits hints to one per number and app in 30 days
(`docs/prd-pending-edits.md`, item 4; PR #56; PRD 40.3).

The service now uses the existing store minimum-gap rule. The store compares
with the last admitted attempt under its transaction lock. A refused attempt
does not move that time. No schema, message copy, or dependency changes.

Two alternatives were considered:

- A separate last-hint table would duplicate the existing store and need a migration.
- A sliding list of all hint times would store more data than this requirement needs.

The existing `PeopleStore.hit` rule supplies the required atomic decision.
Admission still occurs before delivery, as before. A delivery failure can consume
the interval. This fix does not claim a new delivery retry guarantee. Existing
records can conservatively defer the first hint after upgrade because the former
counter recorded every attempt.

## Reproduction and verification

Base: `d617f7b155c2863d7f7dee2693e85e770889e229`.
the former runtime 1.4.2, macOS, dedicated local PostgreSQL, `REQUIRE_PG=1`.
The existing integration case uses signed inbound HTTP, real database state,
a controlled clock, fictional phone numbers, and a dry-run delivery adapter.
The service uses seed 1. Clock offsets determine this case. One member and one
stranger exercise the changed case.

```sh
pnpm install --frozen-lockfile --ignore-scripts
REQUIRE_PG=1 pnpm exec vitest run --conditions eliza-source packages/network/test/service-platform.test.ts -t 'after STOP, a later'
pnpm run typecheck
REQUIRE_PG=1 pnpm run test:integration
REQUIRE_PG=1 pnpm run test:e2e
node --import tsx --env-file-if-exists=.env plugins/build.ts --check
pnpm run sites:build
```

Use a dedicated `OBSERVATORY_PG_PORT` and `OBSERVATORY_PG_DIR` for isolation.

1. Join as an adult and send STOP.
2. Send a message one second before a fixed 30-day boundary.
3. Send another message one minute later. Expect only one START hint.
4. Send a message just before 30 days from the first hint. Expect no new hint.
5. Send again after the interval. Expect a second hint.
6. Verify that a stranger can still use START to opt in.

With the extended case and unchanged base runtime, step 3 failed: two hints
instead of one. With the repair, the same case passed all 18 assertions.

- Type checking: passed.
- Integration: 678 passed, 8 skipped, 0 failed; 13,728 assertions.
  Skips belong to the separately enabled cleanup reconciliation suite.
- E2E: 42 passed, 3 skipped, 0 failed; 637 assertions.
- Plugin snapshot check: passed.
- Four production site builds: passed.

Provider/model/request settings: N/A for this deterministic path. Zero model
calls and zero inference cost. No live provider delivery, deployment, or external
agent-client acceptance is claimed. The dry-run adapter proves the service's
admission decision, not delivery by a carrier. No UI or message copy changed.
