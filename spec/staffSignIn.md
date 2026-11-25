# Staff sign-in to the console

Staff get into the console (`apps/observatory/web`) with a staff token or with single sign-on through Cloudflare Access. This spec owns the browser's sign-in phases: the token in the address, the identity check, the token form, the single sign-on link, the refusals, the second factor and the end of a session. It also owns the server's start rule for the sign-in method. The server shell owns the token comparison, the Access assertion check, the Host and Origin check and the audit log. The [permissions spec](staffPermissions.md) owns which routes a role can use. The [navigation spec](consoleNavigation.md) owns the page that a signed-in viewer sees.

## Story: Sign in as myself

> As a staff member, I want to sign in with my own identity and a second factor, so that every read and action in the console is mine and nobody can use the console without me.

### The console takes a token out of the address before it calls the server

The server can print the console address with a token after `#token=`. The browser never sends the part after `#` to a server. The console reads that token, or an old `?token=`, keeps it for this browser tab only, and removes it from the address bar and the history entry. A token that this tab kept before also counts as found. Then the console asks the server who the viewer is.

```quint
type SignInPhase = Opening | Checking | AskingToken | AskingAccess | SignedIn | NoStaffRole | NeedsSecondFactor | SiteRefused | CheckFailed
type SignInMethod = NoCredential | TokenCredential | AccessCredential
type StaffSignIn = { phase: SignInPhase, method: SignInMethod, tokenInAddress: bool, secondFactor: bool, roleCount: int }

pure val initial: StaffSignIn = { phase: Opening, method: NoCredential, tokenInAddress: true, secondFactor: false, roleCount: 0 }

pure def canOpenConsole(signIn: StaffSignIn): bool = signIn.phase == Opening

pure def openConsole(signIn: StaffSignIn, tokenFound: bool): StaffSignIn =
  { ...signIn, phase: Checking, tokenInAddress: false, secondFactor: false, roleCount: 0,
    method: if (tokenFound) TokenCredential else signIn.method }

pure def alwaysAddressHoldsNoTokenAfterOpening(signIn: StaffSignIn): bool =
  signIn.phase != Opening implies not(signIn.tokenInAddress)
```

### The server answer decides the sign-in phase

The server answers the identity check in one of five ways, and it tells whether it signs staff in through Cloudflare Access. An accepted identity with no staff role gets the no-role phase. An accepted single sign-on identity without a second factor gets the second-factor phase. Other accepted identities are signed in with their roles. A request without a valid sign-in gets the token form from a token server and the single sign-on link from a single sign-on server, never the token form. A single sign-on identity that the server refuses for lack of a role gets the no-role phase. A refused Host or Origin gets the site-refused phase. A server that does not answer gets the retry phase. A token sign-in has no second factor; the start rule allows tokens only with data on this machine.

