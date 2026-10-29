# Keep manager intro questions answerable with concurrent applications

Date: 2026-10-29. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Tested code: `0ebb4121362d5a5854e282fc0a5fcd39f3358b34`. Combined code: `975d3f0a2edd55827fba6ba8fe4d587d47237253`.

## Requirement and cause

This fixes a reproduced hiring bug under PRD 40.6, the one-question-at-a-time
message rule, and `docs/network.md` 1.4. A manager's seat items must not make the
manager busy for other seat items, but each candidate still needs a separate
manager yes before an intro.

Two candidates accept a two-opening job. The manager receives two blind review
questions. Each send replaces the one `MemberState.awaiting` pointer, so only the
last question remains answerable. The first item's question is marked as sent
and is never asked again. With three candidates, the third question can also hit
the conversation streak limit. An arriving review can likewise overwrite a
posting read-back before its confirmation.

Keep all applications open. Before a manager probe is sent, use the existing
deferral path if another probe or a posting confirmation owns the manager's next
reply. Existing ticks retry the pending item after the question is resolved.
Log `one_question` as the delay reason without inventing a future reply time.
No new queue storage, matching rule, threshold, member text or schema.

Alternatives: making a manager globally busy would reject other candidates
instead of keeping their applications pending. Sending a batch would need new
copy and commands to identify which candidate a yes/no refers to. Storing several
awaiting pointers alone would not disambiguate a bare reply. The existing pending
opportunities already provide the queue; serialize only the outgoing questions.

## measurement

One added gate drives 24 backend workflows: eight conditions on seeds 7, 13 and
17, with 48 applications in total. Each uses the real ConsentNetwork, Peon pack,
confirmed posting text, human review mode (approved by the fixture), separate
candidate and manager replies, recorded sends and several JSON process restarts.
SeatWorld supplies synthetic rows through the production posting-facts and seat
snapshot functions. The gate does not claim staff HTTP or PostgreSQL coverage.

| Condition (3 seeds each) | Correct before -> after | Result after |
|---|---:|---|
| One application | 3/3 -> 3/3 | Normal question and intro |
| Two applications, both yes | 0/3 -> 3/3 | Two questions in order, two intros |
| Three applications, all yes | 0/3 -> 3/3 | Three questions in order, three intros |
| First no, second yes | 0/3 -> 3/3 | First closes; second is introduced |
| First yes, second no | 0/3 -> 3/3 | First is introduced; second closes |
| First question expires, second yes | 0/3 -> 3/3 | First stays closed; second proceeds |
| Job closes with a question waiting | 0/3 -> 3/3 | Only the first question was sent; no intro |
| Candidate replies arrive during posting confirmation | 0/3 -> 3/3 | Posting yes saves only the edit; intro questions follow |

Correct outcomes improve **3/24 -> 24/24**. In the six two/three-application
all-yes workflows, completed intros improve **6 -> 15**, reaching all 15 requested
intros. Other rows check which specific opportunity closes or schedules, not
just the aggregate meeting count. A posting confirmation remains distinct from
intro consent. Every candidate receives exactly one probe.

The final matrix sends 45 manager questions both before and after. Their order
changes: the third valid review is no longer refused, and a queued question for
a closing job is no longer sent early. This is not a general message-cost claim.
These exact regression outcomes are not population estimates or hiring-quality
measurements. An initial seven-condition reproduction passed only 3/21; the
posting case was added before the code fix. All tables use the final matrix.

Same affected command and seeds before and after:

```sh
bun run sim --only peon,peon-seats
```

**36/37 -> 37/37**, zero tracked misses, 34.4 -> 34.5
seconds. All 37 other gate records are identical excluding time.
The Peon pack/keyword/oracle fingerprint remains `b7736da857812394` (pinned
seeds 13-16, eight weeks).

`bun run sim --only network`: **61/61**, zero tracked misses,
266.6 seconds. All 63 records match the earlier unchanged
main run (239 seconds) with the same command, seeds and data. This
existing baseline is reused, not described as a new run.

Combined with the other 32 contributions: **111/111** using
`bun run sim --only network,peon,peon-seats`, zero tracked misses,
335.8 seconds. The new outcomes match this isolated branch; all
113 earlier records match the prior combined run, including PR #191's
job constraints and PR #193's interrupted-question resumption. The cherry-pick
conflict joined adjacent gates; no earlier gate was removed. The combined
branch is local only and never pushed as the PR base.

## safety_gates

Review, separate consent, minors, holds, capacity, closure, protected/proxy
invariance and fairness gates retain their values. A queued manager question
still passes every normal recipient, timing, budget and leak check when it is
retried. No automatically accepted review or intro. Synthetic profiles and
recorded sends only; no live messages, deployment or production data.

## Validation

- All four `bun run typecheck` checks pass, isolated and combined.
- Integration: **675 pass, 8 skip, 6 known Windows failures**, 13,741 assertions,
  689 tests in 68 files, 529.65 seconds. All 11 security-suite files run.
- The same failures remain: `/bin/bash` absent in the Wrangler test, SIGTERM
  exit 143 instead of expected 0, and four native-backslash/POSIX site-path
  comparisons. Eight retry-reconciliation tests are opt-in. No new failure.
- E2E: **42 pass, 1 skip, 0 fail**, 654 assertions, 43 tests in three files,
  46.04 seconds. The optional browser module is absent.
- The full-simulation allowance in `AGENTS.md` was used earlier. These are
  affected-block results, not a new full-suite or hosted-CI pass.

## llm_evidence and agent_clients

Zero validation model calls/$0. This is deterministic conversation scheduling;
no optional model judge result is claimed. Backend conversations are exercised
directly, with no external-client acceptance claim. Authoring client: Codex
desktop, OpenAI `gpt-6-astra`; app version not collected. Other clients untested.

## Test steps and limits

Run the Peon/seats command and inspect `PEON_MANAGER_QUEUE_OUTCOMES`: all 24 rows
must have `correct: true`. Main with the same gate passes only the three single
application controls. Then run Network, typecheck, integration and E2E with
local PostgreSQL on port 54339.

Later applications wait for the current reply or its normal expiry. The existing
26-hour sent-probe and two-day unsent-probe limits remain; a queued item can
still expire or fail another send check. Booked intro acknowledgements are not
new questions and do not block the next review. This guard concerns manager
intro probes behind another probe or a posting confirmation; other question
handling is unchanged. The earlier resumption fix is separate: this PR prevents
an incoming question from replacing one, while PR #193 restores a question that
the manager deliberately interrupted with a posting conversation.
Draft pending maintainer review and hosted CI.
