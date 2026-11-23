// GENERATED from spec/edgeProjection.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Read current stored relationships / Apply authorized database snapshots to the stored graph view (spec/edgeProjection.md) */
export type EdgeProjectionChange = "KeepEdge" | "ReplaceEdge" | "RemoveEdge";


/** Story: Read current stored relationships / Apply authorized database snapshots to the stored graph view (spec/edgeProjection.md) */
//@ pure
export function edgeProjectionChange(presentInSnapshot: boolean, matchesStored: boolean): EdgeProjectionChange {
  return !presentInSnapshot ? "RemoveEdge" : (matchesStored ? "KeepEdge" : "ReplaceEdge");
}

/** Story: Read current stored relationships / Apply authorized database snapshots to the stored graph view (spec/edgeProjection.md) */
//@ pure
export function lawAbsentStoredEdgesAreRemoved(matchesStored: boolean): boolean {
  //@ ensures \result === true
  return edgeProjectionChange(false, matchesStored) === "RemoveEdge";
}
