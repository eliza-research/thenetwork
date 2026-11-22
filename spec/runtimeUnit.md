# Run a stored network unit of work

The [runtime model](models/runtime_ops.md) follows the store lock, saved state, provider work, and recovery across processes. This module governs the run order after a store lock is obtained, startup delivery choice, and tick follow-up. The [VibeLang serving shell](../packages/core/src/vibe/runtimeUnitShell.vibe) runs the generated transitions around the effects. The stores retain the lock, transactions, and serial queue.

The shell also owns these effects, which the rules below do not model. When a load, import, action, or save fails, the shell applies no further transition, so the unit never records a save, and the caller gets the original failure. On every tick, the shell drains and flushes deliveries, also when the tick skips the network lock.

## Story: Work from the latest saved network state

> As an operator, I want a tick, inbound action, or review decision to load the current state before changing it, then publish only its saved work.

### A tick skips a busy store while an inbound or staff action waits

A tick does not queue behind a local lock holder or waiter. The Postgres store must also obtain the database lock before running a tick. An inbound or staff action waits through the normal blocking lock path. Requests that need the lock preserve their existing queue order.

```quint
pure def tickMayTryLock(locallyBusy: bool): bool = not(locallyBusy)

pure def tickMayEnter(acquired: bool): bool = acquired

pure def lawBusyTickSkips(locallyBusy: bool): bool = locallyBusy implies not(tickMayTryLock(locallyBusy))
```

### Restore a saved snapshot before running and make one save after success

Under the lock, load the latest state. If the store has a snapshot, import it before running the action. Otherwise use the initialized network. Save the state once after the action returns. A save is recorded only after the action. The runtime hands off delivery after the save, using committed messages or the durable queue.

```quint
type UnitPhase = LoadingSnapshot | RestoringSnapshot | RunningAction | SavingState | StateSaved
type RuntimeUnit = { phase: UnitPhase }

pure val initial: RuntimeUnit = { phase: LoadingSnapshot }

pure def canRecordLoad(unit: RuntimeUnit): bool = unit.phase == LoadingSnapshot
pure def recordLoad(unit: RuntimeUnit, snapshotFound: bool): RuntimeUnit =
  { phase: if (snapshotFound) RestoringSnapshot else RunningAction }

pure def canRecordRestore(unit: RuntimeUnit): bool = unit.phase == RestoringSnapshot
pure def recordRestore(unit: RuntimeUnit): RuntimeUnit = { phase: RunningAction }

pure def canRecordAction(unit: RuntimeUnit): bool = unit.phase == RunningAction
pure def recordAction(unit: RuntimeUnit): RuntimeUnit = { phase: SavingState }

pure def canRecordSave(unit: RuntimeUnit): bool = unit.phase == SavingState
pure def recordSave(unit: RuntimeUnit): RuntimeUnit = { phase: StateSaved }

pure def stepSaveFollowsAction(before: RuntimeUnit, via: str, after: RuntimeUnit): bool =
  after.phase == StateSaved implies (before.phase == SavingState and via == "recordSave")

pure def sometimesCanSave(unit: RuntimeUnit): bool = unit.phase == StateSaved
```

### The engine runs on a snapshot outside the store lock

A tick that reaches its engine run under the lock does not compute there. It records the engine request from the state that it loaded, ends that unit without a save, and releases the lock. The engine run, with its model judge, then computes without the lock, so inbound turns and staff actions do not wait for it. A second unit waits for the lock, loads the newest state, ticks again, and uses the computed result in place of the engine call. While a computation of this store is in flight in this process, a new tick of this process does not start. A tick of another process can still take the free lock; its commit then loads the newest state, so it never commits the same daily run twice, but each such process pays for its own engine run and model judge (docs/deploy.md asks for one ticking replica for this reason). A tick computes at most twice; when its commit still asks for a different run, the tick saves nothing and the next tick starts again. The commit unit ticks at the time that the tick started, not at the time that the computation ended: the result is compared with an input built at that time. So the expiries, the deferred-send timing, and the last tick time of that commit are late by the compute time; the delivery queue checks quiet hours, caps, consent, and bans again at send time with its own clock. Changed (audit OPS23): the engine and its model judge ran under the lock, so a signed turn waited behind the daily run past the 8 second turn limit. Changed (OPS23 review): the rule now records the late commit time and the cost of a second process.

```quint
pure val maxEngineAttempts: int = 2

pure def tickMayStartBesideEngine(engineInFlight: bool): bool = not(engineInFlight)

pure def engineAttemptAllowed(attempt: int): bool = attempt >= 0 and attempt < maxEngineAttempts

pure def lawComputingTickSkips(engineInFlight: bool): bool = engineInFlight implies not(tickMayStartBesideEngine(engineInFlight))
```

### A prepared engine result commits only for members whose evidence did not change

