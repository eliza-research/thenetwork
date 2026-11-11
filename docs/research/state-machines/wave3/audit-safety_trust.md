# Audit: coverage of quint/safety_trust.qnt (wave 3)

Branch read: claude/quint-state-machines (the wave2/safety_trust fixes are on it). Line numbers are this branch
unless marked "formal-main". Inputs: quint/safety_trust.qnt, docs/research/quint-findings/safety_trust.md,
research doc section 6.9, drift review on claude/formal-main (docs/results/2026-11-09-quint-drift.md, safety_trust
section: block-abuse window, inviter accountability, liftHold row order, liftHold case state already fixed there).
Not re-reported: the 16 fixed register rows, the auth_edge rotation race and the invite-only under-13 exit.

Two new defects were reproduced on the real ConsentNetwork with the repo's test harness (packages/network/test/mini.ts),
from scratch scripts in this scratchpad (late.ts, late2.ts). No repo file was changed.

## Suspected (new) defects

### D1 (P0, reproduced). A late disclosure about an earlier date is filed against the newest date's partner
- Where: packages/network/src/network.ts:2823-2834 (lateCheckInReport), :337 (ABOUT_SOMEONE).
- lateCheckInReport takes the newest done 1:1 date in the 7-day window and reports *its* others when the text has a
  report word and any pronoun. It never checks which person the text names.
- Trigger (reproduced, scratchpad/late2.ts): ana dates Sam (c), answers "It was fine."; ana dates Ben (b), answers
  "It was fine."; ana texts "Sam followed me home after our date, he scared me". Result: report
  [a -> b, unsafe, check_in], Ben blocked and out of matching (safetyHeld b = true), Sam untouched.
- Harm: the real subject is not blocked or held; an innocent member is held and blocked.
- Fix: when the text names a counterpart (namedIn / resolveTarget over counterparts), report that person; only fall
  back to the newest date for a bare pronoun; refuse (or ask "Who do you mean?") when the name is not in `others`.
  Gate: integration case with two dates.

### D2 (P1, reproduced). Venting about anyone else with a pronoun files an urgent report on the date partner
- Where: network.ts:848 (gate), :2823-2834, :337.
- Trigger (reproduced, scratchpad/late.ts): a done slop/peon date, check-in answered "It was great, he was lovely.";
  one day later "my boss was so rude today, he yelled at everyone" -> report [a -> b, harassment, check_in], block,
  b safetyHeld = true. classify() gives kind "other", checkInReport gives "harassment", ABOUT_SOMEONE matches "he".
  Also "my landlord is a creep, he keeps texting me" and "my sister's ex was abusive to her" read as harassment.
- The existing test (packages/network/test/check-in-late-report.test.ts:36) only uses "my boss was so rude today"
  (no pronoun), so it passes.
- Fix: require the date partner's name or "my date/the date/our date", not any pronoun; or confirm before filing
  ("Is this about Ben?"). Add corpus rows for the late path.

### D3 (P1). The disclosure and the "Who do you mean?" answer can be routed to another app and lost
- Where: packages/network/service/service.ts:1096-1113 (route), migration 0044 member_apps last_item.
- route() sends a text to the app of the newest meeting only when classify() says block/report (safetyTargetAt,
  network.ts:1603-1611). A disclosure ("actually he followed me home") and an answer to "Who do you mean?" ("Sam R.",
  classify: "ack") are not block/report, so they go to the app with an unanswered opportunity message (last_item),
  else the last writer.
- Trigger A: ana on slop and peon. Slop date done, check-in answered. Peon sends a probe (opportunity message, not
  answered). ana texts "actually he followed me home and grabbed me" -> peon. Peon has no date in the window ->
  lateCheckInReport false; the probe reads it as unclear. Nothing is filed on slop.
- Trigger B: ana texts "report Sam" on slop with two counterparts named Sam -> slop asks "Who do you mean?" (no
  opportunity id). Peon has an unanswered probe -> ana's "Sam R." goes to peon; slop's pendingSafety expires after a
  day (network.ts:1628). The report is never filed.
- Fix: in route(), prefer the app with a live pendingSafety, and the app whose lateCheckInReport window holds a date,
  before last_item (both readable with readState like safetyTargetAt).

