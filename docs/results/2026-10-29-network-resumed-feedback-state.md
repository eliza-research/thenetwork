# Preserve feedback replies after missed meeting ticks

Date: 2026-10-29. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Tested code: `b00467671c6180c286b8443c30a6ec037edfece5`. Combined test code: `c44330ad71d5fb10b78b397cb4b1620c8202cd8c`.

## Requirement and cause

PRD F19 and section 32.13 require post-interaction feedback to produce attendance and
reliability evidence. Section 32.18 drives transitions through the Clock.
`docs/network.md` specifies JSON restart recovery and a feedback question three hours
after a meeting. This fixes a reproduced defect in that flow.

When the service misses ticks across a meeting, the member can still be awaiting a
booking reply. The next tick sends the feedback question before expiring that old state.
`expect()` protects pending bookings, so it refuses the feedback state. Cleanup then
removes the old booking state. The member sees the question, but replies such as
"I couldn't make it" or "A little tiring." produce no feedback history.

Expire booked reply state before deferred sends and opportunity advancement. Keep its
existing deadline (48 hours or the meeting time), and leave other waiting-state cleanup
at its prior point. The pending-probe and valid-booking guard in `expect()` is unchanged.

Alternatives: weakening `expect()` would let later questions displace a live booking.
Expanding the text classifier would handle only selected wording and leave the lost
conversation state. Moving every waiting-state timeout would broaden the behavior change.
Only the expired booking transition needs to move.

## measurement

One sim gate drives 15 real backend workflows, five conditions on seeds 1, 2 and 3.
Two synthetic adults onboard, pass human review, consent and book Saturday. Normal hourly
ticks reach one hour before the meeting. The gate saves and reloads JSON, then either
continues hourly or resumes after a four-hour gap. It restarts again before and after
the feedback reply and checks the persisted interaction ID and outcome.

| Condition (three runs each) | Correct outcomes before -> after |
|---|---:|
| Continuous hourly ticks; missed-meeting reply | 3/3 -> 3/3 |
| Resumed tick; missed-meeting reply | 0/3 -> 3/3 |
| Resumed tick; neutral feedback | 0/3 -> 3/3 |
| Resumed tick inside quiet hours; deferred question | 3/3 -> 3/3 |
| Resume before meeting; cancel the future booking | 3/3 -> 3/3 |

Recorded feedback increases from 6/12 to 12/12 past-meeting cases. The six restored
replies produce three no-show and three completed outcomes. Each past-meeting case sends
exactly one question across another tick and JSON restarts. Quiet-hour cases send nothing
until the window opens. All three future bookings retain booked reply state, send no
feedback question, and accept cancellation without recording completed-meeting feedback.
The Network, classifier, review, consent, booking and history paths are real. The transport
records messages locally. These are deterministic regression outcomes, not population rates.

| Same command: `bun run sim --only network,slop,friends,peon-seats` | Main plus new gate | Fixed |
|---|---:|---:|
| Blocking gates | 127/128 | 128/128 |
| Tracked off target | 9 | 9 |
| Elapsed seconds | 328.8 | 327.9 |

All 150 other records are identical, excluding elapsed time. Fingerprints remain:
Network invariants `24bb81f068060b33`, consent/push `361f8cc2648fb9a6`, Slop pack/random
`445afd705328fe54`, Slop live `eaeaf7bbe8c99c81`, Friends `e5bf70e069eaa7e9`.

Network retains seed-3 ten-day invariants, seeds 1-3 over 21 days, scenarios and conformance.
Slop uses seeds 13-16 over four weeks with 300 personas per city, plus live seeds 21-22
over 30 days. Friends uses seeds 5-8, eight weeks and 400 personas. Peon seats retain
their pinned intake, review, consent, exclusions and restart workflows.

The same four blocks combined locally with the preceding 27 contributions pass
**147/147** blocking gates, 8 tracked off target, in 372.6 seconds.
All 169 prior combined records match their latest prior block runs. The new gate has
identical outcomes in isolation and combined. The combined branch is not pushed.

Existing isolated tracked misses, all unchanged:

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

Every existing affected blocking gate passes at its previous value. No threshold or safety check
is changed. Review, valid pending bookings, consent, minors, blocks, STOP, quiet hours and
send-time policies retain their existing checks. Synthetic people and local transport
only; no live messages, real-member data or deployment.

## Validation and reproduction

Bun 1.4.2, native Windows, PostgreSQL 16.15 on local port 54339.

```sh
bun install --frozen-lockfile
bun run sim --only network,slop,friends,peon-seats --json ../feedback-resume-after.json
bun run typecheck
bun run test:integration
bun run test:e2e
```

- All four typechecks pass in isolation and combined.
- Integration, including all 11 security files: **675 pass, 8 skip, 6 fail**;
  13,741 assertions, 689 tests, 68 files, 493.82 seconds.
- Failures match the prior Windows baseline exactly: missing `/bin/bash`, SIGTERM exit
  status, and four site path-separator checks. Eight skips are opt-in retry cleanup tests.
- E2E: **42 pass, 1 skip, 0 fail**; 654 assertions, 43 tests, three files,
  43.81 seconds. The optional browser case requires `PLAYWRIGHT_MODULE`.
- AGENTS.md limits each agent to one full simulation. That allowance was used earlier;
  this change runs the four affected blocks. A fresh full-suite pass is not claimed.

Apply only the new gate to the base and run the command: it fails on resumed feedback,
with six lost reply records. Apply the production change and repeat: all 15 workflows
and all 128 blocking gates pass.
Postgres commands use `REQUIRE_PG=1`, `OBSERVATORY_PG_PORT=54339`, the local cluster
through `OBSERVATORY_PG_DIR`, and `PG_BIN_DIR` on this host.

## llm_evidence

Zero validation model calls and $0 provider cost. The change is deterministic tick ordering
and saved conversation state. No optional LLM-judge acceptance is claimed.

## agent_clients

The backend workflow is exercised directly; no external-client acceptance claim.
Authoring client: Codex desktop, OpenAI `gpt-6-astra`, self-reported. Client version
was not collected. Other clients were not tested.

## Limits

This draft still needs hosted CI and maintainer review. It preserves reply state for new
check-ins sent after resume; it does not repair replies already lost to old state.
Multiple concurrent meeting disambiguation is unchanged. All other waiting-state expiry
timing is unchanged. Slop registration remains unconfirmed after prior sign-in failures;
no new sign-in loop or scoring claim is made.
