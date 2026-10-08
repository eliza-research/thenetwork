// Hidden weekly availability (PolicyOptions.timeAware, WorldOptions.timeAware). When a persona is
// actually free, from its routine. Hidden truth: only the simulator reads it, never the Network.
// The model is the attention-budget harness's `hiddenAvailability` (packages/engine/experiments/
// attention.ts, iteration 3) with the same draws, so the two give the same answer for the same seed,
// plus presence: a persona away on a trip is not free for a meeting in its home city.
import type { City } from "@thenetwork/core";
import type { Persona } from "../persona.ts";
import { Rng, hash32 } from "../rng.ts";
import { localParts } from "../time.ts";

/**
 * Is a 2-hour slot starting at `t` free in the persona's week? Free when it is between waking + 1h and
 * bedtime; not on a day with a one-off commitment (p = 0.15 per day); evenings (from 17:00): the
 * routine's free evenings, plus 30% of other weekend evenings; weekday daytime: outside the routine's
 * busy blocks (work, school run), then half the time; weekend daytime: 60%. Draws are keyed by
 * (seed, persona, local date, daypart), so the same slot is always free or always busy.
 */
export function hiddenFree(p: Persona, t: number, seed: number | string): boolean {
  const lp = localParts(t, p.homeCity);
  const h = lp.hour + lp.minute / 60, d = lp.weekday;
  const { wake, sleep, busyBlocks, freeEvenings } = p.routine;
  const bed = sleep < 12 ? sleep + 24 : sleep;
  if (h < wake + 1 || h + 2 > bed) return false;
  const key = `${lp.year}-${lp.month}-${lp.day}`;
  const draw = (tag: string) => new Rng(hash32(seed, "avail", tag, p.id, key)).next();
  if (draw("shock") < 0.15) return false;
  const weekend = d === 0 || d === 6;
  if (h >= 17) return freeEvenings.includes(d) || (weekend && draw("weekend-evening") < 0.3);
  if (!weekend) return !busyBlocks.some(([a, b]) => h < b && h + 2 > a) && draw("weekday-day") < 0.5;
  return draw(h < 12 ? "weekend-am" : "weekend-pm") < 0.6;
}

/** Something that knows where a persona is (Oracle.presentIn). */
export interface PresenceCheck { presentIn(p: Persona, city: City, t: number): boolean }

/** Free at `t` for a meeting in `city`: in that city then (trips count) and free in its week. */
export function freeFor(p: Persona, t: number, city: City, seed: number | string, presence: PresenceCheck): boolean {
  return presence.presentIn(p, city, t) && hiddenFree(p, t, seed);
}

/** Share of members booked at a time they are not free who do not come (the rest rearrange). */
export const UNAVAILABLE_NO_SHOW = 0.7;

/**
 * Hidden truth: the meeting for `proposalId` at `at` clashes with the persona's week and the persona
 * will not come (p = UNAVAILABLE_NO_SHOW when not free, keyed by seed, proposal and persona, as in the
 * harness's fix 3). Persona agents and the World use the same draw, so they agree.
 */
export function timeConflict(p: Persona, proposalId: string, at: number, city: City, seed: number | string, presence: PresenceCheck): boolean {
  if (freeFor(p, at, city, seed, presence)) return false;
  return new Rng(hash32(seed, "unavailable", proposalId, p.id)).next() < UNAVAILABLE_NO_SHOW;
}

/** The keys of the offered options the persona is free for, in offer order. */
export function pickTimes(p: Persona, options: readonly { key: string; start: number }[], city: City, seed: number | string, presence: PresenceCheck): string[] {
  return options.filter(o => freeFor(p, o.start, city, seed, presence)).map(o => o.key);
}
