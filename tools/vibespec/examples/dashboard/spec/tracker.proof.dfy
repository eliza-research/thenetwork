// Proofs for spec/tracker.md. Every transition's body has the shape
// `if inv(s) && can<X>(...) { var s2 := <x>(s, ...); ... }` and calls the helpers after it.

lemma create_ensures(s: Tracker, actor: string)
  ensures (inv(s) ==> canCreate(s, actor) ==> alwaysTheWarningListIsTheTruth(create(s, actor)))
  ensures (inv(s) ==> canCreate(s, actor) ==> alwaysTaskNumbersAreUnique(create(s, actor)))
  ensures (inv(s) ==> canCreate(s, actor) ==> alwaysTheCounterCoversEveryTask(create(s, actor)))
  ensures (inv(s) ==> canCreate(s, actor) ==> alwaysNoOneIsToldTwiceInOnePass(create(s, actor)))
  ensures (inv(s) ==> canCreate(s, actor) ==> alwaysAnEditIsAnnouncedAfterTheQuietPeriod(create(s, actor)))
  ensures (inv(s) ==> canCreate(s, actor) ==> alwaysNothingIsSentTwice(create(s, actor)))
  ensures (inv(s) ==> canCreate(s, actor) ==> alwaysWhatWasSentIsRecorded(create(s, actor)))
  ensures (inv(s) ==> canCreate(s, actor) ==> alwaysRemindersAreTimely(create(s, actor)))
  ensures (inv(s) ==> canCreate(s, actor) ==> alwaysTheBookkeepingIsSane(create(s, actor)))
  ensures (inv(s) ==> canCreate(s, actor) ==> alwaysTheClockIsNeverNegative(create(s, actor)))
  ensures (inv(s) ==> canCreate(s, actor) ==> stepOnlyAHandEditCorrupts(s, create(s, actor)))
  ensures (inv(s) ==> canCreate(s, actor) ==> stepTheCounterNeverGoesBack(s, create(s, actor)))
  ensures (inv(s) ==> canCreate(s, actor) ==> stepANumberIsNeverReissued(s, create(s, actor)))
  ensures (inv(s) ==> canCreate(s, actor) ==> stepAFixRemovesAProblem(s, create(s, actor)))
{
  if inv(s) && canCreate(s, actor) {
    var s2 := create(s, actor);
    TWarningList(s2);
    TNoOneToldTwice(s2);
    TUniqueBridge(s);
    TUniqueBridge(s2);
    kernel_lawNextIsAboveTheCounter_ensures(numbersInUse(s), s.lastId);
    var n := s2.tasks[|s.tasks|];
    assert s2.tasks == s.tasks + [n];
    assert n.id > s.lastId;
    TAppendFreshUnique(s.tasks, n);
    forall j | 0 <= j < |s2.tasks|
      ensures s2.tasks[j].id > s.lastId || exists i :: 0 <= i < |s.tasks| && s.tasks[i] == s2.tasks[j]
    {
      if j < |s.tasks| {
        assert s.tasks[j] == s2.tasks[j];
      }
    }
    TSentRecordedKept(s, s2);
    forall j | 0 <= j < |s2.tasks|
      ensures forall q :: q in problemsOf(s2, s2.tasks[j]) ==> exists i :: 0 <= i < |s.tasks| && q in problemsOf(s, s.tasks[i])
    {
      TCreateTask(s, actor, j);
    }
    TSomeTaskNoNewProblem(s, s2);
  }
}

lemma setStatus_ensures(s: Tracker, id: int, status: Status, actor: string)
  ensures (inv(s) ==> canSetStatus(s, id, status, actor) ==> alwaysTheWarningListIsTheTruth(setStatus(s, id, status, actor)))
  ensures (inv(s) ==> canSetStatus(s, id, status, actor) ==> alwaysTaskNumbersAreUnique(setStatus(s, id, status, actor)))
  ensures (inv(s) ==> canSetStatus(s, id, status, actor) ==> alwaysTheCounterCoversEveryTask(setStatus(s, id, status, actor)))
  ensures (inv(s) ==> canSetStatus(s, id, status, actor) ==> alwaysNoOneIsToldTwiceInOnePass(setStatus(s, id, status, actor)))
  ensures (inv(s) ==> canSetStatus(s, id, status, actor) ==> alwaysAnEditIsAnnouncedAfterTheQuietPeriod(setStatus(s, id, status, actor)))
  ensures (inv(s) ==> canSetStatus(s, id, status, actor) ==> alwaysNothingIsSentTwice(setStatus(s, id, status, actor)))
  ensures (inv(s) ==> canSetStatus(s, id, status, actor) ==> alwaysWhatWasSentIsRecorded(setStatus(s, id, status, actor)))
  ensures (inv(s) ==> canSetStatus(s, id, status, actor) ==> alwaysRemindersAreTimely(setStatus(s, id, status, actor)))
  ensures (inv(s) ==> canSetStatus(s, id, status, actor) ==> alwaysTheBookkeepingIsSane(setStatus(s, id, status, actor)))
  ensures (inv(s) ==> canSetStatus(s, id, status, actor) ==> alwaysTheClockIsNeverNegative(setStatus(s, id, status, actor)))
  ensures (inv(s) ==> canSetStatus(s, id, status, actor) ==> stepOnlyAHandEditCorrupts(s, setStatus(s, id, status, actor)))
  ensures (inv(s) ==> canSetStatus(s, id, status, actor) ==> stepTheCounterNeverGoesBack(s, setStatus(s, id, status, actor)))
  ensures (inv(s) ==> canSetStatus(s, id, status, actor) ==> stepANumberIsNeverReissued(s, setStatus(s, id, status, actor)))
  ensures (inv(s) ==> canSetStatus(s, id, status, actor) ==> stepAFixRemovesAProblem(s, setStatus(s, id, status, actor)))
{
  if inv(s) && canSetStatus(s, id, status, actor) {
    var s2 := setStatus(s, id, status, actor);
    TWarningList(s2);
    TNoOneToldTwice(s2);
    TUniqueBridge(s);
    TUniqueBridge(s2);
    TIdsKeptUnique(s.tasks, s2.tasks);
    TSameShapeProblems(s, s2);
    TNoNewProblem(s, s2);
  }
}

lemma setDue_ensures(s: Tracker, id: int, due: int, actor: string)
  ensures (inv(s) ==> canSetDue(s, id, due, actor) ==> alwaysTheWarningListIsTheTruth(setDue(s, id, due, actor)))
  ensures (inv(s) ==> canSetDue(s, id, due, actor) ==> alwaysTaskNumbersAreUnique(setDue(s, id, due, actor)))
  ensures (inv(s) ==> canSetDue(s, id, due, actor) ==> alwaysTheCounterCoversEveryTask(setDue(s, id, due, actor)))
  ensures (inv(s) ==> canSetDue(s, id, due, actor) ==> alwaysNoOneIsToldTwiceInOnePass(setDue(s, id, due, actor)))
  ensures (inv(s) ==> canSetDue(s, id, due, actor) ==> alwaysAnEditIsAnnouncedAfterTheQuietPeriod(setDue(s, id, due, actor)))
  ensures (inv(s) ==> canSetDue(s, id, due, actor) ==> alwaysNothingIsSentTwice(setDue(s, id, due, actor)))
  ensures (inv(s) ==> canSetDue(s, id, due, actor) ==> alwaysWhatWasSentIsRecorded(setDue(s, id, due, actor)))
  ensures (inv(s) ==> canSetDue(s, id, due, actor) ==> alwaysRemindersAreTimely(setDue(s, id, due, actor)))
  ensures (inv(s) ==> canSetDue(s, id, due, actor) ==> alwaysTheBookkeepingIsSane(setDue(s, id, due, actor)))
  ensures (inv(s) ==> canSetDue(s, id, due, actor) ==> alwaysTheClockIsNeverNegative(setDue(s, id, due, actor)))
  ensures (inv(s) ==> canSetDue(s, id, due, actor) ==> stepOnlyAHandEditCorrupts(s, setDue(s, id, due, actor)))
  ensures (inv(s) ==> canSetDue(s, id, due, actor) ==> stepTheCounterNeverGoesBack(s, setDue(s, id, due, actor)))
  ensures (inv(s) ==> canSetDue(s, id, due, actor) ==> stepANumberIsNeverReissued(s, setDue(s, id, due, actor)))
  ensures (inv(s) ==> canSetDue(s, id, due, actor) ==> stepAFixRemovesAProblem(s, setDue(s, id, due, actor)))
{
  if inv(s) && canSetDue(s, id, due, actor) {
    var s2 := setDue(s, id, due, actor);
    TWarningList(s2);
    TNoOneToldTwice(s2);
    TUniqueBridge(s);
    TUniqueBridge(s2);
    TIdsKeptUnique(s.tasks, s2.tasks);
    TSameShapeProblems(s, s2);
    TNoNewProblem(s, s2);
  }
}

lemma addOwner_ensures(s: Tracker, id: int, owner: string, actor: string)
  ensures (inv(s) ==> canAddOwner(s, id, owner, actor) ==> alwaysTheWarningListIsTheTruth(addOwner(s, id, owner, actor)))
  ensures (inv(s) ==> canAddOwner(s, id, owner, actor) ==> alwaysTaskNumbersAreUnique(addOwner(s, id, owner, actor)))
  ensures (inv(s) ==> canAddOwner(s, id, owner, actor) ==> alwaysTheCounterCoversEveryTask(addOwner(s, id, owner, actor)))
  ensures (inv(s) ==> canAddOwner(s, id, owner, actor) ==> alwaysNoOneIsToldTwiceInOnePass(addOwner(s, id, owner, actor)))
  ensures (inv(s) ==> canAddOwner(s, id, owner, actor) ==> alwaysAnEditIsAnnouncedAfterTheQuietPeriod(addOwner(s, id, owner, actor)))
  ensures (inv(s) ==> canAddOwner(s, id, owner, actor) ==> alwaysNothingIsSentTwice(addOwner(s, id, owner, actor)))
  ensures (inv(s) ==> canAddOwner(s, id, owner, actor) ==> alwaysWhatWasSentIsRecorded(addOwner(s, id, owner, actor)))
  ensures (inv(s) ==> canAddOwner(s, id, owner, actor) ==> alwaysRemindersAreTimely(addOwner(s, id, owner, actor)))
  ensures (inv(s) ==> canAddOwner(s, id, owner, actor) ==> alwaysTheBookkeepingIsSane(addOwner(s, id, owner, actor)))
  ensures (inv(s) ==> canAddOwner(s, id, owner, actor) ==> alwaysTheClockIsNeverNegative(addOwner(s, id, owner, actor)))
  ensures (inv(s) ==> canAddOwner(s, id, owner, actor) ==> stepOnlyAHandEditCorrupts(s, addOwner(s, id, owner, actor)))
  ensures (inv(s) ==> canAddOwner(s, id, owner, actor) ==> stepTheCounterNeverGoesBack(s, addOwner(s, id, owner, actor)))
  ensures (inv(s) ==> canAddOwner(s, id, owner, actor) ==> stepANumberIsNeverReissued(s, addOwner(s, id, owner, actor)))
  ensures (inv(s) ==> canAddOwner(s, id, owner, actor) ==> stepAFixRemovesAProblem(s, addOwner(s, id, owner, actor)))
{
  if inv(s) && canAddOwner(s, id, owner, actor) {
    var s2 := addOwner(s, id, owner, actor);
    TWarningList(s2);
    TNoOneToldTwice(s2);
    TUniqueBridge(s);
    TUniqueBridge(s2);
    TIdsKeptUnique(s.tasks, s2.tasks);
    forall i | 0 <= i < |s.tasks|
      ensures problemsOf(s2, s.tasks[i]) == problemsOf(s2, s2.tasks[i])
    {
      if s.tasks[i].id == id {
        TMemberAddedSameProblems(s2, s.tasks[i], s2.tasks[i], owner);
      }
    }
    TSameProblems(s, s2);
    TNoNewProblem(s, s2);
  }
}

lemma removeOwner_ensures(s: Tracker, id: int, owner: string, actor: string)
  ensures (inv(s) ==> canRemoveOwner(s, id, owner, actor) ==> alwaysTheWarningListIsTheTruth(removeOwner(s, id, owner, actor)))
  ensures (inv(s) ==> canRemoveOwner(s, id, owner, actor) ==> alwaysTaskNumbersAreUnique(removeOwner(s, id, owner, actor)))
  ensures (inv(s) ==> canRemoveOwner(s, id, owner, actor) ==> alwaysTheCounterCoversEveryTask(removeOwner(s, id, owner, actor)))
  ensures (inv(s) ==> canRemoveOwner(s, id, owner, actor) ==> alwaysNoOneIsToldTwiceInOnePass(removeOwner(s, id, owner, actor)))
  ensures (inv(s) ==> canRemoveOwner(s, id, owner, actor) ==> alwaysAnEditIsAnnouncedAfterTheQuietPeriod(removeOwner(s, id, owner, actor)))
  ensures (inv(s) ==> canRemoveOwner(s, id, owner, actor) ==> alwaysNothingIsSentTwice(removeOwner(s, id, owner, actor)))
  ensures (inv(s) ==> canRemoveOwner(s, id, owner, actor) ==> alwaysWhatWasSentIsRecorded(removeOwner(s, id, owner, actor)))
  ensures (inv(s) ==> canRemoveOwner(s, id, owner, actor) ==> alwaysRemindersAreTimely(removeOwner(s, id, owner, actor)))
  ensures (inv(s) ==> canRemoveOwner(s, id, owner, actor) ==> alwaysTheBookkeepingIsSane(removeOwner(s, id, owner, actor)))
  ensures (inv(s) ==> canRemoveOwner(s, id, owner, actor) ==> alwaysTheClockIsNeverNegative(removeOwner(s, id, owner, actor)))
  ensures (inv(s) ==> canRemoveOwner(s, id, owner, actor) ==> stepOnlyAHandEditCorrupts(s, removeOwner(s, id, owner, actor)))
  ensures (inv(s) ==> canRemoveOwner(s, id, owner, actor) ==> stepTheCounterNeverGoesBack(s, removeOwner(s, id, owner, actor)))
  ensures (inv(s) ==> canRemoveOwner(s, id, owner, actor) ==> stepANumberIsNeverReissued(s, removeOwner(s, id, owner, actor)))
  ensures (inv(s) ==> canRemoveOwner(s, id, owner, actor) ==> stepAFixRemovesAProblem(s, removeOwner(s, id, owner, actor)))
{
  if inv(s) && canRemoveOwner(s, id, owner, actor) {
    var s2 := removeOwner(s, id, owner, actor);
    TWarningList(s2);
    TNoOneToldTwice(s2);
    TUniqueBridge(s);
    TUniqueBridge(s2);
    TIdsKeptUnique(s.tasks, s2.tasks);
    forall i, o | 0 <= i < |s.tasks| && o in s2.tasks[i].owners && !(o in s2.owners)
      ensures o in s.tasks[i].owners && !(o in s.owners)
    {
      if s.tasks[i].id == id {
        ProofLib.FilterMember((y: string) => (y != owner), s.tasks[i].owners, o);
      }
    }
    TOwnersShrinkNoNewProblem(s, s2);
  }
}

lemma addParent_ensures(s: Tracker, id: int, other: int, actor: string)
  ensures (inv(s) ==> canAddParent(s, id, other, actor) ==> alwaysTheWarningListIsTheTruth(addParent(s, id, other, actor)))
  ensures (inv(s) ==> canAddParent(s, id, other, actor) ==> alwaysTaskNumbersAreUnique(addParent(s, id, other, actor)))
  ensures (inv(s) ==> canAddParent(s, id, other, actor) ==> alwaysTheCounterCoversEveryTask(addParent(s, id, other, actor)))
  ensures (inv(s) ==> canAddParent(s, id, other, actor) ==> alwaysNoOneIsToldTwiceInOnePass(addParent(s, id, other, actor)))
  ensures (inv(s) ==> canAddParent(s, id, other, actor) ==> alwaysAnEditIsAnnouncedAfterTheQuietPeriod(addParent(s, id, other, actor)))
  ensures (inv(s) ==> canAddParent(s, id, other, actor) ==> alwaysNothingIsSentTwice(addParent(s, id, other, actor)))
  ensures (inv(s) ==> canAddParent(s, id, other, actor) ==> alwaysWhatWasSentIsRecorded(addParent(s, id, other, actor)))
  ensures (inv(s) ==> canAddParent(s, id, other, actor) ==> alwaysRemindersAreTimely(addParent(s, id, other, actor)))
  ensures (inv(s) ==> canAddParent(s, id, other, actor) ==> alwaysTheBookkeepingIsSane(addParent(s, id, other, actor)))
  ensures (inv(s) ==> canAddParent(s, id, other, actor) ==> alwaysTheClockIsNeverNegative(addParent(s, id, other, actor)))
  ensures (inv(s) ==> canAddParent(s, id, other, actor) ==> stepOnlyAHandEditCorrupts(s, addParent(s, id, other, actor)))
  ensures (inv(s) ==> canAddParent(s, id, other, actor) ==> stepTheCounterNeverGoesBack(s, addParent(s, id, other, actor)))
  ensures (inv(s) ==> canAddParent(s, id, other, actor) ==> stepANumberIsNeverReissued(s, addParent(s, id, other, actor)))
  ensures (inv(s) ==> canAddParent(s, id, other, actor) ==> stepAFixRemovesAProblem(s, addParent(s, id, other, actor)))
{
  if inv(s) && canAddParent(s, id, other, actor) {
    var s2 := addParent(s, id, other, actor);
    TWarningList(s2);
    TNoOneToldTwice(s2);
    TUniqueBridge(s);
    TUniqueBridge(s2);
    TIdsKeptUnique(s.tasks, s2.tasks);
    forall i | 0 <= i < |s.tasks|
      ensures forall q :: q in problemsOf(s2, s2.tasks[i]) ==> q in problemsOf(s, s.tasks[i])
    {
      TAddParentTask(s, id, other, actor, i);
    }
    TEachTaskNoNewProblem(s, s2);
  }
}

lemma removeParent_ensures(s: Tracker, id: int, other: int, actor: string)
  ensures (inv(s) ==> canRemoveParent(s, id, other, actor) ==> alwaysTheWarningListIsTheTruth(removeParent(s, id, other, actor)))
  ensures (inv(s) ==> canRemoveParent(s, id, other, actor) ==> alwaysTaskNumbersAreUnique(removeParent(s, id, other, actor)))
  ensures (inv(s) ==> canRemoveParent(s, id, other, actor) ==> alwaysTheCounterCoversEveryTask(removeParent(s, id, other, actor)))
  ensures (inv(s) ==> canRemoveParent(s, id, other, actor) ==> alwaysNoOneIsToldTwiceInOnePass(removeParent(s, id, other, actor)))
  ensures (inv(s) ==> canRemoveParent(s, id, other, actor) ==> alwaysAnEditIsAnnouncedAfterTheQuietPeriod(removeParent(s, id, other, actor)))
  ensures (inv(s) ==> canRemoveParent(s, id, other, actor) ==> alwaysNothingIsSentTwice(removeParent(s, id, other, actor)))
  ensures (inv(s) ==> canRemoveParent(s, id, other, actor) ==> alwaysWhatWasSentIsRecorded(removeParent(s, id, other, actor)))
  ensures (inv(s) ==> canRemoveParent(s, id, other, actor) ==> alwaysRemindersAreTimely(removeParent(s, id, other, actor)))
  ensures (inv(s) ==> canRemoveParent(s, id, other, actor) ==> alwaysTheBookkeepingIsSane(removeParent(s, id, other, actor)))
  ensures (inv(s) ==> canRemoveParent(s, id, other, actor) ==> alwaysTheClockIsNeverNegative(removeParent(s, id, other, actor)))
  ensures (inv(s) ==> canRemoveParent(s, id, other, actor) ==> stepOnlyAHandEditCorrupts(s, removeParent(s, id, other, actor)))
  ensures (inv(s) ==> canRemoveParent(s, id, other, actor) ==> stepTheCounterNeverGoesBack(s, removeParent(s, id, other, actor)))
  ensures (inv(s) ==> canRemoveParent(s, id, other, actor) ==> stepANumberIsNeverReissued(s, removeParent(s, id, other, actor)))
  ensures (inv(s) ==> canRemoveParent(s, id, other, actor) ==> stepAFixRemovesAProblem(s, removeParent(s, id, other, actor)))
{
  if inv(s) && canRemoveParent(s, id, other, actor) {
    var s2 := removeParent(s, id, other, actor);
    TWarningList(s2);
    TNoOneToldTwice(s2);
    TUniqueBridge(s);
    TUniqueBridge(s2);
    TIdsKeptUnique(s.tasks, s2.tasks);
    forall i | 0 <= i < |s.tasks|
      ensures forall q :: q in problemsOf(s2, s2.tasks[i]) ==> q in problemsOf(s, s.tasks[i])
    {
      TRemoveParentTask(s, id, other, actor, i);
    }
    TEachTaskNoNewProblem(s, s2);
  }
}