```quint
type IdentityAnswer = IdentityAccepted | SignInNeeded | IdentityWithoutRole | SiteNotAllowed | ServerUnreachable

pure def phaseForAnswer(answer: IdentityAnswer, viaAccess: bool, secondFactorShown: bool, grants: int): SignInPhase =
  if (answer == IdentityAccepted)
    (if (grants <= 0) NoStaffRole else if (viaAccess and not(secondFactorShown)) NeedsSecondFactor else SignedIn)
  else if (answer == SignInNeeded) (if (viaAccess) AskingAccess else AskingToken)
  else if (answer == IdentityWithoutRole) NoStaffRole
  else if (answer == SiteNotAllowed) SiteRefused
  else CheckFailed

pure def methodForAnswer(answer: IdentityAnswer, viaAccess: bool, method: SignInMethod): SignInMethod =
  if (answer == IdentityAccepted or answer == SignInNeeded or answer == IdentityWithoutRole)
    (if (viaAccess) AccessCredential else TokenCredential)
  else method

pure def canAnswerIdentity(signIn: StaffSignIn, grants: int): bool = signIn.phase == Checking and grants >= 0

pure def answerIdentity(signIn: StaffSignIn, answer: IdentityAnswer, viaAccess: bool, secondFactorShown: bool, grants: int): StaffSignIn =
  val accepted = answer == IdentityAccepted
  { ...signIn,
    phase: phaseForAnswer(answer, viaAccess, secondFactorShown, grants),
    method: methodForAnswer(answer, viaAccess, signIn.method),
    secondFactor: accepted and viaAccess and secondFactorShown,
    roleCount: if (accepted) grants else 0 }

pure def lawAccessServerNeverAsksForAToken(answer: IdentityAnswer, secondFactorShown: bool, grants: int): bool =
  phaseForAnswer(answer, true, secondFactorShown, grants) != AskingToken

pure def lawAccessNeedsTheSecondFactor(grants: int): bool =
  phaseForAnswer(IdentityAccepted, true, false, grants) != SignedIn

pure def alwaysSignedInHoldsARole(signIn: StaffSignIn): bool = signIn.phase == SignedIn implies signIn.roleCount > 0

pure def alwaysSignedInNamesItsMethod(signIn: StaffSignIn): bool =
  (signIn.phase == SignedIn or signIn.phase == NoStaffRole or signIn.phase == NeedsSecondFactor) implies signIn.method != NoCredential

pure def alwaysAccessSessionHasASecondFactor(signIn: StaffSignIn): bool =
  (signIn.phase == SignedIn and signIn.method == AccessCredential) implies signIn.secondFactor

pure def alwaysTokenFormOnlyForTokenServers(signIn: StaffSignIn): bool =
  signIn.phase == AskingToken implies signIn.method == TokenCredential

pure def alwaysAccessLinkOnlyForAccessServers(signIn: StaffSignIn): bool =
  (signIn.phase == AskingAccess or signIn.phase == NeedsSecondFactor) implies signIn.method == AccessCredential

pure def stepSignInFollowsAnAcceptedAnswer(before: StaffSignIn, via: str, after: StaffSignIn): bool =
  (after.phase == SignedIn and before.phase != SignedIn) implies (via == "answerIdentity" and before.phase == Checking)

pure def sometimesSignedInWithAToken(signIn: StaffSignIn): bool = signIn.phase == SignedIn and signIn.method == TokenCredential
pure def sometimesSignedInWithAccess(signIn: StaffSignIn): bool = signIn.phase == SignedIn and signIn.method == AccessCredential
pure def sometimesNoStaffRole(signIn: StaffSignIn): bool = signIn.phase == NoStaffRole
pure def sometimesNeedsSecondFactor(signIn: StaffSignIn): bool = signIn.phase == NeedsSecondFactor
pure def sometimesSiteRefused(signIn: StaffSignIn): bool = signIn.phase == SiteRefused
```

### The token form accepts a pasted token and checks it again

The token form shows a password field. Its submit control works only when the field holds text. A submitted token replaces the token of this tab and starts a new identity check. A token viewer with no role can also paste another token.

```quint
pure def canSubmitToken(signIn: StaffSignIn, tokenChars: int): bool =
  tokenChars > 0 and (signIn.phase == AskingToken or (signIn.phase == NoStaffRole and signIn.method == TokenCredential))

pure def submitToken(signIn: StaffSignIn, tokenChars: int): StaffSignIn =
  { ...signIn, phase: Checking, method: TokenCredential, secondFactor: false, roleCount: 0 }

pure def sometimesAsksForAToken(signIn: StaffSignIn): bool = signIn.phase == AskingToken
```

### A single sign-on viewer signs in again through Cloudflare Access

The single sign-on link, the second-factor phase and the no-role phase of a single sign-on viewer reload the console through Cloudflare Access. The reload starts the sign-in again with the same method.

```quint
pure def canSignInAgain(signIn: StaffSignIn): bool =
  signIn.phase == AskingAccess or signIn.phase == NeedsSecondFactor
    or (signIn.phase == NoStaffRole and signIn.method == AccessCredential)

pure def signInAgain(signIn: StaffSignIn): StaffSignIn =
  { ...signIn, phase: Opening, secondFactor: false, roleCount: 0 }

pure def sometimesAsksForAccess(signIn: StaffSignIn): bool = signIn.phase == AskingAccess
```

### A failed check can be tried again

When the server does not answer, the console offers the identity check again. A refused Host or Origin is a server setting, so the site-refused phase offers no retry.

