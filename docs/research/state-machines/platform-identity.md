# Platform identity state machines (packages/platform)

Scope: people, phones, phone changes, OTP and login, sessions, memberships, join modes, pending joins, bans, cloud auth, proxy signing.

This file is research output. It changes no behavior. Line numbers are for branch `claude/quint-state-machines` at commit a0ed7bc. "accounts.ts" means `packages/platform/src/accounts.ts`, and the same for the other files in that folder. "service.ts" means `packages/network/service/service.ts`.

Priority key: P0 is safety critical (minors, consent, STOP, review gate, leak guard, bans, auth). P1 is money, data integrity or delivery. P2 is other.

Note on the founder correction of 2026-10-19: the four public sites have no sign-in link, settings page or dashboard. The `/api/me/*` routes in `api.ts` still exist and are reachable. They are still in the state space, because a client can call them and because OAuth and agent flows use the same session and account code. Do not remove them from a model.

## 1. Summary

### 1.1 Machines

| Id | Name | Kind | Priority | Model with |
|---|---|---|---|---|
| `person-lifecycle` | Person, tombstone, revive | implicit | P0 | identity-core |
| `phone-identity-hold` | Phone identity and recycled-number hold | implicit | P0 | identity-core |
| `phone-change` | Member number change (two steps) | implicit | P0 | identity-core |
| `membership` | Membership per app | explicit | P0 | identity-core |
| `web-join` | Web join transaction | implicit | P0 | identity-core |
| `text-join` | Text join and `pending_texts` kind `join` | implicit | P0 | identity-core |
| `pending-followups` | `looking_for`, `share`, `photo_consent` | implicit | P1 | alone (small) |
| `staff-invite` | Invite gate and join mode | implicit | P0 | identity-core |
| `ban` | Bans by phone and by person | implicit | P0 | identity-core |
| `suppression` | Suppression hash | implicit | P0 | identity-core |
| `age-floor` | Lowest age, person and phone floor | implicit | P0 | identity-core |
| `consent-ledger` | Consent per number and app | implicit (event fold) | P0 | identity-core; join with the STOP model |
| `otp-challenge` | OTP challenge | implicit | P0 | login |
| `web-session` | Web session and rotation chain | implicit | P0 | login |
| `cloud-handoff` | Cloud sign-in handoff | implicit | P0 | cloud |
| `cloud-session-validation` | Delegated session and grant validity | implicit | P0 | cloud |
| `proxy-signature` | Signed proxy request | implicit | P0 | alone |
| `rate-window` | `hit()` fixed windows, gaps and retention | implicit | P1 | login, plus a retention check |
| `join-lock` | `withLock` and the age guard | implicit | P1 | concurrency notes only |
| `share-grant` | Share grant | implicit | P2 | alone |
| `auth-mode-config` | Boot config and auth mode cutover | implicit | P1 | alone |
| `retention-purge` | Retention purge | implicit | P1 | with `rate-window` |

### 1.2 Suspected defects, most severe first

| # | Title | Where | Confidence |
|---|---|---|---|
| D1 | A pending join age is replaced by a later, older age; the lowest age does not win | service.ts:1403, 1431 | High |
| D2 | Web OTP does not refuse a banned number | api.ts:471, 485-491 | High |
| D3 | The 30-day STOP hint gap is cut to about 2 days by the rate-limit purge | service.ts:1160, pg-store.ts:286 | High |
| D4 | `clearHold(new_owner)` is not atomic and cannot be retried after a crash | accounts.ts:203-211 | High |
| D5 | An under-13 age on a join path leaves other memberships in place | service.ts:1417-1425, accounts.ts:357-362 | Medium |
| D6 | `looking_for` stays open after a reply with no app word, so a later chance word enrolls the person | service.ts:1115-1118 | Medium |
| D7 | Legacy `channel_identities` keep the old number after a move and ignore a hold | pg-store.ts:341-379, runtime.ts:390 | Medium |
| D8 | Legacy people have no `phone_hash` and no consent events: bans escape and `activeMembership` always fails | 0006 backfill, service.ts:1740 | Medium |
| D9 | Writers that are not under the join lock race joins; whole-row `putMembership` loses updates | accounts.ts:335-343, service.ts:804, 1110, 1490, 1754, photoIntake.ts:124 | Medium |
| D10 | A web join rollback leaves an orphan network member and a lifted suppression | accounts.ts:386-393, service.ts:791-793 | Medium |
| D11 | `leave` is not atomic: after a crash the membership reads active with no network member | accounts.ts:425-428 | Medium |
| D12 | Session rotation has no compare-and-set: chains fork and can come back after a move or delete | sessions.ts:52-56 | Medium |
| D13 | Account actions ignore `who.personId`, so a stale session acts on the current owner of the number | accounts.ts:398-407, 421-463 | Medium (needs a recycled number) |
| D14 | A ban or a hold does not end sessions or OAuth grants | service.ts:1734-1766, accounts.ts:176-184 | Medium |
| D15 | Cloud mode: a suppressed number cannot sign in, and only a join lifts suppression | api.ts:437, 683-684 | High (code), Medium (impact) |
| D16 | Recycled-number detection is event-driven; sends to a stale number continue | accounts.ts:170-184, service.ts:696-716 | Medium (design gap) |
| D17 | `movePhone` writes `eliza_notices` with the wrong key, so the statement does nothing | pg-store.ts:368-369, service.ts:1164 | High (low impact) |
| D18 | A STOP in flight during a move is written to the old number and is lost for the person | accounts.ts:398-407, pg-store.ts:351-354 | Low to Medium |
| D19 | A phone-scope ban that lands during a move stays on the old hash | accounts.ts:259-264, service.ts:1740-1751 | Low |
| D20 | A move merges consent by time and does not tell the gateway fence | pg-store.ts:351-354, AGENTS.md consent path | Low to Medium |
| D21 | `CLOUD_CLOCK_SKEW_MS` is dead on the production path; any Cloud clock lead refuses the login | network-delegation.ts:40, cloud-delegation.ts:22, api.ts:436 | Medium |
| D22 | Dead states: `membership.review` is never written; `onboarding` has no exit | store.ts:28, accounts.ts:378, service.ts:1444 | High |
| D23 | Limits burn on refusal: comment says a refused request is not counted | otp.ts:4-5, 171-184 | High (low impact) |
| D24 | `clearHold(same_owner)` is two writes and can re-hold | accounts.ts:199-200 | Low |
| D25 | Cloud grant trigger makes `movePhone` throw after an auth mode change | oauth.sql:66-71, pg-store.ts:373 | Low |
| D26 | The process-wide lock queue holds through a member unit of work | pg-store.ts:249-254, service.ts:1142-1149 | Low to Medium |
| D27 | A signed `ip` of `unknown` removes the IP header, so the signed check fails further in | backend.ts:247, router.ts:101 | Low |

Detail for each defect is in section 3.

## 2. Machines

### 2.1 `person-lifecycle`

**Kind:** implicit. **State:** `platform.people` row, with `deleted_at`, `phone_hash`, `lowest_age` (0003_platform.sql:63, 0007:250). Store: pg-store.ts:60-73, 304-326.

**States:**

| State | Definition |
|---|---|
| `none` | No row. |
| `live` | Row, `deleted_at` null, one `phone_identities` row. |
| `live_held` | `live`, and the phone has `hold` set. `personFor` answers undefined (accounts.ts:142-147). |
| `tombstone_linked` | `deleted_at` set, `phone_hash` set. A join by the same hash revives it. |
| `tombstone_detached` | `deleted_at` set, `phone_hash` null. It is never revived. |
| `live_no_hash` | Legacy row from the 0006 backfill: `phone_hash` null. |

**Transitions:**

| From | Event | Guard | Effect | To | Where | Actor |
|---|---|---|---|---|---|---|
| none | web join | age passes, not banned, not held | new row, new phone | live | accounts.ts:371, pg-store.ts:64-73 | member |
| none | text join | name and age pass | same | live | service.ts:1437 | member |
| none | staff invite | not held, not suppressed, not banned | new row with `lowest_age` null, method `staff` | live | accounts.ts:337 | staff |
| tombstone_linked | any `createPerson` with the hash | newest tombstone first | clear `deleted_at`, set `lowest_age` | live | pg-store.ts:67-68 | member or staff |
| live | delete everything | session fresh (10 min), not held | see below | tombstone_linked | accounts.ts:432-444, pg-store.ts:304-326 | member |
| live_held | staff `new_owner` | hold set | forget all, tombstone, detach hash | tombstone_detached | accounts.ts:203-211 | staff |
| live | number change | section 2.3 | `phone_hash` moves | live | pg-store.ts:355 | member |

Note on the invite row: `createPerson` with method `staff` writes `phone_identities.verified_at = now` for a number nobody proved (accounts.ts:299-301, 337). The word "verified" does not hold for this row. `lastSeenAt` also starts at the invite.

