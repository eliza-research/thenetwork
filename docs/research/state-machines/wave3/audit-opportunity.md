# Audit: coverage of quint/opportunity.qnt

Read: quint/opportunity.qnt (1322 lines), docs/research/quint-findings/opportunity.md, research doc section 6.6,
packages/network/src/network.ts on HEAD (claude/quint-state-machines, 5323 lines; contains the wave2/opportunity
fixes) and on claude/formal-main (5476 lines), outreach.ts, jobs.ts readPostingText, service/packs.ts slop
timeOptions, the formal-main drift review (docs/results/2026-11-09-quint-drift.md, section "opportunity").
Line numbers are HEAD network.ts unless marked FM (claude/formal-main). Hand-written. No model run was
needed for the findings below; each is from reading the model against the code.

## Suspected defects (new)

### D1 (P1). reveal() blames the recipient for another participant's failure
network.ts:2553-2560 (FM:2582-2590), checkRecipient network.ts:4471-4494 (other_not_matchable at 4489).
reveal() calls checkRecipient(id, "reveal", {about: o.participants}) per participant. The "about" loop calls
syncRecord(other) and fails with other_not_matchable / other_on_watch / blocked_pair when ANOTHER participant
is now a minor, account paused/restricted, declined, or on watch. The code then marks `id` (the innocent
member) unavailable and runs replaceOrClose(o, id).
Trigger: pair intro a+b, alt c. b says yes. b pauses their account (record accountStatus=paused), or staff
correct b's record age to 16, inside the 60 s before the next tick (syncMember only runs at unit start and
tick start). a says "yes": onInbound(a) runs syncMember(a) only; onProbeAnswer -> advanceProbes -> reveal;
loop id=a: syncRecord(b) -> b.account -> other_not_matchable -> a is "unavailable" and replaced by c. c's probe
about [b,c] is refused (b not matchable) -> c replaced -> close("no one available"). a said yes and hears
nothing (status unavailable, so close() sends no SD-263 release; the "Great, thanks." ack only rides on a next
send). If a is the requester: close("requester unavailable") -> the request goes to "none" with no word.
In the minor case close() is not "minors policy", so the release goes to the minor b.
Fix: run syncMember for every participant before the loop and return when the stage changed, or attribute
other_* failures to the other member.

### D2 (P1). A minor from the member record is not taken out of an item they were contacted on or an alternate in
network.ts:4686-4688 (FM:4785-4787), dropMember 2725-2747 (FM branch 06ad8e6 at ~2768).
syncMember calls dropMember only when `busy(m.id, undefined, true)`. A member who was replaced (said no or let
the probe expire) or who is only an alternate is not busy, so the 06ad8e6 branch (close an open item a minor was
asked about and replaced) and the wasAlternate branch never run for a record-driven minor. syncRecord inside
checkRecipient also sets m.minor mid-unit with no dropMember.
Trigger (FM): pair a+b, alts [c]. a yes; b says "no" -> replaced by c. Staff set b's record age to 16. Next tick:
syncMember(b): minor, not busy -> no dropMember. c is probed about the item and says yes -> reveal to a and c:
the judge's minor_contact (the case 06ad8e6 fixed for the inbound path). Same for b as an alternate only.
Fix: syncMember drops when the record makes the member a minor and any open item has them in participants,
alternates or contacted.

### D3 (P1, peon). A probe overwrites the job-post read-back slot; the manager's "yes" to the post is read as a yes to the probe
network.ts:2285-2287 (probe owed check; FM:2289), postingTurn 4899-4928, slot write 4926, hook "probe" onSent 4318.
probe() waits only for an owed probe or the feedback slot, not for awaiting "posting". The probe hook's onSent
writes awaiting=probe with no expect(). postingTurn reads the draft only while awaiting.kind=="posting"; with
the slot gone, readPostingText("yes", no draft) returns undefined (jobs.ts:149-151).
Trigger: manager M texts a job post -> read-back "reply yes to save" (awaiting posting). A seat candidate says
yes, so the manager probe (logistics timing, not an invite) goes out at the next tick. M answers "yes" (to save
the post) -> postingTurn false -> probe branch -> yes -> M "available"; the reveal sends names. Same class as
SD-077 (fixed for feedback only). weeklyCheckins' expect() can also replace the posting slot (expect protects only
probe/booked). Fix: add `m.awaiting?.kind === "posting"` to the owed check in probe() (and expect()).

