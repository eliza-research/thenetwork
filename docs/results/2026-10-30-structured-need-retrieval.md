# Enable the existing structured need retrieval channel

Two members can fully satisfy each other's stated needs yet never reach scoring when their profile wording has low embedding similarity. Retrieval computes structured satisfaction and checks a 'need' channel, but never adds that channel. This fixes a reproduced matching defect under the approved scope and the existing needs-to-capabilities matching contract in PRD 33.4/33.5.

Add the existing need channel when the enabled complementarity calculation finds positive satisfaction. Keep the current semantic threshold, ranking, hard filters and scoring floors. Two alternatives were considered: lower the semantic threshold for everyone, which retrieves unrelated profiles; or add more wording aliases, which treats each paraphrase separately and still ignores known structured evidence. The existing channel already expresses the intended route.

## measurement

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Native Windows, Bun 1.4.2,
locked dependencies. Apply only the new integration file to the base for the
before run, then add the production fix. Same command in both runs:

```sh
bun test --conditions eliza-source packages/network/test/need.integration.test.ts
```

One actual-engine integration runs seeds 1–3 over reciprocal, complementarity-disabled, unrelated-skill, far-away and full-budget cases: 12/15 correct before, 15/15 after. The reciprocal fixture has a sailing instructor seeking ceramics and a pottery teacher seeking sailing. Their capability-text similarities are 0 and 0.009179, below the default 0.2 retrieval threshold; structured satisfaction is 1 in both directions. Before there are zero proposals; after there is one intro through the need channel, score 0.337852 above the unchanged 0.3 threshold. All twelve negative/control rows remain excluded. The test changes from 0 pass/1 fail to 1 pass/0 fail. It uses actual World indexing, default local embeddings, taxonomy, generators, scoring and global selection; no candidate or model response is mocked. No confidence interval or aggregate quality improvement is claimed for these deterministic cases.

## safety_gates

The new path only reaches normal scoring after existing member and pair filters. Cross-city candidates and members whose interruption budget is full remain excluded. Disabling complementarity retains the prior semantic-only behavior. The fixture uses shareable skills and adult members with opt-ins. Full per-app safety and quality gates are checked by hosted CI; no unchanged fingerprint is claimed for this retrieval change.

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
