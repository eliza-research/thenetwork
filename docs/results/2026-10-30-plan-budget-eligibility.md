# Continue plan eligibility checks after an allowed budget exception

A member excluded from a group plan by their category quota, decline cooldown or reliability state becomes eligible when their introduction budget is full. The shared member checker returns its first reason; planMemberReason treats an introduction-budget reason as unconditional acceptance, hiding the later pack rules. This fixes a reproduced planner defect under the approved scope and PRD 33's eligibility and capacity rules. Plans keep their existing separate send-time allowance.

When the first reason is an allowed plan budget exception, continue the existing pure pack-rule checks and return any non-exempt reason. Preserve the immutable core prefix and the host contribution limit. Two alternatives were considered: copy quota/cooldown/reliability checks into the planner, which drifts from pack rules; or remove the plan budget exemption, which incorrectly charges the separate plan lane to introduction budgets. Reusing the pack checks retains the intended allowance without hiding later constraints.

## measurement

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Native Windows, Bun 1.4.2,
locked dependencies. Apply only the new integration file to the base for the
before run, then add the production fix. Same command in both runs:

```sh
bun test --conditions eliza-source packages/network/test/plan-budget.integration.test.ts
```

The actual World and shared group planner run seeds 1–3 over four member states (none, zero social quota, recent social decline, reliability hold-out), each with and without a full introduction budget: 24 cases. Before, 15/24 are correct; all nine constrained/full-budget cases incorrectly include the member in the six-person plan. After, 24/24 are correct. The constrained member stays excluded from invitees and alternates; the other five adults still have a valid group. Unrestricted members remain eligible in both budget controls. The same integration command changes from 0 pass/1 fail to 1 pass/0 fail. It uses stated standing windows, a public venue and the real World, eligibility rules, group composition and plan scoring. No planner decision or model response is mocked. No statistical quality estimate is claimed.

## safety_gates

Core age, pause and hold checks still run first. A budget exception is the only reason skipped; quota, cooldown and reliability rules retain their configured values. A host's contribution limit remains blocking. No review, consent, budget value or safety gate changes.

Standard typechecks run in fork CI. A local attempt did not return a final compiler status and is not counted as a pass.
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
