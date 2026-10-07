// Recipient-visibility model: which facets a given recipient may see in an outbound message.
import type { GateFacet, GateInput, MemberCard } from "./types.ts";

/** Owner of a fact relative to the recipient of the draft being checked. */
export type OwnerRelation = "recipient" | "co_participant" | "non_participant";

export interface OwnedFacet extends GateFacet { ownerId: string; ownerName: string; participant: boolean; relation: OwnerRelation }

export interface Visibility {
  recipient: MemberCard | undefined;
  /** Facets the recipient may see (own facets + co-participants' public/network facets). */
  visible: OwnedFacet[];
  /** Facets the recipient must not learn. */
  invisible: OwnedFacet[];
  /** The recipient's own facets, all scopes (a subset of `visible`): never a leak to the recipient. */
  own: OwnedFacet[];
  participantNames: string[];
  nonParticipantNames: string[];
}

export function isVisible(f: GateFacet, ownerId: string, recipientId: string, participants: Set<string>): boolean {
  if (ownerId === recipientId) return true;
  if (f.scope === "public") return participants.has(ownerId);
  if (f.scope === "network") return participants.has(ownerId);
  return false;
}

export function visibility(input: GateInput): Visibility {
  const parts = new Set(input.participantIds);
  const visible: OwnedFacet[] = [], invisible: OwnedFacet[] = [];
  for (const m of input.members) {
    for (const f of m.facets) {
      const relation: OwnerRelation = m.id === input.recipientId ? "recipient" : parts.has(m.id) ? "co_participant" : "non_participant";
      const o: OwnedFacet = { ...f, ownerId: m.id, ownerName: m.name, participant: parts.has(m.id), relation };
      (isVisible(f, m.id, input.recipientId, parts) ? visible : invisible).push(o);
    }
  }
  const byId = new Map(input.members.map(m => [m.id, m]));
  const names = (ids: string[]) => ids.map(id => byId.get(id)?.name ?? input.directory.find(d => d.id === id)?.name).filter((x): x is string => !!x);
  return {
    recipient: byId.get(input.recipientId),
    visible, invisible,
    own: visible.filter(f => f.relation === "recipient"),
    participantNames: names(input.participantIds),
    nonParticipantNames: input.members.filter(m => !parts.has(m.id)).map(m => m.name),
  };
}