lemma relate_ensures(s: Tracker, id: int, other: int, actor: string)
  ensures (inv(s) ==> canRelate(s, id, other, actor) ==> alwaysTheWarningListIsTheTruth(relate(s, id, other, actor)))
  ensures (inv(s) ==> canRelate(s, id, other, actor) ==> alwaysTaskNumbersAreUnique(relate(s, id, other, actor)))
  ensures (inv(s) ==> canRelate(s, id, other, actor) ==> alwaysTheCounterCoversEveryTask(relate(s, id, other, actor)))
  ensures (inv(s) ==> canRelate(s, id, other, actor) ==> alwaysNoOneIsToldTwiceInOnePass(relate(s, id, other, actor)))
  ensures (inv(s) ==> canRelate(s, id, other, actor) ==> alwaysAnEditIsAnnouncedAfterTheQuietPeriod(relate(s, id, other, actor)))
  ensures (inv(s) ==> canRelate(s, id, other, actor) ==> alwaysNothingIsSentTwice(relate(s, id, other, actor)))
  ensures (inv(s) ==> canRelate(s, id, other, actor) ==> alwaysWhatWasSentIsRecorded(relate(s, id, other, actor)))
  ensures (inv(s) ==> canRelate(s, id, other, actor) ==> alwaysRemindersAreTimely(relate(s, id, other, actor)))
  ensures (inv(s) ==> canRelate(s, id, other, actor) ==> alwaysTheBookkeepingIsSane(relate(s, id, other, actor)))
  ensures (inv(s) ==> canRelate(s, id, other, actor) ==> alwaysTheClockIsNeverNegative(relate(s, id, other, actor)))
  ensures (inv(s) ==> canRelate(s, id, other, actor) ==> stepOnlyAHandEditCorrupts(s, relate(s, id, other, actor)))
  ensures (inv(s) ==> canRelate(s, id, other, actor) ==> stepTheCounterNeverGoesBack(s, relate(s, id, other, actor)))
  ensures (inv(s) ==> canRelate(s, id, other, actor) ==> stepANumberIsNeverReissued(s, relate(s, id, other, actor)))
  ensures (inv(s) ==> canRelate(s, id, other, actor) ==> stepAFixRemovesAProblem(s, relate(s, id, other, actor)))
{
  if inv(s) && canRelate(s, id, other, actor) {
    var s2 := relate(s, id, other, actor);
    TWarningList(s2);
    TNoOneToldTwice(s2);
    TUniqueBridge(s);
    TUniqueBridge(s2);
    TIdsKeptUnique(s.tasks, s2.tasks);
    forall i | 0 <= i < |s.tasks|
      ensures forall q :: q in problemsOf(s2, s2.tasks[i]) ==> q in problemsOf(s, s.tasks[i])
    {
      TRelateTask(s, id, other, actor, i);
    }
    TEachTaskNoNewProblem(s, s2);
  }
}

lemma unrelate_ensures(s: Tracker, id: int, other: int, actor: string)
  ensures (inv(s) ==> canUnrelate(s, id, other, actor) ==> alwaysTheWarningListIsTheTruth(unrelate(s, id, other, actor)))
  ensures (inv(s) ==> canUnrelate(s, id, other, actor) ==> alwaysTaskNumbersAreUnique(unrelate(s, id, other, actor)))
  ensures (inv(s) ==> canUnrelate(s, id, other, actor) ==> alwaysTheCounterCoversEveryTask(unrelate(s, id, other, actor)))
  ensures (inv(s) ==> canUnrelate(s, id, other, actor) ==> alwaysNoOneIsToldTwiceInOnePass(unrelate(s, id, other, actor)))
  ensures (inv(s) ==> canUnrelate(s, id, other, actor) ==> alwaysAnEditIsAnnouncedAfterTheQuietPeriod(unrelate(s, id, other, actor)))
  ensures (inv(s) ==> canUnrelate(s, id, other, actor) ==> alwaysNothingIsSentTwice(unrelate(s, id, other, actor)))
  ensures (inv(s) ==> canUnrelate(s, id, other, actor) ==> alwaysWhatWasSentIsRecorded(unrelate(s, id, other, actor)))
  ensures (inv(s) ==> canUnrelate(s, id, other, actor) ==> alwaysRemindersAreTimely(unrelate(s, id, other, actor)))
  ensures (inv(s) ==> canUnrelate(s, id, other, actor) ==> alwaysTheBookkeepingIsSane(unrelate(s, id, other, actor)))
  ensures (inv(s) ==> canUnrelate(s, id, other, actor) ==> alwaysTheClockIsNeverNegative(unrelate(s, id, other, actor)))
  ensures (inv(s) ==> canUnrelate(s, id, other, actor) ==> stepOnlyAHandEditCorrupts(s, unrelate(s, id, other, actor)))
  ensures (inv(s) ==> canUnrelate(s, id, other, actor) ==> stepTheCounterNeverGoesBack(s, unrelate(s, id, other, actor)))
  ensures (inv(s) ==> canUnrelate(s, id, other, actor) ==> stepANumberIsNeverReissued(s, unrelate(s, id, other, actor)))
  ensures (inv(s) ==> canUnrelate(s, id, other, actor) ==> stepAFixRemovesAProblem(s, unrelate(s, id, other, actor)))
{
  if inv(s) && canUnrelate(s, id, other, actor) {
    var s2 := unrelate(s, id, other, actor);
    TWarningList(s2);
    TNoOneToldTwice(s2);
    TUniqueBridge(s);
    TUniqueBridge(s2);
    TIdsKeptUnique(s.tasks, s2.tasks);
    forall i | 0 <= i < |s.tasks|
      ensures forall q :: q in problemsOf(s2, s2.tasks[i]) ==> q in problemsOf(s, s.tasks[i])
    {
      TUnrelateTask(s, id, other, actor, i);
    }
    TEachTaskNoNewProblem(s, s2);
  }
}

lemma deleteTask_ensures(s: Tracker, id: int)
  ensures (inv(s) ==> canDeleteTask(s, id) ==> alwaysTheWarningListIsTheTruth(deleteTask(s, id)))
  ensures (inv(s) ==> canDeleteTask(s, id) ==> alwaysTaskNumbersAreUnique(deleteTask(s, id)))
  ensures (inv(s) ==> canDeleteTask(s, id) ==> alwaysTheCounterCoversEveryTask(deleteTask(s, id)))
  ensures (inv(s) ==> canDeleteTask(s, id) ==> alwaysNoOneIsToldTwiceInOnePass(deleteTask(s, id)))
  ensures (inv(s) ==> canDeleteTask(s, id) ==> alwaysAnEditIsAnnouncedAfterTheQuietPeriod(deleteTask(s, id)))
  ensures (inv(s) ==> canDeleteTask(s, id) ==> alwaysNothingIsSentTwice(deleteTask(s, id)))
  ensures (inv(s) ==> canDeleteTask(s, id) ==> alwaysWhatWasSentIsRecorded(deleteTask(s, id)))
  ensures (inv(s) ==> canDeleteTask(s, id) ==> alwaysRemindersAreTimely(deleteTask(s, id)))
  ensures (inv(s) ==> canDeleteTask(s, id) ==> alwaysTheBookkeepingIsSane(deleteTask(s, id)))
  ensures (inv(s) ==> canDeleteTask(s, id) ==> alwaysTheClockIsNeverNegative(deleteTask(s, id)))
  ensures (inv(s) ==> canDeleteTask(s, id) ==> stepOnlyAHandEditCorrupts(s, deleteTask(s, id)))
  ensures (inv(s) ==> canDeleteTask(s, id) ==> stepTheCounterNeverGoesBack(s, deleteTask(s, id)))
  ensures (inv(s) ==> canDeleteTask(s, id) ==> stepANumberIsNeverReissued(s, deleteTask(s, id)))
  ensures (inv(s) ==> canDeleteTask(s, id) ==> stepAFixRemovesAProblem(s, deleteTask(s, id)))
{
  if inv(s) && canDeleteTask(s, id) {
    var s2 := deleteTask(s, id);
    TWarningList(s2);
    TNoOneToldTwice(s2);
    TUniqueBridge(s);
    TUniqueBridge(s2);
    var kept := ProofLib.Filter((t: Task) => (t.id != id), s.tasks);
    assert |s2.tasks| == |kept|;
    assert forall j :: 0 <= j < |kept| ==> s2.tasks[j] == kept[j].(parents := drop(kept[j].parents, id), related := drop(kept[j].related, id));
    TFilterKeepsUnique((t: Task) => (t.id != id), s.tasks);
    TIdsKeptUnique(kept, s2.tasks);
    TFilterTasks((t: Task) => (t.id != id), s.tasks);
    forall j | 0 <= j < |s2.tasks|
      ensures exists i :: 0 <= i < |s.tasks| && s.tasks[i].id == s2.tasks[j].id && s.tasks[i].notifiedAt == s2.tasks[j].notifiedAt && s.tasks[i].updatedAt == s2.tasks[j].updatedAt && s.tasks[i].toldSoon == s2.tasks[j].toldSoon && s.tasks[i].toldDue == s2.tasks[j].toldDue
    {
      assert kept[j] in s.tasks;
      var i :| 0 <= i < |s.tasks| && s.tasks[i] == kept[j];
    }
    TSentRecordedKept(s, s2);
    forall j | 0 <= j < |s2.tasks|
      ensures exists i :: 0 <= i < |s.tasks| && forall q :: q in problemsOf(s2, s2.tasks[j]) ==> q in problemsOf(s, s.tasks[i])
    {
      TDeleteTaskTask(s, id, j);
    }
    TSomeTaskNoNewProblem(s, s2);
  }
}

lemma renameOwner_ensures(s: Tracker, owner: string, name: string)
  ensures (inv(s) ==> canRenameOwner(s, owner, name) ==> alwaysTheWarningListIsTheTruth(renameOwner(s, owner, name)))
  ensures (inv(s) ==> canRenameOwner(s, owner, name) ==> alwaysTaskNumbersAreUnique(renameOwner(s, owner, name)))
  ensures (inv(s) ==> canRenameOwner(s, owner, name) ==> alwaysTheCounterCoversEveryTask(renameOwner(s, owner, name)))
  ensures (inv(s) ==> canRenameOwner(s, owner, name) ==> alwaysNoOneIsToldTwiceInOnePass(renameOwner(s, owner, name)))
  ensures (inv(s) ==> canRenameOwner(s, owner, name) ==> alwaysAnEditIsAnnouncedAfterTheQuietPeriod(renameOwner(s, owner, name)))
  ensures (inv(s) ==> canRenameOwner(s, owner, name) ==> alwaysNothingIsSentTwice(renameOwner(s, owner, name)))
  ensures (inv(s) ==> canRenameOwner(s, owner, name) ==> alwaysWhatWasSentIsRecorded(renameOwner(s, owner, name)))
  ensures (inv(s) ==> canRenameOwner(s, owner, name) ==> alwaysRemindersAreTimely(renameOwner(s, owner, name)))
  ensures (inv(s) ==> canRenameOwner(s, owner, name) ==> alwaysTheBookkeepingIsSane(renameOwner(s, owner, name)))
  ensures (inv(s) ==> canRenameOwner(s, owner, name) ==> alwaysTheClockIsNeverNegative(renameOwner(s, owner, name)))
  ensures (inv(s) ==> canRenameOwner(s, owner, name) ==> stepOnlyAHandEditCorrupts(s, renameOwner(s, owner, name)))
  ensures (inv(s) ==> canRenameOwner(s, owner, name) ==> stepTheCounterNeverGoesBack(s, renameOwner(s, owner, name)))
  ensures (inv(s) ==> canRenameOwner(s, owner, name) ==> stepANumberIsNeverReissued(s, renameOwner(s, owner, name)))
  ensures (inv(s) ==> canRenameOwner(s, owner, name) ==> stepAFixRemovesAProblem(s, renameOwner(s, owner, name)))
{
  if inv(s) && canRenameOwner(s, owner, name) {
    var s2 := renameOwner(s, owner, name);
    TWarningList(s2);
    TNoOneToldTwice(s2);
    TUniqueBridge(s);
    TUniqueBridge(s2);
    TIdsKeptUnique(s.tasks, s2.tasks);
    forall i, o | 0 <= i < |s.tasks| && o in s2.tasks[i].owners && !(o in s2.owners)
      ensures o in s.tasks[i].owners && !(o in s.owners)
    {
      var t := s.tasks[i];
      var renamed := (var s_map := t.owners; seq(|s_map|, i_map requires 0 <= i_map < |s_map| => var o := s_map[i_map]; (if (o == owner) then name else o)));
      assert s2.tasks[i].owners == distinctNames(renamed);
      TDedupMember((acc: seq<string>, x: string) => (if (x in acc) then acc else (acc + [x])), [], renamed, o);
      var k :| 0 <= k < |renamed| && renamed[k] == o;
      var w :| 0 <= w < |s.owners| && s.owners[w] == owner;
      assert s2.owners[w] == name;
      if o in s.owners {
        var v :| 0 <= v < |s.owners| && s.owners[v] == o;
        assert s2.owners[v] == o;
      }
    }
    TOwnersShrinkNoNewProblem(s, s2);
  }
}

lemma deleteOwner_ensures(s: Tracker, owner: string)
  ensures (inv(s) ==> canDeleteOwner(s, owner) ==> alwaysTheWarningListIsTheTruth(deleteOwner(s, owner)))
  ensures (inv(s) ==> canDeleteOwner(s, owner) ==> alwaysTaskNumbersAreUnique(deleteOwner(s, owner)))
  ensures (inv(s) ==> canDeleteOwner(s, owner) ==> alwaysTheCounterCoversEveryTask(deleteOwner(s, owner)))
  ensures (inv(s) ==> canDeleteOwner(s, owner) ==> alwaysNoOneIsToldTwiceInOnePass(deleteOwner(s, owner)))
  ensures (inv(s) ==> canDeleteOwner(s, owner) ==> alwaysAnEditIsAnnouncedAfterTheQuietPeriod(deleteOwner(s, owner)))
  ensures (inv(s) ==> canDeleteOwner(s, owner) ==> alwaysNothingIsSentTwice(deleteOwner(s, owner)))
  ensures (inv(s) ==> canDeleteOwner(s, owner) ==> alwaysWhatWasSentIsRecorded(deleteOwner(s, owner)))
  ensures (inv(s) ==> canDeleteOwner(s, owner) ==> alwaysRemindersAreTimely(deleteOwner(s, owner)))
  ensures (inv(s) ==> canDeleteOwner(s, owner) ==> alwaysTheBookkeepingIsSane(deleteOwner(s, owner)))
  ensures (inv(s) ==> canDeleteOwner(s, owner) ==> alwaysTheClockIsNeverNegative(deleteOwner(s, owner)))
  ensures (inv(s) ==> canDeleteOwner(s, owner) ==> stepOnlyAHandEditCorrupts(s, deleteOwner(s, owner)))
  ensures (inv(s) ==> canDeleteOwner(s, owner) ==> stepTheCounterNeverGoesBack(s, deleteOwner(s, owner)))
  ensures (inv(s) ==> canDeleteOwner(s, owner) ==> stepANumberIsNeverReissued(s, deleteOwner(s, owner)))
  ensures (inv(s) ==> canDeleteOwner(s, owner) ==> stepAFixRemovesAProblem(s, deleteOwner(s, owner)))
{
  if inv(s) && canDeleteOwner(s, owner) {
    var s2 := deleteOwner(s, owner);
    TWarningList(s2);
    TNoOneToldTwice(s2);
    TUniqueBridge(s);
    TUniqueBridge(s2);
    TIdsKeptUnique(s.tasks, s2.tasks);
    forall i, o | 0 <= i < |s.tasks| && o in s2.tasks[i].owners && !(o in s2.owners)
      ensures o in s.tasks[i].owners && !(o in s.owners)
    {
      ProofLib.FilterMember((y: string) => (y != owner), s.tasks[i].owners, o);
      ProofLib.FilterMember((y: string) => (y != owner), s.owners, o);
    }
    TOwnersShrinkNoNewProblem(s, s2);
  }
}

lemma handAddOwner_ensures(s: Tracker, id: int, name: string)
  ensures (inv(s) ==> canHandAddOwner(s, id, name) ==> alwaysTheWarningListIsTheTruth(handAddOwner(s, id, name)))
  ensures (inv(s) ==> canHandAddOwner(s, id, name) ==> alwaysTaskNumbersAreUnique(handAddOwner(s, id, name)))
  ensures (inv(s) ==> canHandAddOwner(s, id, name) ==> alwaysTheCounterCoversEveryTask(handAddOwner(s, id, name)))
  ensures (inv(s) ==> canHandAddOwner(s, id, name) ==> alwaysNoOneIsToldTwiceInOnePass(handAddOwner(s, id, name)))
  ensures (inv(s) ==> canHandAddOwner(s, id, name) ==> alwaysAnEditIsAnnouncedAfterTheQuietPeriod(handAddOwner(s, id, name)))
  ensures (inv(s) ==> canHandAddOwner(s, id, name) ==> alwaysNothingIsSentTwice(handAddOwner(s, id, name)))
  ensures (inv(s) ==> canHandAddOwner(s, id, name) ==> alwaysWhatWasSentIsRecorded(handAddOwner(s, id, name)))
  ensures (inv(s) ==> canHandAddOwner(s, id, name) ==> alwaysRemindersAreTimely(handAddOwner(s, id, name)))
  ensures (inv(s) ==> canHandAddOwner(s, id, name) ==> alwaysTheBookkeepingIsSane(handAddOwner(s, id, name)))
  ensures (inv(s) ==> canHandAddOwner(s, id, name) ==> alwaysTheClockIsNeverNegative(handAddOwner(s, id, name)))
  ensures (inv(s) ==> canHandAddOwner(s, id, name) ==> stepOnlyAHandEditCorrupts(s, handAddOwner(s, id, name)))
  ensures (inv(s) ==> canHandAddOwner(s, id, name) ==> stepTheCounterNeverGoesBack(s, handAddOwner(s, id, name)))
  ensures (inv(s) ==> canHandAddOwner(s, id, name) ==> stepANumberIsNeverReissued(s, handAddOwner(s, id, name)))
  ensures (inv(s) ==> canHandAddOwner(s, id, name) ==> stepAFixRemovesAProblem(s, handAddOwner(s, id, name)))
{
  if inv(s) && canHandAddOwner(s, id, name) {
    var s2 := handAddOwner(s, id, name);
    TWarningList(s2);
    TNoOneToldTwice(s2);
    TUniqueBridge(s);
    TUniqueBridge(s2);
    TIdsKeptUnique(s.tasks, s2.tasks);
  }
}

lemma handAddParent_ensures(s: Tracker, id: int, other: int)
  ensures (inv(s) ==> canHandAddParent(s, id, other) ==> alwaysTheWarningListIsTheTruth(handAddParent(s, id, other)))
  ensures (inv(s) ==> canHandAddParent(s, id, other) ==> alwaysTaskNumbersAreUnique(handAddParent(s, id, other)))
  ensures (inv(s) ==> canHandAddParent(s, id, other) ==> alwaysTheCounterCoversEveryTask(handAddParent(s, id, other)))
  ensures (inv(s) ==> canHandAddParent(s, id, other) ==> alwaysNoOneIsToldTwiceInOnePass(handAddParent(s, id, other)))
  ensures (inv(s) ==> canHandAddParent(s, id, other) ==> alwaysAnEditIsAnnouncedAfterTheQuietPeriod(handAddParent(s, id, other)))
  ensures (inv(s) ==> canHandAddParent(s, id, other) ==> alwaysNothingIsSentTwice(handAddParent(s, id, other)))
  ensures (inv(s) ==> canHandAddParent(s, id, other) ==> alwaysWhatWasSentIsRecorded(handAddParent(s, id, other)))
  ensures (inv(s) ==> canHandAddParent(s, id, other) ==> alwaysRemindersAreTimely(handAddParent(s, id, other)))
  ensures (inv(s) ==> canHandAddParent(s, id, other) ==> alwaysTheBookkeepingIsSane(handAddParent(s, id, other)))
  ensures (inv(s) ==> canHandAddParent(s, id, other) ==> alwaysTheClockIsNeverNegative(handAddParent(s, id, other)))
  ensures (inv(s) ==> canHandAddParent(s, id, other) ==> stepOnlyAHandEditCorrupts(s, handAddParent(s, id, other)))
  ensures (inv(s) ==> canHandAddParent(s, id, other) ==> stepTheCounterNeverGoesBack(s, handAddParent(s, id, other)))
  ensures (inv(s) ==> canHandAddParent(s, id, other) ==> stepANumberIsNeverReissued(s, handAddParent(s, id, other)))
  ensures (inv(s) ==> canHandAddParent(s, id, other) ==> stepAFixRemovesAProblem(s, handAddParent(s, id, other)))
{
  if inv(s) && canHandAddParent(s, id, other) {
    var s2 := handAddParent(s, id, other);
    TWarningList(s2);
    TNoOneToldTwice(s2);
    TUniqueBridge(s);
    TUniqueBridge(s2);
    TIdsKeptUnique(s.tasks, s2.tasks);
  }
}

