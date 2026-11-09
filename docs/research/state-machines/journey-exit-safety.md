# State machines: exit and safety journeys

Key: `journey-exit-safety`. Branch `claude/quint-state-machines`, base commit a0ed7bc.
Hand-written research for Quint modelling. No product code was changed.

Scope: the journeys STOP, START, leave, HELP, block, report, ban, relay of a number and a photo with consent per
item, scam classifier holds, leak guard holds, deletion and export, the 3-a-day cap, the two-unanswered rule, the
re-engagement, and delivery failure as the member sees it.

This file follows a person across packages. The per-package reports hold the machine tables. This file holds the
state of each machine after each journey step, and the defects that appear only when the machines are joined.
Each defect that another report has already found is named by reference, not repeated.

Abbreviations: `S` `packages/network/service/service.ts`, `R` `service/runtime.ts`, `I` `service/inbox.ts`,
`RE` `service/relay-endpoint.ts`, `CH` `service/channel.ts`, `N` `packages/network/src/network.ts`, `D`
`packages/network/src/relay.ts`, `T` `src/trust.ts`, `O` `src/outreach.ts`, `A` `packages/platform/src/accounts.ts`,
`C` `packages/platform/src/consent.ts`, `PS` `packages/platform/src/pg-store.ts`, `Q`
`packages/blooio/src/outbound-queue.ts`, `E` `packages/engine/src/relay.ts`.

Report keys used in cross references: `inbound` (network-service-inbound.md), `outbound`
(network-service-outbound.md), `core` (network-consent-core.md), `consent` (platform-consent.md), `sweep`
(implicit-sweep.md), `identity` (platform-identity.md).

## 0. Method and evidence

- Read in full: `service.ts` lines 560-2574, `runtime.ts`, `inbox.ts`, `relay-endpoint.ts`, `relay.ts`, `trust.ts`,
  `reports.ts`, `outreach.ts`, `accounts.ts`, `consent.ts`, `cloud-channel.ts`, Q lines 1-560 and the `inbound` method.
  Read by section: `network.ts` (inbound, forget, safety, send, tick, advance, recipient checks, relay host),
  `pg-store.ts`, `api.ts` routes, engine `relay.ts`, migrations 0006 and 0007, PRD 28, 29, 40.3, 40.5, `docs/mvp-plan.md`.
- `design/member-flows` holds only a demo page, an image and a small server. It has no flow data that the PRD does
  not have, so PRD Section 29 is the journey source.
- The Eliza gateway is upstream and is not in this repository. Each statement about it is marked **unverified**.
- **Probe** means that I ran the path. Two scratch tests are in the session scratchpad, in `probe/`:
  `exit-safety-probe.test.ts` and `exit-safety-probe2.test.ts` (real service, HTTP, a throwaway Postgres database on
  :54339, dry-run adapter) and `exit-safety-mini.test.ts` (in memory, the `Mini` world). No provider and no model
  were called. The throwaway databases were dropped (a count of `network_probe_%` returned 0). `interactions` rows in
  the probe were written by a state edit, to make two members count as "met".
- **Trace** means reading only. Results here are hand-written. No Quint spec exists yet.

## 1. Journey machines

Each journey is a composite of owned machines. Model the composite only where a defect needs it.

| id | Kind | Crosses | Priority | Section |
|---|---|---|---|---|
| `journey-stop-start` | implicit composite | ledger, memberships, member flag, Network, gateway fence, routing | P0 | 2 |
| `journey-leave-rejoin` | implicit composite | ledger, forget, memberships, trust, cases, reports, join | P0 | 3 |
| `journey-help` | implicit | routing, Network inbound | P2 | 4 |
| `journey-block` | implicit composite | routing, resolver, Network blocks, person blocks, snapshot, opportunities | P0 | 5 |
| `journey-report` | implicit composite | routing, resolver, reports, trust, cases, age, staff | P0 | 6 |
| `journey-hold-ban` | implicit composite | staff API, bans, suppression, memberships, trust, each Network | P0 | 7 |
| `journey-relay-swap` | implicit composite | turn, action receipt, desk, deferred sends, queue, Cloud | P0 | 8 |
| `journey-relay-hold` | implicit composite | classifier, desk, staff, queue | P1 | 9 |
| `journey-leak-hold` | implicit composite | Network guard, collected check, queue, staff | P0 | 10 |
| `journey-erase-export` | implicit composite | email (outside code), API, forget, tombstone, suppression | P0 | 11 |
| `journey-person-cap` | implicit composite | Network budgets, queue, `person_sends` | P1 | 12 |
| `journey-unanswered-reengage` | implicit composite | Network attention, queue streak, routing | P1 | 13 |
| `journey-delivery-outcome` | implicit composite | Network belief, queue, Cloud, receipt | P1 | 14 |

The new defects are JE1 to JE25. Section 15 lists them. Section 16 is the modelling plan.

**Central finding.** Three facts make most defects here:

1. Safety state lives per `(app, member)`, in `network_state`. Identity lives per person. A leave mints a new member
   id. So hold, watch, cases and a report's reach do not follow the person (JE2, JE3, JE6, JE9, JE10, JE17).
2. The Network records intent at enqueue. No queue outcome returns to it (`sweep` 3.3, `send-belief`). So a lost
   send looks like a silent member (JE7, JE8, JE13, JE18, JE24).
3. The app of a text is chosen by the last writer or the newest open item. The person cannot name the app inside a
   command. So commands with no target app can reach the wrong app or never reach the right one (JE1, JE10).

## 2. Journey: STOP and START

PRD 40.3, F20; AGENTS decision 7 and 2026-10-09 item 2. Trigger: member, through the gateway signed turn.

### 2.1 Steps for a person in two apps, A and B

State after each step. `L` ledger resolved for (A, B). `MS` membership state. `F` `members.opted_out`. `N` Network
`optedOut`. `G` gateway fence (**unverified**, what the contract asks).

