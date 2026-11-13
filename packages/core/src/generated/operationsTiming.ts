// GENERATED from spec/operationsTiming.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny
import { reviewLate as reviewDeadline_reviewLate, lawReviewDeadlineIsExclusive as reviewDeadline_lawReviewDeadlineIsExclusive } from "./reviewDeadline.ts";


/** Story: See which work needs attention / Open reviews are due at the deadline and near during the previous hour (spec/operationsTiming.md:7) */
export const millisPerHour: number = 3600000;
/** Story: See which work needs attention / A matcher run is late after twenty-six hours (spec/operationsTiming.md:38) */
export const matcherHeartbeatMillis: number = 26 * millisPerHour;

/** Story: See which work needs attention / Open reviews are due at the deadline and near during the previous hour (spec/operationsTiming.md:7) */
//@ pure
export function nearReviewDeadline(asOf: number, deadline: number): boolean {
  return asOf < deadline && deadline - asOf <= millisPerHour;
}

/** Story: See which work needs attention / Open reviews are due at the deadline and near during the previous hour (spec/operationsTiming.md:7) */
//@ pure
export function waitExceedsSla(asOf: number, queuedAt: number, allowedMillis: number): boolean {
  return asOf - queuedAt > allowedMillis;
}

/** Story: See which work needs attention / Open reviews are due at the deadline and near during the previous hour (spec/operationsTiming.md:7) */
//@ pure
export function lawDueReviewIsNoLongerNear(asOf: number, deadline: number): boolean {
  //@ ensures \result === true
  return !reviewDeadline_reviewLate(asOf, deadline) || !nearReviewDeadline(asOf, deadline);
}

/** Story: See which work needs attention / An urgent safety report is due in one hour (spec/operationsTiming.md:26) */
//@ pure
export function safetyDueAt(openedAt: number, urgent: boolean): number {
  return openedAt + (urgent ? millisPerHour : millisPerHour * 24);
}

/** Story: See which work needs attention / An urgent safety report is due in one hour (spec/operationsTiming.md:26) */
//@ pure
export function safetyOverdue(asOf: number, dueAt: number, outstanding: boolean): boolean {
  return outstanding && asOf > dueAt;
}

/** Story: See which work needs attention / A matcher run is late after twenty-six hours (spec/operationsTiming.md:38) */
//@ pure
export function missedMatcherHeartbeat(asOf: number, lastRunOrStart: number): boolean {
  return asOf - lastRunOrStart > matcherHeartbeatMillis;
}
