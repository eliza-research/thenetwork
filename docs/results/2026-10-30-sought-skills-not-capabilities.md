# Keep sought skills out of the member's capabilities

Onboarding 'I need a product designer' records design as the member's own skill. Another member's founder request then produces an incorrect match with that person. The lexical skill pass checks first-person attribution and seeking context, but the later taxonomy-label fallback adds any matching skill phrase without those checks. This fixes a reproduced matching defect under the approved scope and PRD 32.1/32.4, which require member-stated profile evidence.

Move the taxonomy skill-label fallback into the existing clause loop and apply its seeking and negation checks there. Keep first-person skill statements and bare taxonomy labels, which the existing biography generator emits as separate sentences. Two alternatives were considered: remove the fallback, which loses those valid biography skills; or filter false capabilities at request matching, which leaves incorrect profile data in other paths. Correct the shared extraction path instead.

## measurement

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Native Windows, Bun 1.4.2,
locked dependencies. Apply only the new integration file to the base for the
before run, then add the production fix. Same command in both runs:

```sh
bun test --conditions eliza-source packages/network/test/sought-skills.integration.test.ts
```

The real ConsentNetwork integration onboards two adults, restarts from JSON, inspects the actual engine snapshot and makes a member request through the normal review queue. Seeds 1–3 cover seven statements: sought designer, own designer, sought bass player, own bass player, two bare skill labels and an unrelated statement. Before, sought skills become own skills and create incorrect review items; the added test fails. After, all 21 cases and 84 assertions pass. Genuine first-person and bare-label controls still produce a reviewed candidate; sought and unrelated statements do not. No probe is sent before review. The unchanged evals block passes 25/25 gates before and after with identical results apart from runtime (0.5s/0.4s). The fixture uses real onboarding, extraction, persistence/restart, request matching and review; no model output or matching decision is mocked. No statistical quality claim is made.

## safety_gates

The existing consent, abuse, teen-age, negated-want, opt-out and leak corpora all retain their results. This changes only attribution of an ordinary skill statement. It adds no skill, preference or matching feature and changes no member-facing text.

The local TypeScript attempt terminated without diagnostics under host memory pressure; it is not counted as a pass. Standard typechecks run in fork CI.
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
