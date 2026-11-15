// GENERATED from spec/relayDecision.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny

/** Story: Keep unsafe items from reaching a match / A blocking reason takes precedence over a hold (spec/relayDecision.md:25) */
export type RelayVerdict = "Pass" | "Hold" | "Block";


/** Story: Share only the item I approved / Consent cannot come from the future or outlive the item window (spec/relayDecision.md:9) */
//@ pure
export function relayConsentStale(consentAt: number, itemAt: number, lifetime: number): boolean {
  return consentAt > itemAt || itemAt - consentAt > lifetime;
}

/** Story: Share only the item I approved / Consent cannot come from the future or outlive the item window (spec/relayDecision.md:9) */
//@ pure
export function lawFutureConsentIsStale(consentAt: number, itemAt: number, lifetime: number): boolean {
  //@ ensures \result === true
  return !(consentAt > itemAt) || relayConsentStale(consentAt, itemAt, lifetime);
}

/** Story: Keep unsafe items from reaching a match / A blocking reason takes precedence over a hold (spec/relayDecision.md:25) */
//@ pure
export function relayVerdict(hasBlock: boolean, hasReason: boolean): RelayVerdict {
  return hasBlock ? "Block" : (hasReason ? "Hold" : "Pass");
}

/** Story: Keep unsafe items from reaching a match / A blocking reason takes precedence over a hold (spec/relayDecision.md:25) */
//@ pure
export function lawARelayPassHasNoReason(hasBlock: boolean, hasReason: boolean): boolean {
  //@ ensures \result === true
  return !(relayVerdict(hasBlock, hasReason) === "Pass") || (!hasBlock && !hasReason);
}
