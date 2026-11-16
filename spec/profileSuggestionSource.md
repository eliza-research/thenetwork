# Control connected-source profile suggestions

The Network handles private suggestions for a resolved owner, app and chat. Signed proof parsing, current consent, source authorization, privacy validation, query scoping, and transaction locks remain in the service.

## Story: Collect suggestions from sources I authorized

> As a member, I want a collection to use my approved source selection and to show only the private batch it actually saved.

### Resolve the owner and any claimed collection turn before authorizing live sources

The owner must be eligible to collect. A claimed collection requires the stored, matching member turn and its exact collection scope. Internal collection without a claim goes from owner eligibility directly to source authorization. Every suggestion still needs its source authorization before the transaction considers a replay or new batch.

```quint
type SourcePhase =
  SourceInitial | SourceDenied | CheckingCollectionTurn | CheckingLiveSources | ReadingCollectionReceipt |
  ReplayingCollection | SavingCollection | CheckingWithdrawalTurn | ReadingCleanupReceipt |
  ReplayingCleanup | ApplyingCleanup | CleanupConfirmed
type SourceFlow = { phase: SourcePhase }
pure val initial: SourceFlow = { phase: SourceInitial }

pure def canStartSourceCollection(flow: SourceFlow): bool = flow.phase == SourceInitial
pure def startSourceCollection(flow: SourceFlow, eligible: bool, claimed: bool): SourceFlow =
  { phase: if (not(eligible)) SourceDenied else if (claimed) CheckingCollectionTurn else CheckingLiveSources }

pure def canReadCollectionTurn(flow: SourceFlow): bool = flow.phase == CheckingCollectionTurn
pure def readCollectionTurn(flow: SourceFlow, matches: bool): SourceFlow =
  { phase: if (matches) CheckingLiveSources else SourceDenied }

pure def canReadLiveSourceConsent(flow: SourceFlow): bool = flow.phase == CheckingLiveSources
pure def readLiveSourceConsent(flow: SourceFlow, allowed: bool): SourceFlow =
  { phase: if (allowed) ReadingCollectionReceipt else SourceDenied }
```

### A collection replay only returns its original private pending batch

An existing receipt must match the collection request and batch. Replay the original preview only while its revision is the first and all originally expected items remain proposed. A conflicting receipt is refused. A new batch may be saved when the shell confirms capacity and an unused batch ID, with its receipt committed in the same transaction.

```quint
pure def canReadCollectionReceipt(flow: SourceFlow): bool = flow.phase == ReadingCollectionReceipt
pure def readCollectionReceipt(flow: SourceFlow, prior: bool, matches: bool): SourceFlow =
  { phase: if (not(prior)) SavingCollection else if (matches) ReplayingCollection else SourceDenied }

pure def collectionRevisionIsOriginal(revision: int): bool = revision == 1

pure def collectionPreviewUnchanged(sameCount: bool, onlyPending: bool): bool =
  sameCount and onlyPending

pure def stepCollectionSaveRequiresReceiptCheck(before: SourceFlow, via: str, after: SourceFlow): bool =
  after.phase == SavingCollection implies (before.phase == ReadingCollectionReceipt and via == "readCollectionReceipt")

pure def sometimesSavesSourceCollection(flow: SourceFlow): bool = flow.phase == SavingCollection
pure def sometimesReplaysSourceCollection(flow: SourceFlow): bool = flow.phase == ReplayingCollection
```

## Story: Stop collection or remove data from one connector

> As a member, I want the Network to honor my withdrawal or source disconnect while keeping only the facts my action and consent allow.

### Cleanup uses current owner authority and any required stored withdrawal turn

Use the current owner and the matching cleanup proof. An owner withdrawal also requires the stored member turn at or before the proof cutoff. The shell scopes rows to the authorized owner and connection and applies the proof's cutoff for signed cleanup. Cleanup does not require an active source-read grant.

```quint
pure def canStartSourceCleanup(flow: SourceFlow): bool = flow.phase == SourceInitial
pure def startSourceCleanup(flow: SourceFlow, authorized: bool, ownerWithdrawal: bool): SourceFlow =
  { phase: if (not(authorized)) SourceDenied else if (ownerWithdrawal) CheckingWithdrawalTurn else ReadingCleanupReceipt }

pure def canReadWithdrawalTurn(flow: SourceFlow): bool = flow.phase == CheckingWithdrawalTurn
pure def readWithdrawalTurn(flow: SourceFlow, matches: bool): SourceFlow =
  { phase: if (matches) ReadingCleanupReceipt else SourceDenied }
```

### Replay returns stored results without mutating the suggestions

A matching cleanup receipt returns its original counts only after rechecking owner and authority. A conflicting receipt denies cleanup. For a completely new request, the operation and retention policy determine what changes. Revoked connection cleanup records a receipt even for a readback. An owner readback only reads counts and does not store a new receipt. A new cleanup's final authority failure rolls back any changes and receipt claimed in the transaction.

```quint
pure def ownerCleanupUsesReceipt(operation: str): bool = operation != "readback"

pure def canReadCleanupReceipt(flow: SourceFlow): bool = flow.phase == ReadingCleanupReceipt
pure def readCleanupReceipt(flow: SourceFlow, prior: bool, matches: bool): SourceFlow =
  { phase: if (not(prior)) ApplyingCleanup else if (matches) ReplayingCleanup else SourceDenied }

pure def canConfirmSourceCleanup(flow: SourceFlow): bool =
  flow.phase == ApplyingCleanup or flow.phase == ReplayingCleanup
pure def confirmSourceCleanup(flow: SourceFlow, authorized: bool): SourceFlow =
  { phase: if (authorized) CleanupConfirmed else SourceDenied }

pure def sometimesConfirmsSourceCleanup(flow: SourceFlow): bool = flow.phase == CleanupConfirmed
```

### Cleanup changes only rows selected by the member's operation

Readback preserves every row. Disconnect scrubs a row unless it is accepted and explicitly retained. Owner withdrawal only scrubs proposed suggestions and leaves accepted facts in place. Delete removes the selected rows and their linked facts. The service updates the revision for changed batches for signed operations.

```quint
type SuggestionCleanupAction = KeepSuggestion | ScrubSuggestion | DeleteSuggestion
pure def suggestionCleanupAction(operation: str, status: str, retainAccepted: bool): SuggestionCleanupAction =
  if (operation == "readback") KeepSuggestion
  else if (operation == "disconnect" and status == "accepted" and retainAccepted) KeepSuggestion
  else if (operation == "withdraw" and status != "proposed") KeepSuggestion
  else if (operation == "delete") DeleteSuggestion
  else ScrubSuggestion

pure def lawReadbackPreservesSuggestion(status: str, retainAccepted: bool): bool =
  suggestionCleanupAction("readback", status, retainAccepted) == KeepSuggestion

pure def lawWithdrawalPreservesAcceptedSuggestion(retainAccepted: bool): bool =
  suggestionCleanupAction("withdraw", "accepted", retainAccepted) == KeepSuggestion
```
