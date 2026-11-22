// GENERATED from spec/relayDecision.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Keep unsafe items from reaching a match / A blocking reason takes precedence over a hold (spec/relayDecision.md) */
export type RelayVerdict = "Pass" | "Hold" | "Block";


/** Story: Share only the item I approved / Consent cannot come from the future or outlive the item window (spec/relayDecision.md) */
//@ pure
export function relayConsentStale(consentAt: number, itemAt: number, lifetime: number): boolean {
  return consentAt > itemAt || exact_relayDecision(itemAt - consentAt) > lifetime;
}

/** Story: Share only the item I approved / Consent cannot come from the future or outlive the item window (spec/relayDecision.md) */
//@ pure
export function lawFutureConsentIsStale(consentAt: number, itemAt: number, lifetime: number): boolean {
  //@ ensures \result === true
  return !(consentAt > itemAt) || relayConsentStale(consentAt, itemAt, lifetime);
}

/** Story: Share only the item I approved / A refusal or uncertainty cannot authorize a private item (spec/relayDecision.md) */
//@ pure
export function privateRelayRequestAllowed(refused: boolean, uncertain: boolean): boolean {
  return !refused && !uncertain;
}

/** Story: Share only the item I approved / A refusal or uncertainty cannot authorize a private item (spec/relayDecision.md) */
//@ pure
export function lawPrivateRelayRequiresUnqualifiedConsent(refused: boolean, uncertain: boolean): boolean {
  //@ ensures \result === true
  return !(refused || uncertain) || !privateRelayRequestAllowed(refused, uncertain);
}

/** Story: Share only the item I approved / A member can take back a pending number swap (spec/relayDecision.md) */
//@ pure
export function pendingSwapWithdrawn(namesOwnContact: boolean, withholdsContact: boolean, declinesPendingSend: boolean): boolean {
  return declinesPendingSend || (namesOwnContact && withholdsContact);
}

/** Story: Share only the item I approved / A member can take back a pending number swap (spec/relayDecision.md) */
//@ pure
export function lawGoAheadKeepsPendingSwap(namesOwnContact: boolean): boolean {
  //@ ensures \result === true
  return !pendingSwapWithdrawn(namesOwnContact, false, false);
}

/** Story: Share only the item I approved / A member can take back a pending number swap (spec/relayDecision.md) */
//@ pure
export function lawDirectRefusalWithdrawsPendingSwap(namesOwnContact: boolean, withholdsContact: boolean): boolean {
  //@ ensures \result === true
  return pendingSwapWithdrawn(namesOwnContact, withholdsContact, true);
}

/** Story: Share only the item I approved / A phone exchange must still have consent at dispatch (spec/relayDecision.md) */
//@ pure
export function relayRecordMayDispatch(passed: boolean, rejected: boolean, withdrawn: boolean): boolean {
  return passed && !rejected && !withdrawn;
}

/** Story: Share only the item I approved / A phone exchange must still have consent at dispatch (spec/relayDecision.md) */
//@ pure
export function lawWithdrawnRelayRecordsCannotDispatch(passed: boolean, rejected: boolean): boolean {
  //@ ensures \result === true
  return !relayRecordMayDispatch(passed, rejected, true);
}

/** Story: Keep unsafe items from reaching a match / A blocking reason takes precedence over a hold (spec/relayDecision.md) */
//@ pure
export function relayVerdict(hasBlock: boolean, hasReason: boolean): RelayVerdict {
  return hasBlock ? "Block" : (hasReason ? "Hold" : "Pass");
}

/** Story: Keep unsafe items from reaching a match / A blocking reason takes precedence over a hold (spec/relayDecision.md) */
//@ pure
export function lawARelayPassHasNoReason(hasBlock: boolean, hasReason: boolean): boolean {
  //@ ensures \result === true
  return !(relayVerdict(hasBlock, hasReason) === "Pass") || (!hasBlock && !hasReason);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_relayDecision(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
