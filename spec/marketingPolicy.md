# Marketing policy

Pure campaign authorization, age eligibility, proof verification, anti-fraud payout caps, BD deal bounds, bandit arm eligibility, agent subscription quota, and consent fence rules shared by `@thenetwork/marketing`. Callers read campaign ledgers, proof verification metadata, anti-fraud registries, BD deal state, bandit telemetry, agent session health, and contact consent records, then pass explicit integers and booleans to these rules.

## Story: Hire and pay only verified adult participants within campaign limits

> As a campaign operator, I want marketing spend and payouts to stay inside configured caps, require adult age and verified proof for human work, and keep `slop.cash` disabled until approved.

### Only verified adults aged 18 through 120 may participate in paid marketing tasks

A marketing participant must have a known age between 18 and 120 years inclusive. Missing, minor, or out-of-range ages fail closed and cannot be hired or paid.

```quint
pure val marketingAdultAge: int = 18
pure val marketingMaxAge: int = 120

pure def adultParticipantAge(age: int): bool =
  age >= marketingAdultAge and age <= marketingMaxAge
```

### Campaign spend obeys per-task, daily, monthly, billing, lockdown, and slop.cash gates

Authorizing spend requires a positive amount at or below the per-task cap, non-negative prior spend, and cumulative daily and monthly spend at or below their respective caps. Tier 3 (paid API) and Tier 4 (paid human) executions require `billingArmed` to be true and `lockdown` to be false. Requests using `slop.cash` are refused whenever `slopCashEnabled` is false.

```quint
pure def canAuthorizeSpend(
  tier: int,
  amountCents: int,
  perTaskCapCents: int,
  dailySpentCents: int,
  dailyCapCents: int,
  monthlySpentCents: int,
  monthlyCapCents: int,
  billingArmed: bool,
  lockdown: bool,
  useSlopCash: bool,
  slopCashEnabled: bool
): bool =
  amountCents > 0
    and amountCents <= perTaskCapCents
    and dailySpentCents >= 0
    and dailySpentCents + amountCents <= dailyCapCents
    and monthlySpentCents >= 0
    and monthlySpentCents + amountCents <= monthlyCapCents
    and (tier <= 2 or (billingArmed and not(lockdown)))
    and (not(useSlopCash) or slopCashEnabled)

pure def lawSpendRespectsCaps(
  tier: int,
  amountCents: int,
  perTaskCapCents: int,
  dailySpentCents: int,
  dailyCapCents: int,
  monthlySpentCents: int,
  monthlyCapCents: int,
  billingArmed: bool,
  lockdown: bool,
  useSlopCash: bool,
  slopCashEnabled: bool
): bool =
  canAuthorizeSpend(
    tier, amountCents, perTaskCapCents, dailySpentCents, dailyCapCents,
    monthlySpentCents, monthlyCapCents, billingArmed, lockdown, useSlopCash, slopCashEnabled
  ) implies (
    amountCents > 0
      and amountCents <= perTaskCapCents
      and dailySpentCents >= 0
      and dailySpentCents + amountCents <= dailyCapCents
      and monthlySpentCents >= 0
      and monthlySpentCents + amountCents <= monthlyCapCents
  )

pure def lawSlopCashBlockedWhenDisabled(
  tier: int,
  amountCents: int,
  perTaskCapCents: int,
  dailySpentCents: int,
  dailyCapCents: int,
  monthlySpentCents: int,
  monthlyCapCents: int,
  billingArmed: bool,
  lockdown: bool
): bool =
  not(canAuthorizeSpend(
    tier, amountCents, perTaskCapCents, dailySpentCents, dailyCapCents,
    monthlySpentCents, monthlyCapCents, billingArmed, lockdown, true, false
  ))

pure def lawLockdownBlocksTier3And4(
  tier: int,
  amountCents: int,
  perTaskCapCents: int,
  dailySpentCents: int,
  dailyCapCents: int,
  monthlySpentCents: int,
  monthlyCapCents: int,
  billingArmed: bool,
  useSlopCash: bool,
  slopCashEnabled: bool
): bool =
  (tier > 2) implies not(canAuthorizeSpend(
    tier, amountCents, perTaskCapCents, dailySpentCents, dailyCapCents,
    monthlySpentCents, monthlyCapCents, billingArmed, true, useSlopCash, slopCashEnabled
  ))
```