| # | Step | Code | L | MS (A, B) | F (A, B) | N | G | Sent to person |
|---|---|---|---|---|---|---|---|---|
| 0 | Joined A and B | S:1447 | in, in | active, active | no, no | no, no | in | |
| 1 | Claim the turn | I:82-103 | same | same | same | same | same | |
| 2 | Route: last writer or open item | S:957-981 | same | same | same | same | same | |
| 3 | Consent event, scope global | S:1322-1323 | out, out | same | same | same | same | |
| 4 | `turn.consent`, confirmation | S:1325-1327 | | | | | pending | |
| 5 | Pending texts deleted | S:1328 | | | | | | |
| 6 | Routed member unit | S:1329, 1275 | | | yes, no | yes, no | | collected |
| 7 | `stopped`: pause all, other app unit | S:1333, 801-812 | | paused, paused | yes, yes | yes, yes | | |
| 8 | Turn done, response stored | I:113 | | | | | | |
| 9 | Gateway copies consent, sends text | upstream | | | | | out (all) | STOP confirmation |
| 10 | START, routed to the last writer, say B | S:1100-1110 | out, in | paused, active | yes, no | yes, no | B in | welcome back |
| 11 | START again | routes to B | same | same | same | same | same | nothing |

Step 10 is the defect. There is no step that moves A back in. See JE1.

### 2.2 Transitions

| From | Event | Guard | Effect | To | Where | Actor |
|---|---|---|---|---|---|---|
| any | STOP text | keyword or opt-out phrase | global event, once per ref | out-all | S:1054-1056, C:66-73 | member |
| out-all | START, member | not banned, not number hold, event newer | app event, flag false, paused to active for one app | out for others, in for one | S:1100-1110, 1276 | member |
| out-all | START, older than STOP | `optedIn` false | event stored, no change | same | S:1107 | gateway retry |
| out | START, non-member | not banned | app event, then join flow | in for that app | S:1132-1137 | member |
| out | text join with name and age | age passes | app opt-in, unsuppress | in for that app | S:1440, 1447 | member |
| out | web join, enroll | | app opt-in | in for that app | A:384, S:1491 | member |
| any | staff `new_owner` | hold exists | ledger rows go | none | A:194-213 | staff |

### 2.3 Invariants

- STOP-1 (P0, PRD 40.3): after a committed STOP, no non-compliance send leaves for any app, until a newer opt-in for that app.
- STOP-2 (liveness, PRD 40.3 "START resumes consent"): for each app with a live membership, a sequence of texts exists that restores it.
- STOP-3 (mirror, AGENTS Consent path): each ledger change caused by a turn is in that turn's `consent` field.
- STOP-4: `L = out` implies `MS != active` for that app, once the turn ends.
- STOP-5: the confirmation text describes what happened. "Reply START to resume <app>" must be true for that app.

### 2.4 Interactions and failure

- Steps 3 to 7 are separate commits. Crash windows: `inbound` D1, D14; `sweep` 3.1, 3.2.
- Step 6 runs `heardFrom` (N:615). A STOP also clears `onlyWhenAsked`. After START the member is back in proactive reach.
- Step 7 calls `n.onInbound` with no inbound row (S:808). The other app's `lastItem` subquery still sees an open item
  after STOP. So the first START can go to A or B. The result of START depends on hidden routing state.
- A `paused` membership stays `paused` when the hold or ban machine later changes it: `consent` PC-09 (whole-row writes).
- Duplicate STOP: same ref, no second event. Out of order: `inbound` D2, D8.

### 2.5 Defects

**JE1. After a global STOP, START resumes one app. The other app cannot be resumed by text (P0 family, liveness, high, probe).**
Where: `S:1100-1110` is app-scoped, `C:39-44` needs an app opt-in newer than the global event, `S:974-978` picks the app.
Probe J1, J1b (person in friends and peon, no open items):

```
STOP            -> app peon, consent {opted_out, all}
START           -> app peon, consent {opted_in, app peon}, "Welcome back..."
friends.help    -> "You're unsubscribed from friends, so I can't reply. Reply START to resume."
START           -> app peon, replies []            (the hint's instruction fails)
START friends   -> app peon, read as a normal message
join friends.help -> context_unavailable, replies []
end: optedIn(friends)=false, optedIn(peon)=true, memberships friends=paused, peon=active
```

Why it sticks: `direct()` writes the hint to `inbound.replies` (S:1369-1371), not `network.messages`, so `last_out` of
friends does not move. The Network refuses sends to an opted-out member before `ctx.send`, so nothing else moves it.
The only exit is "leave peon", which deletes that app, or email. The founder correction removed the site.
The first confirmation names one app only ("Reply START to resume peon"), so a person may not see the gap (`inbound` D29
describes the wrong-app naming, not the stuck state). Contract gap, not a crash. The whole-message keyword check
(`keywordApp`, `S:966`) runs before the keyword reading, and "friends.help" routes correctly, but it carries no START.

**JE12. A join after STOP changes the ledger with no `consent` echo (P0 family, high for the service, probe).**
`turn.consent` is set in only four places (S:1090, 1108, 1136, 1325). `S:1447`, `S:1491` and `A:384` write opt-ins
with no echo. PRD 40.3 lists "a join with name and age, or a web join" as an opt-in and says "the service reports
consent changes to the gateway". Probe J4: STOP, then `peon.biz`, then `Dan, 30`: reason `joined`, `optedIn(peon) = true`,
`consent` undefined. If the fence holds "out (all)", Cloud answers `opted_out` to proactive deliver. `cloud-channel.ts`
maps that to failure `blocked`. Q:522 ends the row as `blocked`. So the new member gets no proposal, no reminder, and
no sign why. `identity` D20 has the same shape for number moves; `consent` PC-12 is a related web case. Fence behaviour is **unverified**.

Existing: `inbound` D1, D2, D5, D8, D9, D14, D15, D21, D29; `consent` PC-01, PC-02, PC-25; `outbound` D8, D9.

### 2.6 Quint notes

`StopStart.qnt`: persons 1, apps 2, messages 4. Variables: `ledger` (events with time), `membership`, `memberFlag`,
`lastOut`, `openItem`, `fence`. Action `route` is a pure function of `lastOut`, `openItem`, text. Check STOP-1 to STOP-5.
STOP-2 needs a temporal property or a reachability witness; `quint run --invariant` on the negation finds JE1 at once.

## 3. Journey: leave and rejoin

PRD 40.3: "'leave <app>' stops one app and deletes that app's data; other memberships stay."

### 3.1 Steps

