// GENERATED from spec/simulationMatching.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Run the staff simulation with the current app lock / Keep invitations off when the app is locked or the experiment explicitly disables matching (spec/simulationMatching.md) */
export type SimulationMatching = "SimulationMatchingOpen" | "SimulationMatchingLocked";


/** Story: Run the staff simulation with the current app lock / Keep invitations off when the app is locked or the experiment explicitly disables matching (spec/simulationMatching.md) */
//@ pure
export function simulatedMatchingMode(appAllowsMatching: boolean, matchingOff: boolean): SimulationMatching {
  return appAllowsMatching && !matchingOff ? "SimulationMatchingOpen" : "SimulationMatchingLocked";
}

/** Story: Run the staff simulation with the current app lock / Keep invitations off when the app is locked or the experiment explicitly disables matching (spec/simulationMatching.md) */
//@ pure
export function lawLockedAppCannotEnableSimulatedMatching(matchingOff: boolean): boolean {
  //@ ensures \result === true
  return simulatedMatchingMode(false, matchingOff) === "SimulationMatchingLocked";
}
