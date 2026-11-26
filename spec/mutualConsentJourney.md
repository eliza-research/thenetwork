# Book a reviewed introduction after mutual consent

Two members use friends.help to arrange a climbing session. The proposal passed review by the judge, or by staff for an exception (owner decision 2026-11-22, D15 to D17: review by a person was replaced by the review judge). The requester has the first anonymous probe, and the other member waits for a probe of their own. The fixture supplies a shared time and starts at 14:00 Friday in New York. The [probe rules](probeDispatch.md), [opportunity lifecycle](opportunityLifecycle.md), and [gateway receipt rules](turnReceipt.md) govern the steps.

## Story: Book the introduction only after both members agree

> As a participant, I want the Network to wait for an explicit yes from each of us before sending the booking details.

### A reply can advance only the probe addressed to that participant

A qualified answer leaves the current probe open. An unsolicited yes from the other participant does not count before the Network sends their probe. The requester's explicit yes to an offered time opens the other participant's turn. Their explicit yes after their probe books one meeting and makes one booking message for each participant. Repeated replies do not book again.

```quint
import probeDispatch as Probe from "./probeDispatch"
import opportunityLifecycle as Opportunity from "./opportunityLifecycle"

type ConsentSide = Requester | Partner
type ConsentAnswer = ExplicitYes | QualifiedAnswer
type ConsentPhase = WaitingForRequester | WaitingForPartnerWindow | WaitingForPartner | MeetingScheduled
type ReceiptResult = BookingReceiptStored | BookingReceiptReplayed
type MutualConsentJourney = { phase: ConsentPhase, partnerReplies: int, lateWindow: bool, partnerProbeCount: int, bookingCount: int, partnerBookingSent: bool }
type ConsentStep = { state: MutualConsentJourney, out: List[ReceiptResult] }

pure val initial: MutualConsentJourney =
  { phase: WaitingForRequester, partnerReplies: 3, lateWindow: false, partnerProbeCount: 0, bookingCount: 0, partnerBookingSent: false }

pure def canReplyToProbe(s: MutualConsentJourney, byMember: ConsentSide, answer: ConsentAnswer): bool = true
pure def replyToProbe(s: MutualConsentJourney, byMember: ConsentSide, answer: ConsentAnswer): ConsentStep =
  val requesterAgreed = s.phase == WaitingForRequester and byMember == Requester and answer == ExplicitYes
  val partnerAgreed = s.phase == WaitingForPartner and byMember == Partner and answer == ExplicitYes
  val replies = if (byMember == Partner and s.partnerReplies < 5) s.partnerReplies + 1 else s.partnerReplies
  val observed = { ...s, partnerReplies: replies }
  val consentState =
    if (Probe::canOpenTurn(Probe::initial, false, requesterAgreed))
      if (s.lateWindow or s.partnerReplies < 5) { ...observed, phase: WaitingForPartner, partnerProbeCount: 1 }
      else { ...observed, phase: WaitingForPartnerWindow }
    else if (Opportunity::canBook({ phase: Opportunity::Probing, approved: true }, partnerAgreed))
      { ...observed, phase: MeetingScheduled, bookingCount: 2 }
    else observed
  { state: consentState, out: List() }

pure def alwaysPartnerProbeFollowsRequesterAgreement(s: MutualConsentJourney): bool =
  s.partnerProbeCount == (if (s.phase == WaitingForRequester or s.phase == WaitingForPartnerWindow) 0 else 1)
pure def alwaysBookingFollowsBothAgreements(s: MutualConsentJourney): bool =
  s.bookingCount == (if (s.phase == MeetingScheduled) 2 else 0)
pure def sometimesPartnerGetsAProbe(s: MutualConsentJourney): bool = s.phase == WaitingForPartner
pure def sometimesBothAgreeToBook(s: MutualConsentJourney): bool = s.phase == MeetingScheduled
```

### The partner probe waits for their send window

The partner starts with three Friday afternoon onboarding replies. Two more afternoon replies before the requester agrees make a five-sample weekday profile, which moves the partner's send slot later than the fixture's current time. Open the partner's turn and defer the anonymous probe. At 16:59 the fixture is inside the learned window, including the per-member offset. A tick can then send one probe with the requester's chosen time.

```quint
pure def canReachLateSendWindow(s: MutualConsentJourney): bool = true
pure def reachLateSendWindow(s: MutualConsentJourney): ConsentStep =
  { state: if (s.phase == WaitingForPartnerWindow) { ...s, lateWindow: true, phase: WaitingForPartner, partnerProbeCount: 1 }
    else { ...s, lateWindow: true }, out: List() }

pure def alwaysReplySamplesAreBounded(s: MutualConsentJourney): bool = s.partnerReplies >= 3 and s.partnerReplies <= 5
pure def sometimesPartnerWaitsForLearnedWindow(s: MutualConsentJourney): bool = s.phase == WaitingForPartnerWindow
```

### Collection and gateway acceptance remain distinct

The booking for the author of the second yes is collected by their signed turn. It stays collected until the gateway acknowledges the exact reply. An accepted receipt marks the booking sent, and the same receipt replays without adding a message or another booking.

```quint
pure def canRecordBookingReceipt(s: MutualConsentJourney): bool = s.phase == MeetingScheduled
pure def recordBookingReceipt(s: MutualConsentJourney): ConsentStep =
  { state: { ...s, partnerBookingSent: true },
    out: List(if (s.partnerBookingSent) BookingReceiptReplayed else BookingReceiptStored) }

pure def stepNoOtherActionChangesDelivery(before: MutualConsentJourney, via: str, after: MutualConsentJourney): bool =
  (via != "recordBookingReceipt" implies before.partnerBookingSent == after.partnerBookingSent) and
  (before.partnerBookingSent implies after.partnerBookingSent)
pure def sometimesGatewayAcceptsTheBooking(s: MutualConsentJourney): bool = s.partnerBookingSent
```
