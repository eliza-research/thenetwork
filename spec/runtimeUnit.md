# Run a stored network unit of work

The [runtime model](models/runtime_ops.md) follows the store lock, saved state, provider work, and recovery across processes. This module governs the run order after a store lock is obtained, startup delivery choice, and tick follow-up. The [VibeLang serving shell](../packages/core/src/vibe/runtimeUnitShell.vibe) runs the generated transitions around the effects. The stores retain the lock, transactions, and serial queue.

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

Under the lock, load the latest state. If the store has a snapshot, import it before running the action. Otherwise use the initialized network. Save the state once after the action returns. A load, import, action, or save error stops the normal path and reaches the caller as the original failure. The runtime hands off delivery after the save, using committed messages or the durable queue.

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

### Runtime follow-up depends on the adapter and whether the tick ran

The registry can disable matching in loaded state. At startup, an adapter with a durable queue recovers waiting work and loads the network before draining. Other adapters repair the current notification projection. Each tick can drain and flush deliveries even when it skips the network lock. Only a tick that ran invokes its configured follow-up hook or repairs projections for an adapter without a durable queue.

```quint
pure def matchingDisabledByRegistry(matchingAllowed: bool): bool = not(matchingAllowed)

type StartupPlan = RecoverDeliveryQueue | RepairProjection

pure def startupPlan(queuedAdapter: bool): StartupPlan =
  if (queuedAdapter) RecoverDeliveryQueue else RepairProjection

pure def tickRepairsProjection(ran: bool, queuedAdapter: bool): bool = ran and not(queuedAdapter)
pure def tickRunsFollowup(ran: bool, hookConfigured: bool): bool = ran and hookConfigured
```
