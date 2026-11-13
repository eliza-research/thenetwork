# Preserve sponsorship refusals in job postings

Date: 2026-10-29. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Tested code: `11d7ccd96e096db6702269344c0a581dab7aac78`. Combined code: `b788f2bce673db80fde78bbdaf824006b2cdf10d`.

## Requirement, cause and choice

This is a reproduced job-posting defect under PRD 40.6 and `docs/network.md`
1.4. The existing Peon `work_authorization` rule requires sponsorship to be
offered when a candidate needs it (`packs/peon/rules.ts`, `workAuthOk`).

Append `No sponsorship available.` or `No visa sponsorship available.` to a
valid job post. Main reads back `Visa sponsorship: yes`, saves `sponsors: true`
after confirmation, and admits a candidate who needs sponsorship. Both the
existing negative and positive expressions match, but the positive check wins.

Check the existing refusal expression first. No new grammar, copy, field or
matching rule. The saved flag now lets the existing work-authorization filter
do its job. The same behavior applies when an offered sponsorship is withdrawn
in a posting update.

Alternatives: excluding negative text from only the positive expression would
duplicate the refusal grammar; fixing the engine would be too late, because it
receives only the incorrect saved boolean. Use the existing negative check as
the first branch, then the positive check.

## measurement

One new simulation gate drives 72 real backend workflows: six phrases, creation
and update, candidates with and without a sponsorship need, and seeds 7, 13 and
17. Each confirms the read-back, saves rows, restarts from JSON, and runs the
actual engine and Peon hooks. Updates begin from a sponsorship-offering job and
keep its ID. The gate waits up to two days for review, checks there was no probe
before approval, then supplies human-review approval and separate candidate and
manager yeses. Restarts also occur between the consent steps and after the intro.

SeatWorld supplies synthetic rows through production posting-facts and
seat-snapshot functions, with recorded sends. These cases do not claim staff
HTTP, PostgreSQL or external-agent-client coverage of the new scenario.

| Phrase (12 workflows each) | Correct before -> after |
|---|---:|
| No sponsorship available. | 0/12 -> 12/12 |
| No visa sponsorship available. | 0/12 -> 12/12 |
| No sponsorship. | 12/12 -> 12/12 |
| We can't sponsor. | 12/12 -> 12/12 |
| Sponsorship available. | 12/12 -> 12/12 |
| We can sponsor. | 12/12 -> 12/12 |

Overall **48/72 -> 72/72** correct. The 24 wrong read-backs/saved flags are fixed.
Intros that violate the stated sponsorship constraint fall **12 -> 0**; all
**48 valid intros remain** (36 where the candidate does not need sponsorship,
12 where sponsorship is needed and offered). Total intros fall 60 -> 48 because
the incompatible ones are removed. These are exact outcomes of hand-specified
synthetic workflows, not population estimates or a claim about hiring quality.

Same command and seeds before and after: `bun run sim --only peon,peon-seats`.
**36/37 -> 37/37** blocking gates, zero tracked misses,
35.7 -> 36.3 seconds. All 37 other gate records
match excluding time. The pack/keyword/oracle fingerprint remains
`b7736da857812394` (Peon seeds 13-16, eight weeks).

With the other 34 contributions applied locally, the same affected command
passes **47/47**, zero tracked misses, 42.4 seconds. All
47 previous Peon/seats records match the preceding combined run, and
the new 72 outcomes match the isolated branch. Conflict resolution retained the
earlier role-seniority fix and all prior gates. The combined branch stays local;
this PR is based on main. No new Network-only or full-simulation result is claimed.

## safety_gates

All existing age, review, separate-consent, holds, capacity, closure, leak and
protected/proxy invariance and fairness gates retain their values. The change
does not infer a candidate's sponsorship need or add a filter. It preserves the
employer's stated refusal so the existing filter receives the right data.
No live sends, production data or deployment.

## Validation, llm_evidence and agent_clients

- Four typechecks pass, isolated and combined.
- Integration including all 11 security files: **675 pass, 8 skip, 6 known
  Windows failures**, 13,741 assertions, 689 tests in 68 files,
  539.24 seconds. Failures match the preceding run: missing `/bin/bash`
  in Wrangler, SIGTERM exit 143 instead of 0, and four native/POSIX site-path
  comparisons. Eight retry-reconciliation tests require an opt-in. No new failure.
- E2E: **42 pass, 1 skip, 0 fail**, 654 assertions, 43 tests in three files,
  43.96 seconds. The optional browser module is absent.
- The full-simulation allowance in `AGENTS.md` was used earlier. This report
  gives affected-block results, not a fresh full-suite or hosted-CI pass.
- Zero validation model calls/$0. This parser is deterministic; no model-backed
  result is claimed. Backend workflows are exercised directly, with no external
  client acceptance claim. Authoring client: Codex desktop, OpenAI `gpt-6-astra`;
  app version not collected. Other clients untested.

## Test steps and limits

Run the affected command and inspect `PEON_SPONSORSHIP_OUTCOMES`: all 72 rows
must have `correct: true`; main with the same gate has 48 correct rows. Then run
typecheck, integration and E2E with local PostgreSQL on port 54339.

The existing expressions still define the supported wording. This does not add
general negation or temporal-condition understanding. If both recognized
positive and negative expressions occur, the refusal takes precedence and the
normal read-back still needs confirmation. Draft pending maintainer review and CI.
