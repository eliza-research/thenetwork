// GENERATED from spec/relayRequestAddress.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny



/** Story: Ask the agent to relay my own words / Separate a direct request from its message (spec/relayRequestAddress.md) */
//@ pure
export function relayRecipientAllowed(named: boolean, counterpartMatches: boolean): boolean {
  return !named || counterpartMatches;
}

/** Story: Ask the agent to relay my own words / Separate a direct request from its message (spec/relayRequestAddress.md) */
//@ pure
export function lawNamedRelayRequiresTheSelectedCounterpart(named: boolean): boolean {
  //@ ensures \result === true
  return !named || !relayRecipientAllowed(named, false);
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

/** Story: Ask the agent to relay my own words / A separate direct phone request can take the place of a text envelope (spec/relayRequestAddress.md) */
//@ pure
export function relayEnvelopeTextAllowed(delegatedPrivateRequest: boolean, directNumberRequest: boolean): boolean {
  return !(delegatedPrivateRequest || directNumberRequest);
}

/** Story: Ask the agent to relay my own words / A separate direct phone request can take the place of a text envelope (spec/relayRequestAddress.md) */
//@ pure
export function lawDirectNumberRequestTakesPrecedence(delegatedPrivateRequest: boolean): boolean {
  //@ ensures \result === true
  return !relayEnvelopeTextAllowed(delegatedPrivateRequest, true);
}
