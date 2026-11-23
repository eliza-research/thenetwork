# Connector authorization pages

This spec owns the view layer of connector authorization: the page that the browser shows for each server reply, the controls on each page, the field errors and the security check. The [connector browser authorization spec](oauthBrowserAuthorization.md) owns the server flow, the stored request and its phases. The [connector grant issuance spec](oauthGrantIssuance.md) owns what happens after an explicit approval. The handler decides each reply. The page shell gives that reply to this machine and renders the view that it selects. The app resolved by the router also owns the [brand](brandIdentity.md) shown on every configured host. Copy, brand colors and logos stay in the component library.

The handler (`packages/mcp/src/handler.ts`) also uses the guards of this machine as gates on its form routes. It makes the page that sent a form from the route and from the stored request. The phone, code and consent forms are only on their own pages. Cancel is on the page of the stored step. A code was sent when the request holds a number. A posted phone form carries the answer to the security check, so the handler solves the check (`solveCheck`) and then verifies the answer. A failed answer is the reply that the check did not pass. Before the route acts, the guard of the form must allow the reply that the form asks for: a code for the phone form, the consent page for the code form, the approval for "Allow", and the refusal for "Cancel" and "Don't allow". Then each reply must pass the same guard before the handler sends it. The Cloud return uses `canReturnFromCloud`. A retry of the initial session check uses `canRetryConnection`. A refused form or reply gets "This page has expired". The checks that the handler makes before it reads the stored request (the origin, the live request and the client) keep their own replies.

## Story: See one clear page at each step of connecting my assistant

> As a person who connects my assistant, I want each page to show only the step that I am on, so that I know what to do next.

### The server reply selects the page view

Each server reply selects exactly one view. A phone page, a code page, a consent page or the signup page can show a form. A message page shows a title, one sentence and, for "Please try again" only, a retry link. Three replies leave this site: the hand-off to Cloud sign-in, the return to the assistant with a code, and the return to the assistant with a refusal. A field error is part of the reply and shows only on the page of its field. The phone page shows a security check only when the site has one.

```quint
type AuthView =
  Opening | PhoneView | CodeView | ConsentView | ConsentRetryView | CloudView | ApprovedView | DeclinedView |
  LinkInvalidView | TooManyTriesView | NotAvailableView | PageExpiredView | AlreadySignedInView |
  CheckNumberView | ConnectAgainView | PleaseRetryView | SignInUnavailableView | NotAllowedView | SignupView
type Reply =
  ReplyPhone | ReplyCode | ReplyConsent | ReplyConsentRetry | ReplyCloud | ReplyApproved | ReplyDeclined |
  ReplyCheckFailed | ReplyPhoneInvalid | ReplyTooManyCodes | ReplySendUnavailable | ReplyCodeRejected |
  ReplyLinkInvalid | ReplyTooManyTries | ReplyNotAvailable | ReplyExpired | ReplyAlreadySignedIn |
  ReplyCheckNumber | ReplyConnectAgain | ReplyRetryLater | ReplySignInUnavailable | ReplyNotAllowed |
  ReplySignupForm | ReplySignupRefused
type FieldError = NoFieldError | CheckNotPassed | PhoneNotValid | CodesRateLimited | CodeSendFailed | CodeNotAccepted
type SecurityCheck = CheckOff | CheckWaiting | CheckSolved | CheckExpired
type AuthPage = {
  view: AuthView,
  fieldError: FieldError,
  securityCheck: SecurityCheck,
  turnstileOn: bool,
  codeSent: bool,
  consentSeen: bool,
  approved: bool,
}
type Offers = {
  sendCode: bool, continueCode: bool, allow: bool, retryAllow: bool, dontAllow: bool, cancel: bool, retryLink: bool,
  finishSignup: bool, backToConsent: bool,
}

pure val initial: AuthPage = {
  view: Opening, fieldError: NoFieldError, securityCheck: CheckOff, turnstileOn: false,
  codeSent: false, consentSeen: false, approved: false,
}

pure def viewFor(reply: Reply): AuthView =
  if (reply == ReplyPhone or reply == ReplyCheckFailed or reply == ReplyPhoneInvalid
      or reply == ReplyTooManyCodes or reply == ReplySendUnavailable) PhoneView
  else if (reply == ReplyCode or reply == ReplyCodeRejected) CodeView
  else if (reply == ReplyConsent) ConsentView
  else if (reply == ReplyConsentRetry) ConsentRetryView
  else if (reply == ReplyCloud) CloudView
  else if (reply == ReplyApproved) ApprovedView
  else if (reply == ReplyDeclined) DeclinedView
  else if (reply == ReplyLinkInvalid) LinkInvalidView
  else if (reply == ReplyTooManyTries) TooManyTriesView
  else if (reply == ReplyNotAvailable) NotAvailableView
  else if (reply == ReplyExpired) PageExpiredView
  else if (reply == ReplyAlreadySignedIn) AlreadySignedInView
  else if (reply == ReplyCheckNumber) CheckNumberView
  else if (reply == ReplyConnectAgain) ConnectAgainView
  else if (reply == ReplyRetryLater) PleaseRetryView
  else if (reply == ReplySignInUnavailable) SignInUnavailableView
  else if (reply == ReplySignupForm or reply == ReplySignupRefused) SignupView
  else NotAllowedView

pure def errorFor(reply: Reply): FieldError =
  if (reply == ReplyCheckFailed) CheckNotPassed
  else if (reply == ReplyPhoneInvalid) PhoneNotValid
  else if (reply == ReplyTooManyCodes) CodesRateLimited
  else if (reply == ReplySendUnavailable) CodeSendFailed
  else if (reply == ReplyCodeRejected) CodeNotAccepted
  else NoFieldError

pure def checkFor(view: AuthView, turnstileOn: bool): SecurityCheck =
  if (view == PhoneView and turnstileOn) CheckWaiting else CheckOff

pure def isConsentView(view: AuthView): bool = view == ConsentView or view == ConsentRetryView

pure def isMessageView(view: AuthView): bool =
  view == LinkInvalidView or view == TooManyTriesView or view == NotAvailableView or view == PageExpiredView
    or view == AlreadySignedInView or view == CheckNumberView or view == ConnectAgainView
    or view == PleaseRetryView or view == SignInUnavailableView or view == NotAllowedView

pure def isFinal(view: AuthView): bool =
  view == ApprovedView or view == DeclinedView or (isMessageView(view) and view != PleaseRetryView)

pure def rendersPage(view: AuthView): bool =
  not(view == Opening or view == CloudView or view == ApprovedView or view == DeclinedView)

pure def showsPhoneField(view: AuthView): bool = view == PhoneView
pure def showsCodeField(view: AuthView): bool = view == CodeView

pure val noOffers: Offers = {
  sendCode: false, continueCode: false, allow: false, retryAllow: false, dontAllow: false, cancel: false, retryLink: false,
  finishSignup: false, backToConsent: false,
}

pure def offersFor(view: AuthView): Offers = {
  sendCode: view == PhoneView,
  continueCode: view == CodeView,
  allow: view == ConsentView,
  retryAllow: view == ConsentRetryView,
  dontAllow: isConsentView(view),
  cancel: view == PhoneView or view == CodeView,
  retryLink: view == PleaseRetryView,
  finishSignup: view == SignupView,
  backToConsent: view == SignupView,
}

pure def showReply(reply: Reply, page: AuthPage): AuthPage =
  val shown = viewFor(reply)
  {
    view: shown,
    fieldError: errorFor(reply),
    securityCheck: checkFor(shown, page.turnstileOn),
    turnstileOn: page.turnstileOn,
    codeSent: page.codeSent or reply == ReplyCode,
    consentSeen: page.consentSeen or isConsentView(shown),
    approved: page.approved or reply == ReplyApproved,
  }
```

