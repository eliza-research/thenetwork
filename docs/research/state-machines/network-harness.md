# State machines assumed by packages/network/harness and packages/network/test

Hand-written research note, 2026-11-07, branch `claude/quint-state-machines`, commit a0ed7bc. No code changed. No test or simulation was run for this note. The evidence is code reading.

Scope: `packages/network/harness/*` and `packages/network/test/*`. The question is: what lifecycle do these files assume, and what rules do they encode that the service must satisfy? Service code was read only where a suspected defect needed proof. Other research files own the full model of the service code. This file gives the contract that those models must keep.

Priority key: P0 is safety-critical (minors, consent, STOP, review gate, leak guard, bans, auth). P1 is money, data integrity or delivery. P2 is other.

## 1. How to read the test estate

| Layer | Files | What it proves | Reviewer | Clock |
|---|---|---|---|---|
| Simulated world | `harness/experiment.ts`, `harness/scenarios.ts`, `harness/growth.ts`, `harness/paraphrase.ts` | ConsentNetwork on the 250-persona NYC world | `review: "auto"` (scenarios.ts:6, :382, experiment.ts:100) | World clock |
| Mini world | `test/mini.ts`, `report-booked`, `block-target-plan`, `invites-honest`, `store.test` | One flow, step by step, real engine, no database | `auto`, `maxNewPerDay: 0` by default (mini.ts:40) | `SimClock` |
| Service on Postgres | `service*.test.ts`, `crossapp`, `slop-*`, `peon-*`, `profile-*` | Real `NetworkService`, real SQL, dry-run or fake provider | `human` is forced (service.test.ts:169) | `SimClock` |
| Signed wire | `shared-agent`, `shared-actions`, `shared-relay`, `relay.test`, `eliza-takeover`, `gateway-fixtures`, `cloud-outbound` | The Eliza and Cloud seam over real HTTP and HMAC | `human` or fixture opportunity | `SimClock` |
| Queue and inbox unit-of-behavior | `inbox-order`, `cost` | One class on real Postgres | n/a | `SimClock` |

Facts that a Quint model must not copy from the tests:

- `relay.test.ts:53-60` and `shared-relay.integration.test.ts:54-59` insert a `scheduled` opportunity through `importState`. These fixtures skip review and probing by design. A relay model must start from a state that the opportunity machine can reach, not from an arbitrary fixture.
- `mini.ts:56` allows a member with no age. The service also has this state (`service.test.ts:136`, "no age is unknown, not under 13").
- `store.test.ts:275-276` changes `age` on the fixture list and then re-imports state. This imitates the platform's lowest age. It is not a member action.
- `block-target-plan.test.ts:24-27` adds participants to a booked plan by direct state edit. The status set it uses (`probing`, `unavailable`) is real, but the edit is a fixture.
- The `Restartable` wrapper (`store.test.ts:91-105`) restarts only at a tick boundary. It does not model a crash inside a unit.

Gaps in the estate itself:

- `profile-cleanup-reconciliation.postgres.test.ts:29-32` runs only with `NETWORK_RETRY_RECONCILIATION_TEST=1` and `NETWORK_RETRY_POSTGRES_URL`. A search of `.github`, `scripts`, `package.json` and `docs` finds neither variable. The suite is always skipped in normal runs (defect H-14).
- `mini.ts:4` names `network.test.ts`, which does not exist. `scripts/sim/network.ts:296` runs the scenarios now.
- The `*.integration.test.ts` files run under `bun run test:integration` because that command takes all of `./packages` (package.json:9). Only `shared-agent.integration.test.ts` is in `bun run security`.

## 2. Machine index

| id | Name | Kind | Priority | Model with |
|---|---|---|---|---|
| opp-lifecycle | Opportunity stage and participant status | explicit | P0 | review-gate, block-cancel |
| review-gate | Human review before contact | explicit + implicit | P0 | opp-lifecycle |
| member-conversation | Member stage, awaiting slot, onboarding | explicit | P1 | slop-onboarding |
| trust-safety | Trust level, report status, staff case | explicit | P0 | hold-ban-cross-app |
| hold-ban-cross-app | Hold, ban, lift across apps | implicit | P0 | consent-stop, trust-safety |
| consent-stop | Consent ledger, STOP, START, leave, opted_out, membership state | explicit + implicit | P0 | signed-turn, outbound-admission |
| age-policy | Lowest age, age floor, minor, under-13 forget | implicit | P0 | text-join, hold-ban-cross-app |
| text-join | Text join, pending_texts, looking_for, eliza notice | implicit | P0 | age-policy, consent-stop |
| webhook-inbox | platform.inbound webhook rows | explicit | P1 | signed-turn |
| signed-turn | platform.inbound signed rows, lease, tombstone | explicit | P0 | consent-stop, turn-receipt |
| turn-receipt | Gateway acknowledgement of collected replies | explicit | P1 | signed-turn, notify-projection |
| action-receipts | set-state, signals, updates, relay receipts on one open turn | implicit | P1 | signed-turn, relay-desk |
| route-authority | admit and drain window for isolated routes | implicit | P0 | signed-turn |
| outbound-admission | platform.outbound row and final fence | explicit | P0 | consent-stop, leak-review, person-cap |
| leak-review | Parked row, staff release or drop | explicit | P0 | outbound-admission |
| person-cap | Three proactive sends a day across apps | implicit | P0 | outbound-admission |
| notify-projection | notification_recorded_at repair | implicit | P1 | turn-receipt, outbound-admission |
| relay-desk | Relay decision, held text, contact swap, thread | explicit + implicit | P0 | opp-lifecycle, outbound-admission |
| photo-relay | Selected photo review, release, revoke | explicit | P0 | relay-desk |
| photo-rating | Photo upload, rating, deletion | implicit | P0 | age-policy |
| request-lifecycle | Member request outcome and retry | explicit | P2 | opp-lifecycle |
| plan-lane | Plan probes, quorum, booking reveal | implicit | P1 | opp-lifecycle |
| invite-growth | Friend invite in the simulator only | implicit | P2 | none (no service counterpart) |
| persistence-restart | Export, import, runStored, tick lock | implicit | P1 | all network machines |
| participation-window | set-state, scheduled state, projection | implicit | P2 | action-receipts |
| peon-posting | Job post read-back, seat, close | implicit | P2 | opp-lifecycle |
| slop-onboarding | Engine question loop and read-back | implicit | P2 | member-conversation |
| profile-suggestion | Pending batch, revision, decision | explicit | P0 | profile-cleanup, collection-claim |
| collection-claim | One batch per signed collection turn | implicit | P0 | profile-suggestion |
| profile-cleanup | V1 disconnect and V2 withdrawal receipts | implicit | P0 | profile-suggestion |
| learning-context-proof | Signed short-lived consent context | implicit | P0 | route-authority |
| staff-audit | requested, result, refused phases | implicit | P1 | hold-ban-cross-app |
| matching-switch | Matching off, on, not allowed | explicit | P1 | review-gate |
| phone-hold-suppression | Recycled number hold and suppression hash | implicit | P0 | consent-stop |

## 3. Network core, as the harness and Mini see it

