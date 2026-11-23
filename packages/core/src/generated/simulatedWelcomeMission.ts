// GENERATED from spec/simulatedWelcomeMission.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny


/** Story: Arrange a meeting for a newcomer / Use the member's join time and the meeting start (spec/simulatedWelcomeMission.md) */
export const welcomeWindowMs: number = 2592000000;

/** Story: Arrange a meeting for a newcomer / Use the member's join time and the meeting start (spec/simulatedWelcomeMission.md) */
//@ pure
export function welcomeMissionRecentAttendee(joinedAt: number, meetingAt: number): boolean {
  return joinedAt <= meetingAt && exact_simulatedWelcomeMission(meetingAt - joinedAt) <= welcomeWindowMs;
}

/** Story: Arrange a meeting for a newcomer / Use the member's join time and the meeting start (spec/simulatedWelcomeMission.md) */
//@ pure
export function lawWelcomeMissionCannotPredateJoin(joinedAt: number, meetingAt: number): boolean {
  //@ ensures \result === true
  return !(meetingAt < joinedAt) || !welcomeMissionRecentAttendee(joinedAt, meetingAt);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_simulatedWelcomeMission(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
