# Attribute explicit self-reported absence to the speaker

Date: 2026-10-29. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Tested code: `ad8cf7badbeb38561069b3cc4daeb585d7bdec9e`. Combined code: `ea599d0c7e711681b0bc198a447a99b92a2d5735`.

## Requirement, cause and choice

This repairs post-meeting feedback and reliability attribution in `docs/network.md`
4.3/PRD 32.13. After a booked meeting, `I didn't show up` currently records the
speaker as having completed the meeting. If the counterpart stays silent, that
counterpart receives the no-show penalty. With the automatic post-date report
option used by Slop, it also creates a no-show report against that counterpart.
`I did not come` and `I was a no-show` reproduce the same error.

`feedbackOf` recognizes only a few legacy self-absence forms and reads the other
no-show expressions without checking their subject. `checkInReport` separately
reads the same words as an allegation about the date.

Use one shared helper to remove explicit first-person absence phrases from the
text used to detect reports about someone else. Feedback records the speaker's
absence when that helper finds one. Both detectors then inspect the remaining
words, so a separate counterpart no-show or harassment report is retained.
Existing explicit `reportKindOf` behavior, report priority, review policy and
message templates stay unchanged. No schema or historical-data migration.

Alternatives considered: a blanket rule that suppresses reports whenever the
speaker missed the meeting would discard the mixed and urgent cases. Separate
first-person patterns in feedback and post-date reporting would let attribution
drift again. Share the phrase handling while retaining the existing detectors.

## measurement

One new blocking Network gate runs 13 hand-written feedback cases on seeds 1,
2 and 3, with automatic post-date reporting both off and on: **78 workflows**.
Each uses the real ConsentNetwork, engine, human review, mutual consent, booking,
post-meeting question, reply and five-day attendance finalization. JSON restarts
occur before feedback, after feedback and after finalization. Members, channel
and clock are synthetic; classification and policy outputs are not mocked.

Cases cover six new explicit self-report phrasings (including a curly apostrophe),
the existing `I couldn't make it` form, two counterpart reports, a mixed report,
a separate harassment report, positive feedback and ordinary photo-related text.
The gate checks stored interaction outcomes, both members' reliability counters,
the feedback flags and report subjects/kinds. No contact occurs before review.

| Observation | Main plus identical gate | Fixed |
|---|---:|---:|
| Correct complete workflows | 30/78 | 78/78 |
| Correctly recorded self-absences across the 54 self-report cases | 6/54 | 54/54 |
| Counterpart penalties in self-only cases | 36 | 0 |
| Automatic reports against the counterpart in self-only cases | 18 | 0 |
| Intended counterpart/mixed/harassment reports | 12 | 12 |

These are deterministic cases, not population estimates. The ordinary controls
remain correct. Mixed statements keep both absence flags; the speaker's absence
does not turn their unsupported attendance claim into a witness statement.

Same command and settings before and after:

```sh
bun run sim --only network --only slop --only friends --only peon-seats --json <results.json>
```

Main: **127/128** blocking gates, 354.9 seconds. Fixed:
**128/128**, 354.7 seconds. All 150 pre-existing records are identical
excluding runtime. Both runs have the same **nine pre-existing tracked misses**:
Slop age-liar/adversary reductions, repeat-date targets, two group-disparity
targets, reveal back-outs and live probe length; plus Friends adversary harm.
The new blocking gate is the only before/after gate change. Timings are not a
performance claim.

## safety_gates and combined compatibility

The existing safety block was also run on main and fixed code, with local
PostgreSQL, using `REQUIRE_PG=1 bun run sim --only safety --json <results.json>`.
Both pass **17/17 gates**, zero tracked misses; all 17 records are identical.
Times: 12.2 / 7.9 seconds. Its existing post-date report-kind
checks and database-backed safety workflows pass.

Combined locally with the other 37 contributions, the affected command passes
**156/156** blocking gates in 383.1 seconds, with the same eight tracked
misses as its prior combined baseline. The earlier contributions already moved
the per-seed second-date ratio above its tracked target; this fix does not change
that value. All 78 new outcome rows match the isolated fix. All 178 prior
records retain their values: Network/job seats compared with the #198 combined
run, and Slop/Friends with the #189 combined run (later changes were confined
to posting/Peon flows). The shared Network-gate insertion conflict was resolved
by retaining all existing gates; production files merged cleanly. The combined
branch stays local; this PR independently targets main.

## Validation, llm_evidence and agent_clients

```sh
bun run typecheck
REQUIRE_PG=1 bun run test:integration
REQUIRE_PG=1 bun run test:e2e
```

- All four typecheck configurations pass on standalone and combined branches.
- Integration, including all 11 security files: **675 pass, 8 skip, 6 known
  Windows failures**, 13,741 assertions, 689 tests in 68 files,
  517.81 seconds. The same six failure names remain: Wrangler needs
  `/bin/bash`, SIGTERM exits 143 instead of 0, and four site tests compare native
  and POSIX paths. The eight retry-reconciliation cases are opt-in.
- E2E: **42 pass, 1 optional browser skip, 0 fail**, 654 assertions,
  43 tests in three files, 46.74 seconds.
- Windows, Bun 1.4.2, local PostgreSQL 16.15 on port 54339, frozen dependencies.
  `PG_BIN_DIR`/`PATH` select the binaries; `USER=postgres` and
  `OBSERVATORY_PG_DIR`/`OBSERVATORY_PG_PORT` select the test cluster.
- The full-simulation allowance was used earlier. These are affected-block
  results, not a fresh full-suite or hosted Linux CI pass.
- Zero validation model calls/$0: deterministic feedback handling. No
  model-backed behavior or external-client acceptance claim. Authoring client:
  Codex desktop, OpenAI `gpt-6-astra`; app version not collected. Other clients
  were not tested.

## Reproduction and limits

Run the affected command and inspect `SELF_ABSENCE_OUTCOMES`: all 78 rows must
have `correct: true`. Main with the same gate has 30 correct rows. This new
reproduction needs no database; the safety, integration and E2E runs use it.

This handles the explicit first-person phrases in the regression, not arbitrary
natural-language attribution, quotations or ambiguous plural subjects. Existing
legacy phrase rules remain. Historical reliability/report records are not
rewritten. Separate allegations in the same message still use the current
reporting policy. No live sends or deployment. Draft pending review and CI.
