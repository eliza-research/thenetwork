# Keep cancelled members out of completed group history

Date: 2026-10-29. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Tested code: `8797b7ef5af68d53f2a73776715ff6aedd630ca7`. Combined test code: `bc117fd5c2775de6c93352a0de7998d2cbdd0d56`.

## Requirement and cause

PRD F17-F19 covers cancellation, attendance and post-meeting feedback; section 32.13
requires factual feedback to update interaction history. `docs/network.md` section 4.3
states that a cancelling participant is dropped, while a group can still meet.
This fixes a reproduced history bug in that existing workflow.

For example, Ana, Ben and Cara book a group activity. Cara says "I can't make it" before
the meeting. Ana and Ben still meet and answer the check-in. The Network correctly asks
only those two for feedback, and their pair feedback names only each other. But each
saved interaction still lists all three original participants, including Cara. Consumers
of completed-meeting history receive a meeting association for someone who cancelled.

Build the remaining participant list from the opportunity's `yes` statuses once in
`onFeedback()`. Use that list for both the existing counterpart selection and the saved
interaction. Preserve the original participant order and each reply's outcome and ID.
The group can continue, and a cancellation that closes a pair still produces no feedback.

Alternatives: deleting the whole interaction would discard the remaining members' real
feedback. Removing names from the opportunity itself would lose its cancellation state.
Filtering each downstream reader would duplicate policy and leave inconsistent stored
history. Correcting the history writer keeps the source consistent.

## measurement

One gate drives 15 backend workflows: five conditions on seeds 1, 2 and 3. Synthetic
adults onboard, pass human review, consent, and book. A member cancels in four conditions;
the remaining members acknowledge the plan or change. This acknowledgement keeps normal
conversation-streak checks in force. Time advances through hourly ticks, the real check-in
and replies run, and the Network is reloaded from JSON after cancellation and feedback.

| Condition (three runs each) | Incorrect participant lists before -> after | Saved feedback interactions |
|---|---:|---:|
| Intact group of three | 0 -> 0 | 9 |
| Three booked, one cancels, two meet | 6 -> 0 | 6 |
| Four booked, one cancels, three meet | 9 -> 0 | 9 |
| Three booked, one cancels, a remaining member reports a no-show | 6 -> 0 | 6 |
| Pair cancelled before the meeting | 0 -> 0 | 0 |

Correct workflows increase **6/15 -> 15/15**. Incorrect participant lists fall **21 -> 0**
across the same 30 saved interactions. All three no-show outcomes remain. The exact
per-reply IDs survive restart. No cancelled member gets a check-in or appears in pair
feedback before or after. Intact-group history and pair cancellation remain correct.
The Network, classifier, review, consent, booking and history code are real; the transport
records messages locally. These are deterministic regression outcomes, not population rates.

| Same command: `bun run sim --only network,slop,friends,peon-seats` | Main plus new gate | Fixed |
|---|---:|---:|
| Blocking gates | 127/128 | 128/128 |
| Tracked off target | 9 | 9 |
| Elapsed seconds | 350.8 | 347.8 |

All 150 other records are identical, excluding elapsed time. Fingerprints remain:
Network invariants `24bb81f068060b33`, consent/push `361f8cc2648fb9a6`, Slop pack/random
`445afd705328fe54`, Slop live `eaeaf7bbe8c99c81`, Friends `e5bf70e069eaa7e9`.

Network retains seed-3 ten-day invariants, seeds 1-3 over 21 days, scenarios and conformance.
Slop uses seeds 13-16 over four weeks with 300 personas per city, plus live seeds 21-22
over 30 days. Friends uses seeds 5-8, eight weeks and 400 personas. Peon seats retain
their pinned intake, review, consent, exclusions and restart workflows.

Combined locally with the preceding 28 contributions, the same command passes
**148/148** blocking gates, 8 tracked off target, in 343.2 seconds.
All 170 records from the preceding combined run match, excluding elapsed time. The new
gate has identical outcomes in isolation and combined. The combined branch is not pushed.
This also checks compatibility with the previous opportunity-ID, booked-time and no-show
attribution fields in interaction history.

Existing isolated tracked misses, unchanged:

- gate Minor contacts (age liars) cut vs random (>= 90%): 76.5%.
- gate Adversary contacts cut (scammers, harassers, age liars) (>= 90%): 45.4%.
- gate Second-date rate vs random (and >= 20%) (>= 2.5x): 1.733.
- gate Second dates per seed vs random (>= 2x): 1.676.
- gate Lowest group vs overall (man:gay) (>= 0.7x): 0.506.
- gate Same, feasible members (man:gay) (>= 0.7x): 0.603.
- gate Back-outs at reveal (< 10%): 0.122.
- slop-live style: probe texts that break the Network's style rules (target 0): 4 of 342 (too_long).
- tracked Harm from undetected adversaries vs random (target <= 0.5x): 17.5 vs 10.5 per seed (1.67x).

## safety_gates

All existing affected blocking gates pass at their previous values. No score, threshold,
consent or send policy changes. Review, minors, blocks, STOP and quiet hours keep their
existing checks. Synthetic people and local transport only; no live messages,
real-member data or deployment.

## Validation and reproduction

Bun 1.4.2, native Windows, PostgreSQL 16.15 on local port 54339.

```sh
bun install --frozen-lockfile
bun run sim --only network,slop,friends,peon-seats --json ../group-history-after.json
bun run typecheck
bun run test:integration
bun run test:e2e
```

- Four typechecks pass in isolation and combined.
- Integration, including all 11 security files: **675 pass, 8 skip, 6 fail**;
  13,741 assertions, 689 tests, 68 files, 477.05 seconds.
- Failures match the prior Windows baseline exactly: missing `/bin/bash`, SIGTERM exit
  status, and four site path-separator checks. Eight skips are opt-in retry cleanup tests.
- E2E: **42 pass, 1 skip, 0 fail**; 654 assertions, 43 tests, three files,
  42.06 seconds. The optional browser case requires `PLAYWRIGHT_MODULE`.
- AGENTS.md limits each agent to one full simulation. That allowance was used earlier;
  this change runs the four affected blocks. A fresh full-suite pass is not claimed.

Apply only the new gate to the base and run the command: it fails, with 21 interaction
records still containing a cancelled member. Apply the production change and repeat:
all 15 workflows and all 128 blocking gates pass.
Postgres commands use `REQUIRE_PG=1`, `OBSERVATORY_PG_PORT=54339`, the local cluster
through `OBSERVATORY_PG_DIR`, and `PG_BIN_DIR` on this host.

## llm_evidence

Zero validation model calls and $0 provider cost. This is deterministic history writing;
no optional LLM-judge acceptance is claimed.

## agent_clients

The backend workflow is exercised directly; no external-client acceptance claim.
Authoring client: Codex desktop, OpenAI `gpt-6-astra`, self-reported. Client version
was not collected. Other clients were not tested.

## Limits

This draft needs hosted CI and maintainer review. Existing saved history is not migrated.
The fix removes people who left the booking; it does not infer independent attendance
for every remaining person. The existing per-reply outcome and attribution semantics
remain unchanged. Slop registration is unconfirmed after prior sign-in failures;
no new sign-in loop or scoring claim is made.