lemma handAddRelated_ensures(s: Tracker, id: int, other: int)
  ensures (inv(s) ==> canHandAddRelated(s, id, other) ==> alwaysTheWarningListIsTheTruth(handAddRelated(s, id, other)))
  ensures (inv(s) ==> canHandAddRelated(s, id, other) ==> alwaysTaskNumbersAreUnique(handAddRelated(s, id, other)))
  ensures (inv(s) ==> canHandAddRelated(s, id, other) ==> alwaysTheCounterCoversEveryTask(handAddRelated(s, id, other)))
  ensures (inv(s) ==> canHandAddRelated(s, id, other) ==> alwaysNoOneIsToldTwiceInOnePass(handAddRelated(s, id, other)))
  ensures (inv(s) ==> canHandAddRelated(s, id, other) ==> alwaysAnEditIsAnnouncedAfterTheQuietPeriod(handAddRelated(s, id, other)))
  ensures (inv(s) ==> canHandAddRelated(s, id, other) ==> alwaysNothingIsSentTwice(handAddRelated(s, id, other)))
  ensures (inv(s) ==> canHandAddRelated(s, id, other) ==> alwaysWhatWasSentIsRecorded(handAddRelated(s, id, other)))
  ensures (inv(s) ==> canHandAddRelated(s, id, other) ==> alwaysRemindersAreTimely(handAddRelated(s, id, other)))
  ensures (inv(s) ==> canHandAddRelated(s, id, other) ==> alwaysTheBookkeepingIsSane(handAddRelated(s, id, other)))
  ensures (inv(s) ==> canHandAddRelated(s, id, other) ==> alwaysTheClockIsNeverNegative(handAddRelated(s, id, other)))
  ensures (inv(s) ==> canHandAddRelated(s, id, other) ==> stepOnlyAHandEditCorrupts(s, handAddRelated(s, id, other)))
  ensures (inv(s) ==> canHandAddRelated(s, id, other) ==> stepTheCounterNeverGoesBack(s, handAddRelated(s, id, other)))
  ensures (inv(s) ==> canHandAddRelated(s, id, other) ==> stepANumberIsNeverReissued(s, handAddRelated(s, id, other)))
  ensures (inv(s) ==> canHandAddRelated(s, id, other) ==> stepAFixRemovesAProblem(s, handAddRelated(s, id, other)))
{
  if inv(s) && canHandAddRelated(s, id, other) {
    var s2 := handAddRelated(s, id, other);
    TWarningList(s2);
    TNoOneToldTwice(s2);
    TUniqueBridge(s);
    TUniqueBridge(s2);
    TIdsKeptUnique(s.tasks, s2.tasks);
  }
}

lemma handDeleteTask_ensures(s: Tracker, id: int)
  ensures (inv(s) ==> canHandDeleteTask(s, id) ==> alwaysTheWarningListIsTheTruth(handDeleteTask(s, id)))
  ensures (inv(s) ==> canHandDeleteTask(s, id) ==> alwaysTaskNumbersAreUnique(handDeleteTask(s, id)))
  ensures (inv(s) ==> canHandDeleteTask(s, id) ==> alwaysTheCounterCoversEveryTask(handDeleteTask(s, id)))
  ensures (inv(s) ==> canHandDeleteTask(s, id) ==> alwaysNoOneIsToldTwiceInOnePass(handDeleteTask(s, id)))
  ensures (inv(s) ==> canHandDeleteTask(s, id) ==> alwaysAnEditIsAnnouncedAfterTheQuietPeriod(handDeleteTask(s, id)))
  ensures (inv(s) ==> canHandDeleteTask(s, id) ==> alwaysNothingIsSentTwice(handDeleteTask(s, id)))
  ensures (inv(s) ==> canHandDeleteTask(s, id) ==> alwaysWhatWasSentIsRecorded(handDeleteTask(s, id)))
  ensures (inv(s) ==> canHandDeleteTask(s, id) ==> alwaysRemindersAreTimely(handDeleteTask(s, id)))
  ensures (inv(s) ==> canHandDeleteTask(s, id) ==> alwaysTheBookkeepingIsSane(handDeleteTask(s, id)))
  ensures (inv(s) ==> canHandDeleteTask(s, id) ==> alwaysTheClockIsNeverNegative(handDeleteTask(s, id)))
  ensures (inv(s) ==> canHandDeleteTask(s, id) ==> stepOnlyAHandEditCorrupts(s, handDeleteTask(s, id)))
  ensures (inv(s) ==> canHandDeleteTask(s, id) ==> stepTheCounterNeverGoesBack(s, handDeleteTask(s, id)))
  ensures (inv(s) ==> canHandDeleteTask(s, id) ==> stepANumberIsNeverReissued(s, handDeleteTask(s, id)))
  ensures (inv(s) ==> canHandDeleteTask(s, id) ==> stepAFixRemovesAProblem(s, handDeleteTask(s, id)))
{
  if inv(s) && canHandDeleteTask(s, id) {
    var s2 := handDeleteTask(s, id);
    TWarningList(s2);
    TNoOneToldTwice(s2);
    TUniqueBridge(s);
    TUniqueBridge(s2);
    TFilterKeepsUnique((t: Task) => (t.id != id), s.tasks);
    TFilterTasks((t: Task) => (t.id != id), s.tasks);
    forall j | 0 <= j < |s2.tasks|
      ensures exists i :: 0 <= i < |s.tasks| && s.tasks[i] == s2.tasks[j]
    {
      assert s2.tasks[j] in s.tasks;
    }
    TSentRecordedKept(s, s2);
  }
}

lemma handDeleteOwner_ensures(s: Tracker, owner: string)
  ensures (inv(s) ==> canHandDeleteOwner(s, owner) ==> alwaysTheWarningListIsTheTruth(handDeleteOwner(s, owner)))
  ensures (inv(s) ==> canHandDeleteOwner(s, owner) ==> alwaysTaskNumbersAreUnique(handDeleteOwner(s, owner)))
  ensures (inv(s) ==> canHandDeleteOwner(s, owner) ==> alwaysTheCounterCoversEveryTask(handDeleteOwner(s, owner)))
  ensures (inv(s) ==> canHandDeleteOwner(s, owner) ==> alwaysNoOneIsToldTwiceInOnePass(handDeleteOwner(s, owner)))
  ensures (inv(s) ==> canHandDeleteOwner(s, owner) ==> alwaysAnEditIsAnnouncedAfterTheQuietPeriod(handDeleteOwner(s, owner)))
  ensures (inv(s) ==> canHandDeleteOwner(s, owner) ==> alwaysNothingIsSentTwice(handDeleteOwner(s, owner)))
  ensures (inv(s) ==> canHandDeleteOwner(s, owner) ==> alwaysWhatWasSentIsRecorded(handDeleteOwner(s, owner)))
  ensures (inv(s) ==> canHandDeleteOwner(s, owner) ==> alwaysRemindersAreTimely(handDeleteOwner(s, owner)))
  ensures (inv(s) ==> canHandDeleteOwner(s, owner) ==> alwaysTheBookkeepingIsSane(handDeleteOwner(s, owner)))
  ensures (inv(s) ==> canHandDeleteOwner(s, owner) ==> alwaysTheClockIsNeverNegative(handDeleteOwner(s, owner)))
  ensures (inv(s) ==> canHandDeleteOwner(s, owner) ==> stepOnlyAHandEditCorrupts(s, handDeleteOwner(s, owner)))
  ensures (inv(s) ==> canHandDeleteOwner(s, owner) ==> stepTheCounterNeverGoesBack(s, handDeleteOwner(s, owner)))
  ensures (inv(s) ==> canHandDeleteOwner(s, owner) ==> stepANumberIsNeverReissued(s, handDeleteOwner(s, owner)))
  ensures (inv(s) ==> canHandDeleteOwner(s, owner) ==> stepAFixRemovesAProblem(s, handDeleteOwner(s, owner)))
{
  if inv(s) && canHandDeleteOwner(s, owner) {
    var s2 := handDeleteOwner(s, owner);
    TWarningList(s2);
    TNoOneToldTwice(s2);
  }
}

lemma fix_ensures(s: Tracker, index: int)
  ensures (inv(s) ==> canFix(s, index) ==> alwaysTheWarningListIsTheTruth(fix(s, index)))
  ensures (inv(s) ==> canFix(s, index) ==> alwaysTaskNumbersAreUnique(fix(s, index)))
  ensures (inv(s) ==> canFix(s, index) ==> alwaysTheCounterCoversEveryTask(fix(s, index)))
  ensures (inv(s) ==> canFix(s, index) ==> alwaysNoOneIsToldTwiceInOnePass(fix(s, index)))
  ensures (inv(s) ==> canFix(s, index) ==> alwaysAnEditIsAnnouncedAfterTheQuietPeriod(fix(s, index)))
  ensures (inv(s) ==> canFix(s, index) ==> alwaysNothingIsSentTwice(fix(s, index)))
  ensures (inv(s) ==> canFix(s, index) ==> alwaysWhatWasSentIsRecorded(fix(s, index)))
  ensures (inv(s) ==> canFix(s, index) ==> alwaysRemindersAreTimely(fix(s, index)))
  ensures (inv(s) ==> canFix(s, index) ==> alwaysTheBookkeepingIsSane(fix(s, index)))
  ensures (inv(s) ==> canFix(s, index) ==> alwaysTheClockIsNeverNegative(fix(s, index)))
  ensures (inv(s) ==> canFix(s, index) ==> stepOnlyAHandEditCorrupts(s, fix(s, index)))
  ensures (inv(s) ==> canFix(s, index) ==> stepTheCounterNeverGoesBack(s, fix(s, index)))
  ensures (inv(s) ==> canFix(s, index) ==> stepANumberIsNeverReissued(s, fix(s, index)))
  ensures (inv(s) ==> canFix(s, index) ==> stepAFixRemovesAProblem(s, fix(s, index)))
{
  if inv(s) && canFix(s, index) {
    var s2 := fix(s, index);
    TWarningList(s2);
    TNoOneToldTwice(s2);
    TUniqueBridge(s);
    TUniqueBridge(s2);
    TIdsKeptUnique(s.tasks, s2.tasks);
    forall k | 0 <= k < |s.tasks|
      ensures forall q :: q in problemsOf(s2, s2.tasks[k]) ==> q in problemsOf(s, s.tasks[k])
    {
      TFixTask(s, index, k);
    }
    TEachTaskNoNewProblem(s, s2);
    TFixShortens(s, index);
  }
}

lemma tick_ensures(s: Tracker)
  ensures (inv(s) ==> alwaysTheWarningListIsTheTruth(tick(s)))
  ensures (inv(s) ==> alwaysTaskNumbersAreUnique(tick(s)))
  ensures (inv(s) ==> alwaysTheCounterCoversEveryTask(tick(s)))
  ensures (inv(s) ==> alwaysNoOneIsToldTwiceInOnePass(tick(s)))
  ensures (inv(s) ==> alwaysAnEditIsAnnouncedAfterTheQuietPeriod(tick(s)))
  ensures (inv(s) ==> alwaysNothingIsSentTwice(tick(s)))
  ensures (inv(s) ==> alwaysWhatWasSentIsRecorded(tick(s)))
  ensures (inv(s) ==> alwaysRemindersAreTimely(tick(s)))
  ensures (inv(s) ==> alwaysTheBookkeepingIsSane(tick(s)))
  ensures (inv(s) ==> alwaysTheClockIsNeverNegative(tick(s)))
  ensures (inv(s) ==> stepOnlyAHandEditCorrupts(s, tick(s)))
  ensures (inv(s) ==> stepTheCounterNeverGoesBack(s, tick(s)))
  ensures (inv(s) ==> stepANumberIsNeverReissued(s, tick(s)))
  ensures (inv(s) ==> stepAFixRemovesAProblem(s, tick(s)))
{
  if inv(s) {
    var s2 := tick(s);
    TWarningList(s2);
    TNoOneToldTwice(s2);
    TSameShapeProblems(s, s2);
    TNoNewProblem(s, s2);
  }
}

lemma notify_ensures(s: Tracker)
  ensures (inv(s) ==> alwaysTheWarningListIsTheTruth(notify(s)))
  ensures (inv(s) ==> alwaysTaskNumbersAreUnique(notify(s)))
  ensures (inv(s) ==> alwaysTheCounterCoversEveryTask(notify(s)))
  ensures (inv(s) ==> alwaysNoOneIsToldTwiceInOnePass(notify(s)))
  ensures (inv(s) ==> alwaysAnEditIsAnnouncedAfterTheQuietPeriod(notify(s)))
  ensures (inv(s) ==> alwaysNothingIsSentTwice(notify(s)))
  ensures (inv(s) ==> alwaysWhatWasSentIsRecorded(notify(s)))
  ensures (inv(s) ==> alwaysRemindersAreTimely(notify(s)))
  ensures (inv(s) ==> alwaysTheBookkeepingIsSane(notify(s)))
  ensures (inv(s) ==> alwaysTheClockIsNeverNegative(notify(s)))
  ensures (inv(s) ==> stepOnlyAHandEditCorrupts(s, notify(s)))
  ensures (inv(s) ==> stepTheCounterNeverGoesBack(s, notify(s)))
  ensures (inv(s) ==> stepANumberIsNeverReissued(s, notify(s)))
  ensures (inv(s) ==> stepAFixRemovesAProblem(s, notify(s)))
{
  if inv(s) {
    var s2 := notify(s);
    TWarningList(s2);
    TNotifyAnnouncedAndTimely(s);
    TNotifyRecorded(s);
    TNotifyNothingSentTwice(s);
    TNoOneToldTwice(s2);
    TUniqueBridge(s);
    TUniqueBridge(s2);
    TIdsKeptUnique(s.tasks, s2.tasks);
    TSameShapeProblems(s, s2);
    TNoNewProblem(s, s2);
  }
}

// ===== Task numbers are unique (F4) =====

// The rule, restated over ProofLib.Filter.
lemma TUniqueBridge(s: Tracker)
  ensures alwaysTaskNumbersAreUnique(s) == Std.Collections.Seq.All(s.tasks, (a: Task) => (|ProofLib.Filter((b: Task) => (b.id == a.id), s.tasks)| == 1))
{
}

// A map over the tasks that keeps every number keeps the numbers unique.
lemma TIdsKeptUnique(xs: seq<Task>, ys: seq<Task>)
  requires |xs| == |ys|
  requires forall i :: 0 <= i < |xs| ==> xs[i].id == ys[i].id
  requires Std.Collections.Seq.All(xs, (a: Task) => (|ProofLib.Filter((b: Task) => (b.id == a.id), xs)| == 1))
  ensures Std.Collections.Seq.All(ys, (a: Task) => (|ProofLib.Filter((b: Task) => (b.id == a.id), ys)| == 1))
{
  forall j | 0 <= j < |ys|
    ensures |ProofLib.Filter((b: Task) => (b.id == ys[j].id), ys)| == 1
  {
    var a := xs[j];
    var a2 := ys[j];
    assert |ProofLib.Filter((b: Task) => (b.id == a.id), xs)| == 1;
    ProofLib.FilterLengthPointwise((b: Task) => (b.id == a.id), (b: Task) => (b.id == a2.id), xs, ys);
  }
}

// Appending a task whose number is above every other keeps the numbers unique.
lemma TAppendFreshUnique(xs: seq<Task>, n: Task)
  requires forall i :: 0 <= i < |xs| ==> xs[i].id < n.id
  requires Std.Collections.Seq.All(xs, (a: Task) => (|ProofLib.Filter((b: Task) => (b.id == a.id), xs)| == 1))
  ensures Std.Collections.Seq.All(xs + [n], (a: Task) => (|ProofLib.Filter((b: Task) => (b.id == a.id), xs + [n])| == 1))
{
  var ys := xs + [n];
  forall j | 0 <= j < |ys|
    ensures |ProofLib.Filter((b: Task) => (b.id == ys[j].id), ys)| == 1
  {
    var a := ys[j];
    ProofLib.FilterAppend((b: Task) => (b.id == a.id), xs, n);
    if j == |xs| {
      ProofLib.FilterNone((b: Task) => (b.id == a.id), xs);
    } else {
      assert a == xs[j];
    }
  }
}

// Filtering the tasks keeps the numbers unique.
lemma TFilterKeepsUnique(f: Task -> bool, xs: seq<Task>)
  requires Std.Collections.Seq.All(xs, (a: Task) => (|ProofLib.Filter((b: Task) => (b.id == a.id), xs)| == 1))
  ensures Std.Collections.Seq.All(ProofLib.Filter(f, xs), (a: Task) => (|ProofLib.Filter((b: Task) => (b.id == a.id), ProofLib.Filter(f, xs))| == 1))
{
  var ys := ProofLib.Filter(f, xs);
  ProofLib.FilterSubset(f, xs);
  forall j | 0 <= j < |ys|
    ensures |ProofLib.Filter((b: Task) => (b.id == ys[j].id), ys)| == 1
  {
    var a := ys[j];
    var k :| 0 <= k < |xs| && xs[k] == a;
    assert |ProofLib.Filter((b: Task) => (b.id == a.id), xs)| == 1;
    ProofLib.FilterOfFilterShorter(f, (b: Task) => (b.id == a.id), xs);
    ProofLib.FilterNone((b: Task) => (b.id == a.id), ys);
  }
}

// ===== The warning list is the truth, for every state (F6) =====

// One task has no problem exactly when it is well formed.
lemma TTaskClean(s: Tracker, t: Task)
  requires t in s.tasks
  ensures |problemsOf(s, t)| == 0 <==> ((((((Std.Collections.Seq.All(t.owners, (o: string) => (o in s.owners)) && Std.Collections.Seq.All(t.parents, (p: int) => hasTask(s, p))) && Std.Collections.Seq.All(t.related, (r: int) => hasTask(s, r))) && !((t.id in t.parents))) && !((t.id in t.related))) && !((t.id in ancestors(s, t.id)))) && Std.Collections.Seq.All(t.related, (r: int) => linksBack(s, r, t.id)))
{
  assert hasTask(s, t.id);
  ProofLib.FilterNone((o: string) => !((o in s.owners)), t.owners);
  ProofLib.FilterNone((p: int) => ((p != t.id) && !(hasTask(s, p))), t.parents);
  ProofLib.FilterNone((r: int) => ((r != t.id) && !(hasTask(s, r))), t.related);
  ProofLib.FilterNone((r: int) => (((r != t.id) && hasTask(s, r)) && !(linksBack(s, r, t.id))), t.related);
}

lemma TWarningList(s: Tracker)
  ensures alwaysTheWarningListIsTheTruth(s)
{
  ProofLib.FoldLeftConcatEmpty((acc: seq<Problem>, t: Task) => (acc + problemsOf(s, t)), (t: Task) => problemsOf(s, t), [], s.tasks);
  forall i | 0 <= i < |s.tasks|
    ensures |problemsOf(s, s.tasks[i])| == 0 <==> ((((((Std.Collections.Seq.All(s.tasks[i].owners, (o: string) => (o in s.owners)) && Std.Collections.Seq.All(s.tasks[i].parents, (p: int) => hasTask(s, p))) && Std.Collections.Seq.All(s.tasks[i].related, (r: int) => hasTask(s, r))) && !((s.tasks[i].id in s.tasks[i].parents))) && !((s.tasks[i].id in s.tasks[i].related))) && !((s.tasks[i].id in ancestors(s, s.tasks[i].id)))) && Std.Collections.Seq.All(s.tasks[i].related, (r: int) => linksBack(s, r, s.tasks[i].id)))
  {
    TTaskClean(s, s.tasks[i]);
  }
}

// ===== No one is told twice in one pass, for every state (F10) =====

