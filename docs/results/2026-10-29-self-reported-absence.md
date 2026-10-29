# Attribute self-reported absence to the right meeting and member

Date: 2026-10-29. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Latest paired baseline: published PR head `f4527eecfbd637eb0a63eb1c8914d6123cc0afda`.
Tested code: `c49ce2a3983a6631b9eebce05bf9608d1f979bcf`. Combined code: `604ab36982857162d7da324dd8984840aec489eb`.

The [previous report](https://github.com/startrack3r/thenetwork/blob/f4527eecfbd637eb0a63eb1c8914d6123cc0afda/docs/results/2026-10-29-self-reported-absence.md) preserves the original main comparison.
This report includes the subsequent conversation-routing fix and current evidence.

## Requirement, causes and choices

This repairs meeting feedback and reliability attribution in `docs/network.md`
4.3/PRD 32.13. Main can read "I didn't show up" as the counterpart's absence.
It records the speaker as present, can penalize the silent counterpart, and can
file an automatic report against that counterpart. The original fix shares
first-person phrase handling between feedback and post-date reporting. Separate
counterpart allegations and harassment reports remain intact.

There is a second failure before feedback is recorded. After a missed meeting,
a member confirms a new booking. "Something came up, I couldn't make it" then
cancels that future booking. The generic "something came up" cancellation rule
runs before feedback routing, although the member describes a past absence.

Use the same first-person helper to recognize that explanation. Remove the
past absence and ambiguous explanation only from the cancellation check. An
explicit remaining cancellation still wins. Otherwise, classify the message
as feedback, letting the existing router select the most recent unanswered
completed meeting. Add the existing first-person "couldn't make it", "didn't
make it" and "had to bail" forms to the shared helper.

Alternatives considered:

1. Suppress all reports whenever the speaker missed a meeting. This loses
   separate counterpart allegations. Inspect the remaining text instead.
2. Treat every "something came up" as feedback. This loses ordinary future
   cancellations. Require an explicit first-person past absence too.
3. Always prefer past feedback over a cancellation. A message can explicitly
   cancel the next booking as well. Keep that cancellation ahead of feedback.

No schema, historical-data migration, message template, review policy or
client-contract change. Active probe and booking reply handling stays unchanged.

## measurement: original attribution cases

The existing gate retains all **78 workflows**: 13 cases on seeds **1, 2 and 3**,
with automatic post-date reporting off and on. These use the real Network,
engine, human review, mutual consent, booking, feedback and attendance
finalization, with JSON restarts. The channel, people and clock are synthetic.

The initial comparison against main improved **30/78 to 78/78** correct.
False counterpart penalties in self-only cases fell **36 to 0**, and false
automatic reports fell **18 to 0**. All 12 intended counterpart/mixed/harassment
reports remained. All 78 outcome rows are identical at the previous published
head and current standalone/combined revisions. This follow-up retains that fix.

## measurement: feedback must not cancel a later booking

The same gate adds **54 workflows**: nine cases on seeds **1, 2 and 3**, with
automatic post-date reporting off and on. Each starts with three synthetic
adults in Greenpoint and uses the real staff proposal and human review flow.
Ana and Ben consent to one meeting. After its feedback question, Ana sends an
acknowledgement that leaves feedback unanswered. Ana and Cara then consent to
a later meeting and confirm it. No reply question remains active.

The member supplies delayed feedback after a JSON restart. The workflow restarts
again, advances through the first meeting's attendance finalization, and
restarts once more. It checks feedback attribution, reliability, interaction
history, reports, cancellation events and the future booking's state. Policy
outputs are not mocked. In the seed-1 reproduction, the first meeting is October
10 at 10:00 New York time; the later booking is October 18 at 10:00. The reply
arrives October 11 at 14:00.

Five absence explanations include "couldn't make it", "didn't make it", "had
to bail", "didn't show up" and a curly apostrophe. Controls cover positive
feedback, "something came up" alone, an explicit future cancellation, and a
past absence followed by an explicit future cancellation.

| Observation | Previous published head | Fixed |
|---|---:|---:|
| Correct new routing workflows | 24/54 | 54/54 |
| Unintended future cancellations | 30 | 0 |
| Correctly recorded past self-absences | 0 | 30 |
| Intended future cancellations preserved | 18 | 18 |
| Already-correct new outcome rows preserved | 24 | 24 |

All **132 workflow cases** pass at the current revision. These are hand-written
deterministic cases, not population estimates. A supplemental complete workflow
also keeps the explicit cancellation in "Something came up, I couldn't make it
last time. I need to cancel the next one." Before/after outcomes are identical.

Same command and settings before and after the routing follow-up:

```sh
bun run sim --only network --only slop --only friends --only peon-seats --only evals --json <results.json>
```

Previous head plus expanded gate: **152/153** blocking gates, 288.6 seconds.
Fixed: **153/153**, 332.3 seconds. All **175 other gate records**
are identical, excluding runtime. Both retain the same **nine tracked misses**:
Slop adversary/age-liar reductions, repeat-date targets, group-disparity targets,
reveal back-outs and probe length, plus Friends adversary harm. Timings are not
a performance claim. The current comparison starts from the previous PR head;
the historical report contains the earlier main measurements.

## safety_gates and combined compatibility

With local PostgreSQL, `REQUIRE_PG=1 bun run sim --only safety --json <results.json>`
passes **17/17** before and after, zero tracked misses. All records are identical.
Times: 7.9 / 9 seconds. This includes the existing post-date
report-kind checks and database-backed safety workflows.

Combined locally with the other **38 contributions**, the affected command
passes **182/182** blocking gates in 363.4 seconds. All 132 workflow rows
match the standalone fix. All **204 other records** retain their values:
Network/evals against the latest #160 combined run, Friends against #200, and
Slop/job seats against the prior #199 run. The combined baseline retains its
previous **eight tracked misses**; earlier contributions had already improved
the second-date ratio. Both code and regression merged cleanly. The combined
branch stays local; this PR independently targets main.

## Validation, llm_evidence and agent_clients

```sh
bun run typecheck
REQUIRE_PG=1 bun run test:integration
REQUIRE_PG=1 bun run test:e2e
```

- All four typecheck configurations pass on standalone and combined branches.
- Integration includes all 11 files from `bun run security`: **675 pass,
  8 skip, 6 known Windows failures**, 13,741 assertions, 689 tests in 68 files,
  489.66 seconds. Failure names match the preceding #160 run: Wrangler
  needs `/bin/bash`, SIGTERM exits 143 instead of 0, and four site tests compare
  Windows and POSIX paths. These are not passing tests. The skips are opt-in
  retry-reconciliation cases. No fresh paired baseline integration run.
- E2E: **42 pass, 1 optional browser skip, 0 fail**, 654 assertions,
  43 tests in three files, 52.29 seconds.
- Windows, Bun 1.4.2, frozen dependencies, PostgreSQL 16.15 on local port 54339.
  `PG_BIN_DIR`/`PATH` select binaries; `USER=postgres` and
  `OBSERVATORY_PG_DIR`/`OBSERVATORY_PG_PORT` select the test cluster.
- The full-simulation allowance was used earlier. These are affected-block
  results, not a fresh full-suite or hosted Linux CI pass.
- Zero validation model calls/$0; deterministic classification and routing.
  No external-agent client acceptance claim. Authoring client: Codex desktop,
  OpenAI `gpt-6-astra`; app version not collected. Other clients were not tested.

## Reproduction and limits

1. Check out `f4527eecfbd637eb0a63eb1c8914d6123cc0afda` separately.
2. Load `scripts/sim/network.ts` from `c49ce2a3983a6631b9eebce05bf9608d1f979bcf`.
3. Run the affected command. Expect 152/153 and `expected 24 to be 54`.
4. Load `packages/network/src/classify.ts` from the same code commit and repeat.
5. Expect 153/153, with 78 correct `SELF_ABSENCE_OUTCOMES` rows and 54 correct
   `SELF_ABSENCE_ROUTING_OUTCOMES` rows.

The routing change covers explicit past-absence explanations containing
"something came up". It does not broadly reclassify every unsolicited absence
statement, resolve quotations or arbitrary tense/subject ambiguity, or change
active probe/booking reply priority. It uses the existing most-recent unanswered
meeting rule; it does not introduce multi-meeting dialogue. Historical records
are unchanged. No live sends or deployment. Draft pending review and hosted CI.