| # | Step | Code | Ledger | Membership | Network | Trust, cases, reports |
|---|---|---|---|---|---|---|
| 1 | "leave friends.help" | S:1079-1094 | | | | |
| 2 | Consent event | A:425 | app out | active | live | unchanged |
| 3 | Photos deleted | S:760 | | | | photos gone |
| 4 | Network forget | S:821-825, N:912-967 | | | id in `declinedIds`, member gone | trust record gone (N:942), case gone (N:943), reports stay, reporter blanked (N:946) |
| 5 | Unit write | R:521-551 | | | row `removed` | messages, events, facets, edges gone |
| 6 | OAuth listeners | S:763-765 | | | | |
| 7 | `forgetMembership` | A:428, PS:293 | | removed | | share grants revoked |
| 8 | Turn answer | S:1090-1091 | | | | |
| 9 | Rejoin: "friends.help", "Bea, 30" | S:1384-1464 | app in | active, new member id (S:1443) | new member, trust `ok` | nothing carries over |

No step checks a hold, a watch score or an open report. Ban is the only gate at join (S:1390). The comment at N:945 says
"leaving never escapes a ban". It does not claim that for a hold, but PRD 40.3 says "the person cannot be matched
until staff resolve it", and F23 says a report creates a case "with preserved evidence".

### 3.2 Defects

**JE2. Leave and rejoin clears a safety hold, the risk score and the open case (P0, high, probe).**
Where: `S:1081-1088` (no hold check), `N:942-943`, `T:48-53`, `S:1443`, `S:1390`. Probe J2:

```
staff hold -> level hold
leave friends.help -> reason left
friends.help, "Bea, 30" -> reason joined
after: same member id false, level ok, account active, safety cases for either id 0
```

The same path clears `watch`, an open `reportHeld` (reports name the old subject id, N:1296), `minorReported` and
`minorSignal` when the record age is adult (N:1555), `age_conflict`, and `avoid` edges. Person blocks survive
(R:511, PS:317), and the lowest age survives through the phone floor. So blocks and age hold. Hold, watch, a report
and a minor report do not.

**JE17. The subject of a report can erase the evidence by a leave (P1, high, trace plus probe for the case).**
Leave runs for a held or banned person: no guard before S:1081. It deletes photos (S:760), messages (R:529), events
(R:532), and the case (N:943). `S:1752` says "The photos stay for the safety team". F23 says "preserved evidence".
F24 says "minimal retained records for safety". `docs/admin-console.md` line 147 says evidence is "kept even after
member deletion". `consent` PC-31 raises this for delete everything as a policy question. Leave has the same effect with
no re-auth and one text. Reports keep ids only, so after a leave staff see a report whose subject id has no member.

**JE11. A person who left cannot report anyone (P1, high, probe).**
`S:1099` needs a member of the routed app. Probe J10: left friends, then "report Finn, he threatened me": reason
`join_asked`, app `ntwrk`, the join prompt. The text is dropped ("Nothing is stored"). F23: "'Block Alex' or 'report'
from any channel". The same for a person who deleted everything, and for a report on someone who left (N:1373 searches
`this.members` only, so the answer is "couldn't match that name").

Existing: `inbound` D9, D15, D16; `identity` section on leave order; `consent` PC-10.

### 3.3 Quint notes

Add `safetyState: person -> Set(flag)` as the desired model and `memberSafety: (app, memberId) -> flag` as the real
one. Invariant `holdFollowsPerson`: a held person has no eligible member in any app. Bound: 1 person, 2 apps, 2 member ids.

## 4. Journey: HELP

| Step | Code | Effect |
|---|---|---|
| Keyword, not a recycled hold | S:1049 | continues |
| Number on recycled hold | S:1061-1064 | `direct` compliance, returns `held` |
| Member | S:1112, 1122 | Network `onInbound` with HELP, `rt.system` compliance reply |
| Non-member | S:1129 | `direct` compliance, nothing stored |

Invariant: HELP changes no consent and no outreach state. The second part is false: N:615 clears `onlyWhenAsked`,
`pendingAsks` and the streak, and the line S:1226 marks pending Notify items as acted on (the check excludes only STOP).
So HELP can resume proactive reach. `core` D15 covers this. HELP text names only the routed app: "leave <domain>" for the
last writer. A person in two apps cannot learn the second app's leave phrase from HELP. Minor.

## 5. Journey: block

PRD F23: "Block takes effect immediately and only affects the pair." PRD 40.3: blocks apply in every app.

### 5.1 Steps

| # | Step | Code | Result |
|---|---|---|---|
| 1 | Route by last writer | S:973-978 | app X |
| 2 | Classify | N:681, 740 | `block` |
| 3 | Resolve target in app X | N:1490-1514 | counterpart, or any member of X, or none |
| 4 | Set block | N:1429-1431, R:508-515 | `blocks`, `network.edges`, `platform.person_blocks` |
| 5 | Close open items in app X | N:1434-1445 | item `closed`, partner told if scheduled |
| 6 | Reply | N:1454 | `blocked` or `blockUnmatched` |
| 7 | Next unit of app Y | snapshot | `blocked` edge in Y |

### 5.2 Defects

**JE9. A block closes open items in the routed app only (P1, high, trace).**
Step 5 loops over `this.opps` of one Network. App Y gets the block only through its snapshot. Nothing in Y closes the item.
`this.blocked` is read by matching, `approvalCheck`, and `checkRecipient` (N:4230), not by `advance`. So a `scheduled`
date in Y stays scheduled. Its reminder is refused (`blocked_pair`, N:3402 marks `reminded` first), feedback is refused,
and the stage moves to `done` at +3 h. Neither person hears that the date is off. A `probing` item ends by silence. Relay
is refused at `R:276-280`. Safe from contact, but the other person may go to the venue, and the blocker's "Done" is not
the full truth. F23 says "immediately".

**JE10. A block or report is routed by the last writer, and cannot name the app (P1, high, trace).**
`S:964-967`: only a whole-message keyword names an app. "block Sam on slop" routes by S:974-978. If the person's last
message came from another app, `findByName` looks in the wrong Network (N:1373). The answer is `blockUnmatched` or
`reportUnmatched`, with the same text as "no such person". No block is set. The reply reads "If they're a member, they
won't be matched with you" (copy.ts line 130), which is then false, since the block did not happen. The reply for
`target` undefined logs `block_unresolved` only (N:1424). `reportUnmatched` ends with no staff case. A safety report is lost
with a reply that sounds handled. Trigger: slop date ends, ntwrk sends a growth ask, member texts "report Sam".

Existing: `core` D6, D7, D9 (met definition, plan-wide close, drop by status).

**JE23 (P2, note). A block has no undo.** No `unblock` path exists. `findByName` can bind a unique first name to a stranger
(N:1379), and the person is told only "I couldn't match that name". This is an absorbing state with a hidden entry. PRD does
not ask for undo. Record it as a founder question.