**Invariants:**

- `phone-person`: every `phone_identities` row points to a person with `deleted_at` null. In code `personFor` treats the other case as no person, and then `createPerson` would hit the primary key.
- `one-phone`: a person has at most one phone. The schema allows more; the code assumes one (pg-store.ts:178, service.ts:1620-1629).
- `delete-keeps-safety`: after a delete, the suppression row, the blocks, the age floor and any bans stay (AGENTS.md, README "Rules the code keeps").
- `new-owner-not-revived`: after `new_owner`, no later join by that number gets the old person id. Test: api.test.ts:302-303.

**Interactions:** blocks and bans use the person id. A tombstone keeps blocks. A revive after `deleteAll` makes blocks hold again by design. A number that is reassigned after a delete also revives the old person: the tombstone stays linked in that path. Only `new_owner` detaches it.

**Concurrency:** `deleteAll` is one transaction (pg-store.ts:304-326), but the forget hooks run before it, out of that transaction (accounts.ts:438-443). A crash after the hooks leaves a live person with memberships still `active` and network rows gone. A retry repeats the hooks and finishes. The session lives until the store delete, so the retry is possible. `deleteAll` takes no join lock, so a join in flight can write a membership and a consent row after the delete (see D9).

### 2.2 `phone-identity-hold`

**Kind:** implicit. **State:** `platform.phone_identities` (`hold`, `hold_at`, `last_seen_at`) (0003:72, 0006:23-24).

**States:** `absent`, `ok`, `ok_stale` (implied: `last_seen_at` more than 365 days old, hold not yet set), `held`.

`ok_stale` matters. `stale()` (accounts.ts:170) is computed on read. No job writes it.

| From | Event | Guard | Effect | To | Where | Actor |
|---|---|---|---|---|---|---|
| ok | `seen` | not stale | `touchPhone` | ok | accounts.ts:182 | login, join, inbound |
| ok | clock | 365 days pass | none | ok_stale | implied | clock |
| ok_stale | `seen` | stale | `setPhoneHold` | held | accounts.ts:181 | login, join, inbound |
| held | `seen` | none | none | held | accounts.ts:180 | any |
| held | staff `same_owner` | hold set | clear hold, touch | ok | accounts.ts:198-201, service.ts:2268 | staff (admin@*) |
| held | staff `new_owner` | hold set | section 2.1, phone row deleted | absent | accounts.ts:203-211 | staff |
| ok | delete everything | | row deleted | absent | pg-store.ts:318, 322 | member |
| ok(old) | move | section 2.3 | row replaced by the new number | absent(old), ok(new) | pg-store.ts:348-349 | member |

**Callers of `seen`:** `/api/auth/otp/verify` (api.ts:489), Cloud callback (api.ts:439), `joinLocked` (accounts.ts:353), inbound after the STOP check (service.ts:1061), MCP `login` (hooks.ts:168). A session use does not call `seen`. A proactive send does not call it.

**Read side:** `activeMembership` and the number change steps refuse `ok_stale` as well as `held` (accounts.ts:231, 251, 321). `personFor`, `canJoin` and `stop` read only `hold`.

**Invariants:**

- `held-no-account` (AGENTS.md-level rule in README "Rules the code keeps"): while held, no API shows or changes the old owner's data. STOP still works.
- `stop-always`: STOP is handled before `seen` (service.ts:1054-1057 before 1061).
- `held-not-addressable`: runtime.ts:396-397 removes a held number from platform addresses. The legacy branch does not (D7).

**Liveness:** every hold must end by a staff decision. There is no timeout and no sweep, and that is intended. A held number is stuck until staff act. Only `admin@*` can act.

**Concurrency:** `seen` is read, then write, with no transaction. `clearHold` is two or more writes. See D4 and D24.

### 2.3 `phone-change`

**Kind:** implicit. **State:** `platform.phone_changes` (0033_phone_changes.sql). PRD F25, runbook-real.md 9.2.

**States:** `none`, `waiting` (row, `confirmed_at` null, age up to 15 min), `expired` (implied: same row, older than 15 min), `confirmed` (hashes only, kept as audit), and `purged`.

| From | Event | Guard | Effect | To | Where |
|---|---|---|---|---|---|
| none or waiting or expired | `/api/me/phone/start` | not cloud, session started within 10 min (api.ts:593), new number differs, own phone ok, person matches, not banned, 3 a day per person, OTP start ok | new row; older waiting row deleted | waiting | accounts.ts:227-240, pg-store.ts:328-336 |
| waiting | `/api/me/phone/confirm` | not cloud, within 15 min, code right, not banned, new number free | `movePhone` | confirmed | accounts.ts:249-274 |
| waiting | wrong code | | attempt used | waiting | otp.ts:206-210 |
| waiting | clock 15 min | | none | expired | accounts.ts:255 (read side) |
| expired | confirm | | `no_pending_change` | expired | accounts.ts:255 |
| expired or waiting | purge after 2 days | | row deleted | none | pg-store.ts:288 |
| any | delete everything | | rows deleted | none | pg-store.ts:324 |

`requestedBy` is always `member`. There is no staff writer of this table in the code. The header comment names a staff change, and PRD F25 names steward review for a lost number. Neither is built.

**`movePhone` transaction (pg-store.ts:342-378):** lock old phone row; check new is free; insert new, delete old; copy consent rows and delete the old ones; set `people.phone_hash`; merge age floor; delete old sessions, challenges, pending rows; end waiting outbound rows; move `eliza_notices` (no effect, D17); update `oauth.grants.phone_key`; confirm the change row.

**After the commit (not atomic):**

1. `unsuppress(newHash)` runs inside the lock but in a separate transaction (accounts.ts:265).
2. The new number's age floor is folded into the person (accounts.ts:270-271).
3. Listeners run (accounts.ts:272).
4. The API makes a new session (api.ts:618).

**Invariants:**

- `proof`: a move needs a code from the new number. The code proof is checked before the facts about the new number, so the start answer gives no enumeration.
- `no-escape`: a banned person or number never moves (accounts.ts:235, 260-261).
- `one-owner`: `phone_identities.e164` is the primary key, and the lock on `join:<new>` serializes with joins.
- `lowest-age-kept`: lowest of the person, the old floor and the new floor stays.
- `old-sessions-end`: no live session has e164 = old after the move (but see D12).

**Concurrency and failure:**

| Case | Result |
|---|---|
| Two confirms | `verify` is true once. The other answers `invalid_code`. |
| A second start during confirm | `change` id no longer exists; `update ... returning` is empty; the transaction throws (pg-store.ts:376); API answers 500; nothing moved. The code is used up. Safe. |
| Crash after `verify`, before the lock | Code used, nothing moved. The person starts again. |
| Crash after commit, before step 1 | The new number stays suppressed. `consentRefused` refuses every send to it. Recovery: only a new join on that number lifts it, and the person is a member, so `joinLocked` returns early with no unsuppress. Stuck until staff act. This needs a deleted earlier owner of the new number and a crash. |
| Crash after commit, before step 2 | `person.lowest_age` and `network.members.age` are not lowered, and the age hook does not run (photos of a new minor are kept). `accounts.lowestAge` and the `matching_ages` view still see the floor. |
| Listener failure | Logged, swallowed. Addresses refresh on the next `identities()`. runbook-real.md 9.2 records the replica limit. |
| Ban between check and move | D19. |
| Join on the old number during a move | The lock names only the new number (accounts.ts:258). A join on the old number can write consent to the old number after the copy. |

### 2.4 `membership`

**Kind:** explicit (`platform.memberships.state`, CHECK at 0003:88; union at store.ts:10). **Primary key:** `(app_id, person_id)`. `member_id` is unique.

**States:** `absent`, `invited`, `onboarding`, `active`, `paused`, `restricted`, `removed`. Implied: `deleted` (row removed by delete everything). Separate field `review` is never set (D22).

| From | Event | Guard | To | Where | Actor |
|---|---|---|---|---|---|
| absent, removed | staff invite | not held, not suppressed, not banned | invited | accounts.ts:335-343 | staff |
| absent, removed, invited | web join, open app | age, not banned, not held | active | accounts.ts:375-383 | member |
| invited | web join, invite app | same | active (keeps member id) | accounts.ts:377 | member |
| absent, removed, invited | any join, waitlist app | same | onboarding | accounts.ts:378, service.ts:1444 | member |
| any non-invited with no network member | text join | banned refused | active (new member id, unless invited) | service.ts:1442-1446 | member |
| absent, removed, invited | `enroll` | not banned, age | active | service.ts:1487-1490 | member |
| active | STOP (web or text) | scope covers the app | paused | service.ts:804 | member |
| paused | START on the routed app | not banned, the START is not older than the STOP | active | service.ts:1110 | member |
| any live | ban | not `removed`, not `invited` | restricted | service.ts:1754 | staff |
| any non-removed | leave | | removed | accounts.ts:421-429, pg-store.ts:293-302 | member |
| active | join hook failure | | removed | accounts.ts:390 | system |
| any non-removed | declined under 13 in chat | | removed | service.ts:1304-1309 | system |
| any | delete everything | | deleted | pg-store.ts:315 | member |
| any | staff `new_owner` | | deleted | accounts.ts:207 | staff |