### Opening the connection link shows sign-in, consent, Cloud sign-in or a message

The connection link from the assistant opens one of these: the phone page, the consent page for an existing session, the hand-off to Cloud sign-in, or a message. The messages are "This link does not work", "Too many tries", "Not available", "Please try again" and "Sign-in unavailable". An account that cannot use the connection gets "Not available". The site tells the page whether it has a security check.

```quint
pure def isOpenReply(reply: Reply): bool =
  reply == ReplyPhone or reply == ReplyConsent or reply == ReplyCloud or reply == ReplyRetryLater
    or reply == ReplyLinkInvalid or reply == ReplyTooManyTries or reply == ReplyNotAvailable
    or reply == ReplySignInUnavailable

pure def canOpenPage(page: AuthPage, reply: Reply): bool = page.view == Opening and isOpenReply(reply)
pure def openPage(page: AuthPage, reply: Reply, turnstileOn: bool): AuthPage =
  showReply(reply, { ...page, turnstileOn: turnstileOn })
```

### The return from Cloud sign-in and the retry link resume the same request

After Cloud sign-in, the browser comes back to the same request. Its retry uses the same return address. A retry of the initial session check uses a separate address for the same request. A current session opens consent. A signed-out person goes to the phone page or the app's required Cloud sign-in. A failed check leaves the same retry link available. An expired or unbound request gets "This page has expired".

```quint
pure def isCloudReturnReply(reply: Reply): bool =
  reply == ReplyConsent or reply == ReplyRetryLater or reply == ReplyExpired
    or reply == ReplyLinkInvalid or reply == ReplyConnectAgain

pure def canReturnFromCloud(page: AuthPage, reply: Reply): bool = page.view == CloudView and isCloudReturnReply(reply)
pure def returnFromCloud(page: AuthPage, reply: Reply): AuthPage = showReply(reply, page)

pure def canRetryConnection(page: AuthPage, reply: Reply): bool =
  page.view == PleaseRetryView and (isOpenReply(reply) or isCloudReturnReply(reply))
pure def retryConnection(page: AuthPage, reply: Reply): AuthPage = showReply(reply, page)
```

### A posted form names the page that sent it

The handler makes the page that sent a form from the word of the stored step or of the form route. The `phone` step and route give the phone page. The `code` step and route give the code page. The `consent`, `enrolling` and `enrolled` steps and the `consent` route give the consent page. Any other word gives "This page has expired", so no form guard allows a reply from it.

