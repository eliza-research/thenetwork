// Leak-gate contract (P21, PRD 17.1-17.2, ME-003, risk R6).
//
// Privacy scopes as the gate sees them. The synthetic v1 dataset uses shareable / matchable /
// agent_private; the gate maps them onto the three PRD scopes:
//   public        (dataset "shareable")     visible to anyone the Network talks to
//   network       (dataset "matchable")     visible to co-participants of the same opportunity only
//   agent_private (dataset "agent_private") visible to the owner only; never in anyone else's outbound
// A recipient may always see their own facets (echoing "you said you avoid bars" back to them is fine).
// Non-participants are invisible entirely: their names and every non-public facet.

export type Scope = "public" | "network" | "agent_private";

/** Topic labels used for reporting and for the deterministic sensitive lexicon. */
export type Topic =
  | "health" | "mental_health" | "addiction" | "sexuality" | "dating" | "finance" | "relationship"
  | "grief" | "work" | "legal" | "location" | "contact" | "identity" | "canary" | "other";

export interface GateFacet {
  id: string;
  kind: string;
  value: string;
  scope: Scope;
  topic?: Topic;
}

export interface MemberCard {
  id: string;
  name: string;
  facets: GateFacet[];
}

export interface GateInput {
  draft: string;
  recipientId: string;
  /** Everyone in the opportunity, including the recipient. */
  participantIds: string[];
  /** Cards for every member whose facts the drafting agent could have seen (participants, decliners, friends in context). */
  members: MemberCard[];
  /** Names of all members known to the Network (non-participant name check). */
  directory: { id: string; name: string }[];
  /** Canary registry (unique per member and run). */
  canaries: { memberId: string; token: string }[];
  /** Places the opportunity legitimately names (public venue name/address); masked before address checks. */
  allowedPlaces?: string[];
  /** Free-text purpose, e.g. "intro", "reminder" (LLM context only). */
  purpose?: string;
}

export type Layer = "deterministic" | "lexicon" | "llm";

export interface Finding {
  layer: Layer;
  rule: string;
  detail: string;
  /** Owner of the revealed fact when known. */
  owner?: string;
}

export interface GateVerdict {
  decision: "pass" | "hold";
  findings: Finding[];
  /** Short human-readable reason (first finding). */
  reason: string;
  llm?: { leak: boolean; reasoning: string; quote?: string; category?: string; latencyMs: number; costMicro: number; error?: string };
}
