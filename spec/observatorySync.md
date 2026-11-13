# Observatory snapshot and live updates

The browser requests a full snapshot and receives live deltas for one app and mode. The shell owns HTTP, WebSocket tickets, payload decoding, and panel data. The sync rules decide which response owns the view and which deltas can change it. See the [standalone Observatory model](models/observatory_sync.md) for reveal and filter behavior.

## Story: See the selected app and mode

> As a staff member, I want the console to show current data for the app and mode I opened.

### Changing the view invalidates the old snapshot and pending reads

The browser starts in game mode with no snapshot. A different app or mode invalidates every earlier load, resets the version, and empties the view until a snapshot arrives.

```quint
type SnapshotPhase = Unsynced | Loading | Live
type ObservatorySync = {
  appName: str, viewMode: str, generation: int, phase: SnapshotPhase, version: int
}

pure val initial: ObservatorySync = {
  appName: "ntwrk", viewMode: "game", generation: 0, phase: Unsynced, version: 0,
}

pure def canChangeView(s: ObservatorySync, appName: str, viewMode: str): bool =
  appName != s.appName or viewMode != s.viewMode

pure def changeView(s: ObservatorySync, appName: str, viewMode: str): ObservatorySync =
  { appName: appName, viewMode: viewMode, generation: s.generation + 1, phase: Unsynced, version: 0 }
```

### Only the current load can publish or fail a snapshot

Starting a load takes ownership of the buffer. A full response may replace the view only while that load owns it and still belongs to the same app and mode. A current failure leaves the view unsynchronized. Earlier results cannot end the current load.

```quint
pure def startLoad(s: ObservatorySync): ObservatorySync =
  { ...s, generation: s.generation + 1, phase: Loading }

pure def ownsLoad(s: ObservatorySync, generation: int): bool =
  s.phase == Loading and s.generation == generation

pure def canPublishSnapshot(s: ObservatorySync, generation: int, appName: str, viewMode: str): bool =
  ownsLoad(s, generation) and s.appName == appName and s.viewMode == viewMode

pure def publishSnapshot(s: ObservatorySync, generation: int, appName: str, viewMode: str, version: int): ObservatorySync =
  { ...s, phase: Live, version: version }

pure def canFailLoad(s: ObservatorySync, generation: int): bool = ownsLoad(s, generation)
pure def failLoad(s: ObservatorySync, generation: int): ObservatorySync = { ...s, phase: Unsynced }

pure def stepReadGenerationNeverFalls(before: ObservatorySync, after: ObservatorySync): bool =
  after.generation >= before.generation

pure def sometimesSnapshotIsLive(s: ObservatorySync): bool = s.phase == Live
```

## Story: Follow live updates without replaying changes

> As a staff member, I want live review and feed updates to agree with the full snapshot.

### Only the next data version can change the view

A reset requests a new snapshot. Non-reset deltas wait during a load. An unsynchronized view or a missing version also requires a full load. Drop older deltas. A same-version delta can refresh the clock, game state, and network metadata. Apply member, opportunity, edge, and feed changes only for the next version.

```quint
type DeltaAction = BufferDelta | ReloadSnapshot | DropDelta | RefreshMetadata | ApplyData

pure def deltaAction(s: ObservatorySync, version: int, resetSignal: bool): DeltaAction =
  if (resetSignal) ReloadSnapshot
  else if (s.phase == Loading) BufferDelta
  else if (s.phase == Unsynced) ReloadSnapshot
  else if (version < s.version) DropDelta
  else if (version == s.version) RefreshMetadata
  else if (version > s.version + 1) ReloadSnapshot
  else ApplyData

pure def canAcceptDelta(s: ObservatorySync, version: int): bool = deltaAction(s, version, false) == ApplyData
pure def acceptDelta(s: ObservatorySync, version: int): ObservatorySync = { ...s, version: version }

pure def stepDeltasAdvanceOneVersion(before: ObservatorySync, via: str, after: ObservatorySync): bool =
  (via == "acceptDelta") implies (before.phase == Live and after.version == before.version + 1)
```

### The activity feed adds each new sequence once

A full snapshot can already include some events from a later delta. While appending that delta, accept only an event whose sequence exceeds the current feed tail. An empty feed accepts its first event.

```quint
pure def acceptsFeedItem(hasTail: bool, tailSeq: int, itemSeq: int): bool =
  not(hasTail) or itemSeq > tailSeq
```