### 5.3 Quint notes

`Block.qnt`: 2 persons, 2 apps, one open item per app. Invariant `blockClosesAll`: `personBlock(a,b)` implies no open
item with both, within k steps. Merge with `Report`.

## 6. Journey: report

### 6.1 Steps

| # | Step | Code | Trust | Case | Report | Matching |
|---|---|---|---|---|---|---|
| 1 | Route, classify `report` | S:973-978, N:740 | | | | |
| 2 | Resolve; ask "who" if needed | N:1405-1417, 1528 | | | | |
| 3 | `met` computed | N:1428, N:1387 | | | | |
| 4 | Block set, items closed | N:1429-1445 | | | | |
| 5 | Points: credible reporter, met, corroboration | T:115-124 | maybe +3 | | | |
| 6 | Case event | N:1448 | | open | | |
| 7 | `fileReport` | N:1279-1287 | | | open | |
| 8 | Urgent, met: `dropMember` | N:1285 | | | | out of matching, items dropped |
| 9 | Minor kind | N:1550-1558 | | | | `minor` true in this app |
| 10 | Reply | N:1454 | | | | |
| 11 | Staff hold, ban or dismiss | S:1675, 1734, 1723 | | | held, banned, dismissed | |

### 6.2 Invariants

- REP-1 (docs/network.md 6.2): "One person cannot get someone removed." Points need two reporters.
- REP-2 (PRD 36.3): an urgent report by someone who met them takes the subject out until staff decide.
- REP-3: a held or banned person has no power over other members. Not stated in AGENTS, but it follows from T:118
  (`reporterCredible`) and from "the banned person is never matched or contacted".
- REP-4 (decision 1, audit network-consent-9): a minor report takes the person out of matching. "A minor anywhere is a minor everywhere" (S:774).

### 6.3 Defects

**JE4. A held or banned reporter can take the victim out of matching and cancel their date (P0, high, probe).**
N:740 runs before the hold return at N:746 (on purpose: a member on hold may still block). T:118 checks credibility for
points only. `fileReport` has no check, and `reportHeld` (N:1295) counts any open urgent `met` report. Probe J5: Eve banned by
staff, then "report Finn, he threatened me":

```
response: reason handled, accountEligible false, replies ["Thanks for telling me. I've blocked them..."]
reports: [{kind: unsafe, status: open, subject: Finn}]
reportHeld(Finn) = true
```

Finn stays out of matching until staff dismiss it. The block also closes open items. The scammer gets a free retaliation
after the ban. The fix point is the reporter's trust and account state at N:1285, but a held person's safety report may be
real, so keep the report and drop only its hold effect. `core` D6 widens this: `met` is true for someone who only got a probe.

**JE6. A minor report, an automatic hold and a report hold stay in one app (P0, high, probe).**
`minorReported` (N:1550) sets flags on this Network's member and calls no platform hook. Compare `onAgeStated` (N:700),
which reaches `Accounts.recordAge`. Probe J7, person Gus in friends and peon:

```
report Gus, he's only 15  (friends)
friends member.minor = true; peon member.minor = false; lowestAge = 30
```

A report is not a stated age, so `lowest_age` should not change. But peon keeps matching Gus. REP-4 is per app. The same
shape: `reportHeld` per app; `onTrustChange` to `hold` by score per app (N:1188-1205). Only a staff hold with `safety@*` crosses
apps (S:1679). Staff with one app's role hold one app, by design. PRD 40.3: "A safety removal holds the person everywhere."

JE10 and JE11 apply here too. JE15 (section 9) is the relay side of this journey.

Existing: `core` D6, D14, D24; `inbound` D4 (a report inside the looking-for answer is not read).

## 7. Journey: hold and ban

### 7.1 Ban steps (staff, `POST /apps/:app/safety/ban`, needs `safety@*`)

| # | Step | Code | Bans | Suppression | Membership | Member row | Trust |
|---|---|---|---|---|---|---|---|
| 1 | Audit requested | S:1769 | | | | | |
| 2 | Insert bans | S:1750 | yes | | | | |
| 3 | Suppress hashes | S:1751 | | yes | | | |
| 4 | Drop ratings | S:1753 | | | | | |
| 5 | Memberships restricted | S:1754 | | | restricted | | |
| 6 | For each app: status, `markBanned` | S:1756-1761 | | | | restricted | hold |
| 7 | Audit result | S:1771 | | | | | |

Reads after a ban:

| Surface | Check | Result |
|---|---|---|
| Text join | S:1390 | no reply, nothing stored |
| OTP | `consent` PC-03 says a code can go | gap |
| Queue send | S:708, Q:376 | `refused_opted_out`, also for a hold notice |
| Signed turn, member | none before `memberMessage` | see JE5 |
| Relay | `activeMembership` A:324 | refused |
| Leave | none | runs, see JE17 |

### 7.2 Defects

**JE5. A banned member's text is stored, handled and answered (P0, high for the service, probe).**
AGENTS 2026-10-09 item 3: refused at "inbound". S:707: "A banned number or person gets nothing but compliance texts".
`S:1099` goes to `memberMessage` with no ban check. `identities()` keeps restricted members (R:392, R:395). Probe J5: stored
inbound count 2, `network.messages` holds the banned person's text, the reply is kind `reply`, `delivery: collected`.
`writeUnit` runs only leak checks on collected replies (R:473-477). `consentRefused` is not called on the collected path.
`accountEligible: false` goes to the gateway, and the contract defines it as "Cloud account/history" admission, not a send
fence. Whether Cloud sends the reply is **unverified**. The contract says "Send exactly these". `inbound` D5 is the same gap
for a stopped number.

**JE14. Past contacts are never told about a ban (P1, high, trace).** PRD 40.5: "a relay log so past contacts can be told about
a ban". `pastContacts` (E:489) has no caller (grep of `packages`, `deploy`, `scripts`). The ban journey has no such step.

**JE21. Safety notices lose their priority in the queue (P2, high, trace).** `N:1197` sends `copy.hold` as kind `safety`. The Network
sends it at once and `docs/network.md` line 451 calls safety notices exempt from the streak. `R:429` maps it to
`transactional` unless it is a reply. A staff hold is not in a turn, so Q:391 defers it in quiet hours, Q:398 can hold it at
3 unanswered, and it can expire. In a ban, S:1750 runs first, so S:708 refuses it: a banned person gets no notice, although
S:1731 says "but for safety notices". The copy promises "You'll hear from a person soon".

