# Date Friends availability from the statement, not the join

Date: 2026-10-30. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Tested code: `2db606ed06c64662334b739e8a5559d20cf6571f`.
Combined code: `a376fbef419b1ae7ae09c039a380aa5cb7ff7d1d`.

## Requirement, defect and implementation

PRD 40.6 includes the local Friends planning workflow. The standing-availability policy in
`docs/design/2026-10-07-experience-design.md`, section 1.11 (founder decision 4b), treats stated availability as a decaying prior.
Its age is the time since the fact was stated. `attention.standingFromFacets` already prefers
`observedAt` over `validFrom` for the shared availability reader.

Friends instead flattened all facets into tags, losing their dates, then supplied `member.joinedAt`
to every standing window. A member who joined 180 days ago could state Tuesday-evening availability
today and receive Friday/Saturday/Sunday options without Tuesday. An old fact for a newly joined
member had the opposite error: it was treated as fresh and promoted Tuesday.

Keep each facet with its tags until constructing availability. Use its observation time, then
validity start, then the existing join-date fallback. Other profile fields retain the same tag
order and reading behavior. No decay, confidence, eligibility, matching threshold, planner policy,
schema or copy changes.

Alternatives considered: using current time refreshes all evidence on every planning run;
using the newest fact's time for every slot refreshes unrelated old facts; keeping the join date
discards available evidence. Per-facet timestamps preserve the existing fallback without either refresh error.

## measurement

One added blocking gate: `availability: crew offers use the statement time, not the member's join date` in `scripts/sim/friends.ts`.
The same hand-written six verified adults, ages 30, run under engine seeds **7, 13, 17**.
All live near a public dinner venue and have one earlier positive group meetup.
Six timestamp cases produce **18 planner workflows**, not 18 independent population samples.

The production World and Friends reader consume synthetic snapshot facts after a JSON round-trip.
The default weekly planner creates an actual crew offer and its time options using the real
availability scorer. The planned offer crosses JSON before inspection, and production `planItem`
creates each invitee's pending review item.

Cases: recent observation with old validity start; recent validity start without observation time;
old observation with recent validity start; no timestamps; an old fact for a newly joined member;
and a mixture of fresh Tuesday and old Sunday facts. The mixed case checks both fact times so
refreshing every slot cannot pass. No expected result changed after the baseline failure.
One production implementation was tried. A missing fixture type annotation was corrected before final typechecking.

| Observation | Base | Fixed |
|---|---:|---:|
| Correct options and fact timestamps | 6/18 | 18/18 |
| Fresh Tuesday options present | 0/9 | 9/9 |
| Old Tuesday options promoted because the member just joined | 3/3 | 0/3 |
| Old and legacy controls correct | 6/6 | 6/6 |

Every case retains the original Friday slot and all six invitees. All review items remain pending.
The fixture proves a deterministic scheduling distinction, not improved attendance or friendship rates.
It tests planner input/output directly; it does not prove HTTP, PostgreSQL persistence, text intake or client acceptance.

Same command and fixture on both sides:

```sh
bun run sim --only friends --json <results.json>
```

Base **18/19** blocking gates in 52.5 seconds; fixed **19/19** in 63.1 seconds.
All **21 pre-existing records** match excluding runtime, including fingerprint `e5bf70e069eaa7e9`.
The official comparison remains seeds 5-8, eight weeks, 400 personas, pack/random/oracle arms,
with the simulator's automatic reviewer. Its tracked undetected-adversary harm remains
17.5 versus 10.5 per seed, **1.67x random**, against the target of at most 0.5x.
No performance or aggregate quality claim. The one-full-simulation allowance was already used for #136.

## safety_gates and compatibility

```sh
REQUIRE_PG=1 bun run sim --only safety --json <results.json>
```

Before and after: **17/17**, zero tracked misses, all 17 records identical, 17.2 / 19.6 seconds.
The age, consent, holds, review, closure, capacity, leak and protected/proxy rules remain unchanged.
Availability stays internal scheduling evidence; no new field is added to member-facing output.

Combined locally with the existing **40 contribution PRs**: **25/25** Friends gates in 76.5 seconds,
the same one tracked miss, and all 18 new rows identical to standalone. All **27 previous records**
match the preceding crew-host combined run. The earlier #148 future-validity filter remains present.
Production code merged cleanly. The test insertion/import conflict was resolved by retaining all
existing gates/imports and adding the new gate. The combined branch stays local.

All four typecheck configurations pass on standalone and combined branches. Full service validation
runs sequentially against PostgreSQL, avoiding concurrent cluster role creation:

```sh
bun run typecheck
REQUIRE_PG=1 bun run test:integration
REQUIRE_PG=1 bun run test:e2e
```

Integration includes all 11 security-suite files:

```text
675 pass
8 skip
6 fail
13741 expect() calls
Ran 689 tests across 68 files. [1264.32s]
```

The same six failure names occur in the preceding #197 run: absent `/bin/bash`, SIGTERM exiting
143 instead of 0, and four Windows/POSIX site-path comparisons. They remain failures.
The eight skips require the separate retry-reconciliation opt-in. No fresh paired main integration run was made.

E2E:

```text
42 pass
1 skip
0 fail
654 expect() calls
Ran 43 tests across 3 files. [111.30s]
```

The optional browser skip requires `PLAYWRIGHT_MODULE`. Windows, Bun 1.4.2, frozen dependencies,
PostgreSQL 16.15 on local port 54339. `PG_BIN_DIR`/`PATH` select the binaries; `USER=postgres` and
`OBSERVATORY_PG_DIR`/`OBSERVATORY_PG_PORT` select the local cluster. No live sends or deployment.

## llm_evidence and agent_clients

Zero validation model calls/$0; the changed path is deterministic. No real-LLM or external-client
acceptance claim. Authoring: Codex desktop, OpenAI `gpt-6-astra`; app version not collected.
Claude Code, ChatGPT, Hermes, OpenClaw, Muse, Grok, elizaOS and Cursor were not tested as clients.

## Reproduce and limits

1. Check out base `a0ed7bc6495d9e524afc3d500738212a28dc7bc2` separately.
2. Copy `scripts/sim/friends.ts` from code `2db606ed06c64662334b739e8a5559d20cf6571f`.
3. Run the affected command: expect 18/19 and 6/18 correct new outcomes.
4. Copy `packages/engine/src/packs/friends/info.ts` from that code commit and repeat.
5. Expect 19/19 and all 18 `FRIENDS_AVAILABILITY_TIME_OUTCOMES` rows correct.

Availability remains a soft prior. Legacy facts without dates retain the old join-time fallback.
This does not repair incorrect source timestamps, rewrite facts or previously offered times,
or add natural-language handling. #148 independently filters future-dated facts; that behavior
is tested in the local combination. Main's existing end-date policy is unchanged.
These results are affected-block and local-service evidence, not a fresh full simulation or hosted CI pass.
