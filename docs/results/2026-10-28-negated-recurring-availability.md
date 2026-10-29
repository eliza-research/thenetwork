# Refused recurring days must not become free time

Date: 2026-10-28. Updated 2026-10-29; the positive-group exception follow-up below is the latest result. Earlier sections describe their named revisions. Repository: eliza-research/thenetwork.
Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Code and regression: `d40d29658abbd632276d66fcf826fdb4fc2d2cf9`.

## Requirement and cause

The approved contribution scope permits a reproduced bug fix.
The availability design, `docs/design/2026-10-07-experience-design.md` section 1.11, uses members' stated windows when selecting times.

The message "Usually free Tuesday evenings, not weekends" saved Tuesday evening plus all three dayparts on Saturday and Sunday.
"Not weekdays" and "not weeknights" also added the refused days to standing availability.
Those incorrect values survived a state export and reload, then increased the scheduler's free-time score.

`availabilityTags` checked negation for named days, such as Saturday.
Its three recurring-day branches expanded every matching phrase without that check.
The fix uses the same `negatedAt` check in those branches, before adding days or the implicit evening part.
No message wording changes.

## measurement

Windows, Bun 1.4.2, TypeScript 5.9.3, local PostgreSQL 16.15 on port 54339.
The regression runs the production `ConsentNetwork.onInbound` handler with a simulated clock and an in-memory channel.
It welcomes an adult, reads their availability, exports state as JSON, and loads it into a new Network instance.
It reads the saved standing tags through `standingFromFacets` and scores a refused slot with `availabilityProb`.
Matching is disabled in this conversation fixture; review remains human. No real messages are sent.

Ten phrases run on each of three generated worlds, seeds 1, 2 and 3, with 120 adult members per world.
The clock starts at `2026-10-05T16:00:00Z`.
Six phrases refuse a recurring-day group, with negation before or after the group.
Three controls affirm those groups. One control refuses a named Saturday.
Each conversation uses a fresh Network instance and an eligible NYC adult from its world.

| Result | Before | After |
|---|---:|---:|
| Correct persisted availability, all 30 conversations | 12/30 | 30/30 |
| Correct recurring-day refusals | 0/18 | 18/18 |
| Correct unchanged controls | 12/12 | 12/12 |
| Network blocking gates | 61/62 | 62/62 |
| Existing Network gate records, excluding runtime | 63 | All 63 identical |

Before command: `bun run sim --only network` (164.5 seconds).
After command: `bun run sim --only network,evals --json ../availability-after-gates.json`.
After result: **87/87 blocking gates**, zero tracked failures, 181.6 seconds (Network 181.3; evals 0.4).
The sole new gate fails before the fix with `expected 12 to be 30`.
Afterward, every refused slot in the fixture scores below the unchanged 0.45 weekend-day prior.
The unchanged controls still retain their stated windows.

A separate holdout check uses seeds 4, 5 and 6.
It replaces the first three refusals with "not the weekend", "not on weekdays", and "no weeknights".
The other seven phrases and the method stay the same.
Correct results again increase from 12/30 to 30/30; the same scheduler assertions pass.
The before holdout uses the existing comparison checkout; the exercised Network and availability sources match main.
The fix was not tuned on these seeds or wording variants.

## safety_gates

All 63 existing Network gate records, including the invariant-run fingerprint, are identical before and after.
Minor contacts, canary leaks, consent, review, caps and plan invariants keep their existing gates.
All 25 parser and leak eval gates pass. No threshold, corpus row or existing assertion changes.

- Typecheck: pass.
- Integration, including the security suite's files: 675 pass, 8 opt-in reconciliation skips, 6 known Windows failures; 13,741 assertions in 689 tests across 68 files, 554.06 seconds.
- End-to-end: 42 pass, 1 optional skip, 0 fail; 654 assertions in 43 tests, 95.88 seconds.
- Combined with the sixteen prior contributions: 88/88 Network and parser gates; zero tracked failures, 177.9 seconds. Typecheck passes. Both added Network cases were retained when resolving the test-file insertion conflict; production code needed no adjustment.

The six integration failures match the previously measured main baseline: an absolute `/bin/bash` path, the SIGTERM exit code, and four site path-separator assertions.
All eleven files named by the security command ran within the integration suite.
The eight reconciliation skips require `NETWORK_RETRY_RECONCILIATION_TEST=1`; local PostgreSQL was running.
This contribution remains a draft pending Linux CI.

