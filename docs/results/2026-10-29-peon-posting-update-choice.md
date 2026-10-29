# Keep job edits through posting selection and ambiguous replies

Updated: 2026-10-30. Main base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Latest paired baseline: published PR head `7917094d4de9821bce133fb53de0353ccba7952a`.
Tested code: `fb5a8dc6a5bd0a6091b7ca6a2855a6028afc68e1`. Combined code: `7ac05f7a30ee75a051cb74af6af2dfcaf6df5a19`.
The [previous report](https://github.com/startrack3r/thenetwork/blob/7917094d4de9821bce133fb53de0353ccba7952a/docs/results/2026-10-29-peon-posting-update-choice.md)
preserves the original main comparison and earlier validation.

## Requirement, causes, and final behavior

This repairs the existing posting-update flow in `docs/network.md` 1.4, under PRD 40.6.
With two active jobs, "Update my job post: 3 openings" asks which job to change.
Main returned no draft, so the caller discarded the requested fields and target question.
The original fix retains those fields with an `update` marker until an active posting is explicitly selected.
The selected title identifies the job; its words are removed before reading additional edit fields.
The existing read-back and separate confirmation still control saving.

The latest reproduction finds the same loss on a second ambiguous reply.
After requesting three openings and $100k-$140k pay, answering "data analyst and product designer" discarded the pending edit.
A later clear title could not recover the requested changes.
The same problem occurred when two active postings had the same title.

Retain the existing draft when a reply still names multiple active postings and repeat the existing question.
Carry the question count through ambiguity and successful selection, preserving the existing two-question limit.
A reply naming no active posting retains its prior behavior and ends this draft.
The active list is read again each turn; no posting is selected by position or by an unrelated single-post fallback.
No new copy, schema, dependency, or client contract is required.

Alternatives considered:

1. Store full posting records in the pending draft. Those records can change or close while the manager chooses.
2. Fall back to the only remaining active posting. That can edit the wrong job when the named job has closed.
3. Drop every ambiguous reply. That loses the requested edits and prevents later clarification.
4. Return a fresh draft without its counter. That can reset the existing question limit when combined with other posting fixes.

## measurement: one gate, 51 complete Network workflows

The existing gate retains its original **33 workflows**: eleven cases on seeds **7, 13, and 17**.
The historical main comparison improved **18/33 to 33/33** correct.
It covers named updates, either selected job, reply edits, titles containing seniority, declined confirmations,
unknown and closed choices, replacement postings, and fresh update commands.
All 33 outcome rows remain identical before and after this follow-up.

The same gate adds **18 workflows**: six cases on the same three seeds.
Each creates two different jobs through the real ConsentNetwork/Peon text flow.
The duplicate-title case creates a third job, then selects the other unique title after the ambiguous reply.
The manager requests three openings and $100k-$140k pay before being asked which posting to change.
The world restarts from JSON after the initial question, ambiguous answer, selection, and final confirmation.

Cases cover both title orders, duplicate titles, a repeated ambiguity reaching the question limit,
declining the choice, and declining the final read-back.
Checks include retained fields and counter, no selected ID during ambiguity, the correct read-back,
no writes before confirmation, final posting fields, and every unrelated posting remaining unchanged.
The supplied pay isolates this retry from main's separate partial-confirmation issue in #144.
New fixtures explicitly state yes/no sponsorship and compare those values too.

| Latest paired observation | Previous PR head | Fixed |
|---|---:|---:|
| Original workflows still correct | 33/33 | 33/33 |
| New ambiguity workflows correct | 0/18 | 18/18 |
| Requested headcount/pay edits saved correctly after confirmation | 0/9 | 9/9 |
| Pending edits and question count retained after ambiguity | 0/18 | 18/18 |
| Writes in cancellation/question-limit controls | 0 | 0 |
| Writes before confirmation | 0 | 0 |

Overall: **33/51 to 51/51** correct.
These are deterministic regression cases, not population or hiring-quality estimates.
SeatWorld supplies synthetic rows through production posting-facts and seat-snapshot functions.
The new scenarios need no database and do not claim HTTP or PostgreSQL coverage.
The Network logic, parsing, state serialization, confirmation, and posting callbacks are real.

The first expanded fixture left sponsorship unspecified and produced 9/18 correct after the draft fix.
Its full-field comparison detected existing storage normalization from an unspecified value to false.
The final fixture declares sponsorship explicitly, keeps the full-field assertions, and reruns both sides unchanged.
This contribution does not change that normalization or claim to fix it.

Same final fixture, seeds, and command before and after:

```sh
bun run sim --only peon --only peon-seats --json <results.json>
```

Baseline: **36/37** blocking gates, 37.4 seconds.
Fixed: **37/37**, 41.2 seconds. Both have zero tracked misses.
All **37 other records** are identical, excluding runtime.
The Peon matching fingerprint stays `b7736da857812394`, using the existing seeds 13-16, eight-week comparison.
Timings are not a performance claim.

## safety_gates and combined compatibility

With local PostgreSQL:

```sh
REQUIRE_PG=1 bun run sim --only safety --json <results.json>
```

Safety passes **17/17** before and after, zero tracked misses, identical records.
Times: 6.8 / 16.3 seconds.
Age, review, consent, holds, capacity, closure, leak, protected/proxy invariance, and fairness rules remain unchanged.
Only the manager's active posting list is consulted. Selection alone cannot save an edit.

Combined locally with the other **39 contributions**, the affected command passes **49/49**,
zero tracked misses, in 44.3 seconds.
All 18 new rows match the standalone result; the prior 33 combined rows remain identical.
The original standalone cases still ask for pay 18 times, versus zero combined cases because #144 fills saved fields.
The new cases already supply pay, so they need no such difference.
All **49 other gate records** match the preceding #150 combined run.
The 72 sponsorship-refusal outcomes from #196 also remain identical; that PR concerns refusal wording, not the storage default.

The local source conflict was in selected-post initialization.
The resolution retains #144's stored-field lookup and applies the pending question count after initialization.
It preserves #150's overlapping-title lookup, bare-title intake, and all existing gates.
The combined branch stays local; this PR independently targets main.

The combined PostgreSQL posting file provides compatibility evidence, not database proof of the new ambiguity scenarios:

```text
8 pass
0 fail
707 expect() calls
Ran 8 tests across 1 file. [95.74s]
```

All 30 header-field outcomes and all three close-clarification outcomes remain identical to the preceding run.
All four typecheck configurations pass on standalone and combined branches.

## Final integration, llm_evidence, and agent_clients

```sh
bun run typecheck
REQUIRE_PG=1 bun run test:integration
REQUIRE_PG=1 bun run test:e2e
```

Integration includes all 11 files listed by `bun run security`:

```text
675 pass
8 skip
6 fail
13741 expect() calls
Ran 689 tests across 68 files. [1568.23s]
```

The six failures have the same names as the preceding #150 run:
Wrangler requires `/bin/bash`, SIGTERM exits 143 instead of 0, and four site tests compare Windows/POSIX paths.
They remain failures. Eight skips require the opt-in retry-reconciliation suite.
No fresh paired baseline integration run was made.

An initial E2E run overlapped integration and ended with **40 pass, 1 skip, 2 fail**,
649 assertions, in 593.87 seconds. One migration hit a lock timeout in the shared PostgreSQL role catalog;
the multi-market profile test separately exceeded its 180-second limit.
Separate databases do not isolate cluster-wide role creation.
The same E2E command was rerun after integration completed, without source or timeout changes.

Sequential E2E rerun:

```text
42 pass
1 skip
0 fail
654 expect() calls
Ran 43 tests across 3 files. [201.32s]
```

The browser skip requires `PLAYWRIGHT_MODULE`.
Environment: Windows, Bun 1.4.2, frozen dependencies, PostgreSQL 16.15 on local port 54339.
`PG_BIN_DIR`/`PATH` select PostgreSQL binaries; `USER=postgres` and
`OBSERVATORY_PG_DIR`/`OBSERVATORY_PG_PORT` select the test cluster.
The full-simulation allowance was used earlier; these are affected-block results, not a fresh full-suite or hosted-CI pass.

Validation uses zero model calls/$0: the changed draft handling is deterministic.
No real-LLM or external-client acceptance claim is made.
Authoring client: Codex desktop, OpenAI `gpt-6-astra`; app version not collected.
Claude Code, ChatGPT, Hermes, OpenClaw, Muse, Grok, elizaOS, and Cursor were not tested as clients.
No live messages or deployment.

## Reproduce and limits

1. Check out `7917094d4de9821bce133fb53de0353ccba7952a` separately.
2. Load `scripts/sim/peon-seats.ts` from `fb5a8dc6a5bd0a6091b7ca6a2855a6028afc68e1`.
3. Run the affected command. Expect 36/37, with zero of 18 new ambiguity rows correct.
4. Load `packages/network/src/jobs.ts` from the same code commit and repeat.
5. Expect 37/37, with 33 correct `PEON_UPDATE_CHOICE_OUTCOMES` and 18 correct `PEON_UPDATE_AMBIGUITY_OUTCOMES` rows.

Existing title matching and posting grammar remain. Unknown choices still end the pending request.
Repeated ambiguity retains the original edits; additional edit fields in a still-ambiguous reply are not applied.
Once the reply selects one posting, the existing additional-field handling applies.
The two-question limit remains; a partial update that needs a further pay question can exhaust it on standalone main.
#144 separately fills the stored fields for that confirmation, as measured in the combined checkout.
Already-forgotten drafts cannot be reconstructed. Draft pending maintainer review and hosted CI.
