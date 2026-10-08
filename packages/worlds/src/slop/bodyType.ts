// Iteration 4: body type in the slop world (OFF unless a run sets `bodyTypes`, so earlier baselines
// are unchanged). Hidden truth: each persona has a categorical body type; `prefShare` of people have
// a body-type preference (two liked types), which adds +weight to their attraction latent toward a
// liked type and -weight toward any other. `statedShare` of the people with a preference state it to
// the agent (slop:wants_body:<type>, agent_private). The simulated rater reports the true body type
// with p = raterAccuracy (else a random other type). Body type is drawn independently of
// desirability and of every other trait, so it encodes no body-size hierarchy; that is a modelling
// choice, not a claim about real people (docs, iteration 4). Deterministic per persona id.
import type { MemberId } from "@thenetwork/core";
import { BODY_TYPES, type BodyType } from "@thenetwork/engine/src/packs/slop/appearance.ts";
import { Rng, hash32 } from "@thenetwork/sim/src/rng.ts";

export interface BodyTypeModel { prefShare: number; weight: number; statedShare: number; raterAccuracy: number }
export const BODY_TYPE_DEFAULTS: BodyTypeModel = { prefShare: 0.5, weight: 0.6, statedShare: 0.5, raterAccuracy: 0.8 };

const MIX: [BodyType, number][] = [["slim", 0.2], ["athletic", 0.2], ["average", 0.3], ["curvy", 0.15], ["plus_size", 0.15]];

export function trueBodyType(id: MemberId): BodyType {
  return new Rng(hash32("slop-body", id)).weighted(MIX);
}
/** The hidden body-type preference (two liked types), or undefined for people without one. */
export function bodyPref(id: MemberId, m: BodyTypeModel): BodyType[] | undefined {
  const r = new Rng(hash32("slop-body-pref", id));
  if (r.next() >= m.prefShare) return undefined;
  return r.sample([...BODY_TYPES], 2).sort();
}
/** Whether a person with a preference states it to the agent. */
export const bodyPrefStated = (id: MemberId, m: BodyTypeModel): boolean => new Rng(hash32("slop-body-stated", id)).next() < m.statedShare;
/** Attraction-latent term of a toward b (0 without a preference). */
export function bodyTerm(a: MemberId, b: MemberId, m: BodyTypeModel): number {
  const pref = bodyPref(a, m);
  return pref ? (pref.includes(trueBodyType(b)) ? m.weight : -m.weight) : 0;
}
/** What the simulated rater reports. */
export function ratedBodyType(id: MemberId, m: BodyTypeModel): BodyType {
  const r = new Rng(hash32("slop-body-rated", id)), t = trueBodyType(id);
  return r.next() < m.raterAccuracy ? t : r.pick(BODY_TYPES.filter(x => x !== t));
}
