# Expired counterpart wants in the simulator oracle

## Requirement and defect

This is a reproduced simulation defect within the approved Slop scope and
PRD 34.3: persona decisions must reflect hidden ground truth. The existing
`desireLive` contract says a hidden want stops counting at `lapsesAt`, even
while the Network still has a stale public intent.

`Oracle.desireMet` filtered the requester's expired wants but read every
counterpart want when checking for a shared pool. An expired counterpart want
therefore earned the strong shared-want score, 0.85. For a requester who had
naturally asked for that category, `evaluatePrimed` assigned acceptance
probability 0.96 instead of the normal perceived-fit probability. Ordinary
oracle scoring already filtered both people's wants, so the two paths disagreed.

Apply the existing `desireLive` predicate to the counterpart's pool match at
the supplied evaluation time. Preserve the optional timeless call, skills,
interests, romance compatibility and the rest of the choice model. The public
intent remains untouched; the oracle measures the cost of stale information.

Two alternatives considered:

1. Delete expired wants from the persona or public snapshot. That destroys the
   distinction between hidden truth and the Network's stale knowledge, and
   prevents evaluating the same persona at different times.
2. Remove the acceptance boost for every ask-primed persona. That changes the
   calibrated model for valid shared wants and does not address the inconsistent
   expiry check.

## measurement

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Same test and fixture before
and after:

```sh
bun test packages/sim/test/expired-peer-want.integration.test.ts
```

The regression runs the real World, StubNetwork, scheduler, channel and default
PolicyPersonaAgent for six days. Two adults join in SF with disjoint interests,
no matching skills and a `new_friends` want. The requester naturally sends a
social ask before the day-four introduction. The proposal has an explicit
social category and a window one day later. No persona memory, reply, oracle
result or decision is mocked. StubNetwork is the repository's concrete
simulation network; this is not a production service or human-review test.

Seeds 1, 2 and 9 each run five variants. Only the counterpart's hidden want
changes: no expiry, expiry one millisecond before the proposal window, exactly
at its start, one millisecond after, or no hidden want. All public intents are
identical. The test checks a prior natural ask, a delivered proposal decision,
and the delayed inbound reply that actually reaches the channel.

| Result across 15 worlds | Before | After |
| --- | ---: | ---: |
| Expired-want replies agree with the no-want control | 0/6 | 6/6 |
| Live or permanent shared-want controls accept | 6/6 | 6/6 |
| No-want controls decline on these seeds | 3/3 | 3/3 |
| Integration case | 0 pass, 1 fail | 1 pass, 0 fail |

Before, the first expired-want comparison fails after 47 assertions; all 15
worlds have already run. After, all 60 assertions pass. Separate observations
of the same fixture confirm all six false acceptances before and none after.
For example, seed 1 changes from an acceptance reply to the same decline text
as the no-want control. The test does not replace the probabilistic model with
a rule that every poor match must decline.

An additional paired probe uses seeds 1-40, six days, and three arms per seed:
permanent want, want expired at the world start, and absent want. It otherwise
uses the same two-person scenario, with the proposal window at the day-four
submission time. Of the 40 requesters, 27 naturally ask before the proposal.
All 27 lose the false 0.96 acceptance boost; 22 change their actual reply from
accept to decline, while five still accept under the normal seeded model.
Expired-want acceptance probabilities and actual decisions now match the
absent-want controls in all 40 worlds. The recorded permanent and absent
control rows are identical before and after.

Seeds 1-12 were used to reproduce the problem; seeds 13-40 were additional
qualification without tuning the fix. In the latter group, 21 requesters ask
first and 17 actual decisions disagree with the no-want control before the
fix, versus zero after. This synthetic fixture demonstrates the defect and
its correction; it does not estimate production prevalence or improvement.

Affected qualification, using the same command, seeds and settings:

```sh
bun run sim --only network,slop,safety,audit --json ../expired-peer.json
```

Both runs pass **133/133 blocking gates**, with eight tracked misses. Of 153
gate records, 144 are identical after excluding timing fields; nine change:

