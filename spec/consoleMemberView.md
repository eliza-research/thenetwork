# Observatory detail and photo reads

The staff console reads member, timeline, app, and opportunity details through HTTP. The browser carries a scope made from the app, mode, credentials, and selected subject. The [standalone console model](models/console_views.md) also covers the drawer and simulated proposals.

## Story: Read details for the current subject

> As a staff member, I want a refresh to update the detail I am reading without an older reply replacing it.

### Only an outstanding read in the current view can publish

Each read gets a ticket. The shell invalidates the outstanding tickets when the app, credentials, or selected detail changes. A response can publish when it has a ticket issued after the latest invalidation or accepted response. A response with a ticket at or below that boundary cannot replace the detail.

```quint
type DetailGate = { lastTicket: int, closedThrough: int }
pure val initial: DetailGate = { lastTicket: 0, closedThrough: 0 }

pure def beginDetail(gate: DetailGate): DetailGate = { ...gate, lastTicket: gate.lastTicket + 1 }
pure def cancelDetails(gate: DetailGate): DetailGate = { ...gate, closedThrough: gate.lastTicket }

pure def canFinishDetail(gate: DetailGate, readTicket: int): bool =
  readTicket > gate.closedThrough and readTicket <= gate.lastTicket

pure def finishDetail(gate: DetailGate, readTicket: int): DetailGate = { ...gate, closedThrough: readTicket }

pure def alwaysTicketBounds(gate: DetailGate): bool = gate.closedThrough >= 0 and gate.closedThrough <= gate.lastTicket
pure def stepDetailBoundaryNeverFalls(before: DetailGate, after: DetailGate): bool = after.closedThrough >= before.closedThrough
pure def sometimesADetailFinishes(gate: DetailGate): bool = gate.lastTicket > 0 and gate.closedThrough == gate.lastTicket
pure def sometimesADetailWaits(gate: DetailGate): bool = gate.closedThrough < gate.lastTicket
```

### Serving revealed details requires current staff authority

A reveal grant applies only to the member, app, mode, and staff identity that it was issued for. Check the staff identity's current safety permission and the grant and sign-in expiry when a read starts and again before publishing the response. An expired grant or a changed mode, grant, role, or sign-in cannot expose revealed data. A role lookup failure cannot preserve cached grants from the unavailable database.

```quint
pure def staffRevealMayDisclose(sameView: bool, safetyAllowed: bool, signInCurrent: bool, grantTimeLeftMs: int): bool =
  sameView and safetyAllowed and signInCurrent and grantTimeLeftMs > 0

pure def lawStaffRevealNeedsCurrentSafety(sameView: bool, signInCurrent: bool, grantTimeLeftMs: int): bool =
  not(staffRevealMayDisclose(sameView, false, signInCurrent, grantTimeLeftMs))
```

### The timeline shows recorded delivery and leak evidence for the exact message

In real mode, show the current durable queue status and a normalized reason when the app, member and outbound message all match. The queue's staff read exposes no address, body, provider error or raw operator note. A leak stop, a staff release, and a body checked before a delivery attempt are separate outcomes. A check does not prove delivery. A pending row with no check evidence shows no leak result. Another message at the same time proves nothing about this message. When the queue has no matching evidence, show only the stored message status and separately recorded timeline events. A failed evidence read stops the detail read. A recorded leak stop withholds the prepared body, including from a member reveal, so only the authorized leak review can show it.

Each app's database reader has access only to its own delivery evidence view. The legacy Observatory reader has access to the Ntwrk view. Apply the same grants on upgrades and when reinstalling the base schema.

```quint
type ConsoleDeliveryGuard = DeliveryGuardUnrecorded | DeliveryGuardBlocked | DeliveryGuardReleased | DeliveryGuardChecked

pure def consoleDeliveryEvidenceAllowed(sameApp: bool, sameMember: bool, sameMessage: bool, memberOutbound: bool): bool =
  sameApp and sameMember and sameMessage and memberOutbound

pure def consoleDeliveryGuard(exactEvidence: bool, leakStopped: bool, staffReleased: bool, attempted: bool): ConsoleDeliveryGuard =
  if (not(exactEvidence)) DeliveryGuardUnrecorded
  else if (leakStopped) DeliveryGuardBlocked
  else if (staffReleased) DeliveryGuardReleased
  else if (attempted) DeliveryGuardChecked
  else DeliveryGuardUnrecorded

pure def consolePreparedBodyWithheld(guardResult: ConsoleDeliveryGuard, storedLeakStop: bool): bool =
  guardResult == DeliveryGuardBlocked or storedLeakStop

pure def lawUnmatchedDeliveryShowsNoLeakCheck(leakStopped: bool, staffReleased: bool, attempted: bool): bool =
  consoleDeliveryGuard(false, leakStopped, staffReleased, attempted) == DeliveryGuardUnrecorded

pure def lawUnattemptedDeliveryCannotShowChecked(exactEvidence: bool, leakStopped: bool, staffReleased: bool): bool =
  consoleDeliveryGuard(exactEvidence, leakStopped, staffReleased, false) != DeliveryGuardChecked

pure def lawRecordedLeakStopWithholdsPreparedBody(guardResult: ConsoleDeliveryGuard): bool =
  consolePreparedBodyWithheld(guardResult, true)
```

### A booked plan shows only receipts for its current notice

Start the displayed receipt clock only after a positive provider or signed gateway receipt for the exact app, opportunity, recipient and current schedule revision. Use the receipt time. A missing, queued, refused, stale or future receipt leaves the recipient without a confirmed delivery time. Each app reader can read only its own receipt metadata. The game uses the simulator's delivered notice for that same booking. A game export records the synthetic evidence explicitly. A dry run or an old exported message alone supplies no evidence of actual delivery.

```quint
pure def consoleBookingReceiptCurrent(exactBooking: bool, recipientOnRoster: bool, delivered: bool, receivedAt: int, asOf: int): bool =
  exactBooking and recipientOnRoster and delivered and receivedAt >= 0 and receivedAt <= asOf

pure def lawUnreceivedBookingHasNoClock(exactBooking: bool, recipientOnRoster: bool, receivedAt: int, asOf: int): bool =
  not(consoleBookingReceiptCurrent(exactBooking, recipientOnRoster, false, receivedAt, asOf))
```

## Story: Open Slop photos for a verified adult

> As an authorized staff member, I want to see photos for a verified adult after giving the logged reason.

### Photo access requires the current member and staff permission

Show the photo request when the app panel permits a reasoned read, the viewer has the safety capability, and the current member remains an adult. Send the request only when the reason has at least five characters. Clear loaded photos when these conditions cease to apply. An in-flight reply also needs the current permission and read ticket before it can display a photo.

```quint
type StaffPhotoView = HidePhotos | ShowPhotoForm | ShowGallery

pure def staffPhotoAllowed(rulePermitsRead: bool, canSafety: bool, liveAdult: bool): bool =
  rulePermitsRead and canSafety and liveAdult

pure def staffPhotoView(allowedRead: bool, loaded: bool): StaffPhotoView =
  if (not(allowedRead)) HidePhotos else if (loaded) ShowGallery else ShowPhotoForm

pure def staffPhotoReasonReady(lengthOfReason: int): bool = lengthOfReason >= 5

pure def lawGalleryNeedsPermission(allowedRead: bool, loaded: bool): bool =
  staffPhotoView(allowedRead, loaded) == ShowGallery implies allowedRead and loaded
```
