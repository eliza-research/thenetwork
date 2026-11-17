# Leave an app, erase an account, or read an export

The account service acts on the canonical person for the caller's verified phone. Its callers own request authorization. The site API checks the session and the number's hold, and requires fresh sign-in for full deletion. The shared-line caller handles its own text and consent authority. The model governs the account service's scoped operation after those checks. Storage and hooks perform the work.

## Story: Leave one app and keep my other memberships

> As a member, I want leaving one app to stop its messages and remove its membership.

### A leave records app consent before cleanup

Record an opt-out for the chosen app even if the verified phone has no membership to remove. Check the exact phone owner under the identity lock before writing consent. A signed leave uses the message time and the routed membership. The phone binding and the app membership must have existed by that time. The consent write and selection of the membership for cleanup share one transaction. After an admitted leave, run the app's forget hook and remove only that exact membership. A phone move after consent carries the recorded opt-out with the person. Leave does not erase the person or change other apps.

```quint
type PrivacyOperation = LeaveApp | DeleteAccount | ExportApp
type PrivacyPhase = AwaitingOperation | AwaitingLeaveConsent | AwaitingAppForget | AwaitingAccountOwner |
  AwaitingAccountCleanup | AwaitingAccountErasure | AwaitingAppExport | AwaitingConsentExport | CompletePrivacyRequest | RefusedPrivacyRequest
type PrivacyRequest = {
  phase: PrivacyPhase, operation: PrivacyOperation, optedOut: bool, ownerChecked: bool,
  cleanupDone: bool, includeMembership: bool, membershipBound: bool,
}
pure val initial: PrivacyRequest = {
  phase: AwaitingOperation, operation: LeaveApp, optedOut: false, ownerChecked: false,
  cleanupDone: false, includeMembership: false, membershipBound: false,
}

pure def canBeginPrivacyRequest(privacy: PrivacyRequest): bool = privacy.phase == AwaitingOperation
pure def beginPrivacyRequest(privacy: PrivacyRequest, operation: PrivacyOperation): PrivacyRequest =
  { ...initial, operation: operation, phase: if (operation == LeaveApp) AwaitingLeaveConsent
    else if (operation == DeleteAccount) AwaitingAccountOwner else AwaitingAppExport }

pure def hasScopedMembership(hasPerson: bool, hasMembership: bool, removed: bool): bool =
  hasPerson and hasMembership and not(removed)

pure def appLeaveBindingCurrent(verifiedOwner: str, currentOwner: str, held: bool, verifiedAt: int, requestedAt: int): bool =
  verifiedPrivacyOwnerMatches(verifiedOwner, currentOwner, held) and verifiedAt <= requestedAt

pure def appLeaveMemberCurrent(expectedMember: str, currentMember: str, joinedAt: int, requestedAt: int): bool =
  expectedMember == "" or (expectedMember == currentMember and joinedAt <= requestedAt)

pure def canRecordLeaveConsent(privacy: PrivacyRequest): bool =
  privacy.phase == AwaitingLeaveConsent and privacy.operation == LeaveApp
pure def recordLeaveConsent(privacy: PrivacyRequest, recorded: bool, membershipBound: bool): PrivacyRequest =
  { ...privacy, optedOut: recorded, membershipBound: recorded and membershipBound,
    phase: if (not(recorded)) RefusedPrivacyRequest else if (membershipBound) AwaitingAppForget else CompletePrivacyRequest }

pure def lawLeaveNeverPredatesPhoneBinding(owner: str, verifiedAt: int, requestedAt: int): bool =
  requestedAt < verifiedAt implies not(appLeaveBindingCurrent(owner, owner, false, verifiedAt, requestedAt))

pure def canRecordAppForget(privacy: PrivacyRequest): bool =
  privacy.phase == AwaitingAppForget and privacy.operation == LeaveApp and privacy.optedOut and privacy.membershipBound
pure def recordAppForget(privacy: PrivacyRequest): PrivacyRequest = { ...privacy, phase: CompletePrivacyRequest }
```

## Story: Erase my account

> As a member, I want my memberships and associated data removed while required safety records are kept.

### Erasure follows the authorized person across a number change

Check the verified session against the current ownership of the phone before running any forget hook. Once admitted for a person, run the hooks for their live memberships. Erase grants and pending connector requests for the exact person across all apps, including apps without a membership and grants moved to a new number. For an app leave, use the same person binding for that app alone. Lock the person at the final write and find the verified number that still belongs to them. Preserve the lowest age and suppression on the current number and erase only its phone-scoped data. A move during cleanup leaves the original number and any new owner outside the erasure. A verified phone without a person can erase its phone data only while it remains unbound. Check this under the same binding lock used to create or move a phone. Staff release of a recycled number requires the exact held binding and clears the old identity's phone hash, age floor and suppression in the erasure transaction.

