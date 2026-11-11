# State machines: platform consent, leave, blocks, photos, ratings, suggestions, deletion

Scope key: `platform-consent`. Branch `claude/quint-state-machines`. This is research for Quint models. No code was changed.

File references are `path:line`. Short forms:

- `A` = `packages/platform/src/accounts.ts`
- `API` = `packages/platform/src/api.ts`
- `C` = `packages/platform/src/consent.ts`
- `PG` = `packages/platform/src/pg-store.ts`
- `ST` = `packages/platform/src/store.ts`
- `PH` = `packages/platform/src/photos.ts`
- `PR` = `packages/platform/src/photo-relay.ts`
- `SV` = `packages/network/service/service.ts`
- `RT` = `packages/network/service/runtime.ts`
- `PS` = `packages/network/service/profile-suggestions.ts`
- `PI` = `packages/network/service/photoIntake.ts`

Limits of this reading:

- All of `packages/platform/src/` for this scope was read in full, except `sessions.ts`, `proxy.ts`, `turnstile.ts`, `env.ts` and the provider part of `otp.ts`. These belong to the auth scope.
- `SV` and `RT` were read in the regions that touch this scope, not in full.
- Tests were read by test name, and `api.test.ts` was read in the consent, leave and delete sections. `photos.test.ts` and the profile tests were read by name and small ranges.
- Eliza Cloud and the gateway are upstream. Claims about them are marked as open questions.

---

## 1. Machine index

| # | id | Kind | Priority | State lives in |
|---|---|---|---|---|
| 1 | consent-ledger | implicit | P0 | `platform.consent_events` |
| 2 | stop-projection | implicit | P0 | `platform.memberships.state`, `network.members.opted_out` |
| 3 | suppression | implicit | P0 | `platform.suppression` |
| 4 | membership-lifecycle | explicit | P0 | `platform.memberships.state`, `.review` |
| 5 | web-join-saga | implicit | P0 | ordered async steps in `A:351` |
| 6 | leave-forget-saga | implicit | P0 | ordered steps in `A:421`, `RT:521` |
| 7 | delete-everything-saga | implicit | P0 | `A:432`, `PG:304` |
| 8 | person-age | implicit | P0 | `people.lowest_age`, `age_floor`, `network.members.age` |
| 9 | phone-hold | explicit | P0 | `phone_identities.hold` |
| 10 | ban | implicit | P0 | `platform.bans` plus projections |
| 11 | person-block | implicit | P0 | `platform.person_blocks`, `network.edges` |
| 12 | photo-object | implicit | P0 | `platform.photos`, object storage |
| 13 | photo-consent | implicit | P0 | `memberships.profile.photoConsent`, `pending_texts`, `photos.consent_version` |
| 14 | clef-rating | implicit | P0 | `network.facets` row `<member>:appearance`, in-flight rater call |
| 15 | photo-relay-item | explicit | P0 | `platform.photo_relay_items.state` and bindings |
| 16 | pending-text | implicit | P1 | `platform.pending_texts` |
| 17 | stop-hint-window | implicit | P0 | `platform.rate_limits` |
| 18 | suggestion-item | explicit | P1 | `platform.profile_suggestions.status` |
| 19 | suggestion-batch | implicit | P1 | `profile_suggestion_batches.revision`, `.expires_at` |
| 20 | collection-claim | implicit | P1 | `platform.inbound.action_receipts["profile-collect:*"]` |
| 21 | connection-cleanup-v1 | implicit | P1 | `profile_suggestion_connection_receipts` |
| 22 | owner-withdrawal-v2 | implicit | P1 | `inbound.action_receipts["profile-withdrawal-v2:*"]` |
| 23 | public-api-gates | implicit | P1 | guards in `API:301` |
| 24 | share-grant | implicit | P2 | `platform.share_grants` |
| 25 | rater-config | explicit | P2 | `RaterStatus` in `PH:48` |

Suggested Quint merges:

- Model A: `consent-ledger`, `stop-projection`, `suppression`, `stop-hint-window`, `phone-hold`, `ban`. This is the send-permission model.
- Model B: `membership-lifecycle`, `web-join-saga`, `leave-forget-saga`, `delete-everything-saga`, `person-age`. This is the account saga model with crash steps.
- Model C: `photo-object`, `photo-consent`, `clef-rating`, `person-age` (as an input), `ban` (as an input).
- Model D: `photo-relay-item` alone, with the guards of model A as boolean inputs.
- Model E: `suggestion-item`, `suggestion-batch`, `collection-claim`, `connection-cleanup-v1`, `owner-withdrawal-v2`.

---

## 2. Summary of suspected defects

Full evidence is in section 5. Confidence means confidence that the code does this, by reading. No defect was reproduced by a run.

| Id | Title | Priority | Confidence |
|---|---|---|---|
| PC-01 | A `new_owner` decision erases a STOP that the new owner sent during the hold | P0 | high |
| PC-02 | The 2-day purge removes the 30-day window of the STOP hint | P0 | high |
| PC-03 | A banned number can get an OTP code and a session | P0 | high |
| PC-04 | A ban that fails half way cannot be retried: `already_banned` | P0 | high |
| PC-05 | An upload in flight survives age drop, leave and delete everything | P0 | high |
| PC-06 | A web statement under 13 keeps every other membership | P0 | high |
| PC-07 | A failed web join leaves an active orphan network member | P0 | high |
| PC-08 | `clearHold(new_owner)` crash leaves a tombstone that a new owner revives | P0 | high (low likelihood) |
| PC-09 | Whole-row membership writes can undo leave, ban and STOP | P0 | high (low likelihood) |
| PC-10 | Leave, delete, stop and ban do not take the join lock | P0 | medium |
| PC-11 | People from the 0006 backfill have no `phone_hash` | P0 | medium |
| PC-12 | Cloud sign-in refuses a suppressed number, so web rejoin cannot lift it | P1 | medium |
| PC-13 | Connection receipts keep Cloud identity after delete everything | P1 | high |
| PC-14 | Cleanup V1 and V2 touch one chat only | P1 | medium |
| PC-15 | Cleanup cutoff compares two clocks | P1 | medium |
| PC-16 | Exact cleanup retry is denied after the member left | P1 | high (low impact) |
| PC-17 | `owned()` does not bind `m.member_id = n.id` | P1 | medium |
| PC-18 | Suggestion eligibility reads the projection, not the STOP ledger | P1 | high (small window) |
| PC-19 | Cloud HTTP calls run under the person row lock | P1 | high |
| PC-20 | Photo intake by text is unreachable in production, and no client uploads photos | P1 | high |
| PC-21 | The photo count limit has a check-then-act race | P2 | high |
| PC-22 | Crash windows leave orphan bytes or a stale rating | P1 | medium |
| PC-23 | A failed staff age check keeps the photos | P0 | medium |
| PC-24 | No re-consent on a new photo consent version, and no withdrawal | P1 | medium |
| PC-25 | A late old STOP changes the projection but not the ledger | P1 | medium |
| PC-26 | OAuth grants outlive the under-13 decline and delete everything | P1 | medium |
| PC-27 | States written but never read, or never written | P2 | high |
| PC-28 | Owner revoke overwrites a safety rejection | P2 | high |
| PC-29 | A claimed photo item cannot recover after its 60 s capability ends | P2 | medium |
| PC-30 | Text leave loses `ref` and `line` in the ledger | P2 | high |
| PC-31 | Delete everything is open to a banned person | P1 | high (policy question) |
| PC-32 | Terminal suggestion rows and empty batches have no retention | P2 | high |
| PC-33 | Comments disagree with the code | P2 | high |
| PC-34 | Export omits photos | P2 | high |

---

## 3. Machines: consent and send permission