### 3.1 opp-lifecycle (P0)

State: `Opp.stage` in `packages/network/src/network.ts:338`, in JSON state and projected to `network.opportunities.state` (`SCHEDULED`, `COMPLETED`; `packages/network/src/store.ts:91`). Participant status is `status: [member, value][]` with values seen in tests: `probing`, `yes`, `unavailable` (`block-target-plan.test.ts:25`, `relay.test.ts:56`). Sets: `contacted`, `reminded`, `feedbackFrom`, `bookedTold`, `primed`, `alternates`, `turnAt`.

States: `review`, `probing`, `scheduled`, `done`, `closed`. `closedFrom` records the stage before `closed` (`shared-relay.integration.test.ts:57`). Implied: "deleted" (an under-13 decline deletes the opportunity, `store.test.ts:234`).

| From | Event | Guard | Effect | To | Evidence | Actor |
|---|---|---|---|---|---|---|
| none | engine run, member request, `submitProposal` | matching on, member eligible | queue item | review | store.test.ts:261, mini.ts:141 | cron, member, staff |
| review | approve | staff role, inside SLA | `probe_started` log | probing | service.test.ts:196-204 | staff |
| review | reroll | staff | new participants, participations rewritten | review | store.test.ts:270-272 | staff |
| review | edit | no appearance words | new explanations | review or refused `edit_leak` | slop-date-path.test.ts:158-161 | staff |
| review | SLA end | none | unsent | closed | AGENTS.md invariant | clock |
| probing | first asked says yes | none | next person probed | probing | service.test.ts:203-209 | member |
| probing | all yes | mutual | booked text, `recordMeeting` | scheduled | mini.ts:117-123, slop-date-path.test.ts:195-197 | member |
| probing | decline | none | alternate swap (`probe_replaced`) or close | probing or closed | scenarios.ts:40 | member |
| probing | deadline | `PROBE_TTL` | close | closed | store.test.ts:61 | clock |
| scheduled | block or urgent report by a booked person | booked with target | `meeting_cancelled` reason blocked, quiet note to the other | closed | report-booked.test.ts:20-25, slop-block-target.test.ts:112-117 | member |
| scheduled | profile from an AI assistant says cancel | source `mcp` | no change | scheduled | slop-date-path.test.ts:200-205 | other service |
| scheduled | meeting time passes, feedback | none | check-in | done | store.test.ts:45, 193 | clock, member |

Invariants:

- OPP-1 (AGENTS.md review gate): no outbound row names an opportunity while it is in `review` (`service.test.ts:190`, `slop-date-path.test.ts:162`).
- OPP-2 (founder decision 1): no member under 18 is a participant, alternate or host in any stage (`experiment.ts:233`, `eliza-takeover.test.ts:233`, `peon-seats.test.ts:93`).
- OPP-3: the requester is asked first and the partner only after the answer (`service.test.ts:203-209`). The partner gets no text before the requester's answer.
- OPP-4: an assistant text with `source: "mcp"` never changes `status`, `stage`, trust or reports (`slop-date-path.test.ts:166-205`, `shared-relay.test.ts:139-146`).
- OPP-5: the blocked pair is never in a later opportunity (`slop-date-path.test.ts:222-229`, `crossapp.test.ts:196`).
- OPP-6: a report by someone with a booked plan holds the subject. A report from a stranger adds zero points (`scenarios.ts:186-200`, audit network-consent-7).

Liveness: every non-terminal stage has a clock exit. `review` has the SLA, `probing` has `deadline`. `scheduled` depends on the check-in loop.

Concurrency: one unit of work per network, under the advisory lock (persistence-restart). Staff `decide` and tick share that lock.

Quint notes: variables `stage: OppId -> Stage`, `status: OppId -> Member -> PStatus`, `contacted`, `messages`. Actions `queue`, `approve`, `reroll`, `expireReview`, `probe`, `answer(yes|no|counter)`, `book`, `block`, `feedback`, `expireProbe`. Bound 3 members, 2 opportunities. Check OPP-1, OPP-2, OPP-5. Treat a counter as not-yes (AGENTS.md item 11). Note that `experiment.ts:138` counts a counter as yes (defect H-11).

### 3.2 review-gate (P0)

States of `Opp.review`: `{queuedAt, deadline}` with no decision, then `decision` in approve, reject, reroll or edit, and `reviewer`. In `network.review_items`: `decision`, `reviewer`, `seconds_spent`.

Rules encoded:

- The mode is never stored and never leaves `human` in the service. `importState` of an `auto` state keeps `human` (`store.test.ts:83-86`). `new NetworkService({network:{review:"auto"}})` throws (`service.test.ts:169`). `/review-mode` is 404 (`service.test.ts:168`).
- The reviewer of record is the token id. A body field `reviewer` is ignored (`service.test.ts:196-200`). `X-Network-Staff-Id` counts only with the console token (`service-apps.test.ts:455-473`).
- An unknown decision returns 400 and writes no audit row (`service.test.ts:194`, `service-platform.test.ts:556-567`).
- `GET /review` writes nothing (`service-platform.test.ts:568-572`).
- A review item for app A is not visible to a reviewer of app B (`service-apps.test.ts:288-295`).
- The simulator's judge uses `requireReview: true` for consent arms (`experiment.ts:177`).

### 3.3 member-conversation (P1)

State in JSON state: `stage: new | age | q1 | q2 | q3 | active` and `awaiting.kind: probe | booked | feedback | growth | interview | age | checkin | crew | posting` (`network.ts:243, 278`).

`Mini.onboard` proves the path `new -> q1 -> q2 -> q3 -> active` with four messages (`mini.ts:93`). A member with no age takes the `age` stage (`service.test.ts:137-139`). `Mini.probed` reads `awaiting.kind === "probe"` as "the next message is the answer" (`mini.ts:111`).

Invariants:

- One awaiting slot per member. The next inbound goes to that slot.
- A question is never repeated across a restart (`service.test.ts:179-182`, `service-platform.test.ts:412`).
- An unmet request does not open `growth` when there is no invite link (`invites-honest.test.ts:16-19`).
- A saved-profile read does not consume `awaiting` or onboarding (`shared-agent.test.ts:547-566`).
- `report him` with no target opens a target question. The next name files the report (`block-target-plan.test.ts:53-59`). The offered names are only people the member was booked with (`block-target-plan.test.ts:29-42`).

### 3.4 trust-safety (P0)

State: `TrustLevel = ok | watch | hold` (`trust.ts:18`), `score`, `events`, per network in JSON state. Report status: `open`, `dismissed`, `banned` (`service-safety.test.ts:144, 171`, `:256`). Safety case per member.

| From | Event | To | Evidence |
|---|---|---|---|
| ok | one contact ask, one scam | watch, never hold from one message from a clean record | scenarios.ts:95, 103 (audit network-consent-8) |
| watch | repeat | hold | scenarios.ts:65 |
| any | staff hold | hold | service-safety.test.ts:155 |
| any | block_abuse (four reports a day) | reporter flagged, targets stay ok | scenarios.ts:168-183 |
| open | staff dismiss | dismissed | service-safety.test.ts:205 |
| open | ban with reportId | banned | service-safety.test.ts:170-171 |
| open minor report | clear-minor | dismissed | service-safety.test.ts:256 |