### D4 (P1). Leave reads safetyHeld and forgets in two locks (SD-021 race)
- Where: service.ts:905-914; runtime.ts:750-775 (readState and unitOfWork take the lock separately).
- Trigger: ben texts "leave slop.date"; service.forget runs readState -> safetyHeld(ben) = false and releases the
  lock. ana's inbound unit "report Ben, he threatened me" (met, urgent) runs now -> reportHeld(ben). The forget unit
  then forgets ben. No person_holds row. ben rejoins slop: new member id, not covered, matchable. That is SD-021 again.
- Reverse order: a staff dismiss between the read and the forget leaves a carry-over row for a cleared member.
- Fix: decide and write the row inside the forget unit (unitOfWork(async n => { if (n.safetyHeld(id)) await insert;
  n.forgetMember(id) })), or have forgetMember return the flag and write in the same save.

### D5 (P2). A partial lift does not cover a new app while another app's hold remains
- Where: service.ts:1751-1768.
- With a '*' row, a lift on app X writes one row per other live membership (not removed, not invited) and deletes
  '*'. Trigger (4 apps in production): person on slop and peon. safety@* hold -> (p,'*'). Lift on slop -> (p,peon)
  only. The person joins friends.help (or accepts an invite) -> no row covers friends -> matchable there while peon
  still holds them. The model has 2 apps and its ghost clears staffHeldP on any lift, so it cannot show this.
- Fix: keep a '*' row with the lifted app recorded as an exception, or decide (founder) that a lift on one app ends
  the person-level hold.

### D6 (P2). A ban writes no person hold; a stopped ban leaves unreached apps matchable
- Where: service.ts:1968-2001. The staff hold writes (p,'*') first (SD-022); the ban does not. Between a stop and the
  staff retry, the unreached app's network.members row is still active, trust is ok: the person can be proposed to
  others there. identity_sagas accepts this window (bannedNotMatchable exempts a stopped saga awaiting retry).
- Fix: insert (p,'*','ban') before the member loop, as hold() does. No new copy.

## Model gaps

1. Inviter accountability (network.ts:1256-1262): hold of an invitee blocks the inviter's invites 30 days and adds an
   invitee_held point; can cascade up the invite chain and move an inviter to watch/hold (dropMember). Not modelled.
   In production nothing writes network.members.invited_by (only nulls it, runtime.ts:588), so it is dormant there
   but live in the sim. Adding it could break noSingleActorHold's intent (an invitee's own two messages add a point to
   the inviter).
2. Block-abuse window (trust.ts:104-105, 116): code counts stranger blocks in a sliding 14-day window and fires
   block_abuse each time the window holds exactly 3, so it can repeat (2+2+2 -> hold from block abuse alone);
   credibility returns after 14 days. The model keeps a permanent strangers set and fires once. The model's
   reporters are less often credible than the code's, so it can miss traces where a former block abuser counts.
3. Staff scopes: the model assumes safety@* (header line 45). Per-app staff write (p, app) rows, hold only this app's
   member (service.ts:1905-1918), and are refused a '*' lift. Not modelled.
4. holdMember with a reportId (network.ts:1370-1384, decideReports 1413-1418) marks only that report "held"; the
   other open urgent reports stay open, so after liftHold reportHeld is still true. Model holdMember always marks all.
5. liftHold order (service.ts:1757-1766): rows deleted in one transaction, the Network lift in a later unit; a
   not_on_hold refusal (member covered but not yet synced) still deletes the rows. Model guards the whole action
   on level == hold (drift item 3).
6. Crash points: only the staff-hold loop has `crash`. Not modelled: ban loop (D6), clearMinor loop
   (service.ts:1931-1959), forget read/insert/unit (D4), liftHold two-step.
7. Opportunity stages: callOffPair and dropMember act on every OPEN stage (probing, review, scheduled;
   network.ts:1523-1538, 2725-2745). The model has only scheduled/done.
8. Hold while held: a held member's abusive text adds a 0-point event (network.ts:772); not modelled (harmless).
9. Decay runs once a day at the run hour (network.ts:3511-3513), the model at every tick (no effect on invariants).
10. Routing (D3): `report` models route() only for block/report texts; `answerWho` and `disclose` assume the
    message reaches the same app.