### 3.1 consent-ledger (P0, implicit)

**State.** Append-mostly table `platform.consent_events` (`0003_platform.sql:100`). `ref` and `wording_version` come from `0007`. `platform_service` has no UPDATE (`0007:238`), but it has DELETE. The state is derived for each pair (e164, app) by `resolveConsent` (`C:37`) from two rows: the last app row and the last global row (`app_id is null`).

**Derived states for (e164, app).**

| State | Condition |
|---|---|
| `none` | no app row, and no global opt-out. `resolveConsent` returns undefined. |
| `opted_in` | last app row is in, and (no global opt-out, or app row is strictly newer) |
| `opted_out_app` | last app row is out, and no newer rule applies |
| `opted_out_global` | global opt-out, and no strictly newer app opt-in |

Ordering is by `at desc, id desc` (`PG:139`). The memory store ties to the later entry (`C:50`). A tie between an app opt-in and a global opt-out reads as opted out (strict `>` at `C:42`).

**Transitions.**

| From | Event | Guard | Effect | Actor | Where |
|---|---|---|---|---|---|
| any | STOP text, shared line | none, also on a held number | global out, `ref=rowId`, `at=consentAt(ev)` | member | `SV:1054`, `SV:1322` |
| any | STOP ALL | none | global out | member | `C:99` |
| any | STOP on own line, `PLATFORM_STOP_SCOPE=app` | not shared | app out | member | `C:98` |
| any | web stop | session | global or app out, no ref | member | `API:579`, `A:398` |
| any | START, member | not held, not banned | app in, then read back | member | `SV:1100` |
| any | START, non-member | not held, not banned | app in | member | `SV:1132` |
| any | web join | consent wording, age, not banned | app in, source `web_form` | member | `A:384` |
| any | web join rollback | `onJoin` threw | app out, source `join_failed`, same `at` | system | `A:391` |
| any | text join | age and name | app in, `ref=rowId` | member | `SV:1447` |
| any | enroll by `looking_for` | age, not banned | app in, `ref=rowId:app` | member | `SV:1491` |
| any | leave, web or text | none on ledger | app out, no ref on the person path | member | `A:425` |
| any | leave, text, no person | hold or legacy member | app out with ref | member | `SV:1089` |
| any | under-13 decline | `a.declined` | app out for each membership | system | `SV:1308` |
| rows exist | delete everything | session fresh, not held | every row for e164 deleted | member | `PG:313` |
| rows exist | `clearHold(new_owner)` | staff | every row for e164 deleted | staff | `A:207` |
| rows on old | number move | codes proved | rows copied to new, old deleted | member | `PG:351` |

**Readers.** `Accounts.optedIn` (`A:416`) needs `=== opted_in`. `consentRefused` (`SV:696`) refuses only `opted_out`, so `none` may send. This asymmetry is deliberate for members from before the platform (comment `SV:693`), but `activeMembership` (`A:327`) then treats those members as not bound. `learningConsentContextEndpoint` reads the ledger directly.

**Invariants.**

- INV-L1 (PRD 40.3, decision 7): after a global STOP at time T, no non-compliance send to that number for any app until an app opt-in with `at > T`, and then only for that app.
- INV-L2: STOP never needs a membership, a person or a clear hold (comment `SV:1060`).
- INV-L3: a retried message writes one event (`0007:246`).
- INV-L4: a ledger row is never edited. Delete is allowed only for erasure or move.
- INV-L5: only the phone's owner can create an opt-in. Ban forbids it (`SV:1103`).
- INV-L6: a STOP is never forgotten (comment `0003:215`). PC-01 breaks this.
- Liveness L-L1: START after STOP leads to `opted_in` for that app, unless a banned number or a newer STOP.

**Interactions.** Send gate (`RT:186`, `RT:575`), relay (`A:327`), learning context, gateway fence (`turn.consent`, `SV:1325`). `turn.consent.at` for a leave is `t` (`SV:1090`), but the ledger `at` is a later `this.now()` in `A:422`. The two values differ by the time between calls.

**Concurrency and failure.**

- Each `addConsent` is one statement. The STOP ledger write comes first, which is the safe order.
- A web stop that fails in the hook leaves the ledger out and the projection stale. Sends still stop.
- `at` comes from the message for STOP and START, and from the local clock for web and leave. A mix of clock sources is possible. The `consentAt` helper was not read in detail.
- Out of order: a START older than the last STOP is written, then read back and ignored (`SV:1107`). STOP has no matching check. See PC-25.

**Quint notes.** Variables: `events: Set[{e164, app|null, state, at, id}]`. Actions: `stopGlobal`, `stopApp`, `start`, `join`, `leave`, `erase`, `move`. Use a small `at` range and allow ties. Invariants as above, plus a temporal property: once `stopGlobal` happened with no later `start(a)`, then `resolve(a) != opted_in`. Check `resolveConsent` as a pure function against an enumeration of pairs of last events. Bounds: 2 numbers, 2 apps, `at` in 0..4.

### 3.2 stop-projection (P0, implicit)

**State.** `platform.memberships.state` (`paused`) and `network.members.opted_out`. Both are derived from the ledger, by hand, in later steps.

**States for one membership.** `(ledger out?, membership active|paused, opted_out?)`. Consistent: `(out, paused, true)` and `(in, active, false)`. All others are transient or stuck.

**Transitions.**

| Event | Effect | Where |
|---|---|---|
| STOP text, own member | `memberMessage` sets `optOut true` in the unit | `SV:1275` |
| STOP, other members | `stopped()`: active to paused, then a unit sets optOut | `SV:801` |
| STOP, no person | legacy loop over runtimes | `SV:1334` |
| START | ledger, read back, paused to active, `optOut false` | `SV:1110`, `SV:1276` |
| web stop | ledger, then `onStop` | `A:398` |
| new member row | `opted_out=false` on conflict | `SV:733` |

**Invariants.** Sends read the ledger first, so the projection only needs to converge. INV-P1: `paused` is set only with an opt-out on record. INV-P2: `restricted` is never changed to `paused` or `active` by STOP or START. The code keeps this: `stopped()` writes only when `state === "active"`, and START writes only from `paused`.

**Concurrency.** Each step is a separate transaction. `stopped()` writes the whole row (PC-09). No lock. A crash between steps leaves `(out, active, false)`. There is no reconcile job. Sends stay stopped by the ledger, but guards that read the projection are weaker (PC-18).

**Quint notes.** Merge with consent-ledger. Add a `crash` action between steps, and check `ledgerOut => no send`, not `ledgerOut => paused`.

### 3.3 suppression (P0, implicit)

**State.** Row presence in `platform.suppression` (phone_hash, reason, at). Reasons: `deleted`, `banned`. `on conflict do nothing` keeps the first reason (`PG:184`).

**Transitions.**

| From | Event | To | Where |
|---|---|---|---|
| none | delete everything | deleted | `PG:307` |
| none | ban | banned | `SV:1751` |
| deleted, banned | web join passes | none | `A:374` |
| deleted, banned | text join passes | none | `SV:1440` |
| any | number change to this number | none | `A:265` |
| any | `clearHold(new_owner)` | none | `A:210` |

Join paths check the ban first, so `banned` suppression is not lifted by a join. `clearHold` lifts it, but the `bans` row still refuses that number.

**Invariants.** INV-S1: a suppressed number gets no non-compliance send (`SV:710`). INV-S2: staff invite refused while suppressed (`A:336`). INV-S3: a suppression is lifted only by a new opt-in by the person or a staff new-owner decision.

**Interactions.** Cloud sign-in refuses a suppressed number (`API:437`), which conflicts with lifting by a web join (PC-12). `admission` in the signed turn also reads it (`SV:2063`).

