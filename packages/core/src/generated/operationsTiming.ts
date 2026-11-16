// GENERATED from spec/operationsTiming.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { reviewLate as reviewDeadline_reviewLate, lawReviewDeadlineIsExclusive as reviewDeadline_lawReviewDeadlineIsExclusive } from "./reviewDeadline.ts";


/** Story: See which work needs attention / Open reviews are due at the deadline and near during the previous hour (spec/operationsTiming.md) */
export const millisPerHour: number = 3600000;
/** Story: See which work needs attention / A matcher run is late after twenty-six hours (spec/operationsTiming.md) */
export const matcherHeartbeatMillis: number = exact_operationsTiming(26 * millisPerHour);

/** Story: See which work needs attention / Open reviews are due at the deadline and near during the previous hour (spec/operationsTiming.md) */
//@ pure
export function nearReviewDeadline(asOf: number, deadline: number): boolean {
  return asOf < deadline && exact_operationsTiming(deadline - asOf) <= millisPerHour;
}

/** Story: See which work needs attention / Open reviews are due at the deadline and near during the previous hour (spec/operationsTiming.md) */
//@ pure
export function waitExceedsSla(asOf: number, queuedAt: number, allowedMillis: number): boolean {
  return exact_operationsTiming(asOf - queuedAt) > allowedMillis;
}

/** Story: See which work needs attention / Open reviews are due at the deadline and near during the previous hour (spec/operationsTiming.md) */
//@ pure
export function lawDueReviewIsNoLongerNear(asOf: number, deadline: number): boolean {
  //@ ensures \result === true
  return !reviewDeadline_reviewLate(asOf, deadline) || !nearReviewDeadline(asOf, deadline);
}

/** Story: See which work needs attention / An urgent safety report is due in one hour (spec/operationsTiming.md) */
//@ pure
export function safetyDueAt(openedAt: number, urgent: boolean): number {
  return exact_operationsTiming(openedAt + (urgent ? millisPerHour : exact_operationsTiming(millisPerHour * 24)));
}

/** Story: See which work needs attention / An urgent safety report is due in one hour (spec/operationsTiming.md) */
//@ pure
export function safetyOverdue(asOf: number, dueAt: number, outstanding: boolean): boolean {
  return outstanding && asOf > dueAt;
}

/** Story: See which work needs attention / A matcher run is late after twenty-six hours (spec/operationsTiming.md) */
//@ pure
export function missedMatcherHeartbeat(asOf: number, lastRunOrStart: number): boolean {
  return exact_operationsTiming(asOf - lastRunOrStart) > matcherHeartbeatMillis;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_operationsTiming(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
