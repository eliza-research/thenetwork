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

After validating a new authorization request, use its existing site identity if one is available. An unavailable session gives a retry. A retry of the initial session check reopens the same browser-bound request while it still waits for a phone. Without a session, a Cloud-only app sends the person to Cloud and another app asks for a phone. A Cloud return also requires a bound request that is still waiting for a phone.

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

Phone submission starts or restarts verification until the request reaches consent. Only a code page with a stored phone can verify or resend a code. Only a code page can return to the phone page to change the number. Only a consent page with a phone accepts a consent decision. A dedicated cancel form can end a bound request before enrollment starts. An enrollment in progress expires every form. After enrollment, a form must include the new consent proof. A delayed phone proof, browser retry or Cloud response can advance only the same live stored page and phone binding it began with.

The stored request keeps its step as a word: `phone`, `code`, `consent`, `enrolling` or `enrolled`. Each step gives one stored page. The `enrolling` step and any unknown step give the pending enrollment page. Every form on that page expires, and the browser cannot resume it. The router serves six regular form routes: `phone`, `code`, `resend`, `change_phone`, `consent` and `cancel`. The form mapper treats all other inputs as cancel. It never treats a posted form as a Cloud return.

```quint
type StoredPage = PhonePage | CodePage | ConsentPage | SignupEnrollmentPending | EnrolledConsentPage
type BrowserForm = PhoneForm | CodeForm | ResendCodeForm | ChangePhoneForm | ConsentForm | CancelForm | CloudReturn

pure def storedPageOf(stepWord: str): StoredPage =
  if (stepWord == "phone") PhonePage
  else if (stepWord == "code") CodePage
  else if (stepWord == "consent") ConsentPage
  else if (stepWord == "enrolled") EnrolledConsentPage
  else SignupEnrollmentPending

pure def browserFormOf(form: str): BrowserForm =
  if (form == "phone") PhoneForm
  else if (form == "code") CodeForm
  else if (form == "resend") ResendCodeForm
  else if (form == "change_phone") ChangePhoneForm
  else if (form == "consent") ConsentForm
  else CancelForm

pure def lawOnlyThePhoneStepCanResume(stepWord: str): bool =
  (storedPageOf(stepWord) == PhonePage) iff (stepWord == "phone")

pure def lawUnknownStepExpiresEveryForm(stepWord: str): bool =
  (stepWord != "phone" and stepWord != "code" and stepWord != "consent" and stepWord != "enrolled")
    implies storedPageOf(stepWord) == SignupEnrollmentPending

pure def lawPostedRouteIsNeverACloudReturn(form: str): bool = browserFormOf(form) != CloudReturn

pure def canReadBrowserForm(flow: BrowserFlow): bool = flow.phase == BrowserBound
pure def browserEntryMayResume(flow: BrowserFlow, page: StoredPage, hasPhone: bool): bool =
  flow.phase == BrowserBound and page == PhonePage and not(hasPhone)
pure def readBrowserForm(flow: BrowserFlow, page: StoredPage, hasPhone: bool,
  form: BrowserForm, approve: bool): BrowserFlow =
  if (page == SignupEnrollmentPending) { ...flow, phase: BrowserExpired }
  else if (form == PhoneForm) { ...flow, phase: if (page == ConsentPage or page == EnrolledConsentPage) AlreadyVerified else StartingOtp }
  else if (form == CodeForm) { ...flow, phase: if (page == CodePage and hasPhone) VerifyingOtp else BrowserExpired }
  else if (form == ResendCodeForm) { ...flow, phase: if (page == CodePage and hasPhone) StartingOtp else BrowserExpired }
  else if (form == ChangePhoneForm) { ...flow, phase: if (page == CodePage) ShowingPhone else BrowserExpired }
  else if (form == CloudReturn) { ...flow, phase: if (browserEntryMayResume(flow, page, hasPhone)) CheckingIdentity else BrowserExpired }
  else if (form == CancelForm) { ...flow, phase: ConsentDeclined }
  else if ((page != ConsentPage and page != EnrolledConsentPage) or not(hasPhone)) { ...flow, phase: BrowserExpired }
  else if (approve) { phase: CheckingConsentOwner, explicitlyApproved: true }
  else { ...flow, phase: ConsentDeclined }

pure def lawBrowserEntryCannotResumeAProvedPage(flow: BrowserFlow, page: StoredPage, hasPhone: bool): bool =
  (page != PhonePage or hasPhone) implies not(browserEntryMayResume(flow, page, hasPhone))
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

### Optional signup stays inside the verified authorization request

The owner can connect without joining. For a client that supports profile submission and read-back, the verified browser can also open a private signup form in The Network, slop.date or friends.help. The normal consent route stays available when the signup form is unavailable. The form is bound to the exact request and canonical phone owner. A separate checkbox accepts the app's current text consent. The only source of invitation data is the browser form. The member must complete the app's existing eligibility and invitation checks.

The store first reserves the exact pending request for the enrollment attempt. The enrollment operation may bind the request only to the exact eligible same-app member it just created, with a fresh canonical phone-owner check. An interrupted attempt cannot infer success from a later account lookup. The next page requires distinct connector consent tied to the newly bound request, so a previously displayed consent form cannot authorize the new membership. Before saving that approval, the server checks that the canonical owner and that app's active or onboarding membership still qualify.

```quint
pure def browserSignupAppAllowed(app: str, surfaceOffered: bool, canReadMembership: bool, canWriteProfile: bool): bool =
  (app == "ntwrk" or app == "slop" or app == "friends") and surfaceOffered and canReadMembership and canWriteProfile

pure def browserSignupOpenAllowed(flow: BrowserFlow, page: StoredPage, hasPhone: bool, sameSession: bool, appAllowed: bool): bool =
  flow.phase == BrowserBound and page == ConsentPage and hasPhone and sameSession and appAllowed

pure def browserSignupJoinAllowed(openAllowed: bool, exactForm: bool, smsAccepted: bool, currentConsent: bool): bool =
  openAllowed and exactForm and smsAccepted and currentConsent

pure def browserSignupOwnerBindingAllowed(page: StoredPage, createdMember: bool, sameApp: bool,
  sameOrNewOwner: bool, currentVerifiedOwner: bool, eligibleMembership: bool): bool =
  page == SignupEnrollmentPending and createdMember and sameApp and sameOrNewOwner and currentVerifiedOwner and eligibleMembership

pure def browserSignupConsentAllowed(page: StoredPage, exactApproval: bool): bool =
  page != SignupEnrollmentPending and (page != EnrolledConsentPage or exactApproval)

pure def browserSignupMemberAllowed(memberState: str): bool =
  memberState == "active" or memberState == "onboarding"

pure def lawBrowserSignupNeedsTextConsent(openAllowed: bool, exactForm: bool, smsAccepted: bool, currentConsent: bool): bool =
  browserSignupJoinAllowed(openAllowed, exactForm, smsAccepted, currentConsent) implies (smsAccepted and currentConsent)

pure def lawBrowserSignupNeedsFreshApproval(exactApproval: bool): bool =
  browserSignupConsentAllowed(EnrolledConsentPage, exactApproval) implies exactApproval
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
