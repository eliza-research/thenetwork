# Send-time recipient eligibility

Every message that the Network sends to a member asks this module first: the network's own send path, the queued Blooio and Eliza Cloud sends through the queue's recipient hook, relayed texts and re-engagement. The shell (`ConsentNetwork.checkRecipient` in `packages/network/src/network.ts`) reads the recipient's member record, trust level, open reports, blocks and the other people the message is about into typed facts. It removes the recipient from that list. The [outbound admission](outboundAdmission.md) module takes this verdict at the queue, where compliance messages skip it and where the dry-run line (`DryRunLine`), the person cap, line caps and quiet hours apply again. The [outreach policy](outreachPolicy.md) decides which kinds of message are about another member and so need an adult. Compliance messages (the STOP and HELP texts) never use this check: the service sends them directly.

## Story: Contact only a member who can get this message now

> As a member, I want the Network to send me nothing after I stop it, nothing about other people while I am on hold or while I am a minor outside a current teen friendship introduction, and nothing about a person I blocked.

### Check the recipient's own state in a fixed order

A person declined at join and an unknown member get nothing. Then a STOP or app leave refuses every message. A paused or restricted account gets only replies and safety notices. A matching question (a probe) goes only to a member whose matching is active: their record is not paused or closed, and they opted in to the item's category (`matchingStopped`). A held member (a trust hold, a ban, or an open report under review) gets only replies and safety notices, and no message about another member even as a reply. A member on "only when I ask" gets no proactive message and no new question outside a reply, except the one re-engagement message. The first refusal in this order is the verdict, so a later check never makes a refused send eligible. Changed (recipient check moved to the spec): `checkRecipient` held this order in its own code -> this rule holds it, because the shell must not compute a decision. Changed (merge with develop, probe gates): the shell refused a probe to a member whose matching stopped after the verdict -> this rule refuses it with `RecipientMatchingNotActive` before the hold check, the upstream order.

```quint
import outreachPolicy as Outreach from "./outreachPolicy"

type RecipientVerdict = RecipientEligible | RecipientDeclined | RecipientUnknown | RecipientOptedOut |
  RecipientAccountRestricted | RecipientMatchingNotActive | RecipientHeld | RecipientOnlyWhenAsked | RecipientMinor | RecipientOnWatch |
  RecipientBlockedPair | RecipientOtherNotMatchable | RecipientOtherHeld | RecipientOtherOnWatch

type RecipientFacts = { declined: bool, known: bool, optedOut: bool, accountRestricted: bool, matchingStopped: bool,
  held: bool, onlyWhenAsked: bool, notAdult: bool, onWatch: bool }
type RecipientSend = { kind: str, reply: bool, proactive: bool, askKind: bool, teenItem: bool }
type OtherParticipantFacts = { blocked: bool, avoided: bool, present: bool, verifiedInvitee: bool, notAdult: bool,
  restricted: bool, matchingStopped: bool, declinedAtJoin: bool, reportHeld: bool, watched: bool }

pure val kindValues = Set("probe", "reveal", "safety", "reply", "reengage", "invite_notice", "cancellation", "info")
pure val okOther: OtherParticipantFacts = { blocked: false, avoided: false, present: true, verifiedInvitee: false, notAdult: false,
  restricted: false, matchingStopped: false, declinedAtJoin: false, reportHeld: false, watched: false }
pure val othersValues = Set(
  List(), List(okOther), List(okOther, { ...okOther, blocked: true }), List({ ...okOther, notAdult: true }),
  List({ ...okOther, present: false }), List({ ...okOther, present: false, verifiedInvitee: true }),
  List({ ...okOther, reportHeld: true }), List({ ...okOther, watched: true }),
  List({ ...okOther, avoided: true }), List({ ...okOther, matchingStopped: true }),
)

pure def recipientPassive(send: RecipientSend): bool = send.reply or send.kind == "safety"

pure def recipientOwnVerdict(recipient: RecipientFacts, send: RecipientSend): RecipientVerdict =
  val needsAdult = Outreach::outreachRequiresAdult(send.kind)
  if (recipient.declined) RecipientDeclined
  else if (not(recipient.known)) RecipientUnknown
  else if (recipient.optedOut) RecipientOptedOut
  else if (recipient.accountRestricted and not(recipientPassive(send))) RecipientAccountRestricted
  else if (send.kind == "probe" and recipient.matchingStopped) RecipientMatchingNotActive
  else if (recipient.held and (needsAdult or not(recipientPassive(send)))) RecipientHeld
  else if (recipient.onlyWhenAsked and send.kind != "reengage" and (send.proactive or (send.askKind and not(send.reply)))) RecipientOnlyWhenAsked
  else RecipientEligible

pure def lawOptedOutIsNeverEligible(kind: str, reply: bool, proactive: bool, askKind: bool, accountRestricted: bool,
    held: bool, onlyWhenAsked: bool, notAdult: bool, onWatch: bool): bool =
  recipientOwnVerdict({ declined: false, known: true, optedOut: true, accountRestricted: accountRestricted, matchingStopped: false, held: held,
    onlyWhenAsked: onlyWhenAsked, notAdult: notAdult, onWatch: onWatch },
    { kind: kind, reply: reply, proactive: proactive, askKind: askKind, teenItem: false }) == RecipientOptedOut

pure def lawDeclinedComesFirst(kind: str, reply: bool, known: bool, optedOut: bool, held: bool, notAdult: bool): bool =
  recipientOwnVerdict({ declined: true, known: known, optedOut: optedOut, accountRestricted: false, matchingStopped: false, held: held,
    onlyWhenAsked: false, notAdult: notAdult, onWatch: false },
    { kind: kind, reply: reply, proactive: false, askKind: false, teenItem: false }) == RecipientDeclined

pure def lawHeldGetsNothingAboutAnother(kind: str, reply: bool, proactive: bool, askKind: bool, onlyWhenAsked: bool): bool =
  Outreach::outreachRequiresAdult(kind) implies
    recipientOwnVerdict({ declined: false, known: true, optedOut: false, accountRestricted: false, matchingStopped: false, held: true,
      onlyWhenAsked: onlyWhenAsked, notAdult: false, onWatch: false },
      { kind: kind, reply: reply, proactive: proactive, askKind: askKind, teenItem: false }) == RecipientHeld
```

