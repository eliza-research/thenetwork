# Candidate exposure floor

The [candidate pool model](models/candidate_pool.md) treats retrieval channels as a subset of eligible members. This machine governs the reserved slots within that subset. The engine keeps the candidate order, membership and similarity checks, and result collection.

## Story: Reserve exposure for eligible candidates with little history

> As a new or underexposed member, I want a chance to appear in results when I fit the request, even when I miss the top-ranked channels.

### Retrieval starts with a fixed allocation of slots

One retrieval configures its allocation once. With zero slots it is already full. The shell caps the allocation at the number of candidates it can inspect. The shell rounds a positive fractional limit up. With no numeric bound, the number of candidates supplies the limit.

```quint
type FloorPhase = Unconfigured | Open | Full

type FloorAllocation = { phase: FloorPhase, slotLimit: int, reserved: int }

pure val initial: FloorAllocation = { phase: Unconfigured, slotLimit: 0, reserved: 0 }

pure def canAllocate(f: FloorAllocation, slotLimit: int): bool =
  f.phase == Unconfigured and slotLimit >= 0

pure def allocate(f: FloorAllocation, slotLimit: int): FloorAllocation =
  { ...f, slotLimit: slotLimit, phase: if (slotLimit == 0) Full else Open }

pure def alwaysAllocationWithinLimit(f: FloorAllocation): bool = and {
  f.reserved >= 0,
  f.reserved <= f.slotLimit,
  f.phase == Unconfigured implies f.reserved == 0,
  f.phase == Open implies f.reserved < f.slotLimit,
  f.phase == Full implies f.reserved == f.slotLimit,
}
```

### A slot goes to an eligible candidate outside the prior results

An eligible candidate has low exposure, has little profile data, or is a newcomer. The candidate meets the retrieval’s similarity threshold. Intent retrieval skips member IDs already selected by an earlier channel. Embedding retrieval considers the ranked rows after the semantic prefix. The shell supplies these facts for each candidate in order.

```quint
pure def canReserveSlot(f: FloorAllocation, alreadyIncluded: bool, priority: bool, similarityEligible: bool): bool =
  f.phase == Open and not(alreadyIncluded) and priority and similarityEligible

pure def reserveSlot(f: FloorAllocation, alreadyIncluded: bool, priority: bool, similarityEligible: bool): FloorAllocation =
  val reserved = f.reserved + 1
  { ...f, reserved: reserved, phase: if (reserved == f.slotLimit) Full else Open }

pure def stepEachReservationUsesOneSlot(before: FloorAllocation, via: str, after: FloorAllocation): bool =
  if (via == "reserveSlot") after.reserved == before.reserved + 1
  else after.reserved == before.reserved

pure def stepFullStaysFull(before: FloorAllocation, after: FloorAllocation): bool =
  before.phase == Full implies (after.phase == Full and after.reserved == before.reserved)

pure def sometimesFillsSlots(f: FloorAllocation): bool = f.phase == Full and f.reserved > 0
```
