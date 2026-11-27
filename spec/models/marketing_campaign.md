# Marketing campaign

## Story: Run autonomous marketing campaigns inside strict safety and budget bounds

The `@thenetwork/marketing` app coordinates five subscription-connected brand agents, local MacBook-attached Android and iPhone devices, paid credit-card adapters, and automated NYC human street-team and creator hiring. Every transition enforces adult-only hiring, per-task/daily/monthly spend caps, `slop.cash` disablement and OSS-only rail fencing, proof verification with creator likeness releases before payout, anti-fraud bonus caps, Tier 3/4 billing and lockdown gates, agent turn quotas and session health, device battery/thermal/takeover/lease envelopes, and the global STOP fence.

### Enforce all campaign safety invariants across tasks, anti-fraud bonuses, agents, devices, and contacts

The [marketing policy](../marketingPolicy.md) and [marketing device safety](../marketingDevice.md) specs provide the generated TypeScript decisions (`packages/core/src/generated/marketingPolicy.ts` and `packages/core/src/generated/marketingDevice.ts`). This whole-flow model checks state transitions, budget release on cancellation, daily spend/quota rollover, telemetry drift and human-takeover challenges between device lease acquisition and execution, anti-fraud caps, and reachability of both happy paths and blocked safety edges.

```quint
// quint-check: max-steps=20 max-samples=4000 verify-steps=8
//
// marketing_campaign: high-level state machine for @thenetwork/marketing across
// campaign per-task/daily/monthly budget and payout gates, adult-only hiring,
// proof verification (including creator likeness releases) before payout,
// slop.cash feature-flag & OSS-only fence, anti-fraud VoIP/MVNO/lifetime/W-9 caps,
// Tier 3/4 billing and risk-dial gates, ChatGPT/Claude/Gemini/Surplus subscription
// agent quotas, physical MacBook-attached Android/iPhone device safety envelopes
// (battery, thermal min/max, warmup, lease exclusivity, takeover challenges),
// and contact STOP consent fences.
//
// SPEC MAPPING
//   - spec/marketingPolicy.md -> packages/core/src/generated/marketingPolicy.ts
//   - spec/marketingDevice.md -> packages/core/src/generated/marketingDevice.ts
//
// ABSTRACTIONS (model choices, not code defects)
//   - Budget caps are scaled so short traces saturate all three ceilings:
//       MAX_TASK_PAYOUT_CENTS    = 150 (represents $1,500 / 150,000 cents)
//       MAX_DAILY_CAP_CENTS      = 200 (represents daily circuit breaker; resets on dailyReset)
//       MAX_MONTHLY_BUDGET_CENTS = 300 (represents monthly campaign ceiling)
//     so a 200-unit task tests the per-task ceiling, 150 + 100 tests the daily
//     ceiling, and 150 + 150 + 100 across days tests the monthly ceiling.
//   - Daily caps are scaled to 2 (AGENT_DAILY_QUOTA = 2, DEVICE_WARMUP_CAP = 2)
//     so short traces reach quota exhaustion and daily reset.
//   - Physical device telemetry is sampled over boundary and interior values:
//     battery in {20, 35, 55, 80, 92} (safe 35..80) and temperature in
//     {-5, 0, 32, 41, 45} C (safe 0..41). Telemetry and takeover challenges can
//     drift between lease acquisition and execution; execution re-checks and aborts.
//   - Anti-fraud bonus caps use exact production cent thresholds:
//     MVNO_BONUS_CAP_CENTS = 200 ($2), CONSUMER_LIFETIME_CAP_CENTS = 2000 ($20).
//   - slopCashEnabled defaults to false in init (feature flag OFF until approved).
module marketing_campaign {

  // ---------------------------------------------------------------- constants
  pure val MAX_MONTHLY_BUDGET_CENTS = 300
  pure val MAX_DAILY_CAP_CENTS = 200
  pure val MAX_TASK_PAYOUT_CENTS = 150
  pure val MIN_ADULT_AGE = 18
  pure val MAX_ADULT_AGE = 120

  pure val MVNO_BONUS_CAP_CENTS = 200
  pure val CONSUMER_LIFETIME_CAP_CENTS = 2000

  pure val SAFE_BATTERY_MIN = 35
  pure val SAFE_BATTERY_MAX = 80
  pure val SAFE_TEMP_MIN = 0
  pure val SAFE_TEMP_MAX = 41
  pure val DEVICE_WARMUP_CAP = 2
  pure val AGENT_DAILY_QUOTA = 2

  pure val DAILY_LLM_TOKEN_CAP = 1000
  pure val DAILY_LLM_COST_MICROS_CAP = 500
  pure val COLD_COOLDOWN_DAYS = 14
  pure val MAX_COLD_TOUCHES_30D = 2
  pure val MAX_UNANSWERED_COLD = 2

  pure val TASKS = Set("t1", "t2", "t3", "t4")
  pure val WORKERS = Set("adult_a", "adult_b", "minor_16", "unknown_age")
  pure val AGENTS = Set("chadwick", "sloane", "peon", "venn", "operator")
  pure val DEVICES = Set("android_1", "iphone_1")
  pure val CONTACTS = Set("c1", "c2", "c3")
  pure val LINE_TYPES = Set("postpaid", "mvno", "voip")

  pure val RAILS = Set("fiat_stripe", "fiat_tremendous", "slop_cash")
  pure val RISK_DIALS = Set("conservative", "balanced", "blitz", "lockdown")
  pure val AMOUNTS = Set(100, 150, 200)
  pure val BONUS_AMOUNTS = Set(200, 500, 1500)
  pure val BATTERY_SAMPLES = Set(20, 35, 55, 80, 92)
  pure val TEMP_SAMPLES = Set(-5, 0, 32, 41, 45)
  pure val LLM_TOKEN_SAMPLES = Set(200, 500, 600)
  pure val LLM_COST_SAMPLES = Set(100, 250, 300)

  // ---------------------------------------------------------------- types
  type WorkerInfo = { ageKnown: bool, ageYears: int }

  type Task = {
    status: str,
    tier: int,
    worker: str,
    amountCents: int,
    rail: str,
    hasMediaUrl: bool,
    hasFtcDisclosure: bool,
    hasShiftOrScanEvidence: bool,
    hasLikenessRelease: bool,
    proofVerified: bool,
  }

  type AgentState = {
    provider: str,
    turnsToday: int,
    dailyQuota: int,
    sessionHealthy: bool,
    optedOut: bool,
    rateLimited: bool,
  }

  type DeviceState = {
    platform: str,
    batteryPct: int,
    tempC: int,
    actionsToday: int,
    warmupCap: int,
    activeLeases: int,
    leaseOwner: str,
    needsTakeover: bool,
  }

  type ContactState = {
    stopped: bool,
    banned: bool,
    knownMinor: bool,
    lifetimeBonusCents: int,
    daysSinceCold: int,
    coldTouches30d: int,
    unansweredCold: int,
  }

  type LlmCallEvent = {
    seq: int,
    agent: str,
    tokensBefore: int,
    tokensEst: int,
    costBefore: int,
    costEst: int,
  }

  type HireEvent = {
    taskId: str,
    worker: str,
    amountCents: int,
    rail: str,
  }

  type PaidEvent = {
    taskId: str,
    tier: int,
    worker: str,
    amountCents: int,
    totalSpendAfter: int,
    rail: str,
    slopCashEnabled: bool,
    proofVerified: bool,
    hasMediaUrl: bool,
    hasFtcDisclosure: bool,
    hasShiftOrScanEvidence: bool,
    hasLikenessRelease: bool,
  }

  type BonusPaidEvent = {
    seq: int,
    contact: str,
    lineType: str,
    amountCents: int,
    lifetimeAfter: int,
    mediaDuplicate: bool,
    clusterQuarantined: bool,
  }

  type TierDispatchEvent = {
    tier: int,
    billingArmed: bool,
    riskDial: str,
  }

  type AgentDispatchEvent = {
    seq: int,
    agent: str,
    provider: str,
    turnsBefore: int,
    dailyQuota: int,
    sessionHealthy: bool,
    optedOut: bool,
    rateLimited: bool,
    riskDial: str,
    contact: str,
    contactStopped: bool,
    contactBanned: bool,
    contactKnownMinor: bool,
  }

  type OutreachEvent = {
    seq: int,
    contact: str,
    tier: int,
    contactStopped: bool,
    contactBanned: bool,
    contactKnownMinor: bool,
    daysSinceCold: int,
    coldTouches30d: int,
    unansweredCold: int,
  }

  type DeviceExecEvent = {
    seq: int,
    device: str,
    platform: str,
    batteryPct: int,
    tempC: int,
    actionsBefore: int,
    warmupCap: int,
    leasesAtExec: int,
    needsTakeover: bool,
    riskDial: str,
  }

  type State = {
    billingArmed: bool,
    riskDial: str,
    slopCashEnabled: bool,
    dailySpentCents: int,
    llmTokensToday: int,
    llmCostMicrosToday: int,
    tasks: str -> Task,
    agents: str -> AgentState,
    devices: str -> DeviceState,
    contacts: str -> ContactState,
    nextSeq: int,
    hiredEvents: Set[HireEvent],
    paidEvents: Set[PaidEvent],
    bonusPaidEvents: Set[BonusPaidEvent],
    dispatchedTiers: Set[TierDispatchEvent],
    agentDispatches: Set[AgentDispatchEvent],
    outreachSent: Set[OutreachEvent],
    deviceExecutions: Set[DeviceExecEvent],
    llmCalls: Set[LlmCallEvent],
    blockedUnderage: int,
    blockedBudget: int,
    blockedSlopCash: int,
    blockedProof: int,
    blockedBillingGate: int,
    blockedAgentCap: int,
    blockedDeviceEnvelope: int,
    blockedStopFence: int,
    blockedAntiFraud: int,
    blockedLlmBudget: int,
    blockedContactFence: int,
  }

  var s: State

  // ---------------------------------------------------------------- static tables
  pure val WORKERS_INFO: str -> WorkerInfo = Map(
    "adult_a" -> { ageKnown: true, ageYears: 24 },
    "adult_b" -> { ageKnown: true, ageYears: 18 },
    "minor_16" -> { ageKnown: true, ageYears: 16 },
    "unknown_age" -> { ageKnown: false, ageYears: 0 }
  )

  pure val AGENT_PROVIDER: str -> str = Map(
    "chadwick" -> "chatgpt",
    "sloane" -> "claude",
    "peon" -> "gemini",
    "venn" -> "claude",
    "operator" -> "chatgpt"
  )

  pure val DEVICE_PLATFORM: str -> str = Map(
    "android_1" -> "android",
    "iphone_1" -> "ios"
  )

  pure val NO_TASK: Task = {
    status: "none",
    tier: 0,
    worker: "",
    amountCents: 0,
    rail: "",
    hasMediaUrl: false,
    hasFtcDisclosure: false,
    hasShiftOrScanEvidence: false,
    hasLikenessRelease: false,
    proofVerified: false,
  }

  // ---------------------------------------------------------------- pure core decisions
  pure def isAdult(ageKnown: bool, ageYears: int): bool =
    ageKnown and ageYears >= MIN_ADULT_AGE and ageYears <= MAX_ADULT_AGE

  pure def workerIsAdult(w: str): bool =
    WORKERS_INFO.keys().contains(w) and
      isAdult(WORKERS_INFO.get(w).ageKnown, WORKERS_INFO.get(w).ageYears)

  pure def proofComplete(
    hasMediaUrl: bool,
    hasFtcDisclosure: bool,
    hasShiftOrScanEvidence: bool,
    hasLikenessRelease: bool
  ): bool =
    hasMediaUrl and hasFtcDisclosure and hasShiftOrScanEvidence and hasLikenessRelease

  pure def taskCommittedCents(t: Task): int =
    if (t.status == "authorized" or t.status == "hired" or t.status == "paid") t.amountCents else 0

  pure def totalSpendCents(ts: str -> Task): int =
    TASKS.fold(0, (acc, id) => acc + taskCommittedCents(ts.get(id)))

  pure def tierBillingAllowed(tier: int, billingArmed: bool, riskDial: str): bool =
    if (tier == 3 or tier == 4) (billingArmed and riskDial != "lockdown") else true

  pure def railAllowed(rail: str, slopCashEnabled: bool): bool =
    rail != "slop_cash" or slopCashEnabled

  pure def budgetFits(currentSpend: int, dailySpent: int, amountCents: int): bool =
    amountCents > 0 and
      amountCents <= MAX_TASK_PAYOUT_CENTS and
      dailySpent + amountCents <= MAX_DAILY_CAP_CENTS and
      currentSpend + amountCents <= MAX_MONTHLY_BUDGET_CENTS

  pure def bonusAllowed(
    lineType: str,
    amountCents: int,
    priorLifetime: int,
    mediaDuplicate: bool,
    clusterQuarantined: bool
  ): bool = and {
    amountCents > 0,
    lineType != "voip",
    lineType != "mvno" or amountCents <= MVNO_BONUS_CAP_CENTS,
    priorLifetime + amountCents <= CONSUMER_LIFETIME_CAP_CENTS,
    not(mediaDuplicate),
    not(clusterQuarantined),
  }

  pure def canDispatchAgent(ag: AgentState, ct: ContactState, riskDial: str): bool = and {
    ag.turnsToday < ag.dailyQuota,
    ag.sessionHealthy,
    not(ag.optedOut),
    not(ag.rateLimited),
    not(ct.stopped),
    not(ct.banned),
    not(ct.knownMinor),
    riskDial != "lockdown",
  }

  pure def coldCooldownOk(ct: ContactState): bool = and {
    ct.daysSinceCold >= COLD_COOLDOWN_DAYS,
    ct.coldTouches30d >= 0,
    ct.coldTouches30d < MAX_COLD_TOUCHES_30D,
    ct.unansweredCold >= 0,
    ct.unansweredCold < MAX_UNANSWERED_COLD,
  }

  pure def canSendOutreach(ct: ContactState, tier: int, billingArmed: bool, riskDial: str): bool = and {
    not(ct.stopped),
    not(ct.banned),
    not(ct.knownMinor),
    coldCooldownOk(ct),
    riskDial != "lockdown",
    tierBillingAllowed(tier, billingArmed, riskDial),
  }

  pure def llmCallFits(tokensUsed: int, estTokens: int, costUsed: int, estCost: int): bool = and {
    tokensUsed >= 0,
    estTokens >= 0,
    tokensUsed + estTokens <= DAILY_LLM_TOKEN_CAP,
    costUsed >= 0,
    estCost >= 0,
    costUsed + estCost <= DAILY_LLM_COST_MICROS_CAP,
  }

  pure def deviceEnvelopeOk(
    batteryPct: int,
    tempC: int,
    actionsToday: int,
    warmupCap: int,
    needsTakeover: bool,
    riskDial: str
  ): bool = and {
    batteryPct >= SAFE_BATTERY_MIN,
    batteryPct <= SAFE_BATTERY_MAX,
    tempC >= SAFE_TEMP_MIN,
    tempC <= SAFE_TEMP_MAX,
    actionsToday < warmupCap,
    not(needsTakeover),
    riskDial != "lockdown",
  }

  pure def canAcquireDeviceLease(dev: DeviceState, riskDial: str): bool = and {
    dev.activeLeases == 0,
    deviceEnvelopeOk(dev.batteryPct, dev.tempC, dev.actionsToday, dev.warmupCap, dev.needsTakeover, riskDial),
  }

  pure def canExecuteDeviceAction(dev: DeviceState, riskDial: str): bool = and {
    dev.activeLeases == 1,
    deviceEnvelopeOk(dev.batteryPct, dev.tempC, dev.actionsToday, dev.warmupCap, dev.needsTakeover, riskDial),
  }

  // ---------------------------------------------------------------- init
  action initWith(armed: bool, dial: str, slopEnabled: bool): bool = all {
    s' = {
      billingArmed: armed,
      riskDial: dial,
      slopCashEnabled: slopEnabled,
      dailySpentCents: 0,
      llmTokensToday: 0,
      llmCostMicrosToday: 0,
      tasks: TASKS.mapBy(_ => NO_TASK),
      agents: AGENTS.mapBy(a => {
        provider: AGENT_PROVIDER.get(a),
        turnsToday: 0,
        dailyQuota: AGENT_DAILY_QUOTA,
        sessionHealthy: true,
        optedOut: false,
        rateLimited: false,
      }),
      devices: DEVICES.mapBy(d => {
        platform: DEVICE_PLATFORM.get(d),
        batteryPct: 60,
        tempC: 34,
        actionsToday: 0,
        warmupCap: DEVICE_WARMUP_CAP,
        activeLeases: 0,
        leaseOwner: "",
        needsTakeover: false,
      }),
      contacts: CONTACTS.mapBy(_ => {
        stopped: false,
        banned: false,
        knownMinor: false,
        lifetimeBonusCents: 0,
        daysSinceCold: COLD_COOLDOWN_DAYS,
        coldTouches30d: 0,
        unansweredCold: 0,
      }),
      nextSeq: 1,
      hiredEvents: Set(),
      paidEvents: Set(),
      bonusPaidEvents: Set(),
      dispatchedTiers: Set(),
      agentDispatches: Set(),
      outreachSent: Set(),
      deviceExecutions: Set(),
      llmCalls: Set(),
      blockedUnderage: 0,
      blockedBudget: 0,
      blockedSlopCash: 0,
      blockedProof: 0,
      blockedBillingGate: 0,
      blockedAgentCap: 0,
      blockedDeviceEnvelope: 0,
      blockedStopFence: 0,
      blockedAntiFraud: 0,
      blockedLlmBudget: 0,
      blockedContactFence: 0,
    },
  }

  action init = initWith(false, "balanced", false)

  // ---------------------------------------------------------------- operator controls
  action setBillingArmed(armed: bool): bool = all {
    s.billingArmed != armed,
    s' = { ...s, billingArmed: armed },
  }

  action setRiskDial(dial: str): bool = all {
    RISK_DIALS.contains(dial),
    s.riskDial != dial,
    s' = { ...s, riskDial: dial },
  }

  // ---------------------------------------------------------------- Tier 3 & Tier 4 tasks
  action authorizeApiTask(tid: str, amountCents: int, rail: str): bool = {
    val t = s.tasks.get(tid)
    val curSpend = totalSpendCents(s.tasks)
    all {
      t.status == "none",
      if (not(tierBillingAllowed(3, s.billingArmed, s.riskDial)))
        s' = { ...s, blockedBillingGate: s.blockedBillingGate + 1 }
      else if (not(railAllowed(rail, s.slopCashEnabled)))
        s' = { ...s, blockedSlopCash: s.blockedSlopCash + 1 }
      else if (not(budgetFits(curSpend, s.dailySpentCents, amountCents)))
        s' = { ...s, blockedBudget: s.blockedBudget + 1 }
      else
        s' = {
          ...s,
          dailySpentCents: s.dailySpentCents + amountCents,
          tasks: s.tasks.set(tid, {
            ...NO_TASK,
            status: "authorized",
            tier: 3,
            amountCents: amountCents,
            rail: rail,
          }),
          dispatchedTiers: s.dispatchedTiers.union(Set({
            tier: 3,
            billingArmed: s.billingArmed,
            riskDial: s.riskDial,
          })),
        },
    }
  }

  action hireHumanTask(tid: str, worker: str, amountCents: int, rail: str): bool = {
    val t = s.tasks.get(tid)
    val curSpend = totalSpendCents(s.tasks)
    all {
      t.status == "none",
      if (not(workerIsAdult(worker)))
        s' = { ...s, blockedUnderage: s.blockedUnderage + 1 }
      else if (not(tierBillingAllowed(4, s.billingArmed, s.riskDial)))
        s' = { ...s, blockedBillingGate: s.blockedBillingGate + 1 }
      else if (not(railAllowed(rail, s.slopCashEnabled)))
        s' = { ...s, blockedSlopCash: s.blockedSlopCash + 1 }
      else if (not(budgetFits(curSpend, s.dailySpentCents, amountCents)))
        s' = { ...s, blockedBudget: s.blockedBudget + 1 }
      else
        s' = {
          ...s,
          dailySpentCents: s.dailySpentCents + amountCents,
          tasks: s.tasks.set(tid, {
            ...NO_TASK,
            status: "hired",
            tier: 4,
            worker: worker,
            amountCents: amountCents,
            rail: rail,
          }),
          hiredEvents: s.hiredEvents.union(Set({
            taskId: tid,
            worker: worker,
            amountCents: amountCents,
            rail: rail,
          })),
          dispatchedTiers: s.dispatchedTiers.union(Set({
            tier: 4,
            billingArmed: s.billingArmed,
            riskDial: s.riskDial,
          })),
        },
    }
  }

  action submitProof(tid: str, mediaOk: bool, ftcOk: bool, shiftOk: bool, releaseOk: bool): bool = {
    val t = s.tasks.get(tid)
    val verified = proofComplete(mediaOk, ftcOk, shiftOk, releaseOk)
    all {
      t.status == "hired",
      t.tier == 4,
      s' = {
        ...s,
        tasks: s.tasks.set(tid, {
          ...t,
          hasMediaUrl: mediaOk,
          hasFtcDisclosure: ftcOk,
          hasShiftOrScanEvidence: shiftOk,
          hasLikenessRelease: releaseOk,
          proofVerified: verified,
        }),
      },
    }
  }

  action cancelTask(tid: str): bool = {
    val t = s.tasks.get(tid)
    val nextDaily = if (s.dailySpentCents >= t.amountCents) s.dailySpentCents - t.amountCents else 0
    all {
      t.status == "authorized" or t.status == "hired",
      s' = {
        ...s,
        dailySpentCents: nextDaily,
        tasks: s.tasks.set(tid, { ...t, status: "cancelled" }),
      },
    }
  }

  action payTask(tid: str, rail: str): bool = {
    val t = s.tasks.get(tid)
    all {
      t.status == "authorized" or t.status == "hired",
      if (t.tier == 4 and not(workerIsAdult(t.worker)))
        s' = { ...s, blockedUnderage: s.blockedUnderage + 1 }
      else if (not(tierBillingAllowed(t.tier, s.billingArmed, s.riskDial)))
        s' = { ...s, blockedBillingGate: s.blockedBillingGate + 1 }
      else if (not(railAllowed(rail, s.slopCashEnabled)))
        s' = { ...s, blockedSlopCash: s.blockedSlopCash + 1 }
      else if (t.tier == 4 and not(t.proofVerified and proofComplete(t.hasMediaUrl, t.hasFtcDisclosure, t.hasShiftOrScanEvidence, t.hasLikenessRelease)))
        s' = { ...s, blockedProof: s.blockedProof + 1 }
      else if (not(t.amountCents > 0 and t.amountCents <= MAX_TASK_PAYOUT_CENTS and totalSpendCents(s.tasks) <= MAX_MONTHLY_BUDGET_CENTS))
        s' = { ...s, blockedBudget: s.blockedBudget + 1 }
      else
        val paidTask = { ...t, status: "paid", rail: rail }
        val nextTasks = s.tasks.set(tid, paidTask)
        s' = {
          ...s,
          tasks: nextTasks,
          paidEvents: s.paidEvents.union(Set({
            taskId: tid,
            tier: t.tier,
            worker: t.worker,
            amountCents: t.amountCents,
            totalSpendAfter: totalSpendCents(nextTasks),
            rail: rail,
            slopCashEnabled: s.slopCashEnabled,
            proofVerified: t.proofVerified,
            hasMediaUrl: t.hasMediaUrl,
            hasFtcDisclosure: t.hasFtcDisclosure,
            hasShiftOrScanEvidence: t.hasShiftOrScanEvidence,
            hasLikenessRelease: t.hasLikenessRelease,
          })),
        },
    }
  }

  // ---------------------------------------------------------------- anti-fraud consumer referral bonuses
  action claimConsumerBonus(
    c: str,
    lineType: str,
    amountCents: int,
    mediaDuplicate: bool,
    clusterQuarantined: bool
  ): bool = {
    val ct = s.contacts.get(c)
    all {
      LINE_TYPES.contains(lineType),
      if (ct.stopped)
        s' = { ...s, blockedStopFence: s.blockedStopFence + 1 }
      else if (not(tierBillingAllowed(3, s.billingArmed, s.riskDial)))
        s' = { ...s, blockedBillingGate: s.blockedBillingGate + 1 }
      else if (not(bonusAllowed(lineType, amountCents, ct.lifetimeBonusCents, mediaDuplicate, clusterQuarantined)))
        s' = { ...s, blockedAntiFraud: s.blockedAntiFraud + 1 }
      else
        val nextLifetime = ct.lifetimeBonusCents + amountCents
        s' = {
          ...s,
          nextSeq: s.nextSeq + 1,
          contacts: s.contacts.set(c, { ...ct, lifetimeBonusCents: nextLifetime }),
          bonusPaidEvents: s.bonusPaidEvents.union(Set({
            seq: s.nextSeq,
            contact: c,
            lineType: lineType,
            amountCents: amountCents,
            lifetimeAfter: nextLifetime,
            mediaDuplicate: mediaDuplicate,
            clusterQuarantined: clusterQuarantined,
          })),
        },
    }
  }

  // ---------------------------------------------------------------- subscription agents & STOP fence
  action setAgentOptOut(a: str, optedOut: bool): bool = {
    val ag = s.agents.get(a)
    all {
      ag.optedOut != optedOut,
      s' = { ...s, agents: s.agents.set(a, { ...ag, optedOut: optedOut }) },
    }
  }

  action setAgentRateLimited(a: str, limited: bool): bool = {
    val ag = s.agents.get(a)
    all {
      ag.rateLimited != limited,
      s' = { ...s, agents: s.agents.set(a, { ...ag, rateLimited: limited }) },
    }
  }

  action setAgentSessionHealthy(a: str, healthy: bool): bool = {
    val ag = s.agents.get(a)
    all {
      ag.sessionHealthy != healthy,
      s' = { ...s, agents: s.agents.set(a, { ...ag, sessionHealthy: healthy }) },
    }
  }

  action contactSetStop(c: str, stopped: bool): bool = {
    val ct = s.contacts.get(c)
    all {
      ct.stopped != stopped,
      s' = { ...s, contacts: s.contacts.set(c, { ...ct, stopped: stopped }) },
    }
  }

  action contactSetBanned(c: str, banned: bool): bool = {
    val ct = s.contacts.get(c)
    all {
      ct.banned != banned,
      s' = { ...s, contacts: s.contacts.set(c, { ...ct, banned: banned }) },
    }
  }

  action contactSetKnownMinor(c: str, knownMinor: bool): bool = {
    val ct = s.contacts.get(c)
    all {
      ct.knownMinor != knownMinor,
      s' = { ...s, contacts: s.contacts.set(c, { ...ct, knownMinor: knownMinor }) },
    }
  }

  action dispatchLlmCall(a: str, estTokens: int, estCost: int): bool = all {
    AGENTS.contains(a),
    LLM_TOKEN_SAMPLES.contains(estTokens),
    LLM_COST_SAMPLES.contains(estCost),
    if (not(llmCallFits(s.llmTokensToday, estTokens, s.llmCostMicrosToday, estCost)))
      s' = { ...s, blockedLlmBudget: s.blockedLlmBudget + 1 }
    else
      s' = {
        ...s,
        nextSeq: s.nextSeq + 1,
        llmTokensToday: s.llmTokensToday + estTokens,
        llmCostMicrosToday: s.llmCostMicrosToday + estCost,
        llmCalls: s.llmCalls.union(Set({
          seq: s.nextSeq,
          agent: a,
          tokensBefore: s.llmTokensToday,
          tokensEst: estTokens,
          costBefore: s.llmCostMicrosToday,
          costEst: estCost,
        })),
      },
  }

  action dispatchAgentTurn(a: str, c: str): bool = {
    val ag = s.agents.get(a)
    val ct = s.contacts.get(c)
    if (ct.stopped)
      s' = { ...s, blockedStopFence: s.blockedStopFence + 1 }
    else if (ct.banned or ct.knownMinor)
      s' = { ...s, blockedContactFence: s.blockedContactFence + 1 }
    else if (not(canDispatchAgent(ag, ct, s.riskDial)))
      s' = { ...s, blockedAgentCap: s.blockedAgentCap + 1 }
    else
      s' = {
        ...s,
        nextSeq: s.nextSeq + 1,
        agents: s.agents.set(a, { ...ag, turnsToday: ag.turnsToday + 1 }),
        agentDispatches: s.agentDispatches.union(Set({
          seq: s.nextSeq,
          agent: a,
          provider: ag.provider,
          turnsBefore: ag.turnsToday,
          dailyQuota: ag.dailyQuota,
          sessionHealthy: ag.sessionHealthy,
          optedOut: ag.optedOut,
          rateLimited: ag.rateLimited,
          riskDial: s.riskDial,
          contact: c,
          contactStopped: ct.stopped,
          contactBanned: ct.banned,
          contactKnownMinor: ct.knownMinor,
        })),
      }
  }

  action sendOutreach(c: str, tier: int): bool = {
    val ct = s.contacts.get(c)
    all {
      tier == 1 or tier == 3,
      if (ct.stopped)
        s' = { ...s, blockedStopFence: s.blockedStopFence + 1 }
      else if (ct.banned or ct.knownMinor or not(coldCooldownOk(ct)))
        s' = { ...s, blockedContactFence: s.blockedContactFence + 1 }
      else if (not(canSendOutreach(ct, tier, s.billingArmed, s.riskDial)))
        s' = { ...s, blockedBillingGate: s.blockedBillingGate + 1 }
      else
        s' = {
          ...s,
          nextSeq: s.nextSeq + 1,
          contacts: s.contacts.set(c, {
            ...ct,
            daysSinceCold: 0,
            coldTouches30d: ct.coldTouches30d + 1,
            unansweredCold: ct.unansweredCold + 1,
          }),
          outreachSent: s.outreachSent.union(Set({
            seq: s.nextSeq,
            contact: c,
            tier: tier,
            contactStopped: ct.stopped,
            contactBanned: ct.banned,
            contactKnownMinor: ct.knownMinor,
            daysSinceCold: ct.daysSinceCold,
            coldTouches30d: ct.coldTouches30d,
            unansweredCold: ct.unansweredCold,
          })),
          dispatchedTiers: if (tier == 3)
            s.dispatchedTiers.union(Set({ tier: 3, billingArmed: s.billingArmed, riskDial: s.riskDial }))
          else s.dispatchedTiers,
        },
    }
  }

  // ---------------------------------------------------------------- physical devices (MacBook bridge)
  action deviceTelemetryUpdate(d: str, batteryPct: int, tempC: int): bool = {
    val dev = s.devices.get(d)
    all {
      BATTERY_SAMPLES.contains(batteryPct),
      TEMP_SAMPLES.contains(tempC),
      s' = { ...s, devices: s.devices.set(d, { ...dev, batteryPct: batteryPct, tempC: tempC }) },
    }
  }

  action setDeviceNeedsTakeover(d: str, takeover: bool): bool = {
    val dev = s.devices.get(d)
    all {
      dev.needsTakeover != takeover,
      s' = { ...s, devices: s.devices.set(d, { ...dev, needsTakeover: takeover }) },
    }
  }

  action deviceAcquireLease(d: str, owner: str): bool = {
    val dev = s.devices.get(d)
    if (not(canAcquireDeviceLease(dev, s.riskDial)))
      s' = { ...s, blockedDeviceEnvelope: s.blockedDeviceEnvelope + 1 }
    else
      s' = {
        ...s,
        devices: s.devices.set(d, { ...dev, activeLeases: dev.activeLeases + 1, leaseOwner: owner }),
      }
  }

  action deviceExecuteAction(d: str): bool = {
    val dev = s.devices.get(d)
    all {
      dev.activeLeases == 1,
      if (not(canExecuteDeviceAction(dev, s.riskDial)))
        s' = {
          ...s,
          devices: s.devices.set(d, { ...dev, activeLeases: 0, leaseOwner: "" }),
          blockedDeviceEnvelope: s.blockedDeviceEnvelope + 1,
        }
      else
        s' = {
          ...s,
          nextSeq: s.nextSeq + 1,
          devices: s.devices.set(d, {
            ...dev,
            actionsToday: dev.actionsToday + 1,
            activeLeases: 0,
            leaseOwner: "",
          }),
          deviceExecutions: s.deviceExecutions.union(Set({
            seq: s.nextSeq,
            device: d,
            platform: dev.platform,
            batteryPct: dev.batteryPct,
            tempC: dev.tempC,
            actionsBefore: dev.actionsToday,
            warmupCap: dev.warmupCap,
            leasesAtExec: dev.activeLeases,
            needsTakeover: dev.needsTakeover,
            riskDial: s.riskDial,
          })),
        },
    }
  }

  action deviceReleaseLease(d: str): bool = {
    val dev = s.devices.get(d)
    all {
      dev.activeLeases == 1,
      s' = { ...s, devices: s.devices.set(d, { ...dev, activeLeases: 0, leaseOwner: "" }) },
    }
  }

  action dailyReset: bool = all {
    s' = {
      ...s,
      dailySpentCents: 0,
      llmTokensToday: 0,
      llmCostMicrosToday: 0,
      agents: AGENTS.mapBy(a => {
        val ag = s.agents.get(a)
        { ...ag, turnsToday: 0, rateLimited: false }
      }),
      devices: DEVICES.mapBy(d => {
        val dev = s.devices.get(d)
        if (dev.activeLeases == 0) { ...dev, actionsToday: 0 } else dev
      }),
    },
  }

  // ---------------------------------------------------------------- nondeterministic step
  action step = any {
    { nondet armed = Set(true, false).oneOf() setBillingArmed(armed) },
    { nondet dial = RISK_DIALS.oneOf() setRiskDial(dial) },
    {
      nondet tid = TASKS.filter(id => s.tasks.get(id).status == "none").oneOf()
      nondet amt = AMOUNTS.oneOf()
      nondet rail = RAILS.oneOf()
      authorizeApiTask(tid, amt, rail)
    },
    {
      nondet tid = TASKS.filter(id => s.tasks.get(id).status == "none").oneOf()
      nondet w = WORKERS.oneOf()
      nondet amt = AMOUNTS.oneOf()
      nondet rail = RAILS.oneOf()
      hireHumanTask(tid, w, amt, rail)
    },
    {
      nondet tid = TASKS.filter(id => s.tasks.get(id).status == "hired").oneOf()
      submitProof(tid, true, true, true, true)
    },
    {
      nondet tid = TASKS.filter(id => s.tasks.get(id).status == "hired").oneOf()
      nondet mediaOk = Set(true, false).oneOf()
      nondet ftcOk = Set(true, false).oneOf()
      nondet shiftOk = Set(true, false).oneOf()
      nondet releaseOk = Set(true, false).oneOf()
      submitProof(tid, mediaOk, ftcOk, shiftOk, releaseOk)
    },
    {
      nondet tid = TASKS.filter(id => s.tasks.get(id).status == "authorized" or s.tasks.get(id).status == "hired").oneOf()
      nondet rail = RAILS.oneOf()
      payTask(tid, rail)
    },
    {
      nondet tid = TASKS.filter(id => s.tasks.get(id).status == "authorized" or s.tasks.get(id).status == "hired").oneOf()
      cancelTask(tid)
    },
    {
      nondet c = CONTACTS.oneOf()
      nondet lt = LINE_TYPES.oneOf()
      nondet amt = BONUS_AMOUNTS.oneOf()
      nondet dup = Set(true, false).oneOf()
      nondet quar = Set(true, false).oneOf()
      claimConsumerBonus(c, lt, amt, dup, quar)
    },
    {
      nondet a = AGENTS.oneOf()
      nondet opt = Set(true, false).oneOf()
      setAgentOptOut(a, opt)
    },
    {
      nondet a = AGENTS.oneOf()
      nondet lim = Set(true, false).oneOf()
      setAgentRateLimited(a, lim)
    },
    {
      nondet a = AGENTS.oneOf()
      nondet h = Set(true, false).oneOf()
      setAgentSessionHealthy(a, h)
    },
    {
      nondet c = CONTACTS.oneOf()
      nondet st = Set(true, false).oneOf()
      contactSetStop(c, st)
    },
    {
      nondet c = CONTACTS.oneOf()
      nondet b = Set(true, false).oneOf()
      contactSetBanned(c, b)
    },
    {
      nondet c = CONTACTS.oneOf()
      nondet m = Set(true, false).oneOf()
      contactSetKnownMinor(c, m)
    },
    {
      nondet a = AGENTS.oneOf()
      nondet tok = LLM_TOKEN_SAMPLES.oneOf()
      nondet cost = LLM_COST_SAMPLES.oneOf()
      dispatchLlmCall(a, tok, cost)
    },
    {
      nondet a = AGENTS.oneOf()
      nondet c = CONTACTS.oneOf()
      dispatchAgentTurn(a, c)
    },
    {
      nondet c = CONTACTS.oneOf()
      nondet tier = Set(1, 3).oneOf()
      sendOutreach(c, tier)
    },
    {
      nondet d = DEVICES.oneOf()
      nondet bat = BATTERY_SAMPLES.oneOf()
      nondet tmp = TEMP_SAMPLES.oneOf()
      deviceTelemetryUpdate(d, bat, tmp)
    },
    {
      nondet d = DEVICES.oneOf()
      nondet tk = Set(true, false).oneOf()
      setDeviceNeedsTakeover(d, tk)
    },
    {
      nondet d = DEVICES.oneOf()
      nondet a = AGENTS.oneOf()
      deviceAcquireLease(d, a)
    },
    {
      nondet d = DEVICES.filter(id => s.devices.get(id).activeLeases == 1).oneOf()
      deviceExecuteAction(d)
    },
    {
      nondet d = DEVICES.filter(id => s.devices.get(id).activeLeases == 1).oneOf()
      deviceReleaseLease(d)
    },
    dailyReset,
  }

  // ---------------------------------------------------------------- safety invariants
  val inv_adult_only_paid = and {
    TASKS.forall(tid => {
      val t = s.tasks.get(tid)
      ((t.status == "hired" or t.status == "paid") and (t.tier == 4 or t.worker != "")) implies workerIsAdult(t.worker)
    }),
    s.hiredEvents.forall(e => workerIsAdult(e.worker)),
    s.paidEvents.forall(e => (e.tier == 4 or e.worker != "") implies workerIsAdult(e.worker)),
  }

  val inv_budget_never_exceeded = and {
    totalSpendCents(s.tasks) <= MAX_MONTHLY_BUDGET_CENTS,
    s.dailySpentCents >= 0 and s.dailySpentCents <= MAX_DAILY_CAP_CENTS,
    TASKS.forall(tid => {
      val t = s.tasks.get(tid)
      (t.status == "authorized" or t.status == "hired" or t.status == "paid") implies
        (t.amountCents > 0 and t.amountCents <= MAX_TASK_PAYOUT_CENTS)
    }),
    s.paidEvents.forall(e =>
      e.amountCents > 0 and e.amountCents <= MAX_TASK_PAYOUT_CENTS and e.totalSpendAfter <= MAX_MONTHLY_BUDGET_CENTS
    ),
  }

  val inv_slop_cash_disabled = and {
    not(s.slopCashEnabled) implies TASKS.forall(tid => not(s.tasks.get(tid).status == "paid" and s.tasks.get(tid).rail == "slop_cash")),
    s.paidEvents.forall(e => e.rail == "slop_cash" implies e.slopCashEnabled),
  }

  val inv_proof_required_before_payout = and {
    TASKS.forall(tid => {
      val t = s.tasks.get(tid)
      (t.tier == 4 and t.status == "paid") implies
        (t.proofVerified and proofComplete(t.hasMediaUrl, t.hasFtcDisclosure, t.hasShiftOrScanEvidence, t.hasLikenessRelease))
    }),
    s.paidEvents.forall(e =>
      e.tier == 4 implies (e.proofVerified and e.hasMediaUrl and e.hasFtcDisclosure and e.hasShiftOrScanEvidence and e.hasLikenessRelease)
    ),
  }

  val inv_tier_billing_gate =
    s.dispatchedTiers.forall(d =>
      (d.tier == 3 or d.tier == 4) implies (d.billingArmed and d.riskDial != "lockdown")
    )

  val inv_agent_subscription_cap = and {
    AGENTS.forall(a => s.agents.get(a).turnsToday >= 0 and s.agents.get(a).turnsToday <= s.agents.get(a).dailyQuota),
    s.agentDispatches.forall(d =>
      d.turnsBefore < d.dailyQuota and d.sessionHealthy and not(d.optedOut) and not(d.rateLimited) and d.riskDial != "lockdown"
    ),
  }

  val inv_device_safety_envelope = and {
    DEVICES.forall(d => {
      val dev = s.devices.get(d)
      dev.activeLeases >= 0 and dev.activeLeases <= 1 and dev.actionsToday >= 0 and dev.actionsToday <= dev.warmupCap
    }),
    s.deviceExecutions.forall(e => and {
      e.batteryPct >= SAFE_BATTERY_MIN,
      e.batteryPct <= SAFE_BATTERY_MAX,
      e.tempC >= SAFE_TEMP_MIN,
      e.tempC <= SAFE_TEMP_MAX,
      e.actionsBefore < e.warmupCap,
      e.leasesAtExec == 1,
      not(e.needsTakeover),
      e.riskDial != "lockdown",
    }),
  }

  val inv_stop_fence_respected = and {
    s.outreachSent.forall(m => not(m.contactStopped)),
    s.agentDispatches.forall(d => not(d.contactStopped)),
  }

  val inv_llm_budget_respected = and {
    s.llmTokensToday >= 0,
    s.llmTokensToday <= DAILY_LLM_TOKEN_CAP,
    s.llmCostMicrosToday >= 0,
    s.llmCostMicrosToday <= DAILY_LLM_COST_MICROS_CAP,
    s.llmCalls.forall(e =>
      e.tokensBefore >= 0 and e.tokensEst >= 0 and e.tokensBefore + e.tokensEst <= DAILY_LLM_TOKEN_CAP
        and e.costBefore >= 0 and e.costEst >= 0 and e.costBefore + e.costEst <= DAILY_LLM_COST_MICROS_CAP
    ),
  }

  val inv_contact_fence_respected = and {
    s.agentDispatches.forall(d => not(d.contactStopped) and not(d.contactBanned) and not(d.contactKnownMinor)),
    s.outreachSent.forall(m => and {
      not(m.contactStopped),
      not(m.contactBanned),
      not(m.contactKnownMinor),
      m.daysSinceCold >= COLD_COOLDOWN_DAYS,
      m.coldTouches30d < MAX_COLD_TOUCHES_30D,
      m.unansweredCold < MAX_UNANSWERED_COLD,
    }),
  }

  val inv_antifraud_caps_respected = and {
    CONTACTS.forall(c => s.contacts.get(c).lifetimeBonusCents <= CONSUMER_LIFETIME_CAP_CENTS),
    s.bonusPaidEvents.forall(b => and {
      b.lineType != "voip",
      b.lineType != "mvno" or b.amountCents <= MVNO_BONUS_CAP_CENTS,
      b.lifetimeAfter <= CONSUMER_LIFETIME_CAP_CENTS,
      not(b.mediaDuplicate),
      not(b.clusterQuarantined),
    }),
  }

  val safety = and {
    inv_adult_only_paid,
    inv_budget_never_exceeded,
    inv_slop_cash_disabled,
    inv_proof_required_before_payout,
    inv_tier_billing_gate,
    inv_agent_subscription_cap,
    inv_device_safety_envelope,
    inv_stop_fence_respected,
    inv_llm_budget_respected,
    inv_contact_fence_respected,
    inv_antifraud_caps_respected,
  }

  // ---------------------------------------------------------------- reachability witnesses
  val witness_human_paid_with_proof =
    not(s.paidEvents.exists(e => e.tier == 4 and e.proofVerified))

  val witness_agent_dispatched =
    s.agentDispatches.size() == 0

  val witness_device_action_completed =
    s.deviceExecutions.size() == 0

  val witness_spend_cap_blocks_overrun =
    s.blockedBudget == 0

  val witness_underage_blocked =
    s.blockedUnderage == 0

  val witness_proof_blocked =
    s.blockedProof == 0

  val witness_slop_cash_blocked =
    s.blockedSlopCash == 0

  val witness_stop_fence_blocked =
    s.blockedStopFence == 0

  val witness_device_envelope_blocked =
    s.blockedDeviceEnvelope == 0

  val witness_billing_gate_blocked =
    s.blockedBillingGate == 0

  val witness_antifraud_blocked =
    s.blockedAntiFraud == 0

  val witness_llm_budget_blocked =
    s.blockedLlmBudget == 0

  val witness_contact_fence_blocked =
    s.blockedContactFence == 0

  // ---------------------------------------------------------------- deterministic traces
  run humanPaidWithProofHappyPathTest =
    init
      .then(setBillingArmed(true))
      .then(hireHumanTask("t1", "adult_a", 150, "fiat_stripe"))
      .then(submitProof("t1", true, true, true, true))
      .then(payTask("t1", "fiat_stripe"))
      .then(all {
        assert(s.tasks.get("t1").status == "paid"),
        assert(s.tasks.get("t1").proofVerified),
        assert(totalSpendCents(s.tasks) == 150),
        assert(s.paidEvents.size() == 1),
        assert(safety),
        s' = s,
      })

  run underageApplicantBlockedTest =
    init
      .then(setBillingArmed(true))
      .then(hireHumanTask("t1", "minor_16", 100, "fiat_stripe"))
      .then(hireHumanTask("t1", "unknown_age", 100, "fiat_stripe"))
      .then(all {
        assert(s.tasks.get("t1").status == "none"),
        assert(s.blockedUnderage == 2),
        assert(safety),
        s' = s,
      })
      .then(hireHumanTask("t1", "adult_b", 100, "fiat_stripe"))
      .then(all {
        assert(s.tasks.get("t1").status == "hired"),
        assert(s.tasks.get("t1").worker == "adult_b"),
        assert(safety),
        s' = s,
      })

  run unverifiedProofBlockedTest =
    init
      .then(setBillingArmed(true))
      .then(hireHumanTask("t1", "adult_a", 100, "fiat_stripe"))
      .then(payTask("t1", "fiat_stripe"))
      .then(submitProof("t1", true, false, true, true))
      .then(payTask("t1", "fiat_stripe"))
      .then(submitProof("t1", true, true, true, false))
      .then(payTask("t1", "fiat_stripe"))
      .then(all {
        assert(s.tasks.get("t1").status == "hired"),
        assert(not(s.tasks.get("t1").proofVerified)),
        assert(s.blockedProof == 3),
        assert(s.paidEvents.size() == 0),
        assert(safety),
        s' = s,
      })
      .then(submitProof("t1", true, true, true, true))
      .then(payTask("t1", "fiat_stripe"))
      .then(all {
        assert(s.tasks.get("t1").status == "paid"),
        assert(safety),
        s' = s,
      })

  run overBudgetSpendBlockedTest =
    init
      .then(setBillingArmed(true))
      .then(authorizeApiTask("t1", 200, "fiat_stripe"))
      .then(authorizeApiTask("t1", 150, "fiat_stripe"))
      .then(authorizeApiTask("t2", 100, "fiat_stripe"))
      .then(dailyReset)
      .then(authorizeApiTask("t2", 150, "fiat_stripe"))
      .then(authorizeApiTask("t3", 100, "fiat_stripe"))
      .then(all {
        assert(s.blockedBudget == 3),
        assert(totalSpendCents(s.tasks) == 300),
        assert(s.tasks.get("t3").status == "none"),
        assert(safety),
        s' = s,
      })
      .then(cancelTask("t2"))
      .then(authorizeApiTask("t3", 150, "fiat_stripe"))
      .then(all {
        assert(s.tasks.get("t3").status == "authorized"),
        assert(totalSpendCents(s.tasks) == 300),
        assert(safety),
        s' = s,
      })

  run slopCashBlockedWhileDisabledTest =
    init
      .then(setBillingArmed(true))
      .then(hireHumanTask("t1", "adult_a", 100, "slop_cash"))
      .then(hireHumanTask("t1", "adult_a", 100, "fiat_stripe"))
      .then(submitProof("t1", true, true, true, true))
      .then(payTask("t1", "slop_cash"))
      .then(all {
        assert(s.tasks.get("t1").status == "hired"),
        assert(s.blockedSlopCash == 2),
        assert(s.paidEvents.size() == 0),
        assert(safety),
        s' = s,
      })
      .then(payTask("t1", "fiat_tremendous"))
      .then(all {
        assert(s.tasks.get("t1").status == "paid"),
        assert(s.tasks.get("t1").rail == "fiat_tremendous"),
        assert(safety),
        s' = s,
      })

  run tierBillingAndLockdownGateTest =
    init
      .then(authorizeApiTask("t1", 100, "fiat_stripe"))
      .then(hireHumanTask("t2", "adult_a", 100, "fiat_stripe"))
      .then(setBillingArmed(true))
      .then(setRiskDial("lockdown"))
      .then(authorizeApiTask("t1", 100, "fiat_stripe"))
      .then(hireHumanTask("t2", "adult_a", 100, "fiat_stripe"))
      .then(all {
        assert(s.blockedBillingGate == 4),
        assert(s.dispatchedTiers.size() == 0),
        assert(safety),
        s' = s,
      })
      .then(setRiskDial("conservative"))
      .then(authorizeApiTask("t1", 100, "fiat_stripe"))
      .then(all {
        assert(s.tasks.get("t1").status == "authorized"),
        assert(s.dispatchedTiers.size() == 1),
        assert(safety),
        s' = s,
      })

  run agentQuotaAndStopFenceTest =
    init
      .then(dispatchAgentTurn("chadwick", "c1"))
      .then(dispatchAgentTurn("chadwick", "c1"))
      .then(dispatchAgentTurn("chadwick", "c1"))
      .then(setAgentRateLimited("sloane", true))
      .then(dispatchAgentTurn("sloane", "c1"))
      .then(setAgentOptOut("peon", true))
      .then(dispatchAgentTurn("peon", "c1"))
      .then(setAgentSessionHealthy("operator", false))
      .then(dispatchAgentTurn("operator", "c1"))
      .then(setRiskDial("lockdown"))
      .then(dispatchAgentTurn("venn", "c1"))
      .then(setRiskDial("balanced"))
      .then(contactSetStop("c2", true))
      .then(dispatchAgentTurn("venn", "c2"))
      .then(sendOutreach("c2", 1))
      .then(all {
        assert(s.agentDispatches.size() == 2),
        assert(s.blockedAgentCap == 5),
        assert(s.blockedStopFence == 2),
        assert(s.outreachSent.size() == 0),
        assert(safety),
        s' = s,
      })
      .then(dailyReset)
      .then(dispatchAgentTurn("chadwick", "c1"))
      .then(dispatchAgentTurn("peon", "c1"))
      .then(all {
        assert(s.agentDispatches.size() == 3),
        assert(s.blockedAgentCap == 6),
        assert(safety),
        s' = s,
      })

  run deviceSafetyEnvelopeTest =
    init
      .then(deviceTelemetryUpdate("android_1", 20, 32))
      .then(deviceAcquireLease("android_1", "chadwick"))
      .then(deviceTelemetryUpdate("android_1", 92, 32))
      .then(deviceAcquireLease("android_1", "chadwick"))
      .then(deviceTelemetryUpdate("android_1", 55, -5))
      .then(deviceAcquireLease("android_1", "chadwick"))
      .then(deviceTelemetryUpdate("android_1", 55, 45))
      .then(deviceAcquireLease("android_1", "chadwick"))
      .then(deviceTelemetryUpdate("android_1", 55, 32))
      .then(setDeviceNeedsTakeover("android_1", true))
      .then(deviceAcquireLease("android_1", "chadwick"))
      .then(setDeviceNeedsTakeover("android_1", false))
      .then(deviceAcquireLease("android_1", "chadwick"))
      .then(deviceAcquireLease("android_1", "sloane"))
      .then(deviceTelemetryUpdate("android_1", 55, 45))
      .then(deviceExecuteAction("android_1"))
      .then(all {
        assert(s.blockedDeviceEnvelope == 7),
        assert(s.devices.get("android_1").activeLeases == 0),
        assert(s.devices.get("android_1").actionsToday == 0),
        assert(safety),
        s' = s,
      })
      .then(deviceTelemetryUpdate("android_1", 55, 41))
      .then(deviceAcquireLease("android_1", "chadwick"))
      .then(deviceExecuteAction("android_1"))
      .then(deviceAcquireLease("android_1", "sloane"))
      .then(deviceExecuteAction("android_1"))
      .then(deviceAcquireLease("android_1", "operator"))
      .then(all {
        assert(s.deviceExecutions.size() == 2),
        assert(s.devices.get("android_1").actionsToday == 2),
        assert(s.blockedDeviceEnvelope == 8),
        assert(safety),
        s' = s,
      })

  run antiFraudCapsTest =
    init
      .then(setBillingArmed(true))
      .then(claimConsumerBonus("c1", "voip", 200, false, false))
      .then(claimConsumerBonus("c1", "mvno", 500, false, false))
      .then(claimConsumerBonus("c1", "postpaid", 500, true, false))
      .then(claimConsumerBonus("c1", "postpaid", 500, false, true))
      .then(claimConsumerBonus("c1", "mvno", 200, false, false))
      .then(claimConsumerBonus("c1", "postpaid", 1500, false, false))
      .then(claimConsumerBonus("c1", "postpaid", 500, false, false))
      .then(all {
        assert(s.blockedAntiFraud == 5),
        assert(s.contacts.get("c1").lifetimeBonusCents == 1700),
        assert(s.bonusPaidEvents.size() == 2),
        assert(safety),
        s' = s,
      })

  run llmBudgetCapTest =
    init
      .then(dispatchLlmCall("chadwick", 600, 250))
      .then(dispatchLlmCall("sloane", 500, 100))
      .then(dispatchLlmCall("venn", 200, 300))
      .then(dispatchLlmCall("peon", 200, 250))
      .then(all {
        assert(s.llmTokensToday == 800),
        assert(s.llmCostMicrosToday == 500),
        assert(s.llmCalls.size() == 2),
        assert(s.blockedLlmBudget == 2),
        assert(safety),
        s' = s,
      })
      .then(dailyReset)
      .then(dispatchLlmCall("operator", 500, 250))
      .then(all {
        assert(s.llmTokensToday == 500),
        assert(s.llmCostMicrosToday == 250),
        assert(s.llmCalls.size() == 3),
        assert(safety),
        s' = s,
      })

  run contactFenceAndMinorBlockedTest =
    init
      .then(contactSetKnownMinor("c1", true))
      .then(contactSetBanned("c2", true))
      .then(dispatchAgentTurn("chadwick", "c1"))
      .then(sendOutreach("c1", 1))
      .then(dispatchAgentTurn("sloane", "c2"))
      .then(sendOutreach("c2", 1))
      .then(sendOutreach("c3", 1))
      .then(sendOutreach("c3", 1))
      .then(all {
        assert(s.blockedContactFence == 5),
        assert(s.outreachSent.size() == 1),
        assert(s.agentDispatches.size() == 0),
        assert(safety),
        s' = s,
      })
}
```
