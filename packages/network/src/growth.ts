// Growth in the simulated world: when a member invites a friend, create that friend as a persona.
// Friends resemble their inviter (same or nearby neighborhood, a couple of shared interests,
// a known friendship) and are newcomers the Network knows little about (minimal/light profiles).
// Not every invitee joins, and a small share are bad actors, so vouch accountability is exercised.
import { DAY, HOUR } from "@thenetwork/core";
import { generatePersonas, hash32, Rng, type Persona } from "@thenetwork/sim";
import { NEIGHBORHOODS, travelMinutes, neighborhood } from "./geo.ts";

export interface FriendFactoryOptions {
  seed?: number;
  /** Share of invitees who accept and join (default 0.7). */
  joinRate?: number;
  /** Share of joining invitees who are bad actors (default 0.04). */
  badActorRate?: number;
  /** Days from invite to join, uniform (default [1, 4]). */
  joinDays?: [number, number];
}

export function friendFactory(o: FriendFactoryOptions = {}) {
  const seed = o.seed ?? 1;
  return (inviter: Persona, friendName: string, seq: number): { persona: Persona; joinDelayMs: number } | undefined => {
    const r = new Rng(hash32("friend", seed, inviter.id, seq));
    if (!r.bool(o.joinRate ?? 0.7)) return undefined;
    const [p] = generatePersonas({
      n: 1, seed: hash32("friend-persona", seed, inviter.id, seq), cityWeights: { nyc: 1, sf: 0 }, adversarialRate: 0, minorShare: 0,
      joinSpreadDays: 1, idPrefix: `nyc-g${seq}-`, richness: { minimal: 0.5, light: 0.5 },
    });
    if (!p) return undefined;
    const last = p.name.split(" ").slice(1).join(" ").replace(/-\d+$/, "");
    p.name = `${friendName} ${last || "Lee"}`;
    p.homeCity = "nyc";
    p.invitedBy = inviter.id;
    p.archetype = "newcomer";
    p.joinDay = 0;
    // Same neighborhood 60% of the time, otherwise somewhere within ~30 minutes.
    const home = neighborhood(inviter.routine.homeArea);
    const near = NEIGHBORHOODS.filter(n => travelMinutes(home, n) <= 30);
    p.routine.homeArea = r.bool(0.6) ? home.name : r.pick(near.length ? near : NEIGHBORHOODS).name;
    // Friends share a couple of interests.
    for (const t of r.shuffle([...inviter.hidden.interests]).slice(0, 2)) {
      if (!p.hidden.interests.includes(t)) p.hidden.interests.push(t);
      if (!p.public.statedInterests.includes(t)) p.public.statedInterests.push(t);
    }
    p.relationships = [{ to: inviter.id, type: "friend", closeness: 0.6 }];
    inviter.relationships.push({ to: p.id, type: "friend", closeness: 0.6 });
    if (r.bool(o.badActorRate ?? 0.04)) {
      p.hidden.adversarial = r.pick(["spammer", "scammer"] as const);
    }
    const [d0, d1] = o.joinDays ?? [1, 4];
    return { persona: p, joinDelayMs: Math.round(r.range(d0, d1) * DAY + r.int(0, 8) * HOUR) };
  };
}
