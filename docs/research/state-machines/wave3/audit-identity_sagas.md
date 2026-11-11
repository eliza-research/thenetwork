# Audit: coverage of quint/identity_sagas.qnt (wave 3)

Read-only audit. Code read at HEAD of `claude/quint-state-machines` (f02196f). It contains every fix that the
findings file lists, and also 55e6eb8 (SD-089) and f1dc7c7 (SD-011). The drift review on `claude/formal-main`
compared the same model with slightly newer code (export refuses a banned number, rotateSession in one
statement, declineUnderAge on the invite_only exit). Those formal-main fixes are not reported again here.

Scratch probes (no repository file changed), in
`/private/tmp/claude-501/-Users-nubs-thenetwork/fb3a81a2-1e7b-4e4d-a9fa-a85215213426/scratchpad/wave3/is/`:
- `probe.qnt`: the HEAD model plus one run test, `probeLeaveAcrossDeleteRejoin` (it passes, so `safety` is violated: item M1).
- `patched.qnt`: HEAD model plus the reverted drift patch. `quint run --invariant safety` fails on `retryCompletes` (item M2).
- `crash2.qnt`, `crash2nou13.qnt`: `MAX_CRASH = 2` (and no under-13 crash). `safety` fails on `bannedNotMatchable`,
  `retryCompletes` and `pairAgreesHere` (item G1).

## Suspected defects (new)

**D1 (P1). A banned person deletes the safety photos one at a time through `POST /api/photos/delete`.**
The fix 8e96df9 (SD-275, SD-256, SD-178) keeps a banned person's photos only in the `onForget` hook
(service.ts:817-819). The photo route resolves the caller with `authenticated.session.personId` (api.ts:362-366).
It has no ban check and no hold check. `remove()` (photos.ts:625-631, route photos.ts:722-726) and `GET /api/photos`
(photos.ts:714, which lists the ids) are open to any live session. A ban does not revoke sessions (service.ts:1968-1999).
Since SD-013 only new logins are refused (api.ts:472, 487), and a session chain lives up to 90 days (sessions.ts:15).
Trigger: the person logs in by OTP, then is reported. Staff `ban(by: person)`. With the old cookie, the person calls
`GET /api/photos` to get the ids, then `POST /api/photos/delete {id}` for each id. Every photo row is hidden and its
bytes are deleted, so the evidence is gone. The model's `banKeepsPhotos` cannot see this because the model has no
member photo-remove action. Fix: `remove()` refuses when `this.o.banned(personId)` (as `mayTake` does). Optional:
the ban revokes the person's sessions. Test: an integration case next to the 8e96df9 cases in
`packages/network/test/identity-sagas.integration.test.ts`. Model: add `removePhoto(p)` guarded by `not(personBanned)`.