### Only open-source developer bounties may use the slop.cash payout rail

The `slop.cash` rail is restricted strictly to `oss_dev_bounty` tasks. Consumer street-team, event-activation, creator-video, and agency tasks never authorize on `slop.cash` even when `slopCashEnabled` is true.

```quint
pure def isOssDevBounty(taskKindIsOssDev: bool): bool =
  taskKindIsOssDev

pure def canAuthorizeTaskSpend(
  tier: int,
  amountCents: int,
  perTaskCapCents: int,
  dailySpentCents: int,
  dailyCapCents: int,
  monthlySpentCents: int,
  monthlyCapCents: int,
  billingArmed: bool,
  lockdown: bool,
  useSlopCash: bool,
  slopCashEnabled: bool,
  taskKindIsOssDev: bool
): bool =
  canAuthorizeSpend(
    tier, amountCents, perTaskCapCents, dailySpentCents, dailyCapCents,
    monthlySpentCents, monthlyCapCents, billingArmed, lockdown, useSlopCash, slopCashEnabled
  ) and (not(useSlopCash) or isOssDevBounty(taskKindIsOssDev))

pure def lawConsumerTaskNeverUsesSlopCash(
  tier: int,
  amountCents: int,
  perTaskCapCents: int,
  dailySpentCents: int,
  dailyCapCents: int,
  monthlySpentCents: int,
  monthlyCapCents: int,
  billingArmed: bool,
  lockdown: bool,
  slopCashEnabled: bool
): bool =
  not(canAuthorizeTaskSpend(
    tier, amountCents, perTaskCapCents, dailySpentCents, dailyCapCents,
    monthlySpentCents, monthlyCapCents, billingArmed, lockdown, true, slopCashEnabled, false
  ))
```

### Human street-team and creator payouts require complete proof and verified adult status

A submitted proof is approved only when it carries an evidence URL, FTC disclosure, valid geolocation and time window, verified signups or completed shift evidence, a verified adult worker aged 18 through 120, and a non-banned worker.

```quint
pure def canApproveProof(
  hasEvidenceUrl: bool,
  ftcDisclosed: bool,
  geoTimeValid: bool,
  verifiedSignupsOrShiftDone: bool,
  workerAge: int,
  workerBanned: bool
): bool =
  hasEvidenceUrl
    and ftcDisclosed
    and geoTimeValid
    and verifiedSignupsOrShiftDone
    and adultParticipantAge(workerAge)
    and not(workerBanned)

pure def lawUnderageNeverPaid(
  hasEvidenceUrl: bool,
  ftcDisclosed: bool,
  geoTimeValid: bool,
  verifiedSignupsOrShiftDone: bool,
  workerAge: int,
  workerBanned: bool
): bool =
  (workerAge < marketingAdultAge or workerAge > marketingMaxAge) implies
    not(canApproveProof(hasEvidenceUrl, ftcDisclosed, geoTimeValid, verifiedSignupsOrShiftDone, workerAge, workerBanned))

pure def lawProofRequiresEvidenceAndAdult(
  hasEvidenceUrl: bool,
  ftcDisclosed: bool,
  geoTimeValid: bool,
  verifiedSignupsOrShiftDone: bool,
  workerAge: int,
  workerBanned: bool
): bool =
  canApproveProof(hasEvidenceUrl, ftcDisclosed, geoTimeValid, verifiedSignupsOrShiftDone, workerAge, workerBanned) implies (
    hasEvidenceUrl
      and ftcDisclosed
      and geoTimeValid
      and verifiedSignupsOrShiftDone
      and adultParticipantAge(workerAge)
      and not(workerBanned)
  )
```

### Creator video proofs also require signed commercial likeness releases

Whenever a proof requires commercial likeness releases (such as NY Civil Rights Law sections 50-51 street-interview videos), `hasRelease` must be true before proof approval succeeds.

