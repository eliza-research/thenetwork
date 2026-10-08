// Read a friends snapshot back into typed, agent-visible profiles (what a baseline matcher may use).
// Only snapshot data: claimed age, home neighborhood, stated activities (from interest tags), stated
// free slots and tolerance, energy, holds and feedback. Unknown fields are undefined.
import type { MemberId } from "@thenetwork/core";
import { canBeMatched } from "@thenetwork/core";
import { DEFAULT_TOLERANCE, FT, hood } from "@thenetwork/engine/src/packs/friends/index.ts";
import { FRIEND_ACTIVITIES, SLOTS, type FriendsSlot } from "./persona.ts";
import type { FriendsSnapshot } from "./snapshot.ts";

export interface VisibleProfile {
  id: MemberId; claimedAge: number; adult: boolean; home?: string; zone?: string; borough?: string;
  /** Activity ids whose tags match a stated interest. */
  activities: string[];
  free: FriendsSlot[]; tolerance: number; energy?: string;
  held: boolean;
  /** "would see again" answers others gave about this member. */
  liked: number;
}

export function visibleProfiles(s: FriendsSnapshot): Map<MemberId, VisibleProfile> {
  const out = new Map<MemberId, VisibleProfile>();
  const held = new Set(s.safetyHolds.filter(h => h.from <= s.now && (h.to === undefined || h.to > s.now)).map(h => h.memberId));
  const liked = new Map<MemberId, number>();
  for (const f of s.feedback) if (f.wouldMeetAgain) liked.set(f.about, (liked.get(f.about) ?? 0) + 1);
  for (const m of s.members) {
    const h = hood(s.presence.find(p => p.memberId === m.id && p.type === "home")?.areas[0]);
    out.set(m.id, { id: m.id, claimedAge: m.age, adult: canBeMatched(m.age), home: h?.id, zone: h?.zone, borough: h?.borough, activities: [], free: [], tolerance: DEFAULT_TOLERANCE, held: held.has(m.id), liked: liked.get(m.id) ?? 0 });
  }
  for (const f of s.facets) {
    const v = out.get(f.memberId);
    if (!v) continue;
    for (const t of f.tags) {
      if (f.kind === "interest") for (const a of FRIEND_ACTIVITIES) if (a.tags.includes(t) && !v.activities.includes(a.id)) v.activities.push(a.id);
      if (t.startsWith(FT.free)) { const sl = t.slice(FT.free.length) as FriendsSlot; if ((SLOTS as readonly string[]).includes(sl)) v.free.push(sl); }
      if (t.startsWith(FT.maxTravel)) v.tolerance = Number(t.slice(FT.maxTravel.length)) || DEFAULT_TOLERANCE;
      if (t.startsWith(FT.energy)) v.energy = t.slice(FT.energy.length);
    }
  }
  return out;
}
