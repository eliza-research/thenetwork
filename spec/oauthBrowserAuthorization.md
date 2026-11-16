# Connector browser authorization

This phase binds the connector's authorization request to the browser and moves it through phone verification and consent. The handler validates the registered OAuth request and owns cookies, time, identity services, storage, audits, and responses. The grant issuance flow starts only after this phase accepts an explicit approval.

## Story: Approve access in the browser after proving my phone

> As a person connecting my assistant, I want this browser to confirm my identity and ask for my permission before giving the assistant any access.

### A live authorization request is bound to one browser in one app

A request must belong to this app, be live, and have a browser cookie before the shell compares its digest. Resume a stored request only when the digest matches and the stored client exists.

```quint
type BrowserPhase =
  BrowserStarting | BrowserExpired | CheckingClient | BrowserBound |
  ShowingPhone | HandingOffToCloud | StartingOtp | ShowingCode | VerifyingOtp | RetryingOtp |
  CheckingIdentity | ShowingConsent | IdentityDenied |
  CheckingConsentOwner | CheckingCloudGrant | ConsentReady | ConsentDeclined | OwnerChanged |
  CloudDenied | SessionRetry | AlreadyVerified
type BrowserFlow = { phase: BrowserPhase, explicitlyApproved: bool }
pure val initial: BrowserFlow = { phase: BrowserStarting, explicitlyApproved: false }

pure def mayCompareBrowserDigest(sameApp: bool, liveRequest: bool, cookiePresent: bool): bool =
  sameApp and liveRequest and cookiePresent

pure def canBindBrowser(flow: BrowserFlow): bool = flow.phase == BrowserStarting
pure def bindBrowser(flow: BrowserFlow, matchesDigest: bool): BrowserFlow =
  { ...flow, phase: if (matchesDigest) CheckingClient else BrowserExpired }

pure def canReadBrowserClient(flow: BrowserFlow): bool = flow.phase == CheckingClient
pure def readBrowserClient(flow: BrowserFlow, clientExists: bool): BrowserFlow =
  { ...flow, phase: if (clientExists) BrowserBound else BrowserExpired }
```

### An existing session leads to consent or a new sign-in starts

After validating a new authorization request, use its existing site identity if one is available. An unavailable session gives a retry. Without a session, a Cloud-only app sends the person to Cloud and another app asks for a phone. A Cloud return must resume a bound request that is still waiting for a phone.

```quint
type EntrySession = SignedIn | SignedOut | SessionUnavailable
pure def canChooseEntry(flow: BrowserFlow): bool = flow.phase == BrowserStarting
pure def chooseEntry(flow: BrowserFlow, session: EntrySession, cloudRequired: bool): BrowserFlow =
  { ...flow, phase:
    if (session == SessionUnavailable) SessionRetry
    else if (session == SignedIn) CheckingIdentity
    else if (cloudRequired) HandingOffToCloud else ShowingPhone }
```

### The stored page determines what a form can do

Phone submission starts or restarts verification until the request reaches consent. Only a code page with a stored phone can verify a code. Only a consent page with a phone accepts a consent decision. A dedicated cancel form can end any bound request.

```quint
type StoredPage = PhonePage | CodePage | ConsentPage
type BrowserForm = PhoneForm | CodeForm | ConsentForm | CancelForm | CloudReturn
pure def canReadBrowserForm(flow: BrowserFlow): bool = flow.phase == BrowserBound
pure def readBrowserForm(flow: BrowserFlow, page: StoredPage, hasPhone: bool,
  form: BrowserForm, approve: bool): BrowserFlow =
  if (form == PhoneForm) { ...flow, phase: if (page == ConsentPage) AlreadyVerified else StartingOtp }
  else if (form == CodeForm) { ...flow, phase: if (page == CodePage and hasPhone) VerifyingOtp else BrowserExpired }
  else if (form == CloudReturn) { ...flow, phase: if (page == PhonePage) CheckingIdentity else BrowserExpired }
  else if (form == CancelForm) { ...flow, phase: ConsentDeclined }
  else if (page != ConsentPage or not(hasPhone)) { ...flow, phase: BrowserExpired }
  else if (approve) { phase: CheckingConsentOwner, explicitlyApproved: true }
  else { ...flow, phase: ConsentDeclined }
```

