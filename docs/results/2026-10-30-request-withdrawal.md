# Stop a withdrawn request and allow a later fresh ask

A member explicitly says they no longer want a climbing partner, but their waiting request remains live. After another member joins, daily retry creates a new match for that withdrawn request. Profile learning deletes the learned want without closing its outstanding search. This fixes a reproduced request-lifecycle defect under the approved scope and PRD F9's existing ability to close an intent.

Close matching waiting and probing requests when the existing profile reader recognizes an explicit withdrawal. End an associated review/probe opportunity through the existing close path. Persist a small withdrawal marker in the existing request JSON so a later explicit ask starts a fresh request without changing the two-refusal policy. Two alternatives were considered: leave the request live and ask for consent again whenever it finds someone, which keeps an explicitly closed search running; or delete request history, which loses its audit record. Keep the record and end automatic work on it.

## measurement

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Native Windows, Bun 1.4.2,
locked dependencies. Apply only the new integration file to the base for the
before run, then add the production fix. Same command in both runs:

```sh
bun test --conditions eliza-source --timeout 120000 packages/network/test/request-withdrawal.integration.test.ts
```

One real ConsentNetwork integration runs seeds 1–3 over waiting-request withdrawal, unchanged request, an unrelated-want correction, a later fresh ask, and withdrawal while the match awaits human review: 15 cases. It drives actual onboarding, member requests, MCP-source profile correction, a later member joining, two days of daily ticks, review and JSON restarts. Before, the waiting-request withdrawal test fails because the original request remains open and retries. After, all 15 cases and 120 assertions pass. Withdrawn requests do not retry or produce probes; ordinary and unrelated-want controls still find a candidate; a fresh explicit ask creates a new request. A withdrawn review item can no longer be approved. No model response or search decision is mocked. These are deterministic workflow assertions, not a statistical matching-quality estimate.

## safety_gates

Human review still precedes contact. Existing booked/fulfilled requests are outside this waiting/probing change. No stored member text, schema migration, live send, threshold or consent rule changes. Earlier draft experiment 570035f enabled a retrieval channel and failed the trust gate (329/330); historical design records also show that channel was intentionally off by default. That experiment and its test/report are reverted from the final diff. The retained final change is this request lifecycle fix.

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