The full simulation allowance was used earlier in this contribution session.
Only the affected Network block and parser evals were run here, following AGENTS.md's machine-load rule.
Combined validation covers these blocks and typecheck; it is not a new full combined-suite result.

## Attempts and alternatives

One implementation attempt: add the existing refusal check to the three recurring-day branches.
The initial local conversation probe sent availability as its first message, which only welcomes a new member.
Adding a separate greeting reached the normal learning path before the baseline measurement.
The committed regression and its expected results were unchanged between the measured before and after runs.

1. Remove a whole sentence when it contains a refusal. This would also discard the stated Tuesday evening.
2. Build a separate recurring-day negation parser. This would duplicate existing clause and refusal rules and risk disagreement with named days.

## llm_evidence

This change is deterministic. Validation made zero model calls, with $0 model-call cost.
Simulation runs clear provider keys. No model-generated profile or model-backed behavior is claimed.
Authorship: OpenAI / `gpt-6-astra`, Codex desktop.

## agent_clients

No MCP contract, plugin, client, UI or message template changes.
The production message handler is exercised by the simulation, not by an external agent client.
Claude Code, ChatGPT, Hermes, OpenClaw, Muse, Grok, elizaOS and Cursor were not tested.

## Reproduction

In a separate checkout at the base commit, load only `scripts/sim/network.ts` from the code commit above.
Run `bun install --frozen-lockfile`, then `bun run sim --only network`.
Expect 61/62 blocking gates and the new case's `expected 12 to be 30` failure.
Load `packages/network/src/classify.ts` from the same code commit.
Run `bun run sim --only network,evals` and `bun run typecheck`.
Expect 87/87 blocking gates and a successful typecheck.
For the holdout, use the seed list and three wording substitutions stated above.

## Limits at the original revision

Standing availability remains a decaying prior, not a hard calendar exclusion.
This change does not repair old saved values or change exceptions within a positive group, such as "weekdays except Tuesday".
It does not expand the existing negation grammar or measure live delivery or conversation quality.

## Reviewer follow-up: default evenings (2026-10-28)

