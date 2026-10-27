# Refused recurring days must not become free time

Date: 2026-10-28. Repository: eliza-research/thenetwork.
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

## Limits

Standing availability remains a decaying prior, not a hard calendar exclusion.
This change does not repair old saved values or change exceptions within a positive group, such as "weekdays except Tuesday".
It does not expand the existing negation grammar or measure live delivery or conversation quality.