lemma TNoOneToldTwice(s: Tracker)
  ensures alwaysNoOneIsToldTwiceInOnePass(s)
{
  forall i, k | 0 <= i < |s.tasks| && 0 <= k < |knownOwners(s, s.tasks[i])|
    ensures var o := knownOwners(s, s.tasks[i])[k]; |ProofLib.Filter((x: string) => (x == o), knownOwners(s, s.tasks[i]))| == 1
  {
    var t := s.tasks[i];
    var ko := knownOwners(s, t);
    ProofLib.FoldLeftDedupDistinct((acc: seq<string>, x: string) => (if (x in acc) then acc else (acc + [x])), [], ProofLib.Filter((o: string) => (o in s.owners), t.owners));
    var o := ko[k];
    ProofLib.FilterDistinctCountOne((x: string) => (x == o), ko, o);
  }
}

// ===== Problems depend only on the members and each task's number, owners and links (F5) =====

// Same task numbers and links, position by position: the same tasks exist, and link back alike.
lemma TSameLinksHasTask(s: Tracker, s2: Tracker)
  requires |s.tasks| == |s2.tasks|
  requires forall i :: 0 <= i < |s.tasks| ==> s.tasks[i].id == s2.tasks[i].id && s.tasks[i].related == s2.tasks[i].related
  ensures forall p :: hasTask(s, p) == hasTask(s2, p)
  ensures forall r, id :: linksBack(s, r, id) == linksBack(s2, r, id)
{
  forall p
    ensures hasTask(s, p) == hasTask(s2, p)
  {
    if hasTask(s, p) {
      var t :| t in s.tasks && t.id == p;
      var i :| 0 <= i < |s.tasks| && s.tasks[i] == t;
      assert s2.tasks[i] in s2.tasks;
    }
    if hasTask(s2, p) {
      var t :| t in s2.tasks && t.id == p;
      var i :| 0 <= i < |s2.tasks| && s2.tasks[i] == t;
      assert s.tasks[i] in s.tasks;
    }
  }
  forall r, id
    ensures linksBack(s, r, id) == linksBack(s2, r, id)
  {
    if linksBack(s, r, id) {
      var t :| t in s.tasks && t.id == r && id in t.related;
      var i :| 0 <= i < |s.tasks| && s.tasks[i] == t;
      assert s2.tasks[i] in s2.tasks;
    }
    if linksBack(s2, r, id) {
      var t :| t in s2.tasks && t.id == r && id in t.related;
      var i :| 0 <= i < |s2.tasks| && s2.tasks[i] == t;
      assert s.tasks[i] in s.tasks;
    }
  }
}

lemma TSameParentsParentsOfAll(s: Tracker, s2: Tracker)
  requires |s.tasks| == |s2.tasks|
  requires forall i :: 0 <= i < |s.tasks| ==> s.tasks[i].id == s2.tasks[i].id && s.tasks[i].parents == s2.tasks[i].parents
  ensures forall ids :: parentsOfAll(s, ids) == parentsOfAll(s2, ids)
{
  forall ids
    ensures parentsOfAll(s, ids) == parentsOfAll(s2, ids)
  {
    var keep := (t: Task) => (t.id in ids);
    ProofLib.FilterPointwise(keep, keep, (a: Task, b: Task) => (a.id == b.id && a.parents == b.parents), s.tasks, s2.tasks);
    var f := (acc: seq<int>, t: Task) => (acc + Std.Collections.Seq.Filter((p: int) => ((p != t.id) && !((p in acc))), t.parents));
    ProofLib.FoldLeftPointwise(f, f, [], ProofLib.Filter(keep, s.tasks), ProofLib.Filter(keep, s2.tasks));
  }
}

lemma TSameParentsAncestors(s: Tracker, s2: Tracker)
  requires |s.tasks| == |s2.tasks|
  requires forall i :: 0 <= i < |s.tasks| ==> s.tasks[i].id == s2.tasks[i].id && s.tasks[i].parents == s2.tasks[i].parents
  ensures forall id :: ancestors(s, id) == ancestors(s2, id)
{
  TSameParentsParentsOfAll(s, s2);
  forall id
    ensures ancestors(s, id) == ancestors(s2, id)
  {
    ProofLib.FoldLeftPointwise(
      (acc: seq<int>, t: Task) => (acc + Std.Collections.Seq.Filter((p: int) => !((p in acc)), parentsOfAll(s, acc))),
      (acc: seq<int>, t: Task) => (acc + Std.Collections.Seq.Filter((p: int) => !((p in acc)), parentsOfAll(s2, acc))),
      parentsOfAll(s, [id]), s.tasks, s2.tasks);
  }
}

// Same members and links: one task's problems are judged alike in both states.
lemma TSameLinksProblemsOf(s: Tracker, s2: Tracker)
  requires s.owners == s2.owners && |s.tasks| == |s2.tasks|
  requires forall i :: 0 <= i < |s.tasks| ==> s.tasks[i].id == s2.tasks[i].id && s.tasks[i].parents == s2.tasks[i].parents && s.tasks[i].related == s2.tasks[i].related
  ensures forall t :: problemsOf(s, t) == problemsOf(s2, t)
{
  TSameLinksHasTask(s, s2);
  TSameParentsAncestors(s, s2);
  forall t: Task
    ensures problemsOf(s, t) == problemsOf(s2, t)
  {
    ProofLib.FilterSamePredicate((p: int) => ((p != t.id) && !(hasTask(s, p))), (p: int) => ((p != t.id) && !(hasTask(s2, p))), t.parents);
    ProofLib.FilterSamePredicate((r: int) => ((r != t.id) && !(hasTask(s, r))), (r: int) => ((r != t.id) && !(hasTask(s2, r))), t.related);
    ProofLib.FilterSamePredicate((r: int) => (((r != t.id) && hasTask(s, r)) && !(linksBack(s, r, t.id))), (r: int) => (((r != t.id) && hasTask(s2, r)) && !(linksBack(s2, r, t.id))), t.related);
  }
}

// Same members and links, and each task's problems unchanged: the warning list is unchanged.
lemma TSameProblems(s: Tracker, s2: Tracker)
  requires s.owners == s2.owners && |s.tasks| == |s2.tasks|
  requires forall i :: 0 <= i < |s.tasks| ==> s.tasks[i].id == s2.tasks[i].id && s.tasks[i].parents == s2.tasks[i].parents && s.tasks[i].related == s2.tasks[i].related
  requires forall i :: 0 <= i < |s.tasks| ==> problemsOf(s2, s.tasks[i]) == problemsOf(s2, s2.tasks[i])
  ensures problems(s) == problems(s2)
{
  TSameLinksProblemsOf(s, s2);
  ProofLib.FoldLeftPointwise((acc: seq<Problem>, t: Task) => (acc + problemsOf(s, t)), (acc: seq<Problem>, t: Task) => (acc + problemsOf(s2, t)), [], s.tasks, s2.tasks);
}

// Same members, and each task keeps its number, owners and links: the warning list is unchanged.
lemma TSameShapeProblems(s: Tracker, s2: Tracker)
  requires s.owners == s2.owners && |s.tasks| == |s2.tasks|
  requires forall i :: 0 <= i < |s.tasks| ==> s.tasks[i].id == s2.tasks[i].id && s.tasks[i].owners == s2.tasks[i].owners && s.tasks[i].parents == s2.tasks[i].parents && s.tasks[i].related == s2.tasks[i].related
  ensures problems(s) == problems(s2)
{
  forall i | 0 <= i < |s.tasks|
    ensures problemsOf(s2, s.tasks[i]) == problemsOf(s2, s2.tasks[i])
  {
    var a := s.tasks[i];
    var b := s2.tasks[i];
    assert a.id == b.id && a.owners == b.owners && a.parents == b.parents && a.related == b.related;
  }
  TSameProblems(s, s2);
}

lemma TNoNewProblem(s: Tracker, s2: Tracker)
  requires problems(s) == problems(s2)
  ensures addsNoProblem(s, s2)
{
  var ps := problems(s2);
  forall i | 0 <= i < |ps|
    ensures exists q :: q in problems(s) && sameProblem(ps[i], q)
  {
    assert ps[i] in problems(s) && sameProblem(ps[i], ps[i]);
  }
}

// ===== Counter and bookkeeping when tasks are only removed (F11) =====

lemma TFilterTasks(f: Task -> bool, xs: seq<Task>)
  ensures forall t :: t in ProofLib.Filter(f, xs) ==> t in xs
{
  forall t | t in ProofLib.Filter(f, xs)
    ensures t in xs
  {
    ProofLib.FilterMember(f, xs, t);
  }
}

// ===== What was sent is recorded (the new rule) =====

// Every note sent before is still recorded when each remaining task is an old one that recorded at least as much, or a new number.
lemma TOldNotesRecorded(s: Tracker, s2: Tracker)
  requires alwaysWhatWasSentIsRecorded(s)
  requires s2.lastId >= s.lastId
  requires forall j :: 0 <= j < |s2.tasks| ==> (s2.tasks[j].id > s.lastId || exists i :: 0 <= i < |s.tasks| && s.tasks[i].id == s2.tasks[j].id && s.tasks[i].notifiedAt <= s2.tasks[j].notifiedAt && (forall v :: v in s.tasks[i].toldSoon ==> v in s2.tasks[j].toldSoon) && (forall v :: v in s.tasks[i].toldDue ==> v in s2.tasks[j].toldDue))
  ensures forall k :: 0 <= k < |s.sent| ==> (s.sent[k].task <= s2.lastId && forall j :: 0 <= j < |s2.tasks| ==> (s2.tasks[j].id == s.sent[k].task ==> ((s.sent[k].kind.Update? ==> s.sent[k].version <= s2.tasks[j].notifiedAt) && (s.sent[k].kind.Soon? ==> s.sent[k].version in s2.tasks[j].toldSoon) && (s.sent[k].kind.Today? ==> s.sent[k].version in s2.tasks[j].toldDue))))
{
  forall k, j | 0 <= k < |s.sent| && 0 <= j < |s2.tasks| && s2.tasks[j].id == s.sent[k].task
    ensures (s.sent[k].kind.Update? ==> s.sent[k].version <= s2.tasks[j].notifiedAt) && (s.sent[k].kind.Soon? ==> s.sent[k].version in s2.tasks[j].toldSoon) && (s.sent[k].kind.Today? ==> s.sent[k].version in s2.tasks[j].toldDue)
  {
    var n := s.sent[k];
    assert n.task <= s.lastId;
    var i :| 0 <= i < |s.tasks| && s.tasks[i].id == s2.tasks[j].id && s.tasks[i].notifiedAt <= s2.tasks[j].notifiedAt && (forall v :: v in s.tasks[i].toldSoon ==> v in s2.tasks[j].toldSoon) && (forall v :: v in s.tasks[i].toldDue ==> v in s2.tasks[j].toldDue);
    var t := s.tasks[i];
    assert t.id == n.task;
  }
}

// The same, when nothing new was sent.
lemma TSentRecordedKept(s: Tracker, s2: Tracker)
  requires alwaysWhatWasSentIsRecorded(s)
  requires s2.sent == s.sent && s2.lastId >= s.lastId
  requires forall j :: 0 <= j < |s2.tasks| ==> (s2.tasks[j].id > s.lastId || exists i :: 0 <= i < |s.tasks| && s.tasks[i].id == s2.tasks[j].id && s.tasks[i].notifiedAt <= s2.tasks[j].notifiedAt && (forall v :: v in s.tasks[i].toldSoon ==> v in s2.tasks[j].toldSoon) && (forall v :: v in s.tasks[i].toldDue ==> v in s2.tasks[j].toldDue))
  ensures alwaysWhatWasSentIsRecorded(s2)
{
  TOldNotesRecorded(s, s2);
}

// ===== The notes of one notifier pass (F9) =====

// What a fold that appends h(x) for each x holds.
lemma TFoldConcatMember<A, T>(f: (seq<A>, T) -> seq<A>, h: T -> seq<A>, init: seq<A>, xs: seq<T>, x: A)
  requires forall a, y :: f(a, y) == a + h(y)
  ensures x in Std.Collections.Seq.FoldLeft(f, init, xs) <==> (x in init || exists i :: 0 <= i < |xs| && x in h(xs[i]))
  decreases |xs|
{
  if |xs| > 0 {
    TFoldConcatMember(f, h, f(init, xs[0]), xs[1..], x);
    assert forall i :: 1 <= i < |xs| ==> xs[i] == xs[1..][i - 1];
    if x in Std.Collections.Seq.FoldLeft(f, init, xs) && !(x in init) && !(x in h(xs[0])) {
      var i :| 0 <= i < |xs[1..]| && x in h(xs[1..][i]);
      assert x in h(xs[i + 1]);
    }
  }
}

// A note of one task's pass names the task, goes out now, and is due.
lemma TNoteFacts(s: Tracker, t: Task, x: Note)
  requires x in notesFor(s, t)
  ensures x.task == t.id && x.at == s.now
  ensures x.kind.Update? ==> updateIsDue(t, s.now) && x.version == t.updatedAt
  ensures x.kind.Soon? ==> reminder(t, s.now).DueSoon? && x.version == t.due
  ensures x.kind.Today? ==> reminder(t, s.now).DueToday? && x.version == t.due
{
}

// A note of one notifier pass comes from one task.
lemma TNewNote(s: Tracker, x: Note)
  requires x in Std.Collections.Seq.FoldLeft((acc: seq<Note>, t: Task) => (acc + notesFor(s, t)), [], s.tasks)
  ensures exists i :: 0 <= i < |s.tasks| && x in notesFor(s, s.tasks[i])
{
  TFoldConcatMember((acc: seq<Note>, t: Task) => (acc + notesFor(s, t)), (t: Task) => notesFor(s, t), [], s.tasks, x);
}

// Two positions of a list with unique task numbers that hold the same number are one position.
lemma TUniqueIndex(s: Tracker, i: int, j: int)
  requires alwaysTaskNumbersAreUnique(s)
  requires 0 <= i < |s.tasks| && 0 <= j < |s.tasks| && s.tasks[i].id == s.tasks[j].id
  ensures i == j
{
  TUniqueBridge(s);
  var a := s.tasks[i];
  assert |ProofLib.Filter((b: Task) => (b.id == a.id), s.tasks)| == 1;
  ProofLib.FilterCountOneIffUnique((b: Task) => (b.id == a.id), s.tasks, (t: Task) => t.id, i);
}

// The notes of a pass are announced after the quiet period and timely, so the rules still hold after it.
lemma TNotifyAnnouncedAndTimely(s: Tracker)
  requires inv(s)
  ensures alwaysAnEditIsAnnouncedAfterTheQuietPeriod(notify(s))
  ensures alwaysRemindersAreTimely(notify(s))
{
  var s2 := notify(s);
  var newNotes := Std.Collections.Seq.FoldLeft((acc: seq<Note>, t: Task) => (acc + notesFor(s, t)), [], s.tasks);
  assert s2.sent == s.sent + newNotes;
  forall k | 0 <= k < |s2.sent|
    ensures (!(s2.sent[k].kind.Update?) || ((s2.sent[k].at - s2.sent[k].version) >= debounce))
    ensures ((!(s2.sent[k].kind.Today?) || ((s2.sent[k].version <= today(s2.sent[k].at)) && ((today(s2.sent[k].at) - s2.sent[k].version) <= lateDays))) && (!(s2.sent[k].kind.Soon?) || (((s2.sent[k].version - today(s2.sent[k].at)) >= 1) && ((s2.sent[k].version - today(s2.sent[k].at)) <= soonDays))))
  {
    if k < |s.sent| {
      assert s2.sent[k] == s.sent[k];
    } else {
      var x := s2.sent[k];
      assert x == newNotes[k - |s.sent|];
      TNewNote(s, x);
      var i :| 0 <= i < |s.tasks| && x in notesFor(s, s.tasks[i]);
      TNoteFacts(s, s.tasks[i], x);
    }
  }
}

// Every note of a pass is recorded on its task by the same pass.
lemma TNotifyRecorded(s: Tracker)
  requires inv(s)
  ensures alwaysWhatWasSentIsRecorded(notify(s))
{
  var s2 := notify(s);
  var newNotes := Std.Collections.Seq.FoldLeft((acc: seq<Note>, t: Task) => (acc + notesFor(s, t)), [], s.tasks);
  assert s2.sent == s.sent + newNotes;
  forall j | 0 <= j < |s2.tasks|
    ensures exists i :: 0 <= i < |s.tasks| && s.tasks[i].id == s2.tasks[j].id && s.tasks[i].notifiedAt <= s2.tasks[j].notifiedAt && (forall v :: v in s.tasks[i].toldSoon ==> v in s2.tasks[j].toldSoon) && (forall v :: v in s.tasks[i].toldDue ==> v in s2.tasks[j].toldDue)
  {
    assert s2.tasks[j] == recorded(s.tasks[j], s.now);
  }
  TOldNotesRecorded(s, s2);
  forall k | 0 <= k < |s2.sent|
    ensures s2.sent[k].task <= s2.lastId && forall j :: 0 <= j < |s2.tasks| ==> (s2.tasks[j].id == s2.sent[k].task ==> ((s2.sent[k].kind.Update? ==> s2.sent[k].version <= s2.tasks[j].notifiedAt) && (s2.sent[k].kind.Soon? ==> s2.sent[k].version in s2.tasks[j].toldSoon) && (s2.sent[k].kind.Today? ==> s2.sent[k].version in s2.tasks[j].toldDue)))
  {
    if k < |s.sent| {
      assert s2.sent[k] == s.sent[k];
    } else {
      var x := s2.sent[k];
      assert x == newNotes[k - |s.sent|];
      TNewNote(s, x);
      var i :| 0 <= i < |s.tasks| && x in notesFor(s, s.tasks[i]);
      TNoteFacts(s, s.tasks[i], x);
      assert s.tasks[i].id <= s.lastId;
      forall j | 0 <= j < |s2.tasks| && s2.tasks[j].id == x.task
        ensures (x.kind.Update? ==> x.version <= s2.tasks[j].notifiedAt) && (x.kind.Soon? ==> x.version in s2.tasks[j].toldSoon) && (x.kind.Today? ==> x.version in s2.tasks[j].toldDue)
      {
        assert s2.tasks[j] == recorded(s.tasks[j], s.now);
        TUniqueIndex(s, i, j);
      }
    }
  }
}

// Adding a member as an owner changes none of the task's problems.
lemma TMemberAddedSameProblems(s: Tracker, t: Task, t2: Task, owner: string)
  requires owner in s.owners
  requires t2.id == t.id && t2.parents == t.parents && t2.related == t.related && t2.owners == addName(t.owners, owner)
  ensures problemsOf(s, t) == problemsOf(s, t2)
{
  ProofLib.FilterAppend((o: string) => !((o in s.owners)), t.owners, owner);
}

// ===== Nothing is sent twice by a notifier pass =====

// Two lists without repeated keys, and no key in both: their concatenation repeats no key.
lemma TDistinctByConcat<T, K>(a: seq<T>, b: seq<T>, key: T -> K)
  requires ProofLib.DistinctBy(a, key) && ProofLib.DistinctBy(b, key)
  requires forall x, y :: x in a && y in b ==> key(x) != key(y)
  ensures ProofLib.DistinctBy(a + b, key)
{
  var c := a + b;
  forall i, j | 0 <= i < |c| && 0 <= j < |c| && i != j
    ensures key(c[i]) != key(c[j])
  {
    if i < |a| && j >= |a| {
      assert c[i] == a[i] && c[j] == b[j - |a|];
    } else if i >= |a| && j < |a| {
      assert c[j] == a[j] && c[i] == b[i - |a|];
    } else if i >= |a| && j >= |a| {
      assert c[i] == b[i - |a|] && c[j] == b[j - |a|];
    }
  }
}

// A fold that appends h(x) for each x repeats no key when no piece does and no two pieces share one.
lemma TFoldDistinctBy<T, U, K>(f: (seq<T>, U) -> seq<T>, h: U -> seq<T>, key: T -> K, init: seq<T>, xs: seq<U>)
  requires forall a, y :: f(a, y) == a + h(y)
  requires ProofLib.DistinctBy(init, key)
  requires forall i :: 0 <= i < |xs| ==> ProofLib.DistinctBy(h(xs[i]), key)
  requires forall i, x, y :: 0 <= i < |xs| && x in init && y in h(xs[i]) ==> key(x) != key(y)
  requires forall i, j, x, y :: 0 <= i < j < |xs| && x in h(xs[i]) && y in h(xs[j]) ==> key(x) != key(y)
  ensures ProofLib.DistinctBy(Std.Collections.Seq.FoldLeft(f, init, xs), key)
  decreases |xs|
{
  if |xs| > 0 {
    TDistinctByConcat(init, h(xs[0]), key);
    assert forall i :: 1 <= i < |xs| ==> xs[i] == xs[1..][i - 1];
    forall i, x, y | 0 <= i < |xs[1..]| && x in f(init, xs[0]) && y in h(xs[1..][i])
      ensures key(x) != key(y)
    {
      assert xs[1..][i] == xs[i + 1];
    }
    TFoldDistinctBy(f, h, key, f(init, xs[0]), xs[1..]);
  }
}

