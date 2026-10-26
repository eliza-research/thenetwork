# Attach unprompted feedback to the latest meeting

## Requirement and cause

PRD 32.13 and F19 require feedback to update the relevant interaction and pair.
`feedbackDue` already promises the most recent eligible meeting. On base
`a0ed7bc6495d9e524afc3d500738212a28dc7bc2`, it instead takes the last eligible
opportunity in insertion order.

Invitation order and meeting order can differ. A member who sends unsolicited
feedback can therefore have it saved about the wrong person. Reordering stored
opportunities changes the result, despite identical participants and meeting times.

Filter with the existing eligibility rules, then sort by meeting time descending.
The existing reverse insertion order remains the tie-breaker for equal meeting
times. Explicit replies to a particular feedback question keep their existing route.

Alternatives:

1. Sort by invitation creation time. This still selects the wrong meeting when bookings occur out of order.
2. Change storage order or keep a separate latest-meeting pointer. This couples routing to persistence and introduces extra state to maintain.

## measurement

Same command before and after:

```sh
bun test --conditions eliza-source packages/network/test/feedback-order.integration.test.ts
```

The integration case uses the real `ConsentNetwork`, inbound classifier, scheduling,
feedback handler and JSON state restoration. Its recording channel sends nothing
externally. Three fictional adults finish onboarding. A real booked opportunity
supplies the template for two restored, synthetic completed bookings.

The first invitation was created six days ago and met yesterday. The second was
created five days ago and met four days ago. Both remain inside the existing
seven-day feedback window. There is no active feedback prompt.

The same reply, "It was great, we really clicked. Would do it again.", enters
through `onInbound`. Replay both storage orders. Restart between replies and
check that the latest meeting receives the first reply, the earlier meeting
receives the second, and a third reply adds no duplicate feedback.

| Check | Before | After |
|---|---:|---:|
| Storage orders choosing the correct latest meeting | 1/2 | 2/2 |
| Integration regression | 0 pass, 1 fail | 1 pass, 0 fail |
| After assertions | N/A: fails at first association | 8 pass |

The before failure saves feedback about `c` against `created-last-met-earlier`.
The expected target is `b`, in `created-first-met-latest`. The separate replay
ran both storage orders before the fix; the failing test stops on its first case.

A control sets the member's active feedback prompt to the earlier meeting.
Both storage orders still attach that reply to the earlier meeting. To repeat
this control, set that member's restored `awaiting` to
`{ kind: "feedback", oppId: "created-last-met-earlier", at: now }`.

The fixture is hand-written, with the Mini harness's fixed seed 1. This measures
deterministic association correctness, not a statistical outcome improvement.
Only one implementation was attempted. No matching thresholds were tuned.

## safety_gates and simulations

Same simulation command before and after:

```sh
bun run sim --only network,slop --json feedback-order.json
```

Network: the existing NYC corpus, invariant run seed 3 over ten days, comparison
seeds 1–3 over 21 days, and the repository scenarios. Review is simulated.
Slop: seeds 13–16, four weeks, 300 people per city; the existing ratings and
no-probe-photo settings. Its service arm uses seeds 21–22, 30 days and 80 people,
with simulated approval of every reviewed item.

Both runs pass 100/100 blocking gates: Network 61/61, Slop 39/39. All 120 gate
values and fingerprints remain identical, excluding runtime. The eight existing
tracked misses remain unchanged. Network and Slop-service invariant violations,
minor contacts, canary leaks and errors remain zero.

Runtime was 204.9 seconds before and 224.4 seconds after. The after run shared
the machine with integration tests; this is not a performance comparison.

The adult, participation, completed-meeting, unanswered-feedback and seven-day
eligibility checks are unchanged. No score, pacing, review or send policy changes.

## Validation

Windows, Bun 1.4.2, frozen lockfile, PostgreSQL 16.15 on loopback port 54339.
Database commands use `USER=postgres`, `REQUIRE_PG=1` and the local `PG_BIN_DIR`.

- Focused integration case: one pass, zero failures, eight assertions.
- `bun run typecheck`: all four configurations pass.
- `bun run test:integration`, including security: 676 pass, 8 skip, 6 fail;
  13,749 assertions across 69 files; 579.32 seconds.
- `bun run test:e2e`: 42 pass, one optional skip, zero failures;
  654 assertions; 81.08 seconds.

The eight skips require the separate cleanup-reconciliation opt-in. The six
failures reproduce the known Windows limits: absolute `/bin/bash` in
`deploy/wrangler.integration.test.ts`, SIGTERM exit 143 instead of 0 in
`deploy/backend/backend.test.ts`, and four slash-versus-backslash assertions in
`sites/test/sites.test.ts`. These files are unchanged. Integration is not claimed to pass.

AGENTS.md permits one full simulation per agent. That run was already used for
#136. The two affected conversation simulations were rerun here. Linux CI must
still run the full matrix. This PR stays draft pending CI.

## llm_evidence and agent_clients

No model-backed behavior, prompt or client protocol changes. Zero validation
model calls and cost. The integration drives deterministic inbound conversation
handling; no external agent-client acceptance run is claimed. Authoring: Codex
desktop 26.1021.3705.0, OpenAI `gpt-6-astra`, operator-identified.

## Reproduce and limits

Install with `bun install --frozen-lockfile`, then run the integration command.
Expect one passing case. Apply only that case to base `a0ed7bc`; it fails on
the first saved feedback association. The broader commands are listed above.

The existing policy still infers the most recent eligible meeting for unprompted
feedback. This change does not add named-meeting disambiguation or repair past
feedback records. No UI, member copy, dependency or stored schema changes.