A swap ask to the current match is not scored. Any third-party or bulk part scores the whole message (`shared-relay.test.ts:128-157`). No open match means scored (`shared-relay.test.ts:295-299`).

Rules: reports show ids and a kind, never the words (`service-safety.test.ts:145, 151`). A photo read needs an open report or case and a reason, and the audit row comes before the link (`service-safety.test.ts:327-340`).

### 3.5 request-lifecycle (P2)

`Request.outcome`: `probing`, `waiting`, `booked`, `fulfilled`, `none`, `answered` (`network.ts:1625-1793`, `crossapp.test.ts:212`, `experiment.ts:202`). A request with nobody fit stays open and contacts nobody (`crossapp.test.ts:210-212`). The retry fires by tick. `invites-honest.test.ts:13` waits up to five days for the "couldn't find someone" text.

### 3.6 plan-lane (P1)

`experiment.ts:223-262` encodes judge-style rules: no minor in any plan role, no other invitee name in a `plan_probe` body, a reveal only at or after `plan_booked`, at most one plan invite per member in 7 days, and the intro cap stays unchanged. A probe after booking is a late joiner and carries no names (`block-target-plan.test.ts:18-34`). The checks read `delivered` records only.

### 3.7 invite-growth (P2, simulator only)

`growth.ts` models: invite accepted with probability, join after a delay, newcomer joins, a bad actor share, and the inviter is accountable (`invitee_held`, `scenarios.ts:343`). The service has no such path: `NetworkContext.invite` is not set (`invites-honest.test.ts:1-2`, `service-apps.test.ts:559-571`). The staff invite is a different machine (`invited` membership, `service-apps.test.ts:429-445`). Do not model this machine for production. `friendFactory` sets `minorShare: 0` (`growth.ts:25`), so a minor invitee is not exercised. See defect H-12.

### 3.8 persistence-restart (P1)

Rule (`store.test.ts:1-3`): a Network that restarts from stored state does exactly what an uninterrupted one does. Sent messages, logs, meetings, counters and `exportState` are equal (`store.test.ts:67-71, 133-135`).

Other rules:

- The state version must match, or `importState` throws (`store.test.ts:82`).
- `runTick` loads, ticks and saves under the lock. A held lock skips the tick and leaves `lastTick` unchanged (`store.test.ts:151-157`).
- An inbound waits for the lock and is never skipped. A tick skips (`store.test.ts:177-183`).
- Two Networks on one store: a STOP in one survives the other's next tick (`store.test.ts:160-176`). The load before each unit is what makes this true.
- `PgStore.save` deletes rows the state no longer holds (`store.test.ts:234-238`) and rewrites participations (`store.test.ts:253-282`).
- Eight networks tick at once and the pool does not deadlock (`service-apps.test.ts:475-484`).

Quint notes: model the store as one value and each Network as a local copy that is loaded at the start of a unit. Check "no lost update" under the lock. Remove the lock in a mutant to confirm that the invariant fails. Crash points: after `sends` are chosen and before the save, and after the save and before the adapter (SVC-12).

## 4. Consent, turn and delivery

### 4.1 consent-stop (P0)

State lives in four places. This is the core risk.

| Store | Field | Written by |
|---|---|---|
| `platform.consent_events` | ledger, global row has `app_id` null | `recordConsent` |
| `network.members.opted_out` | per app | unit `optOut` |
| `platform.memberships.state` | `active`, `paused`, `restricted`, `removed`, `invited`, `onboarding` | `stopped`, `putMembership` |
| Gateway fence | copy of `consent {state, scope, app, at}` | turn response |

Resolved consent: `resolveConsent` in `packages/platform/src/consent.ts:37-43`. A global opt-out beats an app opt-in unless the opt-in is newer.

| Event | Guard | Effect | Evidence |
|---|---|---|---|
| STOP on the shared line | none | one global ledger row, all apps opted out, memberships paused | service-platform.test.ts:150-153 |
| STOP on an app line, `PLATFORM_STOP_SCOPE=app` | none | that app only | service-apps.test.ts:197-206 |
| STOP ALL on any line | none | every app | service-apps.test.ts:213-216 |
| Site stop button | none | every app by default | service-apps.test.ts:525-529 |
| START on an app line | not banned, not on hold, newer than the last STOP | that app only, membership active | service-platform.test.ts:155-156, eliza-takeover.test.ts:191-194 |
| Older START | ledger time older | ledger row, no `consent` in the response, still opted out | eliza-takeover.test.ts:185-189 |
| START banned or held | | no change | eliza-takeover.test.ts:203-220 |
| leave <app> | any line | forget that app, scope app consent | service-apps.test.ts:225-231, eliza-takeover.test.ts:196-199 |
| STOP from a stranger | | ledger event, later join is a fresh opt-in | service-platform.test.ts:431-439 |
| Text after STOP | once per 30 days from the last hint | hint, text still reaches the Network | service-platform.test.ts:442-476 |
| DB `opted_out=true` by any writer | | sends refused | service-platform.test.ts:420-430 |
| Replay of a turn after STOP | | 403 or 409, the turn is not rerun | shared-agent.test.ts:121-122 |

Invariants:

- CON-1 (PRD 40.3): STOP on the shared line stops every app.
- CON-2: a compliance reply still goes out when everything else is refused (`cloud-outbound.test.ts:194-198`).
- CON-3: one STOP gives one ledger event and one confirmation, also after a failed unit (`service-platform.test.ts:478-501`).
- CON-4: a banned or held number is never opted back in.
- CON-5 (to check): `resolveConsent = opted_in` implies `opted_out = false`, and the reverse (defect H-02).
- CON-6: only one system answers STOP. A handled response that changed consent carries `consent`, valid under the gateway's checks (`gateway-fixtures.test.ts:68-74`).

Concurrency: the ledger write commits first, and it is a separate transaction from the unit (`service.ts:1323-1333`). So STOP has crash windows after the ledger and before the member row. `rescueCompliance` covers the error path in a signed turn. A process death after the ledger write leaves a `processing` row, then `unresolved`. The ledger still holds the STOP, and the send fences read the ledger. The member row and membership may lag. No test covers the process-death path.

Out-of-order delivery: the late START case is tested. The late STOP case is not (defect H-02).

Quint notes: model all four stores as separate variables. Actions: `recvStop(at)`, `recvStart(at)`, `leave`, `web stop`, `ban`, `hold`, `crash`, `deliver order`. Use a nondeterministic arrival order. Merge with signed-turn. Abstract time as an integer. Bound 2 apps, 1 person, 4 events.

### 4.2 age-policy (P0)

State: `platform.people.lowest_age`, `platform.age_floor(phone_hash, lowest_age)`, `network.members.age`, Network `minor`, `minorSignal`, `declined` set.

Rules from tests:

