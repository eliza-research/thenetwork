# Send-time recipient eligibility

Every message that the Network sends to a member asks this module first: the network's own send path, the queued Blooio and Eliza Cloud sends through the queue's recipient hook, relayed texts and re-engagement. The shell (`ConsentNetwork.checkRecipient` in `packages/network/src/network.ts`) reads the recipient's member record, trust level, open reports, blocks and the other people the message is about into typed facts. It removes the recipient from that list. The [outbound admission](outboundAdmission.md) module takes this verdict at the queue, where compliance messages skip it and where the dry-run line (`DryRunLine`), the person cap, line caps and quiet hours apply again. The [outreach policy](outreachPolicy.md) decides which kinds of message are about another member and so need an adult. Compliance messages (the STOP and HELP texts) never use this check: the service sends them directly.

## Story: Contact only a member who can get this message now

> As a member, I want the Network to send me nothing after I stop it, nothing about other people while I am a minor or on hold, and nothing about a person I blocked.

### Check the recipient's own state in a fixed order

New rule: before this module, `checkRecipient` held this order by hand. A person declined at join and an unknown member get nothing. Then a STOP or app leave refuses every message. A paused or restricted account gets only replies and safety notices. A held member (a trust hold, a ban, or an open report under review) gets only replies and safety notices, and no message about another member even as a reply. A member on "only when I ask" gets no proactive message and no new question outside a reply, except the one re-engagement message. The first refusal in this order is the verdict, so a later check never makes a refused send eligible.

```quint
import outreachPolicy as Outreach from "./outreachPolicy"

type RecipientVerdict = RecipientEligible | RecipientDeclined | RecipientUnknown | RecipientOptedOut |
  RecipientAccountRestricted | RecipientHeld | RecipientOnlyWhenAsked | RecipientMinor | RecipientOnWatch |
  RecipientBlockedPair | RecipientOtherNotMatchable | RecipientOtherHeld | RecipientOtherOnWatch

type RecipientFacts = { declined: bool, known: bool, optedOut: bool, accountRestricted: bool, held: bool,
  onlyWhenAsked: bool, notAdult: bool, onWatch: bool }
type RecipientSend = { kind: str, reply: bool, proactive: bool, askKind: bool }
type OtherParticipantFacts = { blocked: bool, present: bool, verifiedInvitee: bool, notAdult: bool,
  restricted: bool, declinedAtJoin: bool, reportHeld: bool, watched: bool }

pure val kindValues = Set("probe", "reveal", "safety", "reply", "reengage", "invite_notice", "cancellation", "info")
pure val okOther: OtherParticipantFacts = { blocked: false, present: true, verifiedInvitee: false, notAdult: false,
  restricted: false, declinedAtJoin: false, reportHeld: false, watched: false }
pure val othersValues = Set(
  List(), List(okOther), List(okOther, { ...okOther, blocked: true }), List({ ...okOther, notAdult: true }),
  List({ ...okOther, present: false }), List({ ...okOther, present: false, verifiedInvitee: true }),
  List({ ...okOther, reportHeld: true }), List({ ...okOther, watched: true }),
)

pure def recipientPassive(send: RecipientSend): bool = send.reply or send.kind == "safety"

pure def recipientOwnVerdict(recipient: RecipientFacts, send: RecipientSend): RecipientVerdict =
  val needsAdult = Outreach::outreachRequiresAdult(send.kind)
  if (recipient.declined) RecipientDeclined
  else if (not(recipient.known)) RecipientUnknown
  else if (recipient.optedOut) RecipientOptedOut
  else if (recipient.accountRestricted and not(recipientPassive(send))) RecipientAccountRestricted
  else if (recipient.held and (needsAdult or not(recipientPassive(send)))) RecipientHeld
  else if (recipient.onlyWhenAsked and send.kind != "reengage" and (send.proactive or (send.askKind and not(send.reply)))) RecipientOnlyWhenAsked
  else RecipientEligible

pure def lawOptedOutIsNeverEligible(kind: str, reply: bool, proactive: bool, askKind: bool, accountRestricted: bool,
    held: bool, onlyWhenAsked: bool, notAdult: bool, onWatch: bool): bool =
  recipientOwnVerdict({ declined: false, known: true, optedOut: true, accountRestricted: accountRestricted, held: held,
    onlyWhenAsked: onlyWhenAsked, notAdult: notAdult, onWatch: onWatch },
    { kind: kind, reply: reply, proactive: proactive, askKind: askKind }) == RecipientOptedOut

pure def lawDeclinedComesFirst(kind: str, reply: bool, known: bool, optedOut: bool, held: bool, notAdult: bool): bool =
  recipientOwnVerdict({ declined: true, known: known, optedOut: optedOut, accountRestricted: false, held: held,
    onlyWhenAsked: false, notAdult: notAdult, onWatch: false },
    { kind: kind, reply: reply, proactive: false, askKind: false }) == RecipientDeclined

pure def lawHeldGetsNothingAboutAnother(kind: str, reply: bool, proactive: bool, askKind: bool, onlyWhenAsked: bool): bool =
  Outreach::outreachRequiresAdult(kind) implies
    recipientOwnVerdict({ declined: false, known: true, optedOut: false, accountRestricted: false, held: true,
      onlyWhenAsked: onlyWhenAsked, notAdult: false, onWatch: false },
      { kind: kind, reply: reply, proactive: proactive, askKind: askKind }) == RecipientHeld
```

