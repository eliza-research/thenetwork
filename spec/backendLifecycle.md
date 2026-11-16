# Backend tick and shutdown lifecycle

The backend process uses this machine for local tick reservations and shutdown progression. The [runtime operations model](models/runtime_ops.md) also follows persisted work, peer processes, and host termination. The backend retains its timer, listener, promise, and database effects.

## Story: Run one tick per worker at a time

> As an operator, I want timer rounds to skip work that is already running, so one slow worker cannot run twice or hold up unrelated workers.

### Reserve each tick worker before starting its work

A network, inbox, retention, notification, or operations tick uses its own key. The inbox redrive uses the key `inbox`, and retention ([platform retention](platformRetention.md)) uses the key `retention`. While the process is serving, an available worker can reserve its key only if no tick owns it. Release the reservation after the worker settles, including on a failure. The shell runs the operations round beside the networks. Each round runs the inbox redrive first, then the network attempts, then retention after the network attempts settle, then the notification tick. The database owns advisory locks across processes.

```quint
type BackendPhase = Serving | StoppingListeners | WaitingForWork | ClosingClean | ClosingTimedOut | ClosedClean | ClosedTimedOut
type BackendLifecycle = { phase: BackendPhase, ticking: Set[str], timerStarted: bool, ticksFrom: int }

pure val initial: BackendLifecycle = { phase: Serving, ticking: Set(), timerStarted: false, ticksFrom: 0 }

pure def backendAcceptsWork(s: BackendLifecycle): bool = s.phase == Serving

pure def canReserveTick(s: BackendLifecycle, tickKey: str): bool =
  backendAcceptsWork(s) and not(s.ticking.contains(tickKey))
pure def reserveTick(s: BackendLifecycle, tickKey: str): BackendLifecycle =
  { ...s, ticking: s.ticking.union(Set(tickKey)) }

pure def canReleaseTick(s: BackendLifecycle, tickKey: str): bool = s.ticking.contains(tickKey)
pure def releaseTick(s: BackendLifecycle, tickKey: str): BackendLifecycle =
  { ...s, ticking: s.ticking.exclude(Set(tickKey)) }

pure def stepNewTicksRequireServing(before: BackendLifecycle, via: str, after: BackendLifecycle): bool =
  (via == "reserveTick") implies (before.phase == Serving and after.phase == Serving)
```

### A timer start records when tick monitoring began

Starting scheduled ticks while serving records the current time and starts the initial round before installing the interval. A manually requested round can also run before the timer starts. Once draining begins, a late timer-start call has no work to schedule. Health checks consider tick lateness only after the timer has started.

```quint
pure def canStartTimer(s: BackendLifecycle): bool = backendAcceptsWork(s)
pure def startTimer(s: BackendLifecycle, at: int): BackendLifecycle =
  { ...s, timerStarted: true, ticksFrom: at }

pure def sometimesTimerStarts(s: BackendLifecycle): bool = s.timerStarted
```

## Story: Drain work before closing the backend

> As an operator, I want shutdown to refuse new work, settle work already tracked by the process, and report when the grace limit cuts it short.

### The grace period covers listener and work drain

Mark the process as draining, clear the tick timer, and start the grace period before waiting for the listeners. Request a graceful stop on both listeners. Once they finish, wait for the tracked requests and ticks to settle. Only completion of both steps can produce a clean result. When either step reaches the same deadline, record an unclean result, force-close remaining connections and terminate pending database sessions. Close the service and report the result. A repeat shutdown call receives the same result.

```quint
pure def canBeginShutdown(s: BackendLifecycle): bool = backendAcceptsWork(s)
pure def beginShutdown(s: BackendLifecycle): BackendLifecycle = { ...s, phase: StoppingListeners }

pure def canRecordListenerDrain(s: BackendLifecycle): bool = s.phase == StoppingListeners
pure def recordListenerDrain(s: BackendLifecycle): BackendLifecycle = { ...s, phase: WaitingForWork }

pure def canSettleWorkDrain(s: BackendLifecycle, timedOut: bool): bool =
  s.phase == WaitingForWork or (s.phase == StoppingListeners and timedOut)
pure def settleWorkDrain(s: BackendLifecycle, timedOut: bool): BackendLifecycle =
  { ...s, phase: if (timedOut) ClosingTimedOut else ClosingClean }

pure def canRecordBackendClose(s: BackendLifecycle): bool = s.phase == ClosingClean or s.phase == ClosingTimedOut
pure def recordBackendClose(s: BackendLifecycle): BackendLifecycle =
  { ...s, phase: if (s.phase == ClosingClean) ClosedClean else ClosedTimedOut }

pure def shutdownWasClean(s: BackendLifecycle): bool = s.phase == ClosingClean or s.phase == ClosedClean

pure def stepDrainNeverReopens(before: BackendLifecycle, after: BackendLifecycle): bool =
  not(backendAcceptsWork(before)) implies not(backendAcceptsWork(after))

pure def stepCleanDrainWaitsForListeners(before: BackendLifecycle, after: BackendLifecycle): bool =
  (before.phase != ClosingClean and after.phase == ClosingClean) implies before.phase == WaitingForWork

pure def sometimesClosesCleanly(s: BackendLifecycle): bool = s.phase == ClosedClean
pure def sometimesClosesAfterGrace(s: BackendLifecycle): bool = s.phase == ClosedTimedOut
```
