# Marketing policy

Pure campaign authorization, age eligibility, proof verification, agent subscription quota, and consent fence rules shared by `@thenetwork/marketing`. Callers read campaign ledgers, proof verification metadata, agent session health, and contact consent records, then pass explicit integers and booleans to these rules.

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

pure val tierValues = Set(1, 2, 3, 4)
pure val amountCentsValues = Set(-10, 0, 100, 400, 500)
pure val perTaskCapCentsValues = Set(0, 400)
pure val dailySpentCentsValues = Set(-1, 0, 300, 500)
pure val dailyCapCentsValues = Set(0, 500)
pure val monthlySpentCentsValues = Set(-1, 0, 600, 1000)
pure val monthlyCapCentsValues = Set(0, 1000)
pure val workerAgeValues = Set(-1, 0, 16, 17, 18, 24, 120, 121)
pure val turnsTodayValues = Set(-1, 0, 1, 2)
pure val dailyTurnCapValues = Set(0, 2)
pure val sentTodayValues = Set(-1, 0, 1, 2)
pure val dailyOutreachCapValues = Set(0, 2)
```
