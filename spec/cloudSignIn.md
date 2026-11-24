# Complete a Cloud sign-in

The app's Cloud callback turns an approved handoff into a site session. The VibeLang shell uses this machine to order the exchange, identity and phone checks, phone ownership reads, and session writes. The HTTP handler decodes the cookie and callback, supplies the Cloud and storage operations, and produces the response. When a Cloud or storage operation fails, the machine takes no further step and the handler returns an unavailable response.

## Story: Use my Cloud identity to sign in to this app

> As a member, I want my Cloud approval to sign in to the intended site with my own verified phone.

### The callback requires a live handoff for this app

The callback must carry a sealed pending handoff for the routed app, matching state and an allowed return path. It must contain the verifier and be before the handoff expiry. The code must have the expected format. The shell validates binding, type and syntax before the model permits an exchange.

```quint
type SignInPhase = AwaitingHandoff | AwaitingExchange | AwaitingIdentity | AwaitingPhone | AwaitingSession | SignedIn | RejectCallback | DenySignIn | CloudUnavailable
type SignIn = { phase: SignInPhase, handoffAccepted: bool, exchangeAccepted: bool, identityAccepted: bool, phoneAllowed: bool }
type HandoffFacts = { bindingValid: bool, pendingLive: bool, codeWellFormed: bool }
pure val initial: SignIn = {
  phase: AwaitingHandoff, handoffAccepted: false, exchangeAccepted: false, identityAccepted: false, phoneAllowed: false,
}
pure val validHandoff: HandoffFacts = { bindingValid: true, pendingLive: true, codeWellFormed: true }
pure val handoffFactsValues = Set(
  validHandoff, { ...validHandoff, bindingValid: false },
  { ...validHandoff, pendingLive: false }, { ...validHandoff, codeWellFormed: false },
)

pure def liveBeforeDeadline(asOf: int, expiresAt: int): bool = asOf < expiresAt

pure def canCheckHandoff(signIn: SignIn): bool = signIn.phase == AwaitingHandoff
pure def checkHandoff(signIn: SignIn, handoffFacts: HandoffFacts): SignIn =
  val accepted = handoffFacts.bindingValid and handoffFacts.pendingLive and handoffFacts.codeWellFormed
  { ...signIn, handoffAccepted: accepted, phase: if (accepted) AwaitingExchange else RejectCallback }

pure def lawAnExpiredHandoffIsNeverLive(expiresAt: int): bool =
  not(liveBeforeDeadline(expiresAt, expiresAt))
```

### The Home Help callback returns to the same Network site

On ntwrk.party the public start accepts the exact `/home-help` path. It stores that path with the routed app in the sealed pending cookie. Cloud still receives only the app, state, challenge and realm or the configured local site origin. Cloud returns to its existing app callback. The site returns a successful callback to `/home-help`. The same-app pending cookie must name `/home-help` before the server can return a failure to that page. A wrong state, missing or malformed code, or expired handoff sends `sign_in_expired`. A refused exchange, invalid identity, or held phone sends `sign_in_refused`. A Cloud or storage error sends `sign_in_unavailable`. A missing, invalid or other-app cookie produces the ordinary callback error. The path and the error have fixed values. The plan fragment and address stay out of the Cloud handoff.

```quint
pure val homeHelpCloudPath: str = "/home-help"

pure def homeHelpCloudReturnAllowed(app: str, path: str): bool = app == "ntwrk" and path == homeHelpCloudPath

pure def homeHelpCloudFailurePath(callbackApp: str, pendingApp: str, path: str, status: int): str =
  if (callbackApp != pendingApp or not(homeHelpCloudReturnAllowed(callbackApp, path))) ""
  else if (status == 400) "/home-help?error=sign_in_expired"
  else if (status == 403) "/home-help?error=sign_in_refused"
  else if (status == 503) "/home-help?error=sign_in_unavailable"
  else ""

pure def lawHomeHelpCloudReturnIsExact(app: str, path: str): bool =
  homeHelpCloudReturnAllowed(app, path) iff (app == "ntwrk" and path == "/home-help")

pure def lawHomeHelpCloudFailureRequiresSameApp(callbackApp: str, pendingApp: str, path: str, status: int): bool =
  (callbackApp != pendingApp or not(homeHelpCloudReturnAllowed(callbackApp, path))) implies
    homeHelpCloudFailurePath(callbackApp, pendingApp, path, status) == ""

pure def lawHomeHelpCloudFailureIsFixed(callbackApp: str, pendingApp: str, path: str, status: int): bool =
  val target = homeHelpCloudFailurePath(callbackApp, pendingApp, path, status)
  target == "" or target == "/home-help?error=sign_in_expired"
    or target == "/home-help?error=sign_in_refused" or target == "/home-help?error=sign_in_unavailable"
```

### Cloud must accept the exchange and return a live identity