Non-transitions to model on purpose:

- `invited` has no expiry.
- `onboarding` has no exit (D22).
- `restricted` has no exit. A leave moves it to `removed`, but the ban row stays.
- A repeat web join on `paused`, `restricted` or `onboarding` returns the existing row and writes no opt-in (accounts.ts:357-363).
- `paused` is only entered from `active`. A STOP on `onboarding` writes no state.
- A global STOP pauses all apps. START resumes one, chosen by routing (service.ts:957-983).

**Invariants:**

- `age-gate`: `active` implies the lowest age is at least the join age.
- `minor-single-player` (founder decision 1): a member under 18 is never matched. `canBeMatched` and the `matching_ages` view enforce it. This file does not own the matching side.
- `active-means-reachable`: `activeMembership` (accounts.ts:319-329) is the canonical gate. It needs phone not held and not stale, person match, not banned, join age, state exactly `active`, review null, not suppressed, opted in. Model this as one predicate and check every caller against it.
- `state-consent-agree` (should hold, does not always): `paused` iff opted out. A held number's web STOP writes the ledger with no pause (accounts.ts:403-406). The send gate reads the ledger, so this is safe, but the model must not assume the two agree.
- `no-pair-divergence`: `platform.memberships.state` and `network.members.account_status` are written in separate transactions (D10, D11).

**Readers disagree on "live":**

| Reader | Accepts |
|---|---|
| `activeMembership` | active |
| `/api/me/home`, `submitProfile`, MCP slop eligibility | active, onboarding |
| photos, `verifiedAdult`, photoIntake | active, paused, onboarding |
| `share` | all but removed and invited |
| `stopped` | all but removed and invited |

**Concurrency:** `putMembership` is a whole-row upsert (pg-store.ts:124-129) and has no version. Callers read, spread, write. See D9.

### 2.5 `web-join`

**Kind:** implicit, ordered async steps. `Accounts.join` (accounts.ts:345-395), under `withLock("join:<e164>")`. Each store call is its own transaction.

```
consentMatches -> lock -> seen -> personFor -> banned -> existing? ->
  invite gate -> joinAgeCheck -> createPerson -> recordAge -> unsuppress ->
  putMembership -> addConsent(opted_in) -> attachPerson -> onJoin(createMember, welcome)
  on failure: forgetMembership + addConsent(opted_out, join_failed), rethrow
```

**Outcomes:** `consent_wording`, `review` (held or banned), `invite_only`, `under_age`, `ok` (new), `ok` (existing), `join_failed`.

**Crash windows:**

| After | Result | Recovers? |
|---|---|---|
| `createPerson` | Person and phone, no membership. Age was recorded. | Yes, next join finds the person. |
| `unsuppress` | Suppression gone, no join. | No. The suppression is lost (D10). |
| `putMembership` | Active, no consent, no network member. Repeat join returns the row as existing (accounts.ts:357): no opt-in, no member. | No, by web. Text join heals it. |
| `addConsent` | Active, opted in, no network member. Same. | Same. |
| `createMember` | Network member and membership, no welcome. Repeat join returns existing. | Partly: never welcomed. |

**Duplicates:** ten parallel joins make one person, one membership, one member, one opt-in. Test: api-security.test.ts:58-68. The test runs in one process.

**Guard asymmetry with the text path:** text `join()` has no `try/catch` rollback. Recovery there is the Inbox retry.

### 2.6 `text-join` (with `pending_texts` kind `join`)

**Kind:** implicit. **State:** `platform.pending_texts` (phone_hash, kind, app_id, name, age, home_city, at). PK at 0007:151. TTL: `PENDING_MS` = 1 day on read (service.ts:119, 997-1000), row purged after 2 days.

`putPending` deletes the phone's other row of that kind (pg-store.ts:271), so there is one `join` row across apps. `share` is per app.

**States:** `none`, `asked(name?)`, `have_age(age, name=null)`, `expired`, `joined`, `declined`.

All transitions are in `join()` (service.ts:1384-1464), under `withLock("join:<e164>")` (service.ts:1142).

| From | Event | Guard | Effect | To | Line |
|---|---|---|---|---|---|
| any | banned | | no reply | same | 1390 |
| any | invite app on its own line | not invited | one reply a day | none | 1393-1399 |
| none, asked | text with no age | | put pending; reply at most 3 a day | asked | 1411-1414 |
| any | invalid home | age or not | ask again; no write | same | 1407-1410, 1426-1429 |
| any | age fails check | | `recordAge`; delete pending; decline | declined | 1417-1424 |
| none, asked | age ok, no name | | put pending with the age; **no age record** | have_age | 1431 |
| have_age, asked, none | age and name | | delete pending, person, age, unsuppress, membership, consent, member, welcome | joined | 1435-1463 |
| have_age | new age and name | **`said.age` replaces `p.age`** | as above | joined | 1403 |
| any | STOP | | all pending deleted | none | 1328 |
| asked or have_age | message routed to another app | `p.app !== app.id` | row ignored, then replaced | none | 1401 |
| any | 1 day | | ignored on read | expired | 997-1000 |
| any | purge | older than 2 days | row deleted | none | pg-store.ts:287 |
| any | delete everything | | row deleted | none | pg-store.ts:323 |
| any | number change | | old hash rows deleted | none | pg-store.ts:363 |

**Invariants:**

- `lowest-wins` (AGENTS.md decision 1): the person's age after a join is the lowest age stated. **Fails, D1.**
- `nothing-stored-before-join`: the README says nothing is stored until the name and an age arrive. This rule is why the age is not on the floor. The rules conflict: the pending row is already stored, keyed by hash, so writing the floor at that step adds no new kind of data.
- `one-reply-per-message`: at most one reply per inbound id (`sys:<rowId>`).

**Retry:** Inbox retries with the same `rowId`. `addConsent` is idempotent by ref. `deletePending` ran before the crash, so a retry can read a new message with no pending row. Text in that message still parses if it holds name and age.

### 2.7 `pending-followups`

**Kind:** implicit. Same table.

| Kind | Written | Consumed | Stale cleanup |
|---|---|---|---|
| `looking_for` | service.ts:1461 (no-keyword join on the shared line) | `enroll` when `lookingFor(text)` is non-empty (service.ts:1115-1118, 1496) | 1 day by read; STOP; delete; move |
| `share` | service.ts:1456 (a second app joined) | exact `SHARE` text (service.ts:1113) | same |
| `photo_consent` | photoIntake.ts:90 | `YES PHOTOS` or `NO PHOTOS` routed to slop (photoIntake.ts:112-134) | same; explicit `> DAY` check at line 118 |

**Invariants:** an answer applies only to its open question. A leave of `ntwrk` does not delete `looking_for`, but the `memberId` guard stops it. `enroll` runs with no join lock. It writes a consent row per app with source `looking_for`. See D6.

**Priority:** P1, because `enroll` creates memberships and opt-ins. Treat `enroll` as P0 in the model of consent.

### 2.8 `staff-invite` and join mode

**Kind:** implicit. Join mode is explicit data: `invite | open | waitlist` (apps.ts:13, CHECK at 0003:25). Runtime values come from `platform.apps` (service.ts:455-457). AGENTS.md 2026-10-09 decision 1: slop, peon and friends are open; ntwrk stays invite-only on the web.

**Rule table for a non-member, app `ntwrk` (join mode `invite`):**

| Entry | Invited? | Result |
|---|---|---|
| Web `/api/join` | no | `invite_only`, nothing stored (accounts.ts:364) |
| Web `/api/join` | yes | joins |
| Own line (`app_lines`) | no | one reply a day (service.ts:1393) |
| Shared line | any | text join (service.ts:1393 guard `route.shared && app.id === "ntwrk"`) |

`canJoin` (accounts.ts:307-316) and `joinLocked` must agree. They do: same order of held, banned, member, invite gate. The age is only in `joinLocked`, by design.

**Invite flow:** `Accounts.invite` (accounts.ts:335-343) then a `direct` text (service.ts:1553-1564). No join lock (D9). The direct text is `transactional`. The Blooio adapter enqueues it (channel.ts:238-243). Whether the queue refuses it after a global STOP is in the outbound queue scope. Check it in that model. `accounts.invite` itself does not read the consent ledger.