The [review](https://github.com/eliza-research/thenetwork/pull/160#pullrequestreview-5677077382) identified another path that restored refused weekday evenings.
This follow-up starts from PR head `aad676569ded15ec47a71aa388915f6c195918f5` on the same branch.

The exact phrase "free most evenings, not weeknights" returned all five weekday evenings.
"Free most evenings, not weekdays" did the same.
The recurring-day checks rejected those groups, but the default-evening fallback added them again when no positive days remained.

The fallback now checks weekday and weeknight mentions with the existing `negatedAt` rule.
A refused group prevents that fallback from adding Monday through Friday.
"Most evenings" and "most evenings, not weekends" still return the five weekday evenings.
Explicit positive windows still use the existing token path.
No other parser branch, message wording, safety threshold or dependency changes.

The existing conversation gate adds six phrases, making 16 phrases on each of seeds 1, 2 and 3.
Four phrases refuse the fallback days; two preserve valid fallback behavior.
The refusals cover `most`, `any`, `all` and `every`, with negation before and after the group.
The gate exports and reloads each conversation, then checks persisted tags and the scheduler's probability.
With no affirmative window, neither standing availability nor an availability sample is created.
The weekday-evening probability remains the existing 0.35 prior; refusal does not create a hard calendar exclusion.

### measurement

Use `bun run sim --only network,evals --json <output>` for both versions.
The before version contains the expanded regression and the unchanged PR-head parser.
The after version adds only the fallback guard.

| Result | Before | After |
|---|---:|---:|
| Correct persisted availability, seeds 1-3 | 36/48 | 48/48 |
| Correct new fallback refusals | 0/12 | 12/12 |
| Original cases and new positive fallback controls | 36/36 | 36/36 |
| Held-out phrases and seeds 4-6 | 36/48 | 48/48 |
| Network and parser blocking gates | 86/87 | 87/87 |

The before gate fails with `expected 36 to be 48`.
The holdout uses the same conversation fixture with seeds 4-6 and these four replacement refusals:

- `free most evenings, no weeknight`
- `Usually free any evenings, not on a weekday`
- `Usually free all evenings, weeknight is out`
- `Usually free every evening, weekday does not work`

Windows setup used Bun 1.4.2 and TypeScript 5.9.3.
The default isolated dependency linker could not resolve `@thenetwork/platform` on this machine.
`bun install --frozen-lockfile --linker hoisted` resolved it without changing manifests or the lockfile.
The machine's Git configuration converted checkout text to CRLF.
Restoring the committed LF bytes fixed contract-hash failures and the site frontmatter build error, with no additional Git diff.
The database test environment also needed `USER=postgres`; one helper uses it without a default.

### safety_gates

The before run takes 179.3 seconds; the after run takes 175.3 seconds. Both have zero tracked failures.
All 88 other gate records are identical, excluding runtime.
This includes the invariant-run fingerprint `24bb81f068060b33` and all 25 parser and leak gates.
Typecheck passes after the fix.

The paired measurements above use the initial regression assertions.
Independent review then required every empty-expected case to assert absent standing state, absent availability samples and the unchanged scheduler prior.
With those unconditional assertions, `bun run sim --only network,evals` passes 87/87 gates, with zero tracked failures, in 178.6 seconds.
All 89 gate records match the earlier after-run, excluding runtime.
The held-out fixture with the tightened assertions passes all 48 conversations on seeds 4-6; typecheck also passes.
No production code changed during this assertion review, so integration and end-to-end suites were not repeated.

The first full integration attempt reports 592 pass, 8 skip and 9 fail in 551.23 seconds.
Checkout setup errors prevented some tests from starting; the first end-to-end attempt also failed during setup.
After the setup corrections, all seven failed integration files were rerun with `--conditions eliza-source --timeout 120000`.
They report 141 pass and 6 fail across 147 tests, with 1,468 assertions, in 15.20 seconds.
The remaining failures match those documented above: `/bin/bash` is unavailable, SIGTERM returns 143, and four site assertions expect forward-slash paths.
No fresh paired baseline integration run was performed for this follow-up; the comparison uses the earlier committed report.
All eleven security-suite files ran in the full integration attempt; affected router and backend files also ran in the recheck.
The eight reconciliation skips remain opt-in; PostgreSQL 16.15 was running locally and `REQUIRE_PG=1` was set.

The corrected `bun run test:e2e` reports 42 pass, 1 optional skip and 0 fail, with 654 assertions, in 68.89 seconds.
The task's local PostgreSQL cluster was stopped after testing.
The full simulation allowance was already used in this contribution session, as recorded above.
This follow-up reruns the affected blocks; it does not claim a new full-suite simulation result.

### Alternatives and remaining limits

1. Remove the default-evening fallback. This would discard valid "most evenings" availability.
2. Disable fallback whenever any day group is refused. This would discard valid weekdays when only weekends were refused.

The guard reuses the existing negation rule and applies only to groups that overlap the fallback days.
Exceptions within positive groups and fallback exclusions of individual named days remain outside this change.
Existing saved values are not repaired. Unstated weekend availability is not inferred from a weekday refusal.

### llm_evidence and agent_clients

This follow-up changes deterministic parsing and makes zero validation model calls, at $0 model-call cost.
No provider keys are configured in this checkout. No real-model or external agent-client result is claimed.
The production message handler is exercised through the simulation, with matching disabled and human review retained.
Authorship uses OpenAI through Codex; the exact model identifier is unavailable in this delegated session.

### GitHub CI status

[Run 40558349637](https://github.com/eliza-research/thenetwork/actions/runs/40558349637) targets the original PR head above.
On 2026-10-28, the API reports `completed` / `action_required`, and its jobs endpoint returns an empty list.
The run page states: "This workflow is awaiting approval from a maintainer" in PR #160.
An upstream maintainer must review the fork workflow and decide whether to approve its run.
No workflow approval, permission change, settings change or rerun was attempted.
This run supplies neither passing nor failing test evidence.

## Named-weekday follow-up (2026-10-29)

Code and expanded regression: `72af3e4ce46230ccef311b05a83ae0a5929cedc9`.
Previous published head: `e3cc106bdadc668b38a918eee9b8d5c40749be2d`.
Main remains `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.

The published guard handles refused weekday groups, but "Free every evening, not Tuesday" still saves all five weekday evenings.
"Free all evenings, Friday is out" has the same defect.
The fallback now checks the existing Monday-through-Friday word patterns as well as the two weekday groups.
Every check uses the existing `negatedAt` rule. This extends the same fallback guard without changing the negation grammar.
"Most evenings, not weekends" and "most evenings, not Sunday" retain weekday evenings because those refusals do not overlap the fallback.
Explicit positive windows still follow the existing token path.

### measurement

The existing gate adds two named-weekday refusals and one Sunday control.
It now runs 19 phrases on each of seeds 1, 2 and 3: 57 conversations.
The world, clock, adult selection, greeting, production inbound handler and state reload are unchanged.
The reload creates a new Network instance; it does not restart an operating-system process.

| Correct persisted availability | Main | Previous published head | Revised fix |
|---|---:|---:|---:|
| All conversations | 18/57 | 51/57 | 57/57 |
| Original recurring-group refusals | 0/18 | 18/18 | 18/18 |
| Generic-evening group refusals | 0/12 | 12/12 | 12/12 |
| Named-weekday fallback refusals | 0/6 | 0/6 | 6/6 |
| Default and non-overlapping-day controls | 18/21 | 21/21 | 21/21 |

The previous-head column runs the same expanded first gate against the published parser; it fails with `expected 51 to be 57`.
The full main run fails only that gate, with `expected 18 to be 57`.
The gate collects every conversation before comparing counts, then checks each empty result's state and scheduler probability.
Each empty result has no standing pattern, no availability sample, and the unchanged 0.35 weekday-evening prior.
These assertions preserve the stricter state checks added in the previous review follow-up.

Both full measurements use `bun run sim --only network,evals --json <output>`.
Main: **86/87 blocking gates**, zero tracked failures, 218.5 seconds.
Revised fix: **87/87 blocking gates**, zero tracked failures, 224.7 seconds.
All 88 other gate records are identical, excluding runtime; the invariant fingerprint stays `24bb81f068060b33`.
Historical holdout results above apply to their original fixtures; no new holdout claim is made for the added named-day cases.

### safety_gates

- Typecheck: pass, both isolated and combined branches.
- Integration, including all eleven security command files: **675 pass, 8 skip, 6 known Windows failures**; 13,741 assertions, 689 tests, 68 files; 578.71s.
- End-to-end: **42 pass, 1 optional skip, 0 fail**; 654 assertions, 43 tests, 3 files; 85.51s.
- Combined with the other sixteen contributions: **88/88 affected gates**, zero tracked failures; 179.3 seconds.

Integration uses PostgreSQL 16.15 on port 54339, `USER=postgres`, `REQUIRE_PG=1`, and the local binary directory in `PG_BIN_DIR`.
The completed rerun sets `OBSERVATORY_PG_DIR` to a fresh, isolated cluster initialized with the local `postgres` role.
The six failures match the measured main baseline: absolute `/bin/bash`, SIGTERM exit status, and four Windows path-separator assertions.
The eight reconciliation skips require `NETWORK_RETRY_RECONCILIATION_TEST=1`; PostgreSQL was running.
The end-to-end skip is the optional external-origin check.
This PR remains draft pending maintainer-approved Linux CI.
The full simulation allowance was used earlier; these runs follow AGENTS.md's affected-block rule.
Combined validation covers these blocks and typecheck, not a new full combined-suite result.

### Attempts, alternatives and limits

An initial local attempt suppressed fallback after any named day, including weekends.
It passed 54 conversations, 87 affected gates, typecheck and end-to-end; integration showed only the six known Windows failures.
Final synchronization found the published group guard and its weekend-preservation control.
The broad attempt was not pushed. The revised change preserves that published behavior and adds only overlapping named-weekday refusals.
All final measurements above use the revised implementation and fixed 57-conversation fixture.

The first final integration and combined runs were interrupted before completion; their partial logs are not passing evidence.
On resumption, the old database needed crash recovery. Starting integration before it was ready let the helper start another local cluster.
That attempt produced database setup errors and was stopped. Both old clusters were stopped without deleting their files.
A fresh isolated cluster was initialized, and `psql` confirmed its `postgres` role and PostgreSQL 16.15 before the completed integration rerun.
The combined simulation and typecheck were also rerun to completion. The completed isolated simulation and end-to-end evidence remained valid.

1. Suppress fallback after every named day. This unnecessarily discards valid weekdays when only weekends are refused.
2. Infer a week and subtract each refused day. This adds exception grammar and guesses the remaining unstated availability.
3. Add a separate refusal parser. This duplicates the existing named-day patterns and clause rules.

With only generic evenings and a refused weekday, the parser now records no new availability pattern.
This is a conservative result; it does not infer the other four weekdays.
Standing availability remains a decaying prior. Existing saved values are not repaired or cleared.
Exceptions inside a positive group, such as "weekdays except Tuesday", remain outside this change.
The older limitation about individual named days no longer applies to the generic-evening fallback.
No message wording, UI, threshold, dependency or client contract changes.

### llm_evidence and agent_clients

Deterministic validation made zero model calls, costing $0. No real-model or external-client result is claimed.
The production handler runs in the simulation with matching disabled and human review retained.
Authorship: OpenAI / `gpt-6-astra`, Codex desktop.

### Reproduce the named-weekday revision

1. Start at main `a0ed7bc6495d9e524afc3d500738212a28dc7bc2` in a separate checkout.
2. Load `scripts/sim/network.ts` from `72af3e4ce46230ccef311b05a83ae0a5929cedc9`.
3. Run `bun install --frozen-lockfile`, then `bun run sim --only network,evals`.
4. Expect 86/87 blocking gates and `expected 18 to be 57`.
5. Load `packages/network/src/classify.ts` from the same code commit.
6. Run the same simulation and `bun run typecheck`. Expect 87/87 and a successful typecheck.

For the intermediate result, use `classify.ts` from the previous published head with the current gate.
Its first gate reports `expected 51 to be 57`.


## Positive-group exception follow-up (2026-10-29)

This section supersedes the earlier positive-group exception limit. It addresses
[the requested change](https://github.com/eliza-research/thenetwork/pull/160#pullrequestreview-5696515672)
on published head `fa0ba9245d77a871ddf94ea86fa2674c2cfdc12b`. Main remains
`a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Tested code and expanded gate: `59a20feb119b1d923f1ec0f47d789ff524cfb37b`.
Combined code: `4c873b6518940ef90c25e2502c0bab9e48450ff3`.

### Cause and implementation

The group guards reject "not weekdays", but an offered group still expands over
a named refusal: "I'm free on weekdays except Tuesday" saves Tuesday evening.
The saved standing pattern raises Tuesday's scheduler score above its prior.
This is the same existing availability workflow and requirement described above.

Collect refused named days during the existing day-word pass. Remove them when
expanding an offered weekend, weekday or weeknight group. Reuse `negatedAt`;
there is no second refusal parser or new negation grammar. Explicit positive
named-day handling stays in its existing path. If a group becomes empty, do not
replace it with default weekdays. For example, "Free most weekend evenings except
Saturday and Sunday" must not invent weekday availability.

Alternatives: suppressing the entire offered group loses the days the member did
offer. Subtracting from an inferred week for every generic-evening statement
changes the existing conservative fallback policy. This change subtracts only
from an explicit group, and keeps the prior fallback policy.

### measurement

Expand the existing production-inbound regression from 19 to 35 phrases, each on
seeds 1, 2 and 3: **105 conversations**. Keep the greeting, adult selection,
synthetic world, human-review setting, disabled matching and JSON state reload.
The 16 new phrases cover 11 partial group exclusions, two fully refused groups,
and three controls. These are hand-written deterministic cases, not population
estimates. No real member data or live messages are used.

| Correct persisted availability | Published head plus identical expanded gate | Revised fix |
|---|---:|---:|
| All conversations | 66/105 | 105/105 |
| New group-exclusion cases | 0/39 | 39/39 |
| Earlier 19 phrases | 57/57 | 57/57 |
| New unchanged controls | 9/9 | 9/9 |
| Fully refused groups leave no new availability | 0/6 | 6/6 |

All 66 previously correct outcome rows are identical. All 33 retained-day
scheduler scores are unchanged. The regression reads both saved standing state
and availability through the production scheduler after reload. It compares
each refused slot against that slot's no-statement prior; this preserves the
empty-state checks and covers weekend as well as weekday priors.

At the statement time, with New York local slots:

| Reply and slot | Before | After | No-statement prior |
|---|---:|---:|---:|
| Weekdays except Tuesday: Tuesday 19:00 | 0.750 | 0.210 | 0.350 |
| Same reply: Monday 19:00 | 0.750 | 0.750 | 0.350 |
| Weekends except Sunday: Sunday 10:00 | 0.770 | 0.270 | 0.450 |
| Same reply: Saturday 10:00 | 0.770 | 0.770 | 0.450 |

The statement clock is `2026-10-05T16:00:00Z`; slots are October 10/11 at 10:00
and October 12/13 at 19:00 New York time. These are model probabilities from the
existing attention configuration, not measured attendance rates.

Same command on the previous published parser and fixed parser, with the same gate:

```sh
bun run sim --only network --only evals --json <results.json>
```

Before: **86/87** blocking gates, zero tracked misses, 251.1 seconds.
After: **87/87**, zero tracked misses, 268.1 seconds. The new cases make
the existing availability gate fail before the fix with `expected 66 to be 105`.
All 88 other gate records are identical, excluding runtime. No old
gate, corpus row, threshold, policy invariant or outcome value was weakened.
The earlier main comparisons above apply to their stated fixtures; this fresh
comparison starts from the published PR head, not main.

### safety_gates

- All four typecheck configurations pass on isolated and combined branches.
- Integration including all 11 security files: **675 pass, 8 skip, 6 known Windows
  failures**, 13,741 assertions, 689 tests in 68 files, 506.92s.
- E2E: **42 pass, 1 optional browser skip, 0 fail**, 654 assertions, 43 tests in
  three files, 42.95s.
- Combined with the other 37 contributions: **92/92** Network/parser blocking gates,
  zero tracked misses, 260.1 seconds. All 105 new outcome rows match
  the standalone fix. All 93 other gate records retain their values:
  Network compared with #199's combined run, and evals with the previous #160
  combined run. The cherry-pick needed no conflict resolution. This branch stays local.

The integration failure names match the latest isolated main-based fix (#199):
Wrangler requires `/bin/bash`, SIGTERM returns 143 rather than 0, and four site
tests compare Windows and POSIX paths. They are not passing tests. The eight
retry-reconciliation skips are opt-in. No fresh paired baseline integration run
was made for this follow-up. All security files ran within integration.

Commands: `bun run typecheck`, `REQUIRE_PG=1 bun run test:integration`, and
`REQUIRE_PG=1 bun run test:e2e`. Environment: Windows, Bun 1.4.2, PostgreSQL 16.15
on local port 54339. `PG_BIN_DIR` and `PATH` select the binaries; `USER=postgres`
and `OBSERVATORY_PG_DIR`/`OBSERVATORY_PG_PORT` select the local cluster.
Dependencies are unchanged. The full-simulation allowance was used earlier;
these are affected-block results, not a fresh full-suite or hosted Linux CI pass.

### Remaining limits, llm_evidence and agent_clients

"Free most evenings, not Tuesday" deliberately records no new pattern; it does
not infer the other four weekdays. Explicit offered groups now support named
day exclusions. Availability remains a decaying prior, not a hard calendar ban;
existing stored values are not repaired or cleared.

Refused dayparts such as "weekdays, not evenings" and "free most evenings, not
after work" remain outside this patch. The existing daypart assignment and clause
grammar are unchanged; this does not claim general natural-language exception
understanding. No UI, message copy, schema, model prompt or client contract changes.

Zero validation model calls/$0. The behavior is deterministic. No external-agent
client acceptance claim. Authoring client: Codex desktop, OpenAI `gpt-6-astra`;
app version not collected. Draft pending maintainer review and hosted CI.

### Reproduce this follow-up

1. Check out `fa0ba9245d77a871ddf94ea86fa2674c2cfdc12b` in a separate workspace.
2. Load only `scripts/sim/network.ts` from `59a20feb119b1d923f1ec0f47d789ff524cfb37b`.
3. Run the affected command above. Expect 86/87 and `expected 66 to be 105`.
4. Load `packages/network/src/classify.ts` from the same code commit and repeat.
5. Expect 87/87. `AVAILABILITY_REFUSAL_OUTCOMES` contains 105 correct rows.

All validation processes completed. The database was stopped after validation.
