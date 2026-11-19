# Retain mutual repeat interest until both members are eligible

After two members say they would meet again, a temporary pause silently deletes that mutual interest. The local encounter loop consumes the stored pair before checking whether both members are currently eligible. Resuming later cannot recover the second encounter. This fixes a reproduced feedback-to-matching defect under the approved scope and PRD F19/32.13.

Consume the mutual-interest entry only after both members pass the existing eligibility check. Keep paused members excluded and persist the entry through the existing JSON state. Two alternatives were considered: reconstruct interest from historical feedback on every tick, which adds a separate recovery mechanism; or queue a proposal while paused, which changes when review work is created. Moving the existing consumption point preserves both eligibility and one-time submission.

## measurement

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Native Windows, Bun 1.4.2,
locked dependencies. Apply only the new integration file to the base for the
before run, then add the production fix. Same command in both runs:

```sh
bun test --conditions eliza-source --timeout 120000 packages/network/test/second-encounter-resume.integration.test.ts
```

One real ConsentNetwork integration drives the original introduction, both yeses, booking, meeting time, mutual positive check-in feedback and JSON restarts. Seeds 1–3 each run pause/resume and unpaused controls. Before, the pause case loses the saved mutual entry and produces no repeat after resume; the added test fails. After, all six cases and 33 assertions pass. Paused members receive no new probe, the saved interest survives restart, resume queues exactly one second_encounter, and the entry is then consumed. The unpaused control still queues once. The original meeting uses the repository's simulated auto-reviewer, which is disclosed; no live member or model response is used. These are deterministic workflow assertions, not a statistical quality claim.

## safety_gates

The eligibility check runs before consuming or proposing the pair. No contact occurs during the pause, and the new opportunity still follows the existing review and consent path. This is distinct from #239's ordinary positive-feedback history mapping and engine second-encounter exclusion: this change covers the existing explicit mutual 'meet again' path and its temporary eligibility state.

Standard typechecks run in the fork CI. Local checking is limited by host memory pressure; only a completed compiler result is counted.
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
