# Keep plan eligibility and notification send windows intact

A full introduction budget hides later plan eligibility rules, allowing a member excluded by quota, decline cooldown or reliability state into a group. Checking those rules also exposed an existing notification defect: a request-retry notice can be sent at 08:05 and only afterwards be marked as unsolicited proactive outreach. This contribution keeps both constraints intact under the approved scope, PRD 33's eligibility rules and PRD 32.9's send-time controller.

After an allowed plan budget exception, continue the existing pure pack rules and return any non-exempt reason. Preserve the core prefix and host contribution limit. Classify unsolicited notices before choosing their send timing, so they use the existing interruption window. Two alternatives were considered: copy later eligibility checks into the planner, which drifts from pack rules; or remove the plan budget exemption, which charges the separate plan lane to introduction budgets. The timing correction reuses the shared send path and deferred queue without changing notification text or budgets.

## measurement

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Native Windows, Bun 1.4.2,
locked dependencies. Apply only the new integration file to the base for the
before run, then add the production fix. Same command in both runs:

```sh
bun test --conditions eliza-source --timeout 120000 packages/network/test/plan-budget.integration.test.ts packages/network/test/retry-notice-window.integration.test.ts
```

The planner integration runs seeds 1–3 over none/quota/cooldown/reliability states with and without a full introduction budget: 15/24 correct before, 24/24 after. Constrained members remain excluded from invitees and alternates, while five other adults retain a valid group; unrestricted budget controls still include all six. A second real ConsentNetwork integration runs seeds 1–3: a standing request retries, a human approves it, the requester confirms, and the candidate declines next day at 08:05 NY. Before the timing fix, the requester gets an unsolicited proactive notice before their send window. After, it stays deferred through JSON restart and sends exactly once in an allowed window. Both integrations pass together: 2 pass, 0 fail, 29 assertions. No eligibility or send decision is mocked. These are deterministic contracts, not a statistical quality claim.

## safety_gates

Core age, pause and hold checks still run first. Only the documented budget exceptions are skipped; quota, cooldown, reliability and host contribution limits retain their values. The first hosted attempt (5adace3) passed integration/e2e but failed one network send-window gate (329/330), exposing the late notification classification. This follow-up fixes that path with a separate failing-before regression. No gate, threshold or budget is relaxed. A new complete CI run checks the final source.

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