### D4 (P2, sim only today). tellNoneYet writes the growth slot directly
network.ts:1753 (FM:1761); repeat-ask path 1688-1697 (SD-266 fix dc55401).
When invitesWork (growth on and ctx.invite set) and canInvite, tellNoneYet sets awaiting=growth with no expect()
and no openAskAt. (a) Repeat ask while a probe is pending: a has awaiting probe/o2, texts "any luck finding me a
climbing partner?" -> clarify() refuses people_request -> openRequest -> prior none, busy -> tellNoneYet(again)
-> probe slot lost; the later "yes" is swallowed (growth branch then ACK_ONLY) and the probe expires as silence.
(b) After a request closes with "none yet... know someone?", askOpen() is false (no openAskAt), so a new probe
goes; "Sure, my friend Wren would love this" is read as a yes to the probe (the case probe() comments guard).
Production has no ctx.invite (invitesWork false), so sim only. Fix: use expect() and set openAskAt.

### D5 (P2). toldNone / toldRetryNone are set before the send is known to go
network.ts:1745-1753, 2713. The send (kind info, no proposalId) is unsolicited after the 48 h ask window and can
be refused by prd_budget_reserved or two_unanswered (4272-4294) or the streak. The flag is already set, so no later
close tells the requester; only a repeat ask does.

## Model gaps (code paths the model leaves out)
1. Send pipeline: unsolicitedRefusal / PRD lanes (4160-4166), leak guard with no fallback -> onRefused (4176-4182),
   duplicate skip for hook-less notices within 10 min (4184-4189), account and hold refusals, other-party checks in
   ABOUT_OTHERS (4482-4492), pendingAck/note folding. sendGate checks only the recipient's own state. Adding the
   other-party checks reproduces D1 and would break partialAcceptReleased if the invariant were strengthened.