The commit uses the computed result only for the same run: the same run key (the kind of run and its New York day), the same engine configuration, and the same shared evidence. Otherwise the tick computes again. Each entry of the engine input has one owner. A public event is its own evidence, an entry that names a member is evidence of each member that it names, and only the rest (the run time and entries that name no member and no event) is shared. A proposal, an engine question, or a standing row of the result commits only when no owner that it names (its members, and the public event that anchors a proposal) has different evidence in the commit's input than in the computed input. The commit then applies every eligibility gate of the tick to the newest state (opt-out, blocks, age, holds, bans), and the delivery queue checks consent and bans again at send time. Changed (audit OPS23): new with the lock-free engine run, so that a member who stopped, was banned, or changed during the run is not contacted from the old snapshot. Changed (OPS23 review): public events were shared evidence, so an event that started during a long run dropped the whole result and made the tick compute again; now only a proposal anchored to that event is dropped. A peon job seat is an engine member whose record names its hiring manager (`seatOwner`), so a change of the seat's posting or of the manager's company facts changes the seat's evidence. A seat proposal does not name the manager, so other changes by the manager do not drop it. The commit routes the seat to the manager from the newest state, checks the hire evidence again, and then applies every gate above to the manager. Changed (audit tickLock-r17-4): this sentence records that seat proposals rely on these commit-time gates for the manager, because the earlier text did not say how seats are owned. The prepared run also uses the calendar free/busy view that the runtime loads again before the commit unit takes the lock, not the view that it loaded for the capture unit. Changed (audit tickLock-r17-5): the runtime loaded the calendar view once for the whole tick, so a commit after a long run could offer a time that became busy during the run.

```quint
type EvidenceOwner = SharedEvidence | MemberEvidence | EventEvidence

pure def evidenceOwner(publicEvent: bool, namesMember: bool): EvidenceOwner =
  if (publicEvent) EventEvidence else if (namesMember) MemberEvidence else SharedEvidence

pure def lawMemberEntryIsNeverShared(publicEvent: bool, namesMember: bool): bool =
  namesMember implies evidenceOwner(publicEvent, namesMember) != SharedEvidence

pure def lawEventEntryIsItsOwnEvidence(publicEvent: bool, namesMember: bool): bool =
  publicEvent implies evidenceOwner(publicEvent, namesMember) == EventEvidence

pure def preparedRunUsable(sameKey: bool, sameConfig: bool, sameSharedEvidence: bool): bool =
  sameKey and sameConfig and sameSharedEvidence

pure def preparedItemCommits(runUsable: bool, named: Set[str], changed: Set[str]): bool =
  runUsable and not(named.exists(owner => changed.contains(owner)))

pure def lawChangedOwnerNeverCommits(runUsable: bool, named: Set[str], changed: Set[str], owner: str): bool =
  (named.contains(owner) and changed.contains(owner)) implies not(preparedItemCommits(runUsable, named, changed))

pure def lawUnchangedItemOfUsableRunCommits(named: Set[str], changed: Set[str]): bool =
  named.forall(owner => not(changed.contains(owner))) implies preparedItemCommits(true, named, changed)

pure def lawStaleRunNeverCommits(sameKey: bool, sameConfig: bool, sameSharedEvidence: bool, named: Set[str], changed: Set[str]): bool =
  not(preparedRunUsable(sameKey, sameConfig, sameSharedEvidence))
    implies not(preparedItemCommits(preparedRunUsable(sameKey, sameConfig, sameSharedEvidence), named, changed))
```

### Matching runs for an app only inside its launch scope

A network may run matching, and an admin may turn its matching switch on, only when its registry row (`platform.networks.matching_enabled`) allows it. Friends and peon have a narrower launch scope ([product specification](product/README.md)): their matching runs in local simulation, development and test environments, and in production only after the founder's separate live decision for that app (`<APP>_LIVE_APPROVED=1`). The Network and slop follow their registry row. The service and the admin console read this one decision: the console shows the value that the service reports and does not keep its own list. Changed (audit PER63): before, the service read only the registry row, which allows peon, and the console locked peon in every environment, so the two disagreed and production could match peon without the live decision.

```quint
pure def appMatchingLocalOnly(app: str): bool = app == "friends" or app == "peon"

pure def matchingSwitchAllowed(registryAllows: bool, app: str, production: bool, liveApproved: bool): bool =
  registryAllows and (not(appMatchingLocalOnly(app)) or not(production) or liveApproved)

pure def lawRegistryOffNeverAllowsMatching(app: str, production: bool, liveApproved: bool): bool =
  not(matchingSwitchAllowed(false, app, production, liveApproved))

pure def lawLocalOnlyAppNeedsLiveDecisionInProduction(registryAllows: bool, app: str): bool =
  appMatchingLocalOnly(app) implies not(matchingSwitchAllowed(registryAllows, app, true, false))

pure def lawLocalOnlyAppMatchesOutsideProduction(app: str, liveApproved: bool): bool =
  matchingSwitchAllowed(true, app, false, liveApproved)

pure def lawPilotAppFollowsRegistry(registryAllows: bool, app: str, production: bool, liveApproved: bool): bool =
  not(appMatchingLocalOnly(app)) implies matchingSwitchAllowed(registryAllows, app, production, liveApproved) == registryAllows
```

### Runtime follow-up depends on the adapter and whether the tick ran

The registry can disable matching in loaded state. At startup, an adapter with a durable queue recovers waiting work and loads the network before draining. Other adapters repair the current notification projection. Only a tick that ran invokes its configured follow-up hook or repairs projections for an adapter without a durable queue.

```quint
pure def matchingDisabledByRegistry(matchingAllowed: bool): bool = not(matchingAllowed)

type StartupPlan = RecoverDeliveryQueue | RepairProjection

pure def startupPlan(queuedAdapter: bool): StartupPlan =
  if (queuedAdapter) RecoverDeliveryQueue else RepairProjection

pure def tickRepairsProjection(ran: bool, queuedAdapter: bool): bool = ran and not(queuedAdapter)
pure def tickRunsFollowup(ran: bool, hookConfigured: bool): bool = ran and hookConfigured
```