```quint
pure def storedStepView(stepWord: str): AuthView =
  if (stepWord == "phone") PhoneView
  else if (stepWord == "code") CodeView
  else if (stepWord == "consent" or stepWord == "enrolling" or stepWord == "enrolled") ConsentView
  else PageExpiredView

pure def lawStoredStepShowsAFormPageOrExpires(stepWord: str): bool =
  val v = storedStepView(stepWord)
  v == PhoneView or v == CodeView or v == ConsentView or v == PageExpiredView

pure def lawUnknownStepShowsNoForm(stepWord: str): bool =
  (stepWord != "phone" and stepWord != "code" and stepWord != "consent" and stepWord != "enrolling" and stepWord != "enrolled")
    implies offersFor(storedStepView(stepWord)) == noOffers
```

## Story: Prove my phone on this page

> As a person who connects my assistant, I want to confirm my own phone on the site's page, so that the assistant never sees my code.

### The phone page shows a security check only when the site has one

When the site has a security check, the phone page shows it in the waiting state. The person solves it. A solved check can expire, and then the person must solve it again. Every new phone page starts a new check. No other page shows a check.

```quint
pure def canSolveCheck(page: AuthPage): bool =
  page.view == PhoneView and (page.securityCheck == CheckWaiting or page.securityCheck == CheckExpired)
pure def solveCheck(page: AuthPage): AuthPage = { ...page, securityCheck: CheckSolved }

pure def canExpireCheck(page: AuthPage): bool = page.view == PhoneView and page.securityCheck == CheckSolved
pure def expireCheck(page: AuthPage): AuthPage = { ...page, securityCheck: CheckExpired }

pure def alwaysSecurityCheckOnlyOnPhonePage(page: AuthPage): bool =
  (page.securityCheck != CheckOff) iff (page.view == PhoneView and page.turnstileOn)
```

### The phone page sends a code or tells why it did not

The person can send the phone number only when the check is off or solved. A sent code opens the code page. A failed check, a number that is not a US or Canada number, too many codes, or a send failure shows the phone page again with that field error. A failed check can occur only on a site with a check. When the code is not sent, a rate limit gives "too many codes" and any other cause gives the send failure. The handler gives the phone page its reply, never a sentence, and the page shows the words of the field error. The other replies are "This page has expired", "Already signed in", "Not allowed" and "Not available".

```quint
pure def codeSendFailureReply(rateLimited: bool): Reply =
  if (rateLimited) ReplyTooManyCodes else ReplySendUnavailable

pure def isPhoneFieldReply(reply: Reply): bool =
  reply == ReplyCheckFailed or reply == ReplyPhoneInvalid or reply == ReplyTooManyCodes or reply == ReplySendUnavailable

pure def lawCodeSendFailureStaysOnThePhonePage(rateLimited: bool): bool =
  val reply = codeSendFailureReply(rateLimited)
  isPhoneFieldReply(reply) and viewFor(reply) == PhoneView and errorFor(reply) != NoFieldError

pure def lawPhoneFieldReplyShowsThePhonePage(reply: Reply): bool =
  isPhoneFieldReply(reply) implies (viewFor(reply) == PhoneView and errorFor(reply) != NoFieldError)

pure def isPhoneReply(reply: Reply): bool =
  reply == ReplyCode or reply == ReplyCheckFailed or reply == ReplyPhoneInvalid or reply == ReplyTooManyCodes
    or reply == ReplySendUnavailable or reply == ReplyExpired or reply == ReplyAlreadySignedIn
    or reply == ReplyNotAllowed or reply == ReplyNotAvailable

pure def canSubmitPhone(page: AuthPage, reply: Reply): bool =
  page.view == PhoneView
    and (page.securityCheck == CheckOff or page.securityCheck == CheckSolved)
    and isPhoneReply(reply)
    and (reply == ReplyCheckFailed implies page.turnstileOn)
pure def submitPhone(page: AuthPage, reply: Reply): AuthPage = showReply(reply, page)

pure def stepPhoneSubmitNeedsSolvedCheck(before: AuthPage, via: str, after: AuthPage): bool =
  via == "submitPhone" implies (before.securityCheck == CheckOff or before.securityCheck == CheckSolved)

pure def alwaysFieldErrorStaysOnItsPage(page: AuthPage): bool =
  (page.fieldError == CodeNotAccepted implies page.view == CodeView)
    and ((page.fieldError == CheckNotPassed or page.fieldError == PhoneNotValid
          or page.fieldError == CodesRateLimited or page.fieldError == CodeSendFailed) implies page.view == PhoneView)
    and (page.fieldError == CheckNotPassed implies page.turnstileOn)
```

### The code page appears only after this request sent a code

Only a sent code opens the code page, and only from the phone page. The page shows the last four digits of the number. A wrong code shows the code page again with a field error. A correct code opens the consent page. A number that needs a check gets "We need to check this number". The other replies are "This page has expired", "Not allowed" and "Not available".