```quint
pure def canRetryCheck(signIn: StaffSignIn): bool = signIn.phase == CheckFailed

pure def retryCheck(signIn: StaffSignIn): StaffSignIn = { ...signIn, phase: Checking }

pure def sometimesCheckFailed(signIn: StaffSignIn): bool = signIn.phase == CheckFailed
```

### The server serves data only to a single sign-on identity with a second factor

The server reads the second factor from the authentication methods that the verified Cloudflare Access assertion names. It answers the identity check for every accepted identity and tells whether a second factor is present. It refuses every other route and the live socket to a single sign-on identity without a second factor. A token identity has no second factor, and the start rule accepts tokens only with data on this machine. Changed (audit stories-b-1): the server did not read the second factor -> it reads it, because a single sign-on identity without one got its full roles and the second-factor phase never occurred.

```quint
pure def identityServed(viaAccess: bool, secondFactorShown: bool): bool = not(viaAccess) or secondFactorShown

pure def lawServedAccessIdentityIsSignedIn(secondFactorShown: bool, grants: int): bool =
  (grants > 0 and identityServed(true, secondFactorShown)) implies phaseForAnswer(IdentityAccepted, true, secondFactorShown, grants) == SignedIn

pure def lawAccessWithoutSecondFactorGetsNoData(grants: int): bool =
  not(identityServed(true, false)) and phaseForAnswer(IdentityAccepted, true, false, grants) != SignedIn
```

### A second factor is the multi-factor method or two distinct methods

The server reads the authentication methods (`amr`) of the verified Cloudflare Access assertion. It counts each distinct method name once, without case. The assertion shows a second factor only when it names the multi-factor method (`mfa`) or at least two distinct methods. One method alone is never a second factor, because one-time code, hardware key, software key and smart card can each be the only method of a sign-in (an emailed one-time PIN gives `otp` alone). Changed (audit stories-b-1): the shell decided, and any one of `mfa`, `otp`, `hwk`, `swk` or `sc` counted -> this rule decides, because a sign-in with only an emailed code got full staff roles.

```quint
pure val staffSignInDistinctMethodsForSecondFactor = 2

pure def staffSecondFactorShown(multiFactorNamed: bool, distinctMethods: int): bool =
  multiFactorNamed or distinctMethods >= staffSignInDistinctMethodsForSecondFactor

pure val distinctMethodsValues = Set(-1, 0, 1, 2, 3)

pure def lawOneMethodAloneIsNoSecondFactor(distinctMethods: int): bool =
  distinctMethods <= 1 implies not(staffSecondFactorShown(false, distinctMethods))

pure def lawMultiFactorMethodIsSecondFactor(distinctMethods: int): bool =
  staffSecondFactorShown(true, distinctMethods)
```

## Story: Keep my session bound to my roles

> As a staff member, I want the console to end my session when my sign-in expires or my roles change, so that I never act on a role that I no longer hold.

### An expired sign-in or a changed role ends the signed-in phase

The server refuses a request or closes the live socket when the sign-in expires (401, or socket code 4401). Then the console asks for a token, or for single sign-on, by the method of the ended session. When a role is taken away (socket code 4403), the console checks the identity again and the navigation picks a page that the remaining roles cover.

```quint
pure def canEndSession(signIn: StaffSignIn): bool = signIn.phase == SignedIn

pure def endSession(signIn: StaffSignIn, roleRemoved: bool): StaffSignIn =
  { ...signIn, secondFactor: false, roleCount: 0,
    phase: if (roleRemoved) Checking else if (signIn.method == AccessCredential) AskingAccess else AskingToken }

pure def stepEndedSessionHoldsNoRoles(before: StaffSignIn, via: str, after: StaffSignIn): bool =
  via == "endSession" implies (after.roleCount == 0 and after.phase != SignedIn and after.method == before.method)
```

### Each sign-in phase has one view

The console shows its pages only to a signed-in viewer. Every other phase shows one panel: loading, the token form, the single sign-on link, no staff role, the second-factor request, the refused site, or the retry.

