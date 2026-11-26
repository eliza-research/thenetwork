# Marketing device safety

Pure battery, thermal, warm-up ramp, and lease-exclusivity rules for physical Android and iPhone devices connected to the local MacBook host in `@thenetwork/marketing`. Callers probe live telemetry via `adb` or `pymobiledevice3` / `devicectl` and pass explicit readings to these rules before executing any device action.

## Story: Protect attached phones from battery, thermal, and warm-up abuse

> As an operator running local Android and iPhone devices from a MacBook, I want every phone action to stay inside safe battery and temperature limits, follow a monotone daily warm-up ramp, and never collide with another lease or a STOPped contact.

### Safe device operation requires battery between 35 and 80 percent and temperature between 0 and 41 C

Physical phones refuse active automation when battery drops below 35 percent, exceeds 80 percent while charging, drops below 0 C, or rises above 41 C.

```quint
pure val deviceBatteryMin: int = 35
pure val deviceBatteryMax: int = 80
pure val deviceTempMinC: int = 0
pure val deviceTempMaxC: int = 41

pure def deviceBatterySafe(batteryPct: int, tempC: int): bool =
  batteryPct >= deviceBatteryMin
    and batteryPct <= deviceBatteryMax
    and tempC >= deviceTempMinC
    and tempC <= deviceTempMaxC
```

### Daily warm-up action caps increase monotonically with warm-up day

New devices start at 0 actions before day 1 and step up monotonically across warm-up stages: 5 actions for days 1 through 3, 12 for days 4 through 7, 25 for days 8 through 14, 50 for days 15 through 30, and 80 after day 30.

```quint
pure def warmupDailyCap(warmupDay: int): int =
  if (warmupDay < 1) 0
  else if (warmupDay <= 3) 5
  else if (warmupDay <= 7) 12
  else if (warmupDay <= 14) 25
  else if (warmupDay <= 30) 50
  else 80

pure def lawWarmupCapMonotone(dayA: int, dayB: int): bool =
  (dayA <= dayB) implies (warmupDailyCap(dayA) <= warmupDailyCap(dayB))
```

### Device execution requires online status, exclusive lease, safe envelope, remaining warm-up quota, and no lockdown, STOP, or human takeover challenge

A physical device may execute an action only when it is online, not leased by another worker, inside the safe battery and temperature envelope, within its non-negative daily warm-up action cap, outside lockdown mode, and targeting a contact who has not sent STOP. Dispatching a device step also fails closed whenever `needsTakeover` is true (CAPTCHA, login challenge, or 2FA requires human intervention).

```quint
pure def canExecuteDeviceAction(
  deviceOnline: bool,
  leasedByOther: bool,
  batteryPct: int,
  tempC: int,
  actionsToday: int,
  warmupDay: int,
  lockdown: bool,
  targetStopped: bool
): bool =
  deviceOnline
    and not(leasedByOther)
    and deviceBatterySafe(batteryPct, tempC)
    and actionsToday >= 0
    and actionsToday < warmupDailyCap(warmupDay)
    and not(lockdown)
    and not(targetStopped)

pure def canDispatchDeviceStep(
  deviceOnline: bool,
  leasedByOther: bool,
  needsTakeover: bool,
  batteryPct: int,
  tempC: int,
  actionsToday: int,
  warmupDay: int,
  lockdown: bool,
  targetStopped: bool
): bool =
  not(needsTakeover)
    and canExecuteDeviceAction(
      deviceOnline, leasedByOther, batteryPct, tempC, actionsToday, warmupDay, lockdown, targetStopped
    )

pure def lawHotOrLowBatteryBlocked(
  deviceOnline: bool,
  leasedByOther: bool,
  batteryPct: int,
  tempC: int,
  actionsToday: int,
  warmupDay: int,
  lockdown: bool,
  targetStopped: bool
): bool =
  (batteryPct < deviceBatteryMin or batteryPct > deviceBatteryMax or tempC < deviceTempMinC or tempC > deviceTempMaxC) implies
    not(canExecuteDeviceAction(deviceOnline, leasedByOther, batteryPct, tempC, actionsToday, warmupDay, lockdown, targetStopped))

pure def lawLeasedOrStoppedDeviceBlocked(
  deviceOnline: bool,
  leasedByOther: bool,
  batteryPct: int,
  tempC: int,
  actionsToday: int,
  warmupDay: int,
  lockdown: bool,
  targetStopped: bool
): bool =
  (not(deviceOnline) or leasedByOther or lockdown or targetStopped) implies
    not(canExecuteDeviceAction(deviceOnline, leasedByOther, batteryPct, tempC, actionsToday, warmupDay, lockdown, targetStopped))

pure def lawTakeoverBlocksDeviceStep(
  deviceOnline: bool,
  leasedByOther: bool,
  batteryPct: int,
  tempC: int,
  actionsToday: int,
  warmupDay: int,
  lockdown: bool,
  targetStopped: bool
): bool =
  not(canDispatchDeviceStep(
    deviceOnline, leasedByOther, true, batteryPct, tempC, actionsToday, warmupDay, lockdown, targetStopped
  ))

pure val batteryPctValues = Set(20, 34, 35, 55, 80, 81, 92)
pure val tempCValues = Set(-1, 0, 32, 41, 42, 45)
pure val actionsTodayValues = Set(-1, 0, 4, 5, 12, 80)
pure val warmupDayValues = Set(0, 1, 3, 4, 7, 8, 14, 15, 30, 31)
pure val dayAValues = Set(0, 1, 3, 4, 7, 8, 14, 15, 30, 31)
pure val dayBValues = Set(0, 1, 3, 4, 7, 8, 14, 15, 30, 31)
```
