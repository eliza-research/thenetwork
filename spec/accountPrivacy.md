# Leave an app, erase an account, or read an export

The account service acts on the canonical person for the caller's verified phone. Its callers own request authorization. The site API checks the session and the number's hold, and requires fresh sign-in for full deletion. The shared-line caller handles its own text and consent authority. The model governs the account service's scoped operation after those checks. Storage and hooks perform the work.

## Story: Leave one app and keep my other memberships

> As a member, I want leaving one app to stop its messages and remove its membership.

### A leave records app consent before cleanup

Record an opt-out for the chosen app even if the phone has no membership to remove. If the canonical person has a membership that has yet to be removed, run the app's forget hook and mark that membership removed. Leave does not erase the person or change other apps.

```quint
type PrivacyOperation = LeaveApp | DeleteAccount | ExportApp
type PrivacyPhase = AwaitingOperation | AwaitingLeaveConsent | AwaitingAppForget | AwaitingAccountAge |
  AwaitingAccountCleanup | AwaitingAccountErasure | AwaitingAppExport | AwaitingConsentExport | CompletePrivacyRequest
type PrivacyRequest = {
  phase: PrivacyPhase, operation: PrivacyOperation, optedOut: bool, ageChecked: bool,
  cleanupDone: bool, includeMembership: bool, membershipBound: bool,
}
pure val initial: PrivacyRequest = {
  phase: AwaitingOperation, operation: LeaveApp, optedOut: false, ageChecked: false,
  cleanupDone: false, includeMembership: false, membershipBound: false,
}

pure def canBeginPrivacyRequest(privacy: PrivacyRequest): bool = privacy.phase == AwaitingOperation
pure def beginPrivacyRequest(privacy: PrivacyRequest, operation: PrivacyOperation): PrivacyRequest =
  { ...initial, operation: operation, phase: if (operation == LeaveApp) AwaitingLeaveConsent
    else if (operation == DeleteAccount) AwaitingAccountAge else AwaitingAppExport }

pure def hasScopedMembership(hasPerson: bool, hasMembership: bool, removed: bool): bool =
  hasPerson and hasMembership and not(removed)

pure def canRecordLeaveConsent(privacy: PrivacyRequest): bool =
  privacy.phase == AwaitingLeaveConsent and privacy.operation == LeaveApp
pure def recordLeaveConsent(privacy: PrivacyRequest, membershipBound: bool): PrivacyRequest =
  { ...privacy, optedOut: true, membershipBound: membershipBound,
    phase: if (membershipBound) AwaitingAppForget else CompletePrivacyRequest }

pure def canRecordAppForget(privacy: PrivacyRequest): bool =
  privacy.phase == AwaitingAppForget and privacy.operation == LeaveApp and privacy.optedOut and privacy.membershipBound
pure def recordAppForget(privacy: PrivacyRequest): PrivacyRequest = { ...privacy, phase: CompletePrivacyRequest }
```

## Story: Erase my account

> As a member, I want my memberships and associated data removed while required safety records are kept.

### Preserve the age floor before full-account cleanup

The account service preserves the lowest known age of the canonical person on the phone's age floor if available. Then run the forget hook for every membership that has yet to be removed. Call the whole-account erasure store only after those steps complete. If the phone has no person, there are no memberships or member age to process and the store still handles its own suppression and phone cleanup.

```quint
pure def hasAgeToPreserve(hasPerson: bool, hasLowestAge: bool): bool =
  hasPerson and hasLowestAge

pure def canRecordAgeCheck(privacy: PrivacyRequest): bool =
  privacy.phase == AwaitingAccountAge and privacy.operation == DeleteAccount
pure def recordAgeCheck(privacy: PrivacyRequest): PrivacyRequest =
  { ...privacy, phase: AwaitingAccountCleanup, ageChecked: true }

pure def canRecordAccountCleanup(privacy: PrivacyRequest): bool =
  privacy.phase == AwaitingAccountCleanup and privacy.operation == DeleteAccount and privacy.ageChecked
pure def recordAccountCleanup(privacy: PrivacyRequest): PrivacyRequest =
  { ...privacy, phase: AwaitingAccountErasure, cleanupDone: true }

pure def canRecordAccountErasure(privacy: PrivacyRequest): bool =
  privacy.phase == AwaitingAccountErasure and privacy.operation == DeleteAccount and privacy.ageChecked and privacy.cleanupDone
pure def recordAccountErasure(privacy: PrivacyRequest): PrivacyRequest =
  { ...privacy, phase: CompletePrivacyRequest }
```

## Story: Read my own app data

> As an authorized member or agent, I want an export of my data for the current app.

### A removed or absent membership has no exportable profile

Export consent for the requested app. Include a membership and its associated Network data only if the canonical person has a membership for the same app that has yet to be removed. The shell owns app-specific data lookup and formatting.

```quint
pure def canCheckAppExport(privacy: PrivacyRequest): bool =
  privacy.phase == AwaitingAppExport and privacy.operation == ExportApp
pure def checkAppExport(privacy: PrivacyRequest, membershipBound: bool): PrivacyRequest =
  { ...privacy, phase: AwaitingConsentExport, membershipBound: membershipBound, includeMembership: membershipBound }

pure def canRecordConsentExport(privacy: PrivacyRequest): bool =
  privacy.phase == AwaitingConsentExport and privacy.operation == ExportApp
pure def recordConsentExport(privacy: PrivacyRequest): PrivacyRequest =
  { ...privacy, phase: CompletePrivacyRequest }
```

### The service completes each operation in its own scope

A completed leave has recorded app opt-out. Full erasure follows the age and app cleanup steps. A profile in an export requires its own app membership.

```quint
pure def alwaysLeaveRecordsConsent(privacy: PrivacyRequest): bool =
  (privacy.operation == LeaveApp and (privacy.phase == AwaitingAppForget or privacy.phase == CompletePrivacyRequest)) implies privacy.optedOut

pure def alwaysErasureRequiresCleanup(privacy: PrivacyRequest): bool =
  (privacy.operation == DeleteAccount and (privacy.phase == AwaitingAccountErasure or privacy.phase == CompletePrivacyRequest)) implies
    (privacy.ageChecked and privacy.cleanupDone)

pure def alwaysExportNeedsMembership(privacy: PrivacyRequest): bool =
  (privacy.operation == ExportApp and privacy.includeMembership) implies privacy.membershipBound

pure def lawRemovedMembershipIsExcluded(hasPerson: bool, hasMembership: bool): bool =
  not(hasScopedMembership(hasPerson, hasMembership, true))

pure def sometimesLeavesApp(privacy: PrivacyRequest): bool =
  privacy.operation == LeaveApp and privacy.phase == CompletePrivacyRequest and privacy.membershipBound
pure def sometimesErasesAccount(privacy: PrivacyRequest): bool =
  privacy.operation == DeleteAccount and privacy.phase == CompletePrivacyRequest
pure def sometimesExportsMembership(privacy: PrivacyRequest): bool =
  privacy.operation == ExportApp and privacy.phase == CompletePrivacyRequest and privacy.includeMembership
```
