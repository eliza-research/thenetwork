# Bound a plan's group size by its public venue capacity

The shared planner can place a six-person group at a public venue with capacity zero, one or three. Venue.capacity is part of the existing public-place contract, but the planner copies only the name, area, age and price; only event capacity reaches the group-size bound. This fixes a reproduced planning defect under the approved scope and PRD 33's capacity constraints, using the same per-plan capacity semantics already applied to events.

Retain capacity on the chosen venue, exclude venues too small even for an activity partner, and apply it through the existing group/partner bound. Preserve each activity's own minimum size. Two alternatives were considered: truncate invitees after composition, which invalidates scores and quorum; or duplicate event/venue composition branches, which makes the same capacity rule drift. Use the existing shared bound instead.

## measurement

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Native Windows, Bun 1.4.2,
locked dependencies. Apply only the new integration file to the base for the
before run, then add the production fix. Same command in both runs:

```sh
bun test --conditions eliza-source packages/network/test/plan-venue-capacity.integration.test.ts
```

One actual-World/shared-planner integration runs seeds 1–3, board-game groups and tennis partner/group plans, with capacities 0/1/2/3/4/6/unspecified: 42 cases. Before, a zero-capacity venue still yields a group and the regression fails. After, all 42 cases and 186 assertions pass. Zero/one capacity yields no plan; board games retain their minimum of three; tennis can use its existing two-person fallback. Every emitted group's invited count and maximum size fit the venue bound. Unspecified capacity keeps the prior behavior. The fixture uses actual indexing, availability, activity fitting, group/partner search, scoring and global plan selection with synthetic adults and a public venue; no result is mocked. This tests per-plan group bounds, not ticket inventory, external booking or aggregate venue reservations.

## safety_gates

Age, member/pair filters, availability, public-place rules, quorum, review and consent paths are retained. No threshold or capacity is raised. The default venue tables do not gain any new field or value; unspecified capacity stays unbounded as before. No statistical outcome improvement is claimed.

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
