// GENERATED from spec/exposureFloor.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny

/** Story: Reserve exposure for eligible candidates with little history / Retrieval starts with a fixed allocation of slots (spec/exposureFloor.md:9) */
export type FloorPhase = "Unconfigured" | "Open" | "Full";
/** Story: Reserve exposure for eligible candidates with little history / Retrieval starts with a fixed allocation of slots (spec/exposureFloor.md:9) */
export interface FloorAllocation { phase: FloorPhase; slotLimit: number; reserved: number }

/** One variant per transition in the spec. */
export type Event =
  | { type: "allocate"; slotLimit: number }
  | { type: "reserveSlot"; alreadyIncluded: boolean; priority: boolean; similarityEligible: boolean };

/** Story: Reserve exposure for eligible candidates with little history / Retrieval starts with a fixed allocation of slots (spec/exposureFloor.md:9) */
export const initial: FloorAllocation = { phase: "Unconfigured", slotLimit: 0, reserved: 0 };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: FloorAllocation): boolean {
  return alwaysAllocationWithinLimit(current);
}

/** Story: Reserve exposure for eligible candidates with little history / Retrieval starts with a fixed allocation of slots (spec/exposureFloor.md:9) */
//@ pure
export function alwaysAllocationWithinLimit(f: FloorAllocation): boolean {
  return f.reserved >= 0 && f.reserved <= f.slotLimit && (!(f.phase === "Unconfigured") || f.reserved === 0) && (!(f.phase === "Open") || f.reserved < f.slotLimit) && (!(f.phase === "Full") || f.reserved === f.slotLimit);
}

/** Story: Reserve exposure for eligible candidates with little history / Retrieval starts with a fixed allocation of slots (spec/exposureFloor.md:9) */
//@ pure
export function canAllocate(f: FloorAllocation, slotLimit: number): boolean {
  return f.phase === "Unconfigured" && slotLimit >= 0;
}

/** Story: Reserve exposure for eligible candidates with little history / Retrieval starts with a fixed allocation of slots (spec/exposureFloor.md:9) */
//@ pure
export function allocate(f: FloorAllocation, slotLimit: number): FloorAllocation {
  //@ ensures (inv(f) && canAllocate(f, slotLimit)) ==> alwaysAllocationWithinLimit(\result)
  //@ ensures (inv(f) && canAllocate(f, slotLimit)) ==> stepEachReservationUsesOneSlot(f, "allocate", \result)
  //@ ensures (inv(f) && canAllocate(f, slotLimit)) ==> stepFullStaysFull(f, \result)
  return { ...f, slotLimit: slotLimit, phase: slotLimit === 0 ? "Full" : "Open" };
}

/** Story: Reserve exposure for eligible candidates with little history / A slot goes to an eligible candidate outside the prior results (spec/exposureFloor.md:35) */
//@ pure
export function canReserveSlot(f: FloorAllocation, alreadyIncluded: boolean, priority: boolean, similarityEligible: boolean): boolean {
  return f.phase === "Open" && !alreadyIncluded && priority && similarityEligible;
}

/** Story: Reserve exposure for eligible candidates with little history / A slot goes to an eligible candidate outside the prior results (spec/exposureFloor.md:35) */
//@ pure
export function reserveSlot(f: FloorAllocation, alreadyIncluded: boolean, priority: boolean, similarityEligible: boolean): FloorAllocation {
  //@ ensures (inv(f) && canReserveSlot(f, alreadyIncluded, priority, similarityEligible)) ==> alwaysAllocationWithinLimit(\result)
  //@ ensures (inv(f) && canReserveSlot(f, alreadyIncluded, priority, similarityEligible)) ==> stepEachReservationUsesOneSlot(f, "reserveSlot", \result)
  //@ ensures (inv(f) && canReserveSlot(f, alreadyIncluded, priority, similarityEligible)) ==> stepFullStaysFull(f, \result)
  const reserved: number = f.reserved + 1;
  return { ...f, reserved: reserved, phase: reserved === f.slotLimit ? "Full" : "Open" };
}

/** Story: Reserve exposure for eligible candidates with little history / A slot goes to an eligible candidate outside the prior results (spec/exposureFloor.md:35) */
//@ pure
export function stepEachReservationUsesOneSlot(before: FloorAllocation, via: string, after: FloorAllocation): boolean {
  return via === "reserveSlot" ? after.reserved === before.reserved + 1 : after.reserved === before.reserved;
}

/** Story: Reserve exposure for eligible candidates with little history / A slot goes to an eligible candidate outside the prior results (spec/exposureFloor.md:35) */
//@ pure
export function stepFullStaysFull(before: FloorAllocation, after: FloorAllocation): boolean {
  return !(before.phase === "Full") || (after.phase === "Full" && after.reserved === before.reserved);
}

/** Story: Reserve exposure for eligible candidates with little history / A slot goes to an eligible candidate outside the prior results (spec/exposureFloor.md:35) */
//@ pure
export function sometimesFillsSlots(f: FloorAllocation): boolean {
  return f.phase === "Full" && f.reserved > 0;
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: FloorAllocation, event: Event): boolean {
  if (event.type === "allocate") return canAllocate(current, event.slotLimit);
  if (event.type === "reserveSlot") return canReserveSlot(current, event.alreadyIncluded, event.priority, event.similarityEligible);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: FloorAllocation, event: Event): FloorAllocation {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "allocate" && canAllocate(current, event.slotLimit)) return allocate(current, event.slotLimit);
  if (event.type === "reserveSlot" && canReserveSlot(current, event.alreadyIncluded, event.priority, event.similarityEligible)) return reserveSlot(current, event.alreadyIncluded, event.priority, event.similarityEligible);
  return current;
}

/**
 * Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program:
 * the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy
 * with exactly the fields the event has, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseEvent(x: unknown): Event | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "allocate" && Number.isSafeInteger(raw.slotLimit)) return { type: "allocate", slotLimit: raw.slotLimit };
  if (raw.type === "reserveSlot" && typeof raw.alreadyIncluded === "boolean" && typeof raw.priority === "boolean" && typeof raw.similarityEligible === "boolean") return { type: "reserveSlot", alreadyIncluded: raw.alreadyIncluded, priority: raw.priority, similarityEligible: raw.similarityEligible };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): FloorAllocation | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Unconfigured" || raw.phase === "Open" || raw.phase === "Full") && Number.isSafeInteger(raw.slotLimit) && Number.isSafeInteger(raw.reserved) && Object.keys(raw).length === 3)) return undefined;
  const parsed: FloorAllocation = ({ phase: raw.phase, slotLimit: raw.slotLimit, reserved: raw.reserved });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): FloorAllocation {
  //@ ensures inv(\result)
  return initial;
}