2. probe() branches: askOpen hold (2283-2295), inNyc refusal with no onRefused (2297), commonTimeGone ->
   closeNoCommonTime (2299, 2337), D5 name fallback; onProbeAnswer commonTimeGone close (2436-2443); picks and
   declinedTimes; meetingTime undefined -> close (2563) and bookedNear clash (2566-2572). Drift review lists the
   same; on FM also offerOtherTimes/sendOtherTimes (FM:811, 2471-2496) with statusAfter (silence after a
   counter's other times expires; timeRetry keeps the yes only when primed). The model's counterOfferTest and
   expireProbe are stale vs FM.
3. Review: reroll (2123-2156, new deadline), edit, sameDay 1 h SLA (2170), matching_paused refusal (2069), auto
   mode, approvalCheck trust/blocked/gateReason. daily-gates-and-switches (planned in 6.6) is absent.
4. Actors: trust watch/hold -> dropMember("trust ...") (1250); account pause (syncRecord 4679); record age via
   syncRecord inside send checks (no dropMember, D1, D2); blocks and callOffPair (1523-1540, tick 3497: booked
   cancellation via declinedQuiet "cancellation" with no meeting-time hook); quiet-hours change by record (4671).
5. Tick: syncMember/personHold prelude (3485-3486), checkSeats, weeklyCheckins (expect overwrites posting/feedback/
   growth), daily run: retryRequests (o.retry path in close 2707-2714, begin's requestRetryFound 2191), reengage,
   localEncounters, planner. Insertion-order deferred delivery is covered by "any order".
6. Slots: interview/age/growth/checkin/crew writers; tellNoneYet (1753) and postingTurn (4926) write directly.
   Posting is only via the job_post intent; the probe can overwrite it (D3) but no intent shows the harm.
7. Requests: one request only; noCount closes a request after two no's (2459); lastConfirmAt 72 h hold; repeat ask;
   tellNoneYet's "again"; matching off (requestWaits); a requester who is minor/on watch.
8. Groups (3+ keep, handleDrop keep `still.length >= 3`), seats (manager unavailable 2510, "no" status, endSeat
   reasons "posting closed/filled" exempt from releases), plans (busy() ignores available plan yes 4632; planProbe
   busyOk 3158), replacements cap 3, sharesFirstName.
9. Crash/retry: none inside a unit (one save under the advisory lock, store.ts:341-351); duplicate inbound and the
   8 s turn budget are service-level (turn_consent). Not a gap for this model.

## Model errors
- namesAfterAllYes / counterIsNotYes are close to tautologies: the ghost consent is the intent, and the only
  intents that are read as yes but are not consent are fb_good and the bare ack after 2 outbound. There is no
  intent for "a yes meant for another open question" (posting read-back, growth invite, check-in), so D3 and D4
  cannot show. Add a `yes_other_q` intent (readers: yes; not CONSENT) usable while slot posting/growth/checkin.
- partialAcceptReleased only reads members still "available": a yes-sayer the reveal re-check sets "unavailable"
  (D1, or the own-streak case) is never checked. Add a ghost `saidYes` and check it at close.
- minorNever reads only statuses of current participants in open items; it cannot see probes or reveals about an
  item a (now) minor was contacted on or an alternate in (06ad8e6 on FM, D2). Add a ghost contactedEver and
  check collected probe/reveal kinds after the minor flag.
- deferredInTime (SD-146 "not reproduced") rests on "time options leave out quiet hours". False for the slop pack
  path: packs.ts:239-242 takes slots (14:00/18:00/19:00) with no quiet-hours filter, and quiet hours can change
  after the options (syncRecord 4671). Member with quiet hours [13,20] picks Sat 19:00; partner answers 13:30 ->
  reveal to the member deferred to 20:00 > meeting -> dropped by valid() (hook reveal 4335), no onRefused;
  partner goes alone. The constraint hides this. Drop the constraint or make it nondeterministic.
- sendNotice uses logistics timing and the streak only; the code's release is kind info (may be unsolicited for
  the requester's none-yet), so the model marks some notices "released" that the code refuses (D5).
- probeSend is a separate unit even when the code sends in the same unit (approve, onProbeAnswer); an
  over-approximation, sound for safety.
- verify-steps=3 reaches only review decisions (findings section 7 says so); `verify safety` says nothing about
  probes, reveals or drops.
- answer is disabled for opted-out members; the code still routes their text (cancel, feedback, requests).
- Stale N: anchors (drift review) and HEAD vs FM code: the model matches HEAD, not FM (offerOtherTimes,
  statusAfter, sendLane, 06ad8e6).

## Open carve-outs
- confirmedImpliesDelivered (SD-006) and silenceOnlyAfterDelivery (SD-030): still no delivery outcome into the
  Network on HEAD or FM. In scope as consent bugs, but needs a design decision: runtime storeStatuses ->
  Network.deliveryOutcome(oppId, member, kind, status): a refused/expired reveal does not start the 48 h silence
  (clear bookedAt, run onRefused); a probe not delivered expires unsent (no noAnswer, no expiredSilent).
- declineRecorded (SD-140): fix reverted; re-apply after fixing the two sim gates it exposed (info timing,
  minors-in-plans for a minor found after contact). Both are in scope.
- noticeNeverRefused (SD-249): founder decision. Smallest in-scope option: a refused drop_notice / release goes to
  `deferred` until the member writes (heardFrom), keeping the streak rule.
- bookedNoHonored (SD-259): new flow, founder decision.
- bookedSlotAlive (SD-139 residual): fixable now. handleDrop's own close path (2659-2672) clears only the dropping
  member's slot; close() (2691) clears all. Clear every participant's slot that points at o when !keep, with an
  integration test (a partner's "yes" after the cancel gets no booked thanks).
- requestNotStuck exemptions (requester cancels; deleted done item): by design.
- cancelReachesTold / partialAcceptReleased exempt noticeRefused (SD-249) and minors policy (by design).
- SD-028, SD-142, SD-219, SD-269, SD-297: skipped for founder decisions; SD-297 (silent resume) is a copy change
  and needs scope confirmation (no copy changes without a broken flow).
- SD-325: dead state, could be removed (simplify-first) with no behavior change.