### A message about another member needs two adults with no block between them

Only the kinds that outreach policy marks as about another member need these checks. For those kinds, a recipient who is not a known adult and a recipient on watch get nothing. Then the module checks each other person the message is about. A block in either direction refuses the send. An unknown person, a person who is not a known adult, a paused or restricted account, or a person declined at join cannot be in the message. An invitation notice about a verified invitee who joined and has no member record in this app yet is the one exception for a missing person. An open report on another person, or another person on watch, refuses the send. For a probe, an avoid edge between the two counts as a block, and another person whose matching stopped (a paused or closed record, or no opt-in to the item's category) cannot be in the message. Each check covers every other person before the next check, so the verdict names the first failed check, not the first failed person. Neutral cancellations, replies and safety notices do not take these checks: a minor can get the notice that a plan is off. The age fact is "not a known adult" (`notAdult`) for the recipient and for each other person: the shell sets it for a minor, a minor signal or report, an unknown or conflicting age, and a lowest known age that cannot be matched. The send fact `teenItem` is true when the message belongs to a teen friendship item that is current under the age rule of [friend introductions with a minor](friendIntroAge.md); the shell reads it from the item's whole roster. Only for a teen item kind of [outreach policy](outreachPolicy.md) (`outreachTeenItemKind`) with `teenItem` does the age fact not refuse the send; every other check stays. Changed (owner decision 2026-11-22, D1): the shell cleared the age fact by hand for every kind when the item was a current teen item -> the module skips the age fact only for the teen item kinds, because growth, invitation, home-help, "worthwhile" and re-engagement messages stay adult-only. Changed (merge with develop, probe gates): the shell folded an avoid edge into `blocked` and another person's stopped matching into `restricted` for a probe -> the module reads the `avoided` and `matchingStopped` facts only for a probe, because the shell must not compute a decision.

```quint
pure def otherParticipantSkipped(kind: str, other: OtherParticipantFacts): bool =
  not(other.present) and kind == "invite_notice" and not(other.declinedAtJoin) and other.verifiedInvitee

pure def recipientAgeExempt(send: RecipientSend): bool =
  send.teenItem and Outreach::outreachTeenItemKind(send.kind)

pure def otherParticipantUnmatchable(send: RecipientSend, other: OtherParticipantFacts): bool =
  not(otherParticipantSkipped(send.kind, other)) and
    (not(other.present) or (other.notAdult and not(recipientAgeExempt(send))) or other.restricted or other.declinedAtJoin
    or (send.kind == "probe" and other.matchingStopped))

pure def anyOtherBlocked(kind: str, others: List[OtherParticipantFacts]): bool =
  others.some(o => o.blocked or (kind == "probe" and o.avoided))
pure def anyOtherUnmatchable(send: RecipientSend, others: List[OtherParticipantFacts]): bool =
  others.some(o => otherParticipantUnmatchable(send, o))
pure def anyOtherHeld(kind: str, others: List[OtherParticipantFacts]): bool =
  others.some(o => not(otherParticipantSkipped(kind, o)) and o.reportHeld)
pure def anyOtherWatched(kind: str, others: List[OtherParticipantFacts]): bool =
  others.some(o => not(otherParticipantSkipped(kind, o)) and o.watched)

pure def recipientVerdict(recipient: RecipientFacts, send: RecipientSend, others: List[OtherParticipantFacts]): RecipientVerdict =
  val own = recipientOwnVerdict(recipient, send)
  if (own != RecipientEligible) own
  else if (not(Outreach::outreachRequiresAdult(send.kind))) RecipientEligible
  else if (recipient.notAdult and not(recipientAgeExempt(send))) RecipientMinor
  else if (recipient.onWatch) RecipientOnWatch
  else if (anyOtherBlocked(send.kind, others)) RecipientBlockedPair
  else if (anyOtherUnmatchable(send, others)) RecipientOtherNotMatchable
  else if (anyOtherHeld(send.kind, others)) RecipientOtherHeld
  else if (anyOtherWatched(send.kind, others)) RecipientOtherOnWatch
  else RecipientEligible

pure def lawNotAdultNeverGetsMessageAboutAnother(kind: str, reply: bool, proactive: bool, askKind: bool,
    held: bool, onlyWhenAsked: bool, onWatch: bool, others: List[OtherParticipantFacts]): bool =
  Outreach::outreachRequiresAdult(kind) implies
    recipientVerdict({ declined: false, known: true, optedOut: false, accountRestricted: false, matchingStopped: false, held: held,
      onlyWhenAsked: onlyWhenAsked, notAdult: true, onWatch: onWatch },
      { kind: kind, reply: reply, proactive: proactive, askKind: askKind, teenItem: false }, others) != RecipientEligible

pure def lawNotAdultOtherIsNeverInMessage(kind: str, reply: bool, proactive: bool, teenItem: bool, others: List[OtherParticipantFacts]): bool =
  (Outreach::outreachRequiresAdult(kind) and not(teenItem and Outreach::outreachTeenItemKind(kind)) and others.some(o => o.notAdult and o.present)) implies
    recipientVerdict({ declined: false, known: true, optedOut: false, accountRestricted: false, matchingStopped: false, held: false,
      onlyWhenAsked: false, notAdult: false, onWatch: false },
      { kind: kind, reply: reply, proactive: proactive, askKind: false, teenItem: teenItem }, others) != RecipientEligible

pure def lawBlockedPairIsNeverEligible(kind: str, reply: bool, proactive: bool, notAdult: bool, onWatch: bool,
    teenItem: bool, others: List[OtherParticipantFacts]): bool =
  (Outreach::outreachRequiresAdult(kind) and anyOtherBlocked(kind, others)) implies
    recipientVerdict({ declined: false, known: true, optedOut: false, accountRestricted: false, matchingStopped: false, held: false,
      onlyWhenAsked: false, notAdult: notAdult, onWatch: onWatch },
      { kind: kind, reply: reply, proactive: proactive, askKind: false, teenItem: teenItem }, others) != RecipientEligible

pure def lawAdultOnlyKindNeverReachesMinor(kind: str, reply: bool, proactive: bool, askKind: bool, teenItem: bool,
    others: List[OtherParticipantFacts]): bool =
  (Outreach::outreachRequiresAdult(kind) and not(Outreach::outreachTeenItemKind(kind))) implies
    recipientVerdict({ declined: false, known: true, optedOut: false, accountRestricted: false, matchingStopped: false, held: false,
      onlyWhenAsked: false, notAdult: true, onWatch: false },
      { kind: kind, reply: reply, proactive: proactive, askKind: askKind, teenItem: teenItem }, others) == RecipientMinor

pure def lawTeenItemStillRefusesABlock(kind: str, others: List[OtherParticipantFacts]): bool =
  (Outreach::outreachRequiresAdult(kind) and anyOtherBlocked(kind, others)) implies
    recipientVerdict({ declined: false, known: true, optedOut: false, accountRestricted: false, matchingStopped: false, held: false,
      onlyWhenAsked: false, notAdult: true, onWatch: false },
      { kind: kind, reply: false, proactive: false, askKind: false, teenItem: true }, others) != RecipientEligible

pure def lawRefusalIsFinal(kind: str, reply: bool, proactive: bool, askKind: bool, declined: bool, known: bool,
    optedOut: bool, accountRestricted: bool, matchingStopped: bool, held: bool, onlyWhenAsked: bool, notAdult: bool,
    onWatch: bool, others: List[OtherParticipantFacts]): bool =
  val recipient = { declined: declined, known: known, optedOut: optedOut, accountRestricted: accountRestricted,
    matchingStopped: matchingStopped, held: held, onlyWhenAsked: onlyWhenAsked, notAdult: notAdult, onWatch: onWatch }
  val send = { kind: kind, reply: reply, proactive: proactive, askKind: askKind, teenItem: false }
  recipientOwnVerdict(recipient, send) != RecipientEligible implies
    recipientVerdict(recipient, send, others) == recipientOwnVerdict(recipient, send)
```

### The refusal reason names the failed check

The shell logs the reason and the queue stores it. The shell adds the account state to the account reason ("account_paused"). Changed (recipient check moved to the spec): the shell wrote each reason string in its own code -> this rule names them, with the same strings, because the shell must not compute a decision.

```quint
pure def recipientRefusalReason(verdict: RecipientVerdict): str =
  match verdict {
    | RecipientEligible => ""
    | RecipientDeclined => "declined"
    | RecipientUnknown => "unknown_member"
    | RecipientOptedOut => "opted_out"
    | RecipientAccountRestricted => "account"
    | RecipientMatchingNotActive => "matching_not_active"
    | RecipientHeld => "held"
    | RecipientOnlyWhenAsked => "only_when_asked"
    | RecipientMinor => "minor"
    | RecipientOnWatch => "on_watch"
    | RecipientBlockedPair => "blocked_pair"
    | RecipientOtherNotMatchable => "other_not_matchable"
    | RecipientOtherHeld => "other_held"
    | RecipientOtherOnWatch => "other_on_watch"
  }

pure def lawProbeNeedsActiveMatching(reply: bool, proactive: bool, others: List[OtherParticipantFacts]): bool =
  recipientVerdict({ declined: false, known: true, optedOut: false, accountRestricted: false, matchingStopped: true,
    held: false, onlyWhenAsked: false, notAdult: false, onWatch: false },
    { kind: "probe", reply: reply, proactive: proactive, askKind: true, teenItem: false }, others) == RecipientMatchingNotActive

pure def lawProbeRefusesAvoidedOrStoppedOther(others: List[OtherParticipantFacts]): bool =
  others.some(o => o.avoided or (o.present and o.matchingStopped)) implies
    recipientVerdict({ declined: false, known: true, optedOut: false, accountRestricted: false, matchingStopped: false,
      held: false, onlyWhenAsked: false, notAdult: false, onWatch: false },
      { kind: "probe", reply: false, proactive: false, askKind: true, teenItem: false }, others) != RecipientEligible

pure def lawOnlyEligibleHasNoReason(verdict: RecipientVerdict): bool =
  (recipientRefusalReason(verdict) == "") iff (verdict == RecipientEligible)
```

### Quiet hours hold every send that can wait

A send that must go now (a reply, a safety notice, a minor-signal cancellation) goes at once. Every other send waits through the member's quiet hours. A logistics message may go at any other time. An interruption also needs the member's send window. Changed (recipient check moved to the spec): `timingOk` held this rule in its own code -> this rule holds it, because the shell must not compute a decision.

```quint
type RecipientTiming = TimingNow | TimingLogistics | TimingSlot

pure def recipientTimingAllowed(timing: RecipientTiming, quiet: bool, inWindow: bool): bool =
  timing == TimingNow or (not(quiet) and (timing == TimingLogistics or inWindow))

pure def lawQuietHoursHoldEveryWaitingSend(timing: RecipientTiming, inWindow: bool): bool =
  timing != TimingNow implies not(recipientTimingAllowed(timing, true, inWindow))

pure def lawInterruptionNeedsWindow(quiet: bool): bool =
  not(recipientTimingAllowed(TimingSlot, quiet, false))
```
