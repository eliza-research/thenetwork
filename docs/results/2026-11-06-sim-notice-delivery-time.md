# Record cancellation notice when the persona sends it

Date: 2026-11-06. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Scope: reproduced simulation defect, under PRD 34.3 and the approved Slop
simulation-validation scope.

## Problem and cause

The generic simulator records cancellation notice when a persona decides to
reply. It then schedules that reply using the persona's latency and routine.
The meeting can occur before the reply arrives. STOP can also suppress the
queued reply. Both cases still received credit for advance notice.

This affects the attendance record, no-show metric and scenario grader. A
meeting with five attendees and one absent member could report no no-shows,
even though that member's cancellation arrived after the meeting.

The fix carries the proposal ID with the queued cancellation reply. The shared
persona-send path records notice only after the channel receives that message.
The existing STOP check runs first. Immediate morning-of notices use the same
path. Reply delays, attendance decisions and production Network code are unchanged.

Two alternatives were considered:

- Store the predicted send time at the earlier decision. This still gives credit
  to a queued reply that STOP prevents from being sent.
- Parse every inbound message to infer cancellation and its proposal. This
  duplicates language parsing and can confuse multiple pending plans. The
  existing policy decision already supplies the intent and proposal ID.

## measurement

The new integration case uses the real World, StubNetwork, channel, scheduler
and PolicyPersonaAgent. It adapts the existing six-person dinner scenario.
It removes forced-flake actions and gives one persona natural flakiness of 1.
There are no mocked replies, oracle results or model calls.

Seeds 2, 9 and 15 each run three nine-day variants:

- Early: reply-latency median 20 minutes, sigma 0, ignore probability 0.
  The cancellation reaches the channel before the meeting.
- Late: median 600 minutes with the same sigma and ignore probability.
  The reminder decision occurs at 15:05. Its reply arrives at 21:45, after
  the 19:00 meeting. In-flight replies use the existing 1.5 urgency divisor.
- Stopped: the same late reply is queued, but the member sends STOP at 16:00.
  The queued cancellation never reaches the channel.

The persona's routine can extend a reply delay. The tests verify actual channel
timestamps against the recorded policy decision and latency.

The same command ran before and after:

```sh
bun test packages/sim/test/notice-timing.integration.test.ts
```

| Result across nine worlds | Before | After |
| --- | ---: | ---: |
| Correct attendance notice flags and scenario grades | 3/9 | 9/9 |
| Late or unsent replies credited as advance notice | 6 | 0 |
| Early-notice controls credited correctly | 3/3 | 3/3 |
| No-show rate in each late/unsent case | 0% | 16.7% |
| No-show rate in each early control | 0% | 0% |
| Integration case | 0 pass, 1 fail | 1 pass, 0 fail |

Both runs execute 43 assertions. Before, the final comparison fails on notice
flags, no-show rates and false-positive scenario grades for all six negative
cases. After, those cases correctly fail the scenario's notice expectation,
and the integration case passes. Each world still has five attendees and one
absent member; the correction changes how that absence is classified.

A broader paired probe uses the same natural-flakiness, 600-minute configuration
on seeds 1-40. Thirteen worlds have a cancellation decision before the meeting
and a sent cancellation after it. False advance-notice records change from
13 to zero. The corresponding no-show rates become 16.7% or 20%, depending on
the booked roster. Those 13 probe traces retain their decision times, reply
delays, channel messages, meeting times and attendance. Only notice flags and
the no-show metric change in the recorded probe fields.

These are deterministic synthetic comparisons. The 13/40 count is not an
estimate of production frequency. The new integration file is the reproducible
regression artifact; the broader probe is an additional exploration.

The affected simulation qualification also ran before and after:

```sh
bun run sim --only network,slop,safety,audit --json ../notice-clock.json
```

Both runs pass **133/133 blocking gates**, with eight tracked misses.
All **153 gate records remain identical**, excluding timing fields, including
the fingerprints. Before takes 256.8 seconds; after takes 270.1 seconds. No
runtime-speed claim is made under shared machine load.

The network block uses NYC seed 3 for ten-day invariants, seeds 1-3 for 21-day
consent-versus-push runs, and every simulator scenario at pass^3. The audit's NYC
world uses seed 3 for nine days. The Slop block retains seeds 13-16, four weeks,
300 personas per city; its service-world arm uses seeds 21/22, 80 daters and
30 days. Existing safety and conformance controls run too. ConsentNetwork
qualification uses its simulated automatic reviewer. The StubNetwork baseline
has no human-review layer. None of these runs sends live messages.

## safety_gates

All existing gate values and fingerprints in those four blocks are unchanged.
Minor exclusion, consent, leak, block and hard-filter checks retain their
passing results. No threshold, parser, delivery policy or production code changes.

## Validation and limits

- `bun run typecheck`: exit 0 across all four configurations.
- `bun run test:integration`: 676 pass, 8 skip, 6 fail, 13,784 assertions across
  69 files, 548.08 seconds. All six failure names match those previously
  reproduced on the same base: Wrangler `/bin/bash` ENOENT, backend SIGTERM
  exit code 143 vs expected 0, and four site-build path assertions with Windows
  backslashes. Integration is not green; those failures remain unresolved.
  The eight optional cleanup-reconciliation skips require
  `NETWORK_RETRY_RECONCILIATION_TEST`. The integration run includes the security
  file list; it is not repeated.
- `bun run test:e2e`: 42 pass, 1 skip, 0 fail, 654 assertions, 99.06 seconds.
  The optional browser-SDK case requires `PLAYWRIGHT_MODULE`.
- Isolated combination with #362 at
  `2ca80935b43bac214caed1618b7e46be83068dcc`: both cancellation integration files
  pass, 2 tests and 69 assertions. A three-way source merge retains both changes.
  This checks those two workflows, not #362's broader draft qualification.
  This PR remains based directly on main and does not include #362.
- The full default simulation is not repeated. AGENTS.md permits one full run
  per agent, already used in this contribution session.

To reproduce the original defect, run this PR's new integration file with the
base `packages/sim/src/world.ts`. Expect all nine worlds to run and the final
comparison to reject the six false notice records. Restore the fixed runtime
and repeat; all 43 assertions pass.

## llm_evidence

N/A: this changes simulator event timing and bookkeeping, with no prompt,
provider, language-model judge or member-conversation change. Real-model calls:
0; cost: 0. No real-LLM qualification is claimed.

## agent_clients

Bun 1.4.2 on Windows x64, driven from Codex desktop 26.1029.7803.0. Authoring
provider: OpenAI; exact model identifier unavailable in this client. No
member-facing agent workflow changes. Other clients were not tested; no client
compatibility claim is made. GitHub operations used the connector and CLI,
without computer use.

The implementation and report were authored with AI assistance. The repository's
real harness generated the synthetic messages and measurements.
