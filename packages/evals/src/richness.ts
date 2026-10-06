// Profile richness tiers for stratifying results. The simulator may expose a tier per persona or
// member (minimal / light / medium / rich / very_rich); this reads it defensively under several
// plausible field names. When no tier is exposed, a clearly labelled PROXY bucket (count of
// visible facts of the thinnest attending person) is used instead.
import type { MemberId, WorldSnapshot } from "../../core/src/index.ts";
import type { EvalWorld } from "./worlds.ts";

export const TIERS = ["minimal", "light", "medium", "rich", "very_rich"] as const;
export type Tier = typeof TIERS[number];

const FIELDS = ["richnessTier", "richness", "profileRichness", "profileTier", "tier"];

function readTier(o: unknown): Tier | undefined {
  if (!o || typeof o !== "object") return undefined;
  for (const k of FIELDS) {
    const v = (o as Record<string, unknown>)[k];
    const s = typeof v === "string" ? v : v && typeof v === "object" ? (v as Record<string, unknown>).tier : undefined;
    if (typeof s === "string") {
      const t = s.toLowerCase().replace(/[\s-]+/g, "_") as Tier;
      if ((TIERS as readonly string[]).includes(t)) return t;
    }
  }
  return undefined;
}

/** Tier of one member from the persona (any nesting the sim uses) or the snapshot member. */
export function memberTier(w: EvalWorld, snap: WorldSnapshot, id: MemberId): Tier | undefined {
  const p = w.byId.get(id) as unknown as Record<string, unknown> | undefined;
  return readTier(p) ?? readTier(p?.public) ?? readTier(p?.profile) ?? readTier(p?.hidden)
    ?? readTier(snap.members.find(m => m.id === id))
    ?? readTier((snap as unknown as Record<string, Record<string, unknown> | undefined>).richness?.[id] ? { tier: (snap as any).richness[id] } : undefined);
}

/** Item tier = the thinnest attending participant's tier (undefined if the sim exposes none). */
export function itemTier(w: EvalWorld, snap: WorldSnapshot, participants: MemberId[]): Tier | undefined {
  let best: number | undefined;
  for (const id of participants) {
    const t = memberTier(w, snap, id);
    if (!t) return undefined;
    const i = TIERS.indexOf(t);
    best = best === undefined ? i : Math.min(best, i);
  }
  return best === undefined ? undefined : TIERS[best];
}

/** Proxy when no tier is exposed: visible (matchable + shareable) fact count of the thinnest attending person. */
export function proxyBucket(snap: WorldSnapshot, participants: MemberId[]): string {
  const n = Math.min(...participants.map(id => snap.facets.filter(f => f.memberId === id && (f.scope === "matchable" || f.scope === "shareable")).length));
  return n <= 3 ? "facts<=3" : n <= 5 ? "facts 4-5" : n <= 8 ? "facts 6-8" : n <= 14 ? "facts 9-14" : "facts 15+";
}
export const PROXY_ORDER = ["facts<=3", "facts 4-5", "facts 6-8", "facts 9-14", "facts 15+"];