### A message about another member needs two adults with no block between them

New rule: before this module, `checkRecipient` held these checks by hand. Only the kinds that outreach policy marks as about another member need these checks. For those kinds, a minor recipient and a recipient on watch get nothing. Then the module checks each other person the message is about. A block in either direction refuses the send. An unknown person, a minor, a paused or restricted account, or a person declined at join cannot be in the message. The one exception is an invitation notice about a verified invitee who joined and has no member record in this app yet. An open report on another person, or another person on watch, refuses the send. Each check covers every other person before the next check, so the verdict names the first failed check, not the first failed person. Neutral cancellations, replies and safety notices do not take these checks: a minor can get the notice that a plan is off. Changed in review: the age fact is now "not a known adult" (`notAdult`) for the recipient and for each other person, in place of the minor flag alone. The shell sets it for a minor, a minor signal or report, an unknown or conflicting age, and a lowest known age that cannot be matched, the same reading as every other adult gate in the Network, because the product rule says that an unknown age is not eligible and the minor flag alone let a member with no age on record get or be named in a message about another member. The refusal reasons stay "minor" and "other_not_matchable".

```quint
pure def otherParticipantSkipped(kind: str, other: OtherParticipantFacts): bool =
  not(other.present) and kind == "invite_notice" and not(other.declinedAtJoin) and other.verifiedInvitee

pure def otherParticipantUnmatchable(kind: str, other: OtherParticipantFacts): bool =
  not(otherParticipantSkipped(kind, other)) and
    (not(other.present) or other.notAdult or other.restricted or other.declinedAtJoin)

pure def anyOtherBlocked(others: List[OtherParticipantFacts]): bool = others.some(o => o.blocked)
pure def anyOtherUnmatchable(kind: str, others: List[OtherParticipantFacts]): bool =
  others.some(o => otherParticipantUnmatchable(kind, o))
pure def anyOtherHeld(kind: str, others: List[OtherParticipantFacts]): bool =
  others.some(o => not(otherParticipantSkipped(kind, o)) and o.reportHeld)
pure def anyOtherWatched(kind: str, others: List[OtherParticipantFacts]): bool =
  others.some(o => not(otherParticipantSkipped(kind, o)) and o.watched)

pure def recipientVerdict(recipient: RecipientFacts, send: RecipientSend, others: List[OtherParticipantFacts]): RecipientVerdict =
  val own = recipientOwnVerdict(recipient, send)
  if (own != RecipientEligible) own
  else if (not(Outreach::outreachRequiresAdult(send.kind))) RecipientEligible
  else if (recipient.notAdult) RecipientMinor
  else if (recipient.onWatch) RecipientOnWatch
  else if (anyOtherBlocked(others)) RecipientBlockedPair
  else if (anyOtherUnmatchable(send.kind, others)) RecipientOtherNotMatchable
  else if (anyOtherHeld(send.kind, others)) RecipientOtherHeld
  else if (anyOtherWatched(send.kind, others)) RecipientOtherOnWatch
  else RecipientEligible

pure def lawNotAdultNeverGetsMessageAboutAnother(kind: str, reply: bool, proactive: bool, askKind: bool,
    held: bool, onlyWhenAsked: bool, onWatch: bool, others: List[OtherParticipantFacts]): bool =
  Outreach::outreachRequiresAdult(kind) implies
    recipientVerdict({ declined: false, known: true, optedOut: false, accountRestricted: false, held: held,
      onlyWhenAsked: onlyWhenAsked, notAdult: true, onWatch: onWatch },
      { kind: kind, reply: reply, proactive: proactive, askKind: askKind }, others) != RecipientEligible

pure def lawNotAdultOtherIsNeverInMessage(kind: str, reply: bool, proactive: bool, others: List[OtherParticipantFacts]): bool =
  (Outreach::outreachRequiresAdult(kind) and others.some(o => o.notAdult and o.present)) implies
    recipientVerdict({ declined: false, known: true, optedOut: false, accountRestricted: false, held: false,
      onlyWhenAsked: false, notAdult: false, onWatch: false },
      { kind: kind, reply: reply, proactive: proactive, askKind: false }, others) != RecipientEligible

pure def lawBlockedPairIsNeverEligible(kind: str, reply: bool, proactive: bool, notAdult: bool, onWatch: bool,
    others: List[OtherParticipantFacts]): bool =
  (Outreach::outreachRequiresAdult(kind) and anyOtherBlocked(others)) implies
    recipientVerdict({ declined: false, known: true, optedOut: false, accountRestricted: false, held: false,
      onlyWhenAsked: false, notAdult: notAdult, onWatch: onWatch },
      { kind: kind, reply: reply, proactive: proactive, askKind: false }, others) != RecipientEligible

pure def lawRefusalIsFinal(kind: str, reply: bool, proactive: bool, askKind: bool, declined: bool, known: bool,
    optedOut: bool, accountRestricted: bool, held: bool, onlyWhenAsked: bool, notAdult: bool, onWatch: bool,
    others: List[OtherParticipantFacts]): bool =
  val recipient = { declined: declined, known: known, optedOut: optedOut, accountRestricted: accountRestricted,
    held: held, onlyWhenAsked: onlyWhenAsked, notAdult: notAdult, onWatch: onWatch }
  val send = { kind: kind, reply: reply, proactive: proactive, askKind: askKind }
  recipientOwnVerdict(recipient, send) != RecipientEligible implies
    recipientVerdict(recipient, send, others) == recipientOwnVerdict(recipient, send)
```