- Lowest age wins, across apps and later joins (`service-platform.test.ts:213-230`).
- A join with a higher age never raises it (`service-platform.test.ts:248-249`).
- A failed cross-app write after the person commit is repaired by a repeat, and the snapshot already reads the canonical age (`service-platform.test.ts:261-290`).
- Under 13 at text join: nothing stored except the floor, which refuses a retry with an older age on text and web (`service-apps.test.ts:361-374`).
- A 15-year-old on record who says "I am 12": forgotten, keeps only the id, floor stays (`service-apps.test.ts:149-160`).
- An adult on record who says "I am 12": held, rows stay, other apps treat them as a minor at age 13 (`service-platform.test.ts:292-311`). A figure of speech changes nothing (`:301-302`).
- Text in a sentence is not an age (`service-apps.test.ts:307-333`).
- A minor is never enrolled in slop through looking_for, and gets copy without dating (`service-platform.test.ts:195-205`).
- A minor posts no job (`peon-postings.test.ts:93-100`) and gets no seat (`peon-seats.test.ts:73-74`).
- Ages below 18 delete every photo and rating on every app (`service-safety.test.ts:383-390`).
- Age kept after delete-all: `Accounts.deleteAll` writes the floor first (`accounts.ts:437`). Checked: a minor who deletes everything cannot rejoin as an adult.

Transition to watch: `recordAge` then `ageLowered` only lowers `members.age` (`service.ts:776-785`). The forget happens later, when the Network reads an under-13 record on the next inbound (`store.test.ts:274-278`). See defect H-08.

### 4.3 text-join (P0)

State: `platform.pending_texts(phone_hash, kind, app_id, name, age, home_city, at)` with kinds `join`, `looking_for`, `share`, valid for one day (`service.ts:996`, `pg-store.ts:287`). Nothing else is stored before the age check.

Path results: `join_asked`, `joined`, `under_age`, `held`, `handled`, `left`, `stopped`, `duplicate`, `retry_later`, `failed`, `no_network`.

| From | Event | Guard | To | Evidence |
|---|---|---|---|---|
| stranger | any text | open app or shared line | join_asked, nothing stored | service-apps.test.ts:122-126 |
| stranger | keyword | | join_asked on that app | service-apps.test.ts:167-169 |
| join_asked | name and age | age >= 13 | joined, consent `inbound_message` with the words asked | service-apps.test.ts:128-132 |
| join_asked | under 13 | | under_age, floor | service-apps.test.ts:144-147 |
| joined on ntwrk with no keyword | | | looking_for pending | service-platform.test.ts:171-175 |
| looking_for | answer | age check per app | enrolled, pending deleted | service-platform.test.ts:180-189 |
| any app, known person | "slop" then age | | joined, link notice | service-apps.test.ts:185-191 |
| link notice | SHARE | last app wrote | share grant, nothing copied | service-apps.test.ts:193-195 |
| invited | reply with age | | joined | service-apps.test.ts:437-442 |
| banned number | any | | held, no reply | service-safety.test.ts:174-176 |

Eliza notice: one per phone, keyed hash, only for a non-member, not for under-13 contact (`eliza-takeover.test.ts:74-120`). The notice row commits before the join. `turn.onFail` removes it after an exception (`inbox-order.test.ts:161-171`). See defect H-05.

A cached prompt loses admission after a new under-13 floor (`eliza-takeover.test.ts:103-106`).

### 4.4 webhook-inbox (P1)

`platform.inbound` rows with `request_hash` null. States: `pending`, `done` (outcome text), `failed`. `attempts` max 5. Outcome `cancelled_by_stop`.

| From | Event | To | Evidence |
|---|---|---|---|
| none | webhook | pending | inbox.ts:179 |
| none | duplicate id | no row, `duplicate` | service.test.ts:107 |
| pending | handled | done, event and sender wiped | inbox.ts:263 |
| pending | error, attempts < 5 | pending, later rows wait | inbox.ts:275-277, inbox-order.test.ts:81-84 |
| pending | error, attempts = 5 | failed, alert | inbox.ts:269-273 |
| pending | earlier than a handled STOP | done, cancelled_by_stop | inbox-order.test.ts:55-64 |

Rules: compliance goes ahead, including ahead of a failing row. HELP and leave do not cancel earlier rows (`inbox-order.test.ts:70-85`). A later message is a new act (`:64-67`). The tick drains (`service-platform.test.ts:495`).

### 4.5 signed-turn (P0)

`platform.inbound` rows with `request_hash` set. Columns: `status`, `arrived_at` (the lease), `sender_hash`, `response`, `replies`, `receipt`, `receipt_hash`, `action_receipts`, `network_authority`, `member_id`, `app_id`.

States: `processing`, `done`, `unresolved`, tombstone (`unresolved` with `response` null and `sender_hash` null), deleted.

| From | Event | Guard | To | Evidence |
|---|---|---|---|---|
| none | signed turn | no other `processing` row for the sender. Ordinary text also needs no `pending` and no recent `unresolved` | processing | inbox.ts:94-98 |
| none | blocked | | no row, 409 turn_busy retryable | inbox.ts:102 |
| processing | run ok | row still processing | done | inbox.ts:117-120 |
| processing | run throws, not compliance | | unresolved, undo | inbox.ts:126-128 |
| processing | throws, compliance, something committed | | done, `compliance_partial` | inbox.ts:144-162 |
| processing | throws, compliance, nothing committed | | row deleted, 409 turn_failed retryable | inbox.ts:148-152 |
| processing | lease older than 2 min, next turn of the sender | | unresolved | inbox.ts:92 |
| processing or unresolved | staff resolve | | unresolved, sender_hash null | inbox.ts:211-215 |
| done | purge window | | unresolved, payload gone | inbox.ts:198, shared-agent.test.ts:200-208 |
| done | leave, delete-all | | unresolved, payload gone | runtime.ts:525, pg-store.ts:309 |
| unresolved tombstone | purge + 30 days | | deleted | inbox.ts:203 |

Replay rules (`inbox.ts:101-107`): same hash and done returns the stored JSON. Other hash gives 409 turn_conflict, not retryable. Same turn running gives turn_busy. Unresolved gives turn_unresolved. An `open` response is rechecked at replay: STOP revokes it (`shared-agent.test.ts:121-122`).

Invariants:

- SIG-1: one `processing` turn per sender. Enforced by the sender lock and a partial index.
- SIG-2: effects of a turn run at most once. A committed collection followed by a fault is never rerun, also after a tick (`shared-agent.test.ts:126-139`).
- SIG-3: a live worker renews its lease and is never swept (`inbox-order.test.ts:145-159`).
- SIG-4 (claimed by the header, inbox.ts:19 and :252): STOP, START and HELP are never held back. The code does not meet this during a `processing` turn (defect H-01).
- SIG-5: `open.context` is strict and leak-checked (`eliza-takeover.test.ts:141-144`, `shared-agent.test.ts:411-446`).

Quint notes: model with `lease: Row -> Time`, `workerAlive: Row -> bool`. Actions `claim`, `renew`, `finish`, `throw`, `crash`, `sweep`, `resolve`, `purge`, `replay`. Check SIG-1 and SIG-2 and "no text is held for more than 10 minutes". Clock skew is a separate action that advances one instance's clock.

### 4.6 turn-receipt (P1)