```quint
pure def isCodeReply(reply: Reply): bool =
  reply == ReplyConsent or reply == ReplyCodeRejected or reply == ReplyCheckNumber
    or reply == ReplyExpired or reply == ReplyNotAllowed or reply == ReplyNotAvailable

pure def canSubmitCode(page: AuthPage, reply: Reply): bool = page.view == CodeView and page.codeSent and isCodeReply(reply)
pure def submitCode(page: AuthPage, reply: Reply): AuthPage = showReply(reply, page)

pure def alwaysCodePageFollowsSentCode(page: AuthPage): bool = showsCodeField(page.view) implies page.codeSent

pure def stepCodePageOnlyAfterPhoneSubmit(before: AuthPage, via: str, after: AuthPage): bool =
  (after.view == CodeView and before.view != CodeView) implies (via == "submitPhone" and before.view == PhoneView)
```

## Story: Decide what my assistant can do

> As a person who connects my assistant, I want to see who asks for access and what it can do, so that I give access only on purpose.

### The consent page names the client as its claim and lists every scope

Both consent pages show the client's name, or "An unnamed assistant" when it gave none, and say that the name is the client's own claim. They show the host that the browser returns to and list every requested scope. Only the retry consent page shows the notice that the check is not available now. No other page names a client.

```quint
type ClientLabel = ProvidedName | UnnamedAssistant | NoClientShown
type ConsentParts = { client: ClientLabel, claimNote: bool, returnHost: bool, scopeList: bool, unavailableNotice: bool }

pure def consentParts(view: AuthView, clientNamed: bool): ConsentParts =
  if (isConsentView(view))
    { client: if (clientNamed) ProvidedName else UnnamedAssistant, claimNote: true, returnHost: true,
      scopeList: true, unavailableNotice: view == ConsentRetryView }
  else
    { client: NoClientShown, claimNote: false, returnHost: false, scopeList: false, unavailableNotice: false }

pure def lawConsentNamesClientAndScopes(view: AuthView, clientNamed: bool): bool =
  val parts = consentParts(view, clientNamed)
  isConsentView(view) implies (parts.client != NoClientShown and parts.claimNote and parts.returnHost and parts.scopeList)

pure def lawOnlyConsentPagesNameAClient(view: AuthView, clientNamed: bool): bool =
  not(isConsentView(view)) implies consentParts(view, clientNamed).client == NoClientShown
```

### A verified person can choose a separate signup step during connector authorization

The ordinary consent page offers "Finish signup" only when the server confirms signup is available for this request. The choice opens a transient same-site form. The person enters their first name, birthday and home city, supplies an invitation when they have one or the app requires it, and accepts the app's current text-message consent. The form includes that consent version and the browser's signup proof. It does not ask for a phone number or code. A person can return to connector consent without submitting signup fields. A successful signup returns to the separate connector consent page with a signup confirmation. Only the ordinary "Allow" action grants assistant access.

```quint
pure def offersSignupConfirmation(view: AuthView, signupAvailable: bool): bool =
  view == ConsentView and signupAvailable

pure def showsSignupConfirmation(view: AuthView, signupSaved: bool): bool =
  view == ConsentView and signupSaved

pure def lawConsentRetryHasNoSignup(signupAvailable: bool): bool =
  not(offersSignupConfirmation(ConsentRetryView, signupAvailable))

pure def lawSignupNoticeRequiresSave(view: AuthView): bool =
  not(showsSignupConfirmation(view, false))
```

### The signup page is a step of the same request

"Finish signup" on the consent page opens the signup page of the same request. The signup page shows no phone field and no code field. It offers "Finish signup" and "Back to connection" and nothing else. "Finish signup" goes back to the consent page when the server saves the signup. When the server refuses the form, the signup page shows again with the reason. "Back to connection" goes back to the consent page and saves nothing. A request that is no longer live gets "This page has expired". The other replies are "Not allowed" and "Not available". The signup page never sends the approval and never returns a code to the assistant. Only a consent page opens the signup page, so the signup page always follows a consent page.

```quint
pure def isSignupOpenReply(reply: Reply): bool =
  reply == ReplySignupForm or reply == ReplyExpired or reply == ReplyNotAllowed or reply == ReplyNotAvailable

pure def isSignupReply(reply: Reply): bool =
  reply == ReplyConsent or reply == ReplySignupRefused or reply == ReplyExpired
    or reply == ReplyNotAllowed or reply == ReplyNotAvailable

pure def isLeaveSignupReply(reply: Reply): bool =
  reply == ReplyConsent or reply == ReplyExpired or reply == ReplyNotAllowed or reply == ReplyNotAvailable

pure def canOpenSignup(page: AuthPage, reply: Reply): bool = page.view == ConsentView and isSignupOpenReply(reply)
pure def openSignup(page: AuthPage, reply: Reply): AuthPage = showReply(reply, page)

pure def canSubmitSignup(page: AuthPage, reply: Reply): bool = page.view == SignupView and isSignupReply(reply)
pure def submitSignup(page: AuthPage, reply: Reply): AuthPage = showReply(reply, page)

pure def canLeaveSignup(page: AuthPage, reply: Reply): bool = page.view == SignupView and isLeaveSignupReply(reply)
pure def leaveSignup(page: AuthPage, reply: Reply): AuthPage = showReply(reply, page)

pure def alwaysSignupFollowsConsent(page: AuthPage): bool = page.view == SignupView implies page.consentSeen

pure def lawSignupPageShowsNoCredentialField(view: AuthView): bool =
  view == SignupView implies
    (not(showsPhoneField(view)) and not(showsCodeField(view))
      and offersFor(view) == { ...noOffers, finishSignup: true, backToConsent: true })

pure def stepSignupNeverApproves(before: AuthPage, via: str, after: AuthPage): bool =
  (via == "openSignup" or via == "submitSignup" or via == "leaveSignup") implies after.approved == before.approved

pure def sometimesSignupShown(page: AuthPage): bool = page.view == SignupView
```