### The refusal reason names the failed check

New rule: the shell logs the reason and the queue stores it. The reasons are the same strings as before this module. The shell adds the account state to the account reason ("account_paused").

```quint
pure def recipientRefusalReason(verdict: RecipientVerdict): str =
  match verdict {
    | RecipientEligible => ""
    | RecipientDeclined => "declined"
    | RecipientUnknown => "unknown_member"
    | RecipientOptedOut => "opted_out"
    | RecipientAccountRestricted => "account"
    | RecipientHeld => "held"
    | RecipientOnlyWhenAsked => "only_when_asked"
    | RecipientMinor => "minor"
    | RecipientOnWatch => "on_watch"
    | RecipientBlockedPair => "blocked_pair"
    | RecipientOtherNotMatchable => "other_not_matchable"
    | RecipientOtherHeld => "other_held"
    | RecipientOtherOnWatch => "other_on_watch"
  }

pure def lawOnlyEligibleHasNoReason(verdict: RecipientVerdict): bool =
  (recipientRefusalReason(verdict) == "") iff (verdict == RecipientEligible)
```

### Quiet hours hold every send that can wait

New rule: before this module, `timingOk` held this rule by hand. A send that must go now (a reply, a safety notice, a minor-signal cancellation) goes at once. Every other send waits through the member's quiet hours. A logistics message may go at any other time. An interruption also needs the member's send window.

```quint
type RecipientTiming = TimingNow | TimingLogistics | TimingSlot

pure def recipientTimingAllowed(timing: RecipientTiming, quiet: bool, inWindow: bool): bool =
  timing == TimingNow or (not(quiet) and (timing == TimingLogistics or inWindow))

pure def lawQuietHoursHoldEveryWaitingSend(timing: RecipientTiming, inWindow: bool): bool =
  timing != TimingNow implies not(recipientTimingAllowed(timing, true, inWindow))

pure def lawInterruptionNeedsWindow(quiet: bool): bool =
  not(recipientTimingAllowed(TimingSlot, quiet, false))
```
