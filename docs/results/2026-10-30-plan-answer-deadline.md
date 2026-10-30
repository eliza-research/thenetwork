# Enforce the plan deadline on the reply path

A member can complete a plan's quorum at or after its probe deadline if their
reply arrives before the next job tick. The inbound path calls
`recordPlanAnswer`, which only checked the member's answer state. The hourly
tick checked the deadline separately. This fixes a reproduced scheduling defect
under the approved scope, PRD F15 (cancel after the deadline) and the plan
deadline contract in Section 40.

Call the existing `checkPlanDeadline` before changing a pending answer on a
probing plan. This uses the same `now >= deadline` boundary as the tick path.
Booked plans still use their separate late-join cutoff. Two alternatives were
considered: advance all network timers on each inbound message, which changes
many unrelated flows; or duplicate expiry in the network reply handler, which
leaves other users of the shared plan state machine inconsistent.

## measurement

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Windows, Bun 1.4.2, locked
dependencies. Apply only the new integration file to the base for the before
run, then add the production line for the after run. Same command both times:

```sh
bun test --conditions eliza-source --timeout 120000 packages/network/test/plan-deadline.integration.test.ts
```

The hand-written Mini fixture drives the real ConsentNetwork, planner, engine,
human review, incoming replies, recording channel and JSON restart. Six adults
onboard. A planner item waits eleven hours for approval, within its review SLA.
All six receive probes. Two say yes. Restart, tick one minute before the actual
probe deadline, then deliver the third yes without an intervening tick.

Seeds 1–3 each run four cases: one millisecond before the deadline; exactly at
it; one millisecond after it; and an already-booked plan's valid late join.
This creates twelve independent workflow cases. Before, six pass: all exact
deadline and after-deadline replies incorrectly book. After, all twelve pass.
The before-deadline bookings and booked-plan joins still work in every seed.
The test command changes from 0 pass/1 fail to 1 pass/0 fail. This is a
deterministic boundary test; no statistical effect or hiring-quality claim.

## safety_gates

The fixture asserts no plan probe before human approval. Expired original plans
close without recording a meeting. The existing fallback handles the earlier
yeses; the late reply does not become new consent to that fallback. No timing
threshold or review/consent gate is weakened. No production data or live sends.

All four TypeScript configurations pass locally using the existing compiler
under Bun's runtime. The fork's unmodified Ubuntu 24.04/PostgreSQL CI is
dispatched for standard typechecks, full simulation, integration including
security, and e2e. Its result is linked in the PR; no local PostgreSQL or full
simulation result is claimed for this branch.

## llm_evidence

Zero validation model calls, US$0. The operator declined paid model tests. No
model-backed behavior is qualified. Draft pending the repository's required
real-model evidence and maintainer review.

## agent_clients

Authoring: Codex desktop, OpenAI `gpt-6.1-sol`, installed Windows app package
26.1027.3384.0. The deterministic harness drives the real workflow directly.
No acceptance run is claimed for Claude Code, Codex/ChatGPT's member flow,
Hermes Agent, OpenClaw, Muse, Grok bot, elizaOS or Cursor.
