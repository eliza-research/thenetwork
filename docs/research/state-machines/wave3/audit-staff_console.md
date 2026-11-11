# Audit: quint/staff_console.qnt coverage (wave 3)

Branch: claude/quint-state-machines (HEAD f02196f). Read: quint/staff_console.qnt, docs/research/quint-findings/staff_console.md,
plan 6.15, drift review on claude/formal-main (docs/results/2026-11-09-quint-drift.md "staff_console"), and the code:
packages/observatory/src/{server.ts, staff.ts, sources/real.ts, sources/service.ts, appProfile.ts, health.ts, apps.ts},
packages/observatory/web/{store.ts, admin.tsx, panels.tsx 537-611}, packages/network/service/service.ts (staff routes,
staffAction/audited, hold/ban/clearMinor/liftHold, staffPhotos, verifiedAdult, relay/leak routes, reviewerOfRecord),
packages/network/service/postings.ts, packages/platform/src/photos.ts (adult, staffLinks, view).

Probe model (scratch copy, not in repo): wave3/probe-sc/staff_console.qnt. Three probes, Quint simulator, seed 0x5eed:
- `inv_oneAppHoldStaysOneApp` with the service scope taken from the console token: violated in 3 steps (init, closePhotos, pressHold by S1).
- `consoleAnswerLost` + `inv_consoleSaysServiceDoes`: violated in 4 steps (consoleSend, serviceApply commit, consoleAnswerLost).
- `loadPhotos` without the `not(netMinor)` guard + `inv_noPhotoReadForNetMinor`: violated in 6 steps (agePoll, netMinorSignal, loadPhotos).

## Suspected defects (new)

### D1 (P0). The service checks the console token's grants, not the staff member's: one-app safety staff hold, clear minor signals and ban on every app
- reviewerOfRecord returns `{ ...user, id: named }` (packages/network/service/service.ts:2802-2810): the grants stay the console
  token's. The console token is admin (sources/service.ts:8-10; docs/deploy.md:130, 225 `admin@*:<t>`).
- crossAppSafety(user) (service.ts:140) is therefore true for every console request: hold scope `*` and every membership
  (service.ts:1903-1919), clearMinor on every app (1931-1951), ban (1972), lift of an every-app hold (1755).
- The console server checks only safety for the request's app (server.ts:638-650 guard ["safety"]); no @* check for ban.
  The client hides ban for one-app staff (admin.tsx:282) and, after the SD-070 fix, says "this app" (admin.tsx:263).
Trigger A (UI): S1 holds safety@slop only. S1 presses Hold on a slop report. Toast "Person held on this app". The service writes
platform.person_holds app '*' and holds the person's ntwrk and friends members too.
Trigger B (direct): S1 posts from the signed-in console page (same origin, Access header present)
`POST /api/safety?app=slop {"action":"ban","memberId":"x","by":"person","note":"....."}`. Console passes (safety@slop), the service
bans the person and every phone on every app.
Trigger C: "Clear minor signal (this app)" clears the minor signal on every app of the person.
This reopens SD-070 (text now wrong the other way) and SD-468 (the findings say "the service already refused": false on this path).
Fix options: (1) the console server refuses ban, and sends hold/clear_minor/lift with an explicit `scope` ("app" unless the staff
member holds safety@* or admin@*), and the service honors a narrower scope from the console token; (2) the service resolves the
named person's grants (platform.staff_roles) for a console request instead of the token's; (3) one console token per app scope.

### D2 (P1). The service photo gate ignores the Network's minor flag; the console's age view lags
- verifiedAdult (service.ts:1803-1816) and PhotoService.adult (packages/platform/src/photos.ts:508-513) read people.lowest_age,
  network.members.age and verify:age:fail only. minorReported (packages/network/src/network.ts:1647-1656) sets m.minor only;
  lowest_age does not change (runtime.ts:495-498 writes it only from a stated age).
- The only check of the Network flag is the console's age view (server.ts:544 photosAllowed on the source member), which is
  the last poll (10 s), and on a read error the last good copy indefinitely (real.ts:342-348 via SD-082 fix).
