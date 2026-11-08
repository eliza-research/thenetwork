// The decisions of the slopPack mutual radius filter (geo.ts), proved with LemmaScript
// (docs/formal-verification.md). Import-free. geo.ts reads the profiles, finds the cells and computes
// the cell distance in miles. These functions take the distance and the two limits and give the
// decision. Numbers are ideal in the proofs, so NaN and Infinity stay with the sims.

/**
 * A market is mutual when both members date in it, it is a configured market, and the distance plus
 * the safety margin is inside BOTH limits: d + margin <= min(limitA, limitB). The answer does not
 * depend on the order of the pair.
 */
export function marketMutual(inA: boolean, inB: boolean, listed: boolean, miles: number, margin: number, limitA: number, limitB: number): boolean {
  //@ verify
  //@ type miles real
  //@ type margin real
  //@ type limitA real
  //@ type limitB real
  //@ ensures \result === marketMutual(inB, inA, listed, miles, margin, limitB, limitA)
  //@ ensures \result <==> (inA && inB && listed && miles + margin <= limitA && miles + margin <= limitB)
  //@ ensures miles + margin > limitA ==> !\result
  //@ ensures miles + margin > limitB ==> !\result
  return inA && inB && listed && miles + margin <= limitA && miles + margin <= limitB;
}

/**
 * The radius pair reason. Both members must be known and have a distance limit, and at least one
 * mutual market must exist. The answer does not depend on the order of the pair.
 */
export function radiusPairReason(knownA: boolean, knownB: boolean, limitKnownA: boolean, limitKnownB: boolean, mutualCount: number): string | null {
  //@ verify
  //@ ensures \result === radiusPairReason(knownB, knownA, limitKnownB, limitKnownA, mutualCount)
  //@ ensures \result === null <==> (knownA && knownB && limitKnownA && limitKnownB && mutualCount > 0)
  //@ ensures !knownA || !knownB ==> \result === "unknown_member"
  if (!knownA || !knownB) return "unknown_member";
  if (!limitKnownA || !limitKnownB) return "distance_unknown";
  return mutualCount > 0 ? null : "outside_radius";
}