The authority must accept the app-bound code exchange. The returned identity contains verified account and phone fields and a valid timestamp window. At the time of the check, its expiry must be in the future and its positive issue time may be at most 30 seconds ahead of the local clock (`cloudIdentityTimesValid`). Session start uses the earlier of issue time and local time. A successful exchange with no identity returns an unavailable response. An exchange refusal or an invalid identity returns a denial.

```quint
pure val cloudClockSkewMs: int = 30 * 1000

pure def cloudIssuedAtWithinSkew(issuedAtMs: int, asOf: int): bool =
  issuedAtMs > 0 and issuedAtMs <= asOf + cloudClockSkewMs

pure def cloudIdentityTimesValid(issuedAtMs: int, expiresAtMs: int, asOf: int): bool =
  cloudIssuedAtWithinSkew(issuedAtMs, asOf) and liveBeforeDeadline(asOf, expiresAtMs)

pure def lawCloudIdentityNeedsFutureExpiry(issuedAtMs: int, asOf: int): bool =
  not(cloudIdentityTimesValid(issuedAtMs, asOf, asOf))

pure def lawCloudIdentityNeedsPositiveIssueTime(expiresAtMs: int, asOf: int): bool =
  not(cloudIdentityTimesValid(0, expiresAtMs, asOf))

pure def cloudSessionStartedAt(issuedAtMs: int, asOf: int): int =
  if (issuedAtMs <= asOf) issuedAtMs else asOf

pure def lawSessionStartIsNeverFuture(issuedAtMs: int, asOf: int): bool =
  cloudSessionStartedAt(issuedAtMs, asOf) <= asOf

pure def canRecordExchange(signIn: SignIn): bool =
  signIn.phase == AwaitingExchange and signIn.handoffAccepted
pure def recordExchange(signIn: SignIn, exchangeAccepted: bool): SignIn =
  { ...signIn, exchangeAccepted: exchangeAccepted, phase: if (exchangeAccepted) AwaitingIdentity else DenySignIn }

pure def canCheckIdentity(signIn: SignIn): bool =
  signIn.phase == AwaitingIdentity and signIn.exchangeAccepted and signIn.handoffAccepted
pure def checkIdentity(signIn: SignIn, identityAvailable: bool, identityValid: bool): SignIn =
  val accepted = identityAvailable and identityValid
  { ...signIn, identityAccepted: accepted,
    phase: if (not(identityAvailable)) CloudUnavailable else if (accepted) AwaitingPhone else DenySignIn }
```

### The site checks phone eligibility before issuing a session

A held, banned or suppressed number cannot use this callback. When the phone passes those checks, the shell ends the previous session, updates the phone's last-seen state, looks up the current person and stores a session. The stored session expires no later than the Cloud identity under the [web session rule](webSession.md). A stored session permits the callback redirect.

```quint
import webSession as W from "./webSession"

pure def lawStoredSessionEndsByIdentityExpiry(createdAt: int, startedAt: int, ttl: int, maxAge: int, identityExpiry: int): bool =
  W::sessionDeadline(createdAt, startedAt, ttl, maxAge, true, identityExpiry) <= identityExpiry

pure def canCheckPhone(signIn: SignIn): bool =
  signIn.phase == AwaitingPhone and signIn.identityAccepted and signIn.exchangeAccepted and signIn.handoffAccepted
pure def checkPhone(signIn: SignIn, phoneAllowed: bool): SignIn =
  { ...signIn, phoneAllowed: phoneAllowed, phase: if (phoneAllowed) AwaitingSession else DenySignIn }

pure def canRecordSession(signIn: SignIn): bool =
  signIn.phase == AwaitingSession and signIn.phoneAllowed and signIn.identityAccepted and
    signIn.exchangeAccepted and signIn.handoffAccepted
pure def recordSession(signIn: SignIn): SignIn = { ...signIn, phase: SignedIn }
```

### A completed callback passed each issuance check

The stored session and the success response require a valid pending handoff, accepted exchange, current identity and eligible phone. Invalid handoffs and refused Cloud identities have separate outcomes. An unavailable identity returns an unavailable response. Every failure clears the pending cookie.

```quint
pure def alwaysSessionRequiresAcceptedHandoff(signIn: SignIn): bool =
  (signIn.phase == AwaitingSession or signIn.phase == SignedIn) implies
    (signIn.handoffAccepted and signIn.exchangeAccepted and signIn.identityAccepted and signIn.phoneAllowed)

pure def sometimesSignsIn(signIn: SignIn): bool = signIn.phase == SignedIn
pure def sometimesRejectsCallback(signIn: SignIn): bool = signIn.phase == RejectCallback
pure def sometimesDeniesSignIn(signIn: SignIn): bool = signIn.phase == DenySignIn
pure def sometimesCloudUnavailable(signIn: SignIn): bool = signIn.phase == CloudUnavailable
```
