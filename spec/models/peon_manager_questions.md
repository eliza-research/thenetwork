# Peon manager questions

## Story: Answer the hiring question I see

A manager can confirm a posting and respond to reviewed introductions in the same thread. Each reply belongs to the current question. The same introduction uses a new delivery receipt after a posting interrupts its question.

### Use one question and keep its deadline

The [hiring dispatch rule](../peonHireDispatch.md#a-manager-answers-one-hiring-question-at-a-time) provides the slot, delivery and deadline decisions. This model starts at the applicant's exact consent, after staff review. Two eligible introductions share one manager. Time and receipts are small integers. The service checks the real posting, applicant, and provider receipt before delivering or accepting a reply.

```quint
// quint-check: max-steps=24 max-samples=2000 verify-steps=6
module peon_manager_questions {
  pure val ITEMS = Set("A", "B")
  pure val LIMIT = 10
  pure val ANSWER_WINDOW = 4
  type Desk = {
    now: int, sequence: int, owner: str, slot: int, accepted: bool, suspended: str,
    displaced: int, displacedDeadline: int, waiting: str -> int, firstSent: str -> int, settled: Set[str]
  }
  var desk: Desk

  action init = desk' = {
    now: 0, sequence: 0, owner: "", slot: 0, accepted: false, suspended: "",
    displaced: 0, displacedDeadline: 0,
    waiting: ITEMS.mapBy(i => 0), firstSent: ITEMS.mapBy(i => -1), settled: Set()
  }

  def deadline(id: str): int = {
    val sent = desk.firstSent.get(id)
    if (sent >= 0 and sent + ANSWER_WINDOW < LIMIT) sent + ANSWER_WINDOW else LIMIT
  }

  def waiting(id: str): bool =
    desk.waiting.get(id) > 0 and not(desk.settled.contains(id)) and desk.now < deadline(id)

  def currentDelivery(id: str, receipt: int): bool =
    desk.owner == id and receipt > 0 and desk.slot == receipt and desk.now < deadline(id)

  def oldest(id: str): bool = {
    val resume = if (desk.suspended != "") waiting(desk.suspended) else false
    if (resume) desk.suspended == id
    else ITEMS.forall(other => waiting(other) implies desk.waiting.get(id) <= desk.waiting.get(other))
  }

  action applicantAccepts(id: str): bool = all {
    desk.waiting.get(id) == 0,
    desk.now < LIMIT,
    desk' = { ...desk, waiting: desk.waiting.set(id, desk.sequence + 1), sequence: desk.sequence + 1 },
  }

  action startPosting: bool = all {
    desk.owner != "posting",
    val interrupted = ITEMS.contains(desk.owner)
    all {
      desk' = { ...desk, owner: "posting", slot: 0, accepted: false,
        suspended: if (interrupted) desk.owner else desk.suspended,
        displaced: if (interrupted) desk.slot else desk.displaced,
        displacedDeadline: if (interrupted) deadline(desk.owner) else desk.displacedDeadline },
    },
  }

  action finishPosting: bool = all {
    desk.owner == "posting",
    desk' = { ...desk, owner: "" },
  }

  action askManager(id: str): bool = all {
    desk.owner == "",
    waiting(id),
    oldest(id),
    desk' = { ...desk, owner: id, slot: desk.sequence + 1, sequence: desk.sequence + 1, accepted: false,
      suspended: if (desk.suspended == id) "" else desk.suspended,
      firstSent: if (desk.firstSent.get(id) < 0) desk.firstSent.set(id, desk.now) else desk.firstSent },
  }

  action admitReceipt(id: str, receipt: int): bool = all {
    currentDelivery(id, receipt),
    desk' = { ...desk, accepted: true },
  }

  action answerManager(id: str, receipt: int): bool = all {
    desk.accepted and currentDelivery(id, receipt),
    desk' = { ...desk, owner: "", slot: 0, accepted: false, settled: desk.settled.union(Set(id)) },
  }

  action tick: bool = all {
    desk.now < LIMIT,
    val expired = if (ITEMS.contains(desk.owner)) desk.now + 1 >= deadline(desk.owner) else false
    all {
      desk' = { ...desk, now: desk.now + 1,
        owner: if (expired) "" else desk.owner,
        slot: if (expired) 0 else desk.slot,
        accepted: not(expired) and desk.accepted },
    },
  }

  action step: bool = {
    nondet id = ITEMS.oneOf()
    nondet receipt = Set(desk.slot, desk.displaced).oneOf()
    any { applicantAccepts(id), startPosting, finishPosting, askManager(id), admitReceipt(id, receipt), answerManager(id, receipt), tick }
  }

  val lawPostingOwnsManagerAnswer = desk.owner == "posting" implies desk.slot == 0 and not(desk.accepted)
  val lawDisplacedManagerProbeCannotLeave = ITEMS.forall(id => not(currentDelivery(id, desk.displaced)))
  val lawManagerQuestionKeepsDeadline = if (desk.suspended != "") deadline(desk.suspended) == desk.displacedDeadline else true
  val safety = lawPostingOwnsManagerAnswer and lawDisplacedManagerProbeCannotLeave and lawManagerQuestionKeepsDeadline
  val witness_interrupted = desk.suspended == ""

  run olderApplicantGetsTheNextQuestion = init
    .then(startPosting).then(applicantAccepts("B")).then(applicantAccepts("A")).then(finishPosting)
    .expect(oldest("B") and not(oldest("A")))
    .then(askManager("B")).expect(currentDelivery("B", 3))
    .then(admitReceipt("B", 3)).then(answerManager("B", 3)).then(askManager("A"))
    .expect(currentDelivery("A", 4))

  run postingDisplacesTheOldDelivery = init
    .then(applicantAccepts("A")).then(askManager("A")).then(admitReceipt("A", 2))
    .then(startPosting).then(applicantAccepts("B")).then(tick).then(finishPosting).then(askManager("A"))
    .expect(not(currentDelivery("A", 2)) and currentDelivery("A", 4) and not(desk.accepted) and deadline("A") == 4)
    .then(admitReceipt("A", 4)).then(answerManager("A", 4)).then(askManager("B"))
    .expect(desk.settled.contains("A") and currentDelivery("B", 5))

  run originalDeadlineStillClosesTheQuestion = init
    .then(applicantAccepts("A")).then(askManager("A")).then(startPosting).then(applicantAccepts("B"))
    .then(tick).then(tick).then(tick).then(tick).then(finishPosting)
    .expect(not(waiting("A")) and oldest("B"))
    .then(askManager("B")).expect(currentDelivery("B", 4))
}
```
