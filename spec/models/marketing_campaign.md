# Marketing campaign

## Story: Run autonomous marketing campaigns inside strict safety and budget bounds

The `@thenetwork/marketing` app coordinates five subscription-connected brand agents, local MacBook-attached Android and iPhone devices, paid credit-card adapters, and automated NYC human street-team and creator hiring. Every transition enforces adult-only hiring, spend caps, `slop.cash` disablement, proof verification before payout, Tier 3/4 billing and lockdown gates, agent turn quotas, device battery/thermal/lease envelopes, and the global STOP fence.

### Enforce all eight campaign safety invariants across tasks, agents, devices, and contacts

The [marketing policy](../marketingPolicy.md) and [marketing device safety](../marketingDevice.md) specs provide the generated TypeScript decisions (`packages/core/src/generated/marketingPolicy.ts` and `packages/core/src/generated/marketingDevice.ts`). This whole-flow model checks state transitions, budget release on cancellation, telemetry drift between device lease acquisition and execution, daily quota rollover, and reachability of both happy paths and blocked safety edges.

```quint
// quint-check: max-steps=20 max-samples=4000 verify-steps=8
//
// marketing_campaign: high-level state machine for @thenetwork/marketing across
// campaign budget and payout gates, adult-only hiring, proof verification before
// payout, slop.cash feature-flag fence, Tier 3/4 billing and risk-dial gates,
// ChatGPT/Claude/Gemini subscription agent quotas, physical MacBook-attached
// Android/iPhone device safety envelopes, and contact STOP consent fences.
//
// SPEC MAPPING
//   - spec/marketingPolicy.md -> packages/core/src/generated/marketingPolicy.ts
//   - spec/marketingDevice.md -> packages/core/src/generated/marketingDevice.ts
//
// ABSTRACTIONS (model choices, not code defects)
//   - Budget caps are scaled 1:1000 from production cents:
//       MAX_MONTHLY_BUDGET_CENTS = 1000 (represents $10,000 / 1,000,000 cents)
//       MAX_TASK_PAYOUT_CENTS    = 400  (represents $4,000 / 400,000 cents)
//     so 3 tasks can saturate the monthly cap and a single 500-unit task tests
//     the per-task ceiling.
//   - Daily caps are scaled to 2 (AGENT_DAILY_QUOTA = 2, DEVICE_WARMUP_CAP = 2)
//     so short traces reach quota exhaustion and daily reset.
//   - Physical device telemetry is sampled over boundary and interior values:
//     battery in {20, 35, 55, 80, 92} (safe 35..80) and temperature in
//     {32, 41, 45} C (safe <= 41). Telemetry can drift between lease acquisition
//     and action execution; execution re-checks the envelope and aborts on drift.
//   - Media URL reachability, FTC disclosure checks, and shift/QR scan
//     evidence verification are modeled as boolean oracle inputs to submitProof.
//   - slopCashEnabled defaults to false in init (feature flag OFF until approved).
module marketing_campaign {

  // ---------------------------------------------------------------- constants
  pure val MAX_MONTHLY_BUDGET_CENTS = 1000
  pure val MAX_TASK_PAYOUT_CENTS = 400
  pure val MIN_ADULT_AGE = 18

  pure val SAFE_BATTERY_MIN = 35
  pure val SAFE_BATTERY_MAX = 80
  pure val SAFE_TEMP_MAX = 41
  pure val DEVICE_WARMUP_CAP = 2
  pure val AGENT_DAILY_QUOTA = 2

  pure val TASKS = Set("t1", "t2", "t3", "t4")
  pure val WORKERS = Set("adult_a", "adult_b", "minor_16", "unknown_age")
  pure val AGENTS = Set("chadwick", "sloane", "peon", "venn", "eliza")
  pure val DEVICES = Set("android_1", "iphone_1")
  pure val CONTACTS = Set("c1", "c2", "c3")

  pure val RAILS = Set("fiat_stripe", "fiat_tremendous", "slop_cash")
  pure val RISK_DIALS = Set("normal", "conservative", "lockdown")
  pure val AMOUNTS = Set(200, 400, 500)
  pure val BATTERY_SAMPLES = Set(20, 35, 55, 80, 92)
  pure val TEMP_SAMPLES = Set(32, 41, 45)

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
    proofVerified: bool,
  }

  type AgentState = {
    provider: str,
    turnsToday: int,
    dailyQuota: int,
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
  }

  type ContactState = {
    stopped: bool,
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
    optedOut: bool,
    rateLimited: bool,
    contact: str,
    contactStopped: bool,
  }

  type OutreachEvent = {
    seq: int,
    contact: str,
    tier: int,
    contactStopped: bool,
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
  }

  type State = {
    billingArmed: bool,
    riskDial: str,
    slopCashEnabled: bool,
    tasks: str -> Task,
    agents: str -> AgentState,
    devices: str -> DeviceState,
    contacts: str -> ContactState,
    nextSeq: int,
    hiredEvents: Set[HireEvent],
    paidEvents: Set[PaidEvent],
    dispatchedTiers: Set[TierDispatchEvent],
    agentDispatches: Set[AgentDispatchEvent],
    outreachSent: Set[OutreachEvent],
    deviceExecutions: Set[DeviceExecEvent],
    blockedUnderage: int,
    blockedBudget: int,
    blockedSlopCash: int,
    blockedProof: int,
    blockedBillingGate: int,
    blockedAgentCap: int,
    blockedDeviceEnvelope: int,
    blockedStopFence: int,
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
    "venn" -> "chatgpt",
    "eliza" -> "claude"
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
    proofVerified: false,
  }

  // ---------------------------------------------------------------- pure core decisions
  pure def isAdult(ageKnown: bool, ageYears: int): bool =
    ageKnown and ageYears >= MIN_ADULT_AGE

  pure def workerIsAdult(w: str): bool =
    WORKERS_INFO.keys().contains(w) and
      isAdult(WORKERS_INFO.get(w).ageKnown, WORKERS_INFO.get(w).ageYears)

  pure def proofComplete(hasMediaUrl: bool, hasFtcDisclosure: bool, hasShiftOrScanEvidence: bool): bool =
    hasMediaUrl and hasFtcDisclosure and hasShiftOrScanEvidence

  pure def taskCommittedCents(t: Task): int =
    if (t.status == "authorized" or t.status == "hired" or t.status == "paid") t.amountCents else 0

  pure def totalSpendCents(ts: str -> Task): int =
    TASKS.fold(0, (acc, id) => acc + taskCommittedCents(ts.get(id)))

  pure def tierBillingAllowed(tier: int, billingArmed: bool, riskDial: str): bool =
    if (tier == 3 or tier == 4) (billingArmed and riskDial != "lockdown") else true

  pure def railAllowed(rail: str, slopCashEnabled: bool): bool =
    rail != "slop_cash" or slopCashEnabled

  pure def budgetFits(currentSpend: int, amountCents: int): bool =
    amountCents > 0 and
      amountCents <= MAX_TASK_PAYOUT_CENTS and
      currentSpend + amountCents <= MAX_MONTHLY_BUDGET_CENTS

  pure def canAuthorizeTask(
    tier: int,
    worker: str,
    amountCents: int,
    currentSpend: int,
    billingArmed: bool,
    riskDial: str,
    rail: str,
    slopCashEnabled: bool
  ): bool = and {
    tier == 3 or tier == 4,
    tierBillingAllowed(tier, billingArmed, riskDial),
    railAllowed(rail, slopCashEnabled),
    budgetFits(currentSpend, amountCents),
    tier != 4 or workerIsAdult(worker),
  }

  pure def canPayTask(
    t: Task,
    rail: str,
    billingArmed: bool,
    riskDial: str,
    slopCashEnabled: bool
  ): bool = and {
    (t.tier == 3 and t.status == "authorized") or (t.tier == 4 and t.status == "hired"),
    tierBillingAllowed(t.tier, billingArmed, riskDial),
    railAllowed(rail, slopCashEnabled),
    t.amountCents > 0 and t.amountCents <= MAX_TASK_PAYOUT_CENTS,
    t.tier != 4 or (workerIsAdult(t.worker) and t.proofVerified and proofComplete(t.hasMediaUrl, t.hasFtcDisclosure, t.hasShiftOrScanEvidence)),
  }

  pure def canDispatchAgent(ag: AgentState, contactStopped: bool): bool = and {
    ag.turnsToday < ag.dailyQuota,
    not(ag.optedOut),
    not(ag.rateLimited),
    not(contactStopped),
  }

  pure def canSendOutreach(contactStopped: bool, tier: int, billingArmed: bool, riskDial: str): bool = and {
    not(contactStopped),
    tierBillingAllowed(tier, billingArmed, riskDial),
  }

  pure def deviceEnvelopeOk(batteryPct: int, tempC: int, actionsToday: int, warmupCap: int): bool = and {
    batteryPct >= SAFE_BATTERY_MIN,
    batteryPct <= SAFE_BATTERY_MAX,
    tempC <= SAFE_TEMP_MAX,
    actionsToday < warmupCap,
  }

  pure def canAcquireDeviceLease(dev: DeviceState): bool = and {
    dev.activeLeases == 0,
    deviceEnvelopeOk(dev.batteryPct, dev.tempC, dev.actionsToday, dev.warmupCap),
  }

  pure def canExecuteDeviceAction(dev: DeviceState): bool = and {
    dev.activeLeases == 1,
    deviceEnvelopeOk(dev.batteryPct, dev.tempC, dev.actionsToday, dev.warmupCap),
  }

  // ---------------------------------------------------------------- init
  action initWith(armed: bool, dial: str, slopEnabled: bool): bool = all {
    s' = {
      billingArmed: armed,
      riskDial: dial,
      slopCashEnabled: slopEnabled,
      tasks: TASKS.mapBy(_ => NO_TASK),
      agents: AGENTS.mapBy(a => {
        provider: AGENT_PROVIDER.get(a),
        turnsToday: 0,
        dailyQuota: AGENT_DAILY_QUOTA,
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
      }),
      contacts: CONTACTS.mapBy(_ => { stopped: false }),
      nextSeq: 1,
      hiredEvents: Set(),
      paidEvents: Set(),
      dispatchedTiers: Set(),
      agentDispatches: Set(),
      outreachSent: Set(),
      deviceExecutions: Set(),
      blockedUnderage: 0,
      blockedBudget: 0,
      blockedSlopCash: 0,
      blockedProof: 0,
      blockedBillingGate: 0,
      blockedAgentCap: 0,
      blockedDeviceEnvelope: 0,
      blockedStopFence: 0,
    },
  }

  action init = initWith(false, "normal", false)

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
      else if (not(budgetFits(curSpend, amountCents)))
        s' = { ...s, blockedBudget: s.blockedBudget + 1 }
      else
        s' = {
          ...s,
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
      else if (not(budgetFits(curSpend, amountCents)))
        s' = { ...s, blockedBudget: s.blockedBudget + 1 }
      else
        s' = {
          ...s,
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

  action submitProof(tid: str, mediaOk: bool, ftcOk: bool, shiftOk: bool): bool = {
    val t = s.tasks.get(tid)
    val verified = proofComplete(mediaOk, ftcOk, shiftOk)
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
          proofVerified: verified,
        }),
      },
    }
  }

  action cancelTask(tid: str): bool = {
    val t = s.tasks.get(tid)
    all {
      t.status == "authorized" or t.status == "hired",
      s' = { ...s, tasks: s.tasks.set(tid, { ...t, status: "cancelled" }) },
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
      else if (t.tier == 4 and not(t.proofVerified and proofComplete(t.hasMediaUrl, t.hasFtcDisclosure, t.hasShiftOrScanEvidence)))
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

  action contactSetStop(c: str, stopped: bool): bool = {
    val ct = s.contacts.get(c)
    all {
      ct.stopped != stopped,
      s' = { ...s, contacts: s.contacts.set(c, { stopped: stopped }) },
    }
  }

  action dispatchAgentTurn(a: str, c: str): bool = {
    val ag = s.agents.get(a)
    val ct = s.contacts.get(c)
    if (ct.stopped)
      s' = { ...s, blockedStopFence: s.blockedStopFence + 1 }
    else if (ag.turnsToday >= ag.dailyQuota or ag.optedOut or ag.rateLimited)
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
          optedOut: ag.optedOut,
          rateLimited: ag.rateLimited,
          contact: c,
          contactStopped: ct.stopped,
        })),
      }
  }

  action sendOutreach(c: str, tier: int): bool = {
    val ct = s.contacts.get(c)
    all {
      tier == 1 or tier == 3,
      if (ct.stopped)
        s' = { ...s, blockedStopFence: s.blockedStopFence + 1 }
      else if (not(tierBillingAllowed(tier, s.billingArmed, s.riskDial)))
        s' = { ...s, blockedBillingGate: s.blockedBillingGate + 1 }
      else
        s' = {
          ...s,
          nextSeq: s.nextSeq + 1,
          outreachSent: s.outreachSent.union(Set({
            seq: s.nextSeq,
            contact: c,
            tier: tier,
            contactStopped: ct.stopped,
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

  action deviceAcquireLease(d: str, owner: str): bool = {
    val dev = s.devices.get(d)
    if (not(canAcquireDeviceLease(dev)))
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
      if (not(canExecuteDeviceAction(dev)))
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
      nondet mediaOk = Set(true, false).oneOf()
      nondet ftcOk = Set(true, false).oneOf()
      nondet shiftOk = Set(true, false).oneOf()
      submitProof(tid, mediaOk, ftcOk, shiftOk)
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
      nondet c = CONTACTS.oneOf()
      nondet st = Set(true, false).oneOf()
      contactSetStop(c, st)
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
        (t.proofVerified and proofComplete(t.hasMediaUrl, t.hasFtcDisclosure, t.hasShiftOrScanEvidence))
    }),
    s.paidEvents.forall(e =>
      e.tier == 4 implies (e.proofVerified and e.hasMediaUrl and e.hasFtcDisclosure and e.hasShiftOrScanEvidence)
    ),
  }

  val inv_tier_billing_gate =
    s.dispatchedTiers.forall(d =>
      (d.tier == 3 or d.tier == 4) implies (d.billingArmed and d.riskDial != "lockdown")
    )

  val inv_agent_subscription_cap = and {
    AGENTS.forall(a => s.agents.get(a).turnsToday >= 0 and s.agents.get(a).turnsToday <= s.agents.get(a).dailyQuota),
    s.agentDispatches.forall(d =>
      d.turnsBefore < d.dailyQuota and not(d.optedOut) and not(d.rateLimited)
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
      e.tempC <= SAFE_TEMP_MAX,
      e.actionsBefore < e.warmupCap,
      e.leasesAtExec == 1,
    }),
  }

  val inv_stop_fence_respected = and {
    s.outreachSent.forall(m => not(m.contactStopped)),
    s.agentDispatches.forall(d => not(d.contactStopped)),
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

  // ---------------------------------------------------------------- deterministic traces
  run humanPaidWithProofHappyPathTest =
    init
      .then(setBillingArmed(true))
      .then(hireHumanTask("t1", "adult_a", 400, "fiat_stripe"))
      .then(submitProof("t1", true, true, true))
      .then(payTask("t1", "fiat_stripe"))
      .then(all {
        assert(s.tasks.get("t1").status == "paid"),
        assert(s.tasks.get("t1").proofVerified),
        assert(totalSpendCents(s.tasks) == 400),
        assert(s.paidEvents.size() == 1),
        assert(safety),
        s' = s,
      })

  run underageApplicantBlockedTest =
    init
      .then(setBillingArmed(true))
      .then(hireHumanTask("t1", "minor_16", 200, "fiat_stripe"))
      .then(hireHumanTask("t1", "unknown_age", 200, "fiat_stripe"))
      .then(all {
        assert(s.tasks.get("t1").status == "none"),
        assert(s.blockedUnderage == 2),
        assert(safety),
        s' = s,
      })
      .then(hireHumanTask("t1", "adult_b", 200, "fiat_stripe"))
      .then(all {
        assert(s.tasks.get("t1").status == "hired"),
        assert(s.tasks.get("t1").worker == "adult_b"),
        assert(safety),
        s' = s,
      })

  run unverifiedProofBlockedTest =
    init
      .then(setBillingArmed(true))
      .then(hireHumanTask("t1", "adult_a", 200, "fiat_stripe"))
      .then(payTask("t1", "fiat_stripe"))
      .then(submitProof("t1", true, false, true))
      .then(payTask("t1", "fiat_stripe"))
      .then(all {
        assert(s.tasks.get("t1").status == "hired"),
        assert(not(s.tasks.get("t1").proofVerified)),
        assert(s.blockedProof == 2),
        assert(s.paidEvents.size() == 0),
        assert(safety),
        s' = s,
      })
      .then(submitProof("t1", true, true, true))
      .then(payTask("t1", "fiat_stripe"))
      .then(all {
        assert(s.tasks.get("t1").status == "paid"),
        assert(safety),
        s' = s,
      })

  run overBudgetSpendBlockedTest =
    init
      .then(setBillingArmed(true))
      .then(authorizeApiTask("t1", 500, "fiat_stripe"))
      .then(authorizeApiTask("t1", 400, "fiat_stripe"))
      .then(authorizeApiTask("t2", 400, "fiat_stripe"))
      .then(authorizeApiTask("t3", 200, "fiat_stripe"))
      .then(authorizeApiTask("t4", 200, "fiat_stripe"))
      .then(all {
        assert(s.blockedBudget == 2),
        assert(totalSpendCents(s.tasks) == 1000),
        assert(s.tasks.get("t4").status == "none"),
        assert(safety),
        s' = s,
      })
      .then(cancelTask("t3"))
      .then(authorizeApiTask("t4", 200, "fiat_stripe"))
      .then(all {
        assert(s.tasks.get("t4").status == "authorized"),
        assert(totalSpendCents(s.tasks) == 1000),
        assert(safety),
        s' = s,
      })

  run slopCashBlockedWhileDisabledTest =
    init
      .then(setBillingArmed(true))
      .then(hireHumanTask("t1", "adult_a", 200, "slop_cash"))
      .then(hireHumanTask("t1", "adult_a", 200, "fiat_stripe"))
      .then(submitProof("t1", true, true, true))
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
      .then(authorizeApiTask("t1", 200, "fiat_stripe"))
      .then(hireHumanTask("t2", "adult_a", 200, "fiat_stripe"))
      .then(setBillingArmed(true))
      .then(setRiskDial("lockdown"))
      .then(authorizeApiTask("t1", 200, "fiat_stripe"))
      .then(hireHumanTask("t2", "adult_a", 200, "fiat_stripe"))
      .then(all {
        assert(s.blockedBillingGate == 4),
        assert(s.dispatchedTiers.size() == 0),
        assert(safety),
        s' = s,
      })
      .then(setRiskDial("conservative"))
      .then(authorizeApiTask("t1", 200, "fiat_stripe"))
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
      .then(contactSetStop("c2", true))
      .then(dispatchAgentTurn("venn", "c2"))
      .then(sendOutreach("c2", 1))
      .then(all {
        assert(s.agentDispatches.size() == 2),
        assert(s.blockedAgentCap == 3),
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
        assert(s.blockedAgentCap == 4),
        assert(safety),
        s' = s,
      })

  run deviceSafetyEnvelopeTest =
    init
      .then(deviceTelemetryUpdate("android_1", 20, 32))
      .then(deviceAcquireLease("android_1", "chadwick"))
      .then(deviceTelemetryUpdate("android_1", 92, 32))
      .then(deviceAcquireLease("android_1", "chadwick"))
      .then(deviceTelemetryUpdate("android_1", 55, 45))
      .then(deviceAcquireLease("android_1", "chadwick"))
      .then(deviceTelemetryUpdate("android_1", 55, 32))
      .then(deviceAcquireLease("android_1", "chadwick"))
      .then(deviceAcquireLease("android_1", "sloane"))
      .then(deviceTelemetryUpdate("android_1", 55, 45))
      .then(deviceExecuteAction("android_1"))
      .then(all {
        assert(s.blockedDeviceEnvelope == 5),
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
      .then(deviceAcquireLease("android_1", "eliza"))
      .then(all {
        assert(s.deviceExecutions.size() == 2),
        assert(s.devices.get("android_1").actionsToday == 2),
        assert(s.blockedDeviceEnvelope == 6),
        assert(safety),
        s' = s,
      })
}
```