`receipt`, `receipt_hash` on the row. Messages `collected`, `send_unknown`, `sent`, `refused_gateway`.

| From | Event | To | Evidence |
|---|---|---|---|
| none | unknown | unknown | shared-agent.test.ts:83-84 |
| none or unknown | accepted | accepted, message sent | shared-agent.test.ts:85-87 |
| same receipt | replay, also reordered keys | no change, `replayed: true` | shared-agent.test.ts:88, 312-314 |
| accepted | other provider ids | 409 | shared-agent.test.ts:89, 315-319 |
| any | foreign reply ids | 409 | shared-agent.test.ts:82 |
| any | after erasure | 409 | shared-agent.test.ts:243 |

`historyRecorded:false` is valid only for the account-free join prompt (`eliza-takeover.test.ts:85-91` against `:131-135`). Replies stored `collected` never reach a provider after a restart (`shared-agent.test.ts:78-91`).

### 4.7 action-receipts (P1)

JSON map `action_receipts` on the parent open turn. Entry states `completed`, `unresolved` (`shared-actions.test.ts:105`, `shared-relay.test.ts:226`).

Rules:

- Bound to the original open turn, app and member. `messageId` of another turn, or another member or app, is 403 (`shared-actions.test.ts:46-48`).
- Same key and same body replays with `replayed: true`. Changed body is 409 (`:52-53`).
- A fault rolls back the effect and leaves the receipt `unresolved`. A retry is 409 and does not repeat the effect (`:108-114`, `:91-105`).
- STOP revokes every cached action of that turn (`:115-117`).
- Erasure clears the map (`:119-121`).
- Updates: one inbox read per turn, app scoped, and a rollback keeps the item unread (`:80-106`).

### 4.8 route-authority (P0)

Policy `{authority, admitUntil, drainUntil}`, `PLATFORM_ENV=staging` only (`shared-agent.test.ts:339-354`). Phases: `admit` (new turns), `drain` (replays, receipts and actions of known turns), `closed` (403). The check runs again after each lock wait (`shared-agent.test.ts:356-408, 448-481`). A refused action rolls back unread changes. Legacy turns work after isolation ends (`:335`).

Invariants: a turn without the exact authority never writes `platform.inbound` (`:268-273`). After `drainUntil` nothing succeeds, also after a restart (`:329-334`).

### 4.9 outbound-admission (P0)

`platform.outbound.status`: `pending`, `retry_scheduled`, `deferred_quiet_hours`, `held_awaiting_reply`, `sending`, `unknown_acceptance`, `accepted`, `sent`, `delivered`, `read`, `collected`, `expired`, `dropped_forgotten`, `dropped_leak_review`, `parked_leak_review`, `refused_opted_out`, `refused_person_cap`, `refused_not_approved`, `suppressed_*`, `blocked_*`, `failed_*` (`outbound-queue.ts:189-195`, `cloud-outbound.test.ts:193`).

Rules:

- Dispatch that returned unknown is never sent again. A receipt lookup resolves it (`cloud-outbound.test.ts:42-71`, `shared-relay.test.ts:159-166`).
- A worker that stopped with a stale `sending` lease goes to `unknown_acceptance`, never to a resend (`cloud-outbound.test.ts:72-83`).
- Erasure never waits on remote receipt I/O and wins over a late receipt (`:84-101`).
- Admission reruns after the async leak gate. Leave, hold, ban and paused state win (`:104-136`, `:161-207`). The table of end states is at `:193`. Paused, restricted and review stop proactive sends only. Phone hold and ban stop replies too. A compliance reply passes a restricted account (`:194-198`).
- Expiry: a queued proactive row 30 hours old and a queued reply 4 days old end `expired`, and a reply 1 hour old is sent once (`service-platform.test.ts:344-385`). A notification rechecks its `expiresAt` (`:313-342`).
- Same id with other content fails the unit (`service-platform.test.ts:527-538`). Same content is idempotent.
- An adapter error after commit keeps the row. The next tick delivers it once (`service-platform.test.ts:503-525`).
- No send without both live flags (`service.test.ts:246-275`, `service-apps.test.ts:269-282`).

### 4.10 leak-review (P0)

`parked_leak_review -> dropped_leak_review` or a release. A reason of 5 or more characters is required. A second decision returns `not_parked` (`cloud-outbound.test.ts:229-240`). Listings carry no phone number (`:234`). A parked reply is excluded from the collected list (`:225`). Only the drop path has a test. The release path has none here.

### 4.11 person-cap (P0)

`platform.person_sends(msg_id, person_id, app_id, at)`, `person_cap_take`, `person_cap_release`, `platform.outbound.person_cap`.

Rules (`service-apps.test.ts:234-264`, `:405-427`): at most 3 proactive in a rolling 24 hours for one person, across apps. Transactional messages do not count. The same id is not counted twice. A release gives back the slot. Two networks at once cannot pass the cap. The function works under row-level security.

See defect H-09: two take sites and one release flag.

### 4.12 notify-projection (P1)

`network.messages.notification_recorded_at`, `notify.deliveries`. A receipt or acceptance writes the delivery and then the marker, in two steps. A fault between them is repaired by a replay or by `runtime.start` (`shared-agent.test.ts:149-198`, `cloud-outbound.test.ts:59-71`). `unknown` writes no delivery. Message status drift is repaired once (`cloud-outbound.test.ts:241-248`).

## 5. Relay and photos

### 5.1 relay-desk (P0)

State: JSON state `relay.threads`, `relay.held`, `network.relay_records` (`decision`, `review`, no bodies), `platform.outbound` rows with id `relay:*`, receipt in `action_receipts`.

Decisions: `pass`, `hold`, `block`, `none`.

| Input | Guard | Decision | Effect | Evidence |
|---|---|---|---|---|
| "tell X ..." on an open turn | active pair, text clean | pass | engine wording only, row `relay:*`, `Sent.` only when accepted | shared-relay.test.ts:102-108 |
| not a relay | | none | nothing queued | relay.test.ts:88 |
| no match | | block | notice without the text | eliza-takeover.test.ts:162-164 |
| scam | classifier or rules | hold | staff list, reject erases text | relay.test.ts:93-125 |
| classifier outage | | hold | nothing sent | shared-relay.test.ts:168-171 |
| production with no Clef | | hold for every text the rules pass | | relay-classifier-env.test.ts:13-19 |
| first contact ask | | hold, the other is asked once | number not sent | shared-relay.test.ts:110-113 |
| second ask inside 15 min | both asked | pass, both numbers | relay.test.ts:147-157 |
| second ask after 15 min | stale | hold, roles swap | relay.test.ts:127-133 |
| "don't send my number" | | request dropped | relay.test.ts:134-144 |
| minor recipient | | block | shared-relay.test.ts:231-235 |
| photo on the text wire | | block | relay.test.ts:89 |
| third member's private fact | | not pass | shared-relay.test.ts:120-124 |
| text with an unrelated number | | hold | shared-relay.test.ts:118-119 |

Binding rules: `text` must equal the member's own message of that turn, `memberId` and `app` come from the open response, `itemId` must be an offered item, the signature id is `<messageId>:relay`, extra fields are 400, size is 413 (`relay.test.ts:66-76`).

