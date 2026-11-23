# Observatory member consent

## Story: F35 — Inspect a member's experience as staff

The simulated member view reflects the channel's recorded consent. The production view reads the stored consent.

### Recorded consent changes the current view once

For a joined member, a recorded stop shows the member as stopped. A recorded resume restores the participation state that the stop covered. The current stopped count changes only on a transition. Repeated records leave the view and count as they are. Consent commands do not enroll a person.

```quint
pure def currentConsentViewChanges(joined: bool, wasStopped: bool, nowStopped: bool): bool =
  joined and wasStopped != nowStopped

pure def lawSameConsentLeavesViewUnchanged(joined: bool, stopped: bool): bool =
  not(currentConsentViewChanges(joined, stopped, stopped))

pure def lawConsentCannotEnroll(wasStopped: bool, nowStopped: bool): bool =
  not(currentConsentViewChanges(false, wasStopped, nowStopped))
```
