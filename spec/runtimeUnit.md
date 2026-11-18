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

A tick that reaches its engine run under the lock does not compute there. It records the engine request from the state that it loaded, ends that unit without a save, and releases the lock. The engine run, with its model judge, then computes without the lock, so inbound turns and staff actions do not wait for it. A second unit waits for the lock, loads the newest state, ticks again, and uses the computed result in place of the engine call. While a computation of this store is in flight, a new tick does not start. A tick computes at most twice; when its commit still asks for a different run, the tick saves nothing and the next tick starts again. Changed (audit OPS23): the engine and its model judge ran under the lock, so a signed turn waited behind the daily run past the 8 second turn limit.

```quint
pure val maxEngineAttempts: int = 2

pure def tickMayStartBesideEngine(engineInFlight: bool): bool = not(engineInFlight)

pure def engineAttemptAllowed(attempt: int): bool = attempt >= 0 and attempt < maxEngineAttempts

pure def lawComputingTickSkips(engineInFlight: bool): bool = engineInFlight implies not(tickMayStartBesideEngine(engineInFlight))

pure def lawEngineAttemptsBounded(attempt: int): bool = engineAttemptAllowed(attempt) implies attempt < maxEngineAttempts
```

### A prepared engine result commits only for members whose evidence did not change

The commit uses the computed result only for the same run: the same run key (the kind of run and its New York day), the same engine configuration, and the same evidence that names no member. Otherwise the tick computes again. A proposal, an engine question, or a standing row of the result commits only when every member that it names has the same engine evidence in the commit's input as in the input that was computed. The commit then applies every eligibility gate of the tick to the newest state (opt-out, blocks, age, holds, bans), and the delivery queue checks consent and bans again at send time. Changed (audit OPS23): new with the lock-free engine run, so that a member who stopped, was banned, or changed during the run is not contacted from the old snapshot.

```quint
pure def preparedRunUsable(sameKey: bool, sameConfig: bool, sameSharedEvidence: bool): bool =
  sameKey and sameConfig and sameSharedEvidence

pure def preparedItemCommits(runUsable: bool, membersUnchanged: bool): bool = runUsable and membersUnchanged

pure def lawChangedMemberNeverCommits(runUsable: bool, membersUnchanged: bool): bool =
  not(membersUnchanged) implies not(preparedItemCommits(runUsable, membersUnchanged))

pure def lawStaleRunNeverCommits(sameKey: bool, sameConfig: bool, sameSharedEvidence: bool, membersUnchanged: bool): bool =
  not(preparedRunUsable(sameKey, sameConfig, sameSharedEvidence))
    implies not(preparedItemCommits(preparedRunUsable(sameKey, sameConfig, sameSharedEvidence), membersUnchanged))
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