// The rule, restated over ProofLib.Filter.
lemma TSentTwiceBridge(s: Tracker)
  ensures alwaysNothingIsSentTwice(s) == Std.Collections.Seq.All(s.sent, (a: Note) => (|ProofLib.Filter((b: Note) => ((((a.kind == b.kind) && (a.task == b.task)) && (a.to == b.to)) && (a.version == b.version)), s.sent)| == 1))
{
}

// Nothing sent twice means no two notes share kind, task, person and version.
lemma TSentDistinct(sent: seq<Note>)
  ensures Std.Collections.Seq.All(sent, (a: Note) => (|ProofLib.Filter((b: Note) => ((((a.kind == b.kind) && (a.task == b.task)) && (a.to == b.to)) && (a.version == b.version)), sent)| == 1)) <==> ProofLib.DistinctBy(sent, (n: Note) => (n.kind, n.task, n.to, n.version))
{
  forall i | 0 <= i < |sent|
    ensures (|ProofLib.Filter((b: Note) => ((((sent[i].kind == b.kind) && (sent[i].task == b.task)) && (sent[i].to == b.to)) && (sent[i].version == b.version)), sent)| == 1) <==> (forall j :: 0 <= j < |sent| && j != i ==> (sent[j].kind, sent[j].task, sent[j].to, sent[j].version) != (sent[i].kind, sent[i].task, sent[i].to, sent[i].version))
  {
    var a := sent[i];
    ProofLib.FilterCountOneIffUnique((b: Note) => ((((a.kind == b.kind) && (a.task == b.task)) && (a.to == b.to)) && (a.version == b.version)), sent, (n: Note) => (n.kind, n.task, n.to, n.version), i);
  }
}

// One task's notes of a pass repeat no key: each block has one kind, and goes to each person once.
lemma TNotesForDistinct(s: Tracker, t: Task)
  ensures ProofLib.DistinctBy(notesFor(s, t), (n: Note) => (n.kind, n.task, n.to, n.version))
{
  var key := (n: Note) => (n.kind, n.task, n.to, n.version);
  var ko := knownOwners(s, t);
  ProofLib.FoldLeftDedupDistinct((acc: seq<string>, x: string) => (if (x in acc) then acc else (acc + [x])), [], ProofLib.Filter((o: string) => (o in s.owners), t.owners));
  assert ProofLib.Distinct(ko);
  assert ProofLib.DistinctBy(ko, (o: string) => o);
  var up := ProofLib.Filter((o: string) => (o != t.updatedBy), ko);
  ProofLib.FilterKeepsDistinctBy((o: string) => (o != t.updatedBy), ko, (o: string) => o);
  var a := if updateIsDue(t, s.now) then seq(|up|, i requires 0 <= i < |up| => Note(NoteKind.Update, t.id, up[i], t.updatedAt, s.now)) else [];
  var b := if reminder(t, s.now).DueSoon? then seq(|ko|, i requires 0 <= i < |ko| => Note(NoteKind.Soon, t.id, ko[i], t.due, s.now)) else [];
  var c := if reminder(t, s.now).DueToday? then seq(|ko|, i requires 0 <= i < |ko| => Note(NoteKind.Today, t.id, ko[i], t.due, s.now)) else [];
  assert notesFor(s, t) == a + b + c;
  assert ProofLib.DistinctBy(a, key);
  assert ProofLib.DistinctBy(b, key);
  assert ProofLib.DistinctBy(c, key);
  TDistinctByConcat(a, b, key);
  TDistinctByConcat(a + b, c, key);
}

lemma TNotifyNothingSentTwice(s: Tracker)
  requires inv(s)
  ensures alwaysNothingIsSentTwice(notify(s))
{
  var s2 := notify(s);
  var key := (n: Note) => (n.kind, n.task, n.to, n.version);
  var f := (acc: seq<Note>, t: Task) => (acc + notesFor(s, t));
  var newNotes := Std.Collections.Seq.FoldLeft((acc: seq<Note>, t: Task) => (acc + notesFor(s, t)), [], s.tasks);
  assert s2.sent == s.sent + newNotes;
  forall i | 0 <= i < |s.tasks|
    ensures ProofLib.DistinctBy(notesFor(s, s.tasks[i]), key)
  {
    TNotesForDistinct(s, s.tasks[i]);
  }
  forall i, j, x, y | 0 <= i < j < |s.tasks| && x in notesFor(s, s.tasks[i]) && y in notesFor(s, s.tasks[j])
    ensures key(x) != key(y)
  {
    TNoteFacts(s, s.tasks[i], x);
    TNoteFacts(s, s.tasks[j], y);
    if s.tasks[i].id == s.tasks[j].id {
      TUniqueIndex(s, i, j);
    }
  }
  TFoldDistinctBy((acc: seq<Note>, t: Task) => (acc + notesFor(s, t)), (t: Task) => notesFor(s, t), key, [], s.tasks);
  TSentTwiceBridge(s);
  TSentDistinct(s.sent);
  forall x, y | x in s.sent && y in newNotes
    ensures key(x) != key(y)
  {
    TNewNote(s, y);
    var i :| 0 <= i < |s.tasks| && y in notesFor(s, s.tasks[i]);
    var t := s.tasks[i];
    TNoteFacts(s, t, y);
    if key(x) == key(y) {
      assert x.task == t.id;
    }
  }
  TDistinctByConcat(s.sent, newNotes, key);
  TSentTwiceBridge(s2);
  TSentDistinct(s2.sent);
}

// ===== Edits that only take owners away, or members away, add no problem (part of F7) =====

// A problem is on the warning list exactly when it is a problem of one of the tasks.
lemma TProblemsMember(s: Tracker, p: Problem)
  ensures p in problems(s) <==> exists i :: 0 <= i < |s.tasks| && p in problemsOf(s, s.tasks[i])
{
  TFoldConcatMember((acc: seq<Problem>, t: Task) => (acc + problemsOf(s, t)), (t: Task) => problemsOf(s, t), [], s.tasks, p);
}

// Every problem after was already a problem before: nothing was added.
lemma TSubsetNoNewProblem(s: Tracker, s2: Tracker)
  requires forall p :: p in problems(s2) ==> p in problems(s)
  ensures addsNoProblem(s, s2)
{
  var ps := problems(s2);
  forall i | 0 <= i < |ps|
    ensures exists q :: q in problems(s) && sameProblem(ps[i], q)
  {
    assert ps[i] in problems(s) && sameProblem(ps[i], ps[i]);
  }
}

// A task's problems are its unknown owners, then the problems it would have with no owners.
lemma TProblemsOfSplit(s: Tracker, t: Task)
  ensures problemsOf(s, t) == seq(|ProofLib.Filter((o: string) => !((o in s.owners)), t.owners)|, i requires 0 <= i < |ProofLib.Filter((o: string) => !((o in s.owners)), t.owners)| => Problem(Code.UnknownOwner, t.id, 0, ProofLib.Filter((o: string) => !((o in s.owners)), t.owners)[i])) + problemsOf(s, t.(owners := []))
{
  ProofLib.FilterNil((o: string) => !((o in s.owners)), t.(owners := []).owners);
}

// What the unknown-owner part of a task's problems holds.
lemma TUnknownOwnerPart(s: Tracker, t: Task, p: Problem)
  ensures p in seq(|ProofLib.Filter((o: string) => !((o in s.owners)), t.owners)|, i requires 0 <= i < |ProofLib.Filter((o: string) => !((o in s.owners)), t.owners)| => Problem(Code.UnknownOwner, t.id, 0, ProofLib.Filter((o: string) => !((o in s.owners)), t.owners)[i]))
    <==> (p == Problem(Code.UnknownOwner, t.id, 0, p.name) && p.name in t.owners && !(p.name in s.owners))
{
  var m := ProofLib.Filter((o: string) => !((o in s.owners)), t.owners);
  var a := seq(|ProofLib.Filter((o: string) => !((o in s.owners)), t.owners)|, i requires 0 <= i < |ProofLib.Filter((o: string) => !((o in s.owners)), t.owners)| => Problem(Code.UnknownOwner, t.id, 0, ProofLib.Filter((o: string) => !((o in s.owners)), t.owners)[i]));
  ProofLib.FilterMember((o: string) => !((o in s.owners)), t.owners, p.name);
  if p in a {
    var k :| 0 <= k < |a| && a[k] == p;
    assert m[k] in m;
  }
  if p == Problem(Code.UnknownOwner, t.id, 0, p.name) && p.name in m {
    var k :| 0 <= k < |m| && m[k] == p.name;
    assert a[k] == p;
  }
}

// Same links: a task without owners has the same problems in both states, whatever the members.
lemma TSameLinksNoOwners(s: Tracker, s2: Tracker)
  requires |s.tasks| == |s2.tasks|
  requires forall i :: 0 <= i < |s.tasks| ==> s.tasks[i].id == s2.tasks[i].id && s.tasks[i].parents == s2.tasks[i].parents && s.tasks[i].related == s2.tasks[i].related
  ensures forall t: Task :: |t.owners| == 0 ==> problemsOf(s, t) == problemsOf(s2, t)
{
  TSameLinksHasTask(s, s2);
  TSameParentsAncestors(s, s2);
  forall t: Task | |t.owners| == 0
    ensures problemsOf(s, t) == problemsOf(s2, t)
  {
    ProofLib.FilterNil((o: string) => !((o in s.owners)), t.owners);
    ProofLib.FilterNil((o: string) => !((o in s2.owners)), t.owners);
    ProofLib.FilterSamePredicate((p: int) => ((p != t.id) && !(hasTask(s, p))), (p: int) => ((p != t.id) && !(hasTask(s2, p))), t.parents);
    ProofLib.FilterSamePredicate((r: int) => ((r != t.id) && !(hasTask(s, r))), (r: int) => ((r != t.id) && !(hasTask(s2, r))), t.related);
    ProofLib.FilterSamePredicate((r: int) => (((r != t.id) && hasTask(s, r)) && !(linksBack(s, r, t.id))), (r: int) => (((r != t.id) && hasTask(s2, r)) && !(linksBack(s2, r, t.id))), t.related);
  }
}

// Same links, and every unknown owner after was an unknown owner before: no task gains a problem.
lemma TOwnersShrinkProblems(s: Tracker, s2: Tracker, t: Task, t2: Task)
  requires |s.tasks| == |s2.tasks|
  requires forall i :: 0 <= i < |s.tasks| ==> s.tasks[i].id == s2.tasks[i].id && s.tasks[i].parents == s2.tasks[i].parents && s.tasks[i].related == s2.tasks[i].related
  requires t.id == t2.id && t.parents == t2.parents && t.related == t2.related
  requires forall o :: o in t2.owners && !(o in s2.owners) ==> o in t.owners && !(o in s.owners)
  ensures forall p :: p in problemsOf(s2, t2) ==> p in problemsOf(s, t)
{
  TSameLinksNoOwners(s, s2);
  TProblemsOfSplit(s, t);
  TProblemsOfSplit(s2, t2);
  var bare := t.(owners := []);
  var bare2 := t2.(owners := []);
  assert problemsOf(s2, bare) == problemsOf(s2, bare2) by {
    assert bare.id == bare2.id && bare.owners == bare2.owners && bare.parents == bare2.parents && bare.related == bare2.related;
  }
  forall p | p in problemsOf(s2, t2)
    ensures p in problemsOf(s, t)
  {
    TUnknownOwnerPart(s2, t2, p);
    TUnknownOwnerPart(s, t, p);
  }
}

// The same for the whole warning list.
lemma TOwnersShrinkNoNewProblem(s: Tracker, s2: Tracker)
  requires |s.tasks| == |s2.tasks|
  requires forall i :: 0 <= i < |s.tasks| ==> s.tasks[i].id == s2.tasks[i].id && s.tasks[i].parents == s2.tasks[i].parents && s.tasks[i].related == s2.tasks[i].related
  requires forall i, o :: 0 <= i < |s.tasks| && o in s2.tasks[i].owners && !(o in s2.owners) ==> o in s.tasks[i].owners && !(o in s.owners)
  ensures addsNoProblem(s, s2)
{
  forall p | p in problems(s2)
    ensures p in problems(s)
  {
    TProblemsMember(s2, p);
    var i :| 0 <= i < |s2.tasks| && p in problemsOf(s2, s2.tasks[i]);
    TOwnersShrinkProblems(s, s2, s.tasks[i], s2.tasks[i]);
    TProblemsMember(s, p);
  }
  TSubsetNoNewProblem(s, s2);
}

// A de-duplicating fold holds only what it started with and what it read.
lemma TDedupMember<T>(f: (seq<T>, T) -> seq<T>, acc: seq<T>, xs: seq<T>, x: T)
  requires forall a, y :: f(a, y) == (if y in a then a else a + [y])
  ensures x in Std.Collections.Seq.FoldLeft(f, acc, xs) ==> x in acc || x in xs
  decreases |xs|
{
  if |xs| > 0 {
    TDedupMember(f, f(acc, xs[0]), xs[1..], x);
  }
}

// ===== A task's problems, part by part; each part has its own code =====

lemma TProblemsOfParts(s: Tracker, t: Task)
  ensures problemsOf(s, t) ==
    seq(|ProofLib.Filter((o: string) => !((o in s.owners)), t.owners)|, i requires 0 <= i < |ProofLib.Filter((o: string) => !((o in s.owners)), t.owners)| => Problem(Code.UnknownOwner, t.id, 0, ProofLib.Filter((o: string) => !((o in s.owners)), t.owners)[i]))
    + seq(|ProofLib.Filter((p: int) => ((p != t.id) && !(hasTask(s, p))), t.parents)|, i requires 0 <= i < |ProofLib.Filter((p: int) => ((p != t.id) && !(hasTask(s, p))), t.parents)| => Problem(Code.UnknownParent, t.id, ProofLib.Filter((p: int) => ((p != t.id) && !(hasTask(s, p))), t.parents)[i], ""))
    + seq(|ProofLib.Filter((r: int) => ((r != t.id) && !(hasTask(s, r))), t.related)|, i requires 0 <= i < |ProofLib.Filter((r: int) => ((r != t.id) && !(hasTask(s, r))), t.related)| => Problem(Code.UnknownRelated, t.id, ProofLib.Filter((r: int) => ((r != t.id) && !(hasTask(s, r))), t.related)[i], ""))
    + (if (t.id in t.parents) then [Problem(Code.SelfParent, t.id, t.id, "")] else [])
    + (if (t.id in t.related) then [Problem(Code.SelfRelated, t.id, t.id, "")] else [])
    + (if (t.id in ancestors(s, t.id)) then [Problem(Code.Cycle, t.id, t.id, "")] else [])
    + seq(|ProofLib.Filter((r: int) => (((r != t.id) && hasTask(s, r)) && !(linksBack(s, r, t.id))), t.related)|, i requires 0 <= i < |ProofLib.Filter((r: int) => (((r != t.id) && hasTask(s, r)) && !(linksBack(s, r, t.id))), t.related)| => Problem(Code.OneSided, t.id, ProofLib.Filter((r: int) => (((r != t.id) && hasTask(s, r)) && !(linksBack(s, r, t.id))), t.related)[i], ""))
{
}

lemma TUnknownParentPart(s: Tracker, t: Task, q: Problem)
  ensures q in seq(|ProofLib.Filter((p: int) => ((p != t.id) && !(hasTask(s, p))), t.parents)|, i requires 0 <= i < |ProofLib.Filter((p: int) => ((p != t.id) && !(hasTask(s, p))), t.parents)| => Problem(Code.UnknownParent, t.id, ProofLib.Filter((p: int) => ((p != t.id) && !(hasTask(s, p))), t.parents)[i], ""))
    <==> (q == Problem(Code.UnknownParent, t.id, q.ref, "") && q.ref in t.parents && q.ref != t.id && !hasTask(s, q.ref))
{
  var m := ProofLib.Filter((p: int) => ((p != t.id) && !(hasTask(s, p))), t.parents);
  var a := seq(|ProofLib.Filter((p: int) => ((p != t.id) && !(hasTask(s, p))), t.parents)|, i requires 0 <= i < |ProofLib.Filter((p: int) => ((p != t.id) && !(hasTask(s, p))), t.parents)| => Problem(Code.UnknownParent, t.id, ProofLib.Filter((p: int) => ((p != t.id) && !(hasTask(s, p))), t.parents)[i], ""));
  ProofLib.FilterMember((p: int) => ((p != t.id) && !(hasTask(s, p))), t.parents, q.ref);
  if q in a {
    var k :| 0 <= k < |a| && a[k] == q;
    assert m[k] in m;
  }
  if q == Problem(Code.UnknownParent, t.id, q.ref, "") && q.ref in m {
    var k :| 0 <= k < |m| && m[k] == q.ref;
    assert a[k] == q;
  }
}

lemma TUnknownRelatedPart(s: Tracker, t: Task, q: Problem)
  ensures q in seq(|ProofLib.Filter((r: int) => ((r != t.id) && !(hasTask(s, r))), t.related)|, i requires 0 <= i < |ProofLib.Filter((r: int) => ((r != t.id) && !(hasTask(s, r))), t.related)| => Problem(Code.UnknownRelated, t.id, ProofLib.Filter((r: int) => ((r != t.id) && !(hasTask(s, r))), t.related)[i], ""))
    <==> (q == Problem(Code.UnknownRelated, t.id, q.ref, "") && q.ref in t.related && q.ref != t.id && !hasTask(s, q.ref))
{
  var m := ProofLib.Filter((r: int) => ((r != t.id) && !(hasTask(s, r))), t.related);
  var a := seq(|ProofLib.Filter((r: int) => ((r != t.id) && !(hasTask(s, r))), t.related)|, i requires 0 <= i < |ProofLib.Filter((r: int) => ((r != t.id) && !(hasTask(s, r))), t.related)| => Problem(Code.UnknownRelated, t.id, ProofLib.Filter((r: int) => ((r != t.id) && !(hasTask(s, r))), t.related)[i], ""));
  ProofLib.FilterMember((r: int) => ((r != t.id) && !(hasTask(s, r))), t.related, q.ref);
  if q in a {
    var k :| 0 <= k < |a| && a[k] == q;
    assert m[k] in m;
  }
  if q == Problem(Code.UnknownRelated, t.id, q.ref, "") && q.ref in m {
    var k :| 0 <= k < |m| && m[k] == q.ref;
    assert a[k] == q;
  }
}

lemma TOneSidedPart(s: Tracker, t: Task, q: Problem)
  ensures q in seq(|ProofLib.Filter((r: int) => (((r != t.id) && hasTask(s, r)) && !(linksBack(s, r, t.id))), t.related)|, i requires 0 <= i < |ProofLib.Filter((r: int) => (((r != t.id) && hasTask(s, r)) && !(linksBack(s, r, t.id))), t.related)| => Problem(Code.OneSided, t.id, ProofLib.Filter((r: int) => (((r != t.id) && hasTask(s, r)) && !(linksBack(s, r, t.id))), t.related)[i], ""))
    <==> (q == Problem(Code.OneSided, t.id, q.ref, "") && q.ref in t.related && q.ref != t.id && hasTask(s, q.ref) && !linksBack(s, q.ref, t.id))
{
  var m := ProofLib.Filter((r: int) => (((r != t.id) && hasTask(s, r)) && !(linksBack(s, r, t.id))), t.related);
  var a := seq(|ProofLib.Filter((r: int) => (((r != t.id) && hasTask(s, r)) && !(linksBack(s, r, t.id))), t.related)|, i requires 0 <= i < |ProofLib.Filter((r: int) => (((r != t.id) && hasTask(s, r)) && !(linksBack(s, r, t.id))), t.related)| => Problem(Code.OneSided, t.id, ProofLib.Filter((r: int) => (((r != t.id) && hasTask(s, r)) && !(linksBack(s, r, t.id))), t.related)[i], ""));
  ProofLib.FilterMember((r: int) => (((r != t.id) && hasTask(s, r)) && !(linksBack(s, r, t.id))), t.related, q.ref);
  if q in a {
    var k :| 0 <= k < |a| && a[k] == q;
    assert m[k] in m;
  }
  if q == Problem(Code.OneSided, t.id, q.ref, "") && q.ref in m {
    var k :| 0 <= k < |m| && m[k] == q.ref;
    assert a[k] == q;
  }
}

