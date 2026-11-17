// GENERATED from spec/monthlyGathering.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Author and review a public city gathering / Review decides the exact draft once and does not contact members (spec/monthlyGathering.md) */
export type GatheringReviewDecision = "ApproveGathering" | "RejectGathering";
/** Story: Author and review a public city gathering / Review decides the exact draft once and does not contact members (spec/monthlyGathering.md) */
export type GatheringReviewOutcome = "GatheringReviewRefused" | "GatheringReviewApproved" | "GatheringReviewRejected";
/** Story: Author and review a public city gathering / Review decides the exact draft once and does not contact members (spec/monthlyGathering.md) */
export type GatheringPhase = "GatheringDraft" | "GatheringApproved" | "GatheringRejected";

/** Story: Author and review a public city gathering / A draft needs a future local month and an eligible public venue with bounded capacity (spec/monthlyGathering.md) */
export const gatheringMinDurationMs: number = 1800000;
/** Story: Author and review a public city gathering / A draft needs a future local month and an eligible public venue with bounded capacity (spec/monthlyGathering.md) */
export const gatheringMaxDurationMs: number = 21600000;
/** Story: Author and review a public city gathering / A draft needs a future local month and an eligible public venue with bounded capacity (spec/monthlyGathering.md) */
export const gatheringMinCapacity: number = 3;
/** Story: Author and review a public city gathering / A draft needs a future local month and an eligible public venue with bounded capacity (spec/monthlyGathering.md) */
export const gatheringMaxCapacity: number = 150;

/** Story: Author and review a public city gathering / Only a current New York Network administrator can author or decide a gathering (spec/monthlyGathering.md) */
//@ pure
export function monthlyGatheringStaffAllowed(networkApp: boolean, nyc: boolean, appAdmin: boolean): boolean {
  return networkApp && nyc && appAdmin;
}

/** Story: Author and review a public city gathering / A draft needs a future local month and an eligible public venue with bounded capacity (spec/monthlyGathering.md) */
//@ pure
export function monthlyGatheringWindowAllowed(now: number, startsAt: number, endsAt: number, inMonth: boolean, publicWindow: boolean, capacity: number): boolean {
  return now < startsAt && gatheringMinDurationMs <= exact_monthlyGathering(endsAt - startsAt) && exact_monthlyGathering(endsAt - startsAt) <= gatheringMaxDurationMs && inMonth && publicWindow && gatheringMinCapacity <= capacity && capacity <= gatheringMaxCapacity;
}

/** Story: Author and review a public city gathering / Review decides the exact draft once and does not contact members (spec/monthlyGathering.md) */
//@ pure
export function monthlyGatheringReview(phase: GatheringPhase, revision: number, expectedRevision: number, decision: GatheringReviewDecision, currentWindow: boolean): GatheringReviewOutcome {
  return phase !== "GatheringDraft" || revision !== expectedRevision ? "GatheringReviewRefused" : (decision === "RejectGathering" ? "GatheringReviewRejected" : (currentWindow ? "GatheringReviewApproved" : "GatheringReviewRefused"));
}

/** Story: Author and review a public city gathering / Review decides the exact draft once and does not contact members (spec/monthlyGathering.md) */
//@ pure
export function lawGatheringReviewRequiresDraft(phase: GatheringPhase, revision: number, expectedRevision: number, decision: GatheringReviewDecision, currentWindow: boolean): boolean {
  //@ ensures \result === true
  return !(monthlyGatheringReview(phase, revision, expectedRevision, decision, currentWindow) !== "GatheringReviewRefused") || (phase === "GatheringDraft" && revision === expectedRevision);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_monthlyGathering(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