Rules on time and order:

- The thread lives after the date. A text 9 days after the meeting passes (`relay.test.ts:167-175`). So `done` is a relay-open stage and `closed` is not.
- Classification runs inside the unit. A close waits for it (`shared-relay.test.ts:174-190`).
- A close or recipient STOP after the leak gate wins at final admission. The sender still gets `pass` with `delivered:false` (`:191-208`).
- A quiet-hour row rechecks the match before dispatch (`:209-213`).
- A transaction fault rolls back receipt, messages and rows together. The retry is 409 (`:218-230`).
- The sender's STOP revokes the turn's right to relay (`:237-239`).
- Lock order: relay dispatch takes `network_state` for share first, and leave takes it first too (`shared-relay.test.ts:255-292`, `channel.ts:198`).

Note on sender notice: a `pass` with `delivered:false` is a real state that the member sees as "not sent" wording. The model needs `decision` and `delivered` as two variables.

Quint notes: variables `pairStage`, `consentSwap: Member -> Option[Time]`, `held`, `queueRow`, `stop`, `leave`. Check: a number is sent only if both asks are inside the TTL, and "no dispatch after close, STOP, leave or minor". Merge with outbound-admission.

### 5.2 photo-relay (P0)

Item states: `pending`, `approved`, then delivered, `rejected`, `revoked`. Fields: `reviewId`, `actionId`. Queue id `relay:pri_*`.

Rules (`shared-relay.test.ts:301-379`):

- No policy loaded means `select` returns nothing (`:312`).
- Staff preview needs an audit row first. An audit failure gives 503 and no storage read (`:316-322`).
- Release needs the review token from the preview.
- A queue insert fault rolls back the claim, but the human approval stays: `approved`, `actionId: null` (`:333-341`). This is a distinct resume state.
- A reviewer who loses authority cannot release (`:342`).
- Unknown acceptance survives restart with the JSONB refs. Same id with a changed photo throws `outbound id reused` (`:345-353`).
- A second release sends nothing (`:358`).
- Revoke after send kills the capability link with 404 (`:360-361`).
- Revoke or reject after the async gate ends the row `suppressed*` (`:362-378`).

### 5.3 photo-rating (P0)

Rules (`service-safety.test.ts:295-391`): a stated adult age is enough. A staff age failure refuses upload and removes the rating. A pass restores upload. One rating per member, recomputed on delete. Leave deletes bytes and rows. A minor age on any app deletes all photos and ratings on all apps, and upload is refused. Rating is `agent_private`. Scores never show in staff listings (`relay.test.ts:101`).

## 6. Other implicit machines

### 6.1 participation-window (P2)

`network.members.participation_state`, `participation_window`. Wire states `open`, `busy`, `traveling`, `paused`. `busy` maps to stored `quiet`. `receiving` reads as open on the wire (`shared-agent.test.ts:118-120`).

`set-state` is idempotent by key. `unchanged=true` writes no event (`shared-actions.test.ts:50-56`). A scheduled state is projected only inside its window and survives restart. After the window the base state returns (`:68-78`). `effectiveParticipation` in `snapshot.ts:20` serves both context and snapshot, so matching and the agent agree.

### 6.2 peon-posting (P2)

Text post: draft in `awaiting: posting` -> read-back -> yes -> `network.intents` row `active` and facets -> staff close -> `closed`, `peon:openings:0` (`peon-postings.test.ts:76-128`). Nothing is saved before the yes (`:83`). Seats: capacity = openings minus accepted minus open opportunities (`peon-seats.test.ts:95-105`). A minor's post has no seat. Posting facets move from the manager to `job:<id>` in the snapshot (`peon-seats.test.ts:75-76`).

### 6.3 slop-onboarding (P2)

Loop: orientation -> seeks -> gender -> age range -> distance -> read-back -> yes -> soft questions (`service-apps.test.ts:573-607`). `bi` names no seeking set and is asked in other words. After two unclear asks, a woman or man reads as straight, shown in the read-back (`slop-date-path.test.ts:243-264`). A clear negation is read as said (`:266-284`). The stored state holds tags, never the member's words (`service-apps.test.ts:606`).

### 6.4 profile-suggestion (P0)

Tables `platform.profile_suggestion_batches` (`revision`, `expires_at`, `retain_on_disconnect`, `chat_id`), `platform.profile_suggestions` (`status`: `proposed`, `accepted`, `rejected`, `expired`, `withdrawn`). Promoted facts have id `source-suggestion:<id>`.

| From | Event | Guard | To | Evidence |
|---|---|---|---|---|
| none | propose | owner, active source, exact window, clean value | proposed, batch rev 1 | profile-suggestions.test.ts:61-71, 158-166 |
| proposed | decide accept, exact rev | owner, source active, not expired, not banned | accepted, value wiped from pending row, fact created | :65-68 |
| proposed | decide with edit or scope change | | proposed, rev + 1, preview only | :101-116 |
| proposed | decide with one bad item | | no change at all | :110-112 |
| proposed | reject | no source proof needed | rejected, value wiped | :118-120, 656-677 |
| proposed | expiry at `decide`, `getPendingBatch` or purge | | expired, value wiped | :222-229, 251-260 |
| proposed | source disconnect | also after STOP | withdrawn, value wiped | :128-143, 210-220, 716-718 |
| accepted | disconnect, not retained | | fact removed | :136-143 |
| accepted | disconnect, retained | | fact stays | :136-143 |
| any | deleteBatch | owner, also when banned | batch and linked facts gone | :145-156, 269-276 |
| any | leave, delete-all | | gone, unrelated facts stay | :153-155, 194-208 |

Invariants:

- SUG-1: a pending value never enters any snapshot (`:64`).
- SUG-2: one approval makes one fact, under a race (`:180-185`).
- SUG-3: a fence that expires after writes rolls back everything (`:568-579`).
- SUG-4: a Google-derived fact never reaches matcher input or background tags, also when confirmed (`crossapp.test.ts:147-181`, `:1061-1122`).
- SUG-5: a bare yes never approves (`profile-suggestion-review.test.ts:21-24`).
- SUG-6: a NaN clock denies (`:262-267`).
- SUG-7: owner proof is one request, one attempt, no cache, bound to the stored signed turn (`:462-549`).

### 6.5 collection-claim (P0)

An `action_receipts` entry on the parent turn plus one batch id. Concurrent replay gives one batch (`:722-743`). A replay never recreates a batch after delete, reject, edit or withdraw (`:745-762`). A fault rolls back batch and receipt (`:764-775`). The parent turn must be signed, `open`, same member and same text (`:777-792`). The deadline uses the original turn time and is fixed (`:901-917`, vectors in `fixtures/learning-collection-command-vectors.ts:33-38`).

### 6.6 profile-cleanup (P0)

V1 disconnect: `platform.profile_suggestion_connection_receipts`, one row per nonce, runtime role has SELECT and INSERT only (`profile-cleanup-reconciliation.postgres.test.ts:458-467`). V2 withdrawal: receipt in `action_receipts` under `profile-withdrawal-v2:<id>`.