### A new person sees Finish signup as the main action on the consent page

When the server offers signup on the consent page, the signed-in phone has no membership in this app yet, or it has only an invitation. Then "Finish signup" is the main action and it comes first. "Allow" and "Don't allow" come after it and have less emphasis, so that a new person does not give access before signup by mistake. When the server does not offer signup, "Allow" is the main action. On the retry consent page, "Try again" is the main action. The order does not change what each action does: only "Allow" or "Try again" sends the approval. After a successful signup the server does not offer signup again, so "Allow" is the main action on the confirmed consent page. A page that is not a consent page has no main consent action.

```quint
type ConsentPrimary = PrimaryFinishSignup | PrimaryAllow | PrimaryTryAgain | NoConsentPrimary

pure def consentPrimaryAction(view: AuthView, signupAvailable: bool): ConsentPrimary =
  if (offersSignupConfirmation(view, signupAvailable)) PrimaryFinishSignup
  else if (view == ConsentView) PrimaryAllow
  else if (view == ConsentRetryView) PrimaryTryAgain
  else NoConsentPrimary

pure def lawNewPersonSeesFinishSignupFirst(view: AuthView, signupAvailable: bool): bool =
  offersSignupConfirmation(view, signupAvailable) implies consentPrimaryAction(view, signupAvailable) == PrimaryFinishSignup

pure def lawMemberConsentKeepsAllowFirst(view: AuthView): bool =
  (view == ConsentView) implies consentPrimaryAction(view, false) == PrimaryAllow

pure def lawRetryConsentKeepsTryAgainFirst(signupAvailable: bool): bool =
  consentPrimaryAction(ConsentRetryView, signupAvailable) == PrimaryTryAgain

pure def lawOnlyConsentPagesHaveAPrimaryAction(view: AuthView, signupAvailable: bool): bool =
  not(isConsentView(view)) implies consentPrimaryAction(view, signupAvailable) == NoConsentPrimary
```

### The signup form shows the draft that the person approved in the agent

An assistant that has a live grant with profile write access can save a signup draft before the person signs up (the [MCP signup draft spec](mcpSignupDraft.md)). The draft holds only the first name and the home city that the person approved in the agent. It never holds a phone number, a code or an age. When the person opens "Finish signup", the form shows the fields of that draft, so that the person does not type them again. The person can change each field. The person always types the birthday, because no tool takes an age or a birth date. The text consent box is never ticked before the person ticks it. "Finish signup" is the one main action of the form. A short note asks the person to check the details from the agent. The note shows only when the form shows a draft and the server did not refuse the form.

The form shows a draft only when all of these conditions are true: the grant that saved the draft has the same client, the same app and the same phone as this authorization request, the draft is not used and not expired, and the age guard of the phone allows the signup. The first form that shows the draft uses it, so a reload, another request or another client gets an empty form. A wrong, used, expired or other-app draft gives an empty form and no error. When the server refuses a submitted form, the form shows again with the first name and the home city that the person sent, and the birthday field and the consent box are empty. The lowest stated age still applies when the person submits: a lower age that the phone already has is the age that counts, and an age below 13 is refused.

When the assistant has no grant before the browser step (a connector that the person adds for the first time), there is no draft and the form is empty.

```quint
type SignupDraftBinding = { client: str, app: str, phone: str, used: bool, expiresAt: int }
type SignupPrefillRequest = { client: str, app: str, phone: str, asOf: int, ageAllowed: bool }

pure def signupPrefillAllowed(d: SignupDraftBinding, r: SignupPrefillRequest): bool =
  not(d.used) and d.client == r.client and d.app == r.app and d.phone == r.phone and r.asOf < d.expiresAt and r.ageAllowed

pure def useSignupPrefill(d: SignupDraftBinding, r: SignupPrefillRequest): SignupDraftBinding =
  if (signupPrefillAllowed(d, r)) { ...d, used: true } else d

pure def signupConsentStartsTicked(prefilled: bool): bool = false

pure def signupDraftNoteShown(prefilled: bool, refused: bool): bool = prefilled and not(refused)

pure def lawPrefillOnlyForItsClientAppAndPhone(d: SignupDraftBinding, r: SignupPrefillRequest): bool =
  signupPrefillAllowed(d, r) implies (d.client == r.client and d.app == r.app and d.phone == r.phone)

pure def lawPrefillAtMostOnce(d: SignupDraftBinding, r: SignupPrefillRequest, later: SignupPrefillRequest): bool =
  signupPrefillAllowed(d, r) implies not(signupPrefillAllowed(useSignupPrefill(d, r), later))

pure def lawExpiredPrefillIsEmpty(d: SignupDraftBinding, r: SignupPrefillRequest): bool =
  (r.asOf >= d.expiresAt) implies not(signupPrefillAllowed(d, r))

pure def lawAgeGuardRefusesPrefill(d: SignupDraftBinding, r: SignupPrefillRequest): bool =
  not(r.ageAllowed) implies not(signupPrefillAllowed(d, r))

pure def lawConsentNeverPreTicked(prefilled: bool): bool = not(signupConsentStartsTicked(prefilled))

pure def lawRefusedSignupShowsNoDraftNote(prefilled: bool): bool = not(signupDraftNoteShown(prefilled, true))

pure val dValues = Set(
  { client: "c1", app: "friends", phone: "+15550100", used: false, expiresAt: 10 },
  { client: "c1", app: "friends", phone: "+15550100", used: true, expiresAt: 10 },
  { client: "c2", app: "friends", phone: "+15550100", used: false, expiresAt: 10 },
  { client: "c1", app: "ntwrk", phone: "+15550101", used: false, expiresAt: 5 })

pure val rValues = Set(
  { client: "c1", app: "friends", phone: "+15550100", asOf: 1, ageAllowed: true },
  { client: "c1", app: "friends", phone: "+15550100", asOf: 1, ageAllowed: false },
  { client: "c1", app: "friends", phone: "+15550100", asOf: 10, ageAllowed: true },
  { client: "c2", app: "friends", phone: "+15550100", asOf: 1, ageAllowed: true },
  { client: "c1", app: "ntwrk", phone: "+15550101", asOf: 1, ageAllowed: true },
  { client: "c1", app: "friends", phone: "+15550101", asOf: 1, ageAllowed: true })

pure val laterValues = rValues
```

