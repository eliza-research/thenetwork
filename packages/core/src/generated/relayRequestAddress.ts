// GENERATED from spec/relayRequestAddress.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny



/** Story: Ask the agent to relay my own words / Separate a direct request from its message (spec/relayRequestAddress.md) */
//@ pure
export function relayTextRecipientAllowed(named: boolean, counterpartMatches: boolean): boolean {
  return !named || counterpartMatches;
}

/** Story: Ask the agent to relay my own words / Separate a direct request from its message (spec/relayRequestAddress.md) */
//@ pure
export function lawNamedRelayRequiresTheSelectedCounterpart(named: boolean): boolean {
  //@ ensures \result === true
  return !named || !relayTextRecipientAllowed(named, false);
}

/** Story: Ask the agent to relay my own words / Use a named recipient only when one counterpart has that name (spec/relayRequestAddress.md) */
//@ pure
export function relayNamedCandidateAllowed(distinctCounterparts: number): boolean {
  return distinctCounterparts === 1;
}

/** Story: Ask the agent to relay my own words / Use a named recipient only when one counterpart has that name (spec/relayRequestAddress.md) */
//@ pure
export function lawNamedRelayAcceptsExactlyOneDistinctCounterpart(distinctCounterparts: number): boolean {
  //@ ensures \result === true
  return relayNamedCandidateAllowed(distinctCounterparts) === (distinctCounterparts === 1);
}

/** Story: Ask the agent to relay my own words / Polite wording still needs a direct request to send a private item (spec/relayRequestAddress.md) */
//@ pure
export function relayIsIndirectQuestion(question: boolean, modalRequest: boolean, directAction: boolean, adviceQuestion: boolean): boolean {
  return question && (adviceQuestion || (modalRequest && !directAction));
}

/** Story: Ask the agent to relay my own words / Polite wording still needs a direct request to send a private item (spec/relayRequestAddress.md) */
//@ pure
export function lawIndirectPrivateRelayQuestionLeavesUncertainty(question: boolean, adviceQuestion: boolean): boolean {
  //@ ensures \result === true
  return !question || relayIsIndirectQuestion(question, true, false, adviceQuestion);
}