### 2.9 `ban`

**Kind:** implicit. **State:** `platform.bans` (append only for `platform_service`, 0011:26-27). `Ban.scope` is `phone | person`.

**States per person and number:** `clear`, `phone_banned`, `person_banned`. Terminal: no code removes a ban.

**Transition:** `NetworkService.ban` (service.ts:1734-1766), staff with safety@* or admin@*:

```
audit requested -> rows -> suppress(hashes, "banned") -> dropRatings ->
memberships restricted (loop) -> network status restricted + markBanned (loop) -> audit result
```

No transaction spans these. The ban rows go first, so a crash leaves the ban in force.

`isBanned` (pg-store.ts:173-176) matches `phone_hash` on any scope, or `person_id` on scope `person`. With no phone identity left, `accounts.banned` gets a null person id (accounts.ts:166-168), so only the hash row matches. A person ban therefore needs its hash row to survive a delete. It has one when `phoneHashesOf` is not empty (D8).

**Enforcement map (founder decision 3 of 2026-10-09: refused at join on web, text and MCP, OTP and inbound):**

| Point | Checked? | Where |
|---|---|---|
| Web join | yes | accounts.ts:355 |
| Text join | yes | service.ts:1390 |
| `enroll` | yes | service.ts:1476 |
| START | yes | service.ts:1103, 1134 |
| Number change | yes | accounts.ts:235, 260-261 |
| MCP OTP start | yes | hooks.ts:159 |
| MCP login | yes | hooks.ts:168 |
| Cloud callback | yes | api.ts:437 |
| Cloud grant check | yes | api.ts:683 |
| Send path | yes | service.ts:708-710 |
| `/internal/turn` admission | yes | service.ts:2062 |
| Web OTP start | **no** | api.ts:471 |
| Web OTP verify | **no** | api.ts:485-491 |
| Inbound member message | no explicit check; network hold applies | service.ts:1099-1125 |
| Site session use | partial: `/api/me` reads as review; share, stop, leave, delete, export run | api.ts:505-638 |
| MCP `session` hook | **no**: held only | hooks.ts:206 |

**Invariants:** `ban-terminal`, `ban-covers-delete` (ban survives delete everything), `banned-no-new-account`, `banned-no-send` except compliance.

### 2.10 `suppression`

**Kind:** implicit. **State:** row in `platform.suppression` (`phone_hash`, `reason`: `deleted` or `banned`).

| From | Event | To | Where |
|---|---|---|---|
| clear | delete everything | suppressed(deleted) | pg-store.ts:307 |
| clear | ban | suppressed(banned) | service.ts:1751 |
| suppressed | web join | clear | accounts.ts:374 |
| suppressed | text join | clear | service.ts:1440 |
| suppressed | number change to it | clear | accounts.ts:265 |
| suppressed | staff `new_owner` | clear | accounts.ts:210 |

`suppress` has `on conflict do nothing`, so the first reason stays. `unsuppress` ignores the reason. Bans keep working through the ban row, because a ban is checked before each unsuppress, except in `new_owner` where the ban row alone still blocks.

**Readers:** `invite`, `activeMembership`, `consentRefused`, Cloud callback, Cloud grant, turn admission, `learning-consent-context`, `profile-suggestions`.

**Invariant:** a suppressed number gets no send but compliance. The first opt-in step lifts suppression before the opt-in exists (D10).

### 2.11 `age-floor`

**Kind:** implicit, monotone minimum. **State:** `platform.people.lowest_age`, `platform.age_floor.lowest_age`, `network.members.age`, pending age (not a floor).

**Effective age:** `accounts.lowestAge` = min(person, floor) (accounts.ts:277-279). The `platform.matching_ages` view = least(member, person, floor by `p.phone_hash`) (0038:7-10).

| Event | Effect | Where |
|---|---|---|
| `recordAge` | floor gets the min, person gets the min, hook fans out to members | accounts.ts:282-296 |
| delete everything | floor set from person; person age cleared | accounts.ts:437, pg-store.ts:319 |
| revive | person age set from the join | pg-store.ts:67 |
| move | floors merged on the new hash | pg-store.ts:356-360 |
| `new_owner` | floor cleared | accounts.ts:211 |
| chat statement | `statedAge` (service.ts:1293-1310) | |

**Exceptions to the strict minimum:** `clearAgeFloor` for a new owner. `statedAge` records under-13 claims as 13 unless the Network declined. The join path has no such rule (D5).

**Invariants:**

- `monotone`: outside `new_owner`, the effective age for a phone never rises.
- `fan-out`: `network.members.age` follows, and it is retried: the hook runs on every `recordAge` even with no change (accounts.ts:291-293).

**Concurrency:** `noteAgeFloor` runs under `withPhoneAgeGuard`, separate from the join lock. In `PgPeopleStore` the guard's in-process queue is one tail for all phones (pg-store.ts:90-96). `recordAge` is not atomic, and a `finally` makes the person update run even if the floor cleanup fails. Good: person-level safety comes first.

### 2.12 `consent-ledger`

**Kind:** implicit, a fold over append-only events. `platform.consent_events`. `platform_service` has no UPDATE (0007:238). Delete is allowed. The STOP path itself belongs to the network and gateway research. This section covers what identity changes do to it.

**State for (number, app):** `none`, `opted_in`, `opted_out` by `resolveConsent(lastApp, lastGlobal)` (consent.ts:37-43).

| Case | Result |
|---|---|
| no app event, global out | opted_out |
| no app event, no global out | none |
| app event, no global or global in | app state |
| app in, newer than global out (strict) | opted_in |
| otherwise | opted_out |

Global opt-in events are never written by the code. A tie goes to opted_out. Good.

**Identity effects on the ledger:** delete everything removes all events for the number (pg-store.ts:313); a move copies, then deletes (pg-store.ts:351-354); `new_owner` removes them through `deleteAll`.

**Note:** `none` and `opted_in` differ. `activeMembership` needs `opted_in`. `consentRefused` refuses only `opted_out`, so `none` can receive sends (D8).

**Event time:** `consentAt` uses the gateway receipt time in a signed turn (service.ts:1357-1361). Web events use now. Mixed clocks can reorder events. Model `at` as a value the environment chooses, within bounded skew.

### 2.13 `otp-challenge`

**Kind:** implicit. **State:** `platform.otp_challenges` (`attempts`, `expires_at`, `consumed_at`, `provider`, `code_hash`).

**States:** `none`, `live(attempts<5)`, `exhausted`, `expired`, `consumed`, `superseded` (a newer row for the same app and number; `latestChallenge` reads only the newest), `purged`.

| From | Event | Guard | Effect | To | Where |
|---|---|---|---|---|---|
| any | start | ip, phone hour, gap, day, global limits | send, then row | new live; old superseded | otp.ts:166-195 |
| any | start, provider throws | limits passed | log; `{ok:true}`; no row | unchanged | otp.ts:191-194 |
| live | verify wrong | verify limits, provider same, attempt claimed | attempts+1 | live or exhausted | otp.ts:198-210, pg-store.ts:204-208 |
| live | verify right | same | consume | consumed | otp.ts:211, pg-store.ts:209-212 |
| exhausted, consumed, expired | verify | | false | same | pg-store.ts:205-206 |
| live | clock 10 min | | | expired | claim guard |
| any expired | purge | 2 days past expiry | row gone | purged | pg-store.ts:284 |
| any | delete everything; move | number | rows gone | none | pg-store.ts:312, 362 |

**Invariants:**

- `one-use` (PRD): a code is true at most once. `consumeChallenge` is the atomic gate, and `claimAttempt` bounds the guesses.
- `app-bound`: hash includes app and number; verify reads per app.
- `provider-bound`: `c.provider !== provider.name` refuses (otp.ts:205).
- `no-enumeration`: `start` gives the same answer and at least 700 ms (api.ts:475). Banned or not gives the same answer on MCP. The web has no ban branch at all.
- `purpose-free`: the challenge has no purpose field. A login code and a number-change code are the same object. A login code for number B on app X confirms a number change whose `change.app` is X. Possession of B is proved either way, so this is not a defect, but the model must allow it.

**Twilio:** `check` errors read as false and use an attempt (otp.ts:209).

**Blooio:** uncertain send throws, so no challenge exists and the code is unusable (otp.ts:99-104, README).

**Concurrency:** parallel starts: 20 starts send one SMS (api-security.test.ts:143-148), because the gap check runs under `pg_advisory_xact_lock` in `hit`.

**Failure:** a crash between send and `putChallenge` leaves a delivered code with no row. Harmless.

### 2.14 `web-session`

**Kind:** implicit. **State:** `platform.sessions`. `revoked_at` may be in the future (the grace time).

**States:** `none`, `live`, `grace` (`revoked_at` in the future), `revoked`, `expired`, `deleted`.

