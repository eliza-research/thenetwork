# Keep absence feedback on the right meeting and member

Updated: 2026-10-30. Main base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Latest paired baseline: published PR head `d0cbc30a6892c9aee91ca3d654c27808527715ba`.
Tested code: `35ec0161c397fd355728cd2820c38ca27fa2e5e0`. Combined code: `e2e9b42c500842f32df522412951bf4d6df2e2bd`.

The [previous report](https://github.com/startrack3r/thenetwork/blob/d0cbc30a6892c9aee91ca3d654c27808527715ba/docs/results/2026-10-29-self-reported-absence.md)
preserves the original main comparison and the first delayed-feedback comparison.
This report describes the final behavior and the latest paired measurements.

## Requirement, causes and choices

This repairs meeting feedback and reliability attribution in `docs/network.md`
4.3 and PRD 15.2/32.13. Main can read "I didn't show up" as the counterpart's absence.
It can penalize that counterpart and file an automatic report against them.
The original fix shares first-person phrase handling between feedback and post-date reporting.
Separate counterpart allegations and harassment reports remain intact.

Delayed feedback can also cancel an unrelated future booking.
"Something came up, I couldn't make it" describes a missed meeting.
The generic cancellation rule previously took priority over that past-tense explanation.
The fix removes the past absence and ambiguous explanation from the cancellation check.
An explicit remaining cancellation still wins; otherwise, the existing router selects unanswered past feedback.

The latest reproduction finds an unscoped fallback: any "couldn't make it", "didn't make it", or "had to bail" marks the reporter absent.
Thus "Ben couldn't make it" penalizes Ana, who reported Ben's absence.
Bare self-reports also missed the shared helper and could cancel a later booking.

Use one past-absence pattern for both sides of the feedback classification.
Remove explicit first-person forms and short replies at sentence/punctuation boundaries before reading counterpart allegations.
Keep common intervening adverbs and the existing first-person plural behavior for these forms.
Exclude common object/complement uses such as "bail me out" and "make it awkward".
The same helper lets "Something came up, couldn't make it" reach past feedback.
Post-date reporting retains its existing priority for harassment and other serious allegations.

Alternatives considered:

1. Suppress every report when the speaker missed the meeting. This would lose separate counterpart allegations.
2. Remove the old fallback without handling bare replies. This would stop recognizing ordinary short self-reports.
3. Prefer feedback over every cancellation. This would lose explicit cancellations of a future booking.

The change needs no new schema, dependency, message template, or client contract.
It leaves active probe and booking reply priority unchanged.

## measurement: attribution and delayed feedback

One existing gate contains **270 complete workflows**, using seeds **1, 2 and 3**,
with automatic post-date reporting disabled and enabled.
Its 33 direct-feedback phrases produce 198 workflows; 12 routing phrases produce 72.
The same expanded fixture runs before and after the latest production change.

Each uses the real Network, engine, human review, mutual consent, booking, feedback, and attendance finalization.
The people, channel, reviewer identity, and clock are synthetic; policy results are not mocked.
The workflow crosses three JSON restarts and checks reliability, interaction history, and report subjects.
The routing cases first book Ana with Ben, leave feedback unanswered, then book Ana with Cara for a later date.
They check the old meeting's feedback and the later booking after finalization.

Direct cases cover named and pronominal counterpart reports, mixed self/counterpart absences,
curly apostrophes, intervening adverbs, short self-reports, object/complement controls, and harassment.
Routing controls retain ordinary "something came up", explicit future cancellation, positive feedback,
and a past absence followed by an explicit future cancellation.

| Observation | Previous published head | Fixed |
|---|---:|---:|
| Correct direct-feedback workflows | 120/198 | 198/198 |
| Incorrect penalties against reporters in newly reproduced cases | 72 | 0 |
| Intended counterpart penalties recorded | 12 | 72 |
| Intended reports, all against the counterpart | 12 | 45 |
| Correct routing workflows | 54/72 | 72/72 |
| Unintended future cancellations | 18 | 0 |
| Intended future cancellations retained | 18 | 18 |
| Past self-absences recorded in routing cases | 30 | 48 |
| Previously correct outcome rows retained exactly | 174 | 174 |

All **132 workflows** from the previous PR version retain identical outcomes.
The original main comparison improved 30/78 direct workflows to 78/78.
The preceding routing update improved 24/54 to 54/54; those historical measurements remain linked above.
The latest total improves **174/270 to 270/270**.
These are deterministic regression cases, not estimates of population accuracy.

Same command and settings before and after:

```sh
bun run sim --only network --only slop --only friends --only peon-seats --only evals --json <results.json>
```

Baseline: **152/153** blocking gates, 313.5 seconds.
Fixed: **153/153**, 372.1 seconds.
All **175 other gate records** are identical, excluding runtime.
Both retain the same **9 tracked misses**: Slop adversary/age-liar reductions,
repeat-date targets, group-disparity targets, reveal back-outs and probe length, plus Friends adversary harm.
Timings are not a performance claim. This comparison starts from the previous PR head, not main.

## safety_gates and combined compatibility

With local PostgreSQL, `REQUIRE_PG=1 bun run sim --only safety --json <results.json>`
passes **17/17** before and after, with zero tracked misses and identical records.
Times: 7.4 / 8.3 seconds.
This includes existing report-kind checks and database-backed safety workflows.

Combined locally with the other **39 contributions**, the affected command passes
**183/183** blocking gates in 395.8 seconds.
All 270 workflow rows match the standalone result.
All **205 other records** match the preceding #201 combined run,
including its 162 group-attribution workflows. The same **8 tracked misses** remain.
The code and expanded gate merged cleanly. The combined branch stays local; this PR independently targets main.

## Validation, llm_evidence and agent_clients

```sh
bun run typecheck
REQUIRE_PG=1 bun run test:integration
REQUIRE_PG=1 bun run test:e2e
```

All four typecheck configurations pass on standalone and combined branches.
Integration includes the 11 files listed by `bun run security`:

```text
675 pass
8 skip
6 fail
13741 expect() calls
Ran 689 tests across 68 files. [548.19s]
```

The six failures match the preceding run: Wrangler requires `/bin/bash`,
SIGTERM exits 143 instead of 0, and four site tests compare Windows and POSIX paths.
These tests are not passing. The eight skips require opt-in retry-reconciliation testing.
No fresh paired baseline integration run was made.

E2E:

```text
42 pass
1 skip
0 fail
654 expect() calls
Ran 43 tests across 3 files. [75.34s]
```

The browser skip requires `PLAYWRIGHT_MODULE`.
Environment: Windows, Bun 1.4.2, frozen dependencies, PostgreSQL 16.15 on local port 54339.
`PG_BIN_DIR`/`PATH` select binaries; `USER=postgres` and
`OBSERVATORY_PG_DIR`/`OBSERVATORY_PG_PORT` select the test cluster.
The repository's full-simulation allowance was used earlier.
These are affected-block results, not a fresh full-suite or hosted Linux CI pass.

Validation uses zero model calls and costs $0: these classification and routing paths are deterministic.
Real-LLM and external-client qualification are not claimed.
Authoring client: Codex desktop, OpenAI `gpt-6-astra`; app version not collected.
Claude Code, ChatGPT, Hermes, OpenClaw, Muse, Grok, elizaOS, and Cursor were not tested as clients.

## Reproduction and limits

1. Check out `d0cbc30a6892c9aee91ca3d654c27808527715ba` separately.
2. Load `scripts/sim/network.ts` from `35ec0161c397fd355728cd2820c38ca27fa2e5e0`.
3. Run the affected command. Expect 152/153 and `expected 54 to be 72`.
4. Load `packages/network/src/classify.ts` from the same code commit and repeat.
5. Expect 153/153, with 198 correct `SELF_ABSENCE_OUTCOMES` rows and 72 correct `SELF_ABSENCE_ROUTING_OUTCOMES` rows.

This remains a bounded pattern parser. It does not resolve arbitrary quotations, omitted subjects,
reported speech, uncommon complements, or every plural/tense ambiguity.
The object exclusions cover named common forms, not general language understanding.
Unsolicited routing still uses the existing most-recent unanswered meeting rule.
It does not introduce a dialogue for choosing among several past meetings.
The fix applies to new replies; historical finalized penalties and reports are unchanged.
No live sends or deployment. Draft pending maintainer review and hosted CI.
