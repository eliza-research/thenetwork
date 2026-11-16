// GENERATED from spec/judgmentAttempt.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Reuse recent judgments and retry failures on a later run / An expired entry or a backward clock reading forces a request (spec/judgmentAttempt.md:9) */
export type AttemptPhase = "LookupCache" | "ReuseVerdict" | "RequestVerdict" | "StoreVerdict" | "NewVerdict" | "AttemptFailed";
/** Story: Reuse recent judgments and retry failures on a later run / An expired entry or a backward clock reading forces a request (spec/judgmentAttempt.md:9) */
export interface JudgmentAttempt { phase: AttemptPhase }

/** One variant per transition in the spec. */
export type Event =
  | { type: "readCache"; available: boolean }
  | { type: "receiveVerdict" }
  | { type: "completeWrite" }
  | { type: "failAttempt" };

/** Story: Reuse recent judgments and retry failures on a later run / An expired entry or a backward clock reading forces a request (spec/judgmentAttempt.md:9) */
export const initial: JudgmentAttempt = { phase: "LookupCache" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: JudgmentAttempt): boolean {
  return true;
}

/** Story: Reuse recent judgments and retry failures on a later run / An expired entry or a backward clock reading forces a request (spec/judgmentAttempt.md:9) */
//@ pure
export function cacheEntryExpired(elapsedMs: number, ttlMs: number, rewound: boolean): boolean {
  return elapsedMs >= ttlMs || rewound;
}

/** Story: Reuse recent judgments and retry failures on a later run / An expired entry or a backward clock reading forces a request (spec/judgmentAttempt.md:9) */
//@ pure
export function canReadCache(a: JudgmentAttempt): boolean {
  return a.phase === "LookupCache";
}

/** Story: Reuse recent judgments and retry failures on a later run / An expired entry or a backward clock reading forces a request (spec/judgmentAttempt.md:9) */
//@ pure
export function readCache(a: JudgmentAttempt, available: boolean): JudgmentAttempt {
  //@ ensures (inv(a) && canReadCache(a)) ==> stepStorageRequiresResponse(a, \result)
  //@ ensures (inv(a) && canReadCache(a)) ==> stepFinishedAttemptStaysClosed(a, \result)
  return { phase: available ? "ReuseVerdict" : "RequestVerdict" };
}

/** Story: Reuse recent judgments and retry failures on a later run / An expired entry or a backward clock reading forces a request (spec/judgmentAttempt.md:9) */
//@ pure
export function lawTtlBoundaryExpires(ttlMs: number): boolean {
  //@ ensures \result === true
  return cacheEntryExpired(ttlMs, ttlMs, false);
}

/** Story: Reuse recent judgments and retry failures on a later run / An expired entry or a backward clock reading forces a request (spec/judgmentAttempt.md:9) */
//@ pure
export function lawRewindExpires(elapsedMs: number, ttlMs: number): boolean {
  //@ ensures \result === true
  return cacheEntryExpired(elapsedMs, ttlMs, true);
}

/** Story: Reuse recent judgments and retry failures on a later run / Only a returned judgment is eligible for storage (spec/judgmentAttempt.md:29) */
//@ pure
export function canReceiveVerdict(a: JudgmentAttempt): boolean {
  return a.phase === "RequestVerdict";
}

/** Story: Reuse recent judgments and retry failures on a later run / Only a returned judgment is eligible for storage (spec/judgmentAttempt.md:29) */
//@ pure
export function receiveVerdict(a: JudgmentAttempt): JudgmentAttempt {
  //@ ensures (inv(a) && canReceiveVerdict(a)) ==> stepStorageRequiresResponse(a, \result)
  //@ ensures (inv(a) && canReceiveVerdict(a)) ==> stepFinishedAttemptStaysClosed(a, \result)
  return { phase: "StoreVerdict" };
}

/** Story: Reuse recent judgments and retry failures on a later run / Only a returned judgment is eligible for storage (spec/judgmentAttempt.md:29) */
//@ pure
export function canCompleteWrite(a: JudgmentAttempt): boolean {
  return a.phase === "StoreVerdict";
}

/** Story: Reuse recent judgments and retry failures on a later run / Only a returned judgment is eligible for storage (spec/judgmentAttempt.md:29) */
//@ pure
export function completeWrite(a: JudgmentAttempt): JudgmentAttempt {
  //@ ensures (inv(a) && canCompleteWrite(a)) ==> stepStorageRequiresResponse(a, \result)
  //@ ensures (inv(a) && canCompleteWrite(a)) ==> stepFinishedAttemptStaysClosed(a, \result)
  return { phase: "NewVerdict" };
}

