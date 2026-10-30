# Use profile evidence only within its valid interval

A member request can match someone on a skill that expired or does not take effect until tomorrow. The request path's knownProfiles reader consumes all snapshot facets while the normal engine already respects their validFrom and validTo interval. This fixes a reproduced request-matching defect under the approved scope and the profile validity contract in PRD 13.1/32.4.

Apply the same two interval checks in the existing profile reader, before using skill or interest tags as evidence. Preserve undated facets and inclusive start/end boundaries. Two alternatives were considered: filter the whole shared snapshot, which affects unrelated consumers; or discard invalid matches after request selection, which lets stale evidence influence ranking first. Filter at this reader's evidence boundary instead. Existing learned profile state is unchanged.

## measurement

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Native Windows, Bun 1.4.2,
locked dependencies. Apply only the new integration file to the base for the
before run, then add the production fix. Same command in both runs:

```sh
bun test --conditions eliza-source packages/network/test/request-facet-validity.integration.test.ts
```

The real ConsentNetwork integration onboards two adults, restarts from JSON and makes a founder request whose only suitable capability is the other member's design skill. Seeds 1–3 cover expired, future, active, undated, exact-start and exact-end facets: 18 cases. Before, the request incorrectly queues the expired and future skill holder for review; the test fails. After, all 18 cases and 36 assertions pass. The four valid-interval controls still queue one review item in each seed; invalid evidence queues none. No probe is sent before approval. This is actual request matching and review with the public profile snapshot and local recording channel, not a mocked matching result. These are deterministic interval assertions; no aggregate quality estimate is made.

## safety_gates

Visibility, inference-confirmation, opt-in and review checks remain in force. No profile is widened or deleted. This is distinct from #178's attention availability-facet reader: it fixes skill and interest evidence in member-request matching and does not modify the snapshot or availability planner.

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