```quint
pure def likenessReleaseOk(needsRelease: bool, hasRelease: bool): bool =
  not(needsRelease) or hasRelease

pure def canApproveCreatorProof(
  hasEvidenceUrl: bool,
  ftcDisclosed: bool,
  geoTimeValid: bool,
  verifiedSignupsOrShiftDone: bool,
  workerAge: int,
  workerBanned: bool,
  needsRelease: bool,
  hasRelease: bool
): bool =
  canApproveProof(
    hasEvidenceUrl, ftcDisclosed, geoTimeValid, verifiedSignupsOrShiftDone, workerAge, workerBanned
  ) and likenessReleaseOk(needsRelease, hasRelease)

pure def lawCreatorProofRequiresLikenessRelease(
  hasEvidenceUrl: bool,
  ftcDisclosed: bool,
  geoTimeValid: bool,
  verifiedSignupsOrShiftDone: bool,
  workerAge: int,
  workerBanned: bool
): bool =
  not(canApproveCreatorProof(
    hasEvidenceUrl, ftcDisclosed, geoTimeValid, verifiedSignupsOrShiftDone, workerAge, workerBanned, true, false
  ))
```

## Story: Enforce anti-fraud payout caps, BD deal bounds, and bandit eligibility

> As a campaign operator, I want referral bonuses, contractor payouts, venue deals, and bandit budget arms to stay inside hard anti-fraud, tax, verification, and safety thresholds.

### Anti-fraud payout checks block VoIP, cap prepaid/MVNO and lifetime consumer bonuses, enforce W-9 over $500, and block duplicates or quarantined clusters

An anti-fraud payout check requires `tier >= 1`, a positive payout amount, non-negative prior lifetime and annual totals, a non-VoIP phone line, at most 200 cents ($2) for prepaid or MVNO carriers, at most 2,000 cents ($20) cumulative lifetime consumer referral bonus for tiers below 4, a verified W-9 whenever cumulative annual worker payouts exceed 50,000 cents ($500), no duplicate media hash, and no Sybil cluster quarantine.

```quint
pure val mvnoBonusCapCents: int = 200
pure val consumerLifetimeBonusCapCents: int = 2000
pure val w9AnnualThresholdCents: int = 50000

pure def antiFraudPayoutAllowed(
  tier: int,
  amountCents: int,
  isPrepaidOrMvno: bool,
  isVoip: bool,
  priorLifetimeCents: int,
  annualWorkerCents: int,
  hasW9: bool,
  mediaDuplicate: bool,
  clusterQuarantined: bool
): bool =
  tier >= 1
    and amountCents > 0
    and priorLifetimeCents >= 0
    and annualWorkerCents >= 0
    and not(isVoip)
    and (not(isPrepaidOrMvno) or amountCents <= mvnoBonusCapCents)
    and (tier >= 4 or priorLifetimeCents + amountCents <= consumerLifetimeBonusCapCents)
    and (annualWorkerCents + amountCents <= w9AnnualThresholdCents or hasW9)
    and not(mediaDuplicate)
    and not(clusterQuarantined)

pure def lawVoipNeverPaid(
  tier: int,
  amountCents: int,
  isPrepaidOrMvno: bool,
  priorLifetimeCents: int,
  annualWorkerCents: int,
  hasW9: bool,
  mediaDuplicate: bool,
  clusterQuarantined: bool
): bool =
  not(antiFraudPayoutAllowed(
    tier, amountCents, isPrepaidOrMvno, true, priorLifetimeCents, annualWorkerCents, hasW9, mediaDuplicate, clusterQuarantined
  ))

pure def lawMvnoBonusCappedAt200(
  tier: int,
  amountCents: int,
  isVoip: bool,
  priorLifetimeCents: int,
  annualWorkerCents: int,
  hasW9: bool,
  mediaDuplicate: bool,
  clusterQuarantined: bool
): bool =
  (amountCents > mvnoBonusCapCents) implies not(antiFraudPayoutAllowed(
    tier, amountCents, true, isVoip, priorLifetimeCents, annualWorkerCents, hasW9, mediaDuplicate, clusterQuarantined
  ))

pure def lawConsumerLifetimeCapNeverExceeded(
  tier: int,
  amountCents: int,
  isPrepaidOrMvno: bool,
  isVoip: bool,
  priorLifetimeCents: int,
  annualWorkerCents: int,
  hasW9: bool,
  mediaDuplicate: bool,
  clusterQuarantined: bool
): bool =
  (tier < 4 and priorLifetimeCents + amountCents > consumerLifetimeBonusCapCents) implies not(antiFraudPayoutAllowed(
    tier, amountCents, isPrepaidOrMvno, isVoip, priorLifetimeCents, annualWorkerCents, hasW9, mediaDuplicate, clusterQuarantined
  ))

pure def lawW9RequiredOver500Usd(
  tier: int,
  amountCents: int,
  isPrepaidOrMvno: bool,
  isVoip: bool,
  priorLifetimeCents: int,
  annualWorkerCents: int,
  mediaDuplicate: bool,
  clusterQuarantined: bool
): bool =
  (annualWorkerCents + amountCents > w9AnnualThresholdCents) implies not(antiFraudPayoutAllowed(
    tier, amountCents, isPrepaidOrMvno, isVoip, priorLifetimeCents, annualWorkerCents, false, mediaDuplicate, clusterQuarantined
  ))

pure def lawDuplicateOrQuarantinedBlocked(
  tier: int,
  amountCents: int,
  isPrepaidOrMvno: bool,
  isVoip: bool,
  priorLifetimeCents: int,
  annualWorkerCents: int,
  hasW9: bool
): bool =
  not(antiFraudPayoutAllowed(
    tier, amountCents, isPrepaidOrMvno, isVoip, priorLifetimeCents, annualWorkerCents, hasW9, true, false
  )) and not(antiFraudPayoutAllowed(
    tier, amountCents, isPrepaidOrMvno, isVoip, priorLifetimeCents, annualWorkerCents, hasW9, false, true
  ))
```

