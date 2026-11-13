# Restore Friends repeat meetups from mutual feedback

Date: 2026-10-29. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Tested code: `ca9f215e6079bad455a86f04c1d367fe5e969b1d`. Combined test code: `1a5bd6e825ee255e3787cf2e57875167a74f258d`.

## Requirement and cause

This fixes a reproduced defect under approved scope. PRD 40.7 requires repeat meetups
with the same group. The Friends `same_table_again` generator implements that path.

Two checks stopped it after real Network check-ins:

1. Feedback names the meetup, such as `player-22`. The Network writes one interaction per
   reply, such as `player-22:fb:a`. The generator compared these unequal IDs and found
   no mutual feedback.
2. Correcting that comparison lets the engine select a repeat. The Network then rejects it
   as `pair_history`, because its generic 60-day completed-meeting cooldown includes that meetup.

Read the original meetup ID when checking mutual feedback. For Friends' `same_table_again`
proposals with an interaction anchor, exempt completed meetings from that cooldown. Keep
recent declines, no-shows, blocks and negative feedback. Review and new consent still apply.
The sole-use meeting-history helper is folded into `pairHistory` to keep those rules together.
No score, threshold, schema, member copy or deployment setting changes.

Alternatives: changing interaction IDs would remove per-reply identity. Turning off pair
history would remove decline and no-show checks. Fixing only the ID comparison was tried:
the engine selected a repeat, but the Network rejected it. Both changes are needed.
Legacy world records whose IDs already name the meetup retain their existing lookup.

## measurement

One gate drives 18 backend workflows: six conditions on seeds 1, 2 and 3. Three synthetic
adults first book a staff-composed group through review and text consent. Their real check-in
messages produce history. The normal Friends engine runs eight days later. JSON restarts
occur after feedback, while review is pending, and before the new replies.

| Condition (three runs each) | Repeat reviews before -> after | Repeat bookings before -> after |
|---|---:|---:|
| All three want to meet again | 0 -> 3 | 0 -> 3 |
| Only one wants to meet again | 0 -> 0 | 0 -> 0 |
| One reports a no-show | 0 -> 0 | 0 -> 0 |
| Staff rejected a follow-up | 0 -> 0 | 0 -> 0 |
| A member blocked another | 0 -> 0 | 0 -> 0 |
| All wanted a repeat, then refuse the new probes | 0 -> 3 | 0 -> 0 |

No repeat probe or reveal goes out before approval. Positive repeats keep the same three
participants. All 18 initial bookings and 54 feedback records are exercised. The first
meetup uses normal hourly ticks; this matters for the booked and feedback states.
Verification tags are synthetic inputs in the same format as staff verification.
The Network, classifier, engine, review, consent, history and booking code are real.
The transport records sends locally. No model or policy implementation is mocked.

These are deterministic regression outcomes, not an estimate of population benefit.
The existing weekly Friends world already uses matching meetup IDs; its rates do not change.

| Same command: `bun run sim --only friends,network` | Main plus new gate | Fixed |
|---|---:|---:|
| Blocking gates | 79/80 | 80/80 |
| Tracked off target | 1 | 1 |
| Elapsed seconds | 298.7 | 300.2 |

All 84 other records are identical, excluding elapsed-time fields. Fingerprints remain:
Friends pack/random/oracle `e5bf70e069eaa7e9`; Network invariant run `24bb81f068060b33`;
Network consent/push arms `361f8cc2648fb9a6`.
Friends repeat rate remains 33.7%; V14 remains 34.7% (0.83x oracle, 2.05x random).
Existing tracked miss: tracked Harm from undetected adversaries vs random (target <= 0.5x): 17.5 vs 10.5 per seed (1.67x).

Friends uses seeds 5-8, eight weeks and 400 personas per arm. Network uses its pinned
seed-3 ten-day invariants, seeds 1-3 over 21 days, scenarios and conformance checks.
The same command combined with the preceding 26 contributions passes **87/87** blocking
gates, one tracked off target, in 300.9 seconds. All 85 shared isolated records and
all 91 prior combined records match. The combined branch is local and is not pushed.

## safety_gates

Every affected blocking safety gate passes at its prior value. Minor contacts, canary leaks,
consent violations and invariant violations remain zero. The gate also checks retained
no-show, decline and block handling, plus fresh refusal. No thresholds are lowered.
No live messages, real-member data or deployment are involved.

## Validation and reproduction

Bun 1.4.2, native Windows, PostgreSQL 16.15 on local port 54339. No live-send flags.

```sh
bun install --frozen-lockfile
bun run sim --only friends,network --json ../friends-repeat-after.json
bun run typecheck
bun run test:integration
bun run test:e2e
```

- Four typechecks pass in isolation and in the combined checkout.
- Integration, including all 11 security files: **675 pass, 8 skip, 6 fail**;
  13,741 assertions, 689 tests, 68 files, 467.65 seconds.
- The failures match the prior Windows baseline exactly: missing `/bin/bash`, SIGTERM exit
  status, and four site path-separator checks. Eight skips require opt-in retry cleanup tests.
- E2E: **42 pass, 1 skip, 0 fail**; 654 assertions, 43 tests, three files,
  46.05 seconds. The optional browser test requires `PLAYWRIGHT_MODULE`.
- The repository limits each agent to one full simulation. That allowance was used earlier;
  this change runs both affected blocks. A fresh full-suite pass is not claimed.

To reproduce, add this gate to the base and run the simulation command: only the new gate
fails, with zero repeat bookings. Apply the two source changes and repeat: 80/80 pass,
three same-group repeat bookings, no bookings in the 15 other cases.
Postgres-backed commands use `REQUIRE_PG=1`, `OBSERVATORY_PG_PORT=54339`, the local cluster
through `OBSERVATORY_PG_DIR`, and `PG_BIN_DIR` on this host.

## llm_evidence

Zero validation model calls and $0 provider cost. This change concerns deterministic ID
correlation and cooldown policy. No optional LLM-judge acceptance is claimed.

## agent_clients

The backend conversation and engine workflow are exercised directly. No external-client
acceptance claim. Authoring client: Codex desktop; OpenAI `gpt-6-astra`, self-reported.
Client version was not collected. Other clients were not tested.

## Limits

This draft still needs hosted CI and maintainer review. Friends matching and sends remain
local-only. The generator still requires recent mutual feedback; it does not guarantee
all repeat candidates pass scoring, budgets, review or consent. The exemption applies only
to completed-meeting history for the named Friends repeat generator. Other pair-history
rules and other apps retain their prior behavior. Slop registration is unconfirmed after
prior sign-in failures; no new sign-in loop or scoring claim is made.