11. Relay: ageSignal (engine relay.ts:127-128, "the platform re-checks the person's lowest age") is read by nothing
    in packages/network/service; relay "hold" decisions write no case event. The model's relaySend has neither.
    (Low impact if the same text always passes through /internal/turn first, where classify() reads the age.)
12. Delete everything and phone change: rows survive a tombstone and revive with the same phone
    (pg-store.ts:63-65, 382-384); a newOwner delete orphans them. Not modelled (identity_sagas territory).
13. Legacy members without a person: the leave writes no carry-over row (service.ts:910, 1228). Not modelled.

## Model errors (vacuous or weaker rules)

1. checkInReportIntended is vacuous: checkIn constrains the reader oracle (`intent == report` iff reader is a kind,
   qnt:473) and disclose always sets intended = true (qnt:495). So the rule cannot fail, and D1/D2 (both false
   reports on the check-in source) are invisible. Fix: let the reader and the disclosure text be free oracles
   (intent and named person independent of the code's choice) and keep the rule.
2. disclose requires `inWindow == Set(k)` (qnt:494): the code path that picks the newest date is excluded, which is
   exactly D1.
3. slotFromMeeting is a restatement: rec.at = o.meetingAt (qnt:467), so (at - meetingAt) % 7 == 0 always. The UTC slot
   bug (profile.ts:224-228) is not checked.
4. safetyNoticeImmediate is vacuous: no action produces "transactional".
5. noShowCountsAbsentOnly is partly by construction: selfNoShow requires o.absent.contains(m) (qnt:472).
6. staffHoldFollowsPerson: liftHold removes the person from staffHeldP (qnt:585) though the code keeps the other
   apps' holds; the rule then checks nothing for that person (hides D5).
7. reporterNotHeld / standing cite trust.ts:115-116 ("a serial reporter's reports don't count") but encode only
   hold and ban. The code's reportHeld (network.ts:1354-1356) lets a watch-level or block-abusing reporter who met
   the subject take them out of matching. Either the rule or the comment needs a decision.
8. liftHold case state (qnt:582) sets "open" for none/closed; code always ends "lifted" (drift, fixed on formal-main).
9. Bounds: 2 apps cannot show D5 or any rule that needs a third app.

## Open carve-outs

- SD-027 (skipped). Note: profile.ts:277 counts every "blocked" edge, and findByName lets a stranger block by unique
  first name, so two strangers who never met X put X in permanent trust_review, against trust.ts:8-11. In-scope part
  now: a 0-point case event when reviewReason returns trust_review (staff visibility, no copy) satisfies
  engineHoldVisible; counting only blocks by counterparts is a security fix. The staff exit needs the founder.
- SD-074 (skipped). The minor-report part is arguably covered by founder decision 1 ("Age is a person-level fact",
  minors never matched in any app): minorReported could write (p,'*','minor_report'), cleared by the existing
  every-app clearMinor. Automatic and report holds need the founder.
- SD-253 (skipped): new member copy; founder.
- NEW-2 (open, fixable now as a reproduced security bug): liftHold refuses a banned person (people.isBanned); and at
  forget of a reporter on hold, stamp their open reports (e.g. reporterHeld: true) so reportHeld ignores them.
  Gate: new2HeldReporterLeavesTest as an integration case.
- NEW-3 (open): needs a decision on which member leaves a booked plan; PRD F23 favours dropping one member over
  closing the plan.
- SD-021 remainder: the risk score (watch) and the case history are not carried over (safetyHeld,
  network.ts:4701-4703, excludes watch; forget deletes cases, network.ts:997). A member at score 5 leaves and rejoins
  clean, with the clean-record cap again. Needs a decision (a person-level score row) — the register title names
  "the risk score".
- SD-442 remainder: slotOf reads UTC (profile.ts:224-228); fixable in scope (New York time slots, deterministic).
- SD-220 limitation in the findings (older date in window) is now defect D1.
- SD-254 remainder: relay holds and ageSignal reach no case (gap 11).
- Liveness ("every hold reaches a staff decision") not checked.