**D2 (P2). A repeated join after a stopped leave says ok but drops the explicit opt-in. The member is never texted.**
At HEAD a failed OAuth listener stops a leave after the forget unit (service.ts:820-822). The membership stays live,
and the leave's `opted_out` is the newest app event (accounts.ts:474). A web or MCP join of the same app then takes
the repeated-join path (accounts.ts:366-376). That path writes no consent ("Keep the membership and consent
unchanged"), and `onJoin` -> `joined` recreates the Network member as `active`, because `runtimeOfMember`
(service.ts:496) skips `removed` rows. Result: `join` returns ok, the person ticked the opt-in box
(`consentMatches`, accounts.ts:355), and `activeMembership` stays false (accounts.ts:336, the ledger says
opted_out). The person is never matched and gets no texts, with no error. The model's `join` refuses any LIVE_MEM
membership (identity_sagas.qnt:674), so it cannot show this. Fix: the repeated-join path records the opt-in when the
app's last event is opted_out (or it finishes the leave first).

**D3 (P2, documented in journey-signup.md:300 but not in the register). A `new_owner` decision leaves the old owner's ban on the number.**
accounts.ts:195-197 says the number "starts clean". pg-store.ts:389-395 removes the suppression and the floor, but
not `platform.bans` rows with that `phone_hash`. A person-scope row also carries the hash (service.ts:1982).
Trigger: person 1 on A is banned. A is silent for 12 months. The carrier gives A to h2, and h2's text puts A on hold.
Staff decide `new_owner`. Then every later join, OTP or START by h2 is refused (`bannedPh`). Staff decided that h2 is
a stranger, yet h2 is banned. Bans by phone number are a founder rule, so this needs a decision. Model:
`liveNumberNotSuppressed` exempts `codeBanned`, and no rule checks that the new holder can join.

## Model errors

**M1 (P1). `safety` has a reachable violation (pairAgreesHere) that the code cannot produce.** `leaveStep` pc 1
(identity_sagas.qnt:892-898) always goes on. It leaves out the early return of accounts.ts:475 (a newer opt-in
returns before onForget). `forgetUnit(w, p, a)` (209-216) acts on whatever member (p, a) has now, but the code acts
on the member id that the leave read at its start (accounts.ts:472-476). `storeDeleteAll` also clears `leavePending`
while the leave saga still runs (952). Trace, as a run test in `probe.qnt` that passes on the HEAD model: delStart(A) ->
delStep x3 -> leaveText(A, peon) -> delStep (store delete) -> join(A, peon) revives person 1 -> leaveStep x3 ->
crash(leave) -> `not(pairAgreesHere)`. The 10000-sample simulator missed it, and Apalache only reached 4 steps.
Fix: the leave record keeps `gen` and its time. pc 1 returns when the app's last event is a newer opt-in, and
pc 3 forgets only that generation.

**M2 (P1). The model still has the SD-089 defect, which is fixed at HEAD (55e6eb8). The drift patch failed for a model reason.**
Code: onForget runs the forget unit, then the photos, then the listeners. A listener error stops the saga
(service.ts:814-823). The under-13 decline runs `forgetPhone` before its loop (service.ts:1471). The model swallows
the error (`leaveStep` pc 4, 907-910), puts the photos first (pc 2), and runs no listener in the under-13 decline
(1081-1088). So `forgetRevokesGrants` is in `knownOpen` (513), and `u13GrantsTest` (1442-1446) asserts the old
defect. The reverted patch fails `retryCompletes` with this trace (seed 0x634f5): a phone-scope ban writes its
rows -> leave peon stops at the failing listener -> crash(ban). The person has no Network member left, because the
forget unit sets `network.members.person_id = null` (runtime.ts:590). So the staff retry is refused (`not_member`,
or `no_person` in code: service.ts:1793-1796, 1973). But the paused membership still makes `banUnfinishedIn` true.
The member's own leave retry finishes it. So the rule needs one more exemption: an app whose only unfinished part
is a pending leave with `leaveRetryOk`. Add the same exemption to `bannedNotMatchable`. Then add the listener
failure to `delStep`/`chStep` (per app and `onForgetPhone`). After that, `forgetRevokesGrants` can join `safety`
with a `leavePending` exemption.

**M3 (P2). `exportComplete` cannot fail.** `exportReq` (777-787) builds `exportedPhotos` and `exportedFacts` as the same
filter that it tests, so `exportGap` is always false. `exportTest` proves nothing about decd288 or 7b6413b. Model the
facet filter of exportMember (service.ts:925-926: provenance `said`, source gmail or google_calendar, staff `vouched`
left out) and the photo list.

**M4 (P2). The SD-026 legacy path cannot be reached.** Legacy rows are only for person 1, and person 1 always exists
(init 541-582). So the legacy branch of `routesText` (202-203) and the `p == 0` branch of `leaveText` (860-863) are
dead, and `legacyRouteTest` passes without regard to the fix. Add a person-less legacy member at init.

**M5 (P2). Other over-approximations.**
- `u13Start` (1060-1069) has no ban guard. The code returns "held" for a banned member's text (service.ts:1242)
  before `statedAge`, but the model's under-13 decline drops a banned person's `photosAtBan` ghost (1080).
- `delStep` pc 1 (938-939) always writes the age floor. The code writes it only when `person.lowestAge != null`
  (accounts.ts:486). The model has no ages, so `deleteKeepsSafety` asserts more than the code keeps.
- `moveCompletes` cannot fail (the findings file says so). The code still has a failure path after the code is
  used: pg-store.ts:460-462 throws when a parallel `startNumberChange` replaced the change row (putPhoneChange,
  pg-store.ts:402).

## Model gaps

**G1 (P1). One crash hides two stopped sagas, which HEAD now reaches with no crash.** `MAX_CRASH = 1` (137). With 2,
`safety` fails. The first case is ban plus under-13 (the Q-join_age-4 state). The second case, with no under-13
crash, is ban plus leave: `bannedNotMatchable` and `retryCompletes`, the same root cause as M2. At HEAD a failing
OAuth listener (service.ts:820-822, 1471) stops a leave, a delete, a new_owner or an under-13 decline with no crash.
So the one-crash bound is not conservative. Model the listener failure as a non-crash stop that has no bound.

**G2 (P2). The order inside delete and new_owner is merged.** `delStep`/`chStep` do the forget unit, the photos
and the grants as one action per app (942, 991). The code has three awaits plus `onForgetPhone`
(accounts.ts:487-493, 207-213). This cannot break a rule by itself, but it hides M2's listener stop.

**G3 (P2). Number change after the commit: the age fold is not atomic.** After `movePhone` the code calls
`recordAge(newE164, ..., floor)` and the listeners (accounts.ts:271-274). In the model, `mvStep` pc 2 is a no-op
(1052-1053). If the process stops between the two, people.lowest_age stays adult while the floor of B (an earlier
holder's age, under 18) moves to the person. `PhotoService.adult` reads only `people.lowest_age`
(photos.ts:508-510), and `reconcileAges` reads only `p.lowest_age` (service.ts:846-858), so photos and ratings stay
and nothing repairs them. Matching still refuses: the runtime uses `lowestAge` with the floor (runtime.ts:225).
Model the floor values, or check this in join_age.

**G4 (P2). Consent writes other than STOP do not follow the person during a move.** Join's opt-in (accounts.ts:402),
leave's opt-out (474), START (service.ts:1253, 1295) and the under-13 `opted_out` (service.ts:1476) call `addConsent` with
no person id. Only STOP takes the phone-row lock (pg-store.ts:141-152). Join on A in its `join:A` lock, while the
move holds `join:B` (accounts.ts:261): the opt-in lands on A after the move, so the new membership on B is never
opted in (the same silent outcome as D2). The model's `join` is atomic. Add a two-step join (read person, then the
write) against `mvStep`.

**G5 (P2). STOP edge cases.**
- A STOP from the person's own held number never runs `stopped()` (personFor is undefined:
  service.ts:1492, 1506). After same_owner the membership reads `active`. The ledger still refuses sends.
  `stopFollowsPerson` counts only `own = o != 0` (637).