| From | Event | Guard | Effect | To | Where |
|---|---|---|---|---|---|
| none | OTP verify | code ok | revoke cookie's session, `seen`, create | live | api.ts:487-491 |
| none | Cloud callback | section 2.15 | create `cloud.` token | live | api.ts:442 |
| none | MCP code step | login ok | create | live | hooks.ts:212-218 |
| none | number change confirm | move ok | create on the new number | live | api.ts:618 |
| live | use, age >= 1 day | | revoke at now+60 s; child session | grace | sessions.ts:52-56 |
| live | use, age < 1 day | | | live | sessions.ts:52 |
| grace | use | | no rotate | grace | sessions.ts:52 |
| grace | clock 60 s | | | revoked | sessions.ts:50 |
| live, grace | logout | | revoke now (`least`) | revoked | pg-store.ts:222-224 |
| live | clock | min(30 d from create, 90 d from start, cloud bound) | | expired | sessions.ts:36, 50 |
| any | delete everything | e164 or person | row gone | deleted | pg-store.ts:311 |
| any | move | e164 = old | row gone | deleted | pg-store.ts:361 |
| live | cloud status invalid | | revoke | revoked | api.ts:319 |
| any | purge | 2 days past | row gone | deleted | pg-store.ts:285 |

**`person_id`:** set at create. `attachPerson` fills null rows for that number at a web join only (accounts.ts:385). A text join and an invite do not. A session with null person keeps working through `personFor(e164)`, but `/api/photos` uses `session.personId` directly (api.ts:347, 365), so that session sees no person until a new login.

**Invariants:**

- `app-bound` (sessions.ts:50).
- `token-hash-only`.
- `chain-bound`: every rotation keeps `startedAt`; expiry is at most 90 days after it. The doc comment at sessions.ts:51 names "at the end of its chain", but no such check exists. Rotation goes on; the bound comes from `expiresAt`.
- `step-up`: delete everything and number change need `now - startedAt <= 10 min`. Rotation does not refresh it, since `startedAt` is copied. Test: cloud-auth.pg.test.ts:111-117.
- `no-fixation`: login revokes the cookie's session.
- `cookie-identity-pair`: a Cloud session cookie pairs with an identity cookie by `sessionHash`.

### 2.15 `cloud-handoff`

**Kind:** implicit, a two-service handshake with PKCE. **State:** sealed cookie `cloud_pending` (AES-GCM, AAD kind, 5 min), Cloud's one-time code, then session and `cloud-identity` cookies.

**Modes** (api.ts:152-180): off; `staging-local` (dev only); `own-pages-fresh-person-v1` (staging only); `production-v1` (production only). Each mode refuses a wrong tuple at boot.

| From | Event | Guard | Effect | To | Where |
|---|---|---|---|---|---|
| idle | `POST /api/auth/cloud/start` | return path `/join` | state, verifier, sealed cookie, URL | pending | api.ts:402-410, 250-260 |
| idle | MCP `beginCloudOAuth` | production, rid format | same, return path `/oauth/cloud-return?rid=` | pending | api.ts:646-649 |
| pending | callback bad cookie, state, app, expiry, path | | clear cookie | idle(400) | api.ts:415-416 |
| pending | bad code format | | clear cookie | idle(400) | api.ts:418 |
| pending | exchange refused | | clear cookie | idle(403) | api.ts:423, 430 |
| pending | bad identity | | clear cookie | idle(403) | api.ts:433-436 |
| pending | held, banned or suppressed | | clear cookie | idle(403) | api.ts:437 |
| pending | transport or other throw | | clear cookie | idle(503) | api.ts:452 |
| pending | valid | | revoke old session, `seen`, new session, identity cookie | signed_in | api.ts:438-451 |

**Invariants:** `state` binds the browser. PKCE binds the code. A pending cookie can never pass as an identity, by the AAD kind. Cloud owns one-time use of the code. Test: cloud-auth.pg.test.ts:79-117.

**Concurrency:** a second start in the same browser replaces the cookie, so the first callback fails with 400. Safe.

**Stale check:** `held`, `banned` and `isSuppressed` run before `seen`. If this login makes the number stale, the session gets no person. Good.

### 2.16 `cloud-session-validation`

**Kind:** implicit. **State:** session row, identity cookie, in-memory `validated` map (api.ts:266), Cloud's own view.

**Per request** `cloudSessionStatus` (api.ts:267-283):

| Condition | Result | Effect |
|---|---|---|
| App not in cloud mode | valid, or invalid for a `cloud.` token | |
| Identity cookie missing, wrong app, wrong session hash, expired | invalid | session revoked by `auth` |
| Non-production and cache live | valid | |
| Authority says valid | valid | cache |
| Authority says invalid | invalid | session revoked |
| Authority unreachable | unavailable | 503, session kept |

Production has no cache (`!productionCloud` guard, api.ts:274): one Cloud call per request.

Production identity lasts at most 1 hour: `expiresAt <= issuedAt*1000 + 3600_000` (network-delegation.ts:41). Rotation needs 1 day, so `rotatedCookies` for a Cloud token cannot run on the production path. It is reachable in the staging-local path (test: cloud-auth.pg.test.ts:137-146).

**Grant authority:** `cloudGrantAuthority` (api.ts:658-670) seals the delegation into a grant. `validateCloudGrant` (api.ts:671-687) rechecks the seal, person, held, banned, suppressed, and Cloud.

**Invariants:** `cloud-session-implies-live-proof`; `cloud-token-never-otp`: with cloud off a `cloud.` token is invalid (test line 160-162).

**Cutover effect:** turning Cloud on makes every old OTP session on that app `invalid` at its next use, and it is revoked (test line 66-67).

### 2.17 `proxy-signature`

**Kind:** implicit. **State:** per request; no store. A replay window of 60 s (proxy.ts:23).

**States of a request:** `unsigned`, `signed_valid`, `signed_bad`, `signed_stale`.

**Flow:** the router removes client proxy headers (router.ts:97-100), signs method, path, host, ip, ts (router.ts:104). The backend verifies, then `normalizeEdge` removes or keeps the headers (backend.ts:236-256). `api.ts` verifies again (api.ts:306).

**Invariants:**

- `client-cannot-pick-app`: without a valid signature, the app comes from Host, and on the deployed origin Host names no app (tests/e2e/platform.e2e.test.ts:993-1018).
- `client-cannot-pick-ip`.
- The signature does not cover the body, the cookie or any nonce. A captured request can replay within 60 s with any body. The capture point is the Worker to origin hop, inside TLS.

**Failure:** one secret, no key id. A rotation has a window where the router and the backend disagree: fail closed (404 `unknown_app`). Model as a two-party handshake only if rotation is planned.

### 2.18 `rate-window`

**Kind:** implicit. **State:** `platform.rate_limits (bucket, window_start, count, last_at)`. `hit` (pg-store.ts:229-243) runs in one transaction under an advisory lock.

**States per bucket:** count 0..limit in the current window, plus `prevAt`. Refused hits are not stored.

| Bucket | Window | Rule | Where |
|---|---|---|---|
| `otp:ip:*` | 1 h | limit 10 | otp.ts:171 |
| `otp:phone:*` | 1 h | limit 3, gap 30 s | otp.ts:174 |
| `otp:phone_day:*` | 1 d | limit 6 | otp.ts:179 |
| `otp:global` | 1 h | limit 500 | otp.ts:180 |
| `otp:verify:ip:*` | 1 h | limit 30 | otp.ts:202 |
| `otp:verify:phone:*` | 1 h | limit 10 | otp.ts:203 |
| `phone-change:*` | 1 d | limit 3 | accounts.ts:236 |
| `stop_hint:*` | 30 d | gap 30 d | service.ts:1160 |
| `invite_only:*`, `join_ask:*`, `photo_msg:*`, photo `once` | 1 d | caller reads count | service.ts:1073, 1395, 1412; photoIntake.ts:138 |

**Invariant to check:** for each bucket, retention must exceed the window plus the gap. **Fails for `stop_hint`, D3.** All other buckets have a window of at most 1 day, and purge keeps 2 days.

**Lockout:** ten wrong checks an hour for a number block the owner's right code for that hour from any IP (test: api.test.ts:356-358). This is a known cost of the limit, and any caller who knows the number can do it.

### 2.19 `join-lock`

**Kind:** implicit lock. `withLock` (pg-store.ts:249-261): an in-process promise tail for all keys, then a session advisory lock on a reserved connection.

**Taken by:** web join, text join (service.ts:1142), number change on the new number.

**Not taken by:** `invite`, `enroll`, `leave`, `deleteAll`, `stopped`, `ban`, `clearHold`, `movePhone` on the old number.

