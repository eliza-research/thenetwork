import type { NetworkEvent } from "@thenetwork/core";
import { sha256, stableStringify } from "@thenetwork/engine/src/hash.ts";

/** Bind review and delivery to the same complete public listing. */
export function publicEventRevision(event: NetworkEvent): string {
  return sha256(stableStringify(event));
}
