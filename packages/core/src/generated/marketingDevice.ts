// GENERATED from spec/marketingDevice.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny


/** Story: Protect attached phones from battery, thermal, and warm-up abuse / Safe device operation requires battery between 35 and 80 percent and temperature between 0 and 41 C (spec/marketingDevice.md) */
export const deviceBatteryMin: number = 35;
/** Story: Protect attached phones from battery, thermal, and warm-up abuse / Safe device operation requires battery between 35 and 80 percent and temperature between 0 and 41 C (spec/marketingDevice.md) */
export const deviceBatteryMax: number = 80;
/** Story: Protect attached phones from battery, thermal, and warm-up abuse / Safe device operation requires battery between 35 and 80 percent and temperature between 0 and 41 C (spec/marketingDevice.md) */
export const deviceTempMinC: number = 0;
/** Story: Protect attached phones from battery, thermal, and warm-up abuse / Safe device operation requires battery between 35 and 80 percent and temperature between 0 and 41 C (spec/marketingDevice.md) */
export const deviceTempMaxC: number = 41;

/** Story: Protect attached phones from battery, thermal, and warm-up abuse / Safe device operation requires battery between 35 and 80 percent and temperature between 0 and 41 C (spec/marketingDevice.md) */
//@ pure
export function deviceBatterySafe(batteryPct: number, tempC: number): boolean {
  return batteryPct >= deviceBatteryMin && batteryPct <= deviceBatteryMax && tempC >= deviceTempMinC && tempC <= deviceTempMaxC;
}

/** Story: Protect attached phones from battery, thermal, and warm-up abuse / Daily warm-up action caps increase monotonically with warm-up day (spec/marketingDevice.md) */
//@ pure
export function warmupDailyCap(warmupDay: number): number {
  return warmupDay < 1 ? 0 : (warmupDay <= 3 ? 5 : (warmupDay <= 7 ? 12 : (warmupDay <= 14 ? 25 : (warmupDay <= 30 ? 50 : 80))));
}

/** Story: Protect attached phones from battery, thermal, and warm-up abuse / Daily warm-up action caps increase monotonically with warm-up day (spec/marketingDevice.md) */
//@ pure
export function lawWarmupCapMonotone(dayA: number, dayB: number): boolean {
  //@ ensures \result === true
  return !(dayA <= dayB) || warmupDailyCap(dayA) <= warmupDailyCap(dayB);
}

/** Story: Protect attached phones from battery, thermal, and warm-up abuse / Device execution requires online status, exclusive lease, safe envelope, remaining warm-up quota, and no lockdown, STOP, or human takeover challenge (spec/marketingDevice.md) */
//@ pure
export function canExecuteDeviceAction(deviceOnline: boolean, leasedByOther: boolean, batteryPct: number, tempC: number, actionsToday: number, warmupDay: number, lockdown: boolean, targetStopped: boolean): boolean {
  return deviceOnline && !leasedByOther && deviceBatterySafe(batteryPct, tempC) && actionsToday >= 0 && actionsToday < warmupDailyCap(warmupDay) && !lockdown && !targetStopped;
}

/** Story: Protect attached phones from battery, thermal, and warm-up abuse / Device execution requires online status, exclusive lease, safe envelope, remaining warm-up quota, and no lockdown, STOP, or human takeover challenge (spec/marketingDevice.md) */
//@ pure
export function canDispatchDeviceStep(deviceOnline: boolean, leasedByOther: boolean, needsTakeover: boolean, batteryPct: number, tempC: number, actionsToday: number, warmupDay: number, lockdown: boolean, targetStopped: boolean): boolean {
  return !needsTakeover && canExecuteDeviceAction(deviceOnline, leasedByOther, batteryPct, tempC, actionsToday, warmupDay, lockdown, targetStopped);
}

/** Story: Protect attached phones from battery, thermal, and warm-up abuse / Device execution requires online status, exclusive lease, safe envelope, remaining warm-up quota, and no lockdown, STOP, or human takeover challenge (spec/marketingDevice.md) */
//@ pure
export function lawHotOrLowBatteryBlocked(deviceOnline: boolean, leasedByOther: boolean, batteryPct: number, tempC: number, actionsToday: number, warmupDay: number, lockdown: boolean, targetStopped: boolean): boolean {
  //@ ensures \result === true
  return !(batteryPct < deviceBatteryMin || batteryPct > deviceBatteryMax || tempC < deviceTempMinC || tempC > deviceTempMaxC) || !canExecuteDeviceAction(deviceOnline, leasedByOther, batteryPct, tempC, actionsToday, warmupDay, lockdown, targetStopped);
}

/** Story: Protect attached phones from battery, thermal, and warm-up abuse / Device execution requires online status, exclusive lease, safe envelope, remaining warm-up quota, and no lockdown, STOP, or human takeover challenge (spec/marketingDevice.md) */
//@ pure
export function lawLeasedOrStoppedDeviceBlocked(deviceOnline: boolean, leasedByOther: boolean, batteryPct: number, tempC: number, actionsToday: number, warmupDay: number, lockdown: boolean, targetStopped: boolean): boolean {
  //@ ensures \result === true
  return !(!deviceOnline || leasedByOther || lockdown || targetStopped) || !canExecuteDeviceAction(deviceOnline, leasedByOther, batteryPct, tempC, actionsToday, warmupDay, lockdown, targetStopped);
}

/** Story: Protect attached phones from battery, thermal, and warm-up abuse / Device execution requires online status, exclusive lease, safe envelope, remaining warm-up quota, and no lockdown, STOP, or human takeover challenge (spec/marketingDevice.md) */
//@ pure
export function lawTakeoverBlocksDeviceStep(deviceOnline: boolean, leasedByOther: boolean, batteryPct: number, tempC: number, actionsToday: number, warmupDay: number, lockdown: boolean, targetStopped: boolean): boolean {
  //@ ensures \result === true
  return !canDispatchDeviceStep(deviceOnline, leasedByOther, true, batteryPct, tempC, actionsToday, warmupDay, lockdown, targetStopped);
}