**Rules:** `withLock` never nests. The age guard callback must not take `withLock` (store.ts:90). The advisory lock is on an idle connection during `fn`. If that connection dies, the lock is lost and `fn` goes on. The final unlock then throws in `finally` (pg-store.ts:259) and replaces the result.

### 2.20 `share-grant`

**Kind:** implicit (`revoked_at`). **States:** `none`, `active`, `revoked`, `deleted`.

`share` (accounts.ts:476-485) sets active. Upsert also reactivates a revoked row. `revokeShare` (466-473). `forgetMembership` revokes both directions (pg-store.ts:298). Delete everything deletes.

**Read:** only by `revokeShare`. No matching or engine code reads a grant (README "Known gaps"). The machine has no effect outside itself today.

**Invariant:** only `SHAREABLE_FIELDS`. No app names leak: the API answers the same either way (api.ts:568).

### 2.21 `auth-mode-config`

**Kind:** implicit, deploy-time. **State:** env tuple. `PLATFORM_ENV`, `NETWORK_CLOUD_AUTH_*`, `OTP_PROVIDER`, `PLATFORM_PHONE_OTP_ONLY_APPS`, `TURNSTILE_SECRET_KEY`, secrets.

| Mode | OTP routes | Number change | Sessions before cutover |
|---|---|---|---|
| OTP | on | on | |
| Cloud (app in scope) | 409 `cloud_auth_required` | 409 | revoked at next use |

`devShortcutsAllowed` fails closed (env.ts:26). `bootConfigProblems` lists what is missing (env.ts:50-65). `PLATFORM_PHONE_OTP_ONLY_APPS` drops Turnstile for named apps and needs `blooio` (api.ts:139-143). Note `bootConfigProblems` still requires `TURNSTILE_SECRET_KEY` for that case.

**Cutover property:** no mode change makes a `cloud.` token into a plain one, and no mode change makes an OTP session into a Cloud one. Changing `PLATFORM_HASH_KEY` orphans suppression, floors, bans and OAuth keys (README). No code protects against it. Changing `PLATFORM_SESSION_SECRET` ends all sessions and the Cloud seal key.

### 2.22 `retention-purge`

`NetworkService.purge` runs on every tick (service.ts:524, serve.ts:134) with `before = now - 2 days`.

| Table | Rule | Safe? |
|---|---|---|
| `otp_challenges` | `expires_at < before` | yes |
| `sessions` | expired or revoked before | yes |
| `rate_limits` | `last_at < before` | **no for 30-day buckets (D3)** |
| `pending_texts` | `at < before` | yes (read TTL 1 day) |
| `phone_changes` | unconfirmed, requested before | yes |

## 3. Suspected defects

Each was checked by reading the code. None was run. Nothing here is fixed.

### D1. A pending join age is replaced by a later, older age (P0)

`age = said.age ?? p?.age` (service.ts:1403). The branch with age and no name writes the pending row and does not call `recordAge` (service.ts:1431). The next message's age replaces it.

Trigger, on the shared line, with a stranger:

1. Person sends `slop`. Reply: the join question. Pending `join`.
2. Person sends `15`. `parseJoinText` gives age 15, no name. Check passes (13+). Pending has age 15. Reply asks for the name.
3. Person sends `Sam, 25`. `said.age` = 25, name = Sam. `joinAgeCheck(25, undefined)` passes. Person, floor and network member all get 25.

Result: a person who stated 15 is an adult in the record and can be matched. This breaks founder decision 1 ("the lowest age ever stated or recorded wins"). Web join has no such path, because it reads one age.

The same effect comes from expiry, routing to another app, or STOP between the two messages, since the pending row is the only record.

Confidence: High. Model invariant: `after join, person.lowest <= min(all ages stated by this number)`.

### D2. Web OTP does not refuse a banned number (P0)

AGENTS.md decision 3 of 2026-10-09: "a banned number is refused at join (web, text, MCP), OTP and inbound". `POST /api/auth/otp/start` calls `otp.start` with no ban check (api.ts:471). `POST /api/auth/otp/verify` makes a session with no ban check (api.ts:485-491). MCP has the check (hooks.ts:159, 168), and the Cloud callback has it (api.ts:437). `meterOtp` only records cost (cost.ts:147-159).

Trigger: staff ban a number. On a site in OTP mode, that number starts OTP. A code is sent, at the cost of an SMS, and verify gives a session. Join is refused, but the session works for share, stop, leave, delete and export.

The MCP branch shows the wanted shape: same answer, no code. Confidence: High. Note `/api/me` hides the state, so no enumeration is at stake.

### D3. The STOP hint gap is cut by the rate-limit purge (P0 consent)

`stopHint` wants one compliance reply per number and app in 30 days. It uses `hit("stop_hint:...", 30*DAY, now, {minGapMs: 30*DAY})` (service.ts:1160). `purge(now - 2*DAY)` deletes rate rows with `last_at < before` (pg-store.ts:286; service.ts:572). Purge runs each tick.

Trigger: person sends STOP, texts on day 1 (hint), texts on day 3. The row is gone, `prevAt` is null, and a second hint goes. So a stopped person can get a hint about every 2 days, not 30. `hit` keeps `prevAt` only from rows, so the gap has no other memory.

Confidence: High. Same class of bug would hit any future bucket with a window over 2 days.

### D4. `clearHold(new_owner)` cannot be retried after a crash (P0)

Order (accounts.ts:203-211): forget hooks, `store.deleteAll`, `detachPhoneHash`, `unsuppress`, `clearAgeFloor`. `deleteAll` removes the phone row. The first guard is `!ph || ph.hold === null` → false (accounts.ts:197).

Trigger: crash, or a failed statement, after `deleteAll` and before `detachPhoneHash`. Staff retry `POST /holds` and get `not_held`. State left behind:

- The tombstone keeps `phone_hash`, so the next join by the new owner revives the old person, with blocks against them.
- The suppression row stays, until that join.
- The old owner's age floor stays, so a new owner can be refused or treated as a minor.

This breaks test intent api.test.ts:302-303. Confidence: High on the path. The trigger needs a failure in a window of three statements. Also the audit `result` call runs after, so a thrown error leaves only the `requested` row.

### D5. An under-13 age on a join path leaves other memberships (P0)

`statedAge` handles a declined under-13 by removing every membership (service.ts:1302-1309). The join refusal does not. It calls `recordAge` and declines only for that app (service.ts:1417-1424). Web repeat join is the same (accounts.ts:357-362).

Trigger: an active member of friends, 30. Text `slop`, then `Sam, 12`. Result: lowest age 12 on the person, `network.members.age` 12 on friends through `ageLowered`, membership stays `active`. `activeMembership` now fails on `canJoinApp`, so there are no open turns. The network member, profile and data stay. AGENTS.md: under 13 "is declined kindly with nothing stored". Also the "attested adult is recorded as 13" rule (service.ts:1297-1300) is skipped here, so the age 12 is recorded raw and nothing is held for staff.

Confidence: Medium. The founder may want a stated 12 from an attested adult to be a staff case. The inconsistency is certain.

### D6. `looking_for` stays open (P1, consent-adjacent)

`enroll` runs only if `lookingFor(text)` is non-empty (service.ts:1115-1118). Nothing clears the row for a reply with no app word. The row lives 1 day.

Trigger: join by text with no keyword. Reply to the question: `not sure yet`. Later that day: `going out with friends tonight`. `lookingFor` matches `friends`. `enroll` makes a friends membership and an opt-in with source `looking_for` and the wording of a question the person did not answer in that message. Words like `work` or `date` do the same (`I'm working` is filtered only for first-person forms at apps.ts:113).

Confidence: Medium. Code path certain; the intent to allow a late answer is possible.

### D7. Legacy addresses survive a move and ignore a hold (P1)

`movePhone` does not touch `network.channel_identities`. `identities()` merges the legacy rows with no `hold` filter (runtime.ts:390-392; compare 396-397), and `platform.member_apps` matches a `channel_identities` row with no hold filter (0007:228-230).

Trigger A: a legacy member (0006 kept their `channel_identities` row) changes number. Old number stays in `addrToMember`. A text from the next holder of that number reaches the member's unit.

Trigger B: a legacy number goes on hold. `memberToAddr` still has it. `consentRefused` has no hold check, so sends go on.

Confidence: Medium. It needs legacy rows in production. runtime.ts:386 says they keep these rows.

### D8. Legacy people have no hash and no consent (P0 for bans)

0006 backfills people and memberships with no `phone_hash` (0007 adds the column, and SQL cannot compute the HMAC) and no consent events. Grep finds no later writer except `createPerson` and `movePhone`.

Effects, each by reading:

