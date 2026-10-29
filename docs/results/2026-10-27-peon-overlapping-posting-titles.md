# Select the named posting and retain ambiguous close requests

Updated: 2026-10-30. Main base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Latest paired baseline: published PR head `cab17b6c33ac84a1ea6a95bd03f835d6728c4782`.
Tested code: `7c49ef08ab88f71924e02d52c0615aa7b19c3021`. Combined code: `fbe14e17d878e5aa024e958f9de2267bcf872beb`.
The [original report](https://github.com/startrack3r/thenetwork/blob/cab17b6c33ac84a1ea6a95bd03f835d6728c4782/docs/results/2026-10-27-peon-overlapping-posting-titles.md)
preserves the initial main comparison and its validation logs.

## Requirement, causes and final behavior

This repairs the existing Peon posting workflow under PRD 40.6 and `docs/network.md` 1.4.
A manager with analyst, data analyst, and senior data analyst postings could not select the senior role by its full title.
Every shorter title inside that name counted as a separate mention.
The original fix shares an occurrence-based selector across close commands, updates, and close clarification.
It removes strictly nested title mentions while retaining separate mentions elsewhere.

The latest reproduction concerns a second ambiguous reply.
After "Close my analyst post and senior data analyst post", the service asks which posting to close.
Repeating both titles without the command prefix previously returned no intake step.
The caller cleared the pending close request, so a later "senior data analyst" answer was ignored.
The same loss occurred when two postings had identical titles.

Return the existing question with an unresolved close draft when a clarification still names multiple postings.
Carry the draft's question count through both ambiguous and successful clarification.
One clear title reaches its read-back; a separate yes is still required to close it.
The existing two-question limit drops a request that remains ambiguous.
No new message template, schema, dependency, client contract, or ownership rule is added.

Alternatives considered:

1. Choose the longest title everywhere. That incorrectly selects one of two separately named postings.
2. Choose the first posting when spans are equal. Array order is not the manager's choice.
3. Return no result on ambiguity. The caller clears the pending request and loses the later clarification.
4. Keep asking without carrying the counter. That bypasses the existing question limit when combined with the draft-budget fix.

## measurement: real service and persistence

One existing PostgreSQL integration case covers the signed inbound handler, NetworkService, posting intake, stored rows, and service restarts.
It uses Network seed 1, one synthetic adult manager, a fictional phone number, and dry-run delivery.
Four initial roles have two openings, $90k-$120k pay, hybrid work in Brooklyn, and required SQL.
A fifth posting later supplies the duplicate-title control.

The original main comparison improved three operations from **0/3 to 3/3**:
updating the senior role, closing it directly, and answering the close question with "data analyst" after restart.
All three retain their correct read-back and persistence results in this follow-up.
The non-overlapping title control and separate-title ambiguity controls also remain.

The expanded case repeats an ambiguous reply in each title order, restarts the service,
then answers with one clear title. It checks that the unresolved draft has no selected posting,
retains its question count, and reaches the correct read-back after restart.
It declines that read-back and verifies all posting rows remain unchanged.
The duplicate-title arm restarts after the second question, repeats the ambiguous answer,
and verifies the existing limit drops the draft without closing either posting.

| Latest paired observation | Previous PR head | Fixed |
|---|---:|---:|
| Close clarification scenarios with the intended result | 0/3 | 3/3 |
| Unresolved requests retained without selecting a posting | 0/3 | 3/3 |
| Later unique-title answers reaching the correct read-back | 0/2 | 2/2 |
| Duplicate-title request ends at the existing question limit | 0/1 | 1/1 |
| Original selected-and-saved operations retained | 3/3 | 3/3 |

The case compares unrelated intent fields and complete facet-tag lists before and after each operation.
It checks that clarification and read-back alone change no posting.
These deterministic cases establish the reproduced behavior, not a population accuracy estimate.

Same final fixture and command before and after:

```sh
REQUIRE_PG=1 bun test --conditions eliza-source --timeout 120000 packages/network/test/peon-postings.integration.test.ts
```

Before:

```text
1 pass
1 fail
98 expect() calls
Ran 2 tests across 1 file. [7.38s]
```

After:

```text
2 pass
0 fail
98 expect() calls
Ran 2 tests across 1 file. [5.70s]
```

The before run fails the expanded regression; the existing posting case passes.
An initial test inspection queried member state immediately after startup, before lazy loading.
The corrected fixture checks the draft before shutdown and verifies its next turn after restart.
Both final paired runs use that same corrected fixture.

The first production attempt passed standalone but failed the combined case, **7/8** tests.
It returned a new draft without its question count; another contribution reads that count from the returned draft.
The final implementation carries the count on both clarification returns.
An intermediate integration run was stopped after this finding; only the complete final run is reported below.

## Reviewer follow-up: equal spans, matching rules, and coordination

The [review](https://github.com/eliza-research/thenetwork/pull/150#pullrequestreview-5682076565)
asked for the equal-span behavior, normalization limits, PostgreSQL output, and a landing order.

Equal spans survive the selector because containment requires at least one strict boundary.
Distinct posting IDs remain two candidates. Direct close and update commands ask the existing question.
The fixed close clarification now asks again too, subject to the existing limit.
No branch selects a candidate from an ambiguous list by its position.
A supplemental direct call exercised those three paths with the duplicate posting array in both orders:
all six final results ask a question, set `ready: false`, and contain no selected ID.
This source-level check supplements the database workflow; it does not replace it.

Matching only lowercases the body and stored titles. It does not trim stored titles or collapse whitespace.
For example, a stored title with two internal spaces does not match the same words with one space.
Substring matching and the single-active-post fallback remain; there is no fuzzy matching or new bulk-close command.

Suggested review/landing order for the shared-file changes named in review:
**#144 → #145 → #146 → #149 → #150**.
These independently target main; the order aids reconciliation of the shared source and test file.
Preserve all integration cases and the returned draft's question counter when applying the other draft-budget changes.

## safety_gates and combined compatibility

```sh
bun run sim --only peon --only peon-seats --json <results.json>
REQUIRE_PG=1 bun run sim --only safety --json <results.json>
```

Peon and job-seat blocks pass **36/36** before and after.
All **37 records** match exactly, excluding runtime; both have zero tracked misses.
Times: 36.8 / 37.3 seconds.
This retains the existing matching fingerprint and official seeds 13-16, eight-week comparison.
It makes no matching-quality or performance claim.

PostgreSQL safety passes **17/17** before and after, with identical records and zero tracked misses.
Times: 7.3 / 7.9 seconds.
Age, consent, review, ownership, confirmation, and leak policies retain their existing behavior.
No live sends or deployment.

Combined locally with the other **39 contributions**, the posting integration file passes:

```text
8 pass
0 fail
707 expect() calls
Ran 8 tests across 1 file. [39.13s]
```

The three original observations and three new clarification outcomes match standalone.
All 30 header-field workflows from the latest #144 update are also unchanged.
All four typecheck configurations pass on both branches.
The combined Peon/job-seat blocks pass **49/49**, zero tracked misses, in 45 seconds.
All **50 gate records** match the previous #144 combined run, excluding runtime.
The final commits apply cleanly. The combined branch stays local.

## Final integration, llm_evidence, and agent_clients

```sh
REQUIRE_PG=1 bun run test:integration
REQUIRE_PG=1 bun run test:e2e
```

Integration includes all 11 files listed by `bun run security`:

```text
676 pass
8 skip
6 fail
13807 expect() calls
Ran 690 tests across 68 files. [480.44s]
```

The six failures have the same names as the preceding #199 run:
Wrangler requires `/bin/bash`, SIGTERM exits 143 instead of 0, and four site tests compare Windows/POSIX paths.
These remain failures. Eight skips require the opt-in retry-reconciliation suite.
No fresh paired baseline integration run was made.

E2E:

```text
42 pass
1 skip
0 fail
654 expect() calls
Ran 43 tests across 3 files. [57.77s]
```

The browser skip requires `PLAYWRIGHT_MODULE`.
Environment: Windows, Bun 1.4.2, frozen dependencies, PostgreSQL 16.15 on local port 54339.
`PG_BIN_DIR`/`PATH` select PostgreSQL binaries; `USER=postgres` and
`OBSERVATORY_PG_DIR`/`OBSERVATORY_PG_PORT` select the test cluster.
The full-simulation allowance was used for #136; these are affected-block results, not a fresh full-suite claim.

The changed parser and service flow use no model calls: zero validation calls/$0.
No real-client acceptance run is claimed for Claude Code, Codex/ChatGPT, Hermes, OpenClaw, Muse, Grok, elizaOS, or Cursor.
Authoring client: Codex desktop, OpenAI `gpt-6-astra`; current app version not collected.
The actual inbound service is tested directly, with synthetic data and no live delivery.

## Reproduce and limits

1. Check out `cab17b6c33ac84a1ea6a95bd03f835d6728c4782` separately.
2. Load the posting integration file from `7c49ef08ab88f71924e02d52c0615aa7b19c3021`.
3. Run the PostgreSQL command above. Expect one pass, one fail, and all three clarification observations false.
4. Load `packages/network/src/jobs.ts` from the same code commit and repeat.
5. Expect two passes and all three clarification observations true.

Identical titles remain ambiguous; the fix does not invent a way to distinguish them by title alone.
An answer naming no active posting retains its prior behavior and can end the pending request.
The two-question limit remains. The fix applies to active conversations; it does not restore already discarded drafts.
No website UI or copy-template change. Hosted Linux CI and maintainer review remain required.