### Automated BD venue deals stay inside venue budget bounds and require phone callback and signed contract

A BD venue deal passes autonomous approval only when `offeredCents` and `maxVenueCents` are non-negative, `offeredCents <= maxVenueCents`, the venue business phone callback succeeded, and the clickwrap contract is signed.

```quint
pure def bdDealWithinBounds(
  offeredCents: int,
  maxVenueCents: int,
  hasPhoneCallback: bool,
  contractSigned: bool
): bool =
  offeredCents >= 0
    and maxVenueCents >= 0
    and offeredCents <= maxVenueCents
    and hasPhoneCallback
    and contractSigned

pure def lawBdDealRequiresBoundsCallbackAndContract(
  offeredCents: int,
  maxVenueCents: int,
  hasPhoneCallback: bool,
  contractSigned: bool
): bool =
  bdDealWithinBounds(offeredCents, maxVenueCents, hasPhoneCallback, contractSigned) implies (
    offeredCents >= 0
      and offeredCents <= maxVenueCents
      and hasPhoneCallback
      and contractSigned
  )
```

### Bandit arms stay eligible only within CPA and STOP-rate ceilings

A bandit allocation arm remains eligible for spend only when its observed CPA is non-negative and at or below `maxCpaCents`, and its STOP rate in basis points is non-negative and at or below `maxStopRateBps` (default 500 bps = 5%).

```quint
pure val banditMaxStopRateBps: int = 500

pure def banditArmEligible(
  cpaCents: int,
  maxCpaCents: int,
  stopRateBps: int,
  maxStopRateBps: int
): bool =
  cpaCents >= 0
    and maxCpaCents >= 0
    and cpaCents <= maxCpaCents
    and stopRateBps >= 0
    and maxStopRateBps >= 0
    and stopRateBps <= maxStopRateBps

pure def lawBanditKillsHighCpaOrStopRate(
  cpaCents: int,
  maxCpaCents: int,
  stopRateBps: int,
  maxStopRateBps: int
): bool =
  (cpaCents > maxCpaCents or stopRateBps > maxStopRateBps) implies not(banditArmEligible(
    cpaCents, maxCpaCents, stopRateBps, maxStopRateBps
  ))
```

## Story: Enforce agent subscription caps and the global STOP fence

> As a contact or operator, I want subscription-connected agents and outreach channels to obey daily quotas, lockdown mode, and STOP opt-outs without exception.

### Agent turns and direct outreach stop immediately on STOP, ban, lockdown, or cap exhaustion

An agent turn may dispatch only when the agent is not paused, not rate-limited, has a healthy session, has remaining daily turn quota (`0 <= turnsToday < dailyTurnCap`), the target contact is not STOPped, and lockdown is off. Direct outreach may send only when the contact is neither STOPped nor banned, lockdown is off, and daily outreach volume remains below its cap.

