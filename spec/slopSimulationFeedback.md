# Simulated Slop feedback

## Story: Evaluate Slop matches with feedback that has arrived

> As a reviewer of the Slop matching simulation, I want each run to use the
> feedback that the planner has received by its simulated decision time.

### Use feedback from the current simulated time

The Slop simulator can queue a feedback record with a future receipt time.
Include the record in the planner snapshot at that time and afterward.
Keep the feedback record in the simulator's state while it is pending.

```quint
pure def slopSimulationFeedbackReceived(receivedAt: int, now: int): bool = receivedAt <= now

pure def lawSlopSimulationFeedbackCannotAppearEarly(receivedAt: int, now: int): bool =
  now < receivedAt implies not(slopSimulationFeedbackReceived(receivedAt, now))

pure def lawSlopSimulationFeedbackAppearsAtReceipt(receivedAt: int): bool =
  slopSimulationFeedbackReceived(receivedAt, receivedAt)
```
