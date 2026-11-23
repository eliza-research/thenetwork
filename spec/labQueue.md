# Simulation lab admission

## Story: Submit an experiment when queue capacity is available

> As a staff simulator operator, I want the same capacity response whether
> the queue is already full or fills while my request is being audited.

### Check capacity again before reserving queued seeds

An experiment request reserves all its seeds together. If there is room, add
every seed to the queue. If there is no room, the API returns 429 with the
`queue_full` code. Check capacity again after the audit before writing a run
or adding seeds.

```quint
pure def labHasQueueCapacity(waitingSeeds: int, requestedSeeds: int, capacity: int): bool =
  waitingSeeds + requestedSeeds <= capacity

pure def lawExceedingLabCapacityRefuses(waitingSeeds: int, requestedSeeds: int, capacity: int): bool =
  waitingSeeds + requestedSeeds > capacity implies not(labHasQueueCapacity(waitingSeeds, requestedSeeds, capacity))
```