```quint
type SignInView = ShowLoading | ShowTokenForm | ShowAccessLink | ShowConsole | ShowNoRole | ShowSecondFactorNeeded | ShowSiteRefused | ShowRetry

pure def signInView(phase: SignInPhase): SignInView =
  if (phase == SignedIn) ShowConsole
  else if (phase == AskingToken) ShowTokenForm
  else if (phase == AskingAccess) ShowAccessLink
  else if (phase == NoStaffRole) ShowNoRole
  else if (phase == NeedsSecondFactor) ShowSecondFactorNeeded
  else if (phase == SiteRefused) ShowSiteRefused
  else if (phase == CheckFailed) ShowRetry
  else ShowLoading

pure def lawConsoleShowsOnlyWhenSignedIn(phase: SignInPhase): bool = (signInView(phase) == ShowConsole) iff (phase == SignedIn)

pure def lawTokenFormOnlyWhenAskingForAToken(phase: SignInPhase): bool = (signInView(phase) == ShowTokenForm) iff (phase == AskingToken)
```

## Story: Start a console that holds real data only behind single sign-on

> As an operator, I want a console that reads real data to refuse to start without single sign-on, so that no shared token opens member data.

### Real data outside a local development setup needs Cloudflare Access

A console reads real data when it is real-only or when a database it can read is not on this machine. Such a console needs a known platform environment. Staging and production need Cloudflare Access. Development with a database on another machine also needs Cloudflare Access. With Cloudflare Access on, the server refuses every staff token.

```quint
type PlatformEnv = EnvUnset | EnvUnknown | EnvDev | EnvStaging | EnvProduction

pure def startRefused(realOnlyServer: bool, remoteDatabase: bool, platformEnv: PlatformEnv, accessOn: bool): bool =
  if (not(realOnlyServer) and not(remoteDatabase)) false
  else if (platformEnv == EnvUnset or platformEnv == EnvUnknown) true
  else if (accessOn) false
  else if (platformEnv != EnvDev) true
  else remoteDatabase

pure def tokensAccepted(accessOn: bool): bool = not(accessOn)

pure def lawDeployedRealDataUsesAccess(remoteDatabase: bool, platformEnv: PlatformEnv, accessOn: bool): bool =
  (platformEnv != EnvDev and not(startRefused(true, remoteDatabase, platformEnv, accessOn))) implies accessOn

pure def lawRemoteDataUsesAccess(realOnlyServer: bool, platformEnv: PlatformEnv, accessOn: bool): bool =
  not(startRefused(realOnlyServer, true, platformEnv, accessOn)) implies accessOn

pure def lawRealDataNeedsAKnownEnvironment(remoteDatabase: bool, accessOn: bool): bool =
  startRefused(true, remoteDatabase, EnvUnset, accessOn) and startRefused(true, remoteDatabase, EnvUnknown, accessOn)

pure def lawStartedRealDataTakesNoTokenOffThisMachine(realOnlyServer: bool, platformEnv: PlatformEnv, accessOn: bool): bool =
  not(startRefused(realOnlyServer, true, platformEnv, accessOn)) implies not(tokensAccepted(accessOn))

pure def lawLocalSimulationNeedsNothing(platformEnv: PlatformEnv, accessOn: bool): bool =
  not(startRefused(false, false, platformEnv, accessOn))
```

### A deployed console with real data needs a durable audit log

A console that reads real data in staging or production keeps its audit log in Postgres. A file audit log is lost on a redeploy, so the server refuses to start with it. Development and a local simulation need no audit database. Added (upstream SD-290): the shell refused a deployed console without the Postgres audit sink -> this rule decides.

```quint
pure def startNeedsDurableAudit(realOnlyServer: bool, remoteDatabase: bool, platformEnv: PlatformEnv, auditDurable: bool): bool =
  (realOnlyServer or remoteDatabase) and (platformEnv == EnvStaging or platformEnv == EnvProduction) and not(auditDurable)

pure def lawDeployedRealDataKeepsAuditDurable(realOnlyServer: bool, remoteDatabase: bool, platformEnv: PlatformEnv): bool =
  ((realOnlyServer or remoteDatabase) and (platformEnv == EnvStaging or platformEnv == EnvProduction)) implies startNeedsDurableAudit(realOnlyServer, remoteDatabase, platformEnv, false)

pure def lawLocalSimulationNeedsNoAuditDatabase(platformEnv: PlatformEnv, auditDurable: bool): bool =
  not(startNeedsDurableAudit(false, false, platformEnv, auditDurable))
```
