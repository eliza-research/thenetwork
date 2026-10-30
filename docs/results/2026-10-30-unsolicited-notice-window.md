# Choose the send window after classifying unsolicited notices

A request-retry notice reaches an open member at 08:05, then is marked as unsolicited proactive outreach. The send path selects logistics timing before it decides whether the notice is unsolicited, so the proactive notice misses the interruption window check. This fixes a reproduced send-time defect under the approved scope and PRD 32.9's existing outreach controller.

Compute the existing unsolicited classification before choosing timing and pass that result to the existing interruption-window policy. Keep the budgets, recipient checks, reply exemption and deferred queue. Two alternatives were considered: patch only the retry-close caller, which leaves the shared ordering error in other notices; or refuse notices outside the window, which drops a valid update. Reuse the existing deferred-send path so it survives a restart and is checked again at delivery.

## measurement

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Native Windows, Bun 1.4.2,
locked dependencies. Apply only the new integration file to the base for the
before run, then add the production fix. Same command in both runs:

```sh
bun test --conditions eliza-source --timeout 120000 packages/network/test/retry-notice-window.integration.test.ts
```

One real ConsentNetwork integration runs seeds 1–3. A standing climbing request retries after a suitable person joins. A human approves it, the requester confirms, and the candidate declines next day at 08:05 New York, outside the requester's quiet hours but before their send window. Before, the unsolicited proactive notice sends immediately and the regression fails. After, all three flows and 27 assertions pass: no early notice, deferred state survives JSON restart, and exactly one notice is delivered in an allowed window. The original plan-budget experiment is absent from this final fixture and source diff. No send decision or model response is mocked. These are deterministic workflow assertions, not a statistical quality estimate.

## safety_gates

Recipient checks, state budget, reserved opportunity slot, unanswered limits, quiet hours, human review and consent retain their configured values. Direct replies remain immediate. The earlier plan-budget implementation passed its narrow regression but failed full CI, first on notification timing and then on a refusal/re-probe audit. That broader implementation and its test/report are fully reverted. The final source change is only the shared notification timing correction. A fresh complete CI run checks this source.

All four TypeScript configurations pass locally using the existing compiler under Bun runtime.
The fork's unmodified Ubuntu 24.04/PostgreSQL CI runs the
standard typecheck, full simulation, integration including security, and e2e
commands. Its result is linked in the PR. No local PostgreSQL or full-simulation
pass is claimed for this branch. No safety rule, threshold or gate is relaxed.

## llm_evidence

Zero validation model calls and US$0. The operator declined paid model tests.
No model-backed behavior is qualified. Draft pending the required real-model
evidence and maintainer review.

## agent_clients

Authoring: Codex desktop, OpenAI `gpt-6.1-sol`, installed Windows app package
26.1027.3384.0. No member-flow acceptance run is claimed for Claude Code,
Codex/ChatGPT, Hermes Agent, OpenClaw, Muse, Grok bot, elizaOS or Cursor.
Only synthetic data and local recording channels are used; no live sends or
deployment occur.
