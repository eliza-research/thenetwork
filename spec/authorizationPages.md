# Connector authorization pages

This spec owns the view layer of connector authorization: the page that the browser shows for each server reply, the controls on each page, the field errors and the security check. The [connector browser authorization spec](oauthBrowserAuthorization.md) owns the server flow, the stored request and its phases. The [connector grant issuance spec](oauthGrantIssuance.md) owns what happens after an explicit approval. The handler decides each reply. The page shell gives that reply to this machine and renders the view that it selects. The app resolved by the router also owns the [brand](brandIdentity.md) shown on every configured host. Copy, brand colors and logos stay in the component library.

## Story: See one clear page at each step of connecting my assistant

> As a person who connects my assistant, I want each page to show only the step that I am on, so that I know what to do next.

### The server reply selects the page view

Each server reply selects exactly one view. A phone page, a code page or a consent page can show a form. A message page shows a title, one sentence and, for "Please try again" only, a retry link. Three replies leave this site: the hand-off to Cloud sign-in, the return to the assistant with a code, and the return to the assistant with a refusal. A field error is part of the reply and shows only on the page of its field. The phone page shows a security check only when the site has one.

```quint
type AuthView =
  Opening | PhoneView | CodeView | ConsentView | ConsentRetryView | CloudView | ApprovedView | DeclinedView |
  LinkInvalidView | TooManyTriesView | NotAvailableView | PageExpiredView | AlreadySignedInView |
  CheckNumberView | ConnectAgainView | PleaseRetryView | SignInUnavailableView | NotAllowedView
type Reply =
  ReplyPhone | ReplyCode | ReplyConsent | ReplyConsentRetry | ReplyCloud | ReplyApproved | ReplyDeclined |
  ReplyCheckFailed | ReplyPhoneInvalid | ReplyTooManyCodes | ReplySendUnavailable | ReplyCodeRejected |
  ReplyLinkInvalid | ReplyTooManyTries | ReplyNotAvailable | ReplyExpired | ReplyAlreadySignedIn |
  ReplyCheckNumber | ReplyConnectAgain | ReplyRetryLater | ReplySignInUnavailable | ReplyNotAllowed
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
}

pure def offersFor(view: AuthView): Offers = {
  sendCode: view == PhoneView,
  continueCode: view == CodeView,
  allow: view == ConsentView,
  retryAllow: view == ConsentRetryView,
  dontAllow: isConsentView(view),
  cancel: view == PhoneView or view == CodeView,
  retryLink: view == PleaseRetryView,
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

After Cloud sign-in, the browser comes back to the same request. The "Try again" link on "Please try again" goes to the same return address. Both show the consent page, "Please try again", "This page has expired", "This link does not work" or "Connect again".

```quint
pure def isCloudReturnReply(reply: Reply): bool =
  reply == ReplyConsent or reply == ReplyRetryLater or reply == ReplyExpired
    or reply == ReplyLinkInvalid or reply == ReplyConnectAgain

pure def canReturnFromCloud(page: AuthPage, reply: Reply): bool = page.view == CloudView and isCloudReturnReply(reply)
pure def returnFromCloud(page: AuthPage, reply: Reply): AuthPage = showReply(reply, page)

pure def canRetryConnection(page: AuthPage, reply: Reply): bool = page.view == PleaseRetryView and isCloudReturnReply(reply)
pure def retryConnection(page: AuthPage, reply: Reply): AuthPage = showReply(reply, page)
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

The person can send the phone number only when the check is off or solved. A sent code opens the code page. A failed check, a number that is not a US or Canada number, too many codes, or a send failure shows the phone page again with that field error. A failed check can occur only on a site with a check. The other replies are "This page has expired", "Already signed in", "Not allowed" and "Not available".

```quint
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

### Each scope shows as one short sentence, never as its scope name

The connector server knows three scopes. The scope list shows each requested scope as one sentence that tells what the assistant can do, in the order of the request. The page never shows the scope name of the server.

```quint
type Scope = AppsRead | MembershipRead | ProfileWrite

pure val scopes: List[Scope] = List(AppsRead, MembershipRead, ProfileWrite)

pure def scopeName(scope: Scope): str =
  if (scope == AppsRead) "apps:read" else if (scope == MembershipRead) "membership:read" else "profile:write"

pure def scopeText(scope: Scope): str =
  if (scope == AppsRead) "See which Network apps are available"
  else if (scope == MembershipRead) "Read your membership status and new updates"
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
      or (via == "submitCode" and before.view == CodeView))
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