```quint
pure def canDispatchAgentTurn(
  agentPaused: bool,
  rateLimited: bool,
  sessionHealthy: bool,
  turnsToday: int,
  dailyTurnCap: int,
  targetStopped: bool,
  lockdown: bool
): bool =
  not(agentPaused)
    and not(rateLimited)
    and sessionHealthy
    and turnsToday >= 0
    and turnsToday < dailyTurnCap
    and not(targetStopped)
    and not(lockdown)

pure def canSendOutreach(
  targetStopped: bool,
  targetBanned: bool,
  lockdown: bool,
  sentToday: int,
  dailyOutreachCap: int
): bool =
  not(targetStopped)
    and not(targetBanned)
    and not(lockdown)
    and sentToday >= 0
    and sentToday < dailyOutreachCap

pure def lawStopFenceBlocksAgentAndOutreach(
  agentPaused: bool,
  rateLimited: bool,
  sessionHealthy: bool,
  turnsToday: int,
  dailyTurnCap: int,
  targetBanned: bool,
  lockdown: bool,
  sentToday: int,
  dailyOutreachCap: int
): bool =
  not(canDispatchAgentTurn(agentPaused, rateLimited, sessionHealthy, turnsToday, dailyTurnCap, true, lockdown))
    and not(canSendOutreach(true, targetBanned, lockdown, sentToday, dailyOutreachCap))
```

## Story: Enforce daily LLM budgets, queue backpressure, and cross-surface contact hygiene

> As an operator, I want every marketing LLM call, paid intake wave, and outbound contact touch to stay inside daily token and cost ceilings, pause when platform review or outbound queues back up, and block minors, stopped or banned contacts, quiet-hours cold touches, and spam streaks.

### Daily LLM calls stay within token and cost ceilings

A marketing LLM call may proceed only when prior daily tokens and estimated call tokens are non-negative, the daily token ceiling is positive, their sum stays at or below `dailyTokenCap`, prior daily cost and estimated call cost in microdollars are non-negative, the daily cost ceiling is positive, and their sum stays at or below `dailyCostCapMicros`.

```quint
pure def llmBudgetWithinCaps(
  tokensUsedToday: int,
  estimatedTokens: int,
  dailyTokenCap: int,
  costMicrosToday: int,
  estimatedCostMicros: int,
  dailyCostCapMicros: int
): bool =
  tokensUsedToday >= 0
    and estimatedTokens >= 0
    and dailyTokenCap > 0
    and tokensUsedToday + estimatedTokens <= dailyTokenCap
    and costMicrosToday >= 0
    and estimatedCostMicros >= 0
    and dailyCostCapMicros > 0
    and costMicrosToday + estimatedCostMicros <= dailyCostCapMicros

pure def lawTokenCapBlocksLlm(
  tokensUsedToday: int,
  estimatedTokens: int,
  dailyTokenCap: int,
  costMicrosToday: int,
  estimatedCostMicros: int,
  dailyCostCapMicros: int
): bool =
  (tokensUsedToday + estimatedTokens > dailyTokenCap) implies not(llmBudgetWithinCaps(
    tokensUsedToday, estimatedTokens, dailyTokenCap, costMicrosToday, estimatedCostMicros, dailyCostCapMicros
  ))

pure def lawCostCapBlocksLlm(
  tokensUsedToday: int,
  estimatedTokens: int,
  dailyTokenCap: int,
  costMicrosToday: int,
  estimatedCostMicros: int,
  dailyCostCapMicros: int
): bool =
  (costMicrosToday + estimatedCostMicros > dailyCostCapMicros) implies not(llmBudgetWithinCaps(
    tokensUsedToday, estimatedTokens, dailyTokenCap, costMicrosToday, estimatedCostMicros, dailyCostCapMicros
  ))
```

### Paid acquisition pauses when platform queues or messaging lines are under pressure

Paid intake pauses whenever a platform messaging line is restricted, any review item is overdue (`reviewOverdue > 0`), open review items reach or pass `reviewBacklogLimit`, or waiting outbound messages reach or pass `outboundBacklogLimit`.

