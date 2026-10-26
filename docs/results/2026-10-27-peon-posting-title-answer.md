# Accept direct answers to the Peon posting title question

## Result and scope

When a hiring manager starts a posting without a title, Peon asks "What's the job title?" A direct answer such as "Data analyst" currently abandons the draft, while "Senior data analyst" asks for the title again. Only an answer with a field marker, such as "title: Data analyst", succeeds. The fix accepts a direct answer in this missing-title context, then uses the existing read-back and explicit confirmation before saving.

This is the existing Peon local-pilot posting flow under PRD 40.6 and `docs/network.md` section 1.4, which explicitly requires asking for a missing title or pay range. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Implementation: `e166fb7020d7f82133fb995fe139abd5d9547c77`. The branch is independent of the preceding posting fixes.

## Cause and implementation

`readPostingText` sends the same context-free field parser every message. That parser expects a marker such as "hiring", "role" or "title" before a title. A bare title therefore has no parsed fields, and the caller clears the waiting draft. A title containing "Senior" supplies only seniority, leaving the title missing.

When a draft is waiting for its title and the reply is not a new command or an explicit field-marked title, reuse the existing title parser with a `title:` prefix. The fallback runs only when no other field was read, except seniority, and core's shared `parseReply` reports no reply signal. This keeps yes/no answers, uncertainty, questions and recognized pay/work-mode replies out of the fallback. The read-back, confirmation, posting validation and persistence paths remain unchanged.

Alternatives considered:

- Treat every unlabelled message as a title inside `parsePosting`. That parser also handles complete posting commands and later field corrections; it lacks the question context needed to avoid inventing a title there.
- Copy the raw answer into the draft or add a separate title grammar. This either bypasses the existing parser's title rules or creates a second set to keep synchronized. Reusing the existing rule keeps the grammar and normalization consistent.

## measurement

One new database-backed integration case uses the actual signed inbound handler, NetworkService, ConsentNetwork posting intake, Postgres rows and snapshot projection. Dry-run delivery, synthetic adults and reserved fictional phone numbers only. Network seed 1; one fixed conversation per title, no statistical quality claim.

Four managers start with:

```
Job posting: 2 openings, $90k-$120k, hybrid in Brooklyn, must have SQL
```

All four receive the title question, with no saved posting. The service restarts while the drafts wait. Each manager then sends the answer below and separately confirms with "yes". Another restart verifies saved titles and the original openings, pay, mode, area and required skill through real persisted rows and the projected job seat.

| Answer to the title question | Before: read back and saved after yes | After |
|---|---|---|
| Data analyst | false | true |
| Senior data analyst | false | true |
| C++ developer | false | true |
| title: Data analyst (existing supported form) | true | true |

Direct-answer success: **0/3 -> 3/3**. The field-marked control remains **1/1**. Seniority 3 is retained for the senior role. The test also verifies nothing is saved before each separate confirmation.

Negative/context controls use independent managers: a bare title outside any posting intake starts no posting; "yes", "no", "not sure", "How does this work?", "$100k-$140k" and "hybrid" in response to the title question do not become titles or save a posting. All controls pass before and after.

Same command and final fixture before and after:

```sh
REQUIRE_PG=1 bun test --conditions eliza-source --timeout 120000 packages/network/test/peon-postings.integration.test.ts
```

- Before: **1 pass, 1 fail**, 123 assertions, 6.54 seconds. The new regression fails; the existing posting case passes.
- After: **2 pass, 0 fail**, 145 assertions, 6.69 seconds. Additional assertions exercise the newly saved rows and seat projection.
- One production implementation. The initial test fixture reused a manager across negative cases and reached the existing two-question limit (1 pass, 1 fail, 6.88 seconds); those independent conversations were separated before the baseline above. No expected outcome or production threshold was changed.

Affected simulation command, identical before and after:

```sh
bun run sim --only peon,peon-seats
```

**36/36 blocking gates pass** before (30.8 seconds) and after (35.4 seconds). All **37 gate records are identical excluding runtime**, including the pack/keyword/oracle fingerprint `b7736da857812394`. The official comparison remains seeds 13-16, eight weeks, 400 candidates and 80 jobs per city for pack, keyword and oracle arms. Settings and thresholds are unchanged; no matching-quality or speed improvement is claimed. The one-full-simulation-per-agent allowance was already used for #136, so only affected blocks were rerun.

Additional validation:

- `bun run typecheck`: all four configurations pass.
- `REQUIRE_PG=1 bun run test:integration`, including the security files: **676 pass, 8 skip, 6 fail**, 13,854 assertions across 690 tests in 68 files; 601.43 seconds. The failures match pristine main on Windows: an absolute `/bin/bash` requirement, SIGTERM exit status, and four site path-separator comparisons. Eight skips require the separately enabled retry-reconciliation suite.
- `REQUIRE_PG=1 bun run test:e2e`: **42 pass, 1 optional skip, 0 fail**, 654 assertions across 43 tests in 3 files; 122.61 seconds.
- Combined with the preceding thirteen contribution PRs: all four typecheck configurations, **10/10 job-seat gates** and **5/5 posting integration cases** pass (222 assertions, 36.94 seconds). The combination retains partial updates, headcount reopening, revision metadata, optional-skill handling and direct title answers. Context conflicts were resolved by retaining the earlier mutable draft base and all prior tests; no behavioral compatibility adjustment was needed.

## safety_gates

Existing age, confirmation, consent, block, review and leak gates retain their passing values. Posting still requires the manager's separate yes after a read-back; this fallback never saves directly. No live sends, deployment or model-backed behavior changes.

## llm_evidence and agent_clients

Deterministic intake parsing and persisted service behavior: zero validation model calls and $0 model cost. No real-client acceptance run is claimed for Claude Code, Codex/ChatGPT, Hermes Agent, OpenClaw, Muse, Grok bot, elizaOS or Cursor. The actual inbound service path is tested directly; no client protocol or copy template is changed.

Authoring: OpenAI / `gpt-6-astra`, identified by the operator; Codex desktop `26.1021.3705.0`. Validation: Windows, Bun 1.4.2, TypeScript 5.9.3, PostgreSQL 16.15 on local port 54339, frozen-lockfile dependencies.

## Limits

This is contextual reuse of the existing title grammar, not unrestricted natural-language title extraction. Titles that look like another posting field or a conversational reply may still require the explicit `title:` form. No stored draft migration or matching-policy change is included. Linux CI remains required before merge.