1. `phoneHashesOf` is empty. `ban(by: "phone")` is refused `no_phone` (service.ts:1741).
2. `ban(by: "person")` writes a row with a null hash and suppresses nothing (service.ts:1746-1751). After a delete everything, the phone row is gone, `isBanned(hash, null)` is false, and the person can join again.
3. `byPhoneHash` and `findPhoneByHash` never find them, so OAuth tools read `not_joined`.
4. `matching_ages` gets no floor (0038:11), though `people.lowest_age` is still read.
5. `optedIn` is false (no events), so `activeMembership` is undefined: no open turn. `consentRefused` passes `none`, so proactive sends go. The two gates disagree.

Confidence: Medium. It depends on whether production has such rows.

### D9. Join-lock gaps and lost updates (P1, P0 where a ban is lost)

`invite` (accounts.ts:335-343) reads `existing` and writes with no lock. A join between the read and the write makes `putMembership` replace `active` with `invited` and a new `member_id`: the network member loses its binding. Two invites to a new number race on `createPerson`, and one throws.

`putMembership` copies a whole row. Read-spread-write callers: service.ts:804 (STOP), 1110 (START), 1754 (ban), photoIntake.ts:124 (photo consent), and all joins.

Trigger: photo consent reads `who.m` as `active`, then checks `mayTake`. A ban commits `restricted`. `putMembership` writes `active` back. Result: a banned person's row reads `active`. The ban row and the network hold still apply, so the effect is partial, and `activeMembership` still refuses. A STOP in the same window restores `active` over `paused`, while the ledger stays opted out.

`deleteAll` has no join lock. A join in flight writes a membership on a tombstone, an opt-in on a deleted number, and lifts the suppression.

Confidence: Medium. All need concurrency. The Quint model should find them with a two-actor step split.

### D10. Web join rollback is partial (P1)

`joined` does `createMember`, then `unitOfWork(welcomeJoined)` (service.ts:791-793). If the second fails, `joinLocked` runs `forgetMembership` and writes `join_failed` (accounts.ts:389-392). It does not call `onForget`.

State left: `network.members` row `active` with a person id; membership `removed`. `identities()` and `member_apps` include that member, the engine can use it, and a later join makes a second member for the same person. Sends are refused by the app opt-out.

Also: `unsuppress` ran before (accounts.ts:374) and is not undone. A number that deleted everything and failed a join is no longer suppressed. A staff invite is then allowed. Any new person row stays too.

If `forgetMembership` throws (it calls `notify.forget_data`), the opt-out is not written. Confidence: Medium.

### D11. `leave` is not atomic (P1)

Order: `addConsent`, `onForget`, `forgetMembership` (accounts.ts:425-428). Crash after `onForget`: membership `active`, network member gone, app opted out. Web repeat join returns `existing` with no opt-in (accounts.ts:357-362), so the person cannot rejoin by web until a second leave. Text join heals it: no `memberId`, so `join()` runs. Confidence: Medium. A retry of leave is safe.

### D12. Session rotation has no compare-and-set (P1, auth)

`authenticate` reads, revokes, creates (sessions.ts:49-56).

- Two requests with one token past 1 day both rotate. Two children live. The browser keeps one; the other stays valid to its expiry, unseen.
- A rotation that reads before a `movePhone` or `deleteAll` and creates after it writes a live session on the old number, past the "old sessions end" rule (pg-store.ts:361, 311). `person_id` stays set.
- A logout revokes only its token. A child made in flight stays live.

Confidence: Medium on the path. The window is small, and a fix needs a conditional update. Model: split `authenticate` into read and write steps.

### D13. Account actions ignore `who.personId` (P0 auth)

`activeMembership`, `startNumberChange` and `confirmNumberChange` compare `who.personId` to the person. `stop`, `leave`, `deleteAll`, `exportApp`, `share` and `revokeShare` use `personFor(who.e164)` alone (accounts.ts:398-407, 421-485). Number on `who` is the only binding, and null person passes everywhere.

Trigger: session (X, null) from an earlier holder of X (no join, up to 90 days of rotation). X is reassigned. The new holder joins by text. The old session can export the new person's app data and leave the app. `deleteAll` needs the 10-minute step-up, so it is out of reach; `leave` and `export` are not. D12's stale session has the same effect.

Confidence: Medium. It needs a number reassigned inside 90 days.

### D14. A ban or a hold ends no session and no grant (P1)

`ban` writes no session and no grant change (service.ts:1734-1766). `seen` sets a hold and does nothing else. PRD section 11 "Revocation": "a lost or recycled number, or a safety hold revokes every key for that member at once." Tools gate by status (`restricted` reads `on_hold`, hooks.ts:85, and `personForKey` is null for a held number), so the effect is limited, but MCP `session` checks only `held` (hooks.ts:206). A held number's grant comes back alive after `same_owner`, with no new consent. Confidence: Medium.

### D15. Cloud mode: suppressed numbers cannot sign in (P1)

The callback refuses a suppressed number (api.ts:437), and so does the grant check (683-684). Suppression is lifted only by a join, which needs a session. The OAuth sign-up path uses the same callback. A person who deleted everything cannot return by web or agent in Cloud mode. Text join still works (service.ts:1440).

Confidence: High on code. It may be intended for `banned` suppression; for `deleted` it conflicts with "A new join by the person lifts it".

### D16. Recycled detection is event-driven (P1, design gap)

Only `seen` writes a hold. It runs when the number acts. `consentRefused` (service.ts:696-716) and `identities` read `hold`, not staleness. A number silent for over 12 months can still get proactive texts, which is the case most likely to reach a new owner. `activeMembership` does refuse stale numbers, so relay is safe. Confidence: Medium: docs say "at its next login or message", so this may be the accepted scope.

### D17. `eliza_notices` key mismatch (P2)

`movePhone` uses `phoneHash` values (`phone:<e164>`) (pg-store.ts:368-369). The service keys notices with `eliza_notice:<e164>` (service.ts:1164). The statements match nothing. A member is not sent the notice, so the effect is small. The store.ts:173 contract says it moves. Delete everything also leaves that row. Confidence: High.

### D18. STOP in flight during a move (P0 by class, low likelihood)

`Accounts.stop` and service `stop` write the event on the number from the session or message. A STOP for the old number that commits after the consent copy (pg-store.ts:351-354) and before or after the phone delete stays on the old number. `personFor(old)` then answers undefined, so `stopped` does not run. The person's memberships on the new number stay `active` and opted in.

The person sent STOP from the old number at the moment of changing it. Confidence: Low to Medium. `addConsent` takes no lock on the phone row, so a model finds it.

### D19. Phone-scope ban during a move (P0 by class, low likelihood)

The ban check (accounts.ts:260) and `movePhone` are separate. `ban(by: "phone")` reads `phoneHashesOf` (service.ts:1740). Interleave: check passes; ban reads old hash and writes it; `movePhone` commits. The person is on an unbanned number. Memberships read `restricted`, and network status too, but `isBanned(newHash, person)` is false for a phone-scope row. Confidence: Low.

### D20. Move and consent fences (P1)

runbook-real.md 9.2: "a STOP from the new number that is newer still wins". An older STOP from the new number loses to a newer app opt-in copied from the old number. Example: B texted STOP in January. A joined slop in March. A moves to B in April. `resolveConsent` reads opted_in for slop on B, though nobody opted B in by text. The code proof shows intent, so the backend result is arguable.

The gateway has its own fence fed only by `TurnResponse.consent` (AGENTS.md "Consent path"). `movePhone` sends nothing. Cloud deliver can answer `opted_out` for B while the backend says opted in. The reverse: a STOP moved from A to B is in the backend only. The backend refuses, so that side is safe. Confidence: Low to Medium. Cross-service, not run.

### D21. Cloud clock skew is dead code on production (P1)

api.ts:101 and 436 allow 30 s. `parseNetworkDelegation` refuses `issuedAt*1000 > now` with no skew (network-delegation.ts:40), and `productionCloudDelegation.exchange` uses it (cloud-delegation.ts:22). A Cloud clock ahead of ours by a second or more refuses the login with 403. The comment at api.ts:441 applies only to the dev path. Same gap at api.ts:674. Confidence: Medium.

### D22. Dead states (P2)

`Membership.review`: no writer sets it non-null (grep of `review:` and SQL). `activeMembership`, `profile-suggestions`, `learning-consent-context`, `people.ts:69` and `publicStatus` all read it. The hold is on the phone instead.

`onboarding`: entered for `waitlist` apps only. No writer moves it to `active`. No app has `waitlist` in the rows today. If one did: no network member exists, so every message reaches `join()`, which writes a new `member_id` each time.

`platform.people.age_verified_at`: read by nothing, cleared at delete. `phone_identities.line_type`: unused. `otp_whatsapp` method: unused. `requestedBy` other than `member`: unused. Confidence: High.

### D23. Limits burn on refusal (P2)

