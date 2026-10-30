# Run the Wrangler integration checks with PATH Bash

## Reproduced defect and scope

On native Windows, `deploy/wrangler.integration.test.ts` fails at `Bun.spawnSync(["/bin/bash", ...])` with `ENOENT`. The existing test never reaches its session, account or deployment checks. The failure persists with Git Bash on PATH. Its colon-separated fixture PATH also cannot directly contain a Windows drive-letter path.

This repairs an existing integration test under the approved reproduced-bug scope. The contract is documented in `docs/deploy.md` section 3.1: normal isolated context, optional OS-session discovery, required account and explicit deployment approval. No production script, deployment rule, site, dependency or model behavior changes.

## Implementation

Resolve Bash with `Bun.which("bash")`; absence is an actionable test failure. Start it without profile or rc files. Set the child's working directory to the fixture and derive its POSIX PATH from `$PWD`. The recording `bunx` comes first, followed by shell tools. Pass the actual wrapper path and commands as separate arguments, with Windows separators normalized. Use a synthetic HOME and an isolated environment. The temporary fixture directory contains spaces.

All original assertions remain. Only the expected home path changes to the synthetic one. The test still runs the actual wrapper in child processes. Its CLI boundary records arguments; it never loads Wrangler, signs in or contacts Cloudflare. Any deployment-approval flag exists only in that synthetic child environment.

Alternatives: an absolute Git Bash path assumes one installation location; skipping the test on Windows loses the guard checks. PATH discovery with a clear prerequisite works with custom installations and ordinary POSIX Bash.

## Revisions and environment

- Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
- Code: `7a9024e1a4ec70162a996b974708865c10643e96`.
- Combined local compatibility code: `2493b8b1a97bbbe6eed6fe6b1fc6be95bfcdf9ee` (never pushed).
- Windows, Bun 1.4.2 (`744846f84`), Git Bash 5.2.37 (`x86_64-pc-msys`), local PostgreSQL 16.15 on port 54339.
- Same focused command and PATH before and after. One deterministic test; no random seeds or statistical estimate applies.

## Measurement and safety gates

| Check | Result |
| --- | --- |
| Focused test, base | 0 pass, 1 fail; ENOENT before assertions |
| Focused test, fixed | 1 pass, 0 fail, 19 assertions |
| Focused test with prior contributions | 1 pass, 0 fail, 19 assertions |
| Typecheck, base / fixed / combined | All four configurations pass |
| PostgreSQL safety | 17/17; all records identical to the earlier exact-main run, excluding runtime |

The safety comparison reuses `pay-range-safety-before.json`, previously recorded on the same base; it is not a new before run. The existing integration case is the regression proof. No extra unit test, simulation gate, coverage-only case or full simulation run was added. The repository's one-full-run allowance was used earlier; only the safety block was rerun here.

The 19 assertions cover isolated default context, OS-session opt-in, explicit context and account, missing-account refusal, denied and approved synthetic deployment in both session modes, read-only listing, and rejection when the last dry-run flag disables dry-run.

Integration, including the security suite:

```text
676 pass
8 skip
5 fail
13760 expect() calls
Ran 689 tests across 68 files. [478.23s]
```

Five remaining failures are the existing backend SIGTERM exit 143 instead of 0 and four site artifact path comparisons. The latter have a separate draft fix in #223. Eight skips are existing opt-in cleanup and hooks. No full integration pass is claimed, and the standalone suite does not include other draft fixes.

E2E:

```text
42 pass
1 skip
0 fail
654 expect() calls
Ran 43 tests across 3 files. [45.56s]
```

The E2E skip is the optional browser module. The combined check reruns the affected Wrangler test and typecheck, not the combined full integration suite.

## Reproduce

On Windows, put Git Bash's `bin` directory on PATH (the local run used `C:\Program Files\Git\bin`). Linux/macOS need Bash on PATH; those operating systems were not run locally.

```powershell
$env:PATH='C:\Program Files\Git\bin;' + $env:PATH
bun test --conditions eliza-source deploy/wrangler.integration.test.ts
bun run typecheck
```

With the repository's local dev PostgreSQL running on 54339 and `REQUIRE_PG=1`, `PG_BIN_DIR`, `OBSERVATORY_PG_DIR` and `OBSERVATORY_PG_PORT` set for that cluster:

```powershell
bun run sim --only safety --json ../wrangler-launch-safety.json
bun run test:integration
bun run test:e2e
```

Expected focused result: one passing test with 19 assertions. On the recorded Windows environment, expect the five unrelated integration failures above. PostgreSQL suites ran sequentially; no live-send or real deployment operation ran.

## LLM evidence, agent clients and limits

Validation model calls: 0; cost: $0. Real-LLM evidence is N/A because this change only launches a local integration test. External agent-client acceptance is N/A; no user-facing agent flow changes. Authoring: OpenAI `gpt-6-astra`, Codex; installed app package 26.1023.6621.0. This is not a multi-client acceptance claim.

Git Bash is a prerequisite on Windows. Missing Bash still fails explicitly; Windows Subsystem for Linux, Linux, macOS and alternate Bash distributions were not tested. Hosted CI and maintainer review remain required. The production wrapper is byte-identical to base.
