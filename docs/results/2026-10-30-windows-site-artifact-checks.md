# Correct Windows artifact-path validation

The four site builds contain their agent-skill discovery files, but their integration
checks report those files missing on Windows. `sites/sites.ts` returns relative
filesystem paths from `walk()` using `node:path.join`; the expected names in
`sites/test/sites.test.ts` use forward slashes. A Windows path such as
`.well-known\agent-skills\index.json` does not equal the expected string.

The fix passes the expected name through the existing `join` import before the
exact comparison. Production code and generated content are unchanged. This is a
reproduced validation defect within the approved scope, covering the existing
agent-first build documented in PRD 28.3 and 40 and `sites/README.md`.

Changing `walk()` would alter the filesystem-path contract for its build callers.
Skipping the assertion on Windows would lose coverage. Normalizing the expected
path keeps the existing contract and checks all required files on either platform.

## Revisions and environment

- Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
- Fix: `23a07ef96a2ef007919770b6ca9cc5a2cbce4eca`.
- Local combined compatibility revision: `9071a313685742a46ff245aab8311c2ac9ac6abf`; this branch is not pushed.
- Native Windows, Bun 1.4.2, PostgreSQL 16.15 on the isolated local port 54339.
- `core.autocrlf=false`; dependencies installed with `bun install --frozen-lockfile`.
- Related #177 fixes CRLF skill parsing separately. These comparison failures are
  explicitly listed as remaining in that PR. This change does not depend on it.

## measurement

At the base and fixed revisions, run the same command:

```sh
bun test --conditions eliza-source --timeout 120000 ./sites
```

The existing suite builds all four production sites into temporary directories
and exercises the local HTTP dev server. No build or file listing is mocked.

| Result | Before | After | Combined |
|---|---:|---:|---:|
| Tests passing | 84 | 88 | 88 |
| Tests failing | 4 | 0 | 0 |
| Assertions executed | 964 | 1,141 | 1,141 |

The same 88 test names ran in every suite; all 84 prior passes remain passing.
The extra assertions are the existing checks that now run after the formerly
failing comparison: nonempty files, identical static-file bytes, filled template
values and required skill instructions. No assertion was removed or relaxed.

Negative control: in a temporary copy of the existing test file, insert
`rmSync(join(out(s), ".well-known", "agent-skills", "index.json"));` immediately
before `const files = walk(out(s));`. Run that copy with
`--test-name-pattern 'the build ships the files'`. The four real builds succeed,
then all four corrected checks fail because their index files are actually absent
(0 pass, 4 fail, 16 assertions, 75 other tests filtered out). Remove the temporary
test copy afterward; it is not part of the patch.

`bun run typecheck` passes all four configurations at the fixed and local combined
revisions. Full integration was run at the standalone fixed revision:

```sh
REQUIRE_PG=1 bun run test:integration
```

```text
679 pass
8 skip
2 fail
13918 expect() calls
Ran 689 tests across 68 files. [390.58s]
```

The isolated development PostgreSQL cluster uses port 54339, role `postgres`,
`PG_BIN_DIR`, `OBSERVATORY_PG_DIR` and `OBSERVATORY_PG_PORT=54339`. Database suites
run sequentially. The two failures are the existing `/bin/bash` lookup in the
Wrangler test and Windows returning exit code 143 instead of 0 after SIGTERM.
The skips are the opt-in cleanup reconciliation cases and their hooks. The full
integration command remains red; Linux execution and hosted CI are not claimed.

## safety_gates

This changes only an existing test assertion. Full integration includes the
security files; the backend SIGTERM case above remains a failure. Exact required
filenames, nonempty checks and byte comparisons remain enforced. No matching
policy, consent, account access, runtime code, UI or copy changes. All builds and
HTTP requests are local; no deployment or live sends. No new matching simulation
or E2E run is claimed for this test-only change.

## llm_evidence

Deterministic filesystem validation: zero validation model calls and $0 provider
cost. This does not qualify model-backed behavior.

## agent_clients

Authoring: Codex desktop, OpenAI `gpt-6-astra`; installed Windows app package
26.1023.6621.0 (package inventory, not a running-executable version claim).
Validation uses Bun directly. No external-client acceptance run was performed
for Claude Code, Codex/ChatGPT, Hermes Agent, OpenClaw, Muse, Grok bot, an elizaOS
agent or Cursor. Their member flows are unaffected by this test-only correction.