Operations: `disconnect`, `withdraw`, `delete`, `readback`. Cutoff `revokedAt` or `cutoffAt` is immutable. Only batches created before the cutoff change (`profile-suggestion-disconnect.test.ts:87-111`, `profile-suggestion-withdrawal.test.ts:75-92`). A retry returns the original counts without any write (`profile-cleanup-reconciliation.postgres.test.ts:277-340`). A changed proof after writes rolls back data and nonce together (`profile-suggestion-disconnect.test.ts:130-144`). Withdraw keeps accepted facts. Delete removes them. A partial or legacy receipt denies (`profile-cleanup-reconciliation.postgres.test.ts:457-513`). Two owners sharing one nonce commit once (`:544-591`).

### 6.7 learning-context-proof (P0)

Stateless read with a 30-second proof capped by the parent turn (5 minutes) and the route (`profile-suggestions.test.ts:878-972`). Denied by STOP, ban, phone hold, minor age, removed membership, a second phone identity and a changed sender. It writes nothing.

### 6.8 staff-audit (P1)

Phases `requested`, `result`, `refused`. Staff actions write `requested` before the effect and `result` after (`service.test.ts:213-214`, `service-safety.test.ts:188-192`). A refused action writes `refused` (`service-apps.test.ts:303`). Malformed input writes nothing (`service-platform.test.ts:562-567`). An audit failure before the photo read stops the read (`shared-relay.test.ts:316-322`).

### 6.9 matching-switch (P1)

A new network starts off (`service.test.ts:171`). `matchingAllowed` from `platform.networks` can refuse on (`service-apps.test.ts:297`). The switch persists in state across restart under the RLS role (`service-platform.test.ts:400-414`). With matching off, a request waits (`network.ts:1637`).

### 6.10 phone-hold-suppression (P0)

`phone_identities.hold` (`recycled_number`), `platform.suppression(phone_hash, reason)`. A held or suppressed number gets no saved-profile read (`shared-agent.test.ts:632-638`). Delete-all writes suppression, and a new join clears it (`accounts.ts:374`). A ban also writes suppression (`service.ts:1751`). A ban survives delete-all (`service-safety.test.ts:180-185`).

## 7. Suspected defects

Each was checked by reading the code named. None was run. Confidence is about the code behavior, and the "impact" line says what is not known.

### H-01 STOP is refused while another turn of the sender is processing (P0, confidence high on behavior, medium on impact)

- Where: `packages/network/service/inbox.ts:96-97`. The clause `status='processing'` is outside the `not ${keyword}` guard. The comments at inbox.ts:19, :84 and :252 say STOP, START and HELP are never held back, and :252 says the webhook path handles them at once "as signed() does".
- Trigger: turn A for a sender is running (an LLM read, lock waits). The lease has no upper bound because it renews every 30 s (inbox.ts:111). The sender texts STOP. `signed()` inserts nothing and returns 409 `turn_busy` with `retryable: true`.
- A crash makes this worse: a dead worker's row stays `processing` for up to 2 minutes, and STOP is refused for that time.
- The webhook path differs: `handleWaiting` lets compliance pass a running turn (inbox.ts:254).
- Test gap: `inbox-order.test.ts:145-159` checks an ordinary text only.
- Impact not known: the upstream gateway's retry policy for `turn_busy`. If it gives up, the STOP is lost and neither system answers it.

### H-02 A late STOP splits the consent stores (P0, confidence high on behavior; fails closed)

- Where: `service.ts:1322-1333` against `:1105-1107`, and `packages/platform/src/consent.ts:41-42`.
- Trigger: STOP at time t and START at t+1 arrive in reverse order. START is handled first. Then STOP is recorded with `consentAt` = t. The ledger resolves to `opted_in`, because the app opt-in is newer. But `memberMessage` sets `opted_out`, and `stopped` pauses the membership, and the response carries `consent: opted_out`.
- START has a guard for this at :1107. STOP has none. `eliza-takeover.test.ts:185-189` tests only the START direction.
- Result: `accounts.optedIn` is true while `network.members.opted_out` is true and the membership is `paused`. Sends are refused by runtime.ts:579. The person's last word was START, and the gateway fence depends on how it orders `at`.
- Also a global STOP with a newer START on one app only: the ledger is mixed by design, but the member rows do not follow it.

### H-03 STOP on a route with no runtime is ignored (P0, confidence high on code path, medium on reachability)

- Where: `service.ts:1040`, `if (!rt) ... return "no_network"`, comes before the STOP branch at :1054. `service.ts:2093` maps it to `{outcome:"ignored"}`.
- Trigger: a signed turn with `app` set to an app with no running network, or an `app_lines` row for such an app, with text STOP. Nothing is written to the ledger and the gateway gets `ignored`.
- `eliza-takeover.test.ts:237-238` proves that `no_network` gives `ignored`, but only for the domain text.
- Reachability: `gateway-fixtures.test.ts:7` says the gateway sends no `app`. Other tests send it, and the contract permits it. AGENTS.md says peon and friends run locally only, so the runtime-less case can exist in production.

### H-04 A hold is not inherited, not atomic and not lifted across apps (P0, confidence high for the first and third, medium for the second)

- Later join: trust is per network state. `holdMember` is called only from `service.ts:1681, 1684`. `createMember` (`service.ts:723`) and `Accounts.joinLocked` (`accounts.ts:350-395`) never read a hold. A person on hold on slop can join friends as `ok`. `service-safety.test.ts:130-158` has the second membership exist before the hold.
- Non-atomic: `service.ts:1681-1684` commits one unit per network. A fault after the first leaves a partial hold, and `audited` records no `result`. A repeat does not fail, so staff can retry, but nothing tells them to.
- Lift: `liftHold` runs on one runtime (`service.ts:1540-1541`) although `hold` is every-app. Staff must lift on each app. No test covers lift across apps.

### H-05 The one-time notice can be spent and never delivered (P1, confidence high)

- Where: `service.ts:1187-1195`, `inbox.ts:92`.
- The notice row and the collected reply commit before the join runs. `turn.onFail` is in memory. If the process dies, the sweep at inbox.ts:92 marks the turn `unresolved` and runs no undo. A replay is refused. The next message finds the notice row and gets no notice.
- `inbox-order.test.ts:161-171` covers only the thrown-error path. The comment at service.ts:1193 claims the next contact still gets the notice.

### H-06 A ban that fails midway cannot be finished by staff (P0, confidence medium)

- Where: `service.ts:1742-1760`. The ban row, suppression, ratings, memberships, member rows and `markBanned` are separate commits.
- Trigger: a fault after `people.ban` (:1750). A retry finds `isBanned` true and returns `already_banned` (:1743). Memberships stay `active`, `account_status` stays `active`, and `markBanned` never ran on some apps.
- Partial mitigation: the join gate and the final send fence read the ban (`cloud-outbound.test.ts:187, 193`). Matching eligibility on the other apps was not traced for this note.

### H-07 A signed STOP does not cancel the sender's pending webhook rows (P2, confidence high, low reachability)