| Network gate detail | Before | After |
| --- | --- | --- |
| Consent/push fingerprint | `361f8cc2648fb9a6` | `3ffddbedac4474c8` |
| Consent everyone-yes, pooled (floor >0.73) | 0.847 | 0.840 |
| Consent invite-yes, pooled (floor >0.85) | 0.919 | 0.918 |
| Push everyone-yes (ceiling <0.25) | 0.152 | 0.141 |
| Unsafe proposals, consent vs push, seed 1 | 0 vs 32 | 0 vs 34 |
| Meetings, consent vs push, seed 1 | 50 vs 36 | 49 vs 34 |
| Consent pooled meetings (floor >140) | 144 | 143 |
| New members joined, seed 1 (floor >5) | 20 | 25 |
| Plans booked and held, seeds 1/2/3 | 1/0/1 | 0/0/1 |

Before takes 253.7 seconds; after takes 256.5 seconds. No speed claim is made
under shared machine load. The ordinary cohort also exercises this choice
path: this is not a fixture-only correction, and its downstream counts are
not unchanged. No floor, threshold or fingerprint was edited to obtain a pass.

The network block uses NYC seed 3 for ten-day invariants, seeds 1-3 for 21-day
consent-versus-push runs, and every simulator scenario at pass^3. The audit's NYC
world uses seed 3 for nine days. Slop retains seeds 13-16, four weeks, 300
personas per city, and service-world seeds 21/22, 80 daters and 30 days. Existing
safety and conformance controls run too. ConsentNetwork uses its simulated
automatic reviewer; no live messages are sent.

## safety_gates

All blocking safety checks still pass. The recorded minor, consent, leak,
block and hard-filter checks are unchanged except the comparative unsafe-
proposal detail above: ConsentNetwork remains at zero, while its push
baseline increases from 32 to 34. Thus this is **not** evidence that every
safety-gate value stayed identical. The PR is a draft so maintainers can
review the changed evaluation, including the narrower meeting-floor margin
and the lost plan on seed 1. All Slop, safety and audit gate records are
unchanged after excluding timing fields.

The change is confined to simulator truth. It does not alter production
matching, member records, prompts, thresholds, access controls or delivery
rules. The fixture checks permanent and still-live wants so the regression
cannot pass merely by disabling ask priming.

## Validation

Environment: Windows x64, Bun 1.4.2, PostgreSQL 16.15 on the isolated local
port 54339. Provider keys and live-send/deploy flags are absent from the test
processes. Dependencies and install hooks were audited and the frozen install
was already completed on this unchanged base.

- New integration: 1 pass, 0 fail, 60 assertions over 15 real worlds.
- Typecheck: exit 0 across root, sites, Observatory and deploy configurations.
- Integration, including the security file list: **676 pass, 8 skip, 6 fail**,
  13,805 assertions across 69 files, 540.48 seconds. The suite is not green.
  All six failure names exactly match the previously reproduced failures on
  this same base: Windows `/bin/bash` availability, SIGTERM exit status and
  four site-build path-separator cases. The eight skips require the optional
  `NETWORK_RETRY_RECONCILIATION_TEST` setup. No new failure name appears.
- E2E: **42 pass, 1 skip, 0 fail**, 654 assertions, 70.83 seconds. The skipped
  browser-SDK recovery case requires `PLAYWRIGHT_MODULE`; it was not run.
- Full default simulation was not repeated. AGENTS.md permits at most one full
  run per agent, already consumed earlier in this contribution session. Only
  the affected blocks above are claimed for this change.

To reproduce, use the new integration file with the base `oracle.ts`, run the
test, restore the fixed runtime and repeat. The base fails on a real reply;
the fix passes all 60 assertions. Then run the affected simulation command,
typecheck, integration and E2E with local Postgres.

## llm_evidence

Real-model calls: 0; cost: 0. This is a deterministic oracle and choice-policy
correction, tested through the real policy persona workflow. LLM persona mode
shares that choice policy but uses a model to write the words; its generated
wording was not tested. No real-LLM qualification or voice-quality result is
claimed. Prompts, providers and model-backed classifiers are unchanged.

## agent_clients

Codex desktop 26.1029.7803.0 drove the commands and GitHub connector/CLI directly,
without computer use. Authoring provider: OpenAI; exact model identifier:
unavailable. Claude Code/Claude, ChatGPT member flow, Hermes Agent, OpenClaw,
Muse, Grok bot, elizaOS and Cursor were not tested. This changes simulator
decisions, not their member-facing connectors. No untested client is claimed.

## Limits

Acceptance can decrease for stale shared wants. That is the expected
measurement correction, not evidence of a production matching regression or
improvement. The paired ordinary cohorts change as listed above; the new
workflow case isolates the expiry defect. Existing
timeless `desireMet` calls retain their previous behavior. Maintainers decide
whether the bounded model-free qualification is sufficient.
