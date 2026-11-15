# The dev Postgres startup reads the copied .env.example's empty values correctly

Date: 2026-10-31. Hand-written by the contributor. No model output is in this report. The
reproduction is deterministic (a child process sees the exact empty values a copied
`.env.example` carries, and base a0ed7bc fails on every run of the same command).

## The problem

CONTRIBUTING.md section 4 says: `cp .env.example .env`, then
`bun run packages/observatory/db/dev-pg.ts up`. `.env.example` lists every optional value as an
EMPTY line (`OBSERVATORY_PG_PORT=`, `OBSERVATORY_PG_DIR=`, `PG_BIN_DIR=`), and section 5.1 says of
these: "Optional. Leave the default." Bun loads the copied `.env` into the process, so the dev
startup then reads these empty strings:

```ts
export const DEV_PG_DIR = process.env.OBSERVATORY_PG_DIR ?? join(REPO, "runs", "pg");   // "" wins over the default
export const DEV_PG_PORT = Number(process.env.OBSERVATORY_PG_PORT ?? 54339);             // Number("") = 0
```

`"" ?? default` keeps the empty string, so on the base revision the documented command broke two
ways: `mkdirSync("")` threw ENOENT, and in the port variant the server refused port 0
(`"0 is outside the valid range for parameter port (1 .. 65535)"`). The first failure shown
below is the one I hit twice while setting up this machine, before I understood the cause.

## The reproduction (before, on a0ed7bc)

The new integration case runs the real CLI as a child process with exactly the values a copied
`.env.example` carries: `OBSERVATORY_PG_PORT=""`, `OBSERVATORY_PG_DIR=""`, `PG_BIN_DIR=""`.

```text
bun test --conditions eliza-source packages/observatory/test/dev-pg-env.integration.test.ts
  (fail) ... : expected "exit 1: ... at devPgUp (dev-pg.ts:36:5) ... code: \"ENOENT\"" to be "exit 0: "
```

On the command line, the same thing (any shell, base revision):

```text
OBSERVATORY_PG_DIR= OBSERVATORY_PG_PORT= bun packages/observatory/db/dev-pg.ts up
  error: ... code: "ENOENT" ... at devPgUp (dev-pg.ts:36:5)
```

The sim's Postgres blocks use the same helper (`devPgUp`), so with the copied `.env` the pipeline
block degraded to its tracked "skipped" line on a machine that followed the documentation.

## The fix

An empty or all-whitespace value now reads as "leave the default", which is what the copied file
and section 5.1 mean by it:

```ts
export const DEV_PG_DIR = process.env.OBSERVATORY_PG_DIR?.trim() || join(REPO, "runs", "pg");
export const DEV_PG_PORT = Number(process.env.OBSERVATORY_PG_PORT?.trim() || 54339);
```

`deploy/backup/lib.ts` already picks its `PG_BIN_DIR` the same way (`filter(Boolean)`), so this
matches an existing repo idiom. A value with text still overrides exactly as before.

## The evidence

| Metric | Before (a0ed7bc) | After | Command and seeds |
|---|---|---|---|
| New integration case (the documented command under the copied values) | 1 fail (exit 1: ENOENT) | 1 pass (exit 0, answers `localhost:54339/network`) | `bun test --conditions eliza-source packages/observatory/test/dev-pg-env.integration.test.ts` |
| `bun run packages/observatory/db/dev-pg.ts up` on the CLI with the copied values | ENOENT (or port 0) | starts/answers on the default 54339 | same values in the shell |
| `bun run sim --only pipeline` with the copied values | the block's Postgres helper fails, block records the tracked skip | `15/15 blocking gates pass` on base+fix (this branch: base main + this change) | `OBSERVATORY_PG_DIR= OBSERVATORY_PG_PORT= PG_BIN_DIR= bun run sim --only pipeline` |

Model evidence: none; no model is called. Agent clients: not applicable — a developer-setup fix;
nothing a member or an agent can observe changes.

## Validation

Same machine, Bun 1.4.4 (and the same code passes under the CI-pinned 1.4.2 semantics), dev
PostgreSQL 16 on :54339. Summary lines are pasted in the pull request. `bun run typecheck` is clean on all four
projects; `bun run test:integration` runs `681 pass, 8 skip, 1 fail` (the one fail is the known
pre-existing `real-fixes.test.ts` defect of the base revision, fixed by pull request #314; the new
case itself passes); `bun run test:e2e` runs `42 pass, 1 skip, 0 fail`.

## Limits

- Only the two dev-cluster values that `.env.example` presets empty are guarded (`OBSERVATORY_PG_DIR`,
  `OBSERVATORY_PG_PORT`); `PG_BIN_DIR` was already guarded (`deploy/backup/lib.ts`), and the other
  `Number(process.env.X ?? ...)` readers are not values `.env.example` presets, so they stay as
  they are (a manually exported empty value there still reaches them, same as before).
- The wrong-number shape (`Number("") === 0`) exists in a few other readers (listed in the pull
  request); none of them is part of the documented setup path, so no other change is made.
