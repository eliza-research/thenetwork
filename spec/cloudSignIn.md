# Complete a Cloud sign-in

The app's Cloud callback turns an approved handoff into a site session. The shell verifies cookies, decodes the callback, exchanges the code with the configured Cloud authority, checks phone eligibility, and stores the session. This model governs the order and result of the callback.

## Story: Use my Cloud identity to sign in to this app

> As a member, I want my Cloud approval to sign in to the intended site with my own verified phone.

### The callback requires a live handoff for this app

The callback must carry a sealed pending handoff for the routed app, matching state and an allowed return path. It must contain the verifier and be before the handoff expiry. The code must have the expected format. The shell validates binding, type and syntax before the model permits an exchange.

```quint
type SignInPhase = AwaitingHandoff | AwaitingExchange | AwaitingIdentity | AwaitingPhone | AwaitingSession | SignedIn | RejectCallback | DenySignIn
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

### Cloud must accept the exchange and return a live identity

The authority must accept the app-bound code exchange. The returned identity contains verified account and phone fields and a valid timestamp window. Its expiry must be in the future and its positive issue time may be at most 30 seconds ahead of the local clock. Session start uses the earlier of issue time and local time.

```quint
pure val cloudClockSkewMs: int = 30 * 1000

pure def cloudIssuedAtWithinSkew(issuedAtMs: int, asOf: int): bool =
  issuedAtMs <= asOf + cloudClockSkewMs

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
pure def checkIdentity(signIn: SignIn, identityValid: bool): SignIn =
  { ...signIn, identityAccepted: identityValid, phase: if (identityValid) AwaitingPhone else DenySignIn }
```

### The site checks phone eligibility before issuing a session

A held, banned or suppressed number cannot use this callback. When the phone passes those checks, the shell ends the previous session, updates the phone's last-seen state, looks up the current person and stores a session that expires no later than the Cloud identity. A stored session permits the callback redirect.

```quint
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

The stored session and the success response require a valid pending handoff, accepted exchange, current identity and eligible phone. Invalid handoffs and refused Cloud identities have separate outcomes. Transport or storage errors remain with the existing callback error handler.

```quint
pure def alwaysSessionRequiresAcceptedHandoff(signIn: SignIn): bool =
  (signIn.phase == AwaitingSession or signIn.phase == SignedIn) implies
    (signIn.handoffAccepted and signIn.exchangeAccepted and signIn.identityAccepted and signIn.phoneAllowed)

pure def sometimesSignsIn(signIn: SignIn): bool = signIn.phase == SignedIn
pure def sometimesRejectsCallback(signIn: SignIn): bool = signIn.phase == RejectCallback
pure def sometimesDeniesSignIn(signIn: SignIn): bool = signIn.phase == DenySignIn
```