/** Story: Reuse recent judgments and retry failures on a later run / Only a returned judgment is eligible for storage (spec/judgmentAttempt.md:29) */
//@ pure
export function canFailAttempt(a: JudgmentAttempt): boolean {
  return a.phase === "RequestVerdict" || a.phase === "StoreVerdict";
}

/** Story: Reuse recent judgments and retry failures on a later run / Only a returned judgment is eligible for storage (spec/judgmentAttempt.md:29) */
//@ pure
export function failAttempt(a: JudgmentAttempt): JudgmentAttempt {
  //@ ensures (inv(a) && canFailAttempt(a)) ==> stepStorageRequiresResponse(a, \result)
  //@ ensures (inv(a) && canFailAttempt(a)) ==> stepFinishedAttemptStaysClosed(a, \result)
  return { phase: "AttemptFailed" };
}

/** Story: Reuse recent judgments and retry failures on a later run / Only a returned judgment is eligible for storage (spec/judgmentAttempt.md:29) */
//@ pure
export function stepStorageRequiresResponse(before: JudgmentAttempt, after: JudgmentAttempt): boolean {
  return !(before.phase !== "StoreVerdict" && after.phase === "StoreVerdict") || before.phase === "RequestVerdict";
}

/** Story: Reuse recent judgments and retry failures on a later run / Only a returned judgment is eligible for storage (spec/judgmentAttempt.md:29) */
//@ pure
export function stepFinishedAttemptStaysClosed(before: JudgmentAttempt, after: JudgmentAttempt): boolean {
  return !(before.phase === "ReuseVerdict" || before.phase === "NewVerdict" || before.phase === "AttemptFailed") || equal_judgmentAttempt(after, before);
}

/** Story: Reuse recent judgments and retry failures on a later run / Only a returned judgment is eligible for storage (spec/judgmentAttempt.md:29) */
//@ pure
export function sometimesReusedVerdict(a: JudgmentAttempt): boolean {
  return a.phase === "ReuseVerdict";
}

/** Story: Reuse recent judgments and retry failures on a later run / Only a returned judgment is eligible for storage (spec/judgmentAttempt.md:29) */
//@ pure
export function sometimesNewVerdict(a: JudgmentAttempt): boolean {
  return a.phase === "NewVerdict";
}

/** Story: Reuse recent judgments and retry failures on a later run / Only a returned judgment is eligible for storage (spec/judgmentAttempt.md:29) */
//@ pure
export function sometimesAttemptFailed(a: JudgmentAttempt): boolean {
  return a.phase === "AttemptFailed";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: JudgmentAttempt, event: Event): boolean {
  if (event.type === "readCache") return canReadCache(current);
  if (event.type === "receiveVerdict") return canReceiveVerdict(current);
  if (event.type === "completeWrite") return canCompleteWrite(current);
  if (event.type === "failAttempt") return canFailAttempt(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: JudgmentAttempt, event: Event): JudgmentAttempt {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "readCache" && canReadCache(current)) return readCache(current, event.available);
  if (event.type === "receiveVerdict" && canReceiveVerdict(current)) return receiveVerdict(current);
  if (event.type === "completeWrite" && canCompleteWrite(current)) return completeWrite(current);
  if (event.type === "failAttempt" && canFailAttempt(current)) return failAttempt(current);
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
  if (raw.type === "readCache" && typeof raw.available === "boolean") return { type: "readCache", available: raw.available };
  if (raw.type === "receiveVerdict") return { type: "receiveVerdict" };
  if (raw.type === "completeWrite") return { type: "completeWrite" };
  if (raw.type === "failAttempt") return { type: "failAttempt" };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): JudgmentAttempt | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "LookupCache" || raw.phase === "ReuseVerdict" || raw.phase === "RequestVerdict" || raw.phase === "StoreVerdict" || raw.phase === "NewVerdict" || raw.phase === "AttemptFailed") && Object.keys(raw).length === 1)) return undefined;
  const parsed: JudgmentAttempt = ({ phase: raw.phase });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): JudgmentAttempt {
  //@ ensures inv(\result)
  return initial;
}

/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_judgmentAttempt(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && equal_judgmentAttempt((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