```quint
pure def verifiedPrivacyOwnerMatches(verifiedOwner: str, currentOwner: str, held: bool): bool =
  not(held) and verifiedOwner == currentOwner

pure def hasAgeToPreserve(hasPerson: bool, hasLowestAge: bool): bool =
  hasPerson and hasLowestAge

pure def phoneErasureAllowed(personBound: bool, hasCurrentOwner: bool, staffRelease: bool, exactHeldBinding: bool): bool =
  if (staffRelease) personBound and exactHeldBinding else personBound == hasCurrentOwner

pure def lawUnboundErasureCannotRemoveAnOwner(staffRelease: bool, exactHeldBinding: bool): bool =
  not(phoneErasureAllowed(false, true, staffRelease, exactHeldBinding))

pure def canCheckErasureOwner(privacy: PrivacyRequest): bool =
  privacy.phase == AwaitingAccountOwner and privacy.operation == DeleteAccount
pure def checkErasureOwner(privacy: PrivacyRequest, authorityCurrent: bool): PrivacyRequest =
  { ...privacy, phase: if (authorityCurrent) AwaitingAccountCleanup else RefusedPrivacyRequest, ownerChecked: authorityCurrent }

pure def canRecordAccountCleanup(privacy: PrivacyRequest): bool =
  privacy.phase == AwaitingAccountCleanup and privacy.operation == DeleteAccount and privacy.ownerChecked
pure def recordAccountCleanup(privacy: PrivacyRequest): PrivacyRequest =
  { ...privacy, phase: AwaitingAccountErasure, cleanupDone: true }

pure def canRecordAccountErasure(privacy: PrivacyRequest): bool =
  privacy.phase == AwaitingAccountErasure and privacy.operation == DeleteAccount and privacy.ownerChecked and privacy.cleanupDone
pure def recordAccountErasure(privacy: PrivacyRequest, committed: bool): PrivacyRequest =
  { ...privacy, phase: if (committed) CompletePrivacyRequest else RefusedPrivacyRequest }
```

## Story: Read my own app data

> As an authorized member or agent, I want an export of my data for the current app.

### A removed or absent membership has no exportable profile

Bind the request to the verified session's person and phone before reading consent or app records. An unbound session can export phone consent only while the phone has no owner. A held phone or a changed owner removes access to the export. Check ownership again after collecting the data. Include a profile and its Network data only while the same membership exists for the requested app. The shell owns app-specific data lookup and formatting.

```quint
pure def lawHeldPhoneCannotExport(verifiedOwner: str, currentOwner: str): bool =
  not(verifiedPrivacyOwnerMatches(verifiedOwner, currentOwner, true))

pure def canCheckAppExport(privacy: PrivacyRequest): bool =
  privacy.phase == AwaitingAppExport and privacy.operation == ExportApp
pure def checkAppExport(privacy: PrivacyRequest, membershipBound: bool): PrivacyRequest =
  { ...privacy, phase: AwaitingConsentExport, membershipBound: membershipBound, includeMembership: membershipBound }

pure def canRecordConsentExport(privacy: PrivacyRequest): bool =
  privacy.phase == AwaitingConsentExport and privacy.operation == ExportApp
pure def recordConsentExport(privacy: PrivacyRequest): PrivacyRequest =
  { ...privacy, phase: CompletePrivacyRequest }
```

### An export includes the member's own facts and photo metadata

Read the Network record for the same app, person and member. Include its exported facts, own messages and opportunities. Include a private fact only when it is confirmed and the person stated it or accepted it from an authorized source. The former Gmail import can appear here only as a confirmed fact the person already accepted. Exclude appearance ratings and internal private assessments. Include the person's photo ID, upload time, size and content type for this app. Keep photo content, storage keys and ratings private.

```quint
pure def memberExportFacetAllowed(visibility: str, status: str, provenance: str, facetSource: str, isAppearance: bool): bool =
  not(isAppearance) and (visibility != "agent_private" or (status == "confirmed"
    and (provenance == "said" or facetSource == "gmail" or facetSource == "google_calendar")))

pure def lawAppearanceNeverAppearsInExport(visibility: str, status: str, provenance: str, facetSource: str): bool =
  not(memberExportFacetAllowed(visibility, status, provenance, facetSource, true))

pure def lawPrivateExportNeedsConfirmation(provenance: str, facetSource: str, isAppearance: bool): bool =
  not(memberExportFacetAllowed("agent_private", "proposed", provenance, facetSource, isAppearance))
```

### An export includes the member's own gathering responses

The Network exports a member's retained RSVP, attendance and follow-up choices with the event details for that revision. Attendance and follow-up are optional. Include only the export owner's responses to the same event revision. Keep other members' identities and responses, private references and staff review records out of the export.

```quint
pure def memberExportGatheringsAllowed(app: str, membershipBound: bool): bool =
  app == "ntwrk" and membershipBound
```

### The service completes each operation in its own scope

A completed leave has recorded app opt-out. Full erasure follows ownership verification and app cleanup. A profile in an export requires its own app membership. Removing a membership also deletes its imported suggestions and connection receipts, and the photo relay items addressed to that member in the app. The sending person's photo and records belonging to other current memberships stay with their owners.

```quint
pure def alwaysLeaveRecordsConsent(privacy: PrivacyRequest): bool =
  (privacy.operation == LeaveApp and (privacy.phase == AwaitingAppForget or privacy.phase == CompletePrivacyRequest)) implies privacy.optedOut

pure def alwaysErasureRequiresCleanup(privacy: PrivacyRequest): bool =
  (privacy.operation == DeleteAccount and (privacy.phase == AwaitingAccountErasure or privacy.phase == CompletePrivacyRequest)) implies
    (privacy.ownerChecked and privacy.cleanupDone)

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
