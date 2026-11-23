// GENERATED from spec/slopSimulationFeedback.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny



/** Story: Evaluate Slop matches with feedback that has arrived / Use feedback from the current simulated time (spec/slopSimulationFeedback.md) */
//@ pure
export function slopSimulationFeedbackReceived(receivedAt: number, now: number): boolean {
  return receivedAt <= now;
}

/** Story: Evaluate Slop matches with feedback that has arrived / Use feedback from the current simulated time (spec/slopSimulationFeedback.md) */
//@ pure
export function lawSlopSimulationFeedbackCannotAppearEarly(receivedAt: number, now: number): boolean {
  //@ ensures \result === true
  return !(now < receivedAt) || !slopSimulationFeedbackReceived(receivedAt, now);
}

/** Story: Evaluate Slop matches with feedback that has arrived / Use feedback from the current simulated time (spec/slopSimulationFeedback.md) */
//@ pure
export function lawSlopSimulationFeedbackAppearsAtReceipt(receivedAt: number): boolean {
  //@ ensures \result === true
  return slopSimulationFeedbackReceived(receivedAt, receivedAt);
}
