# Review and change saved profile facts

[Story F5](product/stories.md#story-f5--review-and-correct-my-profile) extends
the [saved profile read](savedProfileRead.md). This model receives scoped
authority and comparison facts. The service owns fact text, source labels,
references, confirmation codes, and the stored fingerprint.

## Story: Review my facts and approve a specific change

> As a member, I want to see which facts the app saved about me and confirm any change before the app applies it.

### Only a direct request from the current app member can show their saved facts

In a signed direct turn, resolve the sender to the current eligible
membership in the exact routed app. Show that member's saved facts
grouped by kind, with source and privacy scope. Keep the read apart from
onboarding and matching. It does not create a draft or change any fact.

```quint
pure def profileFactEditMayRead(direct: bool, ownerCurrent: bool, sameApp: bool): bool =
  direct and ownerCurrent and sameApp

pure def lawProfileFactReadRequiresCurrentOwner(direct: bool, sameApp: bool): bool =
  not(profileFactEditMayRead(direct, false, sameApp))
```

### The policy for the current fact decides which edits the owner can propose

Allow correction of member-editable wording, removal of an editable fact,
or change to a supported scope. A scope change must change the scope.
The offered scopes are agent private, matchable and shareable. Only
agent private can replace opportunity-specific scope. A sensitive
inference can only narrow its scope. Policy-owned fields, including
server-authored ratings, stay under their owning policy.

```quint
type ProfileFactEditOperation = CorrectFact | RemoveFact | ChangeFactScope
pure val operationValues = Set(CorrectFact, RemoveFact, ChangeFactScope)
pure val currentScopeValues = Set("agent_private", "matchable", "shareable", "opportunity_specific", "")
pure val proposedScopeValues = Set("agent_private", "matchable", "shareable", "opportunity_specific", "")

pure def profileFactScopeRank(scope: str): int =
  if (scope == "agent_private") 1
  else if (scope == "matchable") 2
  else if (scope == "shareable") 3
  else 0

pure def profileFactEditScopeSupported(scope: str): bool = profileFactScopeRank(scope) > 0

pure def profileFactEditNarrower(currentScope: str, proposedScope: str): bool =
  (currentScope == "opportunity_specific" and proposedScope == "agent_private") or
    (profileFactEditScopeSupported(proposedScope) and
      profileFactScopeRank(proposedScope) < profileFactScopeRank(currentScope))

pure def profileFactEditOperationAllowed(operation: ProfileFactEditOperation, policyOwned: bool,
  sensitiveInferred: bool, currentScope: str, proposedScope: str): bool =
  not(policyOwned) and (profileFactEditScopeSupported(currentScope) or currentScope == "opportunity_specific") and
  (if (operation != ChangeFactScope) true
    else if (sensitiveInferred or currentScope == "opportunity_specific")
      profileFactEditNarrower(currentScope, proposedScope)
    else profileFactEditScopeSupported(proposedScope) and currentScope != proposedScope)

pure def lawProfileFactEditPreservesPolicy(operation: ProfileFactEditOperation, sensitiveInferred: bool,
  currentScope: str, proposedScope: str): bool =
  not(profileFactEditOperationAllowed(operation, true, sensitiveInferred, currentScope, proposedScope))

pure def lawSensitiveProfileFactScopeOnlyNarrows(currentScope: str, proposedScope: str): bool =
  profileFactEditOperationAllowed(ChangeFactScope, false, true, currentScope, proposedScope)
    implies profileFactEditNarrower(currentScope, proposedScope)
```

### An explicit command stages one exact draft without writing the fact

Require a signed direct owner turn, the exact saved fact, permitted
operation and valid input. Stage the original fact fingerprint and read
back what the owner asks to change. An authenticated owner and app have
one current draft. A valid new draft replaces the previous one. A draft
stays current for fifteen minutes from staging.

```quint
type ProfileFactEditPhase = NoProfileFactDraft | AwaitingProfileFactConfirmation | AppliedProfileFactEdit | ClosedProfileFactDraft
type ProfileFactEdit = {
  phase: ProfileFactEditPhase,
  operation: ProfileFactEditOperation,
  stagedAt: int
}
type ProfileFactEditStageFacts = {
  direct: bool, ownerCurrent: bool, exactFact: bool, operationAllowed: bool, validInput: bool
}
pure val initial: ProfileFactEdit = {
  phase: NoProfileFactDraft, operation: CorrectFact, stagedAt: 0
}
pure val profileFactEditTtlMs: int = 900000
pure val stagedAtValues = Set(-1, 0, 1, 10)
pure val nowValues = Set(-1, 0, 1, 10, 899999, 900000, 900010)
pure val validStage: ProfileFactEditStageFacts = {
  direct: true, ownerCurrent: true, exactFact: true, operationAllowed: true, validInput: true
}
pure val stageFactsValues = Set(validStage,
  { ...validStage, direct: false },
  { ...validStage, ownerCurrent: false },
  { ...validStage, exactFact: false },
  { ...validStage, operationAllowed: false },
  { ...validStage, validInput: false })

pure def profileFactEditDraftCurrent(stagedAt: int, now: int): bool =
  stagedAt >= 0 and now >= stagedAt and now - stagedAt < profileFactEditTtlMs

pure def profileFactEditMayStage(stageFacts: ProfileFactEditStageFacts): bool =
  stageFacts.direct and stageFacts.ownerCurrent and stageFacts.exactFact
    and stageFacts.operationAllowed and stageFacts.validInput

pure def canStageProfileFact(draft: ProfileFactEdit, stageFacts: ProfileFactEditStageFacts,
  operation: ProfileFactEditOperation, stagedAt: int): bool =
  stagedAt >= 0 and profileFactEditMayStage(stageFacts)

pure def stageProfileFact(draft: ProfileFactEdit, stageFacts: ProfileFactEditStageFacts,
  operation: ProfileFactEditOperation, stagedAt: int): ProfileFactEdit =
  if (canStageProfileFact(draft, stageFacts, operation, stagedAt))
    { phase: AwaitingProfileFactConfirmation, operation: operation, stagedAt: stagedAt }
  else draft

pure def sometimesProfileFactDraftStaged(draft: ProfileFactEdit): bool = draft.phase == AwaitingProfileFactConfirmation
```

### Confirmation must match the current draft and the unchanged saved fact

Only the owner can confirm, in a signed direct turn that names this
exact current draft. Check the original fact's revision or fingerprint
and the live policy again under the same transaction as the write.
Remove old derived data when applying a correction, removal, or scope
change. A correction or removal disables replay of the old connected
source evidence. A scope change keeps its source link and replay policy.
Commit the changed fact, cleanup and confirmation receipt together. A
stale, mismatched or expired draft cannot apply.

```quint
type ProfileFactEditApplyFacts = {
  direct: bool, ownerCurrent: bool, exactDraft: bool, exactFact: bool, unchanged: bool,
  operationAllowed: bool, stagedAt: int, now: int
}
pure val validApply: ProfileFactEditApplyFacts = {
  direct: true, ownerCurrent: true, exactDraft: true, exactFact: true, unchanged: true,
  operationAllowed: true, stagedAt: 0, now: 1
}
pure val applyFactsValues = Set(validApply,
  { ...validApply, direct: false },
  { ...validApply, ownerCurrent: false },
  { ...validApply, exactDraft: false },
  { ...validApply, exactFact: false },
  { ...validApply, unchanged: false },
  { ...validApply, operationAllowed: false },
  { ...validApply, now: 900000 })

pure def profileFactEditMayApply(applyFacts: ProfileFactEditApplyFacts): bool =
  applyFacts.direct and applyFacts.ownerCurrent and applyFacts.exactDraft and
    applyFacts.exactFact and applyFacts.unchanged and applyFacts.operationAllowed and
    profileFactEditDraftCurrent(applyFacts.stagedAt, applyFacts.now)

pure def profileFactEditClearsDerived(operation: ProfileFactEditOperation): bool =
  operation == CorrectFact or operation == RemoveFact or operation == ChangeFactScope

pure def profileFactEditDisablesSourceReplay(operation: ProfileFactEditOperation): bool =
  operation == CorrectFact or operation == RemoveFact

pure def canConfirmProfileFact(draft: ProfileFactEdit, applyFacts: ProfileFactEditApplyFacts): bool =
  draft.phase == AwaitingProfileFactConfirmation and applyFacts.stagedAt == draft.stagedAt
    and profileFactEditMayApply(applyFacts)

pure def confirmProfileFact(draft: ProfileFactEdit, applyFacts: ProfileFactEditApplyFacts): ProfileFactEdit =
  if (canConfirmProfileFact(draft, applyFacts)) { ...draft, phase: AppliedProfileFactEdit }
  else draft

pure def lawProfileFactEditNeedsExactCurrentConfirmation(applyFacts: ProfileFactEditApplyFacts): bool =
  profileFactEditMayApply(applyFacts) implies
    (applyFacts.direct and applyFacts.ownerCurrent and applyFacts.exactDraft and
      applyFacts.exactFact and applyFacts.unchanged and profileFactEditDraftCurrent(applyFacts.stagedAt, applyFacts.now))

pure def lawChangedProfileFactClearsDerivationAndOldEvidence(operation: ProfileFactEditOperation): bool =
  (operation == CorrectFact or operation == RemoveFact) implies
    (profileFactEditClearsDerived(operation) and profileFactEditDisablesSourceReplay(operation))

pure def stepProfileFactApplyNeedsPendingDraft(before: ProfileFactEdit, via: str, after: ProfileFactEdit): bool =
  (via == "confirmProfileFact" and after != before) implies before.phase == AwaitingProfileFactConfirmation

pure def sometimesProfileFactCorrected(draft: ProfileFactEdit): bool =
  draft.phase == AppliedProfileFactEdit and draft.operation == CorrectFact
pure def sometimesProfileFactRemoved(draft: ProfileFactEdit): bool =
  draft.phase == AppliedProfileFactEdit and draft.operation == RemoveFact
pure def sometimesProfileFactScopeChanged(draft: ProfileFactEdit): bool =
  draft.phase == AppliedProfileFactEdit and draft.operation == ChangeFactScope
```

### Cancellation, expiry and replay cannot make another change

An exact direct owner cancellation closes a pending draft. Once it
expires, the draft cannot be confirmed. A replay of a committed signed
confirmation may return only its exact stored reply after rechecking
owner and app authority. Replaying that reply cannot change a fact,
recreate a draft, or make another receipt.

```quint
pure def profileFactEditMayCancel(direct: bool, ownerCurrent: bool, exactDraft: bool): bool =
  direct and ownerCurrent and exactDraft

pure def profileFactEditMayReplay(direct: bool, ownerCurrent: bool, exactReceipt: bool): bool =
  direct and ownerCurrent and exactReceipt

pure def canCloseProfileFact(draft: ProfileFactEdit, now: int, exactCancellation: bool): bool =
  draft.phase == AwaitingProfileFactConfirmation and
    (exactCancellation or now - draft.stagedAt >= profileFactEditTtlMs)

pure def closeProfileFact(draft: ProfileFactEdit, now: int, exactCancellation: bool): ProfileFactEdit =
  if (canCloseProfileFact(draft, now, exactCancellation)) { ...draft, phase: ClosedProfileFactDraft }
  else draft

pure def canReplayProfileFact(draft: ProfileFactEdit, direct: bool, ownerCurrent: bool, exactReceipt: bool): bool =
  draft.phase == AppliedProfileFactEdit and profileFactEditMayReplay(direct, ownerCurrent, exactReceipt)

pure def replayProfileFact(draft: ProfileFactEdit, direct: bool, ownerCurrent: bool, exactReceipt: bool): ProfileFactEdit =
  draft

pure def alwaysProfileFactDraftHasStagingTime(draft: ProfileFactEdit): bool =
  draft.phase != NoProfileFactDraft implies draft.stagedAt >= 0

pure def stepProfileFactReplayKeepsState(before: ProfileFactEdit, via: str, after: ProfileFactEdit): bool =
  via == "replayProfileFact" implies after == before

pure def sometimesProfileFactDraftClosed(draft: ProfileFactEdit): bool = draft.phase == ClosedProfileFactDraft
```