**JE22. A hold on every app is lifted one app at a time, with no notice (P2, high, trace).** `hold` loops over apps (S:1684). `liftHold`
(S:1540, N:1244) runs on one network. `clearMinor` (S:1697) shows the multi-app pattern. After a lift the member is not told,
and the items dropped at hold stay dropped. The person was told to wait for a person.

**JE23 (note). No unban.** No code deletes from `platform.bans` (the only hit is a test). Absorbing state. A mistaken ban needs SQL.

Existing: `outbound` D7, `sweep` D5, `consent` PC-03, PC-04, PC-09, PC-11, PC-31.

### 7.3 Quint notes

`SafetySaga.qnt` from `outbound`. Add `hold` and `lift` for 2 apps. Invariant `banSilent`: banned person receives only compliance
kinds. With the collected path as an action, this finds JE5.

## 8. Journey: relay of a number with consent per item

PRD 40.5, AGENTS decision 9, "Relay (#7)". Trigger: member in an open turn, then Cloud `POST /internal/relay`.
`NETWORK_RELAY_ENABLED` is off upstream until the founder sets it.

### 8.1 Steps for a number swap, A then B

| # | Step | Code | Desk `swaps` | Log | Queue | Thread |
|---|---|---|---|---|---|---|
| 1 | A: open turn | S:2089-2091 | | | | |
| 2 | Cloud RELAY, bound to the turn and text | RE:160-173 | | | | |
| 3 | Receipt claim `processing` | RE:193-205 | | | | |
| 4 | Engine probe of the share | D:277 | | | | |
| 5 | Pending request, ask to B | D:279-281 | A | | `relay:<a>:ask` | |
| 6 | A told "as soon as they say" | D:282 | | | | |
| 7 | B asks within 15 min | D:273-289 | removed | | | |
| 8 | Both decided | D:290-291 | | | | |
| 9 | Their share first | D:293 | | pass, shared | `relay:<a>` or deferred | message |
| 10 | My share | D:299 | | pass, shared | `relay:<b>` | message |
| 11 | Receipt commit with the unit | R:561 | | | | |
| 12 | Drain, admission | Q:467-501, R:238 | | | sending | |
| 13 | Cloud accepted | Q:538 | | | accepted | |

Consent per item (E:319-325): a contact share needs `consent.at` within 15 min of the item. Steps 9 and 10 run at B's time, with
A's consent time. After step 9 there is no later consent check. `relayAdmission` does not re-read consent or a withdrawal.

### 8.2 Withdrawal and exit during a swap

| Event during the swap | Pending (step 5) | Queued or deferred (step 9+) |
|---|---|---|
| "don't send my number" | removed, D:308, N:617 | not removed: `outbound` D1, `core` D3 |
| STOP by A | swap stays; B's ask then refused by parties | queue refuses to A; number to B still needs A as a party: R:281-284 refuses |
| Block | decide refuses | R:276-280 refuses |
| Leave or delete | D:400 removes | R:548 drops rows to that member. A row to the partner is refused at admission, body stays: `outbound` D16 |
| Age falls | canonical `adult` false | R:282 refuses |
| Quiet hours for one side | | one-way window: `core` D3 |

### 8.3 Photos

Off by policy: RE:56 NOTICE `photo`. `pri_` items are staff reviewed (`consent` report; `outbound` D26, D28).
The journey has no live member path today. Model only the refusal: no `approved_photos` row without a passed item.

### 8.4 Defects

**JE13. A failed or expired number share stays `contactShared: true`, and blocks any retry (P1, high, trace).**
`finish` sets `contactShared` at decision (E:394). `undelivered` clears it only if the send path refuses inside the unit (D:252). Queue
outcomes do not return. `E:377` then adds `contact_share:already_shared` for this sender in this match. So after a row ends
`failed`, `expired`, `held_awaiting_reply` then expired, `suppressed_ineligible` or `parked_leak_review`:

- B never got the number;
- `prior` (D:321) replays "Sent." for the same item;
- a new "send them my number" is held with `contact_share:already_shared`.

The one-way swap (`outbound` D2, `core` D3) therefore has no repair path. Consent stays spent on a share that did not happen. The relay log
says it was shared, which breaks "relay log" as an audit source for past contacts.

**JE24 applies here too (section 14).**

Existing: `outbound` D1, D2, D16, D23, D24, D27; `core` D3, D28.

### 8.5 Quint notes

`Relay.qnt` from `outbound`. Add `rowEnds(id, outcome)` feeding nothing back, and the invariant
`sharedImpliesDelivered: log.contactShared(i) => row(i) in accepted states or waiting`. Check both directions for `swapSymmetric`.

## 9. Journey: scam classifier hold

### 9.1 Steps

| # | Step | Code | Member told | State |
|---|---|---|---|---|
| 1 | Rules, then Clef | E:300, E:430 | | |
| 2 | Decision hold, not rate only | D:235-245 | "a quick check" | `held` item, text kept |
| 3 | Decision block | D:234 | "I can't pass that on" | log only |
| 4 | Staff list | S:2282-2291 | | |
| 5 | Release | D:347-366 | nothing | recheck, send |
| 6 | Reject | D:369-376 | nothing | text dropped |
| 7 | Sender leaves | D:399 | | rejected by system |

Production without Clef fails closed: every passed text is held (RE:85-89). With no staff on shift, this makes the whole relay a hold.

### 9.2 Defects

**JE15. Relay holds and blocks never reach trust or a safety case (P1, high, trace).**
`RelayHost` (D:67-80) has no trust method. `D.apply` logs and returns. Grep: `trust.` is not called from `relay.ts`. `ageSignal` is read only to
hide text (D:242). So a member can try "send me $50 on venmo" through the relay within the rate limits (40 a day, E:114) with no
risk score, no case and no entry in `/safety/reports`. Staff see only `held` rows. PRD 40.5 and 17: scam risk leads to a report, a hold or
a ban. A `block` decision (threats, slurs) leaves no staff surface at all, other than `network.relay_records`. Also the recipient is
not told. This is by design for privacy, but the safety path is then only the staff queue.

Silent end: after step 5 or 6 the sender hears nothing. After a reject the sender thinks the message may have gone. `outbound` D15: held items
have no SLA and no alert. A held item outlives the match: release sets `delivered:false` with `ok:true` (D:355), and staff see only that.
Not a state bug on its own, but the journey has no terminal message.