// Each kind of problem a task has after, it had before: the task gains no problem.
lemma TProblemsOfSubset(s: Tracker, s2: Tracker, t: Task, t2: Task)
  requires t2.id == t.id
  requires forall o :: o in t2.owners && !(o in s2.owners) ==> o in t.owners && !(o in s.owners)
  requires forall p :: p in t2.parents && p != t.id && !hasTask(s2, p) ==> p in t.parents && !hasTask(s, p)
  requires forall r :: r in t2.related && r != t.id && !hasTask(s2, r) ==> r in t.related && !hasTask(s, r)
  requires t.id in t2.parents ==> t.id in t.parents
  requires t.id in t2.related ==> t.id in t.related
  requires t.id in ancestors(s2, t.id) ==> t.id in ancestors(s, t.id)
  requires forall r :: r in t2.related && r != t.id && hasTask(s2, r) && !linksBack(s2, r, t.id) ==> r in t.related && hasTask(s, r) && !linksBack(s, r, t.id)
  ensures forall q :: q in problemsOf(s2, t2) ==> q in problemsOf(s, t)
{
  TProblemsOfParts(s, t);
  TProblemsOfParts(s2, t2);
  forall q | q in problemsOf(s2, t2)
    ensures q in problemsOf(s, t)
  {
    TUnknownOwnerPart(s2, t2, q);
    TUnknownOwnerPart(s, t, q);
    TUnknownParentPart(s2, t2, q);
    TUnknownParentPart(s, t, q);
    TUnknownRelatedPart(s2, t2, q);
    TUnknownRelatedPart(s, t, q);
    TOneSidedPart(s2, t2, q);
    TOneSidedPart(s, t, q);
  }
}

// Every task, position by position, gains no problem: the warning list gains none.
lemma TEachTaskNoNewProblem(s: Tracker, s2: Tracker)
  requires |s.tasks| == |s2.tasks|
  requires forall i, q :: 0 <= i < |s.tasks| && q in problemsOf(s2, s2.tasks[i]) ==> q in problemsOf(s, s.tasks[i])
  ensures addsNoProblem(s, s2)
{
  forall q | q in problems(s2)
    ensures q in problems(s)
  {
    TProblemsMember(s2, q);
    TProblemsMember(s, q);
  }
  TSubsetNoNewProblem(s, s2);
}

// Same task numbers: the same tasks exist.
lemma TSameIdsHasTask(s: Tracker, s2: Tracker)
  requires |s.tasks| == |s2.tasks|
  requires forall i :: 0 <= i < |s.tasks| ==> s.tasks[i].id == s2.tasks[i].id
  ensures forall p :: hasTask(s, p) == hasTask(s2, p)
{
  forall p
    ensures hasTask(s, p) == hasTask(s2, p)
  {
    if hasTask(s, p) {
      var t :| t in s.tasks && t.id == p;
      var i :| 0 <= i < |s.tasks| && s.tasks[i] == t;
      assert s2.tasks[i] in s2.tasks;
    }
    if hasTask(s2, p) {
      var t :| t in s2.tasks && t.id == p;
      var i :| 0 <= i < |s2.tasks| && s2.tasks[i] == t;
      assert s.tasks[i] in s.tasks;
    }
  }
}

// ===== relate and unrelate add no problem =====

lemma TLinksBackAt(s: Tracker, k: int, r: int, x: int)
  requires 0 <= k < |s.tasks| && s.tasks[k].id == r && x in s.tasks[k].related
  ensures linksBack(s, r, x)
{
  assert s.tasks[k] in s.tasks;
}

lemma TRelateTask(s: Tracker, id: int, other: int, actor: string, i: int)
  requires canRelate(s, id, other, actor) && 0 <= i < |s.tasks|
  ensures forall q :: q in problemsOf(relate(s, id, other, actor), relate(s, id, other, actor).tasks[i]) ==> q in problemsOf(s, s.tasks[i])
{
  var s2 := relate(s, id, other, actor);
  var t := s.tasks[i];
  var t2 := s2.tasks[i];
  TSameIdsHasTask(s, s2);
  TSameParentsAncestors(s, s2);
  forall r, x | linksBack(s, r, x)
    ensures linksBack(s2, r, x)
  {
    var u :| u in s.tasks && u.id == r && x in u.related;
    var k :| 0 <= k < |s.tasks| && s.tasks[k] == u;
    TLinksBackAt(s2, k, r, x);
  }
  forall r | r in t2.related && r != t.id && hasTask(s2, r) && !linksBack(s2, r, t.id)
    ensures r in t.related && hasTask(s, r) && !linksBack(s, r, t.id)
  {
    if !(r in t.related) {
      if t.id == id {
        assert r == other;
        var u :| u in s.tasks && u.id == other;
        var k :| 0 <= k < |s.tasks| && s.tasks[k] == u;
        TLinksBackAt(s2, k, other, id);
      } else {
        assert t.id == other && r == id;
        var u :| u in s.tasks && u.id == id;
        var k :| 0 <= k < |s.tasks| && s.tasks[k] == u;
        TLinksBackAt(s2, k, id, other);
      }
    }
  }
  TProblemsOfSubset(s, s2, t, t2);
}

lemma TUnrelateTask(s: Tracker, id: int, other: int, actor: string, i: int)
  requires canUnrelate(s, id, other, actor) && 0 <= i < |s.tasks|
  ensures forall q :: q in problemsOf(unrelate(s, id, other, actor), unrelate(s, id, other, actor).tasks[i]) ==> q in problemsOf(s, s.tasks[i])
{
  var s2 := unrelate(s, id, other, actor);
  var t := s.tasks[i];
  var t2 := s2.tasks[i];
  TSameIdsHasTask(s, s2);
  TSameParentsAncestors(s, s2);
  forall r | r in t2.related
    ensures r in t.related
  {
    if t.id == id {
      ProofLib.FilterMember((y: int) => (y != other), t.related, r);
    } else if t.id == other {
      ProofLib.FilterMember((y: int) => (y != id), t.related, r);
    }
  }
  forall r | r in t2.related && r != t.id && hasTask(s2, r) && !linksBack(s2, r, t.id)
    ensures !linksBack(s, r, t.id)
  {
    if linksBack(s, r, t.id) {
      var u :| u in s.tasks && u.id == r && t.id in u.related;
      var k :| 0 <= k < |s.tasks| && s.tasks[k] == u;
      if r == id {
        ProofLib.FilterMember((y: int) => (y != other), u.related, t.id);
        if t.id == other {
          ProofLib.FilterMember((y: int) => (y != id), t.related, r);
        } else {
          TLinksBackAt(s2, k, r, t.id);
        }
      } else if r == other {
        ProofLib.FilterMember((y: int) => (y != id), u.related, t.id);
        if t.id == id {
          ProofLib.FilterMember((y: int) => (y != other), t.related, r);
        } else {
          TLinksBackAt(s2, k, r, t.id);
        }
      } else {
        TLinksBackAt(s2, k, r, t.id);
      }
    }
  }
  TProblemsOfSubset(s, s2, t, t2);
}

// ===== Ancestors only shrink when links only shrink (part of F7) =====

// What the parent-collecting fold holds: every parent, other than the task itself, of a task it read.
lemma TParentsFoldMember(init: seq<int>, ts: seq<Task>, x: int)
  ensures x in Std.Collections.Seq.FoldLeft((acc: seq<int>, t: Task) => (acc + Std.Collections.Seq.Filter((p: int) => ((p != t.id) && !((p in acc))), t.parents)), init, ts) <==> (x in init || exists i :: 0 <= i < |ts| && x in ts[i].parents && x != ts[i].id)
  decreases |ts|
{
  if |ts| > 0 {
    var t := ts[0];
    ProofLib.FilterMember((p: int) => ((p != t.id) && !((p in init))), t.parents, x);
    TParentsFoldMember(init + ProofLib.Filter((p: int) => ((p != t.id) && !((p in init))), t.parents), ts[1..], x);
    assert forall i :: 1 <= i < |ts| ==> ts[i] == ts[1..][i - 1];
  }
}

lemma TParentsOfAllMember(s: Tracker, ids: seq<int>, x: int)
  ensures x in parentsOfAll(s, ids) <==> exists t :: t in s.tasks && t.id in ids && x in t.parents && x != t.id
{
  var kept := ProofLib.Filter((t: Task) => (t.id in ids), s.tasks);
  TParentsFoldMember([], kept, x);
  forall t | t in s.tasks && t.id in ids && x in t.parents && x != t.id
    ensures exists i :: 0 <= i < |kept| && x in kept[i].parents && x != kept[i].id
  {
    ProofLib.FilterMember((t: Task) => (t.id in ids), s.tasks, t);
    var i :| 0 <= i < |kept| && kept[i] == t;
  }
  forall i | 0 <= i < |kept|
    ensures kept[i] in s.tasks && kept[i].id in ids
  {
    ProofLib.FilterMember((t: Task) => (t.id in ids), s.tasks, kept[i]);
  }
}

// One round of the ancestor search keeps what it had and adds the parents of what it had.
lemma TAncRoundMember(s: Tracker, acc: seq<int>, t: Task, x: int)
  ensures x in ((acc: seq<int>, t: Task) => (acc + Std.Collections.Seq.Filter((p: int) => !((p in acc)), parentsOfAll(s, acc))))(acc, t) <==> (x in acc || x in parentsOfAll(s, acc))
{
  ProofLib.FilterMember((p: int) => !((p in acc)), parentsOfAll(s, acc), x);
}

// The ancestor search never loses what it starts with.
lemma TAncInflate(s: Tracker, a: seq<int>, xs: seq<Task>, x: int)
  requires x in a
  ensures x in Std.Collections.Seq.FoldLeft((acc: seq<int>, t: Task) => (acc + Std.Collections.Seq.Filter((p: int) => !((p in acc)), parentsOfAll(s, acc))), a, xs)
  decreases |xs|
{
  if |xs| > 0 {
    TAncRoundMember(s, a, xs[0], x);
    TAncInflate(s, ((acc: seq<int>, t: Task) => (acc + Std.Collections.Seq.Filter((p: int) => !((p in acc)), parentsOfAll(s, acc))))(a, xs[0]), xs[1..], x);
  }
}

// Fewer links and no more rounds, from less: the ancestor search finds no more.
lemma TAncFoldShrink(s: Tracker, s2: Tracker, a: seq<int>, a2: seq<int>, xs: seq<Task>, xs2: seq<Task>, x: int)
  requires forall u2 :: u2 in s2.tasks ==> exists u :: u in s.tasks && u.id == u2.id && (forall p :: p in u2.parents ==> p in u.parents)
  requires forall y :: y in a2 ==> y in a
  requires |xs2| <= |xs|
  ensures x in Std.Collections.Seq.FoldLeft((acc: seq<int>, t: Task) => (acc + Std.Collections.Seq.Filter((p: int) => !((p in acc)), parentsOfAll(s2, acc))), a2, xs2) ==> x in Std.Collections.Seq.FoldLeft((acc: seq<int>, t: Task) => (acc + Std.Collections.Seq.Filter((p: int) => !((p in acc)), parentsOfAll(s, acc))), a, xs)
  decreases |xs|
{
  if |xs2| == 0 {
    if x in a2 {
      TAncInflate(s, a, xs, x);
    }
  } else {
    var b2 := ((acc: seq<int>, t: Task) => (acc + Std.Collections.Seq.Filter((p: int) => !((p in acc)), parentsOfAll(s2, acc))))(a2, xs2[0]);
    var b := ((acc: seq<int>, t: Task) => (acc + Std.Collections.Seq.Filter((p: int) => !((p in acc)), parentsOfAll(s, acc))))(a, xs[0]);
    forall y | y in b2
      ensures y in b
    {
      TAncRoundMember(s2, a2, xs2[0], y);
      TAncRoundMember(s, a, xs[0], y);
      if y in parentsOfAll(s2, a2) {
        TParentsOfAllMember(s2, a2, y);
        var u2 :| u2 in s2.tasks && u2.id in a2 && y in u2.parents && y != u2.id;
        var u :| u in s.tasks && u.id == u2.id && (forall p :: p in u2.parents ==> p in u.parents);
        TParentsOfAllMember(s, a, y);
      }
    }
    TAncFoldShrink(s, s2, b, b2, xs[1..], xs2[1..], x);
  }
}

// Fewer links and no more tasks: no task has more ancestors.
lemma TAncestorsShrink(s: Tracker, s2: Tracker)
  requires forall u2 :: u2 in s2.tasks ==> exists u :: u in s.tasks && u.id == u2.id && (forall p :: p in u2.parents ==> p in u.parents)
  requires |s2.tasks| <= |s.tasks|
  ensures forall id, x :: x in ancestors(s2, id) ==> x in ancestors(s, id)
{
  forall id, x | x in ancestors(s2, id)
    ensures x in ancestors(s, id)
  {
    forall y | y in parentsOfAll(s2, [id])
      ensures y in parentsOfAll(s, [id])
    {
      TParentsOfAllMember(s2, [id], y);
      var u2 :| u2 in s2.tasks && u2.id in [id] && y in u2.parents && y != u2.id;
      var u :| u in s.tasks && u.id == u2.id && (forall p :: p in u2.parents ==> p in u.parents);
      TParentsOfAllMember(s, [id], y);
    }
    TAncFoldShrink(s, s2, parentsOfAll(s, [id]), parentsOfAll(s2, [id]), s.tasks, s2.tasks, x);
  }
}

// Every task after gains no problem over some task before: the warning list gains none.
lemma TSomeTaskNoNewProblem(s: Tracker, s2: Tracker)
  requires forall j, q :: 0 <= j < |s2.tasks| && q in problemsOf(s2, s2.tasks[j]) ==> exists i :: 0 <= i < |s.tasks| && q in problemsOf(s, s.tasks[i])
  ensures addsNoProblem(s, s2)
{
  forall q | q in problems(s2)
    ensures q in problems(s)
  {
    TProblemsMember(s2, q);
    TProblemsMember(s, q);
  }
  TSubsetNoNewProblem(s, s2);
}

// ===== removeParent and deleteTask add no problem =====

lemma TRemoveParentTask(s: Tracker, id: int, other: int, actor: string, i: int)
  requires 0 <= i < |s.tasks|
  ensures forall q :: q in problemsOf(removeParent(s, id, other, actor), removeParent(s, id, other, actor).tasks[i]) ==> q in problemsOf(s, s.tasks[i])
{
  var s2 := removeParent(s, id, other, actor);
  var t := s.tasks[i];
  var t2 := s2.tasks[i];
  TSameIdsHasTask(s, s2);
  TSameLinksHasTask(s, s2);
  forall u2 | u2 in s2.tasks
    ensures exists u :: u in s.tasks && u.id == u2.id && (forall p :: p in u2.parents ==> p in u.parents)
  {
    var k :| 0 <= k < |s2.tasks| && s2.tasks[k] == u2;
    var u := s.tasks[k];
    forall p | p in u2.parents
      ensures p in u.parents
    {
      if u.id == id {
        ProofLib.FilterMember((y: int) => (y != other), u.parents, p);
      }
    }
    assert u in s.tasks;
  }
  TAncestorsShrink(s, s2);
  forall p | p in t2.parents
    ensures p in t.parents
  {
    if t.id == id {
      ProofLib.FilterMember((y: int) => (y != other), t.parents, p);
    }
  }
  TProblemsOfSubset(s, s2, t, t2);
}

lemma TDeleteTaskTask(s: Tracker, id: int, j: int)
  requires 0 <= j < |deleteTask(s, id).tasks|
  ensures exists i :: 0 <= i < |s.tasks| && forall q :: q in problemsOf(deleteTask(s, id), deleteTask(s, id).tasks[j]) ==> q in problemsOf(s, s.tasks[i])
{
  var s2 := deleteTask(s, id);
  var kept := ProofLib.Filter((t: Task) => (t.id != id), s.tasks);
  assert |s2.tasks| == |kept|;
  assert forall k :: 0 <= k < |kept| ==> s2.tasks[k] == kept[k].(parents := drop(kept[k].parents, id), related := drop(kept[k].related, id));
  forall k | 0 <= k < |kept|
    ensures kept[k] in s.tasks && kept[k].id != id
  {
    ProofLib.FilterMember((t: Task) => (t.id != id), s.tasks, kept[k]);
  }
  var t := kept[j];
  var t2 := s2.tasks[j];
  // A task other than the deleted one exists after exactly when it existed before.
  forall p | p != id
    ensures hasTask(s2, p) == hasTask(s, p)
  {
    if hasTask(s, p) {
      var u :| u in s.tasks && u.id == p;
      ProofLib.FilterMember((t: Task) => (t.id != id), s.tasks, u);
      var k :| 0 <= k < |kept| && kept[k] == u;
      assert s2.tasks[k] in s2.tasks;
    }
    if hasTask(s2, p) {
      var u2 :| u2 in s2.tasks && u2.id == p;
      var k :| 0 <= k < |s2.tasks| && s2.tasks[k] == u2;
      assert kept[k] in s.tasks;
    }
  }
  forall u2 | u2 in s2.tasks
    ensures exists u :: u in s.tasks && u.id == u2.id && (forall p :: p in u2.parents ==> p in u.parents)
  {
    var k :| 0 <= k < |s2.tasks| && s2.tasks[k] == u2;
    var u := kept[k];
    forall p | p in u2.parents
      ensures p in u.parents
    {
      ProofLib.FilterMember((y: int) => (y != id), u.parents, p);
    }
  }
  assert |kept| <= |s.tasks| by {
    ProofLib.FilterSubset((t: Task) => (t.id != id), s.tasks);
  }
  TAncestorsShrink(s, s2);
  forall p | p in t2.parents
    ensures p in t.parents && p != id
  {
    ProofLib.FilterMember((y: int) => (y != id), t.parents, p);
  }
  forall r | r in t2.related
    ensures r in t.related && r != id
  {
    ProofLib.FilterMember((y: int) => (y != id), t.related, r);
  }
  forall r | r in t2.related && r != t.id && hasTask(s2, r) && !linksBack(s2, r, t.id)
    ensures !linksBack(s, r, t.id)
  {
    if linksBack(s, r, t.id) {
      var u :| u in s.tasks && u.id == r && t.id in u.related;
      ProofLib.FilterMember((t: Task) => (t.id != id), s.tasks, u);
      var k :| 0 <= k < |kept| && kept[k] == u;
      ProofLib.FilterMember((y: int) => (y != id), u.related, t.id);
      TLinksBackAt(s2, k, r, t.id);
    }
  }
  TProblemsOfSubset(s, s2, t, t2);
  var i :| 0 <= i < |s.tasks| && s.tasks[i] == t;
}

// ===== A fix adds no problem =====

// The problem a fix acts on is a problem of one of the tasks.
lemma TFixTarget(s: Tracker, index: int)
  requires canFix(s, index)
  ensures exists i :: 0 <= i < |s.tasks| && problemAt(s, index) in problemsOf(s, s.tasks[i])
{
  var p := problemAt(s, index);
  assert p == problems(s)[index];
  TProblemsMember(s, p);
}

// What a fix does to each task: it only takes owners, parents and related links away, except
// that it mirrors a one-sided link on the other task.
lemma TFixShape(s: Tracker, index: int, m: int)
  requires 0 <= m < |s.tasks|
  ensures |fix(s, index).tasks| == |s.tasks|
  ensures fix(s, index).tasks[m].id == s.tasks[m].id
  ensures forall o :: o in fix(s, index).tasks[m].owners ==> o in s.tasks[m].owners
  ensures forall x :: x in fix(s, index).tasks[m].parents ==> x in s.tasks[m].parents
  ensures forall r :: r in fix(s, index).tasks[m].related ==> r in s.tasks[m].related || (problemAt(s, index).code.OneSided? && s.tasks[m].id == problemAt(s, index).ref && r == problemAt(s, index).task)
  ensures forall r :: r in s.tasks[m].related ==> r in fix(s, index).tasks[m].related || (s.tasks[m].id == problemAt(s, index).task && (problemAt(s, index).code.UnknownRelated? || problemAt(s, index).code.SelfRelated?) && r == problemAt(s, index).ref && !(problemAt(s, index).code.OneSided? && s.tasks[m].id == problemAt(s, index).ref))
{
  var p := problemAt(s, index);
  var t := s.tasks[m];
  var t2 := fix(s, index).tasks[m];
  if p.code.OneSided? && t.id == p.ref {
  } else if t.id != p.task {
  } else if p.code.UnknownOwner? {
    forall o | o in t2.owners
      ensures o in t.owners
    {
      ProofLib.FilterMember((y: string) => (y != p.name), t.owners, o);
    }
  } else if p.code.UnknownParent? || p.code.SelfParent? {
    forall x | x in t2.parents
      ensures x in t.parents
    {
      ProofLib.FilterMember((y: int) => (y != p.ref), t.parents, x);
    }
  } else if p.code.UnknownRelated? || p.code.SelfRelated? {
    forall r | r in t2.related || r in t.related
      ensures (r in t2.related ==> r in t.related) && (r in t.related && r != p.ref ==> r in t2.related)
    {
      ProofLib.FilterMember((y: int) => (y != p.ref), t.related, r);
    }
  }
}

