# Keep refused work modes out of job postings

Date: 2026-10-29. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Tested code: `e4783f29cd699651d81f1c8e2d2d85d92ebeeb8b`.

## Requirement and cause

Reproduced intake and matching defect under the approved contribution scope, PRD 40.2 and 40.6.
Peon matches a job's work mode against the candidate's stated modes and commute areas.

The posting parser searches for `remote` anywhere before trying `hybrid` or `onsite`.
It saves "hybrid in Brooklyn, not remote" as remote. The manager's read-back is wrong,
the confirmed job persists that value, and the review queue gets a remote-only candidate.
A correction saying "Actually hybrid in Brooklyn, not remote" repeats the same error.

Remove explicitly refused mode phrases from the text used only for mode selection.
Then use the existing mode parser. Title, area, pay, requirements and all other fields still read
the original text. The read-back and separate yes remain required. No new messages or model calls.

The bounded grammar covers `not`, `no`, `no longer`, `non-`, an optional `fully`, and mode lists
joined with `or` or `nor`. It preserves the existing positive mode spellings and precedence.

Alternatives considered:

1. Prefer onsite or hybrid ahead of remote. That still mistakes a refused word for a positive statement.
2. Use the last mode mention. That fails the common "hybrid, not remote" order.
3. Add an LLM reader. That adds a new path and cost for a deterministic local parsing defect.

## measurement

Paired command: `bun run sim --only peon,peon-seats --json <file>`.
One added gate exercises twelve conversations on seeds 7, 13 and 17.
The same gate runs separately on seeds 19 and 23 without tuning.

Each conversation uses the real ConsentNetwork with production Peon wiring, a verified adult manager,
and three adult candidates with identical qualifications except their work modes.
Candidate profile facets are synthetic fixtures. Only one candidate accepts each work mode.
The manager onboards, submits a job, receives a read-back, restarts and gives a separate yes.
Saved posting rows become a seat through `postingFacts` and `peonSeats`.
After another restart, the engine selects candidates into the human review queue.
The gate checks the read-back, stored mode, seat facet and exact queued candidate.
No review is approved and no candidate is contacted by the new gate.
Rows stay in the fixture across JSON restart, as documented by the existing SeatWorld helper;
this gate does not claim a new PostgreSQL persistence scenario.

| Input mode phrase | Expected | Before |
|---|---|---|
| hybrid in Brooklyn, not remote | hybrid | remote |
| not remote; hybrid in Brooklyn | hybrid | remote |
| onsite in Brooklyn, not hybrid | onsite | hybrid |
| not remote or hybrid; onsite in Brooklyn | onsite | remote |
| non-remote; onsite in Brooklyn | onsite | remote |
| no longer remote; hybrid in Brooklyn | hybrid | remote |
| not fully remote; hybrid in Brooklyn | hybrid | remote |
| remote, not onsite | remote | remote |
| hybrid in Brooklyn | hybrid | hybrid |
| onsite in Brooklyn | onsite | onsite |
| remote | remote | remote |
| Initial remote draft, then "Actually hybrid in Brooklyn, not remote." | hybrid | remote |

After the fix, all twelve inputs produce the expected read-back, stored mode, seat and review candidate.

| Metric | Before | After |
|---|---:|---:|
| Correct conversations, seeds 7/13/17 | 12/36 | 36/36 |
| Correct conversations, seeds 19/23 | 8/24 | 24/24 |
| Wrong work-mode candidates in review, all seeds | 40 | 0 |
| Blocking Peon + seat gates | 36/37 | 37/37 |
| Tracked misses | 0 | 0 |

All 37 other gate records are identical after removing runtime fields.
Fingerprint: `b7736da857812394`. Runtime: 27.4s before, 28.1s after.
The existing Peon comparison and conformance seeds remain unchanged.
These are deterministic regression results, not a measured hiring-rate improvement.

## safety_gates

Every existing blocking gate keeps its passing value: minors, holds, consent, review, leaks,
verified employers, pay ranges, protected attributes, seat capacity and hiring quality.
No thresholds change. Existing gates exercise the two-sided consent flow with simulated review.
The new gate stops at human review and uses only a recording channel.

Combined locally with the other 22 contributions: 40/40 affected gates,
all four typechecks pass, and all 38 common gate records match the isolated run.
Both the role-seniority regression and this work-mode regression are retained at their shared insertion point.
The combined branch stays local.

## Reproduce and validate

1. Check out base `a0ed7bc6495d9e524afc3d500738212a28dc7bc2` and load only `scripts/sim/peon-seats.ts` from `e4783f29cd699651d81f1c8e2d2d85d92ebeeb8b`.
2. Run `bun install --frozen-lockfile`, then `bun run sim --only peon,peon-seats`.
   Expect the new gate to fail: remote is stored where hybrid was stated.
3. Apply `packages/network/src/jobs.ts` from the code commit. Repeat the same command.
   Expect 37/37 blocking gates and all 36 conversations correct.
4. Change only the new gate's seeds to 19 and 23 to repeat the additional 24 conversations.
5. Run `bun run typecheck`, `bun run test:integration` and `bun run test:e2e`.

Windows, Bun 1.4.2, PostgreSQL 16.15 on 127.0.0.1:54339. `USER=postgres`, `REQUIRE_PG=1`;
`PG_BIN_DIR` and `OBSERVATORY_PG_DIR` use the local installation, with Git Bash on PATH.
All four typecheck configurations pass.

- Integration: **675 pass, 8 skip, 6 fail**, 13741 assertions, 600.34s.
- All eleven security-command files ran within integration.
- Six failures match the established Windows baseline: absolute `/bin/bash` missing,
  SIGTERM 143 versus 0, and four path-separator assertions. Integration is not claimed green.
- Eight integration skips require the opt-in retry reconciliation setting.
- E2E: **42 pass, 1 skip, 0 fail**, 654 assertions, 84.76s.
  The optional recovery-feedback browser test requires unconfigured `PLAYWRIGHT_MODULE`.

The full simulation allowance was used for PR #136. Affected blocks are used here.
Draft pending maintainer Linux CI.

## llm_evidence

Rules-only posting intake. Zero validation model calls, $0. No model-backed behavior changed.
No LLM credentials were available; no model-quality claim.

## agent_clients

The production backend flow is exercised directly. External agent clients were not tested.
Authoring: Codex desktop, OpenAI `gpt-6-astra`, identified by the operator.

## Limits

No migration of existing postings. The parser does not infer an affirmative mode from a refusal alone;
the existing draft/default behavior still applies when no positive mode is supplied.
Other negation forms and ambiguous alternatives remain outside this bounded grammar.
No copy template, UI, client contract, scoring rule or safety threshold changes.
No real messages, deployment or hiring outcome claim.