`again.decision === "hold"` at release (D:359) renders the text for staff override even when a new hold reason is `safety:sender_held`.
Checked: the send path then refuses, since `checkRecipient` needs the other party on `trust.ok` (N:4234), and the queue admission reads holds
(R:284). So this is safe. Record it as a check that depends on a later layer.

## 10. Journey: leak guard hold

Three layers, in order: Network `guardCheck` (N:3920), `collectedLeaks` for replies (R:473-477), queue gate 10 (Q:429-433).

| Case | First layer hit | Outcome | Member sees | Network knows |
|---|---|---|---|---|
| Probe, reveal, plan: fallback ok | Network | fallback text | fallback | yes, `guard_blocked` |
| Same, no fallback | Network | `onRefused`: replace, or drop | partner may get a cancel | yes |
| Relay | Network | `refused`, log `send:refused` | "couldn't pass that on" | yes |
| Collected reply fails | R:476 | goes to the queue | nothing in the turn | no |
| Queue fails | Q:432 | `parked_leak_review`, end | nothing | no |
| Staff release | S:2336, Q decideLeak | row returns, may expire | late or nothing | no |
| Staff drop | same | ended | nothing | no |

Invariant LEAK-1 (AGENTS): every outbound message goes through the leak check. True for the queue and collected paths.
LEAK-2: a parked item must end. No expiry reaches `parked_leak_review` (not in DUE, not in `expireHeld`). So it waits for a person.
No SLA alert beyond a log line (`CH` `onAlert`).

Join with `journey-delivery-outcome`: a parked reveal or cancel leaves the Network believing it went (`sweep` 3.3). A dropped reveal never tells the other
side. `outbound` D13, D17 are the existing entries. No new defect here, but JE24 includes it.

## 11. Journey: deletion and export

PRD F24 and 28.3 list these in MVP. The founder correction of 2026-10-19 says: "Export and deletion requests use help@ntwrk.party."

### 11.1 Steps as built

| # | Step | Code | State |
|---|---|---|---|
| 1 | Person emails help@ntwrk.party | outside code | none, no ticket |
| 2 | Staff verify the phone owner | **no step** | |
| 3 | Staff run delete | **no route** | |
| 3b | Self-service with a session | `POST /api/me/delete`, API:626 | needs login and fresh re-auth |
| 4 | `Accounts.deleteAll` | A:432-444 | age floor kept |
| 5 | Each membership forget | S:758-766 | section 3 |
| 6 | `store.deleteAll` | PS:304 | suppression, tombstone, consent gone, phone gone |
| 7 | Grants | listeners | `consent` PC-26 |
| 8 | Rejoin by text | S:1437, PS:64 | tombstone revived, `lowest_age` from floor, blocks hold |

### 11.2 Defects

**JE16. A deletion or export request by email has no operator path (P1, high, trace).**
`S.fetch` (S:2162-2500) has no delete, leave or export route. `Accounts.deleteAll` and `exportApp` are reached only from `/api/me/*` with the
person's own session (API:574, 626), and from a simulation script (`scripts/sim/safety.ts:457`). The sites have no sign-in (founder correction).
`sites/README.md` line 88 says "The authenticated backend APIs remain available for service integrations", but no integration calls them for
staff. No runbook step exists (`docs/runbook-real.md`, `docs/runbook-platform.md`, `docs/admin-console.md`). The privacy page says "We delete data
from storage within 24 hours". So each request needs a hand-written script against the database, with no audit row (the staff audit needs the staff API),
no identity check on the email sender, and no way to confirm by text. The MCP tools have no exit tool either, by design (`sites/skills/slop-date/SKILL.md` line 159).
Liveness: `request -> deleted` has no code path.

**JE25. "delete my info" means STOP only (P2, high, trace).** `core` `replies.ts`: `/\b(?:remove|delete|lose) my (?:number|phone number|info|contact)\b/` is an
opt-out phrase. The person asks for deletion and gets "You're unsubscribed". Nothing points to the email, and no signal reaches staff. "Delete my account" falls to the
open turn, where the agent may record an `opt_out` signal for staff (S:1959). Two wordings, two exits, neither deletes.

JE7 (section 14) applies to deletion too.

Existing: `sweep` 3.5 (`erasure-saga`); `outbound` D3 (no purge in the deployed backend), D11, D16; `consent` PC-05, PC-08, PC-11, PC-13, PC-26, PC-34.

### 11.3 Quint notes

Model `request` as an environment action with a fairness condition. The honest result today: no action moves it, so mark the liveness property as
"requires operator tool" in the spec, and do not assume it.

## 12. Journey: the person cap of 3 a day

PRD 40.3, AGENTS decision 7.

| # | Step | Code | Network | `person_sends` | Row |
|---|---|---|---|---|---|
| 1 | Probe or proactive send | N:3862 | budgets checked, `pendingAsks` push (N:3938), `onSent` (N:3952) | | |
| 2 | Commit | R:555-559 | | | `pending` |
| 3 | Drain gates 0-8 | Q:371-421 | | | |
| 4 | Cap take | Q:423, S:592 | | slot, or refused | |
| 5a | Refused | Q:424 | no change | | `refused_person_cap`, end |
| 5b | Taken, then not sent | Q:345 | no change | released | end |
| 5c | Sent | Q:538 | no change | kept | accepted |

Facts:

- The window is rolling 24 h (S:597), not a calendar day.
- `refused_person_cap` is terminal. No retry the next day. The row is lost.
- A human reviewer approved that item (AGENTS: review of every proposal). The cap can spend that work.
- Crash between `capTake` and Q:425: the slot is taken, `person_cap` false, a later `end` does not release it. Slot lost for up to 24 h. P2.
- Members with no `person_id`: no cap (0007:181, `continue`). No such members in a fresh production.

**JE18. A probe the cap refused is treated as a silent member, also across apps (P1, high, trace).**
The Network ran `onSent`: `awaiting`, `contacted`, `sentAt`, and `pendingAsks`. Then:

1. After 26 h the probe "expires" (N:3372-3383) with `probeExpired` and `contacted`. The partner's item closes as "not available".
2. After 72 h, two such rows move the member to `onlyWhenAsked` (N:3324-3330), though they never saw either.
3. `heardFrom` runs only in the app that a reply routes to. A person who talks daily on app A keeps app B's `pendingAsks`. Since the cap is shared and each Network counts its own,
   app A's three proactives a day make app B's rows refused, and B pauses the person.
4. The pause has no notice in B. The reengage needs 30 days and a top-quartile item.

