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
