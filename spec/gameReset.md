# Replace a simulated world

## Story: Reset a simulation during an active step

> As a staff simulator operator, I want reset to install a fresh world even when the previous step is waiting for a controlled member.

### Release the pending replies and drain the step before publishing the replacement

Stop the old timers and release the controlled members. Let the old step and
its callbacks finish. During that drain, reject new controls. A control that
started waiting for the old world cannot apply to the replacement. Publish
the fresh world after its initialization completes.

```quint
pure def gameResetControlsAllowed(draining: bool, sameWorld: bool): bool =
  not(draining) and sameWorld

pure def lawOldGameControlCannotReachReplacement(draining: bool): bool =
  not(gameResetControlsAllowed(draining, false))
```
