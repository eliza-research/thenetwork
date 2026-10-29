# Keep job edits while asking which posting to update

Date: 2026-10-29. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Tested code: `7b4a4cf3090d558160788130cdb60ef31605b1a9`. Combined code: `38079d89638706aa6d77fb3941d893d4eb9e9dd4`.

## Requirement, cause and choice

This fixes the existing posting-update flow in `docs/network.md` 1.4, under
PRD 40.6. With two active jobs, send `Update my job post: 3 openings`.
The Network asks which job, but `readPostingText` returns no draft, so the caller
clears the conversation state. Answering `data analyst` does not resume the
update. The requested headcount and target question are lost.

Return a draft holding the requested fields and one optional `update` flag while
the target is unknown. On the next reply, select only an explicitly named active
post, apply the saved edits and any new reply fields, and use the existing
read-back/confirmation path. Strip the selected title before reading new fields
so `senior data analyst` identifies a job without changing its stored level.
Clear the selection marker after selection. No new copy or database schema.

The active list is read again at selection time. Storing full posting records
in the pending draft would duplicate data that can close or change meanwhile.
Falling back to the only remaining active job could edit the wrong job when
the named one has closed. Retain only the edits, then resolve an explicit active
target. Unknown or ambiguous replies end this draft, like the close-choice flow.

## Relation to other contributions

This is separate from #144, which fills partial-update confirmations from the
selected job's saved fields. That PR has a code-reading approval; it is not
modified here. On main alone, selecting a job for a headcount-only update still
asks for pay, as the existing #144 defect does. The gate supplies the requested
pay and verifies that the original headcount edit survives and only the selected
post changes. With #144 applied, selection goes straight to the full read-back.
Both results are measured below. #150 separately handles overlapping title
mentions; its lookup is retained when combining these changes.

## measurement

One added gate runs 33 backend workflows: eleven cases on seeds 7, 13 and 17.
Each creates two jobs with different titles, pay, modes and requirements through
the real ConsentNetwork/Peon text flow. It restarts from JSON while the choice
is pending, after selection, before confirmation and after completion. The gate
checks saved IDs and fields, read-backs, no writes before confirmation, and that
the other job stays unchanged. A closed-target case uses `applyPosting` between
the question and answer. SeatWorld supplies synthetic rows through production
posting-facts and seat-snapshot functions; this new gate needs no database and
does not claim HTTP or PostgreSQL coverage for its scenarios.

| Workflow (3 seeds each) | Correct before -> after |
|---|---:|
| Job named in the initial update | 3/3 -> 3/3 |
| Select the first job | 0/3 -> 3/3 |
| Select the second job | 0/3 -> 3/3 |
| Select a job and change headcount in the reply | 0/3 -> 3/3 |
| Select a title containing seniority without changing its stored level | 0/3 -> 3/3 |
| Select, receive the read-back, then cancel | 0/3 -> 3/3 |
| Decline the target question | 3/3 -> 3/3 |
| Give an unknown title | 3/3 -> 3/3 |
| Named job closes before selection | 3/3 -> 3/3 |
| Start a new job instead | 3/3 -> 3/3 |
| Send a fresh update naming another job | 3/3 -> 3/3 |

Overall **18/33 -> 33/33** correct. The 18 intended updates improve from
**6/18 -> 18/18** saved correctly; the other three repaired workflows reach a
read-back that the manager can decline. Rejected and closed choices produce no
write to another job. These are exact outcomes of hand-specified synthetic
cases, not population or hiring-quality estimates.

Same command, cases and seeds: `bun run sim --only peon,peon-seats`.
**36/37 -> 37/37** blocking gates, zero tracked misses,
36.7 -> 35.6 seconds. All 37 other gate records
match excluding time; the Peon fingerprint remains `b7736da857812394`
(pack/keyword/oracle arms, seeds 13-16, eight weeks).

Combined with the other 35 contributions, the same command passes
**48/48**, zero tracked misses, 39.3 seconds. All 48
previous Peon/seats records match the prior combined run. The new rows have the
same correct saves and cancellation results. Their one recorded difference is
pay being asked again: 18 isolated cases, zero combined cases due to #144.
The merge retained stored-field lookup, overlapping-title lookup, bare-title
intake and all prior gates. The combined branch stays local; this PR targets main.

## safety_gates

All existing age, review, separate-consent, holds, capacity, closure, leak,
protected/proxy invariance and fairness gates retain their values. Only the
manager's existing posting list is consulted. Selection never saves by itself;
the normal confirmation is required. The existing two-question limit applies.
Synthetic local rows and recorded sends; no live messages or deployment.

## Validation, llm_evidence and agent_clients

- Four typechecks pass on isolated and combined code.
- Integration including all 11 security files: **675 pass, 8 skip, 6 known
  Windows failures**, 13,741 assertions, 689 tests in 68 files,
  471.66 seconds. The same failures remain: Wrangler needs `/bin/bash`,
  SIGTERM exits 143 instead of 0, and four native/POSIX site-path comparisons.
  Eight retry-reconciliation cases are opt-in. No new integration failure.
- E2E: **42 pass, 1 skip, 0 fail**, 654 assertions, 43 tests in three files,
  40.95 seconds. The optional browser module is absent.
- The full-simulation allowance in `AGENTS.md` was used earlier. These are
  affected-block results, not a new full-suite, Network-only or hosted-CI pass.
- Zero validation model calls/$0. This is deterministic draft handling, with no
  model-backed or external-client acceptance claim. Authoring client: Codex
  desktop, OpenAI `gpt-6-astra`; app version not collected. Other clients untested.

## Test steps and limits

Run the affected command and inspect `PEON_UPDATE_CHOICE_OUTCOMES`: all 33 rows
must have `correct: true`. Main with the same gate has 18 correct rows. Then run
typecheck, integration and E2E with local PostgreSQL on port 54339.

The existing title matching and posting grammar remain. An unknown or ambiguous
choice discards the pending draft; a fresh update command can start again.
Requests already forgotten by older code cannot be reconstructed. The separate
partial-read-back limitation on main is covered by #144, as described above.
Draft pending maintainer review and CI.
