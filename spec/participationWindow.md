# Participation window

## Story: Set availability for a time window

> As a member, I want a temporary busy, travel, open or paused setting to apply at the times I chose.

### A window starts inclusively and ends exclusively

An omitted start or end has no limit on that side. When both limits are present, the start must be earlier than the end. STOP prevents a window from taking effect.

```quint
pure def validWindow(hasStart: bool, hasEnd: bool, startAt: int, endAt: int): bool =
  not(hasStart and hasEnd) or startAt < endAt

pure def windowIsActive(optedOut: bool, hasWindow: bool, hasStart: bool, hasEnd: bool, startAt: int, endAt: int, asOf: int): bool =
  not(optedOut) and hasWindow and (not(hasStart) or startAt <= asOf) and (not(hasEnd) or asOf < endAt)

pure def lawAWindowCannotContinueAtItsEnd(startAt: int, endAt: int): bool =
  not(windowIsActive(false, true, true, true, startAt, endAt, endAt))
```

### STOP takes precedence over a participation setting

STOP produces paused participation. An active pause window also produces paused participation. An active open window produces normal participation. Busy and traveling produce quiet participation while active. Otherwise keep the member's existing base setting.

```quint
type ParticipationOverride = KeepBase | UseNormal | UseQuiet | UsePaused

pure def participationOverride(optedOut: bool, windowActive: bool, scheduledMode: str): ParticipationOverride =
  if (optedOut) UsePaused
  else if (not(windowActive)) KeepBase
  else if (scheduledMode == "open") UseNormal
  else if (scheduledMode == "paused") UsePaused
  else UseQuiet

pure def lawStopAlwaysPauses(windowActive: bool, scheduledMode: str): bool =
  participationOverride(true, windowActive, scheduledMode) == UsePaused
```
