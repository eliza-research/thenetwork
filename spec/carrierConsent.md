# Carrier consent

The platform reads the latest app event and the latest global event for the same verified phone. This library resolves those two events. The stores choose each latest event before calling it.

## Story: Stop texts across apps and resume an app

> As a person on the shared line, I want STOP to end messages from every app and START to resume the app I chose.

### A global STOP beats an older or simultaneous app opt-in

After a global STOP, only an app opt-in strictly later than STOP permits this app to text. The opt-in has no effect on other apps.

```quint
pure def appOptInBeatsStop(appAt: int, stopAt: int): bool =
  appAt > stopAt

pure def lawStopWinsATie(at: int): bool =
  not(appOptInBeatsStop(at, at))
```

### An app with no opt-in has no permission to send

An app's current event must be an opt-in. When a global STOP is present, the newer app opt-in rule also applies. An absent event or app opt-out cannot supply permission.

```quint
pure def appMayText(appOptedIn: bool, globalOptedOut: bool, appAt: int, globalAt: int): bool =
  appOptedIn and (not(globalOptedOut) or appOptInBeatsStop(appAt, globalAt))

pure def lawNoAppOptInMeansNoPermission(globalOptedOut: bool, appAt: int, globalAt: int): bool =
  not(appMayText(false, globalOptedOut, appAt, globalAt))
```