### Only a successful challenge advances phone verification

After the shell checks and normalizes the submitted phone, successful code delivery moves the request to its code page. A rejected code keeps the person on that page. A verified code, returned Cloud session, or existing session must still identify a permitted account before the handler stores consent as the next page.

```quint
pure def canRecordOtpSend(flow: BrowserFlow): bool = flow.phase == StartingOtp
pure def recordOtpSend(flow: BrowserFlow, sent: bool): BrowserFlow =
  { ...flow, phase: if (sent) ShowingCode else ShowingPhone }

pure def canRecordOtpVerification(flow: BrowserFlow): bool = flow.phase == VerifyingOtp
pure def recordOtpVerification(flow: BrowserFlow, verified: bool): BrowserFlow =
  { ...flow, phase: if (verified) CheckingIdentity else RetryingOtp }

type IdentityStatus = IdentityPermitted | IdentityRejected | IdentityUnavailable
pure def canRecordBrowserIdentity(flow: BrowserFlow): bool = flow.phase == CheckingIdentity
pure def recordBrowserIdentity(flow: BrowserFlow, identity: IdentityStatus): BrowserFlow =
  { ...flow, phase: if (identity == IdentityPermitted) ShowingConsent
    else if (identity == IdentityUnavailable) SessionRetry else IdentityDenied }
```

### Explicit approval rechecks the owner and the app's required Cloud authority

When the app uses a browser session, it must still identify the same person and phone. The current phone owner must match the stored account and pass account eligibility. The handler then checks required Cloud authority for the same phone. An unavailable check keeps approval pending for retry. A refusal does not start issuance.

```quint
pure def sessionMatchesConsent(sessionRequired: bool, samePerson: bool, samePhone: bool): bool =
  not(sessionRequired) or (samePerson and samePhone)

type ConsentCheck = CheckAccepted | CheckRejected | CheckUnavailable

pure def canReadConsentOwner(flow: BrowserFlow): bool = flow.phase == CheckingConsentOwner and flow.explicitlyApproved
pure def readConsentOwner(flow: BrowserFlow, verdict: ConsentCheck): BrowserFlow =
  { ...flow, phase: if (verdict == CheckAccepted) CheckingCloudGrant
    else if (verdict == CheckUnavailable) SessionRetry else OwnerChanged }

pure def canReadConsentAuthority(flow: BrowserFlow): bool = flow.phase == CheckingCloudGrant and flow.explicitlyApproved
pure def readConsentAuthority(flow: BrowserFlow, verdict: ConsentCheck): BrowserFlow =
  { ...flow, phase: if (verdict == CheckAccepted) ConsentReady
    else if (verdict == CheckUnavailable) SessionRetry else CloudDenied }

pure def alwaysIssuanceNeedsExplicitConsent(flow: BrowserFlow): bool =
  (flow.phase == CheckingConsentOwner or flow.phase == CheckingCloudGrant or flow.phase == ConsentReady)
    implies flow.explicitlyApproved

pure def stepReadyFollowsAuthority(before: BrowserFlow, via: str, after: BrowserFlow): bool =
  after.phase == ConsentReady implies (before.phase == CheckingCloudGrant and via == "readConsentAuthority")

pure def sometimesReachesConsent(flow: BrowserFlow): bool = flow.phase == ShowingConsent
pure def sometimesApprovesConsent(flow: BrowserFlow): bool = flow.phase == ConsentReady
pure def sometimesDeclinesConsent(flow: BrowserFlow): bool = flow.phase == ConsentDeclined
```
