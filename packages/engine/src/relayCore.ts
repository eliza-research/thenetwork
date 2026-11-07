// The decision core of the relay (relay.ts), proved with LemmaScript. Import-free. relay.ts calls it
// for the party and state checks, the consent check and the final decision. Text, photo and contact
// rules are regex and stay in relay.ts; their reasons reach `decisionOf` as data.

export type RelayStatus = "probing" | "mutual" | "closed" | "cancelled" | "expired";
export type CoreDecision = "pass" | "hold" | "block";
export type RelayConsentKind = "contact_share" | "photo";
export interface PartyFacts { id: string; matchable: boolean; optedOut: boolean; held: boolean }
export interface OpportunityFacts { participants: string[]; acceptedBy: string[]; status: RelayStatus }
export interface ItemFacts { id: string; from: string; to: string; at: number }
export interface ConsentFacts { kind: RelayConsentKind; by: string; itemId: string; at: number }

/** The reason for an opportunity that is not "mutual". */
export function stateReason(status: RelayStatus): string {
  //@ verify
  if (status === "probing") return "state:probing";
  if (status === "mutual") return "state:mutual";
  if (status === "closed") return "state:closed";
  if (status === "cancelled") return "state:cancelled";
  return "state:expired";
}

/**
 * Party and state reasons. No reasons means: sender and recipient are the two participants, neither
 * is a minor, no block, nobody opted out or held, and both said yes to a mutual opportunity.
 */
export function partyReasons(item: ItemFacts, op: OpportunityFacts, s: PartyFacts, r: PartyFacts, blocked: boolean): string[] {
  //@ verify
  //@ ensures \result.length === 0 ==> s.id === item.from && r.id === item.to && item.from !== item.to
  //@ ensures \result.length === 0 ==> op.participants.includes(item.from) && op.participants.includes(item.to)
  //@ ensures \result.length === 0 ==> s.matchable && r.matchable && !blocked
  //@ ensures \result.length === 0 ==> !r.optedOut && !s.optedOut && !s.held && !r.held
  //@ ensures \result.length === 0 ==> op.status === "mutual"
  //@ ensures \result.length === 0 ==> forall(i: nat, i < op.participants.length ==> op.acceptedBy.includes(op.participants[i]))
  let out: string[] = [];
  if (s.id !== item.from || r.id !== item.to || item.from === item.to || !op.participants.includes(item.from) || !op.participants.includes(item.to)) out = [...out, "party:not_participant"];
  if (!s.matchable || !r.matchable) out = [...out, "minor:party"];
  if (blocked) out = [...out, "party:blocked"];
  if (r.optedOut) out = [...out, "optout:recipient"];
  if (s.optedOut) out = [...out, "optout:sender"];
  if (s.held) out = [...out, "safety:sender_held"];
  if (r.held) out = [...out, "safety:recipient_held"];
  if (op.status !== "mutual") out = [...out, stateReason(op.status)];
  else if (!op.participants.every(p => op.acceptedBy.includes(p))) out = [...out, "state:not_mutual"];
  return out;
}

/** Consent for THIS item: given by the sender, of this kind, not after the item and not older than `ttl`. */
export function consentReason(item: ItemFacts, c: ConsentFacts | undefined, kind: RelayConsentKind, ttl: number): string | null {
  //@ verify
  //@ ensures c === undefined ==> \result !== null
  //@ ensures c !== undefined && \result === null ==> c.kind === kind && c.by === item.from && c.itemId === item.id && c.at <= item.at && item.at - c.at <= ttl
  if (c === undefined) return "consent:missing";
  if (c.kind !== kind || c.by !== item.from || c.itemId !== item.id) return "consent:mismatch";
  if (c.at > item.at || item.at - c.at > ttl) return "consent:stale";
  return null;
}

/** The reason's family: the text before the first colon. */
export function reasonFamily(r: string): string {
  //@ verify
  const k = r.indexOf(":");
  return k < 0 ? r : r.slice(0, k);
}

/** Pass only with no reasons. Any reason of a blocking family blocks. Every other reason holds. */
export function decisionOf(reasons: string[], blockFamilies: string[]): CoreDecision {
  //@ verify
  //@ ensures (\result === "pass") === (reasons.length === 0)
  //@ ensures (\result === "block") === exists(i: nat, i < reasons.length && blockFamilies.includes(reasonFamily(reasons[i])))
  return reasons.some(r => blockFamilies.includes(reasonFamily(r))) ? "block" : reasons.length > 0 ? "hold" : "pass";
}

export type HeadOutcome = "clear" | "hold" | "block";

/**
 * One Clef head. Only a score below the head's bar is clear; a NaN score fails that test, so it holds.
 * A head blocks only with a severe feature, and a severe feature never clears a score at the bar.
 */
export function headOutcome(p: number, bar: number, severe: boolean): HeadOutcome {
  //@ verify
  //@ type p real
  //@ type bar real
  //@ ensures (\result === "clear") === (p < bar)
  //@ ensures \result === "block" ==> severe
  if (p < bar) return "clear";
  return severe ? "block" : "hold";
}

/** block > hold > pass. */
export function severity(d: CoreDecision): number {
  //@ verify
  return d === "pass" ? 0 : d === "hold" ? 1 : 2;
}

/**
 * The reasons after a classifier hook: the rules' reasons, then the hook's new ones. The hook can only
 * add: each rule reason stays, so the decision never falls below the rules' decision.
 */
export function withHookReasons(first: string[], extra: string[], blockFamilies: string[]): string[] {
  //@ verify
  //@ ensures forall(i: nat, i < first.length ==> \result.includes(first[i]))
  //@ ensures severity(decisionOf(\result, blockFamilies)) >= severity(decisionOf(first, blockFamilies))
  return [...first, ...extra.filter(x => !first.includes(x))];
}
