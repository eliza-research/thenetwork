# Proposal, review, and response

## Story: Proposal, review, and response

A member needs a recorded approval before contact (the review judge, or a named staff member for an item the judge holds) and control over when The Network makes an introduction.

### Safety rules and reachability

Check review and deadlines, participant answers, name disclosure, STOP, cancellation, and the pause after unanswered invitations. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

After an ambiguous answer to a timed offer, the reply slot keeps a time choice open until the member makes an offered choice, declines, or asks for other times. The reply oracle distinguishes a timed ambiguity and an explicit current choice. The [probe reply rules](../probeReply.md) and signed booking tests check the exact offered keys. The live service upgrades an older timed reply slot with `clarified` and no stored mode on its first non-resolving reply. The model starts with current-format slots and records `timeChoice: false` for a generic clarification.

Production uses the generated [opportunity lifecycle](../opportunityLifecycle.md), [probe dispatch](../probeDispatch.md), [review deadline rule](../reviewDeadline.md), and [meeting confirmation and attendance settlement](../meetingSettlement.md). The Network shell keeps the roster, persisted statuses, channel effects, and attendance records. The [repeat encounter rules](../repeatEncounter.md) cover a new review after two private responses to the same completed meeting.

The [outreach policy](../outreachPolicy.md) counts a confirmed initial invitation at probe expiry or after 72 hours. This model covers member answers in the pair path. An assistant's profile submission leaves the outreach state in place and does not call the modeled answer action, so it never starts, confirms or closes a job posting read-back ([posting policy](../postingPolicy.md), "Only the member's own text in the thread issues a command"). Group deadlines, pre-receipt stored entries, and the one-time re-engagement are outside its bounds. A reply to an expired probe ([probe reply rules](../probeReply.md), "A late answer to an expired probe hears once that the invitation ended") gets one direct answer and changes no opportunity state, so the modeled answer action does not take it. A replacement keeps the yes of a requester and asks again each other member who heard about the earlier roster ([probe dispatch](../probeDispatch.md), "A replacement keeps a requester's yes and asks again every other member who heard about the earlier roster"); the model takes the pair path, and the shell applies the same rule to an activity-partner plan backfill. A direct answer to a probe that the replacement voided gets one honest answer that the plan changed and changes no opportunity state ([probe reply rules](../probeReply.md), "A late answer to an expired probe hears once that the invitation ended"), so the modeled answer action does not take it either. A direct answer to a probe that was waiting when its opportunity closed gets the same one honest answer that the invitation ended and changes no opportunity state, so the modeled answer action does not take it. The model uses the 48-hour window of a generic probe for every probe; the probe dispatch rules give a Slop probe and a time question 24 hours ([probe dispatch](../probeDispatch.md), "A reply or an expired deadline settles the probe").

Review ([automated review](../automatedReview.md)). The review part of an item has a phase (`awaiting` the judge, `held` for staff, `decided`, `stopped`) and an approver (`judge` or `staff`). `judgeRecord(o, verdict, packetCurrent, env)` is `ConsentNetwork.recordJudgment`: an approval by the review judge, or a hold for staff for any other verdict, also `cannot_run` for the tick's `judge_overdue` hold, merged here into one step. A judgment for a changed packet changes nothing, and failed gates close the item as invalidated with no approval. `staffApprove(o, env)` is `decide` approve, only for a held item. `reject` takes any open item. `stopApproved` closes an approved item that is still probing. `replaceOrClose` swaps in only a roster that the approval covered (`judgedRosters`: the base roster and each single swap with an alternate; `replacement_not_judged` otherwise). A staff approval stores no rosters (`decide` sets no `judgedRosters`), so a staff-approved item closes on a replacement. `contactNeedsRecordedApproval` and `heldItemNeedsStaff` state the rule. Changed (owner decisions D15 to D17 of 2026-11-22): the review judge approves each item and staff decide only held items, because the owner removed human review.

The teen part (`s.teen`) has the friendship introductions with a minor ([friend introductions with a minor](../friendIntroAge.md), [teen introduction stop](../teenIntroSwitch.md)). A teen item enters review only when `teenFriendAgeRule` holds; the rule runs again before each contact and at booking with the meeting day; the teen sweep closes an open item at each day change, readiness loss and stop when the rule no longer holds. The judge approves a teen item with the strict rubric (`teenJudge`, `teenRosterIsJudgedStrictly`), and a named staff member approves a held teen item (`teenStaffApprove`). Teen introductions are on from the start (`s.teen.stopped`, the stored key `teenStop`, is false at the start). One admin or safety staff member stops them (`teenStop`), one admin turns them on again (`teenResume`), and each step writes an audit row (`s.teen.audit`). `teenSwitchOffNoMinor` states the stopped case. Readiness needs no staff step: every teen member starts ready, and a report, signal, conflict or bar ends it (`teenReadyLost`). `minorNever` keeps the pair path: a member who becomes a minor by a signal or a record is never teen ready.

