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

The same number can request at most three codes per hour and six per day, with at least thirty seconds between requests. Limit each client address bucket to ten requests per hour and the whole service to five hundred requests per hour. Check address, phone hour and minimum gap, phone day, then global budget. Stop at the first refusal. An hourly refusal waits for its window or the remaining minimum gap. A daily refusal waits for the daily window. A bucket permits a request when its count in the current window is below its limit (`otpBucketAllows`); the phone hour bucket also needs the minimum gap since its last counted request to have passed (`otpGapLeft`, `otpPhoneHourAllows`). The four checks and the counts are one unit: the store reads all four buckets and counts the request in all four in one atomic step, under locks on those four buckets only, and the decision of the four checks (`otpSendDecision`) counts the request (`otpStartCounts`) exactly when all four permit it, so a refused request is counted in no bucket. Every code start on a site, for every app, runs the browser check. A deployed entry refuses to start without the browser check key ([startup configuration](bootPolicy.md), `turnstileMissing`), and the site API refuses to start without a verifier outside development, so only a development start has no browser check; the site API calls the verifier when it has one and decides nothing else. Changed (audit AE-1 and owner decision 2026-11-22, D6): each bucket was counted in its own write, and `PLATFORM_PHONE_OTP_ONLY_APPS` skipped the browser check for named apps with an address ceiling of two hundred an hour -> one atomic step counts all four buckets, and every start has the browser check and the ten-an-hour address limit, because a refused request used up the limits of other numbers and the owner removed the bot-check exception.

```quint
pure def otpBucketAllows(used: int, limit: int): bool = used < limit

pure def otpGapLeft(hasLast: bool, lastCountedAt: int, at: int, minGapMs: int): int =
  if (hasLast) minGapMs - (at - lastCountedAt) else 0

pure def otpPhoneHourAllows(used: int, limit: int, gapLeft: int): bool =
  otpBucketAllows(used, limit) and gapLeft <= 0

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

pure def otpSendDecision(addressAllows: bool, phoneHourAllows: bool, gapLeft: int, dayAllows: bool, globalAllows: bool): ChallengeFlow =
  val address = readSendAddress(requestCode(initial), addressAllows)
  val hour = if (canReadSendPhoneHour(address)) readSendPhoneHour(address, phoneHourAllows, gapLeft) else address
  val day = if (canReadSendPhoneDay(hour)) readSendPhoneDay(hour, dayAllows) else hour
  if (canReadSendGlobal(day)) readSendGlobal(day, globalAllows) else day

pure def otpStartCounts(flow: ChallengeFlow): bool = flow.phase == Sending

pure def lawStartCountsOnlyWhenAllFourAllow(addressAllows: bool, phoneHourAllows: bool, gapLeft: int, dayAllows: bool, globalAllows: bool): bool =
  otpStartCounts(otpSendDecision(addressAllows, phoneHourAllows, gapLeft, dayAllows, globalAllows))
    == (addressAllows and phoneHourAllows and dayAllows and globalAllows)

pure def lawRefusedStartHasLimitReason(addressAllows: bool, phoneHourAllows: bool, gapLeft: int, dayAllows: bool, globalAllows: bool): bool =
  val flow = otpSendDecision(addressAllows, phoneHourAllows, gapLeft, dayAllows, globalAllows)
  not(otpStartCounts(flow)) implies (flow.phase == Refused and flow.reason != NoReason and flow.reason != VerificationFailed)
```

### Code checks also have limits shared across apps

Allow up to ten code checks per number per hour and thirty per address bucket per hour across all apps. These defaults apply independently of the individual challenge's attempt limit. Changed (owner decision 2026-11-22): the coarse ceiling of six hundred checks an hour for a phone-code-only app is removed with the option `PLATFORM_PHONE_OTP_ONLY_APPS`, so every check uses the thirty-an-hour address limit.

```quint
pure val otpChecksPerPhoneHour: int = 10
pure val otpChecksPerIpHour: int = 30
```

### Start keeps its public response private

After all four limits permit a send, ask the configured provider. Persist the challenge after it accepts the request. A provider or challenge write failure still gets the ordinary accepted start response. The shell reports the failure to operations. A banned number goes through the same four limits and is counted in them like any other number, so it gets the same answers, the limited answer included; after all four permit it, the start asks no provider, records no challenge and gives the ordinary accepted start response (`withholdSend`). Changed (audit AE-2): the web route and the connector answered a banned number with the accepted response before any limit counted it -> the limits count a banned number first, because a banned number never got the limited answer, and that showed that it was banned.

```quint
pure def canRecordSend(flow: ChallengeFlow): bool = flow.phase == Sending
pure def recordSend(flow: ChallengeFlow, providerAccepted: bool): ChallengeFlow =
  { ...flow, phase: if (providerAccepted) RecordingChallenge else StartComplete }

pure def canWithholdSend(flow: ChallengeFlow): bool = flow.phase == Sending
pure def withholdSend(flow: ChallengeFlow): ChallengeFlow = { ...flow, phase: StartComplete }

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