### The signup form takes the birthday and counts the age on the Clock date

The signup form asks for the birthday (the label is "Birthday"), not for the age. The person types it in the browser as a date (`yyyy-mm-dd`). The form never shows a birthday before the person types it, and it never shows the sent birthday again after the server refuses the form. A hint below the field tells the person that a member under 18 is never matched for dates or for work and that today nobody under 18 is introduced to anyone. It also tells the person that friendship is the only kind of introduction that can open to people under 18, only with people within 2 years of their own age. The hint does not promise an introduction.

The handler takes the year, the month and the day from the sent text, and it takes the date of today from the platform Clock. The date of today is the calendar date in the latest time zone (UTC-12), so the form never counts a person older than the calendar where the person is. The birthday is refused with an error on the birthday field when the date is missing, when the text is not `yyyy-mm-dd`, when the date does not exist (such as February 30, or February 29 in a year that is not a leap year), when the date is after today, or when the age on today's date is more than 120. The age on a date is the number of full years since the birthday: before the birthday of this year, it is one year less than the difference of the years. A person born on February 29 becomes one year older on March 1 in a year that is not a leap year. The handler gives that age to the join step. When the effective age is below 13, the join step refuses enrollment and retains the numeric age under the existing [site enrollment rule](siteEnrollment.md#the-effective-age-controls-the-result-of-a-new-or-repeated-join). The refusal stores no membership, submitted profile details, birthday or private eligibility date. For a member who is 13 through 17, the handler gives the join step the initial age and the private date they will turn 18 at the start of the UTC-12 day. The join step never stores the typed birthday. A February 29 birthday reaches adult eligibility on March 1 when the eighteenth year is not a leap year.