- Where: `cancelBefore` is called only from `handleWaiting` (inbox.ts:266). `signed()` has no such step.
- Trigger: during a cutover, a webhook row is `pending` (it failed once) and a signed STOP arrives. The next `drain` handles the older row after the STOP. The README says a join answer handled late would opt the person back in.
- AGENTS.md says production has no Blooio webhook, so this matters only in a mixed period.

### H-08 An under-13 age from a repeated web join leaves active memberships until the next inbound (P0, confidence medium)

- Where: `accounts.ts:358-362`, `service.ts:776-785`.
- Trigger: an adult member repeats `POST /api/join` with age 12. The response is `under_age`. Ages drop to 12 on every app, but memberships stay `active` and member rows stay `active`. The forget or hold decision happens only when the Network next reads an inbound (`store.test.ts:274-278`).
- `service-platform.test.ts:252-257` checks the error and the lowest age only.
- Mitigation: an age under 18 blocks matching. Whether info messages reach this record before the next inbound was not traced.

### H-09 Person cap has two take sites and one release flag (P1, confidence medium)

- Where: `runtime.ts:583` takes the slot on handoff. `outbound-queue.ts:424-425` takes it at step 9, and only that path sets `person_cap`. `outbound-queue.ts:345` releases only if `row.personCap`. `runtime.ts:592` releases only statuses seen at hand-off.
- Trigger: a proactive row takes a slot in the runtime, then waits in `deferred_quiet_hours`, then ends `expired` or `suppressed_*` before step 9. Its slot is not given back for 24 hours. Fails safe: fewer sends.
- Founder decision 7 says the cap is checked at send time. For a deferred row, `person_sends.at` is the handoff time, because step 9 sees the id and skips the count (migration 0007 line 179). The rolling window is thus measured from handoff.

### H-10 Scenario checks that can pass with no evidence (P2, confidence high for traveler)

- `traveler` (`scenarios.ts:358-359`): `announced` reads `world.snapshot()` at the end of the run. `sim/src/snapshot.ts:188` lists a trip only while `now < to`. A trip that ended before day 8 gives `announced = false`, the loop runs zero times, and the detail still says "5 travelers checked".
- `bad_invitee` (`scenarios.ts:341-343`): each check has a `!invitee` or `attempts === 0` escape. With no attempts the scenario passes without testing accountability.

### H-11 The harness counts a counter as a yes (P2, confidence high)

- Where: `experiment.ts:138`. `said === "counter"` goes into `yesBy`, so `inviteYes`, `inviteAcceptRate` and `proposalsAllYes` include counters. AGENTS.md item 11 says a counter is not a yes. This affects metrics only. Consent decisions in the network use `parseReply`.

### H-12 The growth model has no production path (P2, test gap, confidence high)

- `growth.ts` and `scenarios.ts:310-346` prove invite rules that the service cannot reach (`service-apps.test.ts:559-571`). `invitesSent` and vouch accountability in results describe a simulated feature only. `minorShare: 0` also means a minor invitee is never tested.

### H-13 `arrived_at` has three meanings (P2, confidence high, small effect)

- It is the arrival, the lease (inbox.ts:112) and the unresolved hold start (:97). `profile-suggestions.test.ts:901-917` expects the collection deadline to use "the original Network arrival". A turn that runs past 30 s moves that time. A slow parent turn would get a later deadline. Quint should model `arrivedAt` and `leaseAt` as one variable to expose this.

### H-14 The reconciliation suite never runs by default (P1, test gap, confidence high)

- `profile-cleanup-reconciliation.postgres.test.ts:29-32` and :222-230 need two variables that no CI file or script sets. Its rules for retry and rollback are not checked in CI.

### Checked and cleared

- Ban by person and then delete-all: `ban` stores `phone_hash` also for scope person (`service.ts:1747`) and `isBanned` matches `phone_hash` whatever the scope (`pg-store.ts:174`). The number stays banned, and the revived tombstone does not help.
- Minor who deletes everything and rejoins older: `Accounts.deleteAll` writes the age floor first (`accounts.ts:437`).
- Personal reply text after staff `resolve` clears `sender_hash`: the forget path also matches `member_id` and `app_id` (`runtime.ts:525-527`).
- Scheduled participation and matching: `effectiveParticipation` serves both (`snapshot.ts:20`, `runtime.ts:711`).
- Receipt order: `unknown -> accepted` is allowed, and `accepted -> unknown` is a conflict (`service.ts:2017`).

## 8. Cross-machine rules to keep in the models

1. Order at dispatch: async gates (consent, leak) -> `lockAdmission` -> `admit` -> provider. Every barrier change after the async gates must win (`cloud-outbound.test.ts:161-207`).
2. Lock order: `network_state` before admission. Leave and relay take it in the same order (`shared-relay.test.ts:255-292`).
3. Never one unit inside another (`service.ts:1683`).
4. Ledger first, then members (`service.ts:1322`). Rows are repaired by replay, not by a transaction.
5. `collected` replies never enter `platform.outbound` (`shared-agent.test.ts:80`).
6. Turn claim commits before effects (`inbox.ts:80`). A failure after effects seals the turn.
7. Erasure seals every payload that names the person, and a later replay is 409, also after restart (`shared-agent.test.ts:210-251`).
8. Cross-app facts allowed: age, block, ban, hold, STOP. Nothing else crosses (`crossapp.test.ts:214-230`). A link notice names no other app (`service-apps.test.ts:192`).
9. A block made on one app holds on every app (`crossapp.test.ts:195-199`).
10. `sim` sets no `invite`, no lock, no outbound queue. A green sim run says nothing about machines in section 4.

## 9. Suggested Quint work

Order by value:

1. `consent-turn.qnt`: merge consent-stop, signed-turn, webhook-inbox and turn-receipt. Bound 1 person, 2 apps, 5 messages, 2 workers. Invariants CON-1 to CON-6, SIG-1 to SIG-4. Expect counterexamples for H-01, H-02 and H-07. Add a temporal check: every STOP reaches the ledger or stays retryable.
2. `dispatch.qnt`: merge outbound-admission, leak-review, person-cap and relay-desk with one barrier variable each. Invariants: no dispatch past a barrier, at most 3 taken slots, unknown never resends. Expect H-09 as a slot leak.
3. `opp-review.qnt`: opp-lifecycle with review-gate and block cancel. Invariants OPP-1 to OPP-6.
4. `safety-crossapp.qnt`: hold, ban, join, lift across 2 apps with crash points between commits. Expect H-04 and H-06.
5. `age.qnt`: lowest age, floor, join, forget, delete-all. Expect H-08.
6. `suggestions.qnt`: profile-suggestion, collection-claim and profile-cleanup. Revision and cutoff as integers.

Use the integer clock as a state variable with an `advance` action, and give each instance a skew offset for lease actions. Keep ids abstract. Do not model text parsing: treat `parseReply`, `detectKeyword` and the join parser as nondeterministic classifiers, and add one action for "misread" where a test shows that risk (`service-apps.test.ts:307-333`).

## 10. Files read

The coverage list is at `coverage/network-harness.txt` in the session scratchpad. Service files were read in part, only to verify the defects above.