- staffPhotos takes an open report as the ground (service.ts:2036-2046): the minor report itself qualifies.
Trigger: X (stated 25, slop, photo uploaded) is reported by Y: "X is 15" (minor report, Network sets X.minor). The report shows at
once (GET /api/safety reads service.reports() live, real.ts:784). Within 10 s (or while console polls fail) S1 opens X, types a
reason, Show photos. Console: photosAllowed ok (stale adult). Service: ground = the minor report, adult() ok. Signed links
returned; view() (photos.ts:675-680) also passes for 5 minutes.
The model hides this: loadPhotos has `not(s.age.netMinor)` ("the service checks its own age state again"), which the code does not.
Fix: verifiedAdult also asks the Network (`rt.readState(n => n.ageInDoubt(memberId))`, as leak review does at service.ts:2580).

### D3 (P1). The console says "did not act" when the service committed but its answer was lost (SD-288 variant)
- sources/service.ts:98-101: only TimeoutError gives service_timeout; any other fetch error is service_unavailable "did not answer".
  :89 `r.json().catch(() => ({}))` also catches a timeout or reset during the body read, so a committed 200 becomes
  `service_error: answered 200` (:107). Any 5xx (proxy 502/503/504) is "did not act" (doc :94).
- The service catch-all answers 503 internal_error (service.ts:2760-2763) after partial commits: hold commits the first app and
  person_holds, then a later `x.rt.unitOfWork` throws (1906-1919); ban is multi-step (1979-2000, "finished by the retry").
- Console result rows then say ok:false (server.ts:632, 648, 701); afterAction reloads, but the toast and audit say failed.
Trigger: crossApp hold; the second app's unit throws (lock timeout) -> 503 -> console "the Network service answered 503", result row
ok:false, while the person is held on app 1 and in person_holds. Or: process restart after commit -> fetch TypeError.
Fix: act() returns "unknown" (service_timeout-like) for every error after the request was sent, for 5xx, and for 200 with an
unreadable body; only a connect error before send is "did not act".

### D4 (P1/P2). Staff actions that act before their audit row
- POST /signals (service.ts:2532-2540): `update network.facets set status=...` then `audit.write(decide_agent_signal)`. An audit
  failure leaves a decided signal with no row (rule "an audit row first, no row, no action", service.ts:1724).
- postings.ts:121-122 verify_employer and :156-157 save_posting/close_posting: action, then audit (peon; local only, P2).
- /holds POST (service.ts:2507-2519): requested row, no result row (minor).
Not console paths, but part of staff-audit (M-094). Not covered by SD-135.

### D5 (P2). stateRow `strict` is not honored on the fallback view
real.ts:294-297: with the app view missing (42P01), the shared-view query has `.catch(() => [])`, so ageInfo (real.ts:454) reads no
stored state on an error: a minor_reported member (stored flag only, no AGE_EVENTS event) reads adult. Trigger: a database without
the 0005 app view + a transient error on network.network_state_console. Fix: rethrow the fallback error when strict.

### D6 (P2). WebSocket admission uses stale roles and misses the mode-switch recheck
- server.ts:821-830: a ticket carries the StaffUser snapshot from ticket time; the upgrade checks the snapshot's roles, not
  ssoGrants now. A grant revoked after the ticket still opens a socket (up to 30 s ticket + 15 s recheck).
- server.ts:249-259 + 835-840: a socket upgraded under the old mode check but opened after setMode's recheck loop is not in
  `sockets` during the loop; open() adds it with the old view class (an engineer@* then gets real-mode deltas until the 15 s timer).
Fix: recheck(ws) in open().

### D7 (P2). Reviewer access follows the console's polled store, not the live review item
real.ts:747-750 inOpenReview reads IN_REVIEW from the last good poll; with failing polls a reviewer keeps member access after the item
closed. The model's networkReview changes openReview at once.

### D8 (P2). Revoked grants stay while platform.staff_roles reads fail
staff.ts:216-227 keeps the last good list with no age limit. No liveness bound on revocation. The model has reloadRoles(false) but no
property about it.

## Model errors
- E1 pressHold (qnt:385-389) computes the service scope from the staff member's grants; the code uses the console token's (D1).
  inv_successTextMatchesScope (qnt:704) is one-directional: "this app" text with an every-app effect passes.
- E2 loadPhotos (qnt:343-348) guard `not(s.age.netMinor)` is a service check that does not exist (D2).
- E3 serviceApply (qnt:268-277): "crash" never commits; consoleAnswer maps only from svc; no committed-but-lost answer (D3).
- E4 inv_auditFirst (qnt:666) and inv_consoleAuditFirst (qnt:670) are vacuous: every effect is created with rowBefore=true and
  consoleSend is the only writer of consoleRowFirst (true). They cannot fail whatever the code does. Model the per-route order
  (staffAction, audited, leak, relay, /signals, postings) as data to make them bite (D4).
