# Resume manager review after a posting conversation

Date: 2026-10-29. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Tested code: `bc7690caa0114bb21c8ba62cdfb864248bfc211a`. Combined test code: `f8ac0642131e548a85edb39f9afe170908a87387`.

## Requirement and cause

This fixes a reproduced Peon hiring bug under PRD 40.6 and the text posting,
manager review, double-consent and restart workflow in `docs/network.md` 1.4.

A candidate says yes. The manager receives the blind intro question. Before
answering it, the manager edits the job by text. The posting read-back replaces
`MemberState.awaiting`; saving or dropping the draft then clears that field.
The opportunity still waits for the manager, but has already sent its question,
so it never asks again. A later "Yes, make the intro" is ignored by this flow.

Keep the interrupted manager question's opportunity ID in one optional state
field. After the posting conversation ends, a tick resumes it through the normal
probe path. The existing expiry and seat-closure checks run first. The question
is sent only if that same manager still owes a reply to an open intro and no
other question is awaiting an answer. The saved resume ID is consumed once.
This state already travels through the existing JSON export/import format;
there is no migration or new member-facing text.

Alternatives: restoring the old awaiting pointer silently would accept a bare
yes without presenting the intro question again. Treating the posting yes as
intro consent would combine two decisions. Cancelling the intro whenever a
manager edits a job would discard a valid match. An explicit fresh question
preserves the separate consent step and uses the existing send checks.

## measurement

One new gate drives 21 real backend workflows, seven conditions on seeds 7, 13
and 17. It uses the real ConsentNetwork, Peon pack, text intake/read-back/save,
human review mode (approved by the fixture), candidate reply, manager question,
posting conversation and later manager reply. SeatWorld supplies synthetic rows
through the production posting-facts and seat-snapshot functions and records
sends. Restarts occur inside the draft, after its end, after resumption and after
the final reply. The gate does not claim a staff HTTP or PostgreSQL round trip.

| Condition | Correct before -> after | Result after |
|---|---:|---|
| No posting interruption | 3/3 -> 3/3 | Normal intro after manager yes |
| Save an edit | 0/3 -> 3/3 | Ask again once; later yes completes intro |
| Drop an edit | 0/3 -> 3/3 | Ask again once; later yes completes intro |
| Say no to the resumed intro question | 0/3 -> 3/3 | Item closes without intro |
| Close the job | 3/3 -> 3/3 | No resumed question or intro |
| Original question expires during the edit | 3/3 -> 3/3 | Closed item stays closed |
| Leave the draft open for two hours, then save | 0/3 -> 3/3 | No question during draft; resume once after save |

Correct outcomes: **9/21 -> 21/21**. Valid completed intros: **3/12 -> 12/12**.
The three explicit intro refusals now close their items. All six closure/expiry
controls still send no intro. Saving or dropping a draft never itself schedules
an introduction. The candidate receives exactly one probe in every case.

Manager probes increase **21 -> 33**: one repeated question for each of the 12
interrupted, still-open items. Additional ticks and restarts produce no further
repeats. This is the cost of making the separate decision explicit. These are
exact regression counts, not a population estimate or hiring-quality claim.

Same affected command before and after:

```sh
bun run sim --only peon,peon-seats
```

**36/37 -> 37/37**, zero tracked misses, 38.4 -> 36.2
seconds. All 37 other gate records are identical excluding time.
The pack/keyword/oracle fingerprint remains `b7736da857812394` (pinned Peon seeds
13-16 over eight weeks).

`bun run sim --only network`: **61/61**, zero tracked misses,
259.1 seconds. All 63 records match the earlier run of
unchanged main (`a0ed7bc`, 239 seconds) with the same command, data and
seeds. That baseline was reused; it was not rerun or relabelled as fresh work.

The local combined tree contains the other 31 contributions. It passes
**110/110** with `bun run sim --only network,peon,peon-seats`, zero tracked
misses, in 304.2 seconds. The new 21 outcomes match the isolated branch;
all 112 earlier gate records match the previous combined run, including
PR #191's job-constraint checks. The cherry-pick conflict joined adjacent gates;
all earlier gates remain. This local branch is never pushed as the PR base.

## safety_gates

Existing review, separate consent, minors, holds, closure, capacity, fairness and
protected/proxy invariance gates keep their values. Resumption calls the normal
probe path with its quiet-hour, recipient, interruption and leak checks. It does
not approve an item, mark a manager as consenting, or revive a closed item.
Only synthetic profiles and recorded local sends were used; no live messages,
deployment or production data.

## Validation

- `bun run typecheck`: all four TypeScript checks pass, isolated and combined.
- `bun run test:integration`: **675 pass, 8 skip, 6 known Windows failures**;
  13,741 assertions, 689 tests in 68 files, 492.15 seconds. All 11
  security-suite files are included.
- Failures are the same established Windows failures: unavailable `/bin/bash`
  in the Wrangler test, SIGTERM exit 143 instead of the asserted 0, and four
  native-backslash versus POSIX-path site assertions. Eight reconciliation
  cases are opt-in. No new failing test.
- `bun run test:e2e`: **42 pass, 1 skip, 0 fail**; 654 assertions, 43 tests in
  three files, 40.68 seconds. The optional browser module is absent.
- The full-simulation allowance in `AGENTS.md` was used earlier. These are
  affected-block results, not a new full-suite or hosted-CI pass.

## llm_evidence and agent_clients

Zero validation model calls, $0. The defect and fix are deterministic conversation
state. No optional model judge result is claimed. Backend conversations are driven
directly; no external-client acceptance claim. Authoring client: Codex desktop,
OpenAI `gpt-6-astra`; app version not collected. Other clients were not tested.

## Test steps and limits

Run the Peon/seats command and inspect `PEON_POSTING_RESUME_OUTCOMES`: all 21
rows must have `correct: true`. On main with the same gate, 12 fail. Then run
the Network block, typecheck, integration and E2E with local PostgreSQL on 54339.

The change resumes only a manager's intro probe interrupted by posting intake.
It is not a general stack for all question types. It resumes on a later tick
and waits while another question is active. An original probe that expired
during the draft is not revived. A successfully reissued question gets the
normal reply window of a freshly sent probe. A send that cannot pass normal
guards can still be delayed or refused. No new wording explains the interruption.
Older saved states without the optional ID do not reconstruct a lost question.
Draft pending maintainer review and hosted CI.