otp.ts:4-5 says a refused request is not counted. Only the refusing bucket is not. Later refusals leave earlier hits counted: a day-limit refusal still takes an hour hit and moves `last_at`, which restarts the 30 s gap; a global refusal still takes both phone buckets and the IP bucket. Test api.test.ts:121 covers only the same bucket. An exhausted global budget makes every number lose its own budget. Confidence: High, low impact.

### D24. `same_owner` re-hold (P2)

`setPhoneHold(null)` then `touchPhone` (accounts.ts:199-200). A `seen` between the two sees `hold` null and still stale, and sets the hold again. Then `touchPhone` runs: the phone is held with a fresh `last_seen_at`. Staff must decide again. Confidence: Low.

### D25. Cloud grant trigger and `movePhone` (P2)

`keep_cloud_grant_authority` raises when `phone_key` changes on a Cloud grant (oauth.sql:66-71). `movePhone` updates all grants on the old key, revoked or not (pg-store.ts:373). Number change is 409 in Cloud mode, so this needs a person with a Cloud grant after a mode change to OTP. The move fails with 500 after the code is used, every time. Confidence: Low.

### D26. Global lock queue (P1 liveness)

`lockTail` is one queue for all keys in the process (pg-store.ts:249-253). The text join holds it through `createMember` and `memberMessage` (service.ts:1142-1149, 1450-1452), a network unit of work. `/internal/turn` should answer in 8 s. Under a slow unit all joins wait, on all apps. Confidence: Low to Medium. Not measured.

### D27. `unknown` signed IP (P2)

router.ts:101 signs `unknown` when Cloudflare gives no IP. `normalizeEdge` deletes the header because it fails the IP pattern (backend.ts:247), so the inner `verifyProxyHeaders` fails and the IP is the socket peer (the shared path to the origin). All such requests share one rate bucket. Confidence: Low.

## 4. Interactions

| Machines | Shared thing | Note |
|---|---|---|
| hold, membership | `personFor` | A held person has no person, so `stop` skips the pause. |
| move, session, otp, pending, outbound, oauth | `movePhone` | One transaction, the cleanest atomic step in this scope. |
| ban, suppression, membership, network | `ban` | Not atomic; the ban row is first. |
| consent, suppression, membership | `join` | Suppression goes first, opt-in later. |
| age, photos, ratings, network members | `onAgeLowered` | Hook is retried by the next `recordAge`. |
| cloud, session, hold, ban | callback | Check order: held, banned, suppressed, then `seen`. |
| delete, notify | `notify.forget_data` | Same transaction as the delete and as `forgetMembership`. It raises on missing canonical state (retention.sql:90-101). |
| membership, MCP | `publicStatus` (hooks.ts:76-90) | Maps states to `on_hold`, `stopped`. |
| Inbox, join | `rowId`, `onFail` | Retry semantics come from `packages/network/service/inbox.ts`, out of this scope. |
| gateway fence, consent | `TurnResponse.consent` | Only inbound turns feed it. Web stop, leave by web and `movePhone` do not (see the STOP model). |
| network holds, phone hold | two "hold" words | `network.members` trust hold (a safety hold) and `phone_identities.hold` are different machines. A held phone's member stays in the engine snapshot; only the address goes. |

## 5. Quint modelling notes

### 5.1 `identity_core.qnt` (P0, first)

Merge `person-lifecycle`, `phone-identity-hold`, `phone-change`, `membership`, `web-join`, `text-join`, `staff-invite`, `ban`, `suppression`, `age-floor` and the consent fold. These share too much state to split.

**Bounds:** persons 3, numbers 3 (one to recycle), apps 2 (one `invite`, one `open`), ages {12, 15, 25}, time steps by `tick` with `STALE` and `TTL` as small constants.

**State variables:**

```
var persons: PersonId -> {deleted: bool, hash: Option[Number], lowest: Option[Age]}
var phones: Number -> {person: PersonId, hold: bool, lastSeen: Time}
var members: (App, PersonId) -> {state: MState, memberId: int}
var netMembers: (App, int) -> {status, person}   // the second store
var consent: List[{num, app: Option[App], in: bool, at: Time}]
var suppressed: Set[Number]
var bans: Set[{scope, person: Option, num: Option}]
var floor: Number -> Age
var pending: Number -> Option[{app, age: Option[Age], name: bool}]
var change: PersonId -> Option[{newNum, at}]
var stated: Number -> Set[Age]   // ghost: every age any message stated
var holder: Number -> Human      // ghost: who really holds the number
```

**Actions:** split each multi-step flow into one action per store call, with a program counter per flow, so that crash and interleaving are explored: `joinStep(flow)`, `leaveStep(flow)`, `deleteStep(flow)`, `clearHoldStep(flow)`, `banStep(flow)`, `moveCommit`, `crash(flow)` (drops the flow), plus `textMsg(num, parsed)`, `stop(num)`, `start(num, app)`, `seen(num)`, `invite`, `tick`, `reassign(num)`.

**Invariants:**

```
lowestWins:   forall n, p: joined(n,p) implies persons[p].lowest <= min(stated[n])          // D1
minorNeverAdult: effectiveAge(p) <= min(stated of any number p held)
noBanEscape:  bans.exists(person p or num of p) implies not active(p)                       // D19, D8
banTerminal:  bans only grows
heldNoAccess: phones[n].hold implies no API result carries person data
newOwnerClean: after clearHold(new_owner) completes, revive(n) != oldPerson                 // D4
noOrphan:     netMembers active implies a membership in {active, paused, onboarding, restricted}  // D10, D11
suppressedNoSend: suppressed(n) implies not sendable(n)
restrictedHolds: bans cover p implies state(p,a) in {restricted, removed, invited}          // D9
under13Gone:  effectiveAge(p) < 13 implies no live membership                               // D5
```

**Liveness (temporal, run with `quint verify` when feasible):** every hold ends if staff act; every finished flow leaves no flow-private half state (`recoverable`: from any crash state, a retry reaches a clean state, which D4 and D11 fail).

**Abstractions:** drop hashing (a number stands for its hash), but keep a hash field on the person so `phone_hash` null and `detach` can be modelled. Keep two hash domains for `eliza_notices` only if D17 matters.

**Run first:** D1, D4, D5 and D19 should appear as short counterexamples. Keep each as a named witness.

### 5.2 `login.qnt` (P0)

Merge `otp-challenge`, `web-session`, `rate-window`.

**State:** `challenges: Number -> List[{attempts, createdAt, consumed}]`, `sessions: Token -> {num, person, createdAt, startedAt, expiresAt, revokedAt, parent}`, `buckets`, `now`.

**Actions:** `start`, `verifyRight`, `verifyWrong`, `authRead(t)`, `authRotate(t)` (split), `logout`, `move`, `deleteAll`, `tick`, `purge`.

**Invariants:** `oneUse`, `attemptBound`, `sessionsPerChain <= 1 live non-grace` (D12), `chainBound`, `noSessionOnOldNumber` (D12), `freshNeverExtended`, `retentionCoversWindow` (D3). Also the ban gate, if this model shares `bans`: `banned(n) implies no new session` (D2).

Use small windows: `HOUR=3`, `DAY=6`, limit 2. Add a `stopHint` action to show D3, or put it in a small `retention.qnt`.

### 5.3 `cloud.qnt` (P0)

Two parties: Network and Cloud. **State:** `pendingCookie`, `cloudCodes`, `session`, `identityCookie`, `cloudLive`, `clockSkew`.

**Invariants:** `noSessionWithoutExchange`, `cookieKindSeparation`, `cloudTokenNeverOtp`, `invalidRevokes`, `unavailableKeeps` (test lines 104-108). Include `suppressed` for D15 as a liveness check: from a deleted account, can a sign-in reach `signed_in`? Include `skew` for D21.

### 5.4 Small separate specs (P2)

- `proxy.qnt`: an attacker action forges or replays. Invariant: app and IP come only from a valid signature. Low value; a table test is close to enough.
- `share_grant.qnt`, `pending_followups.qnt`: small. For D6, an invariant `optInOnlyFromAnswer` needs a ghost "this message answers the question", which is a judgment. Use a witness, not an invariant.

### 5.5 Implementation notes for the modeller

- Model `PgPeopleStore`, not the memory store. Differences: revive order, `deleteAll` extras (`platform.inbound` scrub, `notify.forget_data`), `movePhone` extras (outbound, oauth, notices).
- `sql.begin` blocks are atomic. Everything else is one step per statement. `hit` is atomic.
- `withLock` is exclusive for its key, plus the global queue in one process. Model two processes, so the global queue does not hide a race.
- Time: Network code reads `Clock`. Platform `Accounts` takes `now`. Treat Cloud time and gateway time as separate clocks with bounded skew.
- A number is reassigned by an environment action, `reassign(n)`, which changes the ghost `holder[n]`. Nothing in the system sees it. Most recycled-number properties are stated against this ghost.
