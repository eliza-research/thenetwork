# Gateway turn receipt journey

An adult member texts STOP on the shared line. The signed turn collects one reply. The [turn receipt rules](turnReceipt.md) govern the gateway's later reports about that reply. The driver submits each report through signed HTTP and reads the stored receipt and reply status from Postgres. No provider sends the reply during the journey.

## Story: Keep a single delivery result for a collected reply

> As an operator, I want an unknown delivery result to settle when the gateway learns what happened and an identical report to replay without replacing it.

### A receipt and its reply status change together

The initial reply is collected and has no receipt. The gateway reports an unknown result, an acceptance with a provider ID, or a rejection. Each stored result sets the status of the original reply. An unknown result can advance to acceptance or rejection.

```quint
import turnReceipt as Receipt from "./turnReceipt"

type DeliveryReport = UnknownReport | AcceptedReport | AlternativeAcceptance | RejectedReport
type ReceiptObservation = NoReceipt | SavedReceipt({ report: DeliveryReport })
type ReceiptJourneyResult = ReportStored | ReportReplayed | ReportConflict
type ReceiptJourney = { receipt: ReceiptObservation, replyStatus: str }
type ReceiptJourneyStep = { state: ReceiptJourney, out: List[ReceiptJourneyResult] }

pure val initial: ReceiptJourney = { receipt: NoReceipt, replyStatus: "collected" }

pure def delivery(report: DeliveryReport): str =
  if (report == UnknownReport) "unknown"
  else if (report == RejectedReport) "rejected"
  else "accepted"

pure def hasReceipt(r: ReceiptObservation): bool =
  match r {
    | NoReceipt => false
    | _ => true
  }

pure def receiptIs(r: ReceiptObservation, report: DeliveryReport): bool =
  match r {
    | SavedReceipt(saved) => saved.report == report
    | _ => false
  }

pure def replyStatusFor(receipt: ReceiptObservation): str =
  match receipt {
    | NoReceipt => "collected"
    | SavedReceipt(saved) => Receipt::receiptMessageStatus(delivery(saved.report))
  }

pure def alwaysReplyStatusMatchesReceipt(s: ReceiptJourney): bool = s.replyStatus == replyStatusFor(s.receipt)
pure def sometimesStoresAnUnknownReceipt(s: ReceiptJourney): bool = receiptIs(s.receipt, UnknownReport)
pure def sometimesStoresAnAcceptedReceipt(s: ReceiptJourney): bool = receiptIs(s.receipt, AcceptedReport)
pure def sometimesStoresARejectedReceipt(s: ReceiptJourney): bool = receiptIs(s.receipt, RejectedReport)
```

### An exact replay leaves both records unchanged

An identical report returns a replay. A different report after a final result returns a conflict. This includes an acceptance with a different provider ID. The receipt and reply status stay unchanged on either response.

```quint
pure def canReportDelivery(s: ReceiptJourney, report: DeliveryReport): bool = true
pure def reportDelivery(s: ReceiptJourney, report: DeliveryReport): ReceiptJourneyStep =
  val incoming = SavedReceipt({ report: report })
  val previous = Receipt::readPrevious({ phase: Receipt::CheckingPrevious }, receiptIs(s.receipt, report),
    hasReceipt(s.receipt), receiptIs(s.receipt, UnknownReport), Receipt::receiptFinal(delivery(report)))
  if (Receipt::canCheckScope(previous))
    { state: { receipt: incoming, replyStatus: replyStatusFor(incoming) }, out: List(ReportStored) }
  else
    { state: s, out: List(if (previous.phase == Receipt::Replayed) ReportReplayed else ReportConflict) }

pure def stepAStoredFinalReportStays(before: ReceiptJourney, after: ReceiptJourney): bool =
  (hasReceipt(before.receipt) and not(receiptIs(before.receipt, UnknownReport))) implies after == before
```
