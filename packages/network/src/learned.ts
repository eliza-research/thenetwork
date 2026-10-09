// What the Network learned from members' texts, as network.facets rows (PRD 32.4, 32.5, F5). The
// Network keeps learned interests, skills, wants and app tags in its own state (network_state); the
// service mirrors them into network.facets after every unit, so the member's export (/api/me/export)
// and the console see them too. Every mirrored row has ":chat:" in its id. The Network reads its own
// state, never these rows back (withoutChatFacets), so the engine input is the same with or without them.
//   interests, skills  matchable, provenance said, source chat
//   wants              kind desire, matchable, valid until the want lapses (60 days after it was said)
//   app tags           agent_private (slop: orientation, age range, distance, zip, goal, dealbreakers),
//                      provenance said (source chat), or inferred (source llm) when only the LLM reader read it
import { DAY, type Facet, type WorldSnapshot } from "@thenetwork/core";
import { desireById, INTERESTS, SKILLS } from "@thenetwork/engine/src/packs/network/vocabulary.ts";
import type { NetworkState } from "./network.ts";

/** The id marker of a facet mirrored from the Network's state. */
export const CHAT_FACET = ":chat:";
export const isChatFacet = (f: { id: string }) => f.id.includes(CHAT_FACET);

/** A snapshot without the mirrored rows (the same object when there are none). */
export function withoutChatFacets(snap: WorldSnapshot): WorldSnapshot {
  return snap.facets.some(isChatFacet) ? { ...snap, facets: snap.facets.filter(f => !isChatFacet(f)) } : snap;
}

/** One network.facets row (column names). */
export interface LearnedFacetRow {
  id: string; member_id: string; kind: Facet["kind"]; value: string; tags: string[];
  privacy_scope: Facet["scope"]; provenance: Facet["provenance"]; source: string; confidence: number;
  valid_from: number; valid_to: number | null;
}

/** How long a want a member told us about stays live (network.ts LEARNED_DESIRE_DAYS). */
export const LEARNED_WANT_DAYS = 60;

/** Every row the Network's state says should exist, by id. Members declined at join have none. */
export function learnedFacetRows(state: NetworkState): Map<string, LearnedFacetRow> {
  const out = new Map<string, LearnedFacetRow>();
  const declined = new Set(state.declinedIds);
  const label = (tag: string, list: readonly { tag: string; label: string }[]) => list.find(x => x.tag === tag)?.label ?? tag.replace(/_/g, " ");
  for (const m of state.members) {
    if (declined.has(m.id)) continue;
    const add = (r: Omit<LearnedFacetRow, "member_id">) => out.set(r.id, { ...r, member_id: m.id });
    const since = m.joinedAt;
    for (const t of m.learned.interests) add({ id: `${m.id}${CHAT_FACET}i:${t}`, kind: "interest", value: label(t, INTERESTS), tags: [t], privacy_scope: "matchable", provenance: "said", source: "chat", confidence: 0.85, valid_from: since, valid_to: null });
    for (const t of m.learned.skills) add({ id: `${m.id}${CHAT_FACET}s:${t}`, kind: "skill", value: label(t, SKILLS), tags: [t], privacy_scope: "matchable", provenance: "said", source: "chat", confidence: 0.85, valid_from: since, valid_to: null });
    for (const [d, at] of m.learned.desires) {
      const def = desireById.get(d);
      if (!def) continue;
      add({ id: `${m.id}${CHAT_FACET}d:${d}`, kind: "desire", value: def.text, tags: [d], privacy_scope: "matchable", provenance: "said", source: "chat", confidence: 0.85, valid_from: at, valid_to: at + LEARNED_WANT_DAYS * DAY });
    }
    // App tags stay agent_private: the member's own agent uses them to filter, never shows them.
    for (const t of m.appTags ?? []) {
      const llm = t.provenance === "llm";
      add({ id: `${m.id}${CHAT_FACET}app:${t.tag}`, kind: t.kind, value: t.tag, tags: [t.tag], privacy_scope: "agent_private", provenance: llm ? "inferred" : "said", source: llm ? "llm" : "chat", confidence: llm ? 0.7 : 0.9, valid_from: t.at, valid_to: null });
    }
  }
  return out;
}

/** Same row content (what an upsert would change). */
export function sameRow(a: LearnedFacetRow, b: Pick<LearnedFacetRow, "kind" | "value" | "tags" | "privacy_scope" | "provenance" | "valid_to">): boolean {
  return a.kind === b.kind && a.value === b.value && a.privacy_scope === b.privacy_scope && a.provenance === b.provenance
    && (a.valid_to ?? null) === (b.valid_to ?? null) && a.tags.length === b.tags.length && a.tags.every((t, i) => t === b.tags[i]);
}