Small friends.help groups: t5 (p, q, u) passes; t6 (q, u, r) closes as a whole when r turns 19 on the latest civil date (the window of an unbooked item is scaled to the next civil day; in the code the window ends later, so this member is refused at propose, and `teenNineteenAtWindowEndTest` shows that refusal); t7 has 7 people and fails `teenRosterSizeAllowed`; t8 meets at a place that is not all-ages and fails `teenPlaceAllowed`. `teenGroupSmall` and `teenGroupRule` state the size and place parts. An open teen item that fails any part closes as a whole with a notice that names nobody; the roster of a teen item never changes, so there is no teen replacement and no fallback. Abstraction: a decline closes the teen item (the model's quorum is the whole roster); the code keeps a group that is still above its quorum without the member who declined, and offers no replacement. Changed (owner decision 2026-11-22, answers A1 to A5): a minor may get friendship pairs and small groups under the rule, on from the start with one staff stop, because the owner chose "friends.help and ntwrk", "On at launch, no extra checks" and "Also small teen groups".

The minors drop (`dropMember` with "minors policy") sets the `minorKnew` mark of `network.ts` `Opp` on every opportunity whose time and place the minor heard (`contacted`), finished ones included, and the mark stays after forget deletes the minor (`minorKnewMarked`, `minorMarksFinishedItemTest`). `syncMember` in the code runs the minors drop for a record minor only when an open item holds them, a crew knows them, or an opportunity they know has no mark yet; the model's `becomeMinor` always runs it. The two agree, because a drop with none of these three changes nothing. The repeat of a table and a crew session read the mark through the generated `recurrenceAllowed`; this model has no repeats, and [plan crew](plan_crew.md) checks the crew side (`noSessionAMinorKnows`). Changed 2026-11-22 (joinLine review): the model has the mark, so that it can show that a record age under 18 marks a finished table.

Known drift (the owner has not decided which side is correct): the model's `close` releases each contacted member who said yes on every close in probing, except a block and the minors policy. The code releases such a member only on the requester's own close of a standing thing (`close()` with `closedBy`, `releasesOnRequesterClose` in the [opportunity lifecycle](../opportunityLifecycle.md)) and on the close of a system proposal or a partial release (`releasesPartialAcceptance`). Out of bounds: the model has no pause and its one request is never withdrawn, so the `requesterHearsOpportunityClose` input `withdrawn` of the [member request rules](../memberRequest.md) is always false here; in the code a request that a pause withdrew keeps its opportunity in probing, and the later close of that opportunity tells the requester nothing.

The executable [rescheduling rules](../meetingReschedule.md) cover independent consent to a new start and the booked revision. The [calendar](../calendarInvite.md) and [group late arrival](../groupLateArrival.md) rules use that revision to validate a later download or send. The retained model below abstracts from revised starts and group logistics.

The [probe reply rules](../probeReply.md) distinguish a direct withdrawal from a qualified use of the same words. A direct withdrawal declines the offer. A quoted or negated use and an unbound time keep its current probe open. The first member's accepted slots can narrow and renumber the next member's offer. A valid ordinal or day group acts only on that member's current offer. The reviewed Slop test checks the selected start. This standalone model abstracts the precise slots to all, none, or unresolved.

A complete direct list can name offered days with consecutive or joined abbreviations. A day with several offered times needs a precise choice. A day without an offered time keeps the list open unless the member used “or” to give an offered alternative. A word in ordinary prose does not add a day. The signed booking test checks the exact selected times before and after a clarification.

The same declined action covers a standalone “afraid not,” “not a chance,” or
“no chance.” A qualified use of those words stays in the unresolved action.
The probe reader also removes explicitly excluded options. A trailing
refusal to the offered time applies to each time in its list, including
its ordinal position, clock or part of the day. A daypart that restates
an exact clock keeps that clock and its named day together. A member can
say “for me” before the refusal, or give a scheduling reason after it.
A refusal of a named time keeps the opportunity open. A separate
affirmative clause can select another offered time, and a separate
direct refusal can decline the opportunity. A condition stays attached to its
time refusal and leaves the consequence unresolved. A quoted or reported
refusal does not decline the opportunity. A broad yes with “both” in the refused
list leaves the time choice open when the member chooses no other
time. Fallback selection keeps any stated time-of-day limit before
calling the modeled answer action. The signed booking test checks the
selected start.

A negative or conditional cancellation uses the same booked-reply guard. Exact local start and date-only selection use the one-booking rule in the executable spec. The standalone state machine uses deterministic traces for the special interpretations and abstracts from a second simultaneous booked reply. A [number-swap withdrawal](../opportunityLifecycle.md#a-number-swap-refusal-does-not-decline-the-booked-meeting) keeps the booking unless the member also refuses attendance. The relay model owns the transfer state. The trace below follows the booked slot and makes sure the counterpart receives cancellation only after the attendance refusal.

Imported from `quint/opportunity.qnt` at `30d950e`. See [model index](README.md) for scope and commands.

At the start of a runtime tick, the settlement rule releases a booked reply
slot that expired or lost its meeting before any new prompt is sent. An open
reply slot stays with its booking.
Group attendance settlement supplies exact named absence evidence to the
reliability rule. A group report without an identified participant does not
mark anyone absent or reduce their reliability.

```quint
// -*- mode: Bluespec; -*-
// quint-check: max-steps=250 max-samples=8000 verify-steps=3
// quint-witness: witness_requestFulfilled happyPathTest
//
// The opportunity machines of the ConsentNetwork (docs/research/2026-11-07-state-machines.md section 6.6):
// opportunity-lifecycle, opp-participant-status, review-item, awaiting-slot, yes-hold,
// send-pipeline-and-deferred, reply-reader (as an oracle), send-belief, booked-attendance,
// member-request (one request), outreach-attention (the two-unanswered pause) and the tick.
//
// The model follows packages/network/src/network.ts AS IT IS on branch wave2/opportunity after the fixes
// (c06f633..25b54f1; the defect register ids are in docs/research/quint-findings/opportunity.md).
// "N:<line>" is a line in that file at 25b54f1 where a fix changed the code; other references are from
// ad67275 and can be up to about 55 lines lower than at 25b54f1. One action is one unit of work under the store lock (store.ts):
// an inbound message (onInbound), a staff decision (decide), a tick (tick), or one step of another actor
// (the outbound queue, the member record). The probe send is its own action: probe() defers a probe while
// the member's send window is closed, and tick tries again, so other units run in between.
//
// Bounds: 3 members (a, b, c), 2 pair opportunities. o1 is a member request of a with b (alternate c);
// o2 is an engine intro of a with c (alternate b). Time is in hours.
// Oracles: the send window and quiet hours (env.openW), the intro budget (env.budget), the meeting lead
// time (env.lead), the outbound queue outcome (queueDecide), and the reply readers (readProbe, readYesNo).
// The readers are fixed maps from the member's real intent to the code's reading (classify.ts consentOf:
// a bare counter-offer is "unclear", SD-041); the evals/ corpora test the readers themselves.
//
// Ghost state (not in the code): what the member really meant (accepted, withdrawn, saidNo, cancelAsked),
// what really reached them (probeQ and revealQ: the queue outcome), and who was told what (revealSent, wasTold,
// cancelHeard, released, noticeRefused).
//
// Defects that this model reproduces are named on the invariant that shows them (SD-NNN, register in
// docs/research/2026-11-07-state-machines.md section 5). Findings: docs/research/quint-findings/opportunity.md.
//
// The model is kept small for Apalache (findings section 7):
//  - A unit runs its own light part in one action. The large helpers it calls (close, replaceOrClose,
//    advanceProbes and the reveal, handleDrop, the dropMember step for one opportunity, the tick's parts) are
//    jobs on a stack (`s.jobs`) that the job actions run one at a time, in the order of the calls in the code.
//    No other unit runs until the stack is empty (`idle`), so a unit is still atomic as in the code (one unit
//    under the store lock), and each helper is in the transition relation once. The invariants and the
//    witnesses are read only when the stack is empty. The jobs of a unit use the unit's oracles (`s.jobEnv`).
//  - The tick delivers its deferred sends one job at a time, in any order (the code goes in insertion order;
//    any order includes it).
//  - Messages are not kept one by one. The only messages that an invariant reads are the probe and the reveal
//    (at most one of each per opportunity and member), so each opportunity keeps their queue state
//    (`probeQ`, `revealQ`). `s.collected` counts the collected messages. A member keeps the opportunity keys
//    of their initial invitations since the last inbound text. The two opportunities bound that set.
//    `queueDecideAt` separates provider acceptance time from when its result is available. The model
//    reads the result at the shell's refresh points without storing a second copy of the receipt.
//  - App-specific onboarding prompts are outside this model. spec/probeDispatch.md specifies how a pending
//    onboarding question holds the reviewed probe before it can claim the reply slot.
module opportunity {

  // ---------------------------------------------------------------- constants
  pure val MEMBERS = Set("a", "b", "c")
  pure val ORDER = List("a", "b", "c")
  pure val OPPS = Set("o1", "o2")
  pure val OPP_ORDER = List("o1", "o2")
  // feedbackDue searches the newest opportunity first.
  pure val OPP_NEWEST = List("o2", "o1")
  pure val OPEN = Set("review", "probing", "scheduled")
  pure val TERMINAL = Set("closed", "done", "gone")

  pure val PROBE_TTL = 48 // probeWindow, generic probe
  pure val PROBE_WAIT = 48 // partnerProbeDays = 2 (engine config.ts)
  pure val REVIEW_SLA = 12 // reviewSlaHours
  pure val OPT_OUT_HOURS = 48
  pure val UNANSWERED_AFTER = 72 // spec/outreachPolicy.md, scaled to hours
  pure val UNANSWERED_LIMIT = 2  // spec/outreachPolicy.md
  pure val SLOT_EXPIRY = 72 // awaiting other than probe and booked ends after 3 days
  pure val FEEDBACK_AFTER = 3
  pure val FINALIZE_AFTER = 96
  pure val FEEDBACK_DUE = 168

  // What the member really says (the readers see only the text).
  pure val INTENTS = Set("yes", "yes_other_times", "counter", "no", "unclear", "cancel", "past_time",
                         "fb_good", "fb_other_noshow", "fb_self_noshow", "ack", "job_post", "timed_slot_ambiguity", "offered_time_choice")
  // Intents that are consent to meet (AGENTS.md decision 11: only answer "yes" is consent, a counter is
  // not a yes). "yes, but none of those times" is a yes to the meeting.
  pure val CONSENT = Set("yes", "yes_other_times", "ack", "offered_time_choice")

  // ---------------------------------------------------------------- types
  type Aw = { kind: str, opp: str, at: int, clarified: bool, timeChoice: bool }
  // phase: "" (absent) | "awaiting" | "held" | "decided" | "stopped"; approver: "" | "judge" | "staff";
  // held: the judge held the item (a ghost of review.exception); judgedRosters: network.ts review.judgedRosters.
  type Review = { decision: str, deadline: int, decidedAt: int, invalidated: bool,
                  phase: str, approver: str, held: bool, judgedRosters: Set[Set[str]] }
  type Def = { kind: str, opp: str, to: str }
  type Env = { openW: Set[str], budget: bool, lead: int }
  type OppSt = {
    stage: str, closedFrom: str, closedReason: str,
    parts: Set[str], alts: Set[str], first: str, requester: str,
    status: str -> str,
    review: Review,
    contacted: Set[str], told: Set[str], sentAt: str -> int, turnAt: str -> int, timeRetry: Set[str], askedAgain: Set[str],
    meetingAt: int, bookedTold: Set[str], bookedAt: str -> int, confirmed: Set[str], reminded: Set[str],
    feedbackSent: bool, finalized: bool, post: str -> str, feedbackFrom: Set[str],
    outcomeRec: str, firstIntroduction: bool,
    // ghosts
    accepted: str -> str, withdrawn: Set[str], saidNo: Set[str], cancelAsked: Set[str],
    revealSent: Set[str], wasTold: Set[str], silent: Set[str], expiredSilent: Set[str],
    released: Set[str], cancelHeard: Set[str], droppedBy: Set[str], noShowCount: str -> int,
    noShowCounted: Set[str], noticeRefused: Set[str],
    everTerminal: bool,
    // network.ts Opp.minorKnew: a member who heard its time and place later had a minor signal. It names nobody,
    // so it stays after forget deletes the minor (spec/opportunityLifecycle.md, "A minor signal ends the
    // recurring plans that the minor knows").
    minorKnew: bool,
    // The queue state of the probe and of the reveal to each member: "" (none), pending, held, delivered, refused.
    probeQ: str -> str, revealQ: str -> str, probeAcceptedAt: str -> int
  }
  type MemSt = {
    optedOut: bool, minor: bool, forgotten: bool, aw: Aw, outbound: int,
    // The opportunity of the last message collected for the member when it asked for consent (a probe or
    // its new times); "" for any other message (m.lastSent.consentProbe).
    lastOutProbe: str,
    initialInvites: Set[str],
    onlyWhenAsked: bool, noShows: int
  }
  type Req = { outcome: str, toldNone: bool }
  type Last = { act: str, o: str, m: str, x: str, dt: int }
  // A job: the rest of the current unit (see the header). kind: close, closeBooking, replace, probes, reveal, drop, dm,
  // forgetRest, deliver, refresh, adv, exp, expire. why: the close reason or the dropMember reason.
  type Job = { kind: str, o: str, m: str, why: str, ack: bool }
  // Teen friend introductions (owner decision 2026-11-22, spec/friendIntroAge.md, spec/teenIntroSwitch.md).
  // A teen item: its stage, the meeting day key (-1 before booking), who said yes, who heard of it, the reviewer.
  // approver: "" | "judge" | "staff"; held: the judge held the item; rubric: "" | "adult" | "minor".
  type TeenOpp = { stage: str, meetingDay: int, yes: Set[str], contacted: Set[str], approver: str, held: bool, rubric: str, closedReason: str }
  type TeenHist = { brokeRule: bool, contactWhileOff: bool }
  // The stored stop (`stopped`: the key teenStop is present) and its audit rows, the day key of the Clock (the
  // earliest civil date; the latest is one day later), and teen readiness per member.
  type Teen = { stopped: bool, audit: List[{ by: str, on: bool }], day: int, ready: str -> bool, opps: str -> TeenOpp, h: TeenHist }
  type S = {
    now: int, opps: str -> OppSt, mem: str -> MemSt, req: Req,
    deferred: Set[Def], collected: int, last: Last,
    jobs: List[Job], jobEnv: Env, toDeliver: Set[Def],
    teen: Teen
  }

  pure def L(act: str, o: str, m: str, x: str): Last = { act: act, o: o, m: m, x: x, dt: 0 }
  pure def J(kind: str, o: str, m: str, why: str): Job = { kind: kind, o: o, m: m, why: why, ack: false }
  pure val NO_AW: Aw = { kind: "none", opp: "", at: 0, clarified: false, timeChoice: false }

  pure def zeroMap(v: int): str -> int = MEMBERS.mapBy(_ => v)
  pure def strMap(v: str): str -> str = MEMBERS.mapBy(_ => v)

  pure def template(parts: Set[str], alts: Set[str], first: str, requester: str): OppSt = {
    stage: "absent", closedFrom: "", closedReason: "",
    parts: parts, alts: alts, first: first, requester: requester,
    status: strMap("out"),
    review: { decision: "", deadline: 0, decidedAt: 0, invalidated: false, phase: "", approver: "", held: false, judgedRosters: Set() },
    contacted: Set(), told: Set(), sentAt: zeroMap(-1), turnAt: zeroMap(-1), timeRetry: Set(), askedAgain: Set(),
    meetingAt: -1, bookedTold: Set(), bookedAt: zeroMap(-1), confirmed: Set(), reminded: Set(),
    feedbackSent: false, finalized: false, post: strMap(""), feedbackFrom: Set(),
    outcomeRec: "", firstIntroduction: false,
    accepted: strMap(""), withdrawn: Set(), saidNo: Set(), cancelAsked: Set(),
    revealSent: Set(), wasTold: Set(), silent: Set(), expiredSilent: Set(),
    released: Set(), cancelHeard: Set(), droppedBy: Set(), noShowCount: zeroMap(0),
    noShowCounted: Set(), noticeRefused: Set(),
    everTerminal: false, minorKnew: false, probeQ: strMap(""), revealQ: strMap(""), probeAcceptedAt: zeroMap(-1)
  }

  // ---------------------------------------------------------------- teen friend introductions (constants)
  // p (16), q (17, 18 on 20261123), r (18, 19 on 20261123), u (17), x1 to x4 (17) and w (31) have exact birth
  // dates. t1 is a friendship pair p-q (within 2 years), t2 a friendship pair q-r (r turns 19 during the run), t3
  // a friendship pair p-w (w is 31), t4 a pair p-q in a lane that is not a friendship lane (Date or Hire). t5 is a
  // friends.help group p, q, u at an all-ages place; t6 a group q, u, r (r turns 19 during the run); t7 a group of
  // 7; t8 the group p, q, u at a place that is not all-ages (a bar).
  pure val TEEN_MEMBERS = Set("p", "q", "r", "u", "x1", "x2", "x3", "x4", "w")
  pure val TEEN_BIRTH = Map("p" -> 20100315, "q" -> 20081123, "r" -> 20071123, "u" -> 20091001,
    "x1" -> 20090601, "x2" -> 20090701, "x3" -> 20090801, "x4" -> 20090901, "w" -> 19950101)
  pure val TEEN_OPPS = Set("t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8")
  pure val TEEN_ROSTER = Map("t1" -> Set("p", "q"), "t2" -> Set("q", "r"), "t3" -> Set("p", "w"), "t4" -> Set("p", "q"),
    "t5" -> Set("p", "q", "u"), "t6" -> Set("q", "u", "r"), "t7" -> Set("p", "q", "u", "x1", "x2", "x3", "x4"),
    "t8" -> Set("p", "q", "u"))
  pure val TEEN_FIRST = Map("t1" -> "p", "t2" -> "q", "t3" -> "p", "t4" -> "p", "t5" -> "p", "t6" -> "q", "t7" -> "p", "t8" -> "p")
  pure val TEEN_FRIENDSHIP = Map("t1" -> true, "t2" -> true, "t3" -> true, "t4" -> false,
    "t5" -> true, "t6" -> true, "t7" -> true, "t8" -> true)
  // spec/friendIntroAge.md teenPlaceAllowed: the place and the activity are all-ages (a pair meets at a public
  // meetingSpot, which is all-ages).
  pure val TEEN_ALL_AGES = Map("t1" -> true, "t2" -> true, "t3" -> true, "t4" -> true,
    "t5" -> true, "t6" -> true, "t7" -> true, "t8" -> false)
  // spec/friendIntroAge.md teenRosterMaximum.
  pure val TEEN_ROSTER_MAX = 6
  pure val TEEN_OPEN = Set("review", "probing", "scheduled")
  pure val TEEN_FIRST_DAY = 20261121
  pure val TEEN_LAST_DAY = 20261124
  // The booked meeting is two days after the booking day.
  pure val TEEN_MEETING_LEAD = 2
  pure val ADMINS = Set("admin1", "admin2")
  // Staff with the safety role (admin1 has it too).
  pure val SAFETY_STAFF = Set("admin1", "safety1")
  // Staff names, no reviewer (""), and the judge's own reviewer name (REVIEW_JUDGE_REVIEWER, reviewer_reserved).
  pure val STAFF_NAMES = Set("admin1", "admin2", "safety1", "reviewer1")
  pure val JUDGE_NAME = "review_judge"
  pure val REVIEWERS = STAFF_NAMES.union(Set("", JUDGE_NAME))

  pure val TEEN_OPP0: TeenOpp = { stage: "absent", meetingDay: -1, yes: Set(), contacted: Set(), approver: "", held: false, rubric: "", closedReason: "" }
  pure val TEEN0: Teen = {
    stopped: false, audit: [], day: TEEN_FIRST_DAY,
    ready: TEEN_MEMBERS.mapBy(_ => true),
    opps: TEEN_OPPS.mapBy(_ => TEEN_OPP0),
    h: { brokeRule: false, contactWhileOff: false },
  }

  // spec/memberAge.md ageOnDay; spec/friendIntroAge.md teenPartnerAge, birthKeysWithinTwoYears, pairAgeAllowed and
  // groupAgeAllowed (each pair of the roster, self included). minDay is the Clock's day key. maxDay is the latest
  // day key of the meeting end (network.ts rosterAgeAllowed with teenMeetingEnd): a booked item uses the meeting
  // day; an unbooked item uses the end of its window (the plan window, or the proposal window of now + 5 days in
  // network.ts toProposal). ABSTRACTION: the window of an unbooked item is scaled to the next civil day, so that
  // the 4 day keys of a run show the refusal at propose (teenNineteenAtWindowEndTest) and also the sweep. With the
  // code's window, a member who turns 19 before the window end is refused at propose, so the sweep traces of t2
  // and t6 (teenBirthdaySweepTest, teenGroupMemberTurns19Test) stand for that refusal (Q22); they are extra
  // traces of the model, not of the code, and every safety value still holds on them.
  pure def tAge(m: str, dayKey: int): int =
    if (dayKey >= TEEN_BIRTH.get(m)) (dayKey - TEEN_BIRTH.get(m)) / 10000 else -1
  pure def tWithin(x: str, y: str): bool = {
    val bx = TEEN_BIRTH.get(x)
    val by = TEEN_BIRTH.get(y)
    if (bx >= by) bx - by <= 20000 else by - bx <= 20000
  }
  pure def tTeenAges(m: str, minDay: int, maxDay: int): bool = tAge(m, minDay) >= 13 and tAge(m, maxDay) <= 18
  pure def tPair(t: Teen, lane: bool, minDay: int, maxDay: int, x: str, y: str): bool =
    (tAge(x, minDay) >= 18 and tAge(y, minDay) >= 18)
      or (not(t.stopped) and lane and t.ready.get(x) and t.ready.get(y)
          and tTeenAges(x, minDay, maxDay) and tTeenAges(y, minDay, maxDay)
          and (tAge(x, minDay) < 18 or tAge(y, minDay) < 18) and tWithin(x, y))
  pure def tMaxDay(t: Teen, o: str): int =
    if (t.opps.get(o).meetingDay > t.day + 1) t.opps.get(o).meetingDay else t.day + 1
  pure def teenRuleAt(t: Teen, o: str, maxDay: int): bool = {
    val r = TEEN_ROSTER.get(o)
    r.forall(x => r.forall(y => tPair(t, TEEN_FRIENDSHIP.get(o), t.day, maxDay, x, y)))
  }
  pure def teenRuleHolds(t: Teen, o: str): bool = teenRuleAt(t, o, tMaxDay(t, o))
  pure def tRosterHasMinor(t: Teen, o: str): bool = TEEN_ROSTER.get(o).exists(m => tAge(m, t.day) < 18)
  // spec/friendIntroAge.md teenRosterSizeAllowed and teenPlaceAllowed (network.ts teenOppAllowed).
  pure def teenSizeOk(t: Teen, o: str): bool =
    not(tRosterHasMinor(t, o)) or (TEEN_ROSTER.get(o).size() >= 2 and TEEN_ROSTER.get(o).size() <= TEEN_ROSTER_MAX)
  pure def teenPlaceOk(t: Teen, o: str): bool = not(tRosterHasMinor(t, o)) or TEEN_ALL_AGES.get(o)
  pure def teenOppOk(t: Teen, o: str): bool = teenRuleHolds(t, o) and teenSizeOk(t, o) and teenPlaceOk(t, o)
  // spec/teenIntroSwitch.md teenItemContinues and the teen sweep (network.ts teenSweep): every open item whose
  // roster has a minor and fails any part of the rule closes as a whole, with `why` (age_changed, or
  // teen_intros_off at the stop). Nobody is dropped.
  pure def teenSweep(t: Teen, why: str): Teen =
    { ...t, opps: TEEN_OPPS.mapBy(o =>
        if (TEEN_OPEN.contains(t.opps.get(o).stage) and not(teenOppOk(t, o)))
          { ...t.opps.get(o), stage: "closed", closedReason: why }
        else t.opps.get(o)) }
  // A contact (spec 8.2): the ghost flags read the rule and the stop at the moment of the send.
  pure def teenNoteContact(t: Teen, o: str): Teen =
    { ...t, h: { ...t.h,
        brokeRule: t.h.brokeRule or not(teenOppOk(t, o)),
        contactWhileOff: t.h.contactWhileOff or (t.stopped and tRosterHasMinor(t, o)) } }
  pure def putT(s: S, t: Teen): S = { ...s, teen: t }
  pure def tOpp(s: S, o: str): TeenOpp = s.teen.opps.get(o)
  pure def putTO(t: Teen, o: str, x: TeenOpp): Teen = { ...t, opps: t.opps.set(o, x) }

  pure val MEM0: MemSt = {
    optedOut: false, minor: false, forgotten: false, aw: NO_AW, outbound: 0, lastOutProbe: "", initialInvites: Set(),
    onlyWhenAsked: false, noShows: 0
  }

  pure val S0: S = {
    now: 0,
    opps: Map("o1" -> template(Set("a", "b"), Set("c"), "a", "a"),
              "o2" -> template(Set("a", "c"), Set("b"), "a", "")),
    mem: MEMBERS.mapBy(_ => MEM0),
    req: { outcome: "", toldNone: false },
    deferred: Set(), collected: 0, last: L("init", "", "", ""),
    jobs: List(), jobEnv: { openW: Set(), budget: true, lead: 8 }, toDeliver: Set(),
    teen: TEEN0
  }

  // ---------------------------------------------------------------- small helpers
  pure def op(s: S, o: str): OppSt = s.opps.get(o)
  pure def mm(s: S, m: str): MemSt = s.mem.get(m)
  pure def putO(s: S, o: str, x: OppSt): S = { ...s, opps: s.opps.set(o, x) }
  pure def putM(s: S, m: str, x: MemSt): S = { ...s, mem: s.mem.set(m, x) }
  pure def stat(s: S, o: str, m: str): str = op(s, o).status.get(m)
  pure def setStat(s: S, o: str, m: str, v: str): S = putO(s, o, { ...op(s, o), status: op(s, o).status.set(m, v) })
  pure def partsOrdered(s: S, o: str): List[str] = ORDER.select(p => op(s, o).parts.contains(p))
  /** Put jobs on top of the stack: they run first, in list order (a call in the code). */
  pure def push(s: S, js: List[Job]): S = { ...s, jobs: js.concat(s.jobs) }
  pure def clearAwFor(s: S, m: str, o: str): S =
    if (mm(s, m).aw.opp == o and mm(s, m).aw.kind != "none") putM(s, m, { ...mm(s, m), aw: NO_AW }) else s

  // busy: in an open opportunity (other than `except`) and not out of it.
  pure def busy(s: S, m: str, except: str): bool =
    OPPS.exists(o => o != except and OPEN.contains(op(s, o).stage) and op(s, o).parts.contains(m)
      and not(Set("unavailable", "no", "dropped", "out").contains(stat(s, o, m))))

  // eligible(): a member who may be put into an opportunity (not declined, opted out, a minor or busy).
  pure def eligible(s: S, m: str, except: str): bool =
    not(mm(s, m).forgotten) and not(mm(s, m).optedOut) and not(mm(s, m).minor) and not(busy(s, m, except))

  // ---------------------------------------------------------------- the send pipeline
  // The gates of send() in order: checkRecipient (recipientVerdict, spec/recipientEligibility.md), budget, the Blooio streak, timing (recipientTimingAllowed).
  // Messages about other members and recruiting are refused for a minor (spec/outreachPolicy.md). The minor flag here stands
  // for the code's notAdult fact (spec/recipientEligibility.md): a minor, a minor signal or report, or an unknown or conflicting age.
  pure def sendGate(s: S, m: str, kind: str, timing: str, aboutOthers: bool, proactive: bool, env: Env): str = {
    val x = mm(s, m)
    if (x.forgotten or x.optedOut) "refused"
    else if (proactive and x.onlyWhenAsked) "refused"
    else if (aboutOthers and x.minor) "refused"
    else if (proactive and not(env.budget)) "refused"
    else if (timing == "slot" and x.outbound > 1) "refused"          // attention.canInterrupt
    else if (timing == "logistics" and x.outbound > 2) "refused"     // attention.canSendLogistics
    else if (timing != "now" and not(env.openW.contains(m))) "deferred"
    else "sent"
  }

  // The message is collected for the outbound queue in the same unit (runtime.ts: ctx.send only collects).
  pure def collect(s: S, m: str, kind: str, o: str, proactive: bool): S = {
    val x = mm(s, m)
    val invites = if (kind == "probe" and proactive) x.initialInvites.union(Set(o)) else x.initialInvites
    val lastOutProbe = if (kind == "probe" or kind == "times") o else ""
    val s1 = { ...putM(s, m, { ...x, outbound: x.outbound + 1, lastOutProbe: lastOutProbe, initialInvites: invites }), collected: s.collected + 1 }
    if (kind == "probe") putO(s1, o, { ...op(s1, o), probeQ: op(s1, o).probeQ.set(m, "pending") })
    else if (kind == "reveal") putO(s1, o, { ...op(s1, o), revealQ: op(s1, o).revealQ.set(m, "pending") })
    else s1
  }

  pure def pushDef(s: S, kind: str, o: str, m: str): S = { ...s, deferred: s.deferred.union(Set({ kind: kind, opp: o, to: m })) }

  // Ghost: a notice (a cancellation, a release, "none yet") that send() refused. For a member who is still
  // reachable, only the line streak rule refuses it (canSendLogistics): SD-249, skipped.
  pure def noteRefused(s: S, o: str, m: str): S = putO(s, o, { ...op(s, o), noticeRefused: op(s, o).noticeRefused.union(Set(m)) })

  // A notice about o to m through send() with logistics timing: sent (mark it heard), deferred or refused.
  pure def sendNotice(s: S, m: str, kind: str, o: str, env: Env): S = sendNoticeAt(s, m, kind, o, "logistics", env)

  // A cancellation that a minor signal causes goes at once (SendOpts.minorClose): never into `deferred`
  // (spec/opportunityLifecycle.md, "A new minor signal closes an opportunity involving that person").
  pure def noticeTiming(minorClose: bool): str = if (minorClose) "now" else "logistics"

  pure def sendNoticeAt(s: S, m: str, kind: str, o: str, timing: str, env: Env): S = {
    val r = sendGate(s, m, kind, timing, false, false, env)
    if (r == "sent") {
      val s1 = collect(s, m, kind, o, false)
      if (kind == "none_yet" or kind == "release") putO(s1, o, { ...op(s1, o), released: op(s1, o).released.union(Set(m)) })
      else putO(s1, o, { ...op(s1, o), cancelHeard: op(s1, o).cancelHeard.union(Set(m)) })
    }
    else if (r == "deferred") pushDef(s, kind, o, m)
    else noteRefused(s, o, m)
  }

  // owedAnswer (SD-043): the yes or no this member still owes, other than on `except`: a probe that
  // went out and was not answered (first), or a booked plan they were told about and did not confirm.
  pure def owedAnswer(s: S, m: str, except: str): Aw = {
    val pr = OPP_ORDER.select(o => o != except and op(s, o).stage == "probing" and op(s, o).told.contains(m) and stat(s, o, m) == "probing")
    if (pr.length() > 0) { kind: "probe", opp: pr[0], at: op(s, pr[0]).sentAt.get(m), clarified: false, timeChoice: false }
    else {
      val bk = OPP_ORDER.select(o => o != except and op(s, o).stage == "scheduled" and stat(s, o, m) == "yes"
        and op(s, o).bookedTold.contains(m) and not(op(s, o).confirmed.contains(m)))
      if (bk.length() > 0) { kind: "booked", opp: bk[0], at: op(s, bk[0]).bookedAt.get(m), clarified: false, timeChoice: false } else NO_AW
    }
  }

  // probe (SD-043 and SD-077): the probe waits while the member owes an answer on another
  // probe, or (when they owe nothing else) while "How did it go?" waits for their answer.
  pure def probeOwed(s: S, m: str, o: str): bool = {
    val owedOn = owedAnswer(s, m, o)
    if (owedOn.kind != "none") owedOn.kind == "probe" else mm(s, m).aw.kind == "feedback"
  }

  // expect: a pending probe or booked plan is never replaced by another kind.
  pure def expectSlot(s: S, m: str, aw: Aw): S = {
    val cur = mm(s, m).aw.kind
    if ((cur == "probe" or cur == "booked") and aw.kind != "probe" and aw.kind != "booked") s
    else putM(s, m, { ...mm(s, m), aw: aw })
  }

  // ---------------------------------------------------------------- close, a job
  pure def close(s: S, o: str, reason: str, env: Env): S = {
    val x = op(s, o)
    if (TERMINAL.contains(x.stage) or x.stage == "absent") s
    else {
      val wasReview = x.stage == "review"
      val wasProbing = x.stage == "probing" or wasReview
      val s1 = putO(s, o, { ...x, closedFrom: x.stage, closedReason: reason, stage: "closed", everTerminal: true })
      // Participants: clear their slot for this opportunity; tell the ones who said yes, when it was booked.
      // SD-263: a yes to a probe that is not booked yet is released too, except the requester
      // (the request path tells them). The requester's own close of a standing thing (close() with closedBy,
      // spec/opportunityLifecycle.md releasesOnRequesterClose, owner decision 2026-11-22) releases each contacted
      // member who said yes; this branch releases on every close in probing (known drift, see the header). On a close for the minors policy in probing, each other member who got a
      // probe and said yes hears it at once; the minor does not (spec/opportunityLifecycle.md, minorCloseTellsAcceptor).
      val s2 = partsOrdered(s1, o).foldl(s1, (acc, p) => {
        val a1 = clearAwFor(acc, p, o)
        if (mm(a1, p).forgotten) a1
        else if (not(wasProbing) and stat(a1, o, p) == "yes" and reason != "blocked")
          sendNoticeAt(a1, p, "declined_quiet", o, noticeTiming(reason == "minors policy"), env)
        else if (wasProbing and p != x.requester and x.contacted.contains(p) and stat(a1, o, p) == "available"
                 and reason != "blocked" and reason != "minors policy") sendNotice(a1, p, "release", o, env)
        else if (x.stage == "probing" and reason == "minors policy" and p != x.requester and x.contacted.contains(p)
                 and stat(a1, o, p) == "available" and not(mm(a1, p).minor))
          sendNoticeAt(a1, p, "release", o, noticeTiming(true), env)
        else a1
      })
      // The member request: a request still probing goes back to waiting.
      val req = x.requester
      val s3 = if (req != "" and s2.req.outcome == "probing") {
        val rm = mm(s2, req)
        val tell = not(rm.optedOut) and reason != "requester unavailable" and stat(s2, o, req) != "no"
        if (not(tell)) { ...s2, req: { ...s2.req, outcome: "none" } }
        else if (s2.req.toldNone) { ...s2, req: { ...s2.req, outcome: "none" } }
        else {
          // tellNoneYet: told once (again only on a repeat ask, SD-266; the model has no repeat ask).
          sendNotice({ ...s2, req: { outcome: "none", toldNone: true } }, req, "none_yet", o, env)
        }
      } else s2
      // The interaction record: "declined" only for reason "declined".
      val rec = if (wasReview) "" else if (reason == "declined") "declined" else if (wasProbing) "expired" else "cancelled"
      putO(s3, o, { ...op(s3, o), outcomeRec: rec })
    }
  }

  // ---------------------------------------------------------------- probe turns (advanceProbes)
  // Turn order only. The probe itself is the probeSend action (see the header).
  pure def advanceTurns(s: S, o: str): S = {
    val x = op(s, o)
    if (x.stage != "probing") s
    else {
      val first = if (x.parts.contains(x.first)) x.first else partsOrdered(s, o)[0]
      val s1 = putO(s, o, { ...x, first: first })
      val firstIn = stat(s1, o, first) == "available"
      partsOrdered(s1, o).foldl(s1, (acc, p) => {
        val st = stat(acc, o, p)
        if (st != "queued") acc
        else if (p != first and not(firstIn)) acc
        else putO(acc, o, { ...op(acc, o), status: op(acc, o).status.set(p, "probing"), turnAt: op(acc, o).turnAt.set(p, acc.now) })
      })
    }
  }

  // ---------------------------------------------------------------- replaceOrClose, a job
  // With one alternate the replacement cannot reveal at once: the alternate starts "queued".
  // SD-048: the member who is out loses a slot that points at this opportunity.
  pure def replaceOrClose(s0: S, o: str, out: str): S = {
    val s = if (op(s0, o).stage == "probing") clearAwFor(s0, out, o) else s0
    val x = op(s, o)
    if (x.stage != "probing") s
    else if (x.requester == out) push(s, [J("close", o, "", "requester unavailable")])
    else {
      val stay = x.parts.exclude(Set(out))
      val cands = ORDER.select(a => x.alts.contains(a) and eligible(s, a, o))
      if (cands.length() > 0) {
        val alt = cands[0]
        // network.ts replaceOrClose (owner decision 2026-11-22, D15 to D17; spec/probeDispatch.md replacementJudged):
        // only a roster that the approval covered; another roster closes the item.
        if (not(x.review.judgedRosters.contains(stay.union(Set(alt))))) push(s, [J("close", o, "", "replacement_not_judged")])
        else {
        // spec/probeDispatch.md, "A replacement keeps a requester's yes and asks again every other member who heard about the earlier roster":
        // a probe that waits for its answer or has still to go out, and a yes after a probe, are about the earlier
        // roster: the member goes back to the queue and gets a new probe in their turn (roster revision, abstracted
        // here as `told` and `askedAgain`). `contacted` stays: it records who heard the time and place (minors rule).
        // When the first participant is out or asked again, the first turn goes to a member asked again.
        // Owner decision 2026-11-23: the requester's yes carries over (no name went out before the reveal).
        val heard = stay.filter(p => x.status.get(p) == "probing" or (x.status.get(p) == "available" and x.told.contains(p) and p != x.requester))
        val reasked = heard.filter(p => x.told.contains(p))
        val yeses = heard.filter(p => x.status.get(p) == "available")
        val s1 = putO(heard.fold(s, (acc, p) => clearAwFor(acc, p, o)), o, { ...x, alts: Set(), parts: stay.union(Set(alt)),
                              first: if (x.first == out) (if (reasked != Set()) ORDER.select(p => reasked.contains(p))[0] else alt) else x.first,
                              status: heard.fold(x.status.set(out, "out").set(alt, "queued"), (st, p) => st.set(p, "queued")),
                              told: x.told.exclude(heard).exclude(Set(out)), askedAgain: x.askedAgain.union(yeses) })
        advanceTurns(s1, o)
        }
      } else push(putO(s, o, { ...x, alts: Set() }), [J("close", o, "", "no one available")])
    }
  }

  // ---------------------------------------------------------------- handleDrop, a job
  pure def handleDrop(s: S, m: str, o: str, ack: bool, minorClose: bool, env: Env): S = {
    val x0 = op(s, o)
    val s1 = putO(s, o, { ...x0, status: x0.status.set(m, "dropped"), droppedBy: x0.droppedBy.union(Set(m)) })
    val s2 = if (ack) collect(s1, m, "reply", o, false) else s1
    val s3 = clearAwFor(s2, m, o)
    val still = partsOrdered(s3, o).select(p => stat(s3, o, p) == "yes")
    // Only members who were told about the plan hear that it changed. The drop_notice hook has no
    // onRefused (SD-249, skipped); it carries the meeting time (SD-248).
    // network.ts: a group stays on only with 3 or more still going ("two who are left said yes to a
    // group, not to a meeting of two"). A pair: keep is false, so the opportunity closes on handleDrop's own
    // path, closeBooking (not close()). A minor who leaves closes the booking whatever its size: the adults do
    // not meet at a time and place a minor was told (spec/opportunityLifecycle.md, bookedGroupCanContinue).
    val keep = not(minorClose) and still.length() >= 3
    if (keep) tellStill(s3, o, minorClose, env)
    else closeBooking(s3, o, if (minorClose) "minors policy" else "participant dropped", minorClose, env)
  }

  /**
   * The members still going whom the booked plan reached hear that it changed. At a minor signal a
   * member still going whom the booked plan did not reach yet hears it too: the signal removed their queued
   * booked plan (withoutMinorQueue), and they said yes (closeBooking, network.ts).
   */
  pure def tellStill(s: S, o: str, minorClose: bool, env: Env): S =
    partsOrdered(s, o).select(p => stat(s, o, p) == "yes").foldl(s, (acc, p) =>
      if (not(minorClose) and not(op(acc, o).bookedTold.contains(p))) acc else sendNoticeAt(acc, p, "drop_notice", o, noticeTiming(minorClose), env))

  /**
   * closeBooking (network.ts): a booked opportunity closes; the members still going whom the booked plan reached
   * (at a minor signal, every member still going) hear it is off (drop notices, never why). handleDrop uses it, and so does a minor signal from a member on the
   * booked roster who is not going or who was asked and replaced. The reason is "minors policy" for a minor signal.
   */
  pure def closeBooking(s3: S, o: str, reason: str, minorClose: bool, env: Env): S = {
    val s4 = tellStill(s3, o, minorClose, env)
    val s5 = putO(s4, o, { ...op(s4, o), closedFrom: op(s4, o).stage, closedReason: reason, stage: "closed", everTerminal: true })
    val released = partsOrdered(s5, o).foldl(s5, (acc, p) => clearAwFor(acc, p, o))
    // SD-139: the requester still says yes (another member called it off): the request waits again.
    val x5 = op(released, o)
    if (x5.requester != "" and stat(released, o, x5.requester) == "yes" and released.req.outcome == "booked") { ...released, req: { ...released.req, outcome: "none" } }
    else released
  }
  pure def dropJob(o: str, m: str, ack: bool): Job = { ...J("drop", o, m, ""), ack: ack }

  // ---------------------------------------------------------------- reveal
  pure def onSentReveal(s: S, o: str, m: str): S = {
    val s1 = expectSlot(s, m, { kind: "booked", opp: o, at: s.now, clarified: false, timeChoice: false })
    val x = op(s1, o)
    putO(s1, o, { ...x, bookedTold: x.bookedTold.union(Set(m)), bookedAt: x.bookedAt.set(m, s1.now),
                  revealSent: x.revealSent.union(Set(m)), wasTold: x.wasTold.union(Set(m)) })
  }

  /** The reveal to one participant (a job): the reveal fold's step in reveal. */
  pure def sendReveal(s: S, o: str, p: str, env: Env): S =
    if (op(s, o).stage != "scheduled" or stat(s, o, p) != "yes") s
    else {
      val r = sendGate(s, p, "reveal", "logistics", true, false, env)
      if (r == "sent") onSentReveal(collect(s, p, "reveal", o, false), o, p)
      else if (r == "deferred") pushDef(s, "reveal", o, p)
      else push(s, [dropJob(o, p, false)]) // the reveal hook's onRefused
    }

  pure def reveal(s: S, o: str, env: Env): S = {
    // Send-time re-check: reachable, about the others, and room on the Blooio streak.
    val bad = partsOrdered(s, o).select(p => {
      val x = mm(s, p)
      x.forgotten or x.optedOut or x.minor or x.outbound > 2
    })
    if (bad.length() > 0) push(setStat(s, o, bad[0], "unavailable"), [J("replace", o, bad[0], "")])
    else {
      val x = op(s, o)
      val s1 = putO(s, o, { ...x, stage: "scheduled", meetingAt: s.now + env.lead,
                            status: x.status.keys().mapBy(k => if (x.parts.contains(k)) "yes" else x.status.get(k)) })
      val s2 = if (x.requester != "") { ...s1, req: { ...s1.req, outcome: "booked" } } else s1
      push(s2, partsOrdered(s2, o).foldl(List(), (l, p) => l.append(J("reveal", o, p, ""))))
    }
  }

  /** advanceProbes, a job: the turn order, then the reveal once every participant said yes. */
  pure def advanceProbes(s0: S, o: str, env: Env): S = {
    val s = advanceTurns(s0, o)
    if (op(s, o).stage == "probing" and op(s, o).parts.forall(p => stat(s, o, p) == "available")
        and op(s, o).parts.intersect(op(s, o).askedAgain) == Set()) reveal(s, o, env) else s
  }

  // ---------------------------------------------------------------- dropMember, the hub
  // dropMember runs one job for each opportunity, in the code's order.
  pure def dropMember(s: S, m: str, reason: str): S = push(s, [J("dm", "o1", m, reason), J("dm", "o2", m, reason)])

  /** The step of dropMember for one opportunity (a job). */
  pure def dropMemberIn(acc0: S, o: str, m: str, reason: str): S = {
    val minorReason = reason == "minors policy"
    // network.ts dropMember: for the minors policy, every opportunity whose time and place the minor heard
    // (minorKnows: `contacted`; the model has no crews and no plan chain) gets the mark, finished ones included.
    val acc = if (minorReason and op(acc0, o).contacted.contains(m)) putO(acc0, o, { ...op(acc0, o), minorKnew: true }) else acc0
    val x = op(acc, o)
    if (not(OPEN.contains(x.stage))) acc
    else {
      val wasAlternate = minorReason and x.alts.contains(m)
      val a1 = putO(acc, o, { ...x, alts: x.alts.exclude(Set(m)) })
      if (wasAlternate and not(x.parts.contains(m)) and x.stage != "scheduled") push(a1, [J("close", o, "", reason)])
      // A minor who was asked and then replaced is still on the roster: the open item closes, booked or not
      // (spec/opportunityLifecycle.md, closesForMinor). A booking closes on closeBooking. In the code, a member asked
      // about an earlier plan whose time and place this item keeps counts as contacted (network.ts minorKnows).
      else if (minorReason and x.contacted.contains(m) and not(x.parts.contains(m)))
        push(a1, [J(if (x.stage == "scheduled") "closeBooking" else "close", o, "", reason)])
      else if (not(x.parts.contains(m))) a1
      else if (minorReason and x.stage != "scheduled") push(a1, [J("close", o, "", reason)])
      else if (x.stage == "review") push(a1, [J("close", o, "", reason)])
      else if (x.stage == "probing") push(setStat(a1, o, m, "unavailable"), [J("replace", o, m, "")])
      // SD-047: only a member who is going ("yes") leaves a booked meeting.
      else if (stat(a1, o, m) == "yes") push(a1, [{ ...dropJob(o, m, false), why: reason }])
      // A minor on the booked roster who is not going still closes it (closesForMinor: participant), on closeBooking.
      else if (minorReason) push(a1, [J("closeBooking", o, "", reason)])
      else a1
    }
  }

  // The Slop history projects only the exact named pair. The queue is the oracle for valid original
  // receipts, so delivered reveals are distinct from collected reveals and anonymous probes.
  pure def observeSlopIntroductions(s: S): S =
    OPPS.fold(s, (acc, o) => {
      val x = op(acc, o)
      if (x.firstIntroduction or x.parts.size() != 2 or x.review.decision != "approve"
        or not(x.stage == "scheduled" or x.stage == "done" or x.closedFrom == "scheduled")
        or not(x.parts.forall(p => x.revealQ.get(p) == "delivered"))) acc
      else putO(acc, o, { ...x, firstIntroduction: true })
    })

  // heardFrom: any inbound resets the pause rules. The queue releases messages held for an answer
  // (outbound-queue.ts).
  pure def unhold(q: str): str = if (q == "held") "pending" else q
  pure def heardFrom(s: S, m: str): S = {
    val x = mm(s, m)
    val s1 = putM(observeSlopIntroductions(s), m, { ...x, initialInvites: Set(), outbound: 0, onlyWhenAsked: false })
    OPP_ORDER.foldl(s1, (acc, o) => putO(acc, o, { ...op(acc, o),
      probeQ: op(acc, o).probeQ.set(m, unhold(op(acc, o).probeQ.get(m))),
      revealQ: op(acc, o).revealQ.set(m, unhold(op(acc, o).revealQ.get(m))) }))
  }

  // ---------------------------------------------------------------- readers (oracles, fixed per intent)
  // parseProbeReply with time options (classify.ts) merged by the probe branch.
  // A bare "counter" ("how about next week instead?") is "unclear" (consentOf, classify.ts, SD-041); a
  // counter with a yes word ("sounds fun! how about next week") is a yes with no time, the same reading as
  // "yes_other_times". "Saturday was great" is a qualified time reference and stays unclear, even
  // with a model yes. "I couldn't make it" reads no in this historical oracle.
  // A rejection of time options on an untimed probe is qualified unclear. A relative time or
  // duration with no independent offered choice is also qualified unclear. The probe stays open.
  // "ok" -> yes, unclear after two of our messages in a row, and unclear when another message
  // followed the unclarified probe: the "ok" or "Thanks! 👍" answers that message, not the probe.
  pure def readProbe(intent: str, outboundBefore: int, answersOther: bool, timeChoice: bool): str =
    if (intent == "offered_time_choice") "yes_chosen"
    else if (intent == "yes_other_times") "yes_none"
    else if (Set("no", "cancel", "fb_self_noshow", "direct_withdrawal").contains(intent)) "no"
    else if (timeChoice) "unclear"
    else if (Set("yes", "fb_good").contains(intent)) "yes_all"
    else if (intent == "ack") (if (outboundBefore >= 2 or answersOther) "unclear" else "yes_all")
    else "unclear"

  // yesNoOf / consentOf (classify.ts): yes, no, counter or unclear.
  pure def readYesNo(intent: str): str =
    if (Set("yes", "fb_good", "ack").contains(intent)) "yes"
    else if (Set("no", "cancel", "fb_self_noshow", "direct_withdrawal").contains(intent)) "no"
    else "unclear"

  // ---------------------------------------------------------------- onProbeAnswer
  // SD-075 and SD-076: a no also takes back a yes that is not booked yet ("available").
  pure def onProbeAnswer(s: S, m: str, o: str, yes: bool, nonePicked: bool, intent: str, env: Env): S = {
    val x = op(s, o)
    if (x.stage != "probing" or not(stat(s, o, m) == "probing" or (not(yes) and stat(s, o, m) == "available"))) s
    else {
      val retry = x.timeRetry.contains(m)
      if (yes) {
        val x1 = { ...x, status: x.status.set(m, "available"), accepted: x.accepted.set(m, intent), askedAgain: x.askedAgain.exclude(Set(m)) }
        if (nonePicked and not(retry)) {
          // "Yes, but none of those": other times, once (a reply; the times hook sets awaiting probe).
          val s1 = putO(s, o, { ...x1, timeRetry: x1.timeRetry.union(Set(m)), status: x1.status.set(m, "probing"), sentAt: x1.sentAt.set(m, s.now) })
          val s2 = collect(s1, m, "times", o, false)
          putM(s2, m, { ...mm(s2, m), aw: { kind: "probe", opp: o, at: s2.now, clarified: false, timeChoice: false } })
        } else push(collect(putO(s, o, x1), m, "reply", o, false), [J("probes", o, "", "")])
      } else {
        val s1 = putO(s, o, { ...x, status: x.status.set(m, "unavailable"), saidNo: x.saidNo.union(Set(m)), askedAgain: x.askedAgain.exclude(Set(m)) })
        push(collect(s1, m, "reply", o, false), [J("replace", o, m, ""), J("probes", o, "", "")])
      }
    }
  }

  pure def confirmPlan(s: S, o: str, m: str, silent: bool): S = {
    val x = op(s, o)
    if (x.status.get(m) != "yes" or x.bookedAt.get(m) < 0 or x.confirmed.contains(m)) s
    else putO(s, o, { ...x, confirmed: x.confirmed.union(Set(m)), silent: if (silent) x.silent.union(Set(m)) else x.silent })
  }

  pure def feedbackDue(s: S, m: str): str = {
    val due = OPP_NEWEST.select(o => op(s, o).stage == "done" and stat(s, o, m) == "yes" and not(op(s, o).feedbackFrom.contains(m))
      and op(s, o).meetingAt <= s.now and s.now - op(s, o).meetingAt < FEEDBACK_DUE)
    if (due.length() > 0) due[0] else ""
  }

  // onFeedback: the post-meeting answer; a self no-show counts on the member, unless
  // finalize already counted it (SD-328).
  pure def onFeedback(s: S, m: str, o: str, intent: str): S = {
    val x = op(s, o)
    val post = if (intent == "fb_self_noshow") "self_noshow" else if (intent == "fb_other_noshow") "came_other" else "came"
    val count = post == "self_noshow" and not(x.noShowCounted.contains(m))
    val s1 = putO(s, o, { ...x, feedbackFrom: x.feedbackFrom.union(Set(m)), post: x.post.set(m, post),
                          noShowCount: if (count) x.noShowCount.set(m, x.noShowCount.get(m) + 1) else x.noShowCount })
    collect(s1, m, "reply", o, false)
  }

  // ---------------------------------------------------------------- handleInbound routing
  pure def route(s: S, m: str, intent: str, outboundBefore: int, env: Env): S = {
    val aw = mm(s, m).aw
    val yn = readYesNo(intent)
    if (intent == "job_post") {
      // peon: postingTurn (jobs.ts) reads the post back and sets awaiting "posting" with no expect.
      putM(s, m, { ...mm(s, m), aw: { kind: "posting", opp: "", at: s.now, clarified: false, timeChoice: false } })
    } else if (aw.kind == "posting") {
      // The manager's yes or no to the read-back ends the draft. SD-043: the slot goes back to a
      // probe or booked plan that still waits for this member's answer.
      putM(s, m, { ...mm(s, m), aw: owedAnswer(s, m, "") })
    } else {
      // The probe branch.
      val pr = readProbe(intent, outboundBefore, aw.kind == "probe" and not(aw.clarified) and mm(s, m).lastOutProbe != aw.opp, aw.timeChoice)
      val probeDone = aw.kind == "probe" and pr != "unclear"
      val clarifyTime = intent == "timed_slot_ambiguity"
      val clarifyNow = aw.kind == "probe" and pr == "unclear"
        and (if (clarifyTime) not(aw.timeChoice) else not(aw.clarified))
        and not(Set("cancel", "fb_other_noshow", "fb_self_noshow").contains(intent))
      if (probeDone) {
        val s1 = putM(s, m, { ...mm(s, m), aw: NO_AW })
        onProbeAnswer(s1, m, aw.opp, pr != "no", pr == "yes_none", intent, env)
      } else if (clarifyNow) {
        collect(putM(s, m, { ...mm(s, m), aw: { ...aw, clarified: true, timeChoice: clarifyTime } }), m, "reply", aw.opp, false)
      } else if (aw.kind == "booked" and op(s, aw.opp).stage == "scheduled" and stat(s, aw.opp, m) == "yes" and (intent == "cancel" or yn == "no" or intent == "swap_and_attendance")) {
        push(putM(s, m, { ...mm(s, m), aw: NO_AW }), [dropJob(aw.opp, m, true)])
      } else if (aw.kind == "booked" and (yn == "yes" or intent == "ack")) {
        val s1 = putM(s, m, { ...mm(s, m), aw: NO_AW })
        collect(if (op(s1, aw.opp).stage == "scheduled") confirmPlan(s1, aw.opp, m, false) else s1, m, "reply", aw.opp, false)
      } else {
        // A cancel with no slot: the first scheduled opportunity where the member is "yes".
        val sched = OPP_ORDER.select(o => op(s, o).stage == "scheduled" and stat(s, o, m) == "yes")
        // SD-075 and SD-076: with no slot, "no" or a cancel takes back a yes to a probe that is
        // not booked yet.
        val held = OPP_ORDER.select(o => op(s, o).stage == "probing" and op(s, o).told.contains(m) and stat(s, o, m) == "available")
        if (intent == "cancel" and sched.length() > 0) push(s, [dropJob(sched[0], m, true)])
        else if (aw.kind == "none" and (intent == "cancel" or yn == "no") and held.length() > 0)
          onProbeAnswer(s, m, held[0], false, false, intent, env)
        else {
          val fbKind = Set("fb_good", "fb_other_noshow", "fb_self_noshow").contains(intent)
          if ((aw.kind == "feedback" and intent != "ack") or fbKind) {
            val o = if (aw.kind == "feedback") aw.opp else feedbackDue(s, m)
            if (o != "") onFeedback(if (aw.timeChoice) s else putM(s, m, { ...mm(s, m), aw: NO_AW }), m, o, intent) else s
          } else s
        }
      }
    }
  }

  // ---------------------------------------------------------------- the tick
  pure def defValid(s: S, d: Def): bool = {
    val x = op(s, d.opp)
    if (d.kind == "reveal") x.stage == "scheduled" and x.status.get(d.to) == "yes" and s.now < x.meetingAt
    // SD-248: the drop notice carries the meeting time, so it stays valid after forget deletes the item.
    else if (d.kind == "drop_notice") s.now < x.meetingAt
    else true
  }

  /**
   * deliverDeferred for one deferred send `d` (a job). The tick took the deferred sends out of
   * `deferred` into `toDeliver`; a send that must wait again goes back into `deferred`. The next deliver job
   * runs after the drop that a refused reveal starts, as in the code's loop.
   */
  pure def deliverOne(acc0: S, d: Def, env: Env): S = {
    val acc1 = { ...acc0, toDeliver: acc0.toDeliver.exclude(Set(d)) }
    val acc = if (acc1.toDeliver != Set()) push(acc1, [J("deliver", "", "", "")]) else acc1
    if (mm(acc, d.to).forgotten) acc
    else if (not(defValid(acc, d))) acc // dropped, no onRefused
    else if (not(env.openW.contains(d.to))) pushDef(acc, d.kind, d.opp, d.to)
    else {
      val about = d.kind == "reveal" or d.kind == "feedback"
      if (not(about)) sendNotice(acc, d.to, d.kind, d.opp, env)
      else {
        val r = sendGate(acc, d.to, d.kind, "logistics", about, false, env)
        if (r == "sent") {
          val a1 = collect(acc, d.to, d.kind, d.opp, false)
          if (d.kind == "reveal") onSentReveal(a1, d.opp, d.to)
          else expectSlot(a1, d.to, { kind: "feedback", opp: d.opp, at: a1.now, clarified: false, timeChoice: false })
        }
        else if (r == "deferred") pushDef(acc, d.kind, d.opp, d.to)
        else if (d.kind == "reveal" and op(acc, d.opp).stage == "scheduled" and stat(acc, d.opp, d.to) == "yes") push(acc, [dropJob(d.opp, d.to, false)])
        else acc
      }
    }
  }

  // F28. spec/outreachPolicy.md unansweredInviteCounts and network.ts refreshUnanswered.
  pure def unansweredInvitations(s: S, m: str): Set[str] = mm(s, m).initialInvites.filter(o => {
    val x = op(s, o)
    val acceptedAt = x.probeAcceptedAt.get(m)
    val expiredAt = x.sentAt.get(m) + PROBE_TTL
    x.probeQ.get(m) == "delivered" and 0 <= acceptedAt and acceptedAt <= s.now and
      ((x.expiredSilent.contains(m) and acceptedAt <= expiredAt and expiredAt <= s.now) or s.now - acceptedAt >= UNANSWERED_AFTER)
  })

  pure def refreshMemberUnanswered(s: S, m: str): S = {
    val x = mm(s, m)
    val pending = x.initialInvites.filter(o => op(s, o).probeQ.get(m) != "refused")
    putM(s, m, { ...x, initialInvites: pending,
      onlyWhenAsked: x.onlyWhenAsked or unansweredInvitations(s, m).size() >= UNANSWERED_LIMIT })
  }

  pure def refreshUnanswered(s: S): S =
    MEMBERS.fold(s, (acc, m) => refreshMemberUnanswered(acc, m))

  pure def finalize(s: S, o: str): S = {
    val x = op(s, o)
    val going = partsOrdered(s, o).select(p => x.status.get(p) == "yes" and x.bookedAt.get(p) >= 0)
    def said(p: str): bool = x.post.get(p) != ""
    def vouched(p: str): bool = going.select(q => q != p and x.post.get(q) == "came").length() > 0
    def present(p: str): bool = x.post.get(p) == "came" or x.post.get(p) == "came_other" or (x.post.get(p) != "self_noshow" and vouched(p))
    def reported(p: str): bool = going.select(q => q != p and x.post.get(q) == "came_other").length() > 0
    // a reported no-show who did not answer counts once here, and is marked counted (SD-328).
    val counted = going.select(p => not(present(p)) and not(said(p)) and reported(p))
    val nsc = counted.foldl(x.noShowCount, (acc, p) => acc.set(p, acc.get(p) + 1))
    val s1 = putO(s, o, { ...x, finalized: true, noShowCount: nsc,
                          noShowCounted: counted.foldl(x.noShowCounted, (acc, p) => acc.union(Set(p))) })
    if (x.requester != "" and present(x.requester) and going.select(p => p != x.requester and present(p)).length() > 0
        and s1.req.outcome != "fulfilled") { ...s1, req: { ...s1.req, outcome: "fulfilled" } }
    else s1
  }

  /** advance's probe silence for one participant (a job): the step of the loop over the participants. */
  pure def expireProbe(acc: S, o: str, p: str): S = {
    val y = op(acc, o)
    if (y.stage != "probing" or y.status.get(p) != "probing") acc
    else {
      val due = if (y.told.contains(p)) y.sentAt.get(p) + PROBE_TTL else y.turnAt.get(p) + PROBE_WAIT
      if (acc.now < due) acc
      // they said yes and were offered other times: no answer keeps the yes. The slot that
      // points at this item ends first (SD-076).
      else if (y.timeRetry.contains(p)) setStat(clearAwFor(acc, p, o), o, p, "available")
      else {
        val a1 = if (y.told.contains(p)) putO(acc, o, { ...y, expiredSilent: y.expiredSilent.union(Set(p)) }) else acc
        val a2 = refreshMemberUnanswered(a1, p)
        push(setStat(clearAwFor(a2, p, o), o, p, "unavailable"), [J("replace", o, p, "")])
      }
    }
  }

  /** advance for one opportunity (a job). The probing loop is one job for each participant, then advanceProbes. */
  pure def advance(s: S, o: str, env: Env): S = {
    val x = op(s, o)
    if (x.stage == "review" and s.now >= x.review.deadline) {
      // Missed its SLA: expires instead of being sent late (PRD 32.8).
      push(putO(s, o, { ...x, review: { ...x.review, decision: "expired", decidedAt: s.now } }), [J("close", o, "", "review expired")])
    } else if (x.stage == "probing") {
      push(s, partsOrdered(s, o).foldl(List(), (l, p) => l.append(J("exp", o, p, ""))).append(J("probes", o, "", "")))
    } else if (x.stage == "scheduled") {
      // Silence for 48 hours after the booked plan reached them (or the start) confirms it.
      val s1 = ORDER.foldl(s, (acc, p) => {
        val y = op(acc, o)
        if (y.bookedTold.contains(p) and y.bookedAt.get(p) >= 0 and (acc.now - y.bookedAt.get(p) >= OPT_OUT_HOURS or acc.now >= y.meetingAt))
          confirmPlan(acc, o, p, true) else acc
      })
      // Reminders: inside the member's allowed window in the day before the meeting. The
      // window oracle stands for "at T-4h, or the last allowed tick before it".
      val s1r = partsOrdered(s1, o).foldl(s1, (acc, p) => {
        val y = op(acc, o)
        if (y.status.get(p) != "yes" or y.reminded.contains(p) or acc.now >= y.meetingAt or acc.now < y.meetingAt - 24 or not(env.openW.contains(p))) acc
        else {
          val a1 = putO(acc, o, { ...y, reminded: y.reminded.union(Set(p)) })
          if (sendGate(a1, p, "reminder", "logistics", true, false, env) == "sent") collect(a1, p, "reminder", o, false) else a1
        }
      })
      val y = op(s1r, o)
      if (y.feedbackSent or s1r.now < y.meetingAt + FEEDBACK_AFTER) s1r
      else {
        val s2 = putO(s1r, o, { ...y, feedbackSent: true, stage: "done", everTerminal: true })
        partsOrdered(s2, o).foldl(s2, (acc, p) =>
          if (stat(acc, o, p) != "yes") acc
          else {
            val r = sendGate(acc, p, "feedback", "logistics", true, false, env)
            if (r == "sent") expectSlot(collect(acc, p, "feedback", o, false), p, { kind: "feedback", opp: o, at: acc.now, clarified: false, timeChoice: false })
            else if (r == "deferred") pushDef(acc, "feedback", o, p)
            else acc
          })
      }
    } else if (x.stage == "done" and not(x.finalized)) {
      val going = partsOrdered(s, o).select(p => x.status.get(p) == "yes")
      if (s.now >= x.meetingAt + FINALIZE_AFTER or going.foldl(true, (b, p) => b and x.post.get(p) != "")) finalize(s, o) else s
    } else s
  }

  pure def expireSlots(s: S): S =
    MEMBERS.fold(s, (acc, m) => {
      val aw = mm(acc, m).aw
      val end = if (aw.kind == "booked") acc.now - aw.at > OPT_OUT_HOURS or acc.now >= op(acc, aw.opp).meetingAt
                else aw.kind != "probe" and aw.kind != "none" and acc.now - aw.at > SLOT_EXPIRY
      if (end) putM(acc, m, { ...mm(acc, m), aw: NO_AW }) else acc
    })

  // ================================================================ state and actions
  var s: S

  action init = s' = S0

  // The stack of jobs is empty: no unit is running (see the header).
  pure def idleIn(x: S): bool = x.jobs.length() == 0
  val idle: bool = idleIn(s)

  // newOpp + submit: every opportunity goes to review first. The engine and the request
  // search propose only eligible members (eligible, busy).
  action submit(o: str): bool = {
    val x = op(s, o)
    all {
      idle,
      x.stage == "absent",
      x.parts.forall(p => eligible(s, p, o)),
      x.requester == "" or s.req.outcome == "" or s.req.outcome == "none",
      val alts = x.alts.filter(a => eligible(s, a, o))
      val s1 = putO(s, o, { ...x, stage: "review", alts: alts,
                            status: x.status.keys().mapBy(k => if (x.parts.contains(k)) "queued" else "out"),
                            review: { ...x.review, deadline: s.now + REVIEW_SLA, phase: "awaiting" } })
      val s2 = if (x.requester != "") { ...s1, req: { ...s1.req, outcome: "probing" } } else s1
      s' = { ...s2, last: L("submit", o, "", "") },
    }
  }

  // reviewBlock (SD-009): every decision is refused once the clock reached the item's review
  // deadline, also before the tick that expires it.
  pure def reviewOpen(s: S, o: str): bool =
    op(s, o).stage == "review" and op(s, o).review.decision == "" and s.now < op(s, o).review.deadline

  // The rosters an approval covers (reviewPacket rosters): the base roster and each single swap of a member who is
  // not the requester for an alternate.
  pure def rostersOf(x: OppSt): Set[Set[str]] =
    x.alts.fold(Set(x.parts), (acc, a) => acc.union(x.parts.filter(p => p != x.requester).map(p => x.parts.exclude(Set(p)).union(Set(a)))))

  // An approval starts the probes, unless a member is no longer eligible (approvalCheck): then the item closes.
  pure def approveBy(s: S, o: str, approver: str, rosters: Set[Set[str]]): S = {
    val x = op(s, o)
    val s1 = putO(s, o, { ...x, review: { ...x.review, decision: "approve", decidedAt: s.now, phase: "decided", approver: approver, judgedRosters: rosters } })
    val bad = x.parts.exists(p => not(eligible(s1, p, o)))
    if (bad) push(putO(s1, o, { ...op(s1, o), review: { ...op(s1, o).review, invalidated: true } }), [J("close", o, "", "invalidated")])
    else push(putO(s1, o, { ...op(s1, o), stage: "probing",
                status: x.status.keys().mapBy(k => if (x.parts.contains(k)) "queued" else "out") }), [J("probes", o, "", "")])
  }

  // recordJudgment (spec/automatedReview.md recordJudgment; owner decision 2026-11-22, D15 to D17): the judgment
  // for the open revision. A judgment for a changed packet changes nothing (judgment_stale_packet). Failed gates
  // (reviewBlock: a minor or a forgotten member; approvalCheck: a member who is not eligible) close the item with
  // no approval (review_invalidated). "approve" approves with the judge as approver and the packet's rosters;
  // any other verdict ("flag", "undecided", "cannot_run", also the tick's judge_overdue) holds it for staff.
  action judgeRecord(o: str, verdict: str, packetCurrent: bool, env: Env): bool = {
    val x = op(s, o)
    all {
      idle,
      reviewOpen(s, o), x.review.phase == "awaiting",
      val gatesPass = x.parts.forall(p => not(mm(s, p).minor) and not(mm(s, p).forgotten) and eligible(s, p, o))
      val s2 =
        if (not(packetCurrent)) s
        else if (not(gatesPass)) push(putO(s, o, { ...x, review: { ...x.review, phase: "decided", invalidated: true } }), [J("close", o, "", "invalidated")])
        else if (verdict == "approve") approveBy(s, o, "judge", rostersOf(x))
        else putO(s, o, { ...x, review: { ...x.review, phase: "held", held: true } })
      s' = { ...s2, last: L("judge", o, "", verdict), jobEnv: env },
    }
  }

  // decide(approve) by a named staff member, only for an item the judge held (not_held_for_staff),
  // after reviewBlock. network.ts decide stores no judgedRosters.
  action staffApprove(o: str, env: Env): bool = {
    val x = op(s, o)
    all {
      idle,
      reviewOpen(s, o), x.review.phase == "held",
      x.parts.forall(p => not(mm(s, p).minor) and not(mm(s, p).forgotten)), // reviewBlock refuses otherwise
      s' = { ...approveBy(s, o, "staff", Set()), last: L("approve", o, "", "staff"), jobEnv: env },
    }
  }

  // decide(reject): staff reject any open item, awaiting the judge or held.
  action reject(o: str, env: Env): bool = {
    val x = op(s, o)
    all {
      idle,
      reviewOpen(s, o),
      s' = { ...push(putO(s, o, { ...x, review: { ...x.review, decision: "reject", decidedAt: s.now, phase: "decided" } }), [J("close", o, "", "rejected in review")]),
             last: L("reject", o, "", ""), jobEnv: env },
    }
  }

  // stopApproved (canStopApproved): staff stop an approved item before its reveal (stage probing); it closes.
  action stopApproved(o: str, env: Env): bool = {
    val x = op(s, o)
    all {
      idle,
      x.review.decision == "approve", not(x.review.invalidated), x.review.phase == "decided", x.stage == "probing",
      s' = { ...push(putO(s, o, { ...x, review: { ...x.review, phase: "stopped" } }), [J("close", o, "", "stopped by staff")]),
             last: L("stop", o, "", ""), jobEnv: env },
    }
  }

  // probe at a moment the member's send window is open and nothing else waits for their answer
  // (probeOwed, SD-043 and SD-077). send() with noDefer and the probe hook: onSent sets awaiting with no
  // expect(); onRefused replaces or closes.
  action probeSend(o: str, m: str, env: Env): bool = {
    val x = op(s, o)
    all {
      idle,
      x.stage == "probing", x.parts.contains(m), x.status.get(m) == "probing", not(x.told.contains(m)),
      env.openW.contains(m), not(probeOwed(s, m, o)),
      val invite = x.requester != m
      val checked = if (invite) refreshMemberUnanswered(s, m) else s
      val r = sendGate(checked, m, "probe", if (invite) "slot" else "logistics", true, invite, env)
      val s2 = if (r == "sent") {
                 val s1 = collect(checked, m, "probe", o, invite)
                 val y = op(s1, o)
                 putM(putO(s1, o, { ...y, contacted: y.contacted.union(Set(m)), told: y.told.union(Set(m)), sentAt: y.sentAt.set(m, s1.now) }), m,
                      { ...mm(s1, m), aw: { kind: "probe", opp: o, at: s1.now, clarified: false, timeChoice: false } })
               } else push(setStat(checked, o, m, "unavailable"), [J("replace", o, m, ""), J("probes", o, "", "")])
      s' = { ...s2, last: L("probeSend", o, m, r), jobEnv: env },
    }
  }

  // An inbound text from the member (onInbound, handleInbound).
  action answer(m: str, intent: str, env: Env): bool = {
    val x = mm(s, m)
    all {
      idle,
      not(x.forgotten), not(x.optedOut),
      // A post-meeting answer ("it was great", "he never showed") comes only from a member who had a meeting.
      Set("fb_good", "fb_other_noshow", "fb_self_noshow").contains(intent)
        implies OPPS.exists(o => op(s, o).feedbackSent and op(s, o).status.get(m) == "yes"),
      val before = x.outbound
      val s1 = heardFrom(s, m)
      // Ghost: what the member means. A no or a cancel takes back an earlier yes (status "available" while
      // the opportunity still probes), and asks to leave a booked plan.
      val s2 = OPP_ORDER.foldl(s1, (acc, o) => {
        val y = op(acc, o)
        if (not(Set("no", "cancel").contains(intent))) acc
        else if (y.stage == "probing" and y.status.get(m) == "available") putO(acc, o, { ...y, withdrawn: y.withdrawn.union(Set(m)) })
        else if (y.stage == "scheduled" and y.status.get(m) == "yes") putO(acc, o, { ...y, cancelAsked: y.cancelAsked.union(Set(m)) })
        else acc
      })
      s' = { ...route(s2, m, intent, before, env), last: L("answer", "", m, intent), jobEnv: env },
    }
  }

  // STOP: heardFrom first, then dropMember.
  action stop(m: str, env: Env): bool = all {
    idle,
    not(mm(s, m).forgotten), not(mm(s, m).optedOut),
    val s1 = heardFrom(s, m)
    s' = { ...dropMember(putM(s1, m, { ...mm(s1, m), optedOut: true }), m, "opted out"), last: L("stop", "", m, ""), jobEnv: env },
  }

  // START.
  action start(m: str): bool = all {
    idle,
    not(mm(s, m).forgotten), mm(s, m).optedOut,
    val s1 = heardFrom(s, m)
    s' = { ...collect(putM(s1, m, { ...mm(s1, m), optedOut: false }), m, "reply", "", false), last: L("start", "", m, "") },
  }

  // A minor signal or a record age under 18 (syncMember): minor, then dropMember. First the
  // deferred sends about an opportunity the minor was on, an alternate for or asked about, whatever its stage,
  // leave the queue: a cancellation (a release, a quiet decline, a drop notice) that is still valid goes now,
  // and a reveal or a feedback request never goes. "None yet" names no opportunity in the code (no proposalId)
  // and stays (spec/opportunityLifecycle.md, "A new minor signal closes an opportunity involving that person").
  pure def minorInvolved(s: S, o: str, m: str): bool =
    o != "" and (op(s, o).parts.contains(m) or op(s, o).alts.contains(m) or op(s, o).contacted.contains(m))
  pure def withoutMinorQueue(s: S, m: str, env: Env): S = {
    val queued = s.deferred.filter(d => d.kind != "none_yet" and minorInvolved(s, d.opp, m))
    queued.fold({ ...s, deferred: s.deferred.exclude(queued) }, (acc, d) =>
      if (Set("release", "declined_quiet", "drop_notice").contains(d.kind) and not(mm(acc, d.to).forgotten) and defValid(acc, d))
        sendNoticeAt(acc, d.to, d.kind, d.opp, noticeTiming(true), env)
      else acc)
  }

  action becomeMinor(m: str, env: Env): bool = all {
    idle,
    not(mm(s, m).forgotten), not(mm(s, m).minor),
    s' = { ...dropMember(withoutMinorQueue(putM(s, m, { ...mm(s, m), minor: true }), m, env), m, "minors policy"), last: L("minor", "", m, ""), jobEnv: env },
  }

  // Leave the app or delete (service forget -> Network.forget): declined, requests gone, dropMember,
  // then every opportunity that names the member is deleted (forgetRest, a job after dropMember's jobs).
  action forget(m: str, env: Env): bool = all {
    idle,
    not(mm(s, m).forgotten),
    val s1 = putM(s, m, { ...mm(s, m), forgotten: true })
    val s2 = if (m == "a") { ...s1, req: { outcome: "", toldNone: false } } else s1
    s' = { ...dropMember(push(s2, [J("forgetRest", "", m, "")]), m, "declined"), last: L("forget", "", m, ""), jobEnv: env },
  }

  // declineUnderMinAge (network.ts): a stated age under the join age. It is a minor signal: the minors-policy drop
  // runs first, then forget (its dropMember with "declined", then forgetRest). Abstraction: `forgotten` is set
  // when the unit starts; the code adds the id to declinedIds only in forget, but the minors-policy jobs send
  // nothing to the minor (handleDrop without ack, closeBooking and close tell only the others).
  action declineUnderAge(m: str, env: Env): bool = all {
    idle,
    not(mm(s, m).forgotten),
    val s1 = withoutMinorQueue(putM(s, m, { ...mm(s, m), minor: true }), m, env)
    val s2 = putM(s1, m, { ...mm(s1, m), forgotten: true })
    val s3 = if (m == "a") { ...s2, req: { outcome: "", toldNone: false } } else s2
    s' = { ...dropMember(dropMember(push(s3, [J("forgetRest", "", m, "")]), m, "declined"), m, "minors policy"),
           last: L("decline", "", m, ""), jobEnv: env },
  }

  /** The rest of forget after dropMember (a job). */
  pure def forgetRest(s3: S, m: str): S = {
    val s4 = OPP_ORDER.foldl(s3, (acc, o) => {
      val y = op(acc, o)
      if (y.stage != "absent" and (y.parts.contains(m) or y.requester == m)) putO(acc, o, { ...y, stage: "gone", firstIntroduction: false, everTerminal: true })
      else putO(acc, o, { ...y, alts: y.alts.exclude(Set(m)) })
    })
    // slots on a deleted opportunity end; the member state goes; deferred sends to them, or about
    // them (reveal and feedback carry `about`), go. A drop notice has no `about` and stays.
    val s5 = MEMBERS.fold(s4, (acc, p) => {
      val aw = mm(acc, p).aw
      if (p == m or (aw.kind != "none" and aw.opp != "" and op(acc, aw.opp).stage == "gone")) putM(acc, p, { ...mm(acc, p), aw: NO_AW }) else acc
    })
    { ...s5, deferred: s5.deferred.filter(d => d.to != m and not((d.kind == "reveal" or d.kind == "feedback") and op(s5, d.opp).parts.contains(m))) }
  }

  // SD-146 (not reproduced): the meeting time is one of the first member's time options, which leave out
  // quiet hours, and the partner only picks from those (chooseTimeOptions, MIN_NOTICE 6 h, PARTNER_LEAD
  // 12 h). So a member whose reveal or drop notice waits for quiet hours is in their send window at some
  // tick before the meeting. The model's ticks jump up to 49 hours, so this is a constraint on the clock:
  // no clock move passes the meeting of a deferred send that is valid only until the meeting (a reveal, a
  // drop notice), and the last tick before it has that member's window open.
  pure def untilMeeting(s: S, d: Def): bool = (d.kind == "reveal" or d.kind == "drop_notice") and defValid(s, d)
  pure def deferredInTime(s: S, dt: int, env: Env): bool =
    s.deferred.forall(d => not(untilMeeting(s, d)) or {
      val at = op(s, d.opp).meetingAt
      s.now + dt < at and (s.now + dt + 1 >= at implies env.openW.contains(d.to))
    })

  // The clock moves between two ticks: units read clock.now(), and withTickLock skips a tick while another
  // holder has the lock (runtime.ts). Review expiry runs only in a tick.
  action elapse(dt: int): bool = all {
    idle,
    s.deferred.forall(d => not(untilMeeting(s, d)) or s.now + dt + 1 < op(s, d.opp).meetingAt),
    s' = { ...s, now: s.now + dt, last: { act: "elapse", o: "", m: "", x: "", dt: dt } },
  }

  // The service tick under the lock: refreshUnanswered, deliverDeferred, advance for each
  // opportunity, then the slots that ended. Each part is a job.
  action tick(dt: int, env: Env): bool = all {
    idle,
    deferredInTime(s, dt, env),
    val s1 = { ...s, now: s.now + dt, toDeliver: s.deferred, deferred: Set() }
    s' = { ...push(s1, [J("refresh", "", "", ""), J("deliver", "", "", ""), J("adv", "o1", "", ""), J("adv", "o2", "", ""), J("expire", "", "", "")]),
           last: { act: "tick", o: "", m: "", x: "", dt: dt }, jobEnv: env },
  }

  // The outbound queue (packages/blooio/src/outbound-queue.ts) decides a collected probe or reveal later:
  // sent, held for an answer (the line's unanswered cap) or refused. The other messages are read by
  // no invariant.
  action queueDecideAt(kind: str, o: str, m: str, q: str, acceptedAt: int): bool = {
    val x = op(s, o)
    all {
      idle,
      (if (kind == "probe") x.probeQ.get(m) else x.revealQ.get(m)) == "pending",
      (kind == "probe" and q == "delivered") implies x.sentAt.get(m) <= acceptedAt and acceptedAt <= s.now,
      val y = if (kind == "probe") { ...x, probeQ: x.probeQ.set(m, q),
        probeAcceptedAt: if (q == "delivered") x.probeAcceptedAt.set(m, acceptedAt) else x.probeAcceptedAt }
        else { ...x, revealQ: x.revealQ.set(m, q) }
      s' = { ...putO(s, o, y), last: L("queue", kind, m, q) },
    }
  }
  action queueDecide(kind: str, o: str, m: str, q: str): bool = queueDecideAt(kind, o, m, q, s.now)

  // ---------------------------------------------------------------- the jobs
  // Each job action takes the job on top of the stack and runs it with the unit's oracles.
  def job: Job = s.jobs.head()
  def popped: S = { ...s, jobs: s.jobs.tail() }
  def jobIs(kind: str): bool = s.jobs.length() > 0 and s.jobs.head().kind == kind

  action runClose = all { jobIs("close"), s' = close(popped, job.o, job.why, s.jobEnv) }
  action runCloseBooking = all { jobIs("closeBooking"), s' = closeBooking(popped, job.o, job.why, job.why == "minors policy", s.jobEnv) }
  action runReplace = all { jobIs("replace"), s' = replaceOrClose(popped, job.o, job.m) }
  action runProbes = all { jobIs("probes"), s' = advanceProbes(popped, job.o, s.jobEnv) }
  action runReveal = all { jobIs("reveal"), s' = sendReveal(popped, job.o, job.m, s.jobEnv) }
  action runDrop = all { jobIs("drop"), s' = handleDrop(popped, job.m, job.o, job.ack, job.why == "minors policy", s.jobEnv) }
  action runDm = all { jobIs("dm"), s' = dropMemberIn(popped, job.o, job.m, job.why) }
  action runForgetRest = all { jobIs("forgetRest"), s' = forgetRest(popped, job.m) }
  action runDeliver = all {
    jobIs("deliver"),
    if (s.toDeliver == Set()) s' = popped
    else { nondet d = s.toDeliver.oneOf() s' = deliverOne(popped, d, s.jobEnv) },
  }
  action runRefresh = all { jobIs("refresh"), s' = refreshUnanswered(observeSlopIntroductions(popped)) }
  action runAdv = all { jobIs("adv"), s' = advance(popped, job.o, s.jobEnv) }
  action runExp = all { jobIs("exp"), s' = expireProbe(popped, job.o, job.m) }
  action runExpire = all { jobIs("expire"), s' = expireSlots(popped) }

  action runJob = any {
    runClose, runCloseBooking, runReplace, runProbes, runReveal, runDrop, runDm, runForgetRest, runDeliver, runRefresh, runAdv,
    runExp, runExpire,
  }

  // ================================================================ teen friend introductions (actions)
  // Owner decision 2026-11-22. The teen items are their own small part of the state (`s.teen`): the actions
  // read and write only it, and the pair path above is unchanged. Each action is one unit (idle).
  // spec/teenIntroSwitch.md: teen introductions are on from the start. One admin or safety staff member stops
  // them: every open item with a minor closes (teen_intros_off) with a notice that names nobody. One admin turns
  // them on again (the key teenStop is deleted). Each step writes one audit row. Abstraction: the model takes a
  // stop only while on and a resume only while stopped, so that the audit list stays short.
  action teenStop(actor: str): bool = all {
    idle, ADMINS.union(SAFETY_STAFF).contains(actor), not(s.teen.stopped),
    s' = putT(s, teenSweep({ ...s.teen, stopped: true, audit: s.teen.audit.append({ by: actor, on: false }) }, "teen_intros_off")),
  }
  action teenResume(actor: str): bool = all {
    idle, ADMINS.contains(actor), s.teen.stopped,
    s' = putT(s, { ...s.teen, stopped: false, audit: s.teen.audit.append({ by: actor, on: true }) }),
  }
  // P9: a proposal enters review only when the rule, the size and the place hold for its roster.
  action teenPropose(o: str): bool = all {
    idle, tOpp(s, o).stage == "absent", teenOppOk(s.teen, o),
    s' = putT(s, putTO(s.teen, o, { ...tOpp(s, o), stage: "review" })),
  }
  // P10 and network.ts recordJudgment (owner decision 2026-11-22, D16): the review judge decides a teen item with
  // the strict rubric (spec/automatedReview.md reviewRubric, spec/teenIntroSwitch.md lawTeenRosterIsJudgedStrictly);
  // the rule holds at approval. An approval sends the anonymous probe to the first member (a contact); any other
  // verdict holds the item for staff.
  action teenJudge(o: str, approve: bool): bool = {
    val x = tOpp(s, o)
    all {
      idle, x.stage == "review", not(x.held), teenOppOk(s.teen, o),
      val rubric = if (tRosterHasMinor(s.teen, o)) "minor" else "adult"
      s' = if (approve) putT(s, teenNoteContact(putTO(s.teen, o, { ...x, stage: "probing", approver: "judge", rubric: rubric, contacted: Set(TEEN_FIRST.get(o)) }), o))
           else putT(s, putTO(s.teen, o, { ...x, held: true, rubric: rubric })),
    }
  }
  // network.ts decide (D17): a named staff member approves a held teen item (reviewer_required, reviewer_reserved,
  // not_held_for_staff otherwise); the rule holds at approval.
  action teenStaffApprove(o: str, reviewer: str): bool = {
    val x = tOpp(s, o)
    all {
      idle, x.stage == "review", x.held, STAFF_NAMES.contains(reviewer), teenOppOk(s.teen, o),
      s' = putT(s, teenNoteContact(putTO(s.teen, o, { ...x, stage: "probing", approver: "staff", contacted: Set(TEEN_FIRST.get(o)) }), o)),
    }
  }
  // P12 and P15: a yes. The rule runs before each contact; when it fails the item closes (age_changed). The
  // last yes books the meeting TEEN_MEETING_LEAD days later only when the rule holds up to the meeting day
  // (maxDay = the meeting day); otherwise the item closes with no common time (closeNoCommonTime).
  action teenYes(o: str, m: str): bool = {
    val x = tOpp(s, o)
    val roster = TEEN_ROSTER.get(o)
    val yes2 = x.yes.union(Set(m))
    val meet = s.teen.day + TEEN_MEETING_LEAD
    all {
      idle, x.stage == "probing", x.contacted.contains(m), not(x.yes.contains(m)),
      if (not(teenOppOk(s.teen, o)))
        s' = putT(s, putTO(s.teen, o, { ...x, stage: "closed", closedReason: "age_changed" }))
      else if (yes2 != roster)
        s' = putT(s, teenNoteContact(putTO(s.teen, o, { ...x, yes: yes2, contacted: roster }), o))
      else if (teenRuleAt(s.teen, o, meet))
        s' = putT(s, teenNoteContact(putTO(s.teen, o, { ...x, yes: yes2, stage: "scheduled", meetingDay: meet }), o))
      else
        s' = putT(s, putTO(s.teen, o, { ...x, yes: yes2, stage: "closed", closedReason: "no_common_time" })),
    }
  }
  action teenNo(o: str, m: str): bool = all {
    idle, TEEN_OPEN.contains(tOpp(s, o).stage), tOpp(s, o).contacted.contains(m),
    s' = putT(s, putTO(s.teen, o, { ...tOpp(s, o), stage: "closed", closedReason: "declined" })),
  }
  action teenMeet(o: str): bool = all {
    idle, tOpp(s, o).stage == "scheduled", s.teen.day >= tOpp(s, o).meetingDay,
    s' = putT(s, putTO(s.teen, o, { ...tOpp(s, o), stage: "done" })),
  }
  // The Clock reaches the next day key: ages rise on the birthday, and the tick's teen sweep closes every
  // open item that the rule no longer allows (network.ts teenSweep in every tick).
  action teenNextDay: bool = all {
    idle, s.teen.day < TEEN_LAST_DAY,
    s' = putT(s, teenSweep({ ...s.teen, day: s.teen.day + 1 }, "age_changed")),
  }
  // A minor or older-than-stated report, an open minor signal, a conflict or a bar ends readiness at once
  // (contract 7.3), and the sweep closes the member's teen items.
  action teenReadyLost(m: str): bool = all {
    idle, s.teen.ready.get(m),
    s' = putT(s, teenSweep({ ...s.teen, ready: s.teen.ready.set(m, false) }, "age_changed")),
  }
  // The destructive teen steps take a roll, as in `step`, so that random traces also reach the booking.
  action teenStep(roll: int): bool = {
    nondet o = oneOf(TEEN_OPPS)
    nondet m = oneOf(TEEN_MEMBERS)
    nondet actor = oneOf(REVIEWERS)
    any {
      all { roll == 6, teenStop(actor) },
      teenResume(actor),
      teenPropose(o), teenJudge(o, roll != 9), teenStaffApprove(o, actor), teenYes(o, m),
      all { roll == 7, teenNo(o, m) },
      teenMeet(o),
      all { roll <= 4, teenNextDay },
      all { roll == 8, teenReadyLost(m) },
    }
  }

  // The scheduler. Destructive actions (reject, STOP, a minor signal, a leave, a clock jump with no tick)
  // take a roll so that the random simulation also reaches the long consent path; every behaviour stays
  // reachable. The send window is often open for everyone, and the intro budget is rarely spent. While a
  // unit runs, only its jobs are enabled.
  action step = {
    nondet roll = oneOf(0.to(9))
    nondet wide = oneOf(Set(true, false))
    nondet someW = oneOf(powerset(MEMBERS))
    nondet lead = oneOf(Set(8, 30))
    val env: Env = { openW: if (wide) MEMBERS else someW, budget: roll != 5, lead: lead }
    nondet o = oneOf(OPPS)
    nondet m = oneOf(MEMBERS)
    nondet intent = oneOf(INTENTS)
    nondet dt = oneOf(Set(1, 6, 13, 27, 49))
    nondet kind = oneOf(Set("probe", "reveal"))
    nondet q = oneOf(Set("delivered", "held", "refused"))
    nondet yesFirst = oneOf(Set(true, false))
    any {
      runJob,
      submit(o),
      judgeRecord(o, if (roll == 8) "flag" else "approve", roll != 9, env),
      staffApprove(o, env),
      all { roll == 0, reject(o, env) },
      all { roll == 0, stopApproved(o, env) },
      probeSend(o, m, env),
      // Half of the answers are a plain "yes", so that random traces reach the reveal.
      answer(m, if (yesFirst) "yes" else intent, env),
      all { roll == 1, stop(m, env) },
      start(m),
      // A minor signal in half as many draws as the other life events (weights only: the reachable states do not
      // change). Since a minor who was asked and then replaced closes the item (network.ts), a minor signal
      // in one roll of 10 closes the member request before it is held in almost every trace (witness_requestFulfilled).
      // An under-age decline is a minor signal too: it shares becomeMinor's roll, so the two together keep that rate.
      all { roll == 2, wide, becomeMinor(m, env) },
      all { roll == 2, wide, declineUnderAge(m, env) },
      all { roll == 3, forget(m, env) },
      tick(dt, env),
      all { roll == 4, elapse(dt) },
      queueDecideAt(kind, o, m, q, if (roll == 4) op(s, o).sentAt.get(m) else s.now),
      teenStep(roll),
    }
  }

  // ================================================================ safety
  // Each invariant names the rule it comes from. A defect it showed is named with its register id and the
  // fix commit. Invariants that still fail on a defect that was skipped are in `knownOpen`, not in `safety`.

  // AGENTS.md (code invariants, owner decision 2026-11-22, D15 to D17): every opportunity gets one recorded
  // approval, by the review judge or by staff for a held item, before any member is contacted. begin() has two
  // caller chains, recordJudgment and decide().
  val contactNeedsRecordedApproval = OPPS.forall(o => {
    val x = op(s, o)
    (Set("probing", "scheduled", "done").contains(x.stage) or x.contacted != Set())
      implies (x.review.decision == "approve" and not(x.review.invalidated) and Set("judge", "staff").contains(x.review.approver))
  })
  // spec/automatedReview.md stepHeldItemNeedsStaff: a held item is approved only by staff, and staff approve only
  // a held item.
  val heldItemNeedsStaff = OPPS.forall(o => {
    val r = op(s, o).review
    and { r.approver == "judge" implies not(r.held), r.approver == "staff" implies r.held }
  })

  // PRD 32.8 and docs/network.md 2: an item that missed its SLA expires; "it is never sent late".
  // SD-009, fixed in c06f633: reviewBlock() refuses every decision at or after the deadline.
  val decidedBeforeDeadline = OPPS.forall(o => {
    val x = op(s, o)
    x.review.decision == "approve" implies x.review.decidedAt < x.review.deadline
  })

  // AGENTS.md decision 11: only answer "yes" is consent; a counter is not a yes. PRD consent flow: names
  // go out only after every member said yes, and a member can take a yes back before the reveal.
  // SD-041 (113a369: a bare counter is unclear), SD-075 and SD-076 (791ff6a: a later no takes the yes
  // back), SD-077 (6d8d2d3: the probe waits while "How did it go?" is open).
  val namesAfterAllYes = OPPS.forall(o => {
    val x = op(s, o)
    x.revealSent != Set() implies x.parts.forall(p => CONSENT.contains(x.accepted.get(p)) and not(x.withdrawn.contains(p)))
  })

  // AGENTS.md decision 11: a counter-offer (or an answer to another question) never makes a member
  // "available" (the yes-hold). SD-041 (113a369), SD-077 (6d8d2d3).
  val counterIsNotYes = OPPS.forall(o => {
    val x = op(s, o)
    x.stage == "probing" implies x.parts.forall(p =>
      (x.status.get(p) == "available" and x.told.contains(p)) implies CONSENT.contains(x.accepted.get(p)))
  })

  // The slot routes the consent reply, so it is consent state. A probe slot points at a probe that
  // waits for this member. SD-048 (73d1e2b: replaceOrClose clears the slot of the member who is out) and the
  // time-retry expiry that kept it (791ff6a, SD-076).
  val slotOwnerAlive = MEMBERS.forall(m => {
    val aw = mm(s, m).aw
    aw.kind == "probe" implies (op(s, aw.opp).stage == "probing" and op(s, aw.opp).parts.contains(m)
      and op(s, aw.opp).status.get(m) == "probing")
  })

  // Code comment on expect: "can't this week" must reach the probe. While a probe waits for the
  // member's answer, the slot points at it, or the job-post read-back holds the slot and gives it back when
  // the post is saved or dropped (owedAnswer). SD-043, fixed in 74602b1 (it was lost before).
  val noLostAnswer = OPPS.forall(o => {
    val x = op(s, o)
    x.stage == "probing" implies x.parts.forall(p =>
      (x.status.get(p) == "probing" and x.told.contains(p)) implies
        ((mm(s, p).aw.kind == "probe" and mm(s, p).aw.opp == o) or mm(s, p).aw.kind == "posting"))
  })

  // core/policy.ts and the owner decision of 2026-11-22: a, b and c become minors only by a minor signal or a
  // record age under 18, which never leaves a member teen ready (spec/friendIntroAge.md teenReady), so under
  // teenFriendAgeRule such a member is in no open item and is no alternate of one. The unit that sees the minor
  // signal or record runs the drop, so the next unit of any kind (tick, inbound, staff decision, judgment) starts
  // from this state; the model keeps no older copy of a member record. The teen part below has the allowed teen items.
  val minorNever = MEMBERS.forall(m => mm(s, m).minor implies OPPS.forall(o =>
    OPEN.contains(op(s, o).stage) implies and {
      not(Set("queued", "probing", "available", "yes").contains(op(s, o).status.get(m))),
      not(op(s, o).alts.contains(m)),
    }))

  // spec/opportunityLifecycle.md, "A new minor signal closes an opportunity involving that person": no booking
  // stays on when a member on its roster or asked about it is a minor, whatever the size of the group.
  val minorEndsBooking = MEMBERS.forall(m => mm(s, m).minor implies OPPS.forall(o =>
    op(s, o).stage == "scheduled" implies not(op(s, o).parts.contains(m) or op(s, o).contacted.contains(m))))

  // spec/opportunityLifecycle.md, "A minor signal ends the recurring plans that the minor knows": every
  // opportunity whose time and place a minor heard carries the mark that recurrenceAllowed reads (minorWasTold).
  val minorKnewMarked = MEMBERS.forall(m => mm(s, m).minor implies OPPS.forall(o =>
    op(s, o).contacted.contains(m) implies op(s, o).minorKnew))

  // AGENTS.md STOP: an opted-out member is out of everything open (dropMember).
  val stopWins = MEMBERS.forall(m => mm(s, m).optedOut implies OPPS.forall(o =>
    OPEN.contains(op(s, o).stage) implies not(Set("queued", "probing", "available", "yes").contains(op(s, o).status.get(m)))))

  // closed and done are terminal (gone: deleted by forget).
  val terminalStable = OPPS.forall(o => op(s, o).everTerminal implies TERMINAL.contains(op(s, o).stage))

  // Request comment: "booked": a meeting is set. SD-139, fixed in 6e500fa: when another member calls
  // the meeting off, the request waits again. When the requester calls it off, the request stays "booked";
  // that is no stuck request, as a new ask opens a new request (openRequest skips "booked"). The same
  // holds after the meeting time (done; "fulfilled" needs the requester there): the meeting was set. When the
  // partner then leaves the app, forget deletes the done item and clears the request's oppId;
  // the meeting was still set (feedbackSent stays on the deleted item in the model).
  val requestNotStuck = s.req.outcome == "booked" implies
    (Set("scheduled", "done").contains(op(s, "o1").stage) or op(s, "o1").droppedBy.contains("a")
      or (op(s, "o1").stage == "gone" and op(s, "o1").feedbackSent))

  // PRD F11 and the drop notice: when a booked plan is off, the others who were told hear it is off.
  // SD-248, fixed in c29646e: the drop notice carries the meeting time and is sent after a leave or delete.
  // A notice the line streak rule refused (noticeRefused) is SD-249 (skipped, see noticeNeverRefused).
  val cancelReachesTold = OPPS.forall(o => {
    val x = op(s, o)
    (Set("closed", "gone").contains(x.stage) and x.closedFrom == "scheduled") implies x.wasTold.forall(m =>
      x.droppedBy.contains(m) or mm(s, m).forgotten or mm(s, m).optedOut or x.cancelHeard.contains(m)
      or x.noticeRefused.contains(m)
      or s.deferred.exists(d => d.opp == o and d.to == m and (d.kind == "drop_notice" or d.kind == "declined_quiet") and defValid(s, d)))
  })

  // PRD F29: "Partial acceptances are released politely". SD-263, fixed in 791f698: close() releases a
  // member whose yes was not booked yet. The code sends no release on a close for the minors policy (no
  // message about an item with a minor), so that close is exempt. A member who left, opted out or is a minor
  // gets no release; a release the streak rule refused is SD-249 (noticeNeverRefused).
  val partialAcceptReleased = OPPS.forall(o => {
    val x = op(s, o)
    (x.stage == "closed" and x.closedFrom == "probing" and x.closedReason != "minors policy") implies x.parts.forall(p =>
      (x.status.get(p) == "available" and CONSENT.contains(x.accepted.get(p)) and not(mm(s, p).forgotten) and not(mm(s, p).optedOut)
        and not(mm(s, p).minor) and not(x.noticeRefused.contains(p)))
        implies (x.released.contains(p) or s.deferred.exists(d => d.opp == o and d.to == p and (d.kind == "none_yet" or d.kind == "release"))))
  })

  // network-consent-17: a reported no-show counts once. SD-328, fixed in 25b54f1: finalize marks the members
  // it counted, and a late self no-show answer does not count them again.
  val noShowOnce = OPPS.forall(o => MEMBERS.forall(m => op(s, o).noShowCount.get(m) <= 1))

  // everyone said yes, so the plan is booked and each member is told once. SD-146 was not
  // reproduced: with the clock constraint deferredInTime (the meeting time is in the member's send window),
  // a deferred reveal always reaches the member before the meeting.
  val bookedMembersTold = OPPS.forall(o => {
    val x = op(s, o)
    (x.stage == "scheduled" and s.now >= x.meetingAt) implies x.parts.forall(p => x.status.get(p) == "yes" implies x.bookedTold.contains(p))
  })

  run swapWithdrawalKeepsBookedMeetingTest =
    bookO1(30).then(answer("a", "swap_only", ALL_OPEN)).then(settled)
      .expect(op(s, "o1").stage == "scheduled" and op(s, "o1").cancelHeard == Set())
      .then(answer("a", "swap_and_attendance", ALL_OPEN)).then(settled)
      .expect(op(s, "o1").stage == "closed" and op(s, "o1").cancelHeard == Set("b") and safety)

  // SD-139. A terminal drop clears each member's booked slot before another reply can use it.
  val bookedSlotAlive = MEMBERS.forall(m => {
    val aw = mm(s, m).aw
    aw.kind == "booked" implies op(s, aw.opp).stage == "scheduled"
  })

  // An automatic pause always has two distinct confirmed invitations that have matured.
  val pauseNeedsUnansweredInvitations = MEMBERS.forall(m =>
    mm(s, m).onlyWhenAsked implies unansweredInvitations(s, m).size() >= UNANSWERED_LIMIT)

  // Owner decision 2026-11-22 (spec/friendIntroAge.md teenFriendAgeRule): every open teen item passes the rule
  // now and up to its meeting day (the sweep closes the others in the same unit), and no contact went out
  // while the rule failed.
  val teenFriendAgeRule = TEEN_OPPS.forall(o => TEEN_OPEN.contains(tOpp(s, o).stage) implies teenRuleHolds(s.teen, o))
    and not(s.teen.h.brokeRule)
  // While teen introductions are stopped the old rule holds: no open item has a minor, and no minor was
  // contacted while they were stopped.
  val teenSwitchOffNoMinor = (s.teen.stopped implies TEEN_OPPS.forall(o =>
      TEEN_OPEN.contains(tOpp(s, o).stage) implies not(tRosterHasMinor(s.teen, o))))
    and not(s.teen.h.contactWhileOff)
  // spec/teenIntroSwitch.md lawTeenRosterIsJudgedStrictly: a teen item that passed review was approved by the
  // judge with the strict rubric, or by staff after the judge held it.
  val teenRosterIsJudgedStrictly = TEEN_OPPS.forall(o =>
    (Set("probing", "scheduled", "done").contains(tOpp(s, o).stage) and tRosterHasMinor(s.teen, o)) implies
      ((tOpp(s, o).approver == "judge" and tOpp(s, o).rubric == "minor") or (tOpp(s, o).approver == "staff" and tOpp(s, o).held)))
  // spec/friendIntroAge.md teenRosterSizeAllowed: an open item with a minor has 2 to 6 people.
  val teenGroupSmall = TEEN_OPPS.forall(o => (TEEN_OPEN.contains(tOpp(s, o).stage) and tRosterHasMinor(s.teen, o)) implies
    (TEEN_ROSTER.get(o).size() >= 2 and TEEN_ROSTER.get(o).size() <= TEEN_ROSTER_MAX))
  // spec/friendIntroAge.md groupAgeAllowed and teenPlaceAllowed: an open group with a minor passes the rule for
  // every pair and meets at an all-ages place.
  val teenGroupRule = TEEN_OPPS.forall(o => (TEEN_OPEN.contains(tOpp(s, o).stage) and tRosterHasMinor(s.teen, o)) implies
    (teenRuleHolds(s.teen, o) and TEEN_ALL_AGES.get(o)))
  // Only an admin resumes; an admin or a safety staff member stops.
  val teenAuditByStaffRole = s.teen.audit.foldl(true, (b, r) => b and (if (r.on) ADMINS.contains(r.by) else ADMINS.union(SAFETY_STAFF).contains(r.by)))
  // Nobody who is 19 or more on the latest civil date is in an open item with a minor, and an item in a lane
  // that is not a friendship lane never opens with a minor.
  val teenNeverNineteenOrOtherLane = TEEN_OPPS.forall(o =>
    (TEEN_OPEN.contains(tOpp(s, o).stage) and tRosterHasMinor(s.teen, o)) implies
      (TEEN_FRIENDSHIP.get(o) and TEEN_ROSTER.get(o).forall(m => tAge(m, s.teen.day + 1) <= 18)))

  val slopIntroductionNeedsTwoReceipts = OPPS.forall(o => {
    val x = op(s, o)
    x.firstIntroduction implies
      (x.parts.size() == 2 and x.review.decision == "approve" and x.parts.forall(p => x.revealQ.get(p) == "delivered"))
  })

  val slotClarificationStaysOnProbe = MEMBERS.forall(m => {
    val aw = mm(s, m).aw
    aw.timeChoice implies (aw.kind == "probe" and aw.clarified)
  })

  // The invariants hold between two units (`idle`); inside a unit, jobs are still to run.
  val safety = idle implies and {
    contactNeedsRecordedApproval, heldItemNeedsStaff, decidedBeforeDeadline, namesAfterAllYes, counterIsNotYes, slotOwnerAlive, noLostAnswer,
    minorNever, minorEndsBooking, minorKnewMarked, stopWins, terminalStable, requestNotStuck, cancelReachesTold, partialAcceptReleased,
    noShowOnce, bookedMembersTold, bookedSlotAlive, pauseNeedsUnansweredInvitations,
    teenFriendAgeRule, teenSwitchOffNoMinor, teenRosterIsJudgedStrictly, teenGroupSmall, teenGroupRule, teenAuditByStaffRole,
    teenNeverNineteenOrOtherLane, slopIntroductionNeedsTwoReceipts, slotClarificationStaysOnProbe,
  }

  // ---------------------------------------------------------------- known open (not in safety)
  // Each value below still fails on the code of this branch. The defect was skipped for the reason given,
  // so the value is kept as its own check and the run tests show its trace.

  // SD-006 (skipped: the Network has no delivery-outcome path from the outbound queue; a cross-module design
  // with SD-030, SD-095 and SD-257 that needs a founder or maintainer decision). Code comment : silence
  // for 48 hours confirms a booked plan only after "the booked plan reached them"; the queue can hold or
  // refuse the reveal (outbound-queue.ts), and silence still confirms.
  val confirmedImpliesDelivered = OPPS.forall(o => op(s, o).silent.forall(m => op(s, o).revealQ.get(m) == "delivered"))

  // SD-030. The opportunity can still record a probe expiry after collecting a send the queue refused
  // or held. That outcome record is separate from the F28 pause, which requires a delivery receipt.
  val silenceOnlyAfterDelivery = OPPS.forall(o => op(s, o).expiredSilent.forall(m => op(s, o).probeQ.get(m) == "delivered"))

  // SD-140 (skipped: the fix was reverted; with declinedBy filled in, two sim gates failed on defects that
  // were already there: the proactive timing of unsolicited info sends and the minors-in-plans gate for a
  // minor found only after contact). engine world.ts reads interaction outcomes; a member's "no" is a
  // decline, but close() records "declined" only for reason "declined".
  val declineRecorded = OPPS.forall(o => op(s, o).outcomeRec == "expired" implies op(s, o).saidNo == Set())

  // SD-259. A plain "no" after the 48-hour booked slot carries no cancellation authority. The explicit
  // fallback in spec/opportunityLifecycle.md selects a unique upcoming booking in the member's app.
  // The exact local-time qualifier and multiple-booking selection are outside this pair model.
  val bookedNoHonored = OPPS.forall(o => {
    val x = op(s, o)
    x.stage == "scheduled" implies x.cancelAsked.forall(m => x.status.get(m) != "yes")
  })

  // SD-249 (skipped: needs a founder decision; the Blooio and Apple line-safety streak rule refuses
  // logistics at 3 unanswered, and the drop_notice hook has no onRefused). No notice to a reachable member
  // is refused. The same rule refuses a release (SD-263) or "none yet" to a member at the streak limit.
  val noticeNeverRefused = OPPS.forall(o => op(s, o).noticeRefused.forall(m => mm(s, m).forgotten or mm(s, m).optedOut))

  val knownOpen = idle implies and {
    confirmedImpliesDelivered, silenceOnlyAfterDelivery, declineRecorded, bookedNoHonored, noticeNeverRefused,
  }

  // ================================================================ witnesses (must be reachable)
  // Each is read between two units only (`not(idle) or ...`).
  val witness_revealed = not(idle) or OPPS.forall(o => op(s, o).revealSent == Set())
  val witness_feedbackAnswered = not(idle) or OPPS.forall(o => not(op(s, o).stage == "done" and op(s, o).feedbackFrom != Set()))
  val witness_rejectNoContact = not(idle) or OPPS.forall(o => not(op(s, o).review.decision == "reject" and op(s, o).stage == "closed" and op(s, o).contacted == Set()))
  val witness_confirmedBySilence = not(idle) or OPPS.forall(o => op(s, o).silent == Set())
  val witness_requestFulfilled = not(idle) or s.req.outcome != "fulfilled"
  // A yes taken back before the reveal (SD-075, SD-076) and a release after a partial yes (SD-263).
  val witness_yesTakenBack = not(idle) or OPPS.forall(o => not(op(s, o).withdrawn.exists(p => op(s, o).saidNo.contains(p))))
  val witness_partialReleased = not(idle) or OPPS.forall(o => not(op(s, o).released.exists(p => p != op(s, o).requester)))
  // A teen friendship meeting is booked, the sweep closes a teen item on a birthday, and the stop closes one.
  val witness_teenBooked = not(idle) or TEEN_OPPS.forall(o => tOpp(s, o).stage != "scheduled")
  val witness_teenAgeSwept = not(idle) or TEEN_OPPS.forall(o => tOpp(s, o).closedReason != "age_changed")
  val witness_teenStopSwept = not(idle) or TEEN_OPPS.forall(o => tOpp(s, o).closedReason != "teen_intros_off")
  val witness_heldStaffApproved = not(idle) or OPPS.forall(o => op(s, o).review.approver != "staff")
  val witness_reviewStopped = not(idle) or OPPS.forall(o => op(s, o).review.phase != "stopped")
  val witness_explicitTimeChoice = not(idle) or OPPS.forall(o => MEMBERS.forall(m => op(s, o).accepted.get(m) != "offered_time_choice"))
// quint-witness: witness_explicitTimeChoice timeChoiceAfterClarificationTest

  // ================================================================ run tests (traces from the code)
  pure val ALL_OPEN: Env = { openW: MEMBERS, budget: true, lead: 30 }

  // A run test step is a unit and then its jobs: `settle` runs one job, or does nothing between two units.
  // The longest unit here (a tick) has fewer than 16 jobs.
  action settle = any { all { idle, s' = s }, runJob }
  action settled = settle.then(settle).then(settle).then(settle).then(settle).then(settle).then(settle).then(settle)
    .then(settle).then(settle).then(settle).then(settle).then(settle).then(settle).then(settle).then(settle)

  // Approve, both yes, reveal, the meeting, feedback (docs/network.md 4; the mini.ts happy path).
  run happyPathTest =
    init
      .then(submit("o1")).then(settled)
      .then(judgeRecord("o1", "approve", true, ALL_OPEN)).then(settled)
      .then(probeSend("o1", "a", ALL_OPEN)).then(settled)
      .then(answer("a", "yes", ALL_OPEN)).then(settled)
      .then(probeSend("o1", "b", ALL_OPEN)).then(settled)
      .then(answer("b", "yes", ALL_OPEN)).then(settled)
      .expect(op(s, "o1").stage == "scheduled" and op(s, "o1").revealSent == Set("a", "b") and s.req.outcome == "booked" and safety)
      .then(tick(31, ALL_OPEN)).then(settled)
      .then(tick(6, ALL_OPEN)).then(settled)
      .expect(op(s, "o1").stage == "done" and mm(s, "a").aw.kind == "feedback")
      .then(answer("a", "fb_good", ALL_OPEN)).then(settled)
      .then(answer("b", "fb_good", ALL_OPEN)).then(settled)
      .then(tick(1, ALL_OPEN)).then(settled)
      .expect(op(s, "o1").finalized and safety)
      .expect(not(witness_requestFulfilled))

  run pastTimeCannotAcceptProbeTest =
    init
      .then(submit("o1")).then(settled)
      .then(judgeRecord("o1", "approve", true, ALL_OPEN)).then(settled)
      .then(probeSend("o1", "a", ALL_OPEN)).then(settled)
      .then(answer("a", "yes", ALL_OPEN)).then(settled)
      .then(probeSend("o1", "b", ALL_OPEN)).then(settled)
      .then(answer("b", "past_time", ALL_OPEN)).then(settled)
      .expect(op(s, "o1").stage == "probing" and stat(s, "o1", "b") == "probing"
        and op(s, "o1").revealSent == Set() and mm(s, "b").aw.kind == "probe" and safety)
      .then(answer("b", "yes", ALL_OPEN)).then(settled)
      .expect(op(s, "o1").stage == "scheduled" and op(s, "o1").revealSent == Set("a", "b") and safety)

  run mutualNamedIntroductionSurvivesCancellationTest =
    init
      .then(submit("o1")).then(settled)
      .then(judgeRecord("o1", "approve", true, ALL_OPEN)).then(settled)
      .then(probeSend("o1", "a", ALL_OPEN)).then(settled)
      .then(queueDecide("probe", "o1", "a", "delivered")).then(settled)
      .expect(not(op(s, "o1").firstIntroduction))
      .then(answer("a", "yes", ALL_OPEN)).then(settled)
      .then(probeSend("o1", "b", ALL_OPEN)).then(settled)
      .then(answer("b", "yes", ALL_OPEN)).then(settled)
      .then(queueDecide("reveal", "o1", "a", "delivered")).then(settled)
      .then(tick(1, ALL_OPEN)).then(settled)
      .expect(op(s, "o1").stage == "scheduled" and not(op(s, "o1").firstIntroduction))
      .then(queueDecide("reveal", "o1", "b", "delivered")).then(settled)
      .then(answer("a", "cancel", ALL_OPEN)).then(settled)
      .expect(op(s, "o1").stage == "closed" and op(s, "o1").firstIntroduction and slopIntroductionNeedsTwoReceipts)

  // A reject closes the item and nobody is contacted (decide, reject).
  run rejectTest =
    init.then(submit("o2")).then(settled).then(reject("o2", ALL_OPEN)).then(settled)
      .expect(op(s, "o2").stage == "closed" and op(s, "o2").contacted == Set() and s.collected == 0 and safety)

  // SD-009 (c06f633, opportunity-review-deadline.test.ts): the clock passes the deadline and no tick runs.
  // No decision is applied (reviewBlock "review_expired"); the next tick expires the item and nobody is contacted.
  run lateApprovalTest =
    init.then(submit("o2")).then(settled).then(elapse(13)).then(settled)
      .expect(not(reviewOpen(s, "o2")) and op(s, "o2").stage == "review")
      .then(tick(1, ALL_OPEN)).then(settled)
      .expect(op(s, "o2").stage == "closed" and op(s, "o2").review.decision == "expired" and op(s, "o2").contacted == Set()
              and s.collected == 0 and safety)

  run qualifiedReplyKeepsProbeTest =
    init.then(submit("o2")).then(settled).then(judgeRecord("o2", "approve", true, ALL_OPEN)).then(settled)
      .then(probeSend("o2", "a", ALL_OPEN)).then(settled)
      .then(answer("a", "qualified_withdrawal", ALL_OPEN)).then(settled)
      .expect(stat(s, "o2", "a") == "probing" and mm(s, "a").aw.kind == "probe")
      .then(answer("a", "unbound_time", ALL_OPEN)).then(settled)
      .expect(stat(s, "o2", "a") == "probing" and op(s, "o2").revealSent == Set() and safety)
      .then(answer("a", "direct_withdrawal", ALL_OPEN)).then(settled)
      .expect(stat(s, "o2", "a") == "out" and op(s, "o2").revealSent == Set() and safety)

  // SD-041 (113a369, opportunity-counter-offer.test.ts): "how about next week instead?" is unclear: one
  // clarification, the probe stays open, silence expires it, and the request item closes. No names go out.
  run counterOfferTest =
    init.then(submit("o2")).then(settled).then(judgeRecord("o2", "approve", true, ALL_OPEN)).then(settled).then(probeSend("o2", "a", ALL_OPEN)).then(settled)
      .then(answer("a", "counter", ALL_OPEN)).then(settled)
      .expect(stat(s, "o2", "a") == "probing" and mm(s, "a").aw.kind == "probe" and mm(s, "a").aw.clarified and safety)
      .then(tick(PROBE_TTL + 1, ALL_OPEN)).then(settled)
      .expect(op(s, "o2").parts == Set("b", "c") and stat(s, "o2", "a") == "out" and op(s, "o2").revealSent == Set()
              and counterIsNotYes and safety)

  run timeChoiceAfterClarificationTest =
    init.then(submit("o2")).then(settled).then(judgeRecord("o2", "approve", true, ALL_OPEN)).then(settled).then(probeSend("o2", "a", ALL_OPEN)).then(settled)
      .then(answer("a", "unclear", ALL_OPEN)).then(settled)
      .expect(mm(s, "a").aw.clarified and not(mm(s, "a").aw.timeChoice) and s.collected == 2)
      .then(answer("a", "timed_slot_ambiguity", ALL_OPEN)).then(settled)
      .expect(mm(s, "a").aw.timeChoice and s.collected == 3)
      .then(answer("a", "yes", ALL_OPEN)).then(settled)
      .expect(mm(s, "a").aw.timeChoice and stat(s, "o2", "a") == "probing" and op(s, "o2").accepted.get("a") == "")
      .then(answer("a", "ack", ALL_OPEN)).then(settled)
      .then(answer("a", "timed_slot_ambiguity", ALL_OPEN)).then(settled)
      .expect(mm(s, "a").aw.timeChoice and s.collected == 3 and op(s, "o2").revealSent == Set() and safety)
      .then(answer("a", "offered_time_choice", ALL_OPEN)).then(settled)
      .expect(mm(s, "a").aw == NO_AW and stat(s, "o2", "a") == "available" and safety)
      .expect(not(witness_explicitTimeChoice))

  run joinedTimeRefusalKeepsProbeOpenTest =
    init.then(submit("o2")).then(settled).then(judgeRecord("o2", "approve", true, ALL_OPEN)).then(settled)
      .then(probeSend("o2", "a", ALL_OPEN)).then(settled)
      .then(answer("a", "timed_slot_ambiguity", ALL_OPEN)).then(settled)
      .expect(mm(s, "a").aw.timeChoice and stat(s, "o2", "a") == "probing"
        and op(s, "o2").accepted.get("a") == "" and op(s, "o2").revealSent == Set() and safety)
      .then(answer("a", "offered_time_choice", ALL_OPEN)).then(settled)
      .expect(mm(s, "a").aw == NO_AW and stat(s, "o2", "a") == "available" and safety)

  // SD-075 (791ff6a, opportunity-withdraw-yes.test.ts): a yes, then "actually no, sorry" with no slot: the
  // yes is taken back; b replaces a; b and c say yes; the names go to b and c only.
  run withdrawnYesTest =
    init.then(submit("o2")).then(settled).then(judgeRecord("o2", "approve", true, ALL_OPEN)).then(settled).then(probeSend("o2", "a", ALL_OPEN)).then(settled)
      .then(answer("a", "yes", ALL_OPEN)).then(settled)
      .then(answer("a", "no", ALL_OPEN)).then(settled)
      .expect(op(s, "o2").parts == Set("b", "c") and op(s, "o2").saidNo == Set("a") and safety)
      .then(probeSend("o2", "b", ALL_OPEN)).then(settled).then(answer("b", "yes", ALL_OPEN)).then(settled)
      .then(probeSend("o2", "c", ALL_OPEN)).then(settled).then(answer("c", "yes", ALL_OPEN)).then(settled)
      .expect(op(s, "o2").stage == "scheduled" and op(s, "o2").revealSent == Set("b", "c") and namesAfterAllYes and safety)

  // SD-075 with "I need to cancel" on the request item: the requester takes the yes back; the item closes.
  run cancelYesTest =
    init.then(submit("o1")).then(settled).then(judgeRecord("o1", "approve", true, ALL_OPEN)).then(settled).then(probeSend("o1", "a", ALL_OPEN)).then(settled)
      .then(answer("a", "yes", ALL_OPEN)).then(settled)
      .then(answer("a", "cancel", ALL_OPEN)).then(settled)
      .expect(op(s, "o1").stage == "closed" and op(s, "o1").revealSent == Set() and s.req.outcome == "none" and safety)

  // SD-048 (73d1e2b, opportunity-replaced-prober.test.ts): b is probing, b sends STOP, c replaces b, b
  // sends START: b has no slot left for the item.
  run replacedProberTest =
    init.then(submit("o1")).then(settled).then(judgeRecord("o1", "approve", true, ALL_OPEN)).then(settled).then(probeSend("o1", "a", ALL_OPEN)).then(settled)
      .then(answer("a", "yes", ALL_OPEN)).then(settled)
      .then(probeSend("o1", "b", ALL_OPEN)).then(settled)
      .then(stop("b", ALL_OPEN)).then(settled)
      .then(start("b")).then(settled)
      .expect(op(s, "o1").parts == Set("a", "c") and mm(s, "b").aw.kind == "none" and slotOwnerAlive and safety)

  // Audit OPP18 (probe-replacement-consent.integration.test.ts): a says yes, c says no and b replaces c.
  // a's yes was about c, so a is asked again before b is probed; the names go out only after both new yeses.
  run replacementAsksAgainTest =
    init.then(submit("o2")).then(settled).then(judgeRecord("o2", "approve", true, ALL_OPEN)).then(settled).then(probeSend("o2", "a", ALL_OPEN)).then(settled)
      .then(answer("a", "yes", ALL_OPEN)).then(settled)
      .then(probeSend("o2", "c", ALL_OPEN)).then(settled).then(answer("c", "no", ALL_OPEN)).then(settled)
      .expect(op(s, "o2").parts == Set("a", "b") and stat(s, "o2", "a") == "probing" and op(s, "o2").askedAgain == Set("a")
              and stat(s, "o2", "b") == "queued" and op(s, "o2").revealSent == Set() and safety)
      .then(probeSend("o2", "a", ALL_OPEN)).then(settled).then(answer("a", "yes", ALL_OPEN)).then(settled)
      .then(probeSend("o2", "b", ALL_OPEN)).then(settled).then(answer("b", "yes", ALL_OPEN)).then(settled)
      .expect(op(s, "o2").stage == "scheduled" and op(s, "o2").revealSent == Set("a", "b") and namesAfterAllYes and safety)

  // Owner decision 2026-11-23 (probe-replacement-consent.integration.test.ts, the requester case): o1 is a's own
  // request. a says yes, b says no and c replaces b. a's yes carries over: a is not asked again, c is probed next,
  // and the names go out only after c's yes.
  run requesterYesCarriesOverTest =
    init.then(submit("o1")).then(settled).then(judgeRecord("o1", "approve", true, ALL_OPEN)).then(settled).then(probeSend("o1", "a", ALL_OPEN)).then(settled)
      .then(answer("a", "yes", ALL_OPEN)).then(settled)
      .then(probeSend("o1", "b", ALL_OPEN)).then(settled).then(answer("b", "no", ALL_OPEN)).then(settled)
      .expect(op(s, "o1").parts == Set("a", "c") and stat(s, "o1", "a") == "available" and op(s, "o1").told.contains("a")
              and op(s, "o1").askedAgain == Set() and stat(s, "o1", "c") == "probing" and op(s, "o1").revealSent == Set() and safety)
      .then(probeSend("o1", "c", ALL_OPEN)).then(settled).then(answer("c", "yes", ALL_OPEN)).then(settled)
      .expect(op(s, "o1").stage == "scheduled" and op(s, "o1").revealSent == Set("a", "c") and namesAfterAllYes and safety)

  // Audit OPP18 review (probe-replacement-consent.integration.test.ts, the pending case): a's probe described c and
  // waits for its answer; c stops before their turn and b replaces c. a's open probe is void: a gets a new probe
  // about the new roster before b is asked, and the names go out only after both yeses.
  run replacementVoidsAPendingProbeTest =
    init.then(submit("o2")).then(settled).then(judgeRecord("o2", "approve", true, ALL_OPEN)).then(settled).then(probeSend("o2", "a", ALL_OPEN)).then(settled)
      .then(stop("c", ALL_OPEN)).then(settled)
      .expect(op(s, "o2").parts == Set("a", "b") and stat(s, "o2", "a") == "probing" and not(op(s, "o2").told.contains("a"))
              and op(s, "o2").contacted.contains("a") and stat(s, "o2", "b") == "queued" and mm(s, "a").aw.kind == "none" and safety)
      .then(probeSend("o2", "a", ALL_OPEN)).then(settled).then(answer("a", "yes", ALL_OPEN)).then(settled)
      .then(probeSend("o2", "b", ALL_OPEN)).then(settled).then(answer("b", "yes", ALL_OPEN)).then(settled)
      .expect(op(s, "o2").stage == "scheduled" and op(s, "o2").revealSent == Set("a", "b") and namesAfterAllYes and safety)

  // Review 2026-11-17 (minor-replaced-booked.integration.test.ts): a was asked about o2, said no and was replaced;
  // b and c booked. Then a states an age under the join age: the decline is a minor signal, so the booking
  // closes for the minors policy before forget deletes a's data, and b and c hear it is off.
  run declinedAskedMemberClosesBookingTest =
    init.then(submit("o2")).then(settled).then(judgeRecord("o2", "approve", true, ALL_OPEN)).then(settled).then(probeSend("o2", "a", ALL_OPEN)).then(settled)
      .then(answer("a", "yes", ALL_OPEN)).then(settled)
      .then(answer("a", "no", ALL_OPEN)).then(settled)
      .then(probeSend("o2", "b", ALL_OPEN)).then(settled).then(answer("b", "yes", ALL_OPEN)).then(settled)
      .then(probeSend("o2", "c", ALL_OPEN)).then(settled).then(answer("c", "yes", ALL_OPEN)).then(settled)
      .expect(op(s, "o2").stage == "scheduled")
      .then(declineUnderAge("a", ALL_OPEN)).then(settled)
      .expect(op(s, "o2").stage == "closed" and op(s, "o2").closedReason == "minors policy"
              and op(s, "o2").cancelHeard == Set("b", "c") and minorEndsBooking and safety)

  // joinLine second opinion (minor-plan-roles.integration.test.ts, "a table whose asked member's record age went under 18 before the member was forgotten never gets a repeat"): a and b met at o1 and it is finished;
  // then b becomes a minor. Nothing is open, but the minors drop still marks o1, so no repeat of its time and
  // place can follow.
  run minorMarksFinishedItemTest =
    init
      .then(submit("o1")).then(settled)
      .then(judgeRecord("o1", "approve", true, ALL_OPEN)).then(settled)
      .then(probeSend("o1", "a", ALL_OPEN)).then(settled)
      .then(answer("a", "yes", ALL_OPEN)).then(settled)
      .then(probeSend("o1", "b", ALL_OPEN)).then(settled)
      .then(answer("b", "yes", ALL_OPEN)).then(settled)
      .then(tick(31, ALL_OPEN)).then(settled)
      .then(tick(6, ALL_OPEN)).then(settled)
      .expect(op(s, "o1").stage == "done" and not(op(s, "o1").minorKnew))
      .then(becomeMinor("b", ALL_OPEN)).then(settled)
      .expect(op(s, "o1").stage == "done" and op(s, "o1").minorKnew and not(op(s, "o2").minorKnew) and minorKnewMarked and safety)

  // The common prefix: o1 is booked for a and b (lead 30 unless given).
  action bookO1(lead: int): bool =
    init.then(submit("o1")).then(settled).then(judgeRecord("o1", "approve", true, ALL_OPEN)).then(settled).then(probeSend("o1", "a", ALL_OPEN)).then(settled)
      .then(answer("a", "yes", ALL_OPEN)).then(settled)
      .then(probeSend("o1", "b", ALL_OPEN)).then(settled)
      .then(answer("b", "yes", { ...ALL_OPEN, lead: lead })).then(settled)

  // SD-139. When b cancels the booked request, the request waits again and a's booked slot ends.
  run requestStuckTest =
    bookO1(30).then(answer("b", "cancel", ALL_OPEN)).then(settled)
      .expect(op(s, "o1").stage == "closed" and s.req.outcome == "none" and requestNotStuck and safety
              and mm(s, "a").aw.kind != "booked" and bookedSlotAlive)

  // The requester calls the booked meeting off: the request stays "booked" (they called it off; a new ask
  // opens a new request), and b hears it is off.
  run requesterCancelsTest =
    bookO1(30).then(answer("a", "cancel", ALL_OPEN)).then(settled)
      .expect(op(s, "o1").stage == "closed" and s.req.outcome == "booked" and op(s, "o1").cancelHeard == Set("b") and safety)

  // SD-006 (skipped): the reveal to b is collected, the queue holds it (b's line streak), 48 hours of silence confirm it.
  run silentConfirmTest =
    bookO1(72)
      .then(queueDecide("reveal", "o1", "b", "held")).then(settled)
      .then(tick(49, ALL_OPEN)).then(settled)
      .expect(op(s, "o1").silent.contains("b") and not(confirmedImpliesDelivered) and safety)

  // requestNotStuck (model error fixed): the meeting takes place, a says "I couldn't make it", so the request
  // is not fulfilled and stays "booked". Then b leaves the app: forget deletes the done item. The meeting was
  // set; a new ask from a opens a new request.
  run requestAfterLeaveTest =
    bookO1(30).then(tick(31, ALL_OPEN)).then(settled).then(tick(6, ALL_OPEN)).then(settled)
      .then(answer("a", "fb_self_noshow", ALL_OPEN)).then(settled)
      .then(tick(96, ALL_OPEN)).then(settled)
      .expect(op(s, "o1").finalized and s.req.outcome == "booked")
      .then(forget("b", ALL_OPEN)).then(settled)
      .expect(op(s, "o1").stage == "gone" and s.req.outcome == "booked" and requestNotStuck and safety)

  // SD-249 (skipped): both get the reminder (3 messages since their last text); a cancels; the drop notice
  // to b is refused by the streak rule and nothing retries it. b still believes the plan is on.
  run cancelRefusedTest =
    bookO1(30).then(tick(10, ALL_OPEN)).then(settled)
      .expect(mm(s, "b").outbound == 3)
      .then(answer("a", "cancel", ALL_OPEN)).then(settled)
      .expect(op(s, "o1").stage == "closed" and not(op(s, "o1").cancelHeard.contains("b"))
              and op(s, "o1").noticeRefused == Set("b") and not(noticeNeverRefused) and safety)

  // SD-248 (c29646e, opportunity-forget-cancellation.test.ts): b is in quiet hours; a leaves the app; the
  // drop notice to b is deferred and the opportunity is deleted; the notice still goes in the morning.
  run leaveInQuietHoursTest =
    bookO1(30).then(forget("a", { ...ALL_OPEN, openW: Set("a", "c") })).then(settled)
      .expect(op(s, "o1").stage == "gone" and s.deferred == Set({ kind: "drop_notice", opp: "o1", to: "b" }) and safety)
      .then(tick(6, ALL_OPEN)).then(settled)
      .expect(s.deferred == Set() and op(s, "o1").cancelHeard.contains("b") and safety)

  // SD-328 (25b54f1, opportunity-no-show-once.test.ts): a says b never showed; finalize at +4 days counts
  // b's no-show; b's late "I couldn't make it" does not count it again.
  run noShowTwiceTest =
    bookO1(30).then(tick(31, ALL_OPEN)).then(settled).then(tick(6, ALL_OPEN)).then(settled)
      .then(answer("a", "fb_other_noshow", ALL_OPEN)).then(settled)
      .then(tick(96, ALL_OPEN)).then(settled)
      .expect(op(s, "o1").finalized and op(s, "o1").noShowCount.get("b") == 1 and op(s, "o1").noShowCounted == Set("b"))
      .then(answer("b", "fb_self_noshow", ALL_OPEN)).then(settled)
      .expect(op(s, "o1").noShowCount.get("b") == 1 and op(s, "o1").feedbackFrom.contains("b") and noShowOnce and safety)

  // SD-259. After the 48-hour booked slot, a plain "no, sorry" leaves the plan as it was.
  run lateNoTest =
    bookO1(72).then(tick(49, ALL_OPEN)).then(settled)
      .expect(mm(s, "a").aw.kind == "none")
      .then(answer("a", "no", ALL_OPEN)).then(settled)
      .expect(op(s, "o1").stage == "scheduled" and stat(s, "o1", "a") == "yes" and not(bookedNoHonored) and safety)

  // SD-077 (6d8d2d3, opportunity-feedback-slot.test.ts): after the o1 meeting, a has the feedback slot; the
  // o2 probe to a waits; "it was great!" answers the feedback; then the probe goes out.
  run feedbackAsYesTest =
    bookO1(30).then(tick(31, ALL_OPEN)).then(settled).then(tick(6, ALL_OPEN)).then(settled)
      .expect(mm(s, "a").aw.kind == "feedback")
      // "ok" is not an answer to "How did it go?": the slot stays, and the streak resets.
      .then(answer("a", "ack", ALL_OPEN)).then(settled)
      .then(submit("o2")).then(settled).then(judgeRecord("o2", "approve", true, ALL_OPEN)).then(settled)
      .expect(stat(s, "o2", "a") == "probing" and probeOwed(s, "a", "o2"))
      .then(answer("a", "fb_good", ALL_OPEN)).then(settled)
      .expect(op(s, "o1").feedbackFrom.contains("a") and stat(s, "o2", "a") == "probing" and not(op(s, "o2").contacted.contains("a")))
      .then(probeSend("o2", "a", ALL_OPEN)).then(settled)
      .expect(mm(s, "a").aw == { kind: "probe", opp: "o2", at: s.now, clarified: false, timeChoice: false } and counterIsNotYes and safety)

  // SD-043 (74602b1, opportunity-awaiting-slot.test.ts): a job post read-back holds the slot of a pending
  // probe; "no" drops the post and the slot goes back to the probe; the next "yes" answers the probe.
  run postingTakesSlotTest =
    init.then(submit("o1")).then(settled).then(judgeRecord("o1", "approve", true, ALL_OPEN)).then(settled).then(probeSend("o1", "a", ALL_OPEN)).then(settled)
      .then(answer("a", "job_post", ALL_OPEN)).then(settled)
      .expect(mm(s, "a").aw.kind == "posting" and noLostAnswer)
      .then(answer("a", "no", ALL_OPEN)).then(settled)
      .expect(mm(s, "a").aw.kind == "probe" and mm(s, "a").aw.opp == "o1" and stat(s, "o1", "a") == "probing")
      .then(answer("a", "yes", ALL_OPEN)).then(settled)
      .expect(stat(s, "o1", "a") == "available" and safety)

  // SD-030. The queue refuses a's probe. The opportunity still records a probe expiry.
  run refusedProbeSilenceTest =
    init.then(submit("o1")).then(settled).then(judgeRecord("o1", "approve", true, ALL_OPEN)).then(settled).then(probeSend("o1", "a", ALL_OPEN)).then(settled)
      .then(queueDecide("probe", "o1", "a", "refused")).then(settled)
      .then(tick(PROBE_TTL + 1, ALL_OPEN)).then(settled)
      .expect(op(s, "o1").expiredSilent.contains("a") and not(silenceOnlyAfterDelivery) and safety)

  // F28. A refused initial invitation does not contribute to an automatic pause at either deadline.
  run refusedInitialInviteTest =
    init.then(submit("o2")).then(settled).then(judgeRecord("o2", "approve", true, ALL_OPEN)).then(settled).then(probeSend("o2", "a", ALL_OPEN)).then(settled)
      .then(queueDecide("probe", "o2", "a", "refused")).then(settled)
      .then(tick(PROBE_TTL, ALL_OPEN)).then(settled)
      .expect(op(s, "o2").expiredSilent.contains("a") and unansweredInvitations(s, "a") == Set())
      .then(tick(UNANSWERED_AFTER - PROBE_TTL, ALL_OPEN)).then(settled)
      .expect(mm(s, "a").initialInvites == Set() and not(mm(s, "a").onlyWhenAsked) and safety)

  // F28. b receives two initial invitations. The second receipt is resolved after the probe expires. In o1 the
  // requester a's yes carries over to c (requesterYesCarriesOverTest); in o2 the replacement asks a again before
  // b is probed (replacementAsksAgainTest; network.ts changeRoster).
  action confirmedInvitationsFirstItem =
    init.then(submit("o1")).then(settled).then(judgeRecord("o1", "approve", true, ALL_OPEN)).then(settled).then(probeSend("o1", "a", ALL_OPEN)).then(settled)
      .then(answer("a", "yes", ALL_OPEN)).then(settled).then(probeSend("o1", "b", ALL_OPEN)).then(settled)
      .then(queueDecide("probe", "o1", "b", "delivered")).then(settled)
      .then(tick(PROBE_TTL - 1, ALL_OPEN)).then(settled).expect(unansweredInvitations(s, "b") == Set())
      .then(tick(1, ALL_OPEN)).then(settled)
      .expect(unansweredInvitations(s, "b") == Set("o1") and not(mm(s, "b").onlyWhenAsked) and stat(s, "o1", "a") == "available"
              and op(s, "o1").told.contains("a") and op(s, "o1").askedAgain == Set() and stat(s, "o1", "c") == "probing")
      .then(probeSend("o1", "c", ALL_OPEN)).then(settled).then(queueDecide("probe", "o1", "c", "delivered")).then(settled)
      .then(answer("c", "no", ALL_OPEN)).then(settled).then(answer("a", "ack", ALL_OPEN)).then(settled)
  run confirmedInvitationsExpireTest =
    confirmedInvitationsFirstItem
      .then(submit("o2")).then(settled).then(judgeRecord("o2", "approve", true, ALL_OPEN)).then(settled).then(probeSend("o2", "a", ALL_OPEN)).then(settled)
      .then(queueDecide("probe", "o2", "a", "delivered")).then(settled).then(answer("a", "yes", ALL_OPEN)).then(settled)
      .then(probeSend("o2", "c", ALL_OPEN)).then(settled).then(queueDecide("probe", "o2", "c", "delivered")).then(settled)
      .then(answer("c", "no", ALL_OPEN)).then(settled)
      .expect(stat(s, "o2", "a") == "probing" and stat(s, "o2", "b") == "queued")
      .then(probeSend("o2", "a", ALL_OPEN)).then(settled).then(answer("a", "yes", ALL_OPEN)).then(settled)
      .then(probeSend("o2", "b", ALL_OPEN)).then(settled)
      .then(tick(PROBE_TTL, ALL_OPEN)).then(settled)
      .expect(op(s, "o2").expiredSilent.contains("b") and unansweredInvitations(s, "b") == Set("o1") and not(mm(s, "b").onlyWhenAsked))
      .then(queueDecideAt("probe", "o2", "b", "delivered", s.now - PROBE_TTL)).then(settled)
      .then(tick(1, ALL_OPEN)).then(settled)
      .expect(s.now - op(s, "o2").sentAt.get("b") < UNANSWERED_AFTER and op(s, "o1").expiredSilent.contains("b") and op(s, "o2").expiredSilent.contains("b")
              and unansweredInvitations(s, "b") == Set("o1", "o2") and mm(s, "b").onlyWhenAsked and safety)
      .then(answer("b", "ack", ALL_OPEN)).then(settled)
      .expect(unansweredInvitations(s, "b") == Set() and not(mm(s, "b").onlyWhenAsked) and safety)

  // SD-263 (791f698, opportunity-partial-yes.test.ts) and SD-140 (skipped): o2, a says yes, c says no, no
  // alternate is free: the item closes; a is released; the interaction is still recorded as "expired".
  run partnerNoTest =
    init.then(stop("b", ALL_OPEN)).then(settled).then(submit("o2")).then(settled).then(judgeRecord("o2", "approve", true, ALL_OPEN)).then(settled).then(probeSend("o2", "a", ALL_OPEN)).then(settled)
      .then(answer("a", "yes", ALL_OPEN)).then(settled)
      .then(probeSend("o2", "c", ALL_OPEN)).then(settled)
      .then(answer("c", "no", ALL_OPEN)).then(settled)
      .expect(op(s, "o2").stage == "closed" and op(s, "o2").released == Set("a") and partialAcceptReleased
              and op(s, "o2").outcomeRec == "expired" and not(declineRecorded) and safety)

  // SD-263 in quiet hours: the release waits for a's window and goes at the next tick.
  run partnerNoQuietTest =
    init.then(stop("b", ALL_OPEN)).then(settled).then(submit("o2")).then(settled).then(judgeRecord("o2", "approve", true, ALL_OPEN)).then(settled).then(probeSend("o2", "a", ALL_OPEN)).then(settled)
      .then(answer("a", "yes", ALL_OPEN)).then(settled)
      .then(probeSend("o2", "c", ALL_OPEN)).then(settled)
      .then(answer("c", "no", { ...ALL_OPEN, openW: Set("c") })).then(settled)
      .expect(s.deferred == Set({ kind: "release", opp: "o2", to: "a" }) and safety)
      .then(tick(6, ALL_OPEN)).then(settled)
      .expect(op(s, "o2").released == Set("a") and s.deferred == Set() and safety)

  // SD-146 (not reproduced): b is in quiet hours at the reveal (meeting 8 hours ahead); the deferred reveal
  // waits; the last tick before the meeting is in b's window, so b is told before the meeting.
  run deferredRevealTest =
    init.then(submit("o1")).then(settled).then(judgeRecord("o1", "approve", true, ALL_OPEN)).then(settled).then(probeSend("o1", "a", ALL_OPEN)).then(settled)
      .then(answer("a", "yes", ALL_OPEN)).then(settled)
      .then(probeSend("o1", "b", ALL_OPEN)).then(settled)
      .then(answer("b", "yes", { openW: Set("a"), budget: true, lead: 8 })).then(settled)
      .expect(s.deferred == Set({ kind: "reveal", opp: "o1", to: "b" }))
      .then(tick(6, { openW: Set("a"), budget: true, lead: 8 })).then(settled)
      .expect(s.deferred == Set({ kind: "reveal", opp: "o1", to: "b" }) and not(deferredInTime(s, 1, { openW: Set("a"), budget: true, lead: 8 })))
      .then(tick(1, ALL_OPEN)).then(settled)
      .expect(s.deferred == Set() and op(s, "o1").bookedTold == Set("a", "b"))
      .then(tick(1, ALL_OPEN)).then(settled)
      .expect(op(s, "o1").stage == "scheduled" and bookedMembersTold and safety)

  // SD-076 (791ff6a, opportunity-withdraw-yes.test.ts): "yes, but none of those times", silence past the
  // probe window keeps the yes and ends the slot; then "no thanks" takes the yes back and the request item closes.
  run noAfterRetryTest =
    init.then(submit("o1")).then(settled).then(judgeRecord("o1", "approve", true, ALL_OPEN)).then(settled).then(probeSend("o1", "a", ALL_OPEN)).then(settled)
      .then(answer("a", "yes_other_times", ALL_OPEN)).then(settled)
      .then(tick(PROBE_TTL + 1, ALL_OPEN)).then(settled)
      .expect(stat(s, "o1", "a") == "available" and mm(s, "a").aw.kind == "none" and slotOwnerAlive)
      .then(answer("a", "no", ALL_OPEN)).then(settled)
      .expect(op(s, "o1").stage == "closed" and op(s, "o1").revealSent == Set() and safety)

  // Teen friend introductions (owner decision 2026-11-22, answers A2 to A5). They are on from the start.

  // p (16) and q (17) within 2 years: proposal, the judge approves with the strict rubric, both yes, booked two days later.
  run teenPairBookedTest =
    init
      .then(teenPropose("t1")).then(teenJudge("t1", true))
      .then(teenYes("t1", "p")).then(teenYes("t1", "q"))
      .expect(tOpp(s, "t1").stage == "scheduled" and tOpp(s, "t1").meetingDay == 20261123 and safety)

  // Stopped: no teen proposal. A reviewer cannot stop; a safety staff member cannot resume; one admin resumes.
  run teenStoppedProposeTest = init.then(teenStop("safety1")).then(teenPropose("t1")).fail()
  run teenStopNeedsRoleTest = init.then(teenStop("reviewer1")).fail()
  run teenResumeNeedsAdminTest = init.then(teenStop("safety1")).then(teenResume("safety1")).fail()
  run teenResumeTest =
    init.then(teenStop("safety1")).then(teenResume("admin2")).then(teenPropose("t1"))
      .expect(not(s.teen.stopped) and s.teen.audit == [{ by: "safety1", on: false }, { by: "admin2", on: true }]
              and tOpp(s, "t1").stage == "review" and safety)
  // The judge reads the teen pair with the strict rubric. Staff cannot approve an item the judge did not hold.
  run teenStrictRubricTest = init.then(teenPropose("t1")).then(teenJudge("t1", true))
    .expect(tOpp(s, "t1").approver == "judge" and tOpp(s, "t1").rubric == "minor" and safety)
  run teenStaffNotHeldTest = init.then(teenPropose("t1")).then(teenStaffApprove("t1", "reviewer1")).fail()
  // A held teen item needs a named staff member: no reviewer and the judge's own name are refused.
  run teenHeldNoReviewerTest = init.then(teenPropose("t1")).then(teenJudge("t1", false)).then(teenStaffApprove("t1", "")).fail()
  run teenHeldJudgeNameTest = init.then(teenPropose("t1")).then(teenJudge("t1", false)).then(teenStaffApprove("t1", JUDGE_NAME)).fail()
  run teenHeldStaffApprovesTest = init.then(teenPropose("t1")).then(teenJudge("t1", false)).then(teenStaffApprove("t1", "reviewer1"))
    .expect(tOpp(s, "t1").stage == "probing" and tOpp(s, "t1").approver == "staff" and safety)
  // p (16) with w (31), and p with q in a lane that is not a friendship lane, never reach review.
  run teenAdultTest = init.then(teenPropose("t3")).fail()
  run teenOtherLaneTest = init.then(teenPropose("t4")).fail()

  // q (17) and r (18) on 2026-11-21; r is 19 on the meeting day 2026-11-23, so the booking is refused.
  run teenNineteenAtBookingTest =
    init.then(teenPropose("t2")).then(teenJudge("t2", true))
      .then(teenYes("t2", "q")).then(teenYes("t2", "r"))
      .expect(tOpp(s, "t2").stage == "closed" and tOpp(s, "t2").closedReason == "no_common_time" and safety)

  // On 2026-11-22 r is 19 on the end of the scaled window: a proposal on that day is refused (the window end is
  // the max day of the rule); on 2026-11-21 the window ends while r is 18, so the proposal enters review.
  run teenNineteenAtWindowEndTest = init.then(teenNextDay).then(teenPropose("t2")).fail()
  run teenEighteenAtWindowEndTest =
    init.then(teenPropose("t2")).expect(tOpp(s, "t2").stage == "review" and safety)

  // On 2026-11-22 r is 19 on the end of the scaled window: the tick's sweep closes the probing item.
  run teenBirthdaySweepTest =
    init.then(teenPropose("t2")).then(teenJudge("t2", true))
      .then(teenNextDay)
      .expect(tOpp(s, "t2").stage == "closed" and tOpp(s, "t2").closedReason == "age_changed" and safety)

  // The stop cancels a booked teen meeting.
  run teenStopSweepTest =
    init.then(teenPropose("t1")).then(teenJudge("t1", true))
      .then(teenYes("t1", "p")).then(teenYes("t1", "q"))
      .then(teenStop("safety1"))
      .expect(tOpp(s, "t1").stage == "closed" and tOpp(s, "t1").closedReason == "teen_intros_off" and safety)

  // A report about q ends q's readiness, and the sweep closes the probing item.
  run teenReportSweepTest =
    init.then(teenPropose("t1")).then(teenJudge("t1", true))
      .then(teenReadyLost("q"))
      .expect(tOpp(s, "t1").stage == "closed" and tOpp(s, "t1").closedReason == "age_changed" and safety)

  // A small group p, q, u at an all-ages place: every member says yes and the group is booked.
  run teenGroupBookedTest =
    init.then(teenPropose("t5")).then(teenJudge("t5", true))
      .then(teenYes("t5", "p")).then(teenYes("t5", "q")).then(teenYes("t5", "u"))
      .expect(tOpp(s, "t5").stage == "scheduled" and tOpp(s, "t5").contacted == Set("p", "q", "u") and safety)
  // A group of 7 with a minor and a group at a place that is not all-ages never reach review.
  run teenGroupTooBigTest = init.then(teenPropose("t7")).fail()
  run teenGroupBarTest = init.then(teenPropose("t8")).fail()
  // The group q, u, r: r is 19 on the latest civil date of 2026-11-22, so the whole group closes, nobody is dropped.
  run teenGroupMemberTurns19Test =
    init.then(teenPropose("t6")).then(teenJudge("t6", true))
      .then(teenYes("t6", "q"))
      .then(teenNextDay)
      .expect(tOpp(s, "t6").stage == "closed" and tOpp(s, "t6").closedReason == "age_changed"
              and tOpp(s, "t6").contacted == Set("q", "u", "r") and safety)

  // Automated review (owner decision 2026-11-22, D15 to D17).
  // A judgment for a changed packet changes nothing: the item still waits for the judge.
  run judgeStalePacketTest =
    init.then(submit("o2")).then(settled).then(judgeRecord("o2", "approve", false, ALL_OPEN)).then(settled)
      .expect(op(s, "o2").stage == "review" and op(s, "o2").review.phase == "awaiting" and op(s, "o2").contacted == Set() and safety)
  // The judge flags the item: it waits for staff and nobody hears about it; staff cannot approve before the hold.
  run staffBeforeHoldTest = init.then(submit("o2")).then(settled).then(staffApprove("o2", ALL_OPEN)).fail()
  run judgeAfterHoldTest =
    init.then(submit("o2")).then(settled).then(judgeRecord("o2", "flag", true, ALL_OPEN)).then(settled)
      .then(judgeRecord("o2", "approve", true, ALL_OPEN)).fail()
  // A named staff member approves the held item: the probes start, with staff as approver.
  run heldStaffApprovesTest =
    init.then(submit("o2")).then(settled).then(judgeRecord("o2", "flag", true, ALL_OPEN)).then(settled)
      .expect(op(s, "o2").review.phase == "held" and op(s, "o2").contacted == Set() and safety)
      .then(staffApprove("o2", ALL_OPEN)).then(settled)
      .expect(op(s, "o2").stage == "probing" and op(s, "o2").review.approver == "staff" and safety)
  // A held item that nobody decides expires at its deadline, unsent.
  run heldExpiresTest =
    init.then(submit("o2")).then(settled).then(judgeRecord("o2", "cannot_run", true, ALL_OPEN)).then(settled)
      .then(tick(REVIEW_SLA + 1, ALL_OPEN)).then(settled)
      .expect(op(s, "o2").stage == "closed" and op(s, "o2").review.decision == "expired" and op(s, "o2").contacted == Set() and safety)
  // A staff approval stores no judged rosters, so a replacement closes the item (replacement_not_judged).
  run staffApprovalNoReplacementTest =
    init.then(submit("o2")).then(settled).then(judgeRecord("o2", "flag", true, ALL_OPEN)).then(settled)
      .then(staffApprove("o2", ALL_OPEN)).then(settled).then(probeSend("o2", "a", ALL_OPEN)).then(settled)
      .then(answer("a", "no", ALL_OPEN)).then(settled)
      .expect(op(s, "o2").stage == "closed" and op(s, "o2").closedReason == "replacement_not_judged" and op(s, "o2").revealSent == Set() and safety)
  // Staff stop an approved item after the first probe: it closes, and no names go out.
  run stopApprovedTest =
    init.then(submit("o2")).then(settled).then(judgeRecord("o2", "approve", true, ALL_OPEN)).then(settled)
      .then(probeSend("o2", "a", ALL_OPEN)).then(settled)
      .then(stopApproved("o2", ALL_OPEN)).then(settled)
      .expect(op(s, "o2").stage == "closed" and op(s, "o2").review.phase == "stopped" and op(s, "o2").revealSent == Set() and safety)
}
```