`outbound` line 619 and `sweep` 3.3 name the missing feedback. The effect on F28 is new here. The cap therefore turns a global rate limit into per-app "unresponsive" state.

## 13. Journey: two unanswered and the re-engagement

PRD F28, founder D6, AGENTS code invariants.

### 13.1 Three counters with similar names

| Counter | Scope | Increments | Reset | Effect |
|---|---|---|---|---|
| `pendingAsks`, `unanswered` | app, member | proactive send N:3938 | any inbound N:640 | at 2 after 72 h: `onlyWhenAsked` |
| `unsolStreak` | app, member | unsolicited send N:3944 | inbound N:609 (with an ack rule) | at 2: refuse, one re-engagement allowed |
| `outbound` | app, member | every send N:3947 | any inbound N:640 | `canInterrupt` 1, `canSendLogistics` 2 |
| `line_conversations.unanswered` | line, address, all apps | accepted non-compliance Q:556 | `engaged` Q `inbound` | at 3: hold; one 14-day pass |

### 13.2 Steps

| # | Step | Code | State |
|---|---|---|---|
| 1 | Two invites go, no reply for 72 h | N:3324 | `onlyWhenAsked` |
| 2 | Requests and proposals stop for this member | N:4224, 4360 | engine still ranks them, gate refuses |
| 3 | Top-quartile item held | N:3454 | `heldHighAt` |
| 4 | Silence 30 days | O:28, N:3336 | candidate |
| 5 | Re-engagement send | N:3339-3340 | `reengaged` true at `sent` or `deferred` |
| 6 | Queue | Q:398-402 | passes once if 14 days quiet |
| 7 | Inbound | N:640-641 | all reset, resumes silently |

Docs disagree: AGENTS and N:3332 say 14 days, O:28 says 30 (`core` D26). The 14 days is the queue's line rule (Q:158), a different machine. Fix the wording before modelling.

### 13.3 Defects

**JE19. Two re-engagement machines share one line slot across apps (P2, medium, trace).**
Q:400 passes one agent-initiated row after 14 quiet days and sets `reengagement_used`. It is not tied to the Network's re-engagement. Any row qualifies: another app's proactive, a Notify digest, a reminder. Then the
Network's real re-engagement at day 30 waits in `held_awaiting_reply` (Q:401), and the 24 h TTL ends it (Q:333, Q:326). `m.reengaged` is already true (`core` D22). The one allowed message is spent by a row that the person may care
less about, and no retry exists until they write.

**JE20. Resume is silent (P2, high, trace).** F28: "On their next inbound message the agent mentions this and offers to resume." N:641 only logs `outreach_resumed`. No copy exists. PRD says the change is "visible, not silent". The
code auto-resumes on any inbound (`core` D15), which is the reverse of "offers".

Existing: `core` D15, D22, D26. PRD F28 counts profiling questions too; founder decision 3 limits it to initial invites (`docs/network.md` line 450). PRD snapshot is stale on this point.

### 13.4 Quint notes

`Attention.qnt`: one person, two apps, four counters. Environment actions: `inbound(app)`, `queueRefuse`, `queueAccept`. Invariant `pauseMeansSeen`: `onlyWhenAsked(m)` implies two rows reached an accepted state.
This fails today by JE18.

## 14. Journey: delivery failure as the member sees it

### 14.1 Outcome table

| Message | Path | Failure | Network belief | Sender told | Recipient told | Retry |
|---|---|---|---|---|---|---|
| STOP confirmation | collected | gateway rejected | STOP stands | no | no | no (`refused_gateway`) |
| Reply | collected | same | advanced | no | no | no |
| Probe | queue | cap, expiry, opted out, ineligible | sent | n/a | no | no |
| Reveal | queue | as above, parked | told, confirmed at 48 h (`sweep` D3) | partner thinks booked | no | no |
| Reminder | queue | as above | reminded | | no | no |
| Cancellation | Network deferred | leave in quiet hours | deleted | | **no** (JE7) | no |
| Cancellation | Network streak | `conversation_streak` | refused | | **no** (JE8) | no |
| Cancellation | queue | 3 unanswered | sent | | **no** (JE8) | on inbound |
| Relay text | queue | any | `pass` | "delivery isn't confirmed yet" once, nothing later | no | no |
| Number | queue | any | `contactShared` | same | no | blocked (JE13) |
| Hold notice | queue | quiet hours, streak, ban | sent | | late or never (JE21) | |

Retry is at the transport level only (Q:515-519, 6 attempts). No path turns an end state into a message to any member. `onAlert` writes a log line (CH), and the ops report counts rows. Line:
PRD 32.9 "safety or account notices ... keep being sent" and F28 "messages inside an accepted opportunity ... keep being sent".

### 14.2 Defects

**JE7. A leave or delete in quiet hours loses the partner's cancellation (P1, safety of a person going to a venue, high, probe).**
Where: `N:916` `dropMember` first, `N:2516` send with hook `drop_notice`, `N:3888` deferred, `N:920` the opportunity is deleted, `N:4105`: `valid: () => !!o && ...` is false once `o` is gone, `N:3273-3274` skips it. `onRefused` is
not called. Probe (mini, a booked pair, 23:00 New York):

```
n.forgetMember("a")
deferred: [{to: "b", kind: "cancellation", hook: "drop_notice"}]; opp kept: false
after 24 h of ticks: messages to b: []; deferred 0
```

Partner `b` keeps a booked date in their thread. No reminder comes, since the item is gone, and nothing says that it is off. F24: "Deletion cancels the member's open opportunities (others are told without blame)." With STOP the
item stays `closed`, so `valid` holds and the deferred text goes. The defect is specific to forget. It also applies to an under-13 decline.

**JE8. A cancellation can be refused by the streak rule, or held by the line cap, with no retry (P1, high, probe for the first).**
`N:3885`: `canSendLogistics` needs `outbound <= 2`. The `drop_notice` hook has no `onRefused`. Probe: partner has `outbound = 3`, the other member sends STOP: stage `closed`, messages to b `[]`, log `send_refused
{kind: cancellation, reason: conversation_streak}`. A partner with a booked plan, a reminder and one relayed text is at 3. In the queue, Q:398-401 holds a `transactional` cancellation at 3 unanswered, and it expires in 3 days, which can
be after the date. `copy.declinedQuiet` for a block (N:1440) and the `close` path (N:2540) have the same refusal. A cancellation is the message that the person most needs.

