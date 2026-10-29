# Read job-post corrections back before saving

Date: 2026-10-29. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Tested code: `24c0a32ef7eddef58f2521a9c24d6b4f3b308d7e`. Combined code: `bd757f206932d161499220845f9294f22f4e11ac`.

## Requirement and cause

PRD 40.6 covers job postings and hiring-manager decisions. `docs/network.md` 1.4
says that details correct the pending draft and the manager confirms the
read-back before it is saved. The current read-back also invites corrections.

Start a data-analyst draft with two openings, $90k-$120k, hybrid in Brooklyn,
requiring SQL. At its read-back:

- `No, make it remote` drops the draft. No posting can be saved by the next yes.
- `Yes, make it remote` saves the old hybrid draft immediately.
- `Yes, $100k-$130k` likewise saves the old pay range.

`postingTurn` handles yes/no before it reads posting fields. Its refusal branch
makes an exception for digits or a dollar sign, so a numeric pay correction can
work, while a work-mode, skill, area or written-number correction is discarded.

Use the existing `parsePosting` result to detect a field that differs from the
pending draft. Route that reply through the existing correction and read-back
path, then require another confirmation. A yes that repeats an unchanged field
still confirms normally. A close confirmation is not an editable posting draft.
No new field grammar, message text, schema, matching threshold or LLM prompt.

Two alternatives: changing the shared yes/no parser would affect unrelated
consent flows and still would not apply posting fields. Treating every reply
with a recognized field as a correction would add a needless turn to `Yes, two
openings` when the draft already has two. Compare only parsed posting values
with the pending draft, then reuse its existing correction path.

## measurement

One new gate exercises 72 backend conversations on seeds 7, 13 and 17: eleven
reply conditions for both creation and update, plus two close controls per seed.
It uses the real ConsentNetwork and Peon hooks, records each outbound read-back
and save, and restarts from JSON before the correction, before confirmation and
after completion. SeatWorld writes synthetic rows through production posting
facts and seat-snapshot functions. These 72 cases are not staff-HTTP or database
tests, and they do not claim candidate matching or hiring-quality gains.

| Reply condition | Correct before -> after (creation + update, 3 seeds) |
|---|---:|
| Plain yes | 6/6 -> 6/6 |
| Yes with unchanged headcount | 6/6 -> 6/6 |
| Plain no | 6/6 -> 6/6 |
| No thanks, do not post | 6/6 -> 6/6 |
| No + remote | 0/6 -> 6/6 |
| No + three openings | 0/6 -> 6/6 |
| No + Python requirement | 0/6 -> 6/6 |
| No + Queens | 0/6 -> 6/6 |
| Yes + remote | 0/6 -> 6/6 |
| Yes + $100k-$130k | 0/6 -> 6/6 |
| No + $100k-$130k | 6/6 -> 6/6 |
| Close yes/no controls | 6/6 -> 6/6 |

Overall **36/72 -> 72/72** correct. The 42 correction flows improve
**6/42 -> 42/42**. Twelve early saves of old fields fall to zero; 24 discarded
corrections now survive and save after a separate yes. Each correct save keeps
the other posting fields and the update's original posting ID. Rejected drafts
stay discarded after a later yes. Close controls keep their previous behavior.

These are exact regression outcomes from hand-specified synthetic cases, not
population estimates; no statistical or model-quality claim is made. An early
fixture put `level 2` inside the must-have list and was corrected before the
final baseline. A 66-case first pass was then extended with the unchanged-field
confirmation control; all tables here use the final 72-case matrix.

Same affected command and seeds before and after:

```sh
bun run sim --only peon,peon-seats
```

**36/37 -> 37/37**, zero tracked misses, 36.1 -> 36.9
seconds. All 37 other gate records match excluding time. The
Peon pack/keyword/oracle fingerprint remains `b7736da857812394` (seeds 13-16,
eight weeks).

`bun run sim --only network`: **61/61**, zero tracked misses,
277.2 seconds. All 63 records match the earlier unchanged
main baseline (239 seconds), with the same command, seeds and data.
That existing baseline is reused, not represented as a fresh run.

Combined with the other 33 contributions: **112/112** with
`bun run sim --only network,peon,peon-seats`, zero tracked misses,
325.9 seconds. The new outcomes match the isolated branch; all
114 previous gate records match the prior combined run, including
posting updates, question resumption and manager-question queuing. The conflict
resolution joined adjacent simulation gates and retained every previous gate.
This combined branch stays local; the PR is based directly on main.

## safety_gates

All existing review, separate consent, age, holds, capacity, closure, leak,
protected/proxy invariance and fairness gates retain their values. The change
only routes an already recognized posting correction to its read-back. It does
not save a changed draft without a later yes or change any send check.
Synthetic local data and recorded sends only; no live messages or deployment.

## Validation

- Four typechecks pass on both isolated and combined code.
- Integration: **675 pass, 8 skip, 6 known Windows failures**, 13,741 assertions,
  689 tests in 68 files, 511.68 seconds. All 11 security-suite files run.
- The failures match the preceding run: missing `/bin/bash` in Wrangler,
  SIGTERM exit 143 instead of 0, and four native-backslash/POSIX path comparisons.
  The eight retry-reconciliation cases require a separate opt-in. No new failure.
- E2E: **42 pass, 1 skip, 0 fail**, 654 assertions, 43 tests in three files,
  47.98 seconds. The optional browser module is absent.
- The one full-simulation allowance in `AGENTS.md` was used earlier. This report
  gives affected-block results, not a fresh full-suite or hosted-CI pass.

## llm_evidence and agent_clients

Zero validation model calls/$0. Posting intake is deterministic; no model-backed
behavior or model-judge result is claimed. The backend flow is exercised directly;
there is no external-client acceptance claim. Authoring client: Codex desktop,
OpenAI `gpt-6-astra`; app version not collected. Other clients untested.

## Reproduction and limits

Run the Peon/seats command and inspect `PEON_POSTING_CORRECTION_OUTCOMES`: all 72
rows must have `correct: true`. Main with the same gate has 36 correct rows.
Then run Network, typecheck, integration and E2E with local PostgreSQL on 54339.

The existing posting grammar still determines which fields are recognized.
This is not general natural-language correction support. A correction, including
one prefixed with yes, gets a fresh read-back and needs another yes. Repeated
unchanged fields follow the existing yes/no path. Close drafts keep their
existing confirmation handling. Draft pending maintainer review and hosted CI.
