# Leave an app, erase an account, or read an export

The account service acts on the canonical person for the caller's verified phone. Its callers own request authorization. The site API checks the session and the number's hold, and requires fresh sign-in for full deletion. The shared-line caller handles its own text and consent authority. The model governs the account service's scoped operation after those checks. Storage and hooks perform the work. The shell applies the export owner check again after it collects the data, and returns an empty export when the check then fails. An export lists the person's photo ID, upload time, size and content type for the app, and keeps photo content, storage keys and ratings private. The gathering query includes only the export owner's responses to the same event revision, and keeps other members' identities and responses, private references and staff review records out of the export. Removing a membership also deletes its imported suggestions and connection receipts, and the photo relay items addressed to that member in the app; the sending person's photo and records of other current memberships stay with their owners.

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

Bind the request to the verified session's person and phone before reading consent or app records. An unbound session can export phone consent only while the phone has no owner and no hold. A held phone or a changed owner removes access to the export. Include a profile and its Network data only while the same membership exists for the requested app. The shell owns app-specific data lookup and formatting.

```quint
pure def lawHeldPhoneCannotExport(verifiedOwner: str, currentOwner: str): bool =
  not(verifiedPrivacyOwnerMatches(verifiedOwner, currentOwner, true))

pure def lawUnboundExportNeedsUnownedPhone(currentOwner: str, held: bool): bool =
  verifiedPrivacyOwnerMatches("", currentOwner, held) implies (currentOwner == "" and not(held))

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

Read the Network record for the same app, person and member. Include its exported facts, own messages and opportunities. Include a private fact only when it is confirmed and the person stated it or accepted it from an authorized source: a Gmail or Google Calendar import. Such an import appears here only as a confirmed fact the person already accepted. Exclude appearance ratings and internal private assessments. The export also carries the person's photo metadata for this app.

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

For ntwrk.party only, and only while the membership is bound, the Network exports a member's retained RSVP, attendance and follow-up choices with the event details for that revision. Attendance and follow-up are optional. Other apps export no gathering responses.

```quint
pure def memberExportGatheringsAllowed(app: str, membershipBound: bool): bool =
  app == "ntwrk" and membershipBound
```

### The service completes each operation in its own scope

A completed leave has recorded app opt-out. Full erasure follows ownership verification and app cleanup. A profile in an export requires its own app membership. A removed membership has no scoped membership.

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

## Story: Staff carry out an export or erasure request sent to support

> As a member who writes to help@ntwrk.party, I want staff to send me my data or erase my account, and nobody else's, after I prove that I hold the number.

[Story F24](product/stories.md#story-f24--export-or-delete-my-data) sends formal export and erasure requests to the support address. The staff API serves them on the staff port. The shell authenticates the staff member, writes an audit row before each step and a result row after it, sends the possession code through the phone verification service, and keeps the request record. The record holds the keyed phone hash, never the number.

### Only a global admin with a stated reason opens or confirms a support request

New rule: before this change no staff route served a support request. A support request reaches every app of a person, so only an admin grant for all apps admits it, and the staff member states a reason of 5 to 500 characters at each step. Every other role, an admin of one app included, is refused. Changed after review: the first law only restated the rule, so the laws now say that a missing global admin role and a reason length outside 5 to 500 are each refused for every other input.

```quint
pure val privacySupportReasonMin: int = 5
pure val privacySupportReasonMax: int = 500
pure val reasonLengthValues = Set(0, privacySupportReasonMin - 1, privacySupportReasonMin, privacySupportReasonMax, privacySupportReasonMax + 1)
pure val globalRolesValues = Set(List(), List("admin"), List("reviewer", "safety"))

pure def privacySupportAllowed(globalRoles: List[str], reasonLength: int): bool =
  globalRoles.includes("admin") and reasonLength >= privacySupportReasonMin and reasonLength <= privacySupportReasonMax

pure def lawSupportWithoutGlobalAdminRefused(globalRoles: List[str], reasonLength: int): bool =
  not(globalRoles.includes("admin")) implies not(privacySupportAllowed(globalRoles, reasonLength))

pure def lawSupportReasonOutsideBoundsRefused(globalRoles: List[str], reasonLength: int): bool =
  (reasonLength < privacySupportReasonMin or reasonLength > privacySupportReasonMax) implies not(privacySupportAllowed(globalRoles, reasonLength))