```quint
pure def queuePressurePaused(
  lineRestricted: bool,
  reviewOverdue: int,
  reviewOpen: int,
  reviewBacklogLimit: int,
  outboundWaiting: int,
  outboundBacklogLimit: int
): bool =
  lineRestricted
    or reviewOverdue > 0
    or reviewOpen >= reviewBacklogLimit
    or outboundWaiting >= outboundBacklogLimit

pure def lawLineRestrictedPausesPaid(
  reviewOverdue: int,
  reviewOpen: int,
  reviewBacklogLimit: int,
  outboundWaiting: int,
  outboundBacklogLimit: int
): bool =
  queuePressurePaused(true, reviewOverdue, reviewOpen, reviewBacklogLimit, outboundWaiting, outboundBacklogLimit)

pure def lawOverdueReviewPausesPaid(
  lineRestricted: bool,
  reviewOverdue: int,
  reviewOpen: int,
  reviewBacklogLimit: int,
  outboundWaiting: int,
  outboundBacklogLimit: int
): bool =
  (reviewOverdue > 0) implies queuePressurePaused(
    lineRestricted, reviewOverdue, reviewOpen, reviewBacklogLimit, outboundWaiting, outboundBacklogLimit
  )
```

### Cross-surface contact safety and cooldowns block minors, opt-outs, bans, quiet hours, and spam streaks

A person may be contacted by marketing only when they are not stopped, not banned, not a known minor (`isKnownMinor == false`), and lockdown is off. Cold outreach also requires non-quiet hours, at least 14 days since the prior cold touch (`coldCooldownDays`), fewer than 2 cold touches in 30 days (`maxColdTouches30d`), and fewer than 2 unanswered cold touches (`maxUnansweredCold`). Operational follow-ups require fewer than 3 touches today (`maxOpTouchesPerDay`).

```quint
pure val coldCooldownDays: int = 14
pure val maxColdTouches30d: int = 2
pure val maxUnansweredCold: int = 2
pure val maxOpTouchesPerDay: int = 3

pure def contactSafetyEligible(
  isStopped: bool,
  isBanned: bool,
  isKnownMinor: bool,
  lockdown: bool
): bool =
  not(isStopped)
    and not(isBanned)
    and not(isKnownMinor)
    and not(lockdown)

pure def lawKnownMinorNeverContacted(
  isStopped: bool,
  isBanned: bool,
  lockdown: bool
): bool =
  not(contactSafetyEligible(isStopped, isBanned, true, lockdown))

pure def lawStoppedNeverContacted(
  isBanned: bool,
  isKnownMinor: bool,
  lockdown: bool
): bool =
  not(contactSafetyEligible(true, isBanned, isKnownMinor, lockdown))

pure def contactCooldownAllowed(
  isCold: bool,
  isQuietHours: bool,
  daysSinceCold: int,
  coldTouches30d: int,
  unansweredCold: int,
  opTouchesToday: int
): bool =
  if (isCold) (
    not(isQuietHours)
      and daysSinceCold >= coldCooldownDays
      and coldTouches30d >= 0
      and coldTouches30d < maxColdTouches30d
      and unansweredCold >= 0
      and unansweredCold < maxUnansweredCold
  ) else (
    opTouchesToday >= 0 and opTouchesToday < maxOpTouchesPerDay
  )

pure def lawColdCooldownBlocksEarlyTouch(
  isQuietHours: bool,
  daysSinceCold: int,
  coldTouches30d: int,
  unansweredCold: int,
  opTouchesToday: int
): bool =
  (daysSinceCold < coldCooldownDays) implies not(contactCooldownAllowed(
    true, isQuietHours, daysSinceCold, coldTouches30d, unansweredCold, opTouchesToday
  ))

pure def lawUnansweredStreakStopsCold(
  isQuietHours: bool,
  daysSinceCold: int,
  coldTouches30d: int,
  unansweredCold: int,
  opTouchesToday: int
): bool =
  (unansweredCold >= maxUnansweredCold) implies not(contactCooldownAllowed(
    true, isQuietHours, daysSinceCold, coldTouches30d, unansweredCold, opTouchesToday
  ))
```

## Story: Gate Apollo enrichment credits, 10-platform outreach risk, and out-of-network quality intake

> As an operator, I want Apollo enrichment credits to respect daily and monthly caps and contact safety, every platform touch to fail closed on high report risk or unsolicited links, and out-of-network candidates to receive at most one warm Network invite only after verified adult age, high quality, delivered value, and healthy queue pressure.

### Apollo enrichment credits obey daily and monthly caps, billing arming, lockdown, suppression, and adult-only safety

