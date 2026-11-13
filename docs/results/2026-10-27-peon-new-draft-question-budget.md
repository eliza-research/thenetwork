# Keep clarification counts with their posting draft

## Result and scope

After Peon has asked two questions about an unfinished job posting, starting a different job without a pay range immediately drops the new draft. The new posting inherits the abandoned draft's question count. The fix lets a replacement posting ask for its own missing fields while retaining the existing limit for a continued draft.

This is the existing Peon posting workflow under PRD 40.6 and `docs/network.md` section 1.4. `PostingDraft.asks` is explicitly defined as questions asked for that draft. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Implementation: `cf74224680060b0c1828a653e4133f1d31f5a873`. The branch is independent of the preceding posting fixes.

## Cause and implementation

`readPostingText` creates a fresh draft for a new posting command and carries the existing draft forward for ordinary corrections. `postingTurn` ignores that distinction when calculating the next question count: it reads from the old `waiting` draft even when intake has returned a different draft. A new job needing its first question is therefore counted as question three and discarded.

Read the prior count from `step.draft.asks`, the draft returned by intake. New postings start without the old count; continued drafts retain it. The increment, two-question threshold, missing-field checks, read-back and separate confirmation remain unchanged. No schema, copy template or client protocol change.

Alternatives considered:

- Detect new commands again inside `postingTurn` and reset the count there. This duplicates the intake parser's distinction between new postings, updates and corrections.
- Compare old and new draft IDs. Some clarification drafts have no selected posting ID yet, so identity is weaker than the counter already carried on the returned draft. Using that counter keeps state ownership at the intake boundary.

## measurement

One database-backed integration case uses the actual signed inbound handler, NetworkService, ConsentNetwork posting intake, persisted state and Postgres posting rows. Network seed 1, five synthetic adult managers, reserved fictional phone numbers and dry-run delivery.

Each manager starts an incomplete posting with two openings and $90k-$120k pay but no title. The service asks for the title. A work-mode correction leaves the title missing and causes the second question. No posting is saved. The service then restarts with these drafts and counters persisted.

Three managers replace the draft with a new barista, cashier or cook posting, each with one opening and no pay. They should receive the pay question, supply $40k-$50k, receive a read-back and separately confirm after another restart.

| Replacement job | Before: asks for pay, reads back and saves after yes | After |
|---|---|---|
| Barista | false | true |
| Cashier | false | true |
| Cook | false | true |

Completed replacement conversations improve from **0/3 to 3/3**. No posting exists before confirmation. Saved rows contain one opening and the new $40k-$50k salary; they do not inherit the old $90k-$120k range.

Controls pass before and after:

- A fourth manager continues the original unfinished draft after both restarts. A third clarification attempt drops it at the existing limit and saves nothing.
- A fifth manager replaces the draft with a complete designer posting. It is read back and saved only after a separate yes, as before.

Same command and fixture before and after:

```sh
REQUIRE_PG=1 bun test --conditions eliza-source --timeout 120000 packages/network/test/peon-postings.integration.test.ts
```

- Before: **1 pass, 1 fail**, 94 assertions, 6.72 seconds. All three replacement flows fail; the controls and existing posting case pass.
- After: **2 pass, 0 fail**, 100 assertions, 7.02 seconds. The additional assertions check newly saved posting tags.
- One production implementation; no fixture, expectation or threshold changes after reproducing the failure.

Affected simulation command, identical before and after:

```sh
bun run sim --only peon,peon-seats
```

**36/36 blocking gates pass** before (35.5 seconds) and after (35.7 seconds). All **37 gate records are identical excluding runtime**, including the pack/keyword/oracle fingerprint `b7736da857812394`. The official comparison remains seeds 13-16, eight weeks, 400 candidates and 80 jobs per city. No matching-quality or speed improvement is claimed. The one-full-simulation-per-agent allowance was used for #136, so only affected blocks were rerun.

Additional validation:

- `bun run typecheck`: all four configurations pass.
- `REQUIRE_PG=1 bun run test:integration`, including security files: **676 pass, 8 skip, 6 fail**, 13,809 assertions across 690 tests in 68 files; 611.49 seconds. The failures match pristine main on Windows: an absolute `/bin/bash` requirement, SIGTERM exit status, and four site path-separator comparisons. Eight skips require the separately enabled retry-reconciliation suite.
- `REQUIRE_PG=1 bun run test:e2e`: **42 pass, 1 optional skip, 0 fail**, 654 assertions across 43 tests in 3 files; 133.71 seconds.
- Combined with the preceding fifteen contribution PRs: all four typecheck configurations, **10/10 job-seat gates** and **7/7 posting integration cases** pass (339 assertions, 34.40 seconds). The combination retains partial updates, headcount reopening, revision metadata, optional-skill handling, direct title answers, overlapping title selection and per-draft question counts. The shared test insertion conflict retained all prior cases. Production changes applied without conflict or additional adjustment.

## safety_gates

The two-question limit still applies to a continued draft, including after restart. Existing age, consent, confirmation, block, review and leak gates retain their passing values. A new posting is never saved directly by this change; the manager must confirm its read-back. Synthetic data and dry-run delivery only, with no live sends or deployment.

## llm_evidence and agent_clients

Deterministic draft state and persisted service behavior: zero validation model calls and $0 model cost. No model-backed behavior changed. No real-client acceptance run is claimed for Claude Code, Codex/ChatGPT, Hermes Agent, OpenClaw, Muse, Grok bot, elizaOS or Cursor. The actual inbound service path is covered directly.

Authoring: OpenAI / `gpt-6-astra`, identified by the operator; Codex desktop `26.1021.3705.0`. Validation: Windows, Bun 1.4.2, TypeScript 5.9.3, PostgreSQL 16.15 on local port 54339, frozen-lockfile dependencies.

## Limits

This keeps the existing per-draft limit and existing intake semantics. It does not recover a draft already discarded before the fix, expand posting-command grammar, or change general conversational budgets. Linux CI remains required before merge.