**JE24. No failure is visible to the member (P1, high, trace).** See the table. In particular a relay `pass` returns "delivery isn't confirmed yet" (RE:57) at the time of the turn; nothing later corrects it. PRD does not specify the text. Founder
question: which end states deserve a message. Candidates: relay text to the sender; number share to both; cancellation retry.

Existing: `sweep` 3.3, D3; `outbound` D4, D12, D13, D17, D31; `core` D19.

## 15. All new defects

Confidence is from reading unless marked. No fix is proposed in code; the notes say where a fix would act.

| Id | Title | Priority | Evidence | Where |
|---|---|---|---|---|
| JE1 | After global STOP, one app can never be resumed by text | P0 family | probe | S:1100-1110, S:974-978, S:1369-1371, C:39-44 |
| JE2 | Leave and rejoin clears hold, score and case | P0 | probe | S:1081, N:942-943, S:1443 |
| JE3 | A join during a hold is not held | P0 | probe | S:1390, S:1443 |
| JE4 | A held or banned reporter holds the victim | P0 | probe | N:740, N:1285, N:1295, T:118 |
| JE5 | A banned member's text is stored and answered | P0 | probe (gateway unverified) | S:1099, R:473-477 |
| JE6 | Minor report, report hold and automatic hold stay in one app | P0 | probe | N:1550, N:1285, N:1188 |
| JE7 | Leave or delete at night loses the partner's cancellation | P1 | probe | N:916-920, N:4105, N:3273-3274 |
| JE8 | Cancellation refused by the streak or held by the line cap | P1 | probe, trace | N:3885, Q:398-401 |
| JE9 | Block does not close items in other apps | P1 | trace | N:1434, N:3402, R:511 |
| JE10 | Block and report can land in the wrong app, with a reply that sounds done | P1 | trace | S:964-978, N:1423, N:1373 |
| JE11 | A person who left cannot report | P1 | probe | S:1099, S:1140 |
| JE12 | A join after STOP has no consent echo | P0 family | probe (fence unverified) | S:1447, S:1491, A:384 |
| JE13 | A failed share stays shared and blocks a retry | P1 | trace | E:377, E:394, D:252, D:321 |
| JE14 | Past contacts are not told of a ban | P1 | trace | E:489 |
| JE15 | Relay holds and blocks never reach trust or a case | P1 | trace | D:67-80, D:232-249 |
| JE16 | Deletion and export by email have no operator path | P1 | trace | S:2162-2500, API:574, API:626 |
| JE17 | The subject of a report can erase the evidence by a leave | P1 | trace, probe | S:760, S:1081, N:943, R:529 |
| JE18 | Cap-refused probes count as silence, across apps | P1 | trace | Q:424, N:3938, N:3324 |
| JE19 | Two re-engagement machines share one line slot | P2 | trace, medium | Q:400, N:3339 |
| JE20 | Resume from "only when I ask" is silent | P2 | trace | N:641 |
| JE21 | Safety notices lose priority in the queue; a ban refuses its notice | P2 | trace | N:1197, R:429, S:708 |
| JE22 | Hold on all apps, lift on one, no notice | P2 | trace | S:1684, S:1540 |
| JE23 | No undo for a block or a ban | P2 | trace | N:1379 |
| JE24 | No delivery failure reaches a member | P1 | trace | Q:515-527, R:649 |
| JE25 | "delete my info" is STOP only | P2 | trace | core replies.ts, S:1959 |

JE3 detail. **A join during a hold is not held (P0, high, probe).** PRD 40.3: "A safety hold alone does not refuse a join, but the person cannot be matched until staff resolve it." `S:1390` checks bans only. A new app gets a new member with a
fresh `Trust`. `snapshot.ts` has no person-level hold input. Probe J3 (hold by `safety@*` on friends, then `peon.biz`, `Cy, 30`): friends `hold`, peon `ok`. The hold loop in `S.hold` covers only memberships that exist at that moment (S:1684).

Checked and not a defect:

- `member_apps` includes paused and restricted members (0007:228), so a stopped member still routes, and "leave" works after STOP.
- Blocks survive leave and delete (R:511, PS:317), and a revived tombstone keeps them.
- The age floor survives delete everything (A:437), and a rejoin revives with the floor as the check.
- A staff release of a held relay item for a held sender is refused later (section 9).
- STOP does not lose a queued relay row: R:281-284 reads it at admission.
- `cancel` alone is STOP on purpose (`docs/network.md` line 303).
- Cap slots return for every `NOT_SENT` end (Q:195, Q:345), except the crash window in section 12.

## 16. Modelling plan

Merge rule: one spec per root cause, not one per journey.

| Spec | Covers | State | Key checks | Finds |
|---|---|---|---|---|
| `PersonSafety.qnt` | sections 3, 6, 7 | persons, apps, member ids, `hold`, `reportOpen`, `minorFlag`, `ban`, `memberships` | `holdFollowsPerson`, `minorFollowsPerson`, `bannedHasNoEffect`, `evidenceKept` | JE2, JE3, JE4, JE6, JE17 |
| `StopStart.qnt` | section 2 | ledger, projections, routing, fence | STOP-1 to STOP-5 | JE1, JE12, `inbound` D1, D2, D5 |
| `BlockAcrossApps.qnt` | section 5 | person blocks, items per app | `blockClosesAll` | JE9, JE10 |
| `SendBelief.qnt` | sections 12, 13, 14 | rows, belief, counters | `pauseMeansSeen`, `cancelReachesPartner`, `sharedImpliesDelivered` | JE7, JE8, JE13, JE18, `sweep` D3 |
| `EraseLiveness.qnt` | section 11 | a request as an environment input | no invariant to pass: it documents the missing action | JE16 |

Abstractions: time as steps with named deadlines (15 min, 26 h, 72 h, 30 d). Treat classifier results as a nondeterministic choice. Treat the gateway as a lossy mirror with an explicit `fenceMode` constant for what upstream does.
Bounds: 2 persons, 2 apps, 2 member ids per person, 1 item, 2 rows per item.

Ask upstream before modelling the gateway: (a) does an app-scoped opt-in clear an all-scoped fence; (b) does `accountEligible:false` stop a `reply`-kind turn answer; (c) what does the gateway do on a rejected STOP confirmation.

Founder questions from this journey: is a hold a person-level fact; may a held or banned person's report have a matching effect; does STOP-then-START mean one app or all apps; who runs a deletion request, and how is the owner proved; which delivery end states
get a member message; should a held person be able to erase evidence by a leave.
