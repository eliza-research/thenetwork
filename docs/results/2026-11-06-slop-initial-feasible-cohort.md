# Slop feasibility reports use the starting cohort

## Requirement and defect

Reproduced simulator/reporting bug under the approved Slop scope and PRD 34.3
and 34.4's deterministic simulation and subgroup measurement requirements.
`Extra.feasibleGroups` explicitly describes real members with at least one
stated-mutual real partner **at the start** of the run.

`extraOf` instead checked the final persona profiles with `statedMutual(..., 0)`.
The week argument selects week-zero presence; it does not restore distance
preferences. A member's legitimate agreement to widen their radius can make
them feasible later. The report then retroactively includes them in the
starting cohort, changing its member-month denominator and potentially its
date-participation numerator.

The world now captures a readonly set of initially feasible member IDs before
any matcher or persona action. The report uses that set. Widening, matching,
attendance and all-member metrics retain their existing behavior. The set
belongs to the harness, not the engine-visible snapshot.

Alternatives considered:

1. Regenerate the starting population from the seed when reporting. That
   would not reproduce caller-supplied personas or generation options that
   are not retained in the result.
2. Retain a full copy of every starting persona and recompute feasibility at
   report time. This is correct but retains substantially more data than the
   IDs the report needs. Capture the derived membership once instead.

The existing feasibility scan moves to world creation. Worlds that never
request this report now incur that scan too; the added set uses memory linear
in cohort size. No performance improvement is claimed. `SlopWorld` gains an
`initiallyFeasible` field; production APIs and engine input types are unchanged.

## measurement

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Same command, test and settings
before and after:

```sh
bun test --conditions eliza-source --timeout 120000 packages/sim/test/slop-feasible-cohort.integration.test.ts
```

Seeds 1, 2 and 9, 70 personas per city, four weeks. Each seed uses the real
Slop engine with normal widening answers, the engine with widening disabled,
and the synchronous random baseline. The test fixes expected membership
before running any arm, then counts actual dates for those members. It checks
every group's date count and member-month denominator. No matcher, persona,
answer or outcome is mocked; all nine worlds complete before assertions.

| Widening-arm observation | Before | After |
| --- | ---: | ---: |
| Reported starting members, seed 1 (expected 162) | 165 | 162 |
| Reported starting members, seed 2 (expected 174) | 176 | 174 |
| Reported starting members, seed 9 (expected 159) | 163 | 159 |
| Incorrectly included members, total | 9 | 0 |
| Date participations credited outside the starting cohort | 1 | 0 |
| Correct group reports in widening arms | 0/3 | 3/3 |
| Correct group reports in both control arms | 6/6 | 6/6 |
| Integration case | 0 pass, 1 fail | 1 pass, 0 fail |

The numerator counts member participations in dates, not distinct dates.
The widening arms still make the same 25, 17 and 23 widening updates. The
final, typechecked test executes 19 assertions; 2.30 seconds before and 2.24
seconds after. An initial version had an expected-array literal typing error;
it was corrected, and the final case was rerun on both revisions.

Additional paired seeds 3, 4, 10 and 11 use the same size and duration. Reported
member counts change from 161/173/172/173 to the correct 159/171/171/170,
removing eight more incorrect inclusions. Every group report matches the
independently established starting cohort. Across all seven measured seeds,
SHA-256 digests of the actual flows, asks and matching metrics remain identical
before and after. These results correct a measurement; they do not claim
better matching or estimate production frequency.

## Pinned qualification and safety_gates

```sh
bun run sim --only slop --json ../slop-feasible-gates.json
```

Both runs pass **39/39 blocking gates**, with eight tracked misses. Of 57 gate
records, **55 are identical after excluding execution-duration `ms` fields**.
Only the feasible-cohort tracked ratio and its containing fingerprint change:

| Record | Before | After |
| --- | --- | --- |
| Feasible-cohort minimum group ratio (`man:gay`, target 0.7) | 0.6030112445206788 | 0.6016771488469604 |
| Random/Slop arm fingerprint | `445afd705328fe54` | `c1e7b89863542d8e` |

The corrected ratio is slightly lower and remains off target. No threshold
or expected fingerprint was edited. The Slop live-workflow fingerprint stays
`eaeaf7bbe8c99c81`. Qualification runtime: 29.2 seconds before, 32.8 after.

A separate comparison of the complete pinned arm outputs (seeds 13-16, 300
personas per city, four weeks, the same population and platform settings as
`scripts/sim/slop.ts`) finds the random arm entirely identical and the Slop arm
identical after excluding `extra.feasibleGroups`. The corrected Slop cohort
counts are 797/787/784/789 instead of 798/790/786/790: seven members were wrongly
included. Its raw-output fingerprints match the qualification fingerprints.
The supplemental exporter failed in summary formatting after writing those
complete outputs; comparison of the saved data with `fairnessRatios` succeeded.

All existing safety gate values remain unchanged: declared-minor contacts,
stated-filter violations, scammer median reach, post-report repeat harassment,
relay leaks, relays to minors and contact shares without consent. All-member
fairness and every other tracked value also remain unchanged. The eight
tracked misses are still disclosed; this does not make the fairness target pass.

## Validation and companion work

- Typecheck: all four configurations pass after the test typing correction.
- Integration, including security: 676 passed, eight skipped and six failed;
  13,760 assertions across 69 files in 539.03 seconds. The six failure names
  match the clean-base Windows failures: Wrangler's `/bin/bash`, boot's
  SIGTERM exit status and four site-build path-separator checks. The eight
  skips require the optional cleanup-reconciliation flag. The suite is not green.
- E2E: 42 passed, one skipped and zero failed; 654 assertions in 72.50 seconds.
  The browser SDK recovery case is skipped without `PLAYWRIGHT_MODULE`.
- Combined with PR #371 at `43d87f2c055e7a9aec964b7ca736e58767973d1f`: the
  runtime changes merge cleanly, and both integration cases pass, 29 assertions
  in 5.99 seconds. Both cases should be retained. This is not a claim that the
  combined branch completed all broader suites.
- Full default simulation was not repeated. AGENTS.md allows one full run per
  agent, already consumed earlier in this contribution session; only the
  affected Slop block is claimed here.

PR #371 isolates caller-supplied populations between runs. This defect also
affects freshly generated populations within a single run, because widening
is a legitimate change to the world's current profiles. Neither fix replaces
the other. This branch starts directly from main and does not stack #371.

Environment: Windows x64, Bun 1.4.2, isolated PostgreSQL 16.15 on port 54339.
The audited frozen install and dependency hooks are unchanged on the base.
Test processes have no provider keys or live-send/deploy flags. No member
messages, production changes, UI changes or member data are involved.

Reproduce by adding the new case to the base: expect three wrong widening-arm
reports and six correct controls. Apply the runtime/report fix: expect all nine
reports correct, with widening still occurring. Then run the qualification,
typecheck, integration and E2E commands above and in the repository guide.

## llm_evidence

Real-model calls: 0; cost: 0. This fixes deterministic report membership. The
real matcher and seeded persona behavior run, with no prompt, generated voice
or model-backed decision change. Real-LLM qualification is not claimed.

## agent_clients

Codex desktop 26.1029.7803.0 drove Bun and GitHub through the connector and CLI,
without computer use. Authoring provider: OpenAI; exact model identifier:
unavailable. Claude Code/Claude, ChatGPT member flow, Hermes Agent, OpenClaw,
Muse, Grok bot, elizaOS and Cursor were not tested. Member-facing connectors
are unchanged; no untested-client result is claimed.