**Open question.** With the gateway path, `direct` collects a reply and does no consent check (`SV:1369`). On the legacy path the queue refuses a join question to a suppressed number. If so, a person who deleted everything and sends "hi" gets silence until they send name and age in one text. Whether the gateway sends the collected reply when `accountEligible` is false was not checked, because that code is upstream.

### 3.4 stop-hint-window (P0, implicit)

**State.** `platform.rate_limits` row for `stop_hint:<app>:<key>`, written by `hit(.., 30*DAY, .., {minGapMs: 30*DAY})` (`SV:1160`).

**States.** `open`, `cooling`. Transition `open -> cooling` on hint. Intended `cooling -> open` after 30 days. Actual exit: `people.purge(now-2d)` deletes rows with `last_at < before` (`PG:286`), called every tick (`serve.ts:134`, `SV:524`, `SV:572`). See PC-02.

**Invariant.** At most one hint in 30 days per number and app (`SV:1153`, founder decision 2026-10-11 #22 as cited at `SV:1120`).

**Quint notes.** Model `purge` as an action. Invariant: `hints(n, a) in any 30-day span <= 1`. Fails with the current purge horizon.

### 3.5 phone-hold (P0, explicit)

**State.** `phone_identities.hold` in `{null, recycled_number}`, `hold_at`. `RECYCLED_AFTER_MS` is 365 days (`A:30`).

**States.** `clear`, `stale_unobserved` (implied: `at - last_seen > 365d`, not yet seen), `held`, `gone`.

**Transitions.**

| From | Event | Guard | To | Where |
|---|---|---|---|---|
| clear | `seen()` | not stale | clear, touch | `A:182` |
| clear | `seen()` | stale | held | `A:181` |
| held | `clearHold(same_owner)` | staff admin | clear, touch | `A:198` |
| held | `clearHold(new_owner)` | staff admin | gone | `A:203` |
| clear | number move | old phone | row replaced | `PG:348` |

**Guards on stale.** `activeMembership`, `startNumberChange` and `confirmNumberChange` read `stale` without a write. `personFor` and `byPhoneHash` read only `hold`. Inbound STOP runs before `seen` (`SV:1054`), so STOP neither sets nor needs a hold.

**Invariants.** INV-H1: while held, no read or change of the old owner's account (`A:9`). INV-H2: STOP works while held. INV-H3: a new owner never inherits the old owner's person, blocks or age. PC-08 breaks INV-H3 after a crash. PC-01 breaks a safety property at the same step.

**Failure.** `clearHold(new_owner)` has five steps and no transaction: hooks per membership, `deleteAll`, `detachPhoneHash`, `unsuppress`, `clearAgeFloor`. After `deleteAll`, `findPhone` is undefined and a retry returns false (`A:196`).

**Quint notes.** Merge with consent-ledger. Add an action for STOP from the number while held. Add a crash action after each `clearHold` step. Bound: 1 number, 2 owners.

### 3.6 ban (P0, implicit)

**State.** `platform.bans` rows. `platform_service` may select and insert only (`0011:26`). Projections: `suppression`, `memberships.state=restricted`, `network.members.account_status`, the Network hold through `markBanned`, and removal of ratings.

**States.** `not_banned`, `recorded`, `suppressed`, `ratings_dropped`, `memberships_restricted`, `network_held`. Terminal: `network_held`. There is no unban.

**Transitions (`SV:1734`).** Audit row, `people.ban` for each row, `suppress` for each hash, `dropRatings`, `putMembership(restricted)` for each live membership, then for each member an update and a unit. Each step is its own transaction.

**Readers.** `Accounts.banned` (`A:166`), `canJoin`, `joinLocked`, `startNumberChange`, `confirmNumberChange`, `activeMembership`, `consentRefused` (`SV:708`), `personBanned` (`SV:1623`), the SQL guards in `PS:84` and the learning endpoint.

**Invariants (decision 3 of 2026-10-09).** A banned number is refused at join, OTP and inbound on every app. Photos stay for the safety team (`SV:1752`). No rating is kept.

**Failure.** The `already` check (`SV:1742`) reads only the first step, so a partial ban has no retry path (PC-04). A join in progress is not excluded (PC-10). OTP has no check (PC-03).

**Quint notes.** Model each step as an action with a crash. Property: `eventually(networkHeld)` given a staff retry. This fails today. Add the OTP path as an action `otpStart` with invariant `banned => not otpSent`.

### 3.7 person-block (P0, implicit)

**State.** `platform.person_blocks` (from, to, origin_app, at), primary key on the pair. `network.edges` type `blocked`. Direction is stored, and readers check both ways.

**States for a pair.** `none`, `blocked`. There is no unblock anywhere.

**Transitions.**

| Event | Effect | Where |
|---|---|---|
| Member block in a unit | `network.edges` and `person_blocks`, if both have `person_id` and neither is forgotten in this unit | `RT:508` |
| Forget of a member | edge deleted, person block stays | `RT:541` |
| Delete everything | blocks stay on the tombstone | `PG:317` |
| Rejoin, same hash | person revived, blocks hold | `PG:67` |
| New owner | hash detached, blocks stay on the old tombstone | `A:209` |

**Readers.** `snapshot.ts:98`, and `relayPairAdmission` (`RT:276`) at send time. `PeopleStore.block` and `isBlocked` have no production caller (PC-27).

**Invariants.** INV-B1: a block holds on every app. INV-B2: a block survives leave and delete everything. INV-B3: no match, relay or photo crosses a block. Photo relay gets it through `relayPairAdmission` (`RT:307`).

**Gaps.** A member with no `person_id` writes the edge only. A block in the same unit as a forget of either party is dropped (`RT:508`). People with a null `phone_hash` lose revival (PC-11).

**Quint notes.** Small. Model with member ids and person ids to show that the block is on persons. Merge with deletion and rejoin. Invariant: `blocked(p, q)` is monotone unless a new-owner decision changes the phone-to-person link.

---

## 4. Machines: accounts

### 4.1 membership-lifecycle (P0, explicit)

**State.** `platform.memberships.state`, check constraint `0003:88`: `invited`, `onboarding`, `active`, `paused`, `restricted`, `removed`. Implied: `absent`. `review` is a second field.

**Transitions.**

| From | Event | Guard | To | Where |
|---|---|---|---|---|
| absent, removed | staff invite | not held, suppressed or banned | invited | `A:335` |
| absent, removed, invited | web join | open, or invited | active, or onboarding if waitlist | `A:375` |
| absent, removed, invited | text join | same | active or onboarding | `SV:1442` |
| absent, removed, invited | enroll | age, not banned | active or onboarding | `SV:1486` |
| active | STOP | ledger out | paused | `SV:804` |
| paused | START | ledger in, not banned | active | `SV:1110` |
| invited excluded | ban | any live | restricted | `SV:1754` |
| not removed | leave | none | removed | `PG:296` |
| any | under-13 decline | `declined` | removed | `SV:1307` |
| active | join rollback | hook threw | removed | `A:390` |
| any | delete everything | fresh | absent | `PG:315` |
| any | number move | none | unchanged | `PG:341` |

**Unreachable or stuck.**

- `onboarding` has no exit to `active` in any code (PC-27). It is reachable only if a `platform.apps` row is set to `waitlist`. Defaults are `invite` or `open` (`apps.ts:70-85`).
- `review = recycled_number` is never written by production code. Only a test sets it.
- `restricted` has no exit except leave or delete.

**Invariants.** INV-M1: `removed` holds no name or profile (`PG:296`). INV-M2: a member id is one app. INV-M3: a banned person has no `active` membership. INV-M4: minors may hold memberships, but `canBeMatched` is false.

**Quint notes.** Model as a function `(person, app) -> state` with guard booleans. Check `removed => profile empty`, and check reachability of `onboarding -> active` as a witness that must fail.

### 4.2 web-join-saga (P0, implicit)

**Steps (`A:351`), under `withLock("join:<e164>")`.**

1. `seen` (may set hold)
2. `personFor`, `banned`
3. existing membership branch (repeat join is only an age statement)
4. invite-only guard
5. `joinAgeCheck`
6. `createPerson` (may revive a tombstone)
7. `recordAge`
8. `unsuppress`
9. `putMembership`
10. `addConsent(opted_in)`
11. `attachPerson`
12. `onJoin` hook: `joined` (`SV:788`) runs `createMember` in one transaction, then `welcomeJoined` in a unit
13. on throw: `forgetMembership`, `addConsent(opted_out join_failed)`, rethrow

**Invariants.** INV-J1: no consent or person before the wording and age checks. The route adds a `signupView` check (`API:549`). INV-J2: one person, one membership and one opt-in under parallel joins. INV-J3: failed join leaves no active member.

**Failure.** No transaction across steps. Crash after step 9 leaves a membership with no opt-in and no network member. Rollback handles only a throw. It does not restore suppression, does not undo a revived tombstone and does not touch `network.members` (PC-07). Rollback of an `invited` membership loses the invite, because state becomes `removed`.

**Quint notes.** Sequence variable `pc` with values for each step. Non-deterministic `throw` at 12 and `crash` anywhere. Invariants checked at quiescence.

### 4.3 leave-forget-saga (P0, implicit)

**Steps, `A:421`.**

1. `personFor`, `getMembership`
2. `addConsent(app out)`
3. `onForget` hook (`SV:758`):
   - `photos.deleteFor(person, app)`: bytes, row, `onRemoved` per photo
   - `forget()`: a unit with `forgetMember` and `unit.forget`, save at `RT:521`
   - `forgetListeners`: MCP `revokeAllFor`, errors logged and swallowed
4. `forgetMembership` (`PG:293`), one transaction: lock person, membership removed, grants revoked, `notify.forget_data`

The `state=removed` update fires `forget_profile_suggestions` (`0039:61`), which deletes batches. That fires `remove_suggestion_facts` (`0039:51`).

**States.** `member`, `ledger_out`, `photos_gone`, `network_forgotten`, `grants_revoked`, `platform_removed`.

**Invariants.** INV-F1: after leave, nothing names the member except the id (`RT:520`). INV-F2: other apps and the phone stay. INV-F3: leave stops sends for that app.

**Failure.**

- A throw before step 4 returns 500 and leaves the membership live. A web retry repeats and is idempotent in effect.
- A text retry finds no `lid` once `channel_identities` are gone (`SV:1085`), so it does not reach the leave branch and the platform membership can stay live. The ledger is out, so sends stay stopped.
- Duplicate delivery: `accounts.leave` has no `ref`, so a repeat writes a second event (PC-30).

**Quint notes.** Merge with delete-everything. Actions per step, crash between, retry by web and by text as different actions.

### 4.4 delete-everything-saga (P0, implicit)

**Steps, `A:432` and `API:626`.** Route guards: not held, `sessions.fresh` (10 minutes). No ban guard (PC-31). Then:

1. `noteAgeFloor` from `person.lowestAge`
2. `onForget` for each live membership
3. `store.deleteAll` (`PG:304`), one transaction: lock person, suppress, seal `platform.inbound`, delete sessions, challenges, consent, memberships, grants, phones, pending, phone changes; tombstone; `notify.forget_data(person, null)`

**Keeps.** Tombstone with `phone_hash`, blocks, bans, suppression, age floor, `photo_relay_requests`, connection receipts (PC-13).

**Invariants.** INV-D1 (founder correction 2026-10-19: backend privacy controls stay): no personal data after delete except the listed safety facts. INV-D2: age floor stays. INV-D3: blocks and bans stay. INV-D4: no send after delete.

**Failure.** Step 2 commits per app before step 3. A crash leaves network data gone, platform rows live and the phone not suppressed. The ledger keeps its previous state. Web retry repeats safely. No lock excludes a join (PC-10). An upload in flight survives (PC-05).

### 4.5 person-age (P0, implicit)

**State.** `people.lowest_age`, `age_floor.lowest_age` by keyed hash, `network.members.age`, view `platform.matching_ages` (`0038`), which takes the least of all three.

**States.** `unknown`, `under13`, `minor`, `adult`, by lowest value. The value only goes down, except two resets: tombstone (`lowest_age=null`, `PG:319`), restored from the floor on rejoin; and `clearHold(new_owner)` clears the floor.

**Transitions.** `recordAge` (`A:282`): floor (with the guard and cleanup), then `noteAge`, then `onAgeLowered` in a `finally`. `ageLowered` (`SV:776`): below 18, delete all photos and ratings, then lower each member's age. The hook runs on every statement and is idempotent.

**Invariants.** AGENTS decision 1: lowest age wins. Under 13 stores nothing (`policy.ts`). Minors are never matched. INV-A1: `matching_ages` is never above any statement.

**Divergence.** Text decline forgets every app (`SV:1302`). Web does not (PC-06). In `joinLocked` the under-age branch writes `recordAge` only.

---

## 5. Machines: photos and ratings

### 5.1 photo-object (P0, implicit)

**State.** Row in `platform.photos` and object in storage. `deleted_at` exists but is never written (PC-27).

**States.** `none`, `bytes_only` (crash), `stored`, `row_only` (crash during delete), `gone`.

**Transitions.**

| From | Event | Guard | To | Where |
|---|---|---|---|---|
| none | upload | storage on, app, consent header, `mayTake`, size, type, count, strip | bytes_only, then stored | `PH:457-472` |
| stored | member delete | owner and app | row_only, then gone | `PH:551` |
| stored | leave, delete all, under 18 | none | gone | `PH:562` |
| stored | photo row delete | none | cascades to relay items | `0037:20` |
| stored | staff link read | adult, signature, 5 minutes | stored | `PH:573`, `PH:585` |

**Guards.** `mayTake` (`PH:450`): storage, app, not banned, adult. `adult` (`PH:439`): lowest age 18+, not deleted, `eligible` (`SV:1577`).

**Invariants.** AGENTS decision 9. INV-Ph1: no stored photo for a person under 18. INV-Ph2: no photo after leave or delete all. INV-Ph3: at most 6 photos. INV-Ph4: stored bytes have no metadata. INV-Ph5: a banned person's photos stay. PC-05 breaks Ph1 and Ph2. PC-21 breaks Ph3.

**Failure.** Bytes are deleted first, then the row, which is the safe order. No reaper exists for `bytes_only` (PC-22). `get` returns undefined on an R2 error (`PH:344`), so a transient error looks like a missing photo.

**Quint notes.** Model upload as three actions: `check`, `putBytes`, `putRow`. Interleave `ageDrop` with `deleteFor`. Invariant `lowestAge < 18 => no rows` at quiescence shows PC-05.

### 5.2 photo-consent (P0, implicit)

**State.** Three separate records:

- `photos.consent_version` per row, from a client header on the web (`PH:460`), or the constant on text.
- `memberships.profile.photoConsent`, `photoConsentAt`, `photoConsentSource` (`PI:124`), text only.
- `pending_texts` kind `photo_consent` (`PI:90`).

**States (text).** `no_consent`, `asked`, `consented`, `declined` (same as `no_consent`).

**Transitions.**

| From | Event | Guard | To | Where |
|---|---|---|---|---|
| no_consent | photo by text | `mayTake` | asked, ask once a day | `PI:89` |
| asked | YES PHOTOS | app slop, under a day | consented | `PI:121` |
| asked | NO PHOTOS | same | no_consent | `PI:130` |
| asked | purge or a day passes | none | no_consent | `PI:118`, `PG:287` |
| asked | STOP | none | no_consent | `SV:1328` |
| consented | leave | none | no_consent | `PG:296` |

**Reachability.** `TurnRequest` has no media field (`contract.ts:74`), and `SV:2069` passes `mediaUrls: []`. Production turns never reach `photosIn`. See PC-20.

**Invariants.** INV-C1: a photo is stored only with the current consent version. INV-C2: a bare yes is never consent (`PI:12`).

### 5.3 clef-rating (P0, implicit)

**State.** Facet `<member>:appearance` with source `photo_rater`, agent_private. In-flight rater call, in memory.

**States.** `none`, `checking`, `rater_running`, `rechecked`, `written`, `verified`, `discarded`, `dropped`.

**Transitions (`PH:500`).**

1. `ratingRefusal` (first check). Refused: no rater call.
2. Read up to 4 newest photos of 4 MiB or less.
3. `rater.rate`. `null` is a refusal and is not retried. API errors retry up to 3 times (`PH:139`).
4. `ratingRefusal(ids)` (second check). Refused: discard.
5. `onRating` (write, `SV:1611`).
6. `ratingRefusal(ids)` (third check). Refused: `onRemoved`, dropped.

**Triggers.** Upload, member delete. **Drops.** `onRemoved`, ban, staff age fail (`SV:1650`), age below 18 (`SV:779`).

**Invariants.** Decisions 12, 13, and 5 of 2026-10-09. INV-R1: no rating for a minor, unverified, banned, non-member or deleted photo at quiescence. INV-R2: scores never leave (`PH:29`). INV-R3: the placeholder weights are used until fitted weights pass.

**Concurrency.** Two `rate` runs can interleave. The older result can land last, because the checks test only that its photos still exist. Low impact. A crash between `meta.delete` and `onRemoved` leaves a rating built on a deleted photo (PC-22).

**Quint notes.** Good small model. Rater as an async action. Environment actions between each step. Invariant at quiescence. This should verify, apart from crash cases.

### 5.4 photo-relay-item (P0, explicit)

**State.** `photo_relay_items.state`: `pending`, `approved`, `rejected`, `revoked`. Implied: `expired` (`expires_at`, 15 minutes), `claimed` (`action_id` set), `bound` (`delivery_intent` set), `fetchable` (bound and before `delivery_expires_at`). `delivered` is not stored.

**Dormant.** `policy` is set only when `o.photoRelayPolicy` is given and no `routePolicy` (`SV:396`). `photoRelayParties` returns nothing under a route policy (`SV:415`). Without a policy, `enabled` is false.

**Transitions.**

| From | Event | Guard | To | Where |
|---|---|---|---|---|
| none | select | consent true, version, parties, photo, idempotency key | pending | `PR:111` |
| any | owner revoke | owner and app, no state check | revoked | `PR:136` |
| pending | review safe | policy, reviewer, `current`, not expired | approved | `PR:143` |
| pending | review unsafe | policy, reviewer, not expired | rejected | `PR:150` |
| approved | review unsafe | same | revoked, bindings kept | `PR:150` |
| approved | claim | scope, `current`, no other action | claimed | `PR:187` |
| claimed | issue delivery | recipient, descriptor, `current` | bound | `PR:196` |
| bound | fetch | signature, exp, `current`, immutable bytes | bound | `PR:215` |
| any | photo deleted | none | row gone by cascade | `0037:20` |

**Invariants.**

- INV-PR1: bytes reach only the exact recipient after human review, with consent for this one item.
- INV-PR2: one item binds one action and one intent (unique columns).
- INV-PR3: the deadline never extends (`PR:204`).
- INV-PR4: revocation, block, STOP, ban, age or leave defeat delivery (`current` at each step).
- INV-PR5: identity, content and consent columns are immutable (`PR:74`).
- CHECK constraints in `0037:40-45`.

**Concurrency.** All transitions run under `select ... for update` in `locked`. `claimForAction` shares the outbound transaction. The lookup avoids an inverse lock order with `network_state` (`RT:296`). Fetch has no one-time use: a fetch URL can be used again within 60 s.

**Quint notes.** Model alone. Variables: state, actionId, intent, deliveryExp, now, plus boolean inputs `current`. Check the invariants above. Add `rejected -> revoked` as a witness for PC-28.

---

## 6. Machines: text flows and shares

### 6.1 pending-text (P1, implicit)

**State.** `platform.pending_texts`, primary key `(phone_hash, kind, app_id)`. Kinds: `join`, `looking_for`, `share`, `photo_consent`.

**Transitions.** Put on ask (`SV:1411`, `SV:1431`, `SV:1456`, `SV:1461`, `PI:90`). Delete on answer (`SV:1435`, `SV:1496`, `SV:1507`, `PI:119`). All kinds deleted on STOP (`SV:1328`), number move (`PG:363`) and delete all (`PG:323`). TTL by purge at 2 days (`PG:287`), read guard of 1 day for photo consent.

**Notes.** `putPending` replaces other rows of the same kind, except `share`. Leave does not delete pending rows. Consumers recheck membership, so no effect was found. `getPending` is by `at desc`.

### 6.2 share-grant (P2, implicit)

**State.** `(granted_at, revoked_at)`, primary key `(person, from, to)`.

**States.** `none`, `granted`, `revoked`. Transitions: grant (`A:476`, `SV:1509`), revoke (`A:466`), revoke on leave (`PG:298`), deleted on delete all (`PG:316`). Regrant upserts to `granted`.

**Reader.** None in production except `revokeShare` (PC-27). `README` says the engine view is not built.

---

## 7. Machines: profile suggestions

All of this is off unless `NETWORK_PROFILE_REVIEW_ENABLED=1` and a route policy exists (`profile-review-factory.ts:101`).

### 7.1 suggestion-item (P1, explicit)

**State.** `profile_suggestions.status` (`0039:35`): `proposed`, `accepted`, `rejected`, `expired`, `withdrawn`. Implied: `row_deleted`. Check: `proposed` has a value, all others have none.

**Transitions.**

| From | Event | Guard | To | Where |
|---|---|---|---|---|
| none | propose | `eligible`, source proof, exact stored command | proposed | `PS:184` |
| proposed | accept, same scope | `eligible`, source proof, revision, not expired | accepted, facet inserted | `PS:239` |
| proposed | edit or scope change | same | proposed, revision+1 | `PS:226` |
| proposed | reject | revision, not expired | rejected | `PS:246` |
| proposed | expiry on read, decide or tick | none | expired | `PS:107`, `PS:209`, `PS:456` |
| any but retained accepted | V1 disconnect | proof | withdrawn | `PS:332` |
| any | V1 delete | proof | row_deleted, facet deleted | `PS:331` |
| proposed | V2 withdraw | proof | withdrawn | `PS:424` |
| any | V2 delete | proof | row_deleted | `PS:422` |
| any | batch delete, leave, delete all | owner | row_deleted | `0039:51-72` |

`rejected`, `expired` and `withdrawn` are not terminal: V1 writes `withdrawn` over them (`PS:332`). No value returns, so this has no data effect.

**Invariants.**

- INV-SG1: pending data never enters the matcher input.
- INV-SG2: accept is a separate exact human command, never implicit (`PS:225`).
- INV-SG3: one suggestion makes at most one facet.
- INV-SG4: a non-proposed row holds no text.
- INV-SG5: adults only, with no STOP, ban or hold.
- INV-SG6: delete removes linked facts; disconnect obeys the retention choice shown to the member.

### 7.2 suggestion-batch (P1, implicit)

**State.** `revision` (monotone), `expires_at`. Implied: `open`, `expired`, `empty`, `deleted`.

`revision` goes up on edit, on saved decisions, and on V1 and V2 changes. The review token binds `id.revision` (`profile-suggestion-review.ts:19`), so each decision needs a new preview.

**Locks.** `owned()` (`PS:78`): set app, lock person, lock member and membership, then authorize owner. Then batch `for update`. Then suggestions `for update`. V1 and V2 keep the same order.

**Fence.** `checkAuthority` throws after writes if proof time passed, which rolls back. The fence is checked before commit, not at commit.

### 7.3 collection-claim (P1, implicit)

**State.** `inbound.action_receipts["profile-collect:<batch>"]` with `{state, requestHash, response}`.

**States.** `unclaimed`, `completed`, `sealed` (receipts cleared on forget, status `unresolved`), `purged` (inbox purge after 7 days).

**Transitions.** First collect: insert batch, suggestions and receipt in one transaction (`PS:182-187`). Exact replay: return preview only if the batch is intact (`PS:162-175`). Changed replay: denied. Replay after any decision: denied. A later turn with the same id: denied while the receipt exists (`PS:179`).

**Invariant.** Replay never recreates erased suggestions. A turn holds at most 16 receipts.

### 7.4 connection-cleanup-v1 (P1, implicit)

**Trigger.** `POST /internal/profile-suggestions/connection`, signed, `x-ntwrk-svc-id = connection-cleanup:<nonce>`.

**States.** `unseen`, `resolved_proof`, `in_tx`, `completed` (receipt with result), `legacy` (receipt with null result), `denied`.

**Flow (`profile-suggestion-disconnect-endpoint.ts:33`, `PS:287`).**

1. Verify signature.
2. Fetch a signed Cloud proof (`revoked`, at most 30 s life).
3. In one transaction: `owned` (which refetches and revalidates the proof), read receipt, if none apply the change, count, insert receipt with result (`on conflict do nothing`, throw on conflict), `owned` again, commit.

**Operations.** `disconnect`, `delete`, `readback`. All three write a receipt.

**Replay.** Exact replay returns the stored counts. Any mismatch or `legacy` denies (test at `profile-cleanup-reconciliation.postgres.test.ts:342`, `:457`).

**Invariants.** INV-CC1: mutation and receipt commit together. INV-CC2: a nonce runs once across owners; the loser rolls back (`:544`). INV-CC3: batches after `revokedAt` are not touched. INV-CC4: no source-read grant is needed. INV-CC5: delete is never inferred.

### 7.5 owner-withdrawal-v2 (P1, implicit)

Same shape, with the receipt in `inbound.action_receipts["profile-withdrawal-v2:<id>"]`. Needs the turn `status='done'`, the outcome `open`, and the command hash. `arrived_at <= cutoffAt`. `withdraw` touches proposed rows only. `delete` removes rows and facts. `readback` writes no receipt and does not consume anything (`PS:395`, `PS:439`).

**Differences from V1.** Receipt storage. Cap of 16 receipts on a turn. `retainedAccepted` counts all accepted rows, not only rows with retention. A turn sealed by a forget has `status='unresolved'`, so replay denies.

**Quint notes for 7.1 to 7.5.** Model E. Variables: `items: id -> status`, `facts`, `batch.revision`, `receipts`, `now`, `proofUntil`, `chat`. Actions: `propose`, `preview`, `accept`, `edit`, `reject`, `expire`, `withdraw`, `cleanup(op)`, `replay`, `leave`. Treat each transaction as atomic. Invariants as above. Bounds: 1 person, 2 chats, 2 connections, 2 batches, 2 items each. Use two clocks to show PC-15.

---

## 8. public-api-gates (P1, implicit)

Guard matrix for `/api/*`. `S`=session, `H`=refuses held, `B`=refuses banned, `F`=needs fresh login.

| Route | S | H | B | F | Where |
|---|---|---|---|---|---|
| `POST /api/auth/otp/start` | no | no | **no** | no | `API:462` |
| `POST /api/auth/otp/verify` | no | no | **no** | no | `API:479` |
| `GET /api/auth/cloud/callback` | no | yes | yes | no | `API:437` (also refuses suppressed) |
| `GET /api/me` | yes | reports | reports | no | `API:505` |
| `POST /api/join` | yes | yes | yes | no | `A:353-355` |
| `POST /api/me/home` | yes | yes | yes | no | `API:526` |
| `POST /api/me/resume` | yes | yes | yes | no | `API:538` |
| `POST /api/me/share` | yes | yes | no | no | `A:478` |
| `GET /api/me/export` | yes | yes | no | no | `API:575` |
| `POST /api/me/stop` | yes | no, on purpose | no, on purpose | no | `API:579` |
| `POST /api/me/delete app` | yes | yes | no | no | `API:628` |
| `POST /api/me/delete all` | yes | yes | no | yes | `API:630` |
| `POST /api/me/phone/start` | yes | yes | yes | yes | `API:583`, `A:227` |
| `POST /api/me/phone/confirm` | yes | yes | yes | no | `A:249` |
| `/api/photos*` | yes | through `personFor`? no: `session.personId` | `mayTake` | no | `PH:604` |

Note on photos: `API:363` passes `authenticated.session.personId`, not `accounts.personFor`. A held number with an existing session keeps its `personId`. `mayTake` does not read `hold`. A held number's old session can still list and upload photos. Session lifetime (90 days at most) is shorter than the 12 months a hold needs, unless the hold starts from another path. With the current lifetimes this is not reachable by staleness, so it is not listed as a defect. A model should keep the guard as an explicit input.

**Founder correction 2026-10-19.** The public sites have no account portal. These routes remain as backend privacy controls.

---

## 9. rater-config (P2, explicit)

`RaterStatus` (`PH:48`): `on`, `on_placeholder`, `off_flag`, `off_env`, `refused_weights`. Pure function of the environment at start (`PH:61`). Any flag value except unset, `on` or `off` gives `off_flag`. No model needed. A table test is enough.

---

## 10. Suspected defects in detail

Each entry gives the trigger sequence. "Verified" means by reading the code.

### PC-01. A `new_owner` decision erases a STOP that the new owner sent during the hold

- Where: `A:194-212`, `PG:313`, `SV:1054-1065`, `A:335`.
- Sequence:
  1. Number N is held as recycled.
  2. The real new owner texts STOP. The ledger stores a global opt-out. STOP works during a hold by design.
  3. Staff choose `new_owner`.
  4. `store.deleteAll` deletes every consent row for N, then `unsuppress(hash)` deletes the suppression.
  5. Staff invite N. `invite()` checks hold, suppression and ban. All are clear. The invitation goes out, and the send gate sees no opt-out.
- Result: a STOP is forgotten. The comment in `A:191` is right for the old owner's rows, but rows written during the hold belong to the new person.
- Confidence: high. Priority: P0.

### PC-02. The 2-day purge removes the 30-day window of the STOP hint

- Where: `SV:1160`, `SV:572`, `PG:286`, `serve.ts:134`.
- Sequence: person STOPs. Texts again: hint sent, bucket written. 49 hours later the purge deletes the bucket (`last_at < now-2d`). Next text: `prevAt` is null, so `ok` is true and a second hint goes out.
- Result: a stopped person can get a hint about every two days, not once in 30 days. The hint is compliance kind, so it passes the send gate.
- `stop_hint` is the only bucket with a window over 2 days in `service`, `platform` and `mcp` sources found by search.
- Confidence: high. Priority: P0.

### PC-03. A banned number can get an OTP code and a session

- Where: `API:462-496`, `otp.ts` (no ban, hold or suppression reference in the send path), compare `API:437`.
- Sequence: banned number posts `/api/auth/otp/start`. An SMS goes out. `verify` creates a session. `/api/me` then reports `review`.
- Result: AGENTS decision 3 says a banned number is refused at OTP. The Cloud path refuses, the OTP path does not. A refusal must keep the same public answer (no enumeration, `api-security.test.ts:176`).
- Confidence: high. Priority: P0.

### PC-04. A ban that fails half way cannot be retried

- Where: `SV:1742-1743`, `SV:1750-1761`.
- Sequence: ban rows commit. `markBanned` or `putMembership` throws, or the process dies. Staff retry. `already` is true, so the answer is `already_banned`, and the remaining steps never run.
- Result: `network.members.account_status` stays `active`, memberships stay live, the Network does not hold the member. Sends are refused, but matching can still pick the member.
- Confidence: high. Priority: P0.

### PC-05. An upload in flight survives age drop, leave and delete everything

- Where: `PH:461-473`, `PH:562`, `SV:779`.
- Sequence: upload passes `mayTake` at `PH:461`. The person states age 15. `ageLowered` runs `deleteFor`, which lists rows and finds nothing new. Upload then runs `storage.put` and `meta.put`. `rate()` refuses. Nothing removes the row.
- The same sequence applies to leave and delete everything. After delete everything the row stays on a tombstone.
- Result: INV-Ph1 and INV-Ph2 are broken. `rate()` has three checks, but `upload` has no check after the write.
- Confidence: high. Priority: P0.

### PC-06. A web statement under 13 keeps every other membership

- Where: `A:357-362`, `A:366-370`, compare `SV:1302-1309`.
- Sequence: a member of friends posts `/api/join` on slop with age 12. The answer is `under_age`. `recordAge` lowers all ages to 12. Memberships stay, with profiles.
- The text path forgets every membership when the Network declines.
- `policy.ts` and AGENTS: under 13 cannot join, nothing stored. The person is not matched, because the age is under 18, but the data stays and the agent can still talk with them.
- Confidence: high. Priority: P0.

### PC-07. A failed web join leaves an active orphan network member

- Where: `SV:788-794`, `A:386-392`.
- Sequence: `createMember` commits. `welcomeJoined` unit throws. The catch runs `forgetMembership` and `join_failed`, and never calls `onForget`.
- Result: `network.members` stays `active` with `person_id` set, with facets and presence. A later join makes a new member id. The person then has two member rows in the app. The README text on join rollback (`README.md:30`) covers only `notify.forget_data`.
- `PS:89` selects `rows[0]` with no member binding (PC-17), so this orphan can reach suggestion code.
- Confidence: high. Priority: P0.

### PC-08. `clearHold(new_owner)` crash leaves a tombstone that a new owner revives

- Where: `A:203-211`, `A:196`, `PG:67`.
- Sequence: crash after `store.deleteAll`, before `detachPhoneHash`. Retry: `findPhone` is undefined, so it returns false and nothing else runs. New owner joins. `createPerson` finds the tombstone by hash and revives the old person, with blocks against that person. Old floor and suppression also stay.
- Result: INV-H3 broken.
- Confidence: high by reading, low likelihood. Priority: P0.

### PC-09. Whole-row membership writes can undo leave, ban and STOP

- Where: `PG:124-128`, callers `SV:804`, `SV:1110`, `SV:1754`, `PI:124`.
- Sequence A: `stopped()` reads `active`. `leave` commits `removed` and clears name and profile. `stopped()` upserts `paused` with the old name and profile.
- Sequence B: `consentAnswer` reads `who.m` at `PI:120`. A ban writes `restricted`. `PI:124` writes `active`.
- Result: personal data returns to a removed row, or a restricted member reads active. No `for update`, no compare.
- `forget_profile_suggestions` fires only when the new state is `removed`, so a later batch delete does not repeat.
- Confidence: high by reading, low likelihood. Priority: P0.

### PC-10. Leave, delete, stop and ban do not take the join lock

- Where: `A:348`, `A:421`, `A:432`, `SV:1734`, `API:627-638`.
- Sequence: `joinLocked` reads person P and passes `banned`. Delete everything commits, or a ban commits. `joinLocked` runs `putMembership(active)` on the tombstone or the banned person, then `onJoin` makes an active member.
- Comments claim only that joins run one at a time. No other path is excluded.
- Confidence: medium, since the window is short. Priority: P0.

### PC-11. People from the 0006 backfill have no `phone_hash`

- Where: `0006:84`, `0007:250` (column added, no backfill), `PG:179`, `A:166`, `SV:1747`.
- Result for such a person:
  - `phoneHashesOf` is empty. A phone ban is refused with `no_phone`.
  - A person ban writes `phone_hash = null` and suppresses nothing.
  - After delete everything, the phone has no person and no hash ban, so the number rejoins as a new person.
  - The tombstone cannot be revived, so blocks against them do not reconnect.
- The hash needs the service key, so SQL cannot backfill it. No code path sets it for existing rows, except a number move.
- Confidence: medium. It depends on whether such rows exist in production. Priority: P0.

### PC-12. Cloud sign-in refuses a suppressed number

- Where: `API:437`, `A:374`, `API:683`.
- Sequence: person deletes everything. In Cloud mode, callback answers 403 for the suppressed number. `/api/join` needs a session, so the join that lifts suppression cannot run. Only a text join can.
- `api.test.ts` covers lifting in OTP mode. No Cloud test of this was found.
- Confidence: medium. It may be intended. Priority: P1.

### PC-13. Connection receipts keep Cloud identity after delete everything

- Where: `0040`, `PG:304-325`, `RT:521-551`.
- Rows hold `user_id`, `organization_id`, `chat_id`, `connection_id`, and `person_id`. The cascades need a deleted person or member row, and neither is ever deleted. No code deletes receipts, and the runtime role has only SELECT and INSERT.
- The test at `profile-suggestions.integration.test.ts:194` checks batches and suggestions only.
- Confidence: high. Priority: P1.

### PC-14. Cleanup V1 and V2 touch one chat only

- Where: `PS:319-322`, `PS:410-413`, compare `PS:272` and the test name at `profile-suggestions.integration.test.ts:210` ("clears every owned chat").
- Sequence: batches exist under chat A. The binding moves to chat B. A revoked proof names chat B. Batches of chat A are not selected, and counts say 0.
- Result: facts with `retain_on_disconnect=false` stay. `ProfileSuggestions.disconnect`, which covers every chat, has no production caller.
- Confidence: medium. Whether a person can have two personal chats is decided upstream. Priority: P1.

### PC-15. Cleanup cutoff compares two clocks

- Where: `PS:183`, `PS:322`, `PS:335`.
- `created_at` is the Network clock. `revokedAt` is the Cloud clock. If the Network runs ahead, a batch made before the revocation has `created_at > revokedAt` and is skipped. Facts stay, and the nonce is used.
- Confidence: medium. Priority: P1.

### PC-16. Exact cleanup retry is denied after the member left

- Where: `PS:300-301`, `PS:89-90`.
- Sequence: cleanup commits. The response is lost. The member leaves. Retry: `owned` returns undefined, the endpoint answers 403. The caller cannot tell completed from refused.
- No data stays, since leave removed it.
- Confidence: high. Impact is low. Priority: P2.

### PC-17. `owned()` does not bind `m.member_id = n.id`

- Where: `PS:87-88`, compare `learning-consent-context-endpoint.ts:45` and `cloud-profile-review-owner.ts`.
- With two member rows for one person and app (PC-07), `rows[0]` is arbitrary, and `eligible` can come from the orphan.
- Confidence: medium. Priority: P1.

### PC-18. Suggestion eligibility reads the projection, not the STOP ledger

- Where: `PS:82-86`, compare `learning-consent-context-endpoint.ts:70-81`.
- The learning endpoint says that STOP is canonical even when a projection is late. `owned` reads only `n.opted_out` and `m.state`. Between the ledger write and `stopped()`, or after a failed hook, `eligible` is true.
- Confidence: high, with a small window. A failed `onStop` makes it long. Priority: P1.

### PC-19. Cloud HTTP calls run under the person row lock

- Where: `PS:81`, `PS:91`, `PS:151`, `profile-suggestion-endpoint.ts:87`, `SV:2180`, `SV:2206`, `profile-review-factory.ts:85`.
- `owned` locks `platform.people`, then calls `authorizeOwner`, which calls Cloud. Propose calls Cloud once per suggestion, up to 10 times, under the same lock. Cleanup calls `owned` up to three times.
- Result: `forgetMembership`, `deleteAll` and `noteAge` paths with the person lock wait on Cloud. Pool connections stay held. Calls have deadlines, so this is bounded.
- Confidence: high. Priority: P1.

### PC-20. Photo intake by text is unreachable in production, and no client uploads photos

- Where: `SV:2069`, `contract.ts:74`, `PI:80`.
- `TurnRequest` has no media field, and the turn passes `mediaUrls: []`. AGENTS says the backend does not receive the Blooio webhook in production.
- A search of `sites`, `packages/mcp/src` and `plugins` found no caller of `/api/photos`.
- Result: `photo_consent` pending and `profile.photoConsent` are unreachable on the production path. Ratings have no input. Whether upstream has another path was not checked.
- Confidence: high for this repository. Priority: P1.

### PC-21. The photo count limit has a check-then-act race

- Where: `PH:466-472`.
- Two parallel uploads both read 5 rows. The result is 7. It also reads all apps, which is fine with one app.
- Confidence: high. Priority: P2.

### PC-22. Crash windows leave orphan bytes or a stale rating

- Where: `PH:471-472`, `PH:554-556`, `PH:564`.
- A crash between `put` and `meta.put` leaves bytes with no row. No sweep exists.
- A crash between `meta.delete` and `onRemoved` leaves a rating from a deleted photo until the next upload or delete.
- Confidence: medium. Priority: P1.

### PC-23. A failed staff age check keeps the photos

- Where: `SV:1650`, `PH:442`, `PH:590`.
- A staff `verify:age:fail` drops ratings only. Photos stay. `adult` then returns `not_verified`, so staff cannot view them (`staffLinks`, `view`). Staff cannot delete them either. The member can (`PH:551` has no adult check).
- The header at `PH:32` covers age drops only. The rule for a failed age check is not written.
- Confidence: medium. Priority: P0.

### PC-24. No re-consent on a new photo consent version, and no withdrawal

- Where: `PH:460`, `PH:500-527`, `PI:89`.
- `rate()` and `relayPhoto` do not read `consent_version`. A version change does not affect stored photos. NO PHOTOS is read only with a pending row, so it does not clear an earlier YES. Web uploads do not set `profile.photoConsent`. The web header is a client string equal to a public constant.
- Confidence: medium. Priority: P1.

### PC-25. A late old STOP changes the projection but not the ledger

- Where: `SV:1322-1333`, compare `SV:1107`.
- Sequence: START at T2 is handled. A STOP from T1 < T2 arrives later. The ledger reads opted in. `stop()` still sets `opted_out` true and pauses memberships, and confirms the stop.
- Result: the person reads stopped, the ledger says in, and `runtime.optedOut` refuses sends. It fails toward silence. It needs another START.
- The inbox runs in order per sender, so this needs a provider retry out of order.
- Confidence: medium. Priority: P1.

### PC-26. OAuth grants outlive the under-13 decline and delete everything

- Where: `SV:1306`, `SV:758-766`, `serve.ts:100`, `A:439-441`, `handler.ts:950`.
- `statedAge` calls private `forget`, which does not run `forgetListeners`. Grants of those apps stay.
- `deleteAll` fires `onForget` only for live memberships. A grant on an app with no membership (a signup that stopped before join) is not revoked. With no person, no hook runs at all.
- Use of those grants is limited by other guards in the MCP path, which belongs to another scope.
- Confidence: medium. Priority: P1.

### PC-27. States written but never read, or never written

- `memberships.review`: production code writes only null (`A:340`, `A:378`, `SV:1444`, `SV:1488`). Readers exist.
- `onboarding`: no transition to `active`.
- `photos.deleted_at`: read by `PH:393-397`, never written. Rows are hard deleted.
- `profile_suggestions.original_value_hash`: written at `PS:184`, never read.
- `share_grants`: no reader but `revokeShare`.
- `PeopleStore.block`, `isBlocked`: no production caller. The writer is `RT:511`.
- Global `opted_in` in `resolveConsent` (`C:40`): no writer.
- `ProfileSuggestions.disconnect`: test-only.
- Confidence: high. Priority: P2.

### PC-28. Owner revoke overwrites a safety rejection

- Where: `PR:136-141`.
- `rejected -> revoked`. `state` no longer shows the safety decision. `review_id` stays.
- Confidence: high. Priority: P2.

### PC-29. A claimed photo item cannot recover after its 60 s capability ends

- Where: `PR:204-205`.
- `delivery_expires_at` is fixed at first resolve. After it passes, `issueDelivery` returns nothing for the same intent, and the action binding forbids a new one. The sender must select again. This fails closed.
- Confidence: medium. The queue side was not read. Priority: P2.

### PC-30. Text leave loses `ref` and `line`

- Where: `SV:1088`, `A:425`, compare `SV:1089`.
- The person path has no `ref`, so a retry writes a second row, at local time. The other branch has `ref`, `line` and `consentAt`.
- Confidence: high. Priority: P2.

### PC-31. Delete everything is open to a banned person

- Where: `API:626-638`, `SV:1752`.
- `SV:1752` says photos stay for the safety team. A banned person with a fresh login can delete them. The ban row stays. PRD and privacy duties may require this, so it is a policy question.
- Confidence: high. Priority: P1.

### PC-32. Terminal suggestion rows and empty batches have no retention

- Where: `PS:422`, `PS:449`.
- V2 delete leaves an empty batch with window, timezone and owner ids. Rejected, expired and withdrawn rows stay with `source`, `observed_at`, `kind`, `confidence`, `connection_id`, until leave. `expirePending` clears only text.
- Confidence: high. Priority: P2.

### PC-33. Comments disagree with the code

- `A:431` says delete removes "own blocks". Code keeps them (`PG:317`).
- `A:465` says revoke is logged in the consent ledger. It writes nothing there.
- `PG:289` and `ST:157` are correct. `SV:1731` says numbers are suppressed, correct for numbers on `phone_hash` only.
- Confidence: high. Priority: P2.

### PC-34. Export omits photos

- Where: `A:447`, `SV:828`.
- Export has no photo rows, not even ids or times. Scores stay out by rule. `profile.photoConsent` is included, because `live.profile` is exported.
- Founder correction: export requests go to help@ntwrk.party, so staff may use another path.
- Confidence: high. Priority: P2.

---

## 11. Modelling order

1. Model A (send permission). Highest value. Expect PC-01, PC-02 and PC-04 as counterexamples.
2. Model C (photos and ratings). Small, with a clear race. Expect PC-05.
3. Model B (account sagas). Needs step-level actions. Expect PC-07, PC-08, PC-10.
4. Model D (photo relay). Expected to verify. Keep as a regression guard.
5. Model E (suggestions). Atomic transactions make it simple. Use two clocks and two chats.

General abstractions:

- Treat one `sql.begin` as one atomic action. Treat each `await` between transactions as a possible crash and interleave point.
- Replace phones with small ids, and hashes by the identity function.
- Treat Cloud proofs as a boolean with a deadline.
- Time: integer ticks, with a separate `cloudNow` for PC-15.