Zero-credit search calls proceed whenever lockdown, suppression, and known-minor flags are all false. Paid credit requests (`requestedCredits > 0`) additionally require `billingArmed` to be true and cumulative daily and monthly credits to remain within `dailyCreditCap` and `monthlyCreditCap`.

```quint
pure val maxPlatformReportRisk: int = 24
pure val minIntakeQualityScore: int = 70

pure def canAuthorizeApolloCredits(
  creditsUsedToday: int,
  requestedCredits: int,
  dailyCreditCap: int,
  creditsUsedMonth: int,
  monthlyCreditCap: int,
  billingArmed: bool,
  lockdown: bool,
  isSuppressed: bool,
  isKnownMinor: bool
): bool =
  requestedCredits >= 0
    and creditsUsedToday >= 0
    and creditsUsedMonth >= 0
    and dailyCreditCap >= 0
    and monthlyCreditCap >= 0
    and not(lockdown)
    and not(isSuppressed)
    and not(isKnownMinor)
    and (requestedCredits == 0 or (
      billingArmed
        and creditsUsedToday + requestedCredits <= dailyCreditCap
        and creditsUsedMonth + requestedCredits <= monthlyCreditCap
    ))

pure def lawApolloCreditsRespectCapsAndSafety(
  creditsUsedToday: int,
  requestedCredits: int,
  dailyCreditCap: int,
  creditsUsedMonth: int,
  monthlyCreditCap: int,
  billingArmed: bool,
  lockdown: bool,
  isSuppressed: bool,
  isKnownMinor: bool
): bool =
  canAuthorizeApolloCredits(
    creditsUsedToday, requestedCredits, dailyCreditCap,
    creditsUsedMonth, monthlyCreditCap, billingArmed,
    lockdown, isSuppressed, isKnownMinor
  ) implies (
    not(lockdown)
      and not(isSuppressed)
      and not(isKnownMinor)
      and (requestedCredits == 0 or (
        billingArmed
          and creditsUsedToday + requestedCredits <= dailyCreditCap
          and creditsUsedMonth + requestedCredits <= monthlyCreditCap
      ))
  )
```

### Platform outreach fails closed on suspended channels, high report risk, or unsolicited links on link-free platforms

Dispatching a platform touch requires an active non-suspended channel, passed contact safety and cooldown checks, remaining daily quota (`0 <= sentToday < effectiveDailyCap`), report risk within `0..24` (`maxPlatformReportRisk`), and zero unsolicited URLs when the platform requires link-free messaging.

```quint
pure def canDispatchPlatformTouch(
  sentToday: int,
  effectiveDailyCap: int,
  reportRiskScore: int,
  hasUnsolicitedUrl: bool,
  requiresLinkFree: bool,
  contactSafe: bool,
  cooldownAllowed: bool,
  channelSuspended: bool
): bool =
  not(channelSuspended)
    and contactSafe
    and cooldownAllowed
    and sentToday >= 0
    and effectiveDailyCap > 0
    and sentToday < effectiveDailyCap
    and reportRiskScore >= 0
    and reportRiskScore <= maxPlatformReportRisk
    and (not(requiresLinkFree) or not(hasUnsolicitedUrl))

pure def lawHighReportRiskOrSuspendedBlocked(
  sentToday: int,
  effectiveDailyCap: int,
  reportRiskScore: int,
  hasUnsolicitedUrl: bool,
  requiresLinkFree: bool,
  contactSafe: bool,
  cooldownAllowed: bool,
  channelSuspended: bool
): bool =
  (channelSuspended or reportRiskScore > maxPlatformReportRisk or (requiresLinkFree and hasUnsolicitedUrl))
    implies not(canDispatchPlatformTouch(
      sentToday, effectiveDailyCap, reportRiskScore,
      hasUnsolicitedUrl, requiresLinkFree, contactSafe, cooldownAllowed, channelSuspended
    ))
```

### Out-of-network quality intake invites verified high-signal adults at most once after delivering value

Promoting an out-of-network candidate into a warm Network invite requires verified adult age (`18..120`), quality score between `70` and `100` inclusive (`minIntakeQualityScore`), prior concrete value delivery, an explicit positive signal, clean contact safety, no platform queue backpressure pause, and zero prior invites.

