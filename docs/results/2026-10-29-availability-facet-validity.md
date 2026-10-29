# Respect validity dates when choosing introduction times

Date: 2026-10-29. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Tested code: `ec8909729702802aa600b00dde1827fa5d10e169`.

## Requirement and cause

Reproduced scheduling defect under the approved contribution scope and the time-options design in
`docs/network.md` section 4.1 and `docs/design/2026-10-07-experience-design.md` section 1.11.
The scheduler uses stated availability to choose two or three times for everyone.

`standingFromFacets` reads `availability_pattern` tags without checking validity dates.
The service snapshot retains those dates, but the Network sends its raw facets to this helper.
The engine's World filters inactive facets for matching; that filter does not cover time selection.
An expired or future Tuesday pattern therefore suppresses other days in the actual probe.

Add optional `validTo` to the helper's structural input and ignore a pattern when `validFrom > now`
or `validTo < now`. These are the same inclusive endpoint rules as World.
The passed Clock time decides validity. The existing decay, priors, tag grammar and option ranking remain.
Undated conversation patterns remain valid. Both ConsentNetwork and StubNetwork use this helper.

Other implementations considered:

1. Filter only in ConsentNetwork. This leaves the shared helper's StubNetwork consumer inconsistent.
2. Filter the service snapshot globally. This changes unrelated readers and does not cover in-memory worlds.

## measurement

Paired command: `bun run sim --only network --json <output-file>`.
The new gate runs first on unchanged base production code, then with the fix using identical inputs.
There is one added sim gate, with 21 real ConsentNetwork flows: seven conditions on seeds 1, 2 and 3.
Each uses two synthetic adults, actual onboarding, a JSON state restart, a staff-composed climbing
proposal, the human review queue, simulated staff approval and the recorded first anonymous probe.
No probe may be sent before approval. No planner, scheduler output or review decision is mocked.
The recording channel sends no real messages. The fixture retains snapshot rows across restart;
this focused gate does not claim a database persistence test.

| Availability condition | Before | After | Expected control |
|---|---|---|---|
| No pattern | Three options | Three options | No-pattern control |
| Starts in 30 days | Two options | Three options | No-pattern control |
| Expired before the run | Two options | Three options | No-pattern control |
| Active dated Tuesday pattern | Two options | Two options | Active control |
| Starts exactly when the probe is sent | Two options | Two options | Active control |
| Ends exactly when the probe is sent | Two options | Two options | Active control |
| Tuesday availability from onboarding, without validity dates | Two options | Two options | Active control |

The three options are Tuesday 7pm, Saturday 10am and Sunday 10am, New York time.
The two-option set omits Sunday. Assertions compare complete options, including start/end and labels.
All six inactive-facet failures are fixed: **15/21 correct flows -> 21/21**.
This is a deterministic regression, not a statistical estimate of attendance or user acceptance.
Exact endpoints are checked at the recorded send time, one hour after the fixture's start.

| Validation | Before | After |
|---|---:|---:|
| Network blocking gates | 61/62 | 62/62 |
| Tracked gates off target | 0 | 0 |
| Runtime | 163.2s | 184.8s |

All 63 other gate records are identical after removing runtime fields.
The invariant-run fingerprint remains `24bb81f068060b33`.
The stock run covers seed 3 for 10 days; consent-vs-push covers seeds 1-3 for 21 days;
all NYC scenarios and all sim scenarios run, the latter at pass^3; conformance uses seeds 1-4.
The stock worlds use the repository's simulated reviewer. Their safety thresholds are unchanged.

## safety_gates

The judge, minor-contact and canary-leak counts remain zero. Review-before-contact, consent-before-reveal,
quiet hours, interruption caps, plans and hard-filter conformance retain their passing values.
Combined locally with the other nineteen contributions: **64/64 Network gates**
and all four typechecks pass. All 64 shared gate records match the isolated run.
Both sets of adjacent regression tests were retained when resolving their insertion conflict.
The combined branch is local-only.

## Validation and reproduction

1. On base `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`, load only `scripts/sim/network.ts` from `ec8909729702802aa600b00dde1827fa5d10e169`.
2. Run `bun install --frozen-lockfile`, then `bun run sim --only network --json before.json`.
   Expect only the new gate to fail, listing future and expired conditions on all three seeds.
3. Load `packages/engine/src/attention.ts` from the same code commit and repeat.
   Expect all 62 blocking gates to pass, with no other gate result changed.
4. Run `bun run typecheck`, `bun run test:integration` and `bun run test:e2e`.

Typecheck passes all four configurations. The Windows test host uses Bun 1.4.2 and PostgreSQL 16.15,
a local test cluster on 127.0.0.1:54339, `USER=postgres`, `REQUIRE_PG=1`, `PG_BIN_DIR` and
`OBSERVATORY_PG_DIR` pointing to that test installation, and Git Bash on PATH.

- Integration: **675 pass, 8 skip, 6 fail**, 13741 assertions; 533.84s.
- All eleven files in `bun run security` ran as part of integration.
- The six failures match the established Windows baseline: absolute `/bin/bash` missing,
  SIGTERM exit 143 versus 0, and four Windows path-separator assertions.
- Eight skips are the opt-in retry reconciliation suite. Integration is not claimed green.
- E2E: **42 pass, 1 optional browser skip, 0 fail**, 654 assertions; 68.41s.
  The browser recovery-feedback test requires `PLAYWRIGHT_MODULE`; it was not configured.

Draft pending maintainer Linux CI. The full simulation allowance was used for PR #136;
this change reruns its affected Network block, including both shared-helper consumers.

## llm_evidence

Deterministic date filtering and scheduling. Zero validation model calls, $0.
No model-backed behavior changes or model-quality claim.

## agent_clients

The actual backend flow is exercised directly. External clients were not tested;
no client, MCP contract, plugin, UI or message template changes.
Authoring: Codex desktop, OpenAI `gpt-6-astra`, identified by the operator.

## Limits

Validity is evaluated when selecting times, as in the engine's current-fact view.
This does not model future pattern transitions within each offered slot.
Previously offered or booked times are not rewritten. Availability remains a decaying prior, not a hard constraint.
PR #148 addresses the separate Friends profile reader; PR #160 addresses parsing refused recurring days.
Neither fixes this shared availability reader. No live delivery, real-client acceptance or attendance gain is claimed.
