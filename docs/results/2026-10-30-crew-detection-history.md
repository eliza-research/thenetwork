# Use recorded outcomes when applying the crew threshold

The supported crews.minPlans=2 setting never forms a crew after two successful meetings. The shared detector supports that criterion and its existing recurring-want exception, but the ConsentNetwork caller always passes only the current plan and an empty recurringWant list. This fixes a reproduced implementation defect under the approved scope and the existing recurring-crew contract in PRD 40 and docs/design/2026-10-07-experience-design.md Section 4.7. The default one-plan threshold stays unchanged.

Build outcome records from already stored, elapsed plans of the same activity and city, including the current plan. Pass current live recurring wants from the existing planning World. Reuse the shared detector and the existing crew/offer exclusion list; no new state or setting is introduced. Two alternatives were considered: lower minPlans to one for every caller, which ignores the configured criterion; or store a second feedback history table, which duplicates the opportunity outcomes already persisted through restarts.

## measurement

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Native Windows, Bun 1.4.2,
locked dependencies. Apply only the new integration file to the base for the
before run, then add the production fix. Same command in both runs:

```sh
bun test --conditions eliza-source --timeout 120000 packages/network/test/crew.integration.test.ts
```

The real ConsentNetwork integration drives natural planner output, human review, all consent replies, meeting times, actual post-plan feedback and JSON restarts. Seeds 1–3 cover the default one-plan threshold, minPlans=2 with only one non-recurring meeting, two qualifying meetings, insufficient common positive attendees, and the existing one-meeting recurring-want exception. Before: 9/15 correct; both qualifying minPlans=2 paths produce no crew offer. After: 15/15 correct. Default behavior still offers once; too little history and fewer than three common positive attendees still produce none. The same test command changes from 0 pass/1 fail to 1 pass/0 fail. No planner output, feedback decision or model response is mocked. These are deterministic workflow assertions, not a population-level retention estimate.

## safety_gates

Every original meeting requires human approval and fresh consent. A crew offer still requires the existing attendance and positive-feedback criteria, then the existing per-member crew opt-in. Future plans and crew-session plans are excluded from the evidence records. No safety or matching threshold changes. This is distinct from #221's attended-session handoff count and #200's Friends host selection.

All four TypeScript configurations pass locally using the repository compiler under Bun runtime.
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