```quint
pure def canPromoteOutOfNetworkCandidate(
  statedAge: int,
  qualityScore: int,
  valueDelivered: bool,
  explicitPositiveSignal: bool,
  contactSafe: bool,
  queuePaused: bool,
  priorInviteCount: int
): bool =
  adultParticipantAge(statedAge)
    and qualityScore >= minIntakeQualityScore
    and qualityScore <= 100
    and valueDelivered
    and explicitPositiveSignal
    and contactSafe
    and not(queuePaused)
    and priorInviteCount == 0

pure def lawIntakeRequiresAdultQualityValueAndOnceOnly(
  statedAge: int,
  qualityScore: int,
  valueDelivered: bool,
  explicitPositiveSignal: bool,
  contactSafe: bool,
  queuePaused: bool,
  priorInviteCount: int
): bool =
  canPromoteOutOfNetworkCandidate(
    statedAge, qualityScore, valueDelivered,
    explicitPositiveSignal, contactSafe, queuePaused, priorInviteCount
  ) implies (
    adultParticipantAge(statedAge)
      and qualityScore >= minIntakeQualityScore
      and valueDelivered
      and explicitPositiveSignal
      and contactSafe
      and not(queuePaused)
      and priorInviteCount == 0
  )

pure val tierValues = Set(0, 1, 2, 3, 4)
pure val amountCentsValues = Set(-10, 0, 100, 200, 400, 500)
pure val perTaskCapCentsValues = Set(0, 400)
pure val dailySpentCentsValues = Set(-1, 0, 300, 500)
pure val dailyCapCentsValues = Set(0, 500)
pure val monthlySpentCentsValues = Set(-1, 0, 600, 1000)
pure val monthlyCapCentsValues = Set(0, 1000)
pure val workerAgeValues = Set(-1, 0, 16, 17, 18, 24, 120, 121)
pure val priorLifetimeCentsValues = Set(-1, 0, 1800, 2000)
pure val annualWorkerCentsValues = Set(-1, 0, 49800, 50000)
pure val offeredCentsValues = Set(-1, 0, 200, 500)
pure val maxVenueCentsValues = Set(0, 200)
pure val cpaCentsValues = Set(-1, 0, 850, 2200)
pure val maxCpaCentsValues = Set(0, 2125)
pure val stopRateBpsValues = Set(-1, 0, 300, 500, 600)
pure val maxStopRateBpsValues = Set(0, 500)
pure val turnsTodayValues = Set(-1, 0, 1, 2)
pure val dailyTurnCapValues = Set(0, 2)
pure val sentTodayValues = Set(-1, 0, 1, 2)
pure val dailyOutreachCapValues = Set(0, 2)
pure val tokensUsedTodayValues = Set(-1, 0, 800, 1000)
pure val estimatedTokensValues = Set(-1, 0, 200, 300)
pure val dailyTokenCapValues = Set(0, 1000)
pure val costMicrosTodayValues = Set(-1, 0, 400, 500)
pure val estimatedCostMicrosValues = Set(-1, 0, 100, 200)
pure val dailyCostCapMicrosValues = Set(0, 500)
pure val reviewOverdueValues = Set(0, 1, 2)
pure val reviewOpenValues = Set(0, 10, 20)
pure val reviewBacklogLimitValues = Set(10, 20)
pure val outboundWaitingValues = Set(0, 50, 100)
pure val outboundBacklogLimitValues = Set(50, 100)
pure val daysSinceColdValues = Set(0, 7, 13, 14, 30)
pure val coldTouches30dValues = Set(-1, 0, 1, 2)
pure val unansweredColdValues = Set(-1, 0, 1, 2)
pure val opTouchesTodayValues = Set(-1, 0, 2, 3)
pure val creditsUsedTodayValues = Set(-1, 0, 49, 50)
pure val requestedCreditsValues = Set(-1, 0, 1, 5)
pure val dailyCreditCapValues = Set(0, 50)
pure val creditsUsedMonthValues = Set(-1, 0, 999, 1000)
pure val monthlyCreditCapValues = Set(0, 1000)
pure val effectiveDailyCapValues = Set(0, 2, 8)
pure val reportRiskScoreValues = Set(-1, 0, 24, 25, 50)
pure val statedAgeValues = Set(-1, 16, 17, 18, 30, 120, 121)
pure val qualityScoreValues = Set(-1, 40, 69, 70, 95, 101)
pure val priorInviteCountValues = Set(-1, 0, 1, 2)
```
