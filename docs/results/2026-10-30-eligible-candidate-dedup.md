# Keep an eligible match when deduplicating participants

A below-threshold event can erase a valid introduction for the same two people. The engine deduplicates participant sets by raw score before selection. The event has a higher raw score but a higher threshold; neither configuration reaches selection as an eligible match. This fixes a reproduced matching defect under the approved scope, PRD 28.3 and the existing per-generator threshold contract in Section 33.

Prefer an eligible configuration over an ineligible one, then keep the existing score and key ordering within each class. Two alternatives were considered: keep all configurations until selection, which changes the deduplication and judge workload contract; or remove all ineligible candidates first, which removes the existing below-threshold exploration pool. The chosen ordering retains that pool when no eligible alternative exists.

## measurement

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Native Windows, Bun 1.4.2,
locked dependencies. Apply only the new integration file to the base for the
before run, then add the production fix. Same command in both runs:

```sh
bun test --conditions eliza-source packages/network/test/candidate-dedup.integration.test.ts
```

One real-engine integration runs seeds 1–3, confidence 0.1/0.5/1 and event absent/present: 18 cases. At confidence 0.5 the intro scores 0.304901 and clears its threshold; the event scores 0.325319 but misses its 0.4 threshold. Before, adding that event changes one valid proposal to zero in every seed. After, the intro survives. Low-confidence controls still produce zero proposals; high-confidence event controls still select the highest-scoring eligible event. The same command changes from 0 pass/1 fail to 1 pass/0 fail, with 42 assertions passing after. The fixture uses actual generators, scoring, deduplication and selection with default production config apart from the seed. It does not inject candidate scores, mock model responses or alter thresholds. These are deterministic assertions, not a statistical quality estimate.

## safety_gates

Both fixture members are adults with opt-ins and shareable evidence. Only candidates which pass the existing hard filters reach this ordering. The change cannot make an ineligible candidate eligible. The affected simulation (`bun run sim --only network`) passes 61/61 blocking gates with zero tracked off target. Its seed-3 invariant run and pooled seeds 1–3 consent arms have zero invariant violations, canary leaks and minor contacts. Local runtime was 316.6s; no speed or unchanged-aggregate claim is made. Existing budget, consent, review and explanation paths remain in force.

All four TypeScript configurations pass locally using the repository's compiler
under Bun's runtime. The fork's unmodified Ubuntu 24.04/PostgreSQL CI runs the
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