- A STOP comes before `seen()` (service.ts:1188-1191 vs 1194). A stranger's STOP from a stale, unheld number goes
  through `memberMessage` into the old owner's thread, but `misrouted` counts only `inbound`.
- The ledger write and `stopped()` are separate (service.ts:1493, then 1506). The model does both in one action (650-658).

**G6 (P2). Paths with no action.**
- `Accounts.declineUnderAge` (web and MCP under-13, accounts.ts:440-452): the full onForget hook for each membership.
  A stop in its loop leaves the other memberships, and only a repeated join resumes it.
- `joinLocked`'s catch (accounts.ts:404-418): unsuppress, then suppress again.
- The `person_holds` safety carryover in `forget` (service.ts:910-912). A stranger who revives a tombstone inherits
  it (platform-identity.md:112, by design).
- Staff `verify age fail` deletes a banned person's photos (service.ts:1876).
- `startNumberChange` / NUMBER_CHANGE_MS / the rate limit.
- Sessions: `deleteAll`, `leave` and `exportApp` ignore `who.personId` (accounts.ts:470-483, 497-499). Only
  `startNumberChange`/`confirmNumberChange` compare it (234, 255). This is what made the auth_edge rotation race
  dangerous (fixed on formal-main). The model's assumption "a session means the number's person" hides it.

**G7 (P2). No rule covers a self-deleted tombstone that another human revives.** `reassign` allows A at once after a
delete or a move away (606-615), and `join` revives the newest tombstone with that hash for anyone (669-679), with
its blocks, `person_holds`, floor and person-scope ban. This is by design (platform-identity.md:112), but no
witness or rule records it.

## Open carve-outs

**C1 (P1, fixable now). Q-identity_sagas-3 (`bannedNotMatchableFull`).** ban() reads `membersOfPerson` before
`audited` (service.ts:1969). Fix in scope: read the members again inside `audited`, after the ban rows
(service.ts:1985). A join after the rows is refused. Keep `banJoinRaceTest` as the regression test.

**C2 (P2, fixable now). Q-identity_sagas-4 (`retryCompletesFull`).** pg-store.ts:367 and 387 suppress the caller's
`e164` and delete its phone row, even when another live person owns that number now. Fix: when `personId` is set,
use `e164` only if `phone_identities.person_id` is that person or no row exists (the 5b6566a read already covers the
moved case).

**C3 (P1). `pairAgrees` is mislabelled.** The comments (360-362, 509-513) say SD-011 is not fixed, but f1dc7c7 (in
HEAD) fixed it. What is left is Q-join_age-4 (join_age.md 192-204). Since 55e6eb8, `forgetPhone` runs before the
membership loop (service.ts:1471-1478), so one OAuth error, with no crash, now leaves every other membership of an
under-13 person live. Fix in scope (needs maintainer confirmation of the design): call `declineUnderAge` in the
member path when the phone's lowest age is under 13, or forget the memberships before the listeners.

**C4 (P2, fixable now). Delete everything races a join of another app** (findings section 5, platform-identity.md:742).
There is no rule for it. A deleted person keeps an active Network member with join facets (name, zip, interests),
against F24. Fix: `Accounts.deleteAll` takes `withLock(join:<e164>)`, or `store.deleteAll` reads the memberships
again under the person lock and refuses with a retry. Add the rule "a deleted person has no live Network member".

**C5 (P2, founder). SD-492 `banCoversOldNumbers`.** Skipped. Fixable only after a founder decision on banning
`phone_changes.old_hash` numbers.

**C6 (P2). SD-055 window before the person read** (findings section 6). A STOP from old number A that arrives after
the move commits stays on A. Fix: in `stop()`, when `personFor` is undefined, look up a `phone_changes` row confirmed
recently with `old_hash = phoneHash(e164)` (within a short window, before the carrier can reassign the number).
Needs maintainer scope.

**C7 (P2). SD-109 is accepted in the model.** `mvStep` deletes `holderStop(humanOf(p), dst)` (1050), so an older STOP
from B loses to a copied newer opt-in. Both votes refuted SD-109. Keep it documented as a design carve-out.

**C8 (P2). SD-255 and SD-489 were skipped as missing entry points.** The 2026-10-19 founder correction sends exports
and deletions to help@ntwrk.party. No staff route exists (service.ts `/holds` is the only identity staff route). Out
of scope until a maintainer confirms.