```quint
type CalendarDate = { year: int, month: int, day: int }

pure def isLeapYear(year: int): bool =
  year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)

pure def daysInMonth(year: int, month: int): int =
  if (month == 2) (if (isLeapYear(year)) 29 else 28)
  else if (month == 4 or month == 6 or month == 9 or month == 11) 30
  else 31

pure def calendarDateExists(date: CalendarDate): bool =
  date.year >= 1 and date.year <= 9999 and date.month >= 1 and date.month <= 12 and date.day >= 1 and date.day <= daysInMonth(date.year, date.month)

pure def dateBefore(first: CalendarDate, second: CalendarDate): bool =
  first.year < second.year or (first.year == second.year and (first.month < second.month or (first.month == second.month and first.day < second.day)))

pure def birthdayNotYetThisYear(birth: CalendarDate, today: CalendarDate): bool =
  today.month < birth.month or (today.month == birth.month and today.day < birth.day)

pure def ageOnDate(birth: CalendarDate, today: CalendarDate): int =
  today.year - birth.year - (if (birthdayNotYetThisYear(birth, today)) 1 else 0)

pure def birthdateAccepted(birth: CalendarDate, today: CalendarDate): bool =
  calendarDateExists(birth) and calendarDateExists(today) and not(dateBefore(today, birth)) and ageOnDate(birth, today) <= 120

pure def signupClockDay(ms: int): int =
  if (ms >= 43200000) (ms - 43200000) / 86400000 else 0

pure def calendarDateOfDay(epochDay: int): CalendarDate =
  val z = (if (epochDay >= 0) epochDay else 0) + 719468
  val era = z / 146097
  val doe = z - era * 146097
  val yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
  val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
  val mp = (5 * doy + 2) / 153
  val month = if (mp < 10) mp + 3 else mp - 9
  { year: yoe + era * 400 + (if (month <= 2) 1 else 0), month: month, day: doy - (153 * mp + 2) / 5 + 1 }

pure def signupAdultDate(birth: CalendarDate): CalendarDate =
  val year = birth.year + 18
  if (birth.month == 2 and birth.day == 29 and not(isLeapYear(year)))
    { year: year, month: 3, day: 1 }
  else { year: year, month: birth.month, day: birth.day }

pure def lawAdultSignupDateCountsEighteen(birth: CalendarDate): bool =
  calendarDateExists(birth) implies ageOnDate(birth, signupAdultDate(birth)) == 18

pure def lawBirthdayNotYetGivesOneYearLess(birth: CalendarDate, today: CalendarDate): bool =
  birthdayNotYetThisYear(birth, today) implies ageOnDate(birth, today) == today.year - birth.year - 1

pure def lawBirthdayReachedGivesFullYears(birth: CalendarDate, today: CalendarDate): bool =
  not(birthdayNotYetThisYear(birth, today)) implies ageOnDate(birth, today) == today.year - birth.year

pure def lawFutureBirthdateRefused(birth: CalendarDate, today: CalendarDate): bool =
  dateBefore(today, birth) implies not(birthdateAccepted(birth, today))

pure def lawImpossibleBirthdateRefused(birth: CalendarDate, today: CalendarDate): bool =
  not(calendarDateExists(birth)) implies not(birthdateAccepted(birth, today))

pure def lawAcceptedAgeIsBetweenZeroAnd120(birth: CalendarDate, today: CalendarDate): bool =
  birthdateAccepted(birth, today) implies (ageOnDate(birth, today) >= 0 and ageOnDate(birth, today) <= 120)

pure def lawLeapDayOnlyInLeapYears(year: int): bool =
  (year >= 1 and year <= 9999) implies (calendarDateExists({ year: year, month: 2, day: 29 }) iff isLeapYear(year))

pure def lawLeapDayBirthdayCountsFromMarchFirst(year: int): bool =
  ageOnDate({ year: year, month: 2, day: 29 }, { year: year + 1, month: 2, day: 28 }) == 0 and
  ageOnDate({ year: year, month: 2, day: 29 }, { year: year + 1, month: 3, day: 1 }) == 1

pure val birthValues = Set(
  { year: 2010, month: 6, day: 15 },
  { year: 2012, month: 2, day: 29 },
  { year: 2013, month: 2, day: 29 },
  { year: 2013, month: 11, day: 23 },
  { year: 2026, month: 12, day: 1 },
  { year: 1900, month: 1, day: 1 },
  { year: 2000, month: 4, day: 31 },
  { year: 2000, month: 13, day: 1 })

pure val todayValues = Set(
  { year: 2026, month: 11, day: 22 },
  { year: 2026, month: 2, day: 28 },
  { year: 2025, month: 3, day: 1 },
  { year: 2024, month: 2, day: 29 })

pure val yearValues = Set(1900, 2000, 2023, 2024, 2100)

pure val epochDayValues = Set(0, 59, 11016, 20414)

pure val msValues = Set(0, 43199999, 43200000, 1763812800000)

pure val dateValues = birthValues

pure val firstValues = birthValues

pure val secondValues = todayValues
```

### Each scope shows as one short sentence, never as its scope name

The scope list shows each requested scope as one sentence that tells what the assistant can do, in the order of the request. Saved-profile reads must be requested explicitly. The default connection scopes do not include them. The page never shows the scope name of the server.

```quint
type Scope = AppsRead | MembershipRead | ProfileWrite | ProfileRead

pure val defaultScopes: List[Scope] = List(AppsRead, MembershipRead, ProfileWrite)
pure val scopes: List[Scope] = List(AppsRead, MembershipRead, ProfileWrite, ProfileRead)

pure def scopeName(scope: Scope): str =
  if (scope == AppsRead) "apps:read"
  else if (scope == MembershipRead) "membership:read"
  else if (scope == ProfileRead) "profile:read"
  else "profile:write"

pure def scopeText(scope: Scope): str =
  if (scope == AppsRead) "See which Network apps are available"
  else if (scope == MembershipRead) "Read your membership status and new updates"
  else if (scope == ProfileRead) "Read the profile you saved for this app"
  else "Save your profile and prepare signup details"

pure def lawScopeTextIsNotTheScopeName(scope: Scope): bool = scopeText(scope) != scopeName(scope)
```

### Only Allow on a consent page returns a code to the assistant

"Allow", or "Try again" on the retry consent page, sends the approval. A granted approval returns the browser to the assistant with a code. A check that is not available now shows the retry consent page. A changed account or a refused authority gets "Connect again". The other replies are "This page has expired", "Not allowed" and "Not available". A consent page appears only after the site knows the person: an existing session when the link opens, the return from Cloud sign-in or its retry, or a correct code. A phone number alone never opens a consent page.

