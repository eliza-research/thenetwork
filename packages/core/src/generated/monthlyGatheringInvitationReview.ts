// GENERATED from spec/monthlyGatheringInvitationReview.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Approve invitations to an upcoming monthly gathering / The first decision fixes the exact selection for that revision (spec/monthlyGatheringInvitationReview.md) */
export type GatheringSelectionReplay = "FirstGatheringReview" | "ExactGatheringReview" | "ConflictingGatheringReview";


/** Story: Approve invitations to an upcoming monthly gathering / A fresh review records only the current ordered eligible selection (spec/monthlyGatheringInvitationReview.md) */
//@ pure
export function gatheringSelectionInOrder(recommended: string[], selected: string[]): boolean {
  return equal_monthlyGatheringInvitationReview(selected, recommended.filter((id: string) => selected.includes(id)));
}

/** Story: Approve invitations to an upcoming monthly gathering / A fresh review records only the current ordered eligible selection (spec/monthlyGatheringInvitationReview.md) */
//@ pure
export function gatheringInvitationReviewAllowed(currentGathering: boolean, ordered: boolean, selectedCount: number, capacity: number): boolean {
  return currentGathering && ordered && 0 <= selectedCount && selectedCount <= capacity;
}

/** Story: Approve invitations to an upcoming monthly gathering / A fresh review records only the current ordered eligible selection (spec/monthlyGatheringInvitationReview.md) */
//@ pure
export function lawGatheringInvitationReviewUsesCapacity(currentGathering: boolean, ordered: boolean, selectedCount: number, capacity: number): boolean {
  //@ ensures \result === true
  return !gatheringInvitationReviewAllowed(currentGathering, ordered, selectedCount, capacity) || selectedCount <= capacity;
}

/** Story: Approve invitations to an upcoming monthly gathering / The first decision fixes the exact selection for that revision (spec/monthlyGatheringInvitationReview.md) */
//@ pure
export function gatheringSelectionReplay(recorded: boolean, sameSelection: boolean): GatheringSelectionReplay {
  return !recorded ? "FirstGatheringReview" : (sameSelection ? "ExactGatheringReview" : "ConflictingGatheringReview");
}

/** Story: Approve invitations to an upcoming monthly gathering / The first decision fixes the exact selection for that revision (spec/monthlyGatheringInvitationReview.md) */
//@ pure
export function lawGatheringCannotReplaceDecision(sameSelection: boolean): boolean {
  //@ ensures \result === true
  return gatheringSelectionReplay(true, sameSelection) !== "FirstGatheringReview";
}

/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_monthlyGatheringInvitationReview(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && equal_monthlyGatheringInvitationReview((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
