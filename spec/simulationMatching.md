# Match only in an enabled simulation

## Story: Run the staff simulation with the current app lock

> As a simulation operator, I want the app matching lock to apply in the
> game and every lab arm so a locked run measures the intended behavior.

### Keep invitations off when the app is locked or the experiment explicitly disables matching

A locked app can still run onboarding, safety and single-player requests.
Its runner sends no new matching invitations, even when a baseline engine
or an operator supplies a simulated proposal. Apply the same setting to
each lab arm and report the setting in the game configuration.

```quint
type SimulationMatching = SimulationMatchingOpen | SimulationMatchingLocked

pure def simulatedMatchingMode(appAllowsMatching: bool, matchingOff: bool): SimulationMatching =
  if (appAllowsMatching and not(matchingOff)) SimulationMatchingOpen else SimulationMatchingLocked

pure def lawLockedAppCannotEnableSimulatedMatching(matchingOff: bool): bool =
  simulatedMatchingMode(false, matchingOff) == SimulationMatchingLocked
```