```quint
pure def isApproveReply(reply: Reply): bool =
  reply == ReplyApproved or reply == ReplyConsentRetry or reply == ReplyConnectAgain
    or reply == ReplyExpired or reply == ReplyNotAllowed or reply == ReplyNotAvailable

pure def canApprove(page: AuthPage, reply: Reply): bool = isConsentView(page.view) and isApproveReply(reply)
pure def approve(page: AuthPage, reply: Reply): AuthPage = showReply(reply, page)

pure def alwaysConsentPageIsRecorded(page: AuthPage): bool = isConsentView(page.view) implies page.consentSeen

pure def alwaysApprovalFollowsConsent(page: AuthPage): bool =
  (page.approved iff page.view == ApprovedView) and (page.approved implies page.consentSeen)

pure def stepApprovalOnlyByAllow(before: AuthPage, via: str, after: AuthPage): bool =
  (after.view == ApprovedView and before.view != ApprovedView) implies (via == "approve" and isConsentView(before.view))

pure def stepConsentNeedsKnownPerson(before: AuthPage, via: str, after: AuthPage): bool =
  (isConsentView(after.view) and not(isConsentView(before.view))) implies
    ((via == "openPage" and before.view == Opening)
      or (via == "returnFromCloud" and before.view == CloudView)
      or (via == "retryConnection" and before.view == PleaseRetryView)
      or (via == "submitCode" and before.view == CodeView)
      or ((via == "submitSignup" or via == "leaveSignup") and before.view == SignupView and before.consentSeen))
```

### Cancel or Don't allow returns to the assistant with a refusal

"Cancel" on the phone page and the code page, and "Don't allow" on both consent pages, end the request. The browser returns to the assistant with a refusal. A request that is no longer live gets "This page has expired". The other replies are "Not allowed" and "Not available".

```quint
pure def isCancelReply(reply: Reply): bool =
  reply == ReplyDeclined or reply == ReplyExpired or reply == ReplyNotAllowed or reply == ReplyNotAvailable

pure def canCancelRequest(page: AuthPage, reply: Reply): bool =
  (offersFor(page.view).cancel or offersFor(page.view).dontAllow) and isCancelReply(reply)
pure def cancelRequest(page: AuthPage, reply: Reply): AuthPage = showReply(reply, page)
```

## Story: Understand a page that stops the connection

> As a person who connects my assistant, I want a page that stops the connection to tell me what to do, so that I do not give my phone or code to the wrong page.

### A message page shows no credential field and at most a retry link

No message page shows a phone field or a code field. Only "Please try again" offers a link, and the link retries the same request. A final view does not change.

```quint
pure def lawMessagePagesShowNoCredentialField(view: AuthView): bool =
  isMessageView(view) implies
    (not(showsPhoneField(view)) and not(showsCodeField(view))
      and offersFor(view) == { ...noOffers, retryLink: view == PleaseRetryView })

pure def stepFinalViewsStay(before: AuthPage, after: AuthPage): bool =
  isFinal(before.view) implies after.view == before.view
```

### Every page shows the brand mark and the legal links

Each page that this site renders shows the app's brand mark, which links to the home page, and the Privacy and Terms links. The hand-off to Cloud and the two returns to the assistant render no page.

```quint
type PageChrome = { brandMark: bool, legalLinks: bool }

pure def chromeFor(view: AuthView): PageChrome = { brandMark: rendersPage(view), legalLinks: rendersPage(view) }

pure def lawEveryPageShowsBrandAndLegalLinks(view: AuthView): bool =
  rendersPage(view) implies (chromeFor(view).brandMark and chromeFor(view).legalLinks)
```

### Each page and each outcome can occur

A person can reach each page, each field error, an expired check and each return to the assistant.

```quint
pure def sometimesApproved(page: AuthPage): bool = page.view == ApprovedView
pure def sometimesDeclined(page: AuthPage): bool = page.view == DeclinedView
pure def sometimesConsentRetry(page: AuthPage): bool = page.view == ConsentRetryView
pure def sometimesCloudSignIn(page: AuthPage): bool = page.view == CloudView
pure def sometimesCodeRejected(page: AuthPage): bool = page.view == CodeView and page.fieldError == CodeNotAccepted
pure def sometimesCheckRejected(page: AuthPage): bool = page.view == PhoneView and page.fieldError == CheckNotPassed
pure def sometimesCheckExpired(page: AuthPage): bool = page.securityCheck == CheckExpired
pure def sometimesTooManyCodes(page: AuthPage): bool = page.fieldError == CodesRateLimited
pure def sometimesPhoneRejected(page: AuthPage): bool = page.fieldError == PhoneNotValid
pure def sometimesSendFailed(page: AuthPage): bool = page.fieldError == CodeSendFailed
pure def sometimesConsentAfterCode(page: AuthPage): bool = page.view == ConsentView and page.codeSent
pure def sometimesLinkInvalid(page: AuthPage): bool = page.view == LinkInvalidView
pure def sometimesTooManyTries(page: AuthPage): bool = page.view == TooManyTriesView
pure def sometimesNotAvailable(page: AuthPage): bool = page.view == NotAvailableView
pure def sometimesPageExpired(page: AuthPage): bool = page.view == PageExpiredView
pure def sometimesAlreadySignedIn(page: AuthPage): bool = page.view == AlreadySignedInView
pure def sometimesCheckNumber(page: AuthPage): bool = page.view == CheckNumberView
pure def sometimesConnectAgain(page: AuthPage): bool = page.view == ConnectAgainView
pure def sometimesPleaseRetry(page: AuthPage): bool = page.view == PleaseRetryView
pure def sometimesSignInUnavailable(page: AuthPage): bool = page.view == SignInUnavailableView
pure def sometimesNotAllowed(page: AuthPage): bool = page.view == NotAllowedView
```