lemma TFixTask(s: Tracker, index: int, k: int)
  requires canFix(s, index) && 0 <= k < |s.tasks|
  ensures forall q :: q in problemsOf(fix(s, index), fix(s, index).tasks[k]) ==> q in problemsOf(s, s.tasks[k])
{
  var s2 := fix(s, index);
  var p := problemAt(s, index);
  TFixTarget(s, index);
  var i :| 0 <= i < |s.tasks| && p in problemsOf(s, s.tasks[i]);
  var P := s.tasks[i];
  TProblemsOfParts(s, P);
  TUnknownOwnerPart(s, P, p);
  TUnknownParentPart(s, P, p);
  TUnknownRelatedPart(s, P, p);
  TOneSidedPart(s, P, p);
  assert p.task == P.id;
  assert hasTask(s, p.task) by {
    assert P in s.tasks;
  }
  assert p.code.UnknownRelated? ==> !hasTask(s, p.ref);
  assert p.code.SelfRelated? ==> p.ref == p.task;
  assert p.code.OneSided? ==> p.ref in P.related && p.ref != P.id;
  forall m | 0 <= m < |s.tasks|
    ensures s2.tasks[m].id == s.tasks[m].id
    ensures forall o :: o in s2.tasks[m].owners ==> o in s.tasks[m].owners
    ensures forall x :: x in s2.tasks[m].parents ==> x in s.tasks[m].parents
    ensures forall r :: r in s2.tasks[m].related ==> r in s.tasks[m].related || (p.code.OneSided? && s.tasks[m].id == p.ref && r == p.task)
    ensures forall r :: r in s.tasks[m].related ==> r in s2.tasks[m].related || (s.tasks[m].id == p.task && (p.code.UnknownRelated? || p.code.SelfRelated?) && r == p.ref && !(p.code.OneSided? && s.tasks[m].id == p.ref))
  {
    TFixShape(s, index, m);
  }
  TFixShape(s, index, k);
  TSameIdsHasTask(s, s2);
  forall u2 | u2 in s2.tasks
    ensures exists u :: u in s.tasks && u.id == u2.id && (forall x :: x in u2.parents ==> x in u.parents)
  {
    var m :| 0 <= m < |s2.tasks| && s2.tasks[m] == u2;
    assert s.tasks[m] in s.tasks;
  }
  TAncestorsShrink(s, s2);
  var t := s.tasks[k];
  var t2 := s2.tasks[k];
  TFixOneSided(s, index, k);
  forall r | r in t2.related && r != t.id && !hasTask(s2, r)
    ensures r in t.related
  {
  }
  TProblemsOfSubset(s, s2, t, t2);
}

// After a fix, a related link that is one-sided was already there and already one-sided.
lemma TFixOneSided(s: Tracker, index: int, k: int)
  requires canFix(s, index) && 0 <= k < |s.tasks|
  ensures forall r :: r in fix(s, index).tasks[k].related && r != s.tasks[k].id && hasTask(fix(s, index), r) && !linksBack(fix(s, index), r, s.tasks[k].id) ==> r in s.tasks[k].related && hasTask(s, r) && !linksBack(s, r, s.tasks[k].id)
{
  var s2 := fix(s, index);
  var p := problemAt(s, index);
  TFixTarget(s, index);
  var i :| 0 <= i < |s.tasks| && p in problemsOf(s, s.tasks[i]);
  var P := s.tasks[i];
  TProblemsOfParts(s, P);
  TUnknownRelatedPart(s, P, p);
  TOneSidedPart(s, P, p);
  assert p.task == P.id;
  assert p.code.UnknownRelated? ==> !hasTask(s, p.ref);
  assert p.code.SelfRelated? ==> p.ref == p.task;
  assert p.code.OneSided? ==> p.ref in P.related && p.ref != P.id;
  forall m | 0 <= m < |s.tasks|
    ensures s2.tasks[m].id == s.tasks[m].id
    ensures forall r :: r in s2.tasks[m].related ==> r in s.tasks[m].related || (p.code.OneSided? && s.tasks[m].id == p.ref && r == p.task)
    ensures forall r :: r in s.tasks[m].related ==> r in s2.tasks[m].related || (s.tasks[m].id == p.task && (p.code.UnknownRelated? || p.code.SelfRelated?) && r == p.ref && !(p.code.OneSided? && s.tasks[m].id == p.ref))
  {
    TFixShape(s, index, m);
  }
  TSameIdsHasTask(s, s2);
  var t := s.tasks[k];
  var t2 := s2.tasks[k];
  // A task that linked back before still links back, unless the fix removed a link to a missing task or to itself.
  forall r | r in t2.related && r != t.id && hasTask(s2, r) && !linksBack(s2, r, t.id)
    ensures r in t.related && hasTask(s, r) && !linksBack(s, r, t.id)
  {
    if !(r in t.related) {
      // r is the mirrored link, and the task it names links back to this one
      assert p.code.OneSided? && t.id == p.ref && r == p.task;
      assert P.id != p.ref;
      assert s2.tasks[i].related == P.related || p.task in s2.tasks[i].related by {
        TFixShape(s, index, i);
      }
      TLinksBackAt(s2, i, p.task, p.ref);
    }
    if linksBack(s, r, t.id) {
      var u :| u in s.tasks && u.id == r && t.id in u.related;
      var m :| 0 <= m < |s.tasks| && s.tasks[m] == u;
      if t.id in s2.tasks[m].related {
        TLinksBackAt(s2, m, r, t.id);
      } else {
        assert u.id == p.task && t.id == p.ref;
        assert t in s.tasks;
      }
    }
  }
}

// ===== A fix shortens the warning list (F8) =====

// A predicate that passes less often keeps no more, and fewer if it fails somewhere the other passes.
lemma TFilterImpLen<T>(f: T -> bool, g: T -> bool, xs: seq<T>)
  requires forall i :: 0 <= i < |xs| && f(xs[i]) ==> g(xs[i])
  ensures |ProofLib.Filter(f, xs)| <= |ProofLib.Filter(g, xs)|
  ensures (exists i :: 0 <= i < |xs| && g(xs[i]) && !f(xs[i])) ==> |ProofLib.Filter(f, xs)| < |ProofLib.Filter(g, xs)|
  decreases |xs|
{
  if |xs| == 0 {
    ProofLib.FilterNil(f, xs);
    ProofLib.FilterNil(g, xs);
  } else {
    ProofLib.FilterCons(f, xs);
    ProofLib.FilterCons(g, xs);
    assert forall i :: 0 <= i < |xs[1..]| ==> xs[1..][i] == xs[i + 1];
    TFilterImpLen(f, g, xs[1..]);
    if exists i :: 0 <= i < |xs| && g(xs[i]) && !f(xs[i]) {
      var i :| 0 <= i < |xs| && g(xs[i]) && !f(xs[i]);
      if i > 0 {
        assert xs[1..][i - 1] == xs[i];
      }
    }
  }
}

// The same after first dropping some elements.
lemma TFilterKeepLen<T>(d: T -> bool, f: T -> bool, g: T -> bool, xs: seq<T>)
  requires forall i :: 0 <= i < |xs| && d(xs[i]) && f(xs[i]) ==> g(xs[i])
  ensures |ProofLib.Filter(f, ProofLib.Filter(d, xs))| <= |ProofLib.Filter(g, xs)|
  ensures (exists i :: 0 <= i < |xs| && g(xs[i]) && !(d(xs[i]) && f(xs[i]))) ==> |ProofLib.Filter(f, ProofLib.Filter(d, xs))| < |ProofLib.Filter(g, xs)|
  decreases |xs|
{
  if |xs| == 0 {
    ProofLib.FilterNil(d, xs);
    ProofLib.FilterNil(f, ProofLib.Filter(d, xs));
    ProofLib.FilterNil(g, xs);
  } else {
    var r := ProofLib.Filter(d, xs[1..]);
    ProofLib.FilterCons(d, xs);
    ProofLib.FilterCons(g, xs);
    assert forall i :: 0 <= i < |xs[1..]| ==> xs[1..][i] == xs[i + 1];
    TFilterKeepLen(d, f, g, xs[1..]);
    if d(xs[0]) {
      ProofLib.FilterCons(f, [xs[0]] + r);
      assert ([xs[0]] + r)[1..] == r;
    } else {
      assert ProofLib.Filter(d, xs) == r;
    }
    if exists i :: 0 <= i < |xs| && g(xs[i]) && !(d(xs[i]) && f(xs[i])) {
      var i :| 0 <= i < |xs| && g(xs[i]) && !(d(xs[i]) && f(xs[i]));
      if i > 0 {
        assert xs[1..][i - 1] == xs[i];
      }
    }
  }
}

// Two folds that append a piece per element: if no piece is longer, the result is no longer; if one is shorter, shorter.
lemma TFoldLenLe<A, T, U>(f: (seq<A>, T) -> seq<A>, g: (seq<A>, U) -> seq<A>, h: T -> seq<A>, h2: U -> seq<A>, a: seq<A>, a2: seq<A>, xs: seq<T>, ys: seq<U>)
  requires forall acc, x :: f(acc, x) == acc + h(x)
  requires forall acc, y :: g(acc, y) == acc + h2(y)
  requires |xs| == |ys|
  requires forall i :: 0 <= i < |xs| ==> |h2(ys[i])| <= |h(xs[i])|
  ensures |Std.Collections.Seq.FoldLeft(g, a2, ys)| - |a2| <= |Std.Collections.Seq.FoldLeft(f, a, xs)| - |a|
  ensures (exists i :: 0 <= i < |xs| && |h2(ys[i])| < |h(xs[i])|) ==> |Std.Collections.Seq.FoldLeft(g, a2, ys)| - |a2| < |Std.Collections.Seq.FoldLeft(f, a, xs)| - |a|
  decreases |xs|
{
  if |xs| > 0 {
    assert forall i :: 0 <= i < |xs[1..]| ==> xs[1..][i] == xs[i + 1] && ys[1..][i] == ys[i + 1];
    TFoldLenLe(f, g, h, h2, f(a, xs[0]), g(a2, ys[0]), xs[1..], ys[1..]);
    if exists i :: 0 <= i < |xs| && |h2(ys[i])| < |h(xs[i])| {
      var i :| 0 <= i < |xs| && |h2(ys[i])| < |h(xs[i])|;
      if i > 0 {
        assert xs[1..][i - 1] == xs[i] && ys[1..][i - 1] == ys[i];
      }
    }
  }
}

// What the problem a fix acts on says about the task it belongs to.
lemma TFixHome(s: Tracker, t: Task, pr: Problem)
  requires pr in problemsOf(s, t)
  ensures pr.task == t.id
  ensures pr.code.UnknownOwner? ==> pr.name in t.owners && !(pr.name in s.owners)
  ensures pr.code.UnknownParent? ==> pr.ref in t.parents && pr.ref != t.id && !hasTask(s, pr.ref)
  ensures pr.code.SelfParent? ==> pr.ref == t.id && t.id in t.parents
  ensures pr.code.UnknownRelated? ==> pr.ref in t.related && pr.ref != t.id && !hasTask(s, pr.ref)
  ensures pr.code.SelfRelated? ==> pr.ref == t.id && t.id in t.related
  ensures pr.code.OneSided? ==> pr.ref in t.related && pr.ref != t.id && hasTask(s, pr.ref) && !linksBack(s, pr.ref, t.id)
{
  TProblemsOfParts(s, t);
  TUnknownOwnerPart(s, t, pr);
  TUnknownParentPart(s, t, pr);
  TUnknownRelatedPart(s, t, pr);
  TOneSidedPart(s, t, pr);
}

// The problem a fix acts on belongs to a task that exists.
lemma TFixFacts(s: Tracker, index: int)
  requires canFix(s, index)
  ensures hasTask(s, problemAt(s, index).task)
  ensures problemAt(s, index).code.OneSided? ==> problemAt(s, index).ref != problemAt(s, index).task && hasTask(s, problemAt(s, index).ref)
{
  TFixTarget(s, index);
  var i :| 0 <= i < |s.tasks| && problemAt(s, index) in problemsOf(s, s.tasks[i]);
  TFixHome(s, s.tasks[i], problemAt(s, index));
  assert s.tasks[i] in s.tasks;
}

lemma TFixOwnersLen(s: Tracker, s2: Tracker, index: int, k: int)
  requires canFix(s, index) && s2 == fix(s, index) && 0 <= k < |s.tasks|
  ensures |ProofLib.Filter((o: string) => !((o in s2.owners)), s2.tasks[k].owners)| <= |ProofLib.Filter((o: string) => !((o in s.owners)), s.tasks[k].owners)|
  ensures problemAt(s, index) in problemsOf(s, s.tasks[k]) && problemAt(s, index).code.UnknownOwner? ==> |ProofLib.Filter((o: string) => !((o in s2.owners)), s2.tasks[k].owners)| < |ProofLib.Filter((o: string) => !((o in s.owners)), s.tasks[k].owners)|
{
  var pr := problemAt(s, index);
  var t := s.tasks[k];
  var t2 := s2.tasks[k];
  if !(pr.code.OneSided? && t.id == pr.ref) && t.id == pr.task && pr.code.UnknownOwner? {
    assert t2.owners == ProofLib.Filter((y: string) => (y != pr.name), t.owners);
    TFilterKeepLen((y: string) => (y != pr.name), (o: string) => !((o in s2.owners)), (o: string) => !((o in s.owners)), t.owners);
    if pr in problemsOf(s, t) {
      TFixHome(s, t, pr);
      var w :| 0 <= w < |t.owners| && t.owners[w] == pr.name;
    }
  } else {
    assert t2.owners == t.owners;
    TFilterImpLen((o: string) => !((o in s2.owners)), (o: string) => !((o in s.owners)), t.owners);
  }
}

lemma TFixParentsLen(s: Tracker, s2: Tracker, index: int, k: int)
  requires canFix(s, index) && s2 == fix(s, index) && 0 <= k < |s.tasks|
  ensures |ProofLib.Filter((p: int) => ((p != s2.tasks[k].id) && !(hasTask(s2, p))), s2.tasks[k].parents)| + (if s2.tasks[k].id in s2.tasks[k].parents then 1 else 0) <= |ProofLib.Filter((p: int) => ((p != s.tasks[k].id) && !(hasTask(s, p))), s.tasks[k].parents)| + (if s.tasks[k].id in s.tasks[k].parents then 1 else 0)
  ensures problemAt(s, index) in problemsOf(s, s.tasks[k]) && (problemAt(s, index).code.UnknownParent? || problemAt(s, index).code.SelfParent?) ==> |ProofLib.Filter((p: int) => ((p != s2.tasks[k].id) && !(hasTask(s2, p))), s2.tasks[k].parents)| + (if s2.tasks[k].id in s2.tasks[k].parents then 1 else 0) < |ProofLib.Filter((p: int) => ((p != s.tasks[k].id) && !(hasTask(s, p))), s.tasks[k].parents)| + (if s.tasks[k].id in s.tasks[k].parents then 1 else 0)
{
  var pr := problemAt(s, index);
  var t := s.tasks[k];
  var t2 := s2.tasks[k];
  TFixShape(s, index, k);
  TSameIdsHasTask(s, s2);
  if !(pr.code.OneSided? && t.id == pr.ref) && t.id == pr.task && (pr.code.UnknownParent? || pr.code.SelfParent?) {
    assert t2.parents == ProofLib.Filter((y: int) => (y != pr.ref), t.parents);
    TFilterKeepLen((y: int) => (y != pr.ref), (p: int) => ((p != t2.id) && !(hasTask(s2, p))), (p: int) => ((p != t.id) && !(hasTask(s, p))), t.parents);
    if pr in problemsOf(s, t) {
      TFixHome(s, t, pr);
      if pr.code.UnknownParent? {
        var w :| 0 <= w < |t.parents| && t.parents[w] == pr.ref;
      } else {
        ProofLib.FilterMember((y: int) => (y != pr.ref), t.parents, t.id);
      }
    }
  } else {
    assert t2.parents == t.parents;
    TFilterImpLen((p: int) => ((p != t2.id) && !(hasTask(s2, p))), (p: int) => ((p != t.id) && !(hasTask(s, p))), t.parents);
  }
}

lemma TFixRelatedLen(s: Tracker, s2: Tracker, index: int, k: int)
  requires canFix(s, index) && s2 == fix(s, index) && 0 <= k < |s.tasks|
  ensures |ProofLib.Filter((r: int) => ((r != s2.tasks[k].id) && !(hasTask(s2, r))), s2.tasks[k].related)| + (if s2.tasks[k].id in s2.tasks[k].related then 1 else 0) + |ProofLib.Filter((r: int) => (((r != s2.tasks[k].id) && hasTask(s2, r)) && !(linksBack(s2, r, s2.tasks[k].id))), s2.tasks[k].related)| <= |ProofLib.Filter((r: int) => ((r != s.tasks[k].id) && !(hasTask(s, r))), s.tasks[k].related)| + (if s.tasks[k].id in s.tasks[k].related then 1 else 0) + |ProofLib.Filter((r: int) => (((r != s.tasks[k].id) && hasTask(s, r)) && !(linksBack(s, r, s.tasks[k].id))), s.tasks[k].related)|
  ensures problemAt(s, index) in problemsOf(s, s.tasks[k]) && (problemAt(s, index).code.UnknownRelated? || problemAt(s, index).code.SelfRelated? || problemAt(s, index).code.OneSided?) ==> |ProofLib.Filter((r: int) => ((r != s2.tasks[k].id) && !(hasTask(s2, r))), s2.tasks[k].related)| + (if s2.tasks[k].id in s2.tasks[k].related then 1 else 0) + |ProofLib.Filter((r: int) => (((r != s2.tasks[k].id) && hasTask(s2, r)) && !(linksBack(s2, r, s2.tasks[k].id))), s2.tasks[k].related)| < |ProofLib.Filter((r: int) => ((r != s.tasks[k].id) && !(hasTask(s, r))), s.tasks[k].related)| + (if s.tasks[k].id in s.tasks[k].related then 1 else 0) + |ProofLib.Filter((r: int) => (((r != s.tasks[k].id) && hasTask(s, r)) && !(linksBack(s, r, s.tasks[k].id))), s.tasks[k].related)|
{
  var pr := problemAt(s, index);
  var t := s.tasks[k];
  var t2 := s2.tasks[k];
  TFixShape(s, index, k);
  TFixFacts(s, index);
  TSameIdsHasTask(s, s2);
  TFixOneSided(s, index, k);
  if pr.code.OneSided? && t.id == pr.ref {
    if !(pr.task in t.related) {
      assert t2.related == t.related + [pr.task];
      ProofLib.FilterAppend((r: int) => ((r != t2.id) && !(hasTask(s2, r))), t.related, pr.task);
      ProofLib.FilterAppend((r: int) => (((r != t2.id) && hasTask(s2, r)) && !(linksBack(s2, r, t2.id))), t.related, pr.task);
    } else {
      assert t2.related == t.related;
    }
    TFilterImpLen((r: int) => ((r != t2.id) && !(hasTask(s2, r))), (r: int) => ((r != t.id) && !(hasTask(s, r))), t.related);
    TFilterImpLen((r: int) => (((r != t2.id) && hasTask(s2, r)) && !(linksBack(s2, r, t2.id))), (r: int) => (((r != t.id) && hasTask(s, r)) && !(linksBack(s, r, t.id))), t.related);
  } else if t.id == pr.task && (pr.code.UnknownRelated? || pr.code.SelfRelated?) {
    assert t2.related == ProofLib.Filter((y: int) => (y != pr.ref), t.related);
    forall r | r in t.related && r != pr.ref
      ensures r in t2.related
    {
      ProofLib.FilterMember((y: int) => (y != pr.ref), t.related, r);
    }
    TFilterKeepLen((y: int) => (y != pr.ref), (r: int) => ((r != t2.id) && !(hasTask(s2, r))), (r: int) => ((r != t.id) && !(hasTask(s, r))), t.related);
    TFilterKeepLen((y: int) => (y != pr.ref), (r: int) => (((r != t2.id) && hasTask(s2, r)) && !(linksBack(s2, r, t2.id))), (r: int) => (((r != t.id) && hasTask(s, r)) && !(linksBack(s, r, t.id))), t.related);
    if pr in problemsOf(s, t) {
      TFixHome(s, t, pr);
      if pr.code.UnknownRelated? {
        var w :| 0 <= w < |t.related| && t.related[w] == pr.ref;
      } else {
        ProofLib.FilterMember((y: int) => (y != pr.ref), t.related, t.id);
      }
    }
  } else {
    assert t2.related == t.related;
    TFilterImpLen((r: int) => ((r != t2.id) && !(hasTask(s2, r))), (r: int) => ((r != t.id) && !(hasTask(s, r))), t.related);
    TFilterImpLen((r: int) => (((r != t2.id) && hasTask(s2, r)) && !(linksBack(s2, r, t2.id))), (r: int) => (((r != t.id) && hasTask(s, r)) && !(linksBack(s, r, t.id))), t.related);
    if pr in problemsOf(s, t) && pr.code.OneSided? {
      TFixHome(s, t, pr);
      // the other task now links back
      var u :| u in s.tasks && u.id == pr.ref;
      var m :| 0 <= m < |s.tasks| && s.tasks[m] == u;
      TFixShape(s, index, m);
      assert pr.task in s2.tasks[m].related;
      TLinksBackAt(s2, m, pr.ref, t.id);
      var w :| 0 <= w < |t.related| && t.related[w] == pr.ref;
    }
  }
}