```

### A support export covers one app or every app, and an erasure covers every app

New rule: it fixes the scope that staff can ask for. An export names one app or every app, and each app in scope uses the member export of "Read my own app data", so a support export contains what the member export contains and nothing more. An erasure always covers every app.

```quint
type PrivacySupportOperation = SupportExport | SupportErase
type PrivacySupportScope = SupportOneApp | SupportEveryApp

pure def privacySupportScopeAllowed(operation: PrivacySupportOperation, scope: PrivacySupportScope): bool =
  operation == SupportExport or scope == SupportEveryApp

pure def privacySupportExportApps(scope: PrivacySupportScope, app: str, apps: List[str]): List[str] =
  if (scope == SupportEveryApp) apps else apps.select(a => a == app)

pure def lawOneAppExportStaysInItsApp(app: str, apps: List[str]): bool =
  privacySupportExportApps(SupportOneApp, app, apps).every(a => a == app)

pure def lawEraseCoversEveryApp(scope: PrivacySupportScope): bool =
  privacySupportScopeAllowed(SupportErase, scope) implies scope == SupportEveryApp
```

### Staff act only on the confirmed person after a fresh code from the number

New rule: it makes a wrong target impossible to reach with one mistyped call. The first step records the request for one phone and one operation, sends a code to that phone, and answers with the person ID and the masked number. The confirming step names the same request, phone and operation, echoes the person ID, and gives the code that the person read back. The target checks come first, so a refused echo does not use the code. A request is open for 30 minutes. A request that already completed reports that it completed and never acts again.

```quint
pure val privacySupportWindowMs: int = 1800000

type PrivacySupportDecision = SupportProceeds | SupportAlreadyDone | SupportUnavailable | SupportTargetChanged | SupportCodeRefused

pure def privacySupportOpen(elapsedMs: int): bool = elapsedMs >= 0 and elapsedMs < privacySupportWindowMs

pure def privacySupportDecision(sameRequest: bool, completed: bool, elapsedMs: int, echoedPerson: bool,
    ownerCurrent: bool, codeVerified: bool): PrivacySupportDecision =
  if (not(sameRequest)) SupportUnavailable
  else if (completed) SupportAlreadyDone
  else if (not(privacySupportOpen(elapsedMs))) SupportUnavailable
  else if (not(echoedPerson) or not(ownerCurrent)) SupportTargetChanged
  else if (not(codeVerified)) SupportCodeRefused
  else SupportProceeds

pure val elapsedMsValues = Set(-1, 0, privacySupportWindowMs - 1, privacySupportWindowMs)

pure def lawSupportProceedsOnlyForTheConfirmedHolder(sameRequest: bool, completed: bool, elapsedMs: int,
    echoedPerson: bool, ownerCurrent: bool, codeVerified: bool): bool =
  privacySupportDecision(sameRequest, completed, elapsedMs, echoedPerson, ownerCurrent, codeVerified) == SupportProceeds implies
    (sameRequest and not(completed) and privacySupportOpen(elapsedMs) and echoedPerson and ownerCurrent and codeVerified)

pure def lawCompletedSupportRequestNeverActsAgain(elapsedMs: int, echoedPerson: bool, ownerCurrent: bool, codeVerified: bool): bool =
  privacySupportDecision(true, true, elapsedMs, echoedPerson, ownerCurrent, codeVerified) == SupportAlreadyDone
```

### A support request runs the member's own export or account erasure

New rule: the operator path has no erasure or export of its own. A confirmed erasure runs "Erase my account" for the current owner of the phone: each live membership's forget hook (Network rows, photos and that app's connector grants), grants and connector requests in every app, sessions, shares, pending texts, consent and the phone binding. It keeps the tombstone, the suppression, the lowest age, bans and safety records. A phone with no person erases only its phone data, as the member path does. A confirmed export runs "Read my own app data" for each app in scope. Changed after review: the shell chose the member operation from the request record by itself, so it now selects it through this function.

```quint
pure def privacySupportOperation(operation: PrivacySupportOperation): PrivacyOperation =
  if (operation == SupportErase) DeleteAccount else ExportApp

pure def lawSupportUsesMemberOperation(operation: PrivacySupportOperation): bool =
  beginPrivacyRequest(initial, privacySupportOperation(operation)).phase ==
    (if (operation == SupportErase) AwaitingAccountOwner else AwaitingAppExport)
```
