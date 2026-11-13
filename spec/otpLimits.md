# Phone verification limits

## Story: Prove ownership of my phone

> As a person signing up, I want a short-lived code and consistent limits that keep the phone verification service usable.

### Verification codes expire and have a limited number of attempts

The default code lifetime is ten minutes. Each challenge allows up to five attempts. The store checks lifetime and remaining attempts at verification and consumes a successful challenge once.

```quint
pure val otpLifetimeMs: int = 10 * 60 * 1000
pure val otpChallengeMaxAttempts: int = 5
```

### Code sends have limits shared across apps

The same number can request at most three codes per hour and six per day, with at least thirty seconds between requests. Limit each client address bucket to ten requests per hour and the whole service to five hundred requests per hour. Check address, phone hour and minimum gap, phone day, then global budget. Stop at the first refusal. An hourly refusal waits for its window or the remaining minimum gap. A daily refusal waits for the daily window.

```quint
pure val otpSendsPerPhoneHour: int = 3
pure val otpSendsPerPhoneDay: int = 6
pure val otpSendsPerIpHour: int = 10
pure val otpSendGapMs: int = 30 * 1000
pure val otpSendsGlobalHour: int = 500

type ChallengePhase = Beginning | SendAddress | SendPhoneHour | SendPhoneDay | SendGlobal | Sending | RecordingChallenge | StartComplete |
  CheckAddress | CheckPhone | ReadingChallenge | ClaimingAttempt | CheckingCode | ConsumingChallenge | Verified | Refused
type ChallengeReason = NoReason | LimitedHour | LimitedGap | LimitedDay | LimitedGlobal | VerificationFailed
type ChallengeFlow = { phase: ChallengePhase, reason: ChallengeReason }

pure val initial: ChallengeFlow = { phase: Beginning, reason: NoReason }

pure def canRequestCode(flow: ChallengeFlow): bool = flow.phase == Beginning
pure def requestCode(flow: ChallengeFlow): ChallengeFlow = { ...flow, phase: SendAddress }

pure def canReadSendAddress(flow: ChallengeFlow): bool = flow.phase == SendAddress
pure def readSendAddress(flow: ChallengeFlow, allowed: bool): ChallengeFlow =
  if (allowed) { ...flow, phase: SendPhoneHour } else { phase: Refused, reason: LimitedHour }

pure def canReadSendPhoneHour(flow: ChallengeFlow): bool = flow.phase == SendPhoneHour
pure def readSendPhoneHour(flow: ChallengeFlow, allowed: bool, gapLeft: int): ChallengeFlow =
  if (allowed) { ...flow, phase: SendPhoneDay }
  else { phase: Refused, reason: if (gapLeft > 0) LimitedGap else LimitedHour }

pure def canReadSendPhoneDay(flow: ChallengeFlow): bool = flow.phase == SendPhoneDay
pure def readSendPhoneDay(flow: ChallengeFlow, allowed: bool): ChallengeFlow =
  if (allowed) { ...flow, phase: SendGlobal } else { phase: Refused, reason: LimitedDay }

pure def canReadSendGlobal(flow: ChallengeFlow): bool = flow.phase == SendGlobal
pure def readSendGlobal(flow: ChallengeFlow, allowed: bool): ChallengeFlow =
  if (allowed) { ...flow, phase: Sending } else { phase: Refused, reason: LimitedGlobal }
```

### Code checks also have limits shared across apps

Allow up to ten code checks per number per hour and thirty per address bucket per hour across all apps. These defaults apply independently of the individual challenge's attempt limit.

```quint
pure val otpChecksPerPhoneHour: int = 10
pure val otpChecksPerIpHour: int = 30
```

### Start keeps its public response private

After all four limits permit a send, ask the configured provider. Persist the challenge after it accepts the request. A provider or challenge write failure still gets the ordinary accepted start response. The shell reports the failure to operations.

```quint
pure def canRecordSend(flow: ChallengeFlow): bool = flow.phase == Sending
pure def recordSend(flow: ChallengeFlow, providerAccepted: bool): ChallengeFlow =
  { ...flow, phase: if (providerAccepted) RecordingChallenge else StartComplete }

pure def canFinishStart(flow: ChallengeFlow): bool = flow.phase == RecordingChallenge
pure def finishStart(flow: ChallengeFlow): ChallengeFlow = { ...flow, phase: StartComplete }

pure def sometimesStarts(flow: ChallengeFlow): bool = flow.phase == StartComplete
```

### Verification needs a claimed attempt, the right code, and a successful consume

Check code format, then the address and phone verification budgets. Use the newest challenge for the app and phone when its provider matches the current one. The store must claim a live attempt before any code check. Verify with the provider or the stored hash. A successful code is accepted only if the store consumes that challenge.

```quint
pure def canBeginVerification(flow: ChallengeFlow): bool = flow.phase == Beginning
pure def beginVerification(flow: ChallengeFlow, codeWellFormed: bool): ChallengeFlow =
  if (codeWellFormed) { ...flow, phase: CheckAddress } else { phase: Refused, reason: VerificationFailed }

pure def canReadCheckAddress(flow: ChallengeFlow): bool = flow.phase == CheckAddress
pure def readCheckAddress(flow: ChallengeFlow, allowed: bool): ChallengeFlow =
  if (allowed) { ...flow, phase: CheckPhone } else { phase: Refused, reason: VerificationFailed }

pure def canReadCheckPhone(flow: ChallengeFlow): bool = flow.phase == CheckPhone
pure def readCheckPhone(flow: ChallengeFlow, allowed: bool): ChallengeFlow =
  if (allowed) { ...flow, phase: ReadingChallenge } else { phase: Refused, reason: VerificationFailed }

pure def canReadChallenge(flow: ChallengeFlow): bool = flow.phase == ReadingChallenge
pure def readChallenge(flow: ChallengeFlow, matchingProvider: bool): ChallengeFlow =
  if (matchingProvider) { ...flow, phase: ClaimingAttempt } else { phase: Refused, reason: VerificationFailed }

pure def canClaimAttempt(flow: ChallengeFlow): bool = flow.phase == ClaimingAttempt
pure def claimAttempt(flow: ChallengeFlow, claimed: bool): ChallengeFlow =
  if (claimed) { ...flow, phase: CheckingCode } else { phase: Refused, reason: VerificationFailed }

pure def canCheckCode(flow: ChallengeFlow): bool = flow.phase == CheckingCode
pure def checkCode(flow: ChallengeFlow, correct: bool): ChallengeFlow =
  if (correct) { ...flow, phase: ConsumingChallenge } else { phase: Refused, reason: VerificationFailed }

pure def canConsumeChallenge(flow: ChallengeFlow): bool = flow.phase == ConsumingChallenge
pure def consumeChallenge(flow: ChallengeFlow, consumed: bool): ChallengeFlow =
  if (consumed) { ...flow, phase: Verified } else { phase: Refused, reason: VerificationFailed }

pure def stepVerificationRequiresConsume(before: ChallengeFlow, via: str, after: ChallengeFlow): bool =
  after.phase == Verified implies (before.phase == ConsumingChallenge and via == "consumeChallenge")

pure def sometimesVerifies(flow: ChallengeFlow): bool = flow.phase == Verified
```