lemma TFixCycleLen(s: Tracker, s2: Tracker, index: int, k: int)
  requires canFix(s, index) && s2 == fix(s, index) && 0 <= k < |s.tasks|
  ensures s2.tasks[k].id in ancestors(s2, s2.tasks[k].id) ==> s.tasks[k].id in ancestors(s, s.tasks[k].id)
{
  forall m | 0 <= m < |s.tasks|
    ensures s2.tasks[m].id == s.tasks[m].id
    ensures forall x :: x in s2.tasks[m].parents ==> x in s.tasks[m].parents
  {
    TFixShape(s, index, m);
  }
  forall u2 | u2 in s2.tasks
    ensures exists u :: u in s.tasks && u.id == u2.id && (forall x :: x in u2.parents ==> x in u.parents)
  {
    var m :| 0 <= m < |s2.tasks| && s2.tasks[m] == u2;
    assert s.tasks[m] in s.tasks;
  }
  TAncestorsShrink(s, s2);
}

// A fix leaves each task with no more problems, and the task it fixes with fewer.
lemma TFixCountTask(s: Tracker, s2: Tracker, index: int, k: int)
  requires canFix(s, index) && s2 == fix(s, index) && 0 <= k < |s.tasks|
  ensures |problemsOf(s2, s2.tasks[k])| <= |problemsOf(s, s.tasks[k])|
  ensures problemAt(s, index) in problemsOf(s, s.tasks[k]) ==> |problemsOf(s2, s2.tasks[k])| < |problemsOf(s, s.tasks[k])|
{
  var t := s.tasks[k];
  var t2 := s2.tasks[k];
  TFixShape(s, index, k);
  TProblemsOfParts(s, t);
  TProblemsOfParts(s2, t2);
  TFixOwnersLen(s, s2, index, k);
  TFixParentsLen(s, s2, index, k);
  TFixRelatedLen(s, s2, index, k);
  TFixCycleLen(s, s2, index, k);
}

lemma TFixShortens(s: Tracker, index: int)
  requires canFix(s, index)
  ensures |problems(fix(s, index))| < |problems(s)|
{
  var s2 := fix(s, index);
  TFixTarget(s, index);
  var i :| 0 <= i < |s.tasks| && problemAt(s, index) in problemsOf(s, s.tasks[i]);
  forall k | 0 <= k < |s.tasks|
    ensures |problemsOf(s2, s2.tasks[k])| <= |problemsOf(s, s.tasks[k])|
    ensures problemAt(s, index) in problemsOf(s, s.tasks[k]) ==> |problemsOf(s2, s2.tasks[k])| < |problemsOf(s, s.tasks[k])|
  {
    TFixCountTask(s, s2, index, k);
  }
  TFoldLenLe((acc: seq<Problem>, t: Task) => (acc + problemsOf(s, t)), (acc: seq<Problem>, t: Task) => (acc + problemsOf(s2, t)), (t: Task) => problemsOf(s, t), (t: Task) => problemsOf(s2, t), [], [], s.tasks, s2.tasks);
}


// ===== The ancestor search finds everything there is to find (F7) =====
// A list c is closed when it holds every parent (other than itself) of each task it names.

// A subset is no larger. (General: belongs in tools/proof/lib.dfy.)
lemma TSubsetCard(a: set<int>, b: set<int>)
  requires a <= b
  ensures |a| <= |b|
  decreases |a|
{
  if a != {} {
    var x :| x in a;
    TSubsetCard(a - {x}, b - {x});
  }
}

// No more distinct task numbers than tasks.
lemma TIdCountBound(xs: seq<Task>, a: seq<int>)
  ensures |(set u | u in xs && u.id in a :: u.id)| <= |xs|
  decreases |xs|
{
  if |xs| > 0 {
    TIdCountBound(xs[1..], a);
    var r := (set u | u in xs[1..] && u.id in a :: u.id);
    var w := (set u | u in xs && u.id in a :: u.id);
    assert w <= r + {xs[0].id} by {
      forall v | v in w
        ensures v in r + {xs[0].id}
      {
        var u :| u in xs && u.id in a && u.id == v;
        var k :| 0 <= k < |xs| && xs[k] == u;
        if k > 0 {
          assert xs[1..][k - 1] == u;
        }
      }
    }
    TSubsetCard(w, r + {xs[0].id});
  }
}

// Starting inside a closed list, the ancestor search stays inside it.
lemma TAncFoldWithin(s: Tracker, a: seq<int>, xs: seq<Task>, c: seq<int>)
  requires forall y :: y in a ==> y in c
  requires (forall u, p :: u in s.tasks && u.id in c && p in u.parents && p != u.id ==> p in c)
  ensures forall y :: y in Std.Collections.Seq.FoldLeft((acc: seq<int>, t: Task) => (acc + Std.Collections.Seq.Filter((p: int) => !((p in acc)), parentsOfAll(s, acc))), a, xs) ==> y in c
  decreases |xs|
{
  if |xs| > 0 {
    var b := ((acc: seq<int>, t: Task) => (acc + Std.Collections.Seq.Filter((p: int) => !((p in acc)), parentsOfAll(s, acc))))(a, xs[0]);
    forall y | y in b
      ensures y in c
    {
      TAncRoundMember(s, a, xs[0], y);
      TParentsOfAllMember(s, a, y);
    }
    TAncFoldWithin(s, b, xs[1..], c);
  }
}

// The ancestors of a task lie in any closed list that holds the task's own parents.
lemma TAncWithin(s: Tracker, y: int, c: seq<int>)
  requires (forall u, p :: u in s.tasks && u.id in c && p in u.parents && p != u.id ==> p in c)
  requires forall u, p :: u in s.tasks && u.id == y && p in u.parents && p != u.id ==> p in c
  ensures forall x :: x in ancestors(s, y) ==> x in c
{
  forall x | x in parentsOfAll(s, [y])
    ensures x in c
  {
    TParentsOfAllMember(s, [y], x);
  }
  TAncFoldWithin(s, parentsOfAll(s, [y]), s.tasks, c);
}

// A round that leaves the list open added a task number, and started from an open list.
lemma TAncRoundGrows(s: Tracker, a: seq<int>, t: Task)
  requires !(forall u, p :: u in s.tasks && u.id in ((acc: seq<int>, t: Task) => (acc + Std.Collections.Seq.Filter((p: int) => !((p in acc)), parentsOfAll(s, acc))))(a, t) && p in u.parents && p != u.id ==> p in ((acc: seq<int>, t: Task) => (acc + Std.Collections.Seq.Filter((p: int) => !((p in acc)), parentsOfAll(s, acc))))(a, t))
  ensures !(forall u, p :: u in s.tasks && u.id in a && p in u.parents && p != u.id ==> p in a)
  ensures |(set u | u in s.tasks && u.id in a :: u.id)| < |(set u | u in s.tasks && u.id in ((acc: seq<int>, t: Task) => (acc + Std.Collections.Seq.Filter((p: int) => !((p in acc)), parentsOfAll(s, acc))))(a, t) :: u.id)|
{
  var b := ((acc: seq<int>, t: Task) => (acc + Std.Collections.Seq.Filter((p: int) => !((p in acc)), parentsOfAll(s, acc))))(a, t);
  var u, p :| u in s.tasks && u.id in b && p in u.parents && p != u.id && !(p in b);
  TAncRoundMember(s, a, t, p);
  TAncRoundMember(s, a, t, u.id);
  if u.id in a {
    TParentsOfAllMember(s, a, p);
    assert false;
  }
  if u.id in parentsOfAll(s, a) {
    TParentsOfAllMember(s, a, u.id);
  }
  var sa := (set v | v in s.tasks && v.id in a :: v.id);
  var sb := (set v | v in s.tasks && v.id in b :: v.id);
  forall x | x in sa
    ensures x in sb
  {
    var v :| v in s.tasks && v.id in a && v.id == x;
    TAncRoundMember(s, a, t, x);
  }
  assert u.id in sb;
  assert !(u.id in sa);
  TSubsetCard(sa + {u.id}, sb);
}

// Either the search ends closed, or every round added a task number to an open start.
lemma TAncConverge(s: Tracker, a: seq<int>, xs: seq<Task>)
  ensures (forall u, p :: u in s.tasks && u.id in Std.Collections.Seq.FoldLeft((acc: seq<int>, t: Task) => (acc + Std.Collections.Seq.Filter((p: int) => !((p in acc)), parentsOfAll(s, acc))), a, xs) && p in u.parents && p != u.id ==> p in Std.Collections.Seq.FoldLeft((acc: seq<int>, t: Task) => (acc + Std.Collections.Seq.Filter((p: int) => !((p in acc)), parentsOfAll(s, acc))), a, xs)) || (!(forall u, p :: u in s.tasks && u.id in a && p in u.parents && p != u.id ==> p in a) && |(set u | u in s.tasks && u.id in Std.Collections.Seq.FoldLeft((acc: seq<int>, t: Task) => (acc + Std.Collections.Seq.Filter((p: int) => !((p in acc)), parentsOfAll(s, acc))), a, xs) :: u.id)| >= |(set u | u in s.tasks && u.id in a :: u.id)| + |xs|)
  decreases |xs|
{
  if |xs| > 0 {
    var b := ((acc: seq<int>, t: Task) => (acc + Std.Collections.Seq.Filter((p: int) => !((p in acc)), parentsOfAll(s, acc))))(a, xs[0]);
    TAncConverge(s, b, xs[1..]);
    assert Std.Collections.Seq.FoldLeft((acc: seq<int>, t: Task) => (acc + Std.Collections.Seq.Filter((p: int) => !((p in acc)), parentsOfAll(s, acc))), a, xs) == Std.Collections.Seq.FoldLeft((acc: seq<int>, t: Task) => (acc + Std.Collections.Seq.Filter((p: int) => !((p in acc)), parentsOfAll(s, acc))), b, xs[1..]);
    if !(forall u, p :: u in s.tasks && u.id in Std.Collections.Seq.FoldLeft((acc: seq<int>, t: Task) => (acc + Std.Collections.Seq.Filter((p: int) => !((p in acc)), parentsOfAll(s, acc))), b, xs[1..]) && p in u.parents && p != u.id ==> p in Std.Collections.Seq.FoldLeft((acc: seq<int>, t: Task) => (acc + Std.Collections.Seq.Filter((p: int) => !((p in acc)), parentsOfAll(s, acc))), b, xs[1..])) {
      TAncRoundGrows(s, a, xs[0]);
    }
  }
}

// An open list names at least one task.
lemma TAncOpenCount(s: Tracker, a: seq<int>)
  requires !(forall u, p :: u in s.tasks && u.id in a && p in u.parents && p != u.id ==> p in a)
  ensures |(set u | u in s.tasks && u.id in a :: u.id)| >= 1
{
  var u, p :| u in s.tasks && u.id in a && p in u.parents && p != u.id && !(p in a);
  TSubsetCard({u.id}, (set v | v in s.tasks && v.id in a :: v.id));
}

// After one round per task, the ancestors are closed: one more round finds nothing new.
lemma TAncestorsClosed(s: Tracker, y: int)
  ensures (forall u, p :: u in s.tasks && u.id in ancestors(s, y) && p in u.parents && p != u.id ==> p in ancestors(s, y))
{
  var a := parentsOfAll(s, [y]);
  assert ancestors(s, y) == Std.Collections.Seq.FoldLeft((acc: seq<int>, t: Task) => (acc + Std.Collections.Seq.Filter((p: int) => !((p in acc)), parentsOfAll(s, acc))), a, s.tasks);
  TAncConverge(s, a, s.tasks);
  if !(forall u, p :: u in s.tasks && u.id in ancestors(s, y) && p in u.parents && p != u.id ==> p in ancestors(s, y)) {
    TAncOpenCount(s, a);
    TIdCountBound(s.tasks, ancestors(s, y));
    assert false;
  }
}

// ===== create adds no problem =====

// Each old task keeps its problems or loses some; the new task has none.
lemma TCreateTask(s: Tracker, actor: string, j: int)
  requires inv(s)
  requires 0 <= j < |create(s, actor).tasks|
  ensures forall q :: q in problemsOf(create(s, actor), create(s, actor).tasks[j]) ==> exists i :: 0 <= i < |s.tasks| && q in problemsOf(s, s.tasks[i])
{
  var s2 := create(s, actor);
  var n := s2.tasks[|s.tasks|];
  assert s2.tasks == s.tasks + [n];
  kernel_lawNextIsAboveTheCounter_ensures(numbersInUse(s), s.lastId);
  kernel_lawNextIsAboveEverythingSeen_ensures(numbersInUse(s), s.lastId);
  assert n.id > s.lastId;
  assert forall u :: u in s.tasks ==> u.id <= s.lastId;
  assert forall x :: x in numbersInUse(s) ==> n.id > x;
  assert forall u :: u in s2.tasks ==> u in s.tasks || u == n;
  // The ancestors of every number are found among the same ones as before.
  forall y, x | x in ancestors(s2, y)
    ensures x in ancestors(s, y)
  {
    TAncestorsClosed(s, y);
    forall u, p | u in s2.tasks && u.id == y && p in u.parents && p != u.id
      ensures p in ancestors(s, y)
    {
      assert u in s.tasks;
      TParentsOfAllMember(s, [y], p);
      TAncInflate(s, parentsOfAll(s, [y]), s.tasks, p);
    }
    TAncWithin(s2, y, ancestors(s, y));
  }
  if j < |s.tasks| {
    var t := s.tasks[j];
    assert s2.tasks[j] == t;
    forall r | r in t.related
      ensures r != n.id
    {
      TFoldConcatMember((acc: seq<int>, t: Task) => (((acc + [t.id]) + t.parents) + t.related), (t: Task) => (([t.id] + t.parents) + t.related), [], s.tasks, r);
    }
    forall r | hasTask(s, r)
      ensures hasTask(s2, r)
    {
      var u :| u in s.tasks && u.id == r;
      assert u in s2.tasks;
    }
    forall r | r != n.id && hasTask(s2, r)
      ensures hasTask(s, r)
    {
      var u :| u in s2.tasks && u.id == r;
    }
    forall r, x | linksBack(s, r, x)
      ensures linksBack(s2, r, x)
    {
      var u :| u in s.tasks && u.id == r && x in u.related;
      assert u in s2.tasks;
    }
    TProblemsOfSubset(s, s2, t, t);
    forall q | q in problemsOf(s2, s2.tasks[j])
      ensures exists i :: 0 <= i < |s.tasks| && q in problemsOf(s, s.tasks[i])
    {
      assert q in problemsOf(s, s.tasks[j]);
    }
  } else {
    assert s2.tasks[j] == n;
    forall x | x in ancestors(s2, n.id)
      ensures false
    {
      TAncWithin(s2, n.id, []);
    }
    TProblemsOfParts(s2, n);
    ProofLib.FilterNil((o: string) => !((o in s2.owners)), n.owners);
    ProofLib.FilterNil((p: int) => ((p != n.id) && !(hasTask(s2, p))), n.parents);
    ProofLib.FilterNil((r: int) => ((r != n.id) && !(hasTask(s2, r))), n.related);
    ProofLib.FilterNil((r: int) => (((r != n.id) && hasTask(s2, r)) && !(linksBack(s2, r, n.id))), n.related);
    assert problemsOf(s2, n) == [];
  }
}

// ===== addParent adds no problem =====

// A loop after adding id -> other would run from other back to id before: the guard rules it out.
lemma TAddParentAncestors(s: Tracker, id: int, other: int, actor: string, y: int)
  requires canAddParent(s, id, other, actor)
  ensures y in ancestors(addParent(s, id, other, actor), y) ==> y in ancestors(s, y)
{
  var s2 := addParent(s, id, other, actor);
  forall u2 | u2 in s2.tasks
    ensures exists u :: u in s.tasks && u.id == u2.id && (forall p :: p in u2.parents ==> p in u.parents || (u.id == id && p == other))
  {
    var k :| 0 <= k < |s2.tasks| && s2.tasks[k] == u2;
    var u := s.tasks[k];
    assert u in s.tasks;
  }
  var c := ancestors(s, y);
  var d := ancestors(s, other);
  TAncestorsClosed(s, y);
  TAncestorsClosed(s, other);
  forall u, p | u in s.tasks && u.id == y && p in u.parents && p != u.id
    ensures p in c
  {
    TParentsOfAllMember(s, [y], p);
    TAncInflate(s, parentsOfAll(s, [y]), s.tasks, p);
  }
  forall u, p | u in s.tasks && u.id == other && p in u.parents && p != u.id
    ensures p in d
  {
    TParentsOfAllMember(s, [other], p);
    TAncInflate(s, parentsOfAll(s, [other]), s.tasks, p);
  }
  assert !(id in d);
  if !(id in c) && y != id {
    forall u2, p | u2 in s2.tasks && u2.id in c && p in u2.parents && p != u2.id
      ensures p in c
    {
      var u :| u in s.tasks && u.id == u2.id && (forall p :: p in u2.parents ==> p in u.parents || (u.id == id && p == other));
    }
    forall u2, p | u2 in s2.tasks && u2.id == y && p in u2.parents && p != u2.id
      ensures p in c
    {
      var u :| u in s.tasks && u.id == u2.id && (forall p :: p in u2.parents ==> p in u.parents || (u.id == id && p == other));
    }
    TAncWithin(s2, y, c);
  } else {
    var e := c + [other] + d;
    forall u2, p | u2 in s2.tasks && u2.id in e && p in u2.parents && p != u2.id
      ensures p in e
    {
      var u :| u in s.tasks && u.id == u2.id && (forall p :: p in u2.parents ==> p in u.parents || (u.id == id && p == other));
    }
    forall u2, p | u2 in s2.tasks && u2.id == y && p in u2.parents && p != u2.id
      ensures p in e
    {
      var u :| u in s.tasks && u.id == u2.id && (forall p :: p in u2.parents ==> p in u.parents || (u.id == id && p == other));
    }
    TAncWithin(s2, y, e);
    if y in ancestors(s2, y) && !(y in c) {
      assert y == other || y in d;
      if y == id {
        assert false;
      } else {
        assert id in c;
        if y in d {
          forall u, p | u in s.tasks && u.id == y && p in u.parents && p != u.id
            ensures p in d
          {
          }
          TAncWithin(s, y, d);
        }
        assert false;
      }
    }
  }
}

// Each task keeps its problems or loses some.
lemma TAddParentTask(s: Tracker, id: int, other: int, actor: string, i: int)
  requires canAddParent(s, id, other, actor)
  requires 0 <= i < |s.tasks|
  ensures forall q :: q in problemsOf(addParent(s, id, other, actor), addParent(s, id, other, actor).tasks[i]) ==> q in problemsOf(s, s.tasks[i])
{
  var s2 := addParent(s, id, other, actor);
  var t := s.tasks[i];
  var t2 := s2.tasks[i];
  TSameIdsHasTask(s, s2);
  TSameLinksHasTask(s, s2);
  TAddParentAncestors(s, id, other, actor, t.id);
  TProblemsOfSubset(s, s2, t, t2);
}