- E5 openSocket (qnt:240-248) checks current grantsCopy; the code checks the ticket's snapshot (D6). rolesFor has no mode
  (engineer is game-only in staff.ts:184) and setMode's socket recheck (server.ts:258) is absent.
- E6 inv_consoleShowsGate / configPoll / pressSwitch read mg.stored at once; the code reads netState from the DB console view
  (real.ts:512, 536, 546; health.ts:335; admin.tsx:411, 421): a lag until the Network saves state, `row.matching !== false` reads a
  null column as on, and mergeStateRows (real.ts:121) ANDs cities. The invariant holds by abstraction.
- E7 networkReview is instant; code lags (D7).
- E8 agePoll always uses hasNet=true (qnt:329): the record-only branch (real.ts:81, missing age fails closed) and declined rows are not
  exercised; netMinor is never cleared (age_resolved minor:false, clear_minor), which inv_ageFailClosed's comment relies on.
- E9 TERMINAL (qnt:97) lacks QUORUM_FAILED (projector.ts:12 on HEAD). Fixed in the formal-main model, not here.
- E10 inv_revealShownTruly (qnt:657) is one-directional; RV3 says "exactly when". The DELETE audit-down path (G1) shows a badge for a
  reveal the server already deleted.

## Model gaps
- G1 DELETE /api/reveal deletes the grant, then writes the audit row; audit down -> 503, client keeps the badge
  (server.ts:595-602; store.ts:555-561). formal-main has unrevealWith(auditUp). No invariant breaks (fail-safe display).
- G2 Plan machines left out: truth-lens (server.ts:313-314, 628-630; per-socket truth until recheck), seed-writer, use-live-detail,
  staff-identity expiry (AccessVerifier skew staff.ts:327 vs identify server.ts:340; socket expiry timer server.ts:839),
  held-text decisions for text and leak queues (service.ts:2570-2650, 2690-2747). Adding truth-lens with role revocation gives a
  <=15 s window of hidden truth to a socket (game mode only).
- G3 Held photo release: the service's own proof and expiry check (service.ts:2362-2369, 2703, 2719) and reviewAuthorized; the
  console's preview key uses `mode` not `seen` (server.ts:661, 694). Fail-closed; no invariant breaks.
- G4 staffPhotos ground (open report or case) service.ts:2036-2046: fail-closed.
- G5 Login fitness is checked once (real.ts:221-245); a later role change (BYPASSRLS granted) is not seen. inv_servedOnlyCheckedLogin
  would fail if loginFit could change after the check.
- G6 Parallel actions: the model has one action in flight; the code allows many (per-row busy). Service idempotency covers
  repeated hold/ban (already_banned, on conflict).
- G7 friends is absent: PACK_READY allows friends (apps.ts:21) though AGENTS decision 4 keeps its matching local.
- G8 SlopPanel in-flight photo answer after the gate closed (panels.tsx:587-590): setPhotos runs after setPhotos(null); if the gate
  reopens, photos return without a new logged read.
- G9 Client reveals are not cleared on app switch until loadReveals answers (store.ts:505-519, 548-553); display only.
- G10 Drift inputs from formal-main: pressSwitch flip()/no-send and cf.target, unrevealWith, QUORUM_FAILED. HEAD admin.tsx:418-423 still
  sends `!c.matchingEnabled`, so the HEAD model matches HEAD code; take the formal-main model with the formal-main code.

## Open carve-outs
- SD-282 inv_declinedMeansDeclined: still open. Not fixable in scope without the privacy decision: join_declined events carry no
  memberId (network.ts:945), so no kept fact tells the two apart. Fails safe (treated as minor).
- SD-088 inv_tickRunImpliesAllowedAndStored: refuted in the register. A service-side refusal of "on" for local-only apps (peon,
  friends) would need founder confirmation (decision 4, open join mode). Model has no friends (G7).
- SD-244 / SD-284: UI additions, need a maintainer. Note D1: the existing clear-minor control already acts on every app.
- SD-469 (no rule), SD-473 (copy), SD-322 (opportunity model): stay.
- Reopen SD-070 and SD-468 under D1.
- SD-301 / SD-499 not reproduced: fine.
