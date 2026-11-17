// GENERATED from spec/peonCapacity.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Reserve one opening for each candidate still in the hiring flow / Only live or successful introductions occupy an opening (spec/peonCapacity.md) */
export type LedgerPhase = "Collecting" | "Published";
/** Story: Reserve one opening for each candidate still in the hiring flow / Only live or successful introductions occupy an opening (spec/peonCapacity.md) */
export interface SeatLedger { phase: LedgerPhase; occupied: string[] }

/** One variant per transition in the spec. */
export type Event =
  | { type: "publishLedger" }
  | { type: "observeCandidate"; candidate: string; occupies: boolean };

/** Story: Reserve one opening for each candidate still in the hiring flow / Only live or successful introductions occupy an opening (spec/peonCapacity.md) */
export const initial: SeatLedger = { phase: "Collecting", occupied: ([] as string[]) };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: SeatLedger): boolean {
  return true;
}

/** Story: Reserve one opening for each candidate still in the hiring flow / Only live or successful introductions occupy an opening (spec/peonCapacity.md) */
//@ pure
export function interactionOccupies(disposition: string): boolean {
  return disposition === "pending" || disposition === "accepted" || disposition === "completed";
}

/** Story: Reserve one opening for each candidate still in the hiring flow / Only live or successful introductions occupy an opening (spec/peonCapacity.md) */
//@ pure
export function bookedOccupies(hasMeeting: boolean, closed: boolean): boolean {
  return hasMeeting && !closed;
}

/** Story: Reserve one opening for each candidate still in the hiring flow / Only live or successful introductions occupy an opening (spec/peonCapacity.md) */
//@ pure
export function canPublishLedger(l: SeatLedger): boolean {
  return l.phase === "Collecting";
}

/** Story: Reserve one opening for each candidate still in the hiring flow / Only live or successful introductions occupy an opening (spec/peonCapacity.md) */
//@ pure
export function publishLedger(l: SeatLedger): SeatLedger {
  //@ ensures (inv(l) && canPublishLedger(l)) ==> stepPublishedOccupancyStaysFixed(l, \result)
  return { ...l, phase: "Published" };
}

/** Story: Reserve one opening for each candidate still in the hiring flow / Only live or successful introductions occupy an opening (spec/peonCapacity.md) */
//@ pure
export function stepPublishedOccupancyStaysFixed(before: SeatLedger, after: SeatLedger): boolean {
  return !(before.phase === "Published") || (after.phase === "Published" && before.occupied.length === after.occupied.length);
}

/** Story: Reserve one opening for each candidate still in the hiring flow / Only live or successful introductions occupy an opening (spec/peonCapacity.md) */
//@ pure
export function sometimesPublishedWithCandidate(l: SeatLedger): boolean {
  return l.phase === "Published" && l.occupied.length > 0;
}

/** Story: Reserve one opening for each candidate still in the hiring flow / Only live or successful introductions occupy an opening (spec/peonCapacity.md) */
//@ pure
export function canObserveCandidate(l: SeatLedger, candidate: string, occupies: boolean): boolean {
  return l.phase === "Collecting" && occupies && !l.occupied.includes(candidate);
}

/** Story: Reserve one opening for each candidate still in the hiring flow / Only live or successful introductions occupy an opening (spec/peonCapacity.md) */
//@ pure
export function observeCandidate(l: SeatLedger, candidate: string, occupies: boolean): SeatLedger {
  //@ ensures (inv(l) && canObserveCandidate(l, candidate, occupies)) ==> stepPublishedOccupancyStaysFixed(l, \result)
  return { ...l, occupied: l.occupied.concat([candidate].filter((set_x: string) => !l.occupied.includes(set_x))) };
}

/** Story: Reserve one opening for each candidate still in the hiring flow / The next slate stays within remaining openings (spec/peonCapacity.md) */
//@ pure
export function remainingOpenings(posted: number, occupied: number): number {
  return exact_peonCapacity(posted - occupied) < 0 ? 0 : exact_peonCapacity(posted - occupied);
}

/** Story: Reserve one opening for each candidate still in the hiring flow / The next slate stays within remaining openings (spec/peonCapacity.md) */
//@ pure
export function bookedCapacityReached(posted: number, occupied: number): boolean {
  return occupied >= posted;
}

/** Story: Reserve one opening for each candidate still in the hiring flow / The next slate stays within remaining openings (spec/peonCapacity.md) */
//@ pure
export function capSlate(planned: number, remaining: number): number {
  const local_0 = remaining < 0 ? 0 : remaining;
  return planned < local_0 ? planned : local_0;
}

/** Story: Reserve one opening for each candidate still in the hiring flow / The next slate stays within remaining openings (spec/peonCapacity.md) */
//@ pure
export function lawRemainingNeverNegative(posted: number, occupied: number): boolean {
  //@ ensures \result === true
  return remainingOpenings(posted, occupied) >= 0;
}

/** Story: Reserve one opening for each candidate still in the hiring flow / The next slate stays within remaining openings (spec/peonCapacity.md) */
//@ pure
export function lawSlateRespectsRemaining(planned: number, remaining: number): boolean {
  //@ ensures \result === true
  return !(remaining >= 0) || capSlate(planned, remaining) <= remaining;
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: SeatLedger, event: Event): boolean {
  if (event.type === "publishLedger") return canPublishLedger(current);
  if (event.type === "observeCandidate") return canObserveCandidate(current, event.candidate, event.occupies);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: SeatLedger, event: Event): SeatLedger {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "publishLedger") return canPublishLedger(current) ? publishLedger(current) : current;
  if (event.type === "observeCandidate") return canObserveCandidate(current, event.candidate, event.occupies) ? observeCandidate(current, event.candidate, event.occupies) : current;
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
  if (raw.type === "publishLedger") return { type: "publishLedger" };
  if (raw.type === "observeCandidate" && typeof raw.candidate === "string" && typeof raw.occupies === "boolean") return { type: "observeCandidate", candidate: raw.candidate, occupies: raw.occupies };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): SeatLedger | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Collecting" || raw.phase === "Published") && Array.isArray(raw.occupied) && raw.occupied.every((x1: any) => typeof x1 === "string") && new Set(raw.occupied).size === raw.occupied.length && Object.keys(raw).length === 2)) return undefined;
  const parsed: SeatLedger = ({ phase: raw.phase, occupied: raw.occupied.map((x1: any) => x1) });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): SeatLedger {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_peonCapacity(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
