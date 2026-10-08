// Plans in the simulator (plans v1.1, docs/results/2026-10-08-plans.md "For the simulator owner").
// Hidden-truth models for small group plans: how much a persona likes an activity, whether it says
// yes to an anonymous, time-specific plan probe, what it answers to the weekly "What's your week
// like?" check-in, how much it enjoys a plan it went to (the plan oracle), whether it would do it
// again, and whether it opts in to a crew. The starting point is the engine plans harness
// (packages/engine/experiments/plansHarness.ts: planYesProb, checkInAnswer, planEnjoyment,
// crewOptIn, DEFAULT_CAPTURE) with the same formulas and draws, so the two agree for the same seed.
// Only the simulator reads this; the Network under test sees only the persona's words.
//
// The words are part of a contract a Network must parse (reference parsers below):
// - plan probe options: "1", "1 and 2", "1, 3", "the first two", "the first and third", "both",
//   "all of them", "none of those work";
// - "can't make that time" (wanted it, not free then);
// - "Would you do this again?": "Yes, I'd do it again" / "Probably not" (planAgainAnswer);
// - the check-in: day names and dayparts ("Free Tuesday evening and Saturday afternoon.").
import { DAY, HOUR, type City, type MemberId } from "@thenetwork/core";
import { ACTIVITIES, activityById, type ActivityType } from "../../engine/src/packs/network/activities.ts";
import { candidateSlots, type TimeSlot } from "../../engine/src/attention.ts";
import { PAIR_CHEMISTRY_SD, type Oracle } from "./oracle.ts";
import type { Persona } from "./persona.ts";
import { Rng, clamp01, hash32 } from "@thenetwork/core";
import { desireById, INTERESTS } from "./taxonomy.ts";
import { CITY_TZ, localParts } from "./time.ts";

/** One choice in a plan probe (SimMeta.plan.options). `start`/`activity`/`proposalId` override the plan's. */
export interface PlanOption { key: string; label: string; start?: number; end?: number; activity?: string; proposalId?: string }

/** What a plan probe carries (SimMeta.plan). Names nobody: activity, time, place, size. */
export interface PlanMeta {
  planId: string;
  /** Activity id (engine activities.ts, e.g. "bouldering") or its label ("an easy group run"). */
  activity: string;
  options?: PlanOption[];
  window?: { start: number; end: number };
  /** Number of people in the plan (the probe says "with 3 others"). Default 4. */
  size?: number;
  /** Neighbourhood of the public place. */
  area?: string;
}

/**
 * Plan behaviour of the persona agent (PolicyOptions.plans). Everything defaults to on once plans
 * are on; each piece can be switched off to test the assumption behind it.
 */
export interface PlanAgentOptions {
  /**
   * Window priming (default true). A persona who said in this week's check-in that it is free at the
   * plan's time answers the probe like a request it made: 0.85 x (0.3 + 0.7 x like) x presence,
   * instead of the cold model. ASSUMPTION carried from the plans harness; not yet checked with
   * real members (the plans results say it carries part of the gain).
   */
  windowPriming?: boolean;
  /** Answer the one-time "reply WEEKLY" offer with WEEKLY (p = checkIn.base + slope x socialEnergy). Default true. */
  weeklyOptIn?: boolean;
  /** Check-in answer model (default DEFAULT_CAPTURE). */
  capture?: Partial<CaptureModel>;
}
export const resolvePlanOptions = (o: boolean | PlanAgentOptions | undefined): Required<Omit<PlanAgentOptions, "capture">> & { capture: CaptureModel } | undefined =>
  !o ? undefined : { windowPriming: true, weeklyOptIn: true, ...(o === true ? {} : o), capture: { ...DEFAULT_CAPTURE, ...(o === true ? {} : o.capture ?? {}) } };

// ------------------------------------------------------------------------------------------------
// Activity liking

/** The engine activity named by `text`: its id, its label, or a label it contains. */
export function resolveActivity(text: string | undefined): ActivityType | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase().trim();
  return activityById.get(t) ?? ACTIVITIES.find(a => a.label.toLowerCase() === t)
    ?? ACTIVITIES.find(a => t.includes(a.label.toLowerCase()) || t.includes(a.id.replace(/_/g, " ")));
}

/** Hidden liking of an activity (harness hiddenLike): 1 a held interest or skill; 0.8 a held want it serves; 0.35 a liked family; else 0.1. */
export function hiddenLike(p: Persona, a: ActivityType): number {
  const has = (x: ActivityType) => x.tags.some(t => p.hidden.interests.includes(t) || p.hidden.skills.includes(t));
  if (has(a)) return 1;
  if (p.hidden.desires.some(d => a.objectives.includes(d.id) || (desireById.get(d.id)?.needsInterests ?? []).some(t => a.tags.includes(t)))) return 0.8;
  if (ACTIVITIES.some(x => x.family === a.family && has(x))) return 0.35;
  return 0.1;
}

/** Liking of a plan's activity: hiddenLike for a known activity; else 1 when the text names a hidden interest, 0.1 otherwise. */
export function activityLike(p: Persona, activity: string | undefined): number {
  const a = resolveActivity(activity);
  if (a) return hiddenLike(p, a);
  const t = (activity ?? "").toLowerCase();
  const named = p.hidden.interests.some(tag => t.includes(tag.replace(/_/g, " ")) || t.includes((INTERESTS.find(i => i.tag === tag)?.label ?? "\u0000").toLowerCase()));
  return named ? 1 : 0.1;
}

// ------------------------------------------------------------------------------------------------
// Plan probes

const PUSHY = ["spammer", "scammer", "harasser"];

/**
 * P(yes) to an anonymous plan probe (harness planYesProb). The probe shows activity, time, place, size
 * and cost, not who:
 *   (0.3 + 0.7 x this week's capacity) x fatigue x (0.15 + 0.75 x like) x (0.6 + 0.4 x socialEnergy) x size comfort x presence.
 * Primed (stated window this week covering the plan's time): 0.85 x (0.3 + 0.7 x like) x presence.
 * Whether the persona is free then is decided separately (availability.ts): a yes at a time it is not
 * free becomes "can't make that time".
 */
export function planYesProb(oracle: Oracle, p: Persona, like: number, size: number, city: City, at: number, recentAsks: number, primed = false): number {
  if (p.hidden.adversarial && PUSHY.includes(p.hidden.adversarial)) return 0.95;
  const present = oracle.presentIn(p, city, at) ? 1 : 0.1;
  if (primed) return clamp01(0.85 * (0.3 + 0.7 * like) * present);
  const cap = 0.3 + 0.7 * oracle.weekCapacity(p, at);
  const fatigue = Math.pow(0.85, Math.max(0, recentAsks - 1));
  const size_ = 1 - 0.08 * Math.max(0, size - p.hidden.preferredGroupSize) * (1 - p.hidden.socialEnergy);
  return clamp01(cap * fatigue * (0.15 + 0.75 * like) * (0.6 + 0.4 * p.hidden.socialEnergy) * size_ * present);
}

/** The yes draw for one option of one plan (stable per seed, plan, option and persona). */
export const planYesDraw = (seed: number | string, planId: string, key: string, id: MemberId) => new Rng(hash32(seed, "plan-probe", planId, key, id)).next();

/** A stated window covers `t` (the plan starts inside it, within an hour of its start). */
export const windowCovers = (w: { start: number; end: number }, t: number) => t >= w.start - HOUR && t < w.end;

// ------------------------------------------------------------------------------------------------
// The plan oracle

/** Enjoyment at or above this, and the persona would do the plan again (the harness's "positive"). */
export const PLAN_AGAIN_THRESHOLD = 0.6;

/**
 * Enjoyment of a plan for each attendee (harness planEnjoyment):
 *   e_i = clamp01(0.85 x A_i x C_i x L_i + n_i)
 *   A_i = 0.4 + 0.6 x like_i(activity)                                          activity fit
 *   C_i = clamp(0.35 + mean_j [pairEnjoyment(i, j) + chem(i, j)], 0.2, 1.1)     group chemistry
 *   L_i = 1 - 0.06 x max(0, |G| - preferredGroupSize) x (1 - socialEnergy) - 0.05 [area not home/work]
 *         + 0.08 x [a familiar face] x (1 - socialEnergy)                       logistics and comfort
 *   n_i ~ N(0, 0.08) per (plan, member)                                         how the evening went
 * `seed` must be the oracle's seed (the chemistry draw is the oracle's).
 */
export function planEnjoyment(oracle: Oracle, seed: number | string, plan: { id: string; activity?: string; area?: string }, attendees: MemberId[]): Record<MemberId, number> {
  const ps = attendees.map(id => oracle.persona(id)).filter((p): p is Persona => !!p);
  const out: Record<MemberId, number> = {};
  const chem = (a: MemberId, b: MemberId) => new Rng(hash32(seed, "chem", ...[a, b].sort())).normal(0, PAIR_CHEMISTRY_SD);
  for (const p of ps) {
    const others = ps.filter(o => o.id !== p.id);
    const chemI = others.length ? others.reduce((s, o) => s + oracle.pairEnjoyment(p, o, "social").e + chem(p.id, o.id), 0) / others.length : 0;
    const A = 0.4 + 0.6 * activityLike(p, plan.activity);
    const C = Math.max(0.2, Math.min(1.1, 0.35 + chemI));
    const fam = others.some(o => p.relationships.some(r => r.to === o.id && r.type !== "ex"));
    const area = plan.area?.toLowerCase();
    const L = 1 - 0.06 * Math.max(0, ps.length - p.hidden.preferredGroupSize) * (1 - p.hidden.socialEnergy)
      - (area && area !== p.routine.homeArea.toLowerCase() && area !== p.routine.workArea.toLowerCase() ? 0.05 : 0)
      + (fam ? 0.08 * (1 - p.hidden.socialEnergy) : 0);
    const noise = new Rng(hash32(seed, "plan-night", plan.id, p.id)).normal(0, 0.08);
    out[p.id] = Math.round(clamp01(0.85 * A * C * L + noise) * 1000) / 1000;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// Availability capture (the weekly check-in)

export interface CaptureModel {
  /** Opts in to the weekly check-in: p = base + slope x socialEnergy. */
  checkIn: { base: number; slope: number };
  /** A stated window covers a truly free slot with p = recall; a busy one with p = falsePositive. */
  recall: number; falsePositive: number;
}
/** The harness's DEFAULT_CAPTURE (without standing availability at onboarding, which the sim's answers already carry). */
export const DEFAULT_CAPTURE: CaptureModel = { checkIn: { base: 0.25, slope: 0.35 }, recall: 0.8, falsePositive: 0.05 };

/** Does the persona opt in to the weekly check-in when offered (harness optsInToCheckIn, same draw)? */
export const optsInToCheckIn = (seed: number | string, p: Persona, m: CaptureModel = DEFAULT_CAPTURE) =>
  new Rng(hash32(seed, "checkin-optin", p.id)).next() < m.checkIn.base + m.checkIn.slope * p.hidden.socialEnergy;

/**
 * The windows a persona states in answer to "What's your week like?" (harness checkInAnswer): the
 * candidate slots of the next 7 days (engine attention templates: weekday 19:00, weekend 10:00 / 14:00
 * / 19:00, from 24 hours ahead) it is truly free for with p = recall, plus busy ones with p = falsePositive.
 */
export function checkInWindows(p: Persona, now: number, city: City, seed: number | string, free: (t: number) => boolean, m: CaptureModel = DEFAULT_CAPTURE): TimeSlot[] {
  const slots = candidateSlots(CITY_TZ[city], now, { window: { start: now, end: now + 7 * DAY } });
  return slots.filter(s => new Rng(hash32(seed, "checkin-ans", p.id, s.start)).next() < (free(s.start) ? m.recall : m.falsePositive));
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const partOf = (h: number) => (h < 12 ? "morning" : h < 17 ? "afternoon" : "evening");

/** Words for stated windows: "Free Tuesday evening and Saturday afternoon." Day names and dayparts only. */
export function checkInText(windows: readonly TimeSlot[], city: City, rng: Rng): string {
  if (!windows.length) return rng.pick(["Pretty packed this week, sorry.", "Busy week, nothing free.", "This week is full, sorry."]);
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const w of [...windows].sort((a, b) => a.start - b.start)) {
    const lp = localParts(w.start, city);
    const s = `${DAY_NAMES[lp.weekday]} ${partOf(lp.hour)}`;
    if (!seen.has(s)) { seen.add(s); parts.push(s); }
  }
  const list = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return rng.pick([`Free ${list}.`, `I'm free ${list}.`, `${list.charAt(0).toUpperCase()}${list.slice(1)} ${parts.length === 1 ? "works" : "work"} for me.`]);
}

// ------------------------------------------------------------------------------------------------
// Crews

/** Crew offer opt-in (harness crewOptIn: 0.7 x (1 - ignore probability)); the persona agent applies the ignore draw. */
export const CREW_OPT_IN = 0.7;
export const crewOptInDraw = (seed: number | string, crewId: string, id: MemberId) => new Rng(hash32(seed, "crew-optin", crewId, id)).next();

// ------------------------------------------------------------------------------------------------
// Words: multi-item picks and "would you do this again?"

const ORD = ["first", "second", "third", "fourth", "fifth"];
const COUNT = ["", "one", "two", "three", "four", "five"];

/**
 * Words for the picked options of a plan probe, in forms a Network must parse back (parsePlanPicks):
 * keys ("1", "1 and 2", "1, 3"), ordinals ("the first two", "the first and third", "the second one"),
 * "both" / "all of them", and "none of those work". The answer is always in the first sentence.
 */
export function planPicksText(picks: readonly string[], options: readonly { key: string }[], rng: Rng): string {
  const n = options.length;
  const idx = options.map((o, i) => (picks.includes(o.key) ? i : -1)).filter(i => i >= 0);
  if (!idx.length) return rng.pick(["None of those work for me, sorry.", "None of those this time, thanks.", "Hmm, none of those work this week."]);
  const keys = idx.map(i => options[i]!.key);
  if (idx.length === 1) return rng.pick([`${keys[0]}`, `${keys[0]} works for me.`, `The ${ORD[idx[0]!] ?? "last"} one.`, `${keys[0]} please!`]);
  const forms = [`${keys.slice(0, -1).join(", ")} and ${keys[keys.length - 1]}`, `${keys.join(", ")} work for me.`];
  if (idx.length === n) forms.push(n === 2 ? "Both!" : "All of them!", n === 2 ? "Both work for me." : "All of those work.");
  else if (idx.every((x, i) => x === i)) forms.push(`The first ${COUNT[idx.length]}.`);
  else if (idx.every(i => ORD[i])) forms.push(`The ${idx.slice(0, -1).map(i => ORD[i]).join(", ")} and ${ORD[idx[idx.length - 1]!]}.`);
  return rng.pick(forms);
}

/** Reference parser for planPicksText (what a Network must understand). Returns the picked keys in offer order. */
export function parsePlanPicks(text: string, options: readonly { key: string }[]): string[] {
  const t = text.toLowerCase().replace(/[.,!?]/g, " ");
  if (/\b(none|neither|not this time|pass)\b/.test(t)) return [];
  if (/\b(both|all of (them|those)|any of (them|those)|either)\b/.test(t)) return options.map(o => o.key);
  const firstK = /\bthe first (two|three|four|five)\b/.exec(t);
  if (firstK) return options.slice(0, COUNT.indexOf(firstK[1]!)).map(o => o.key);
  const ords = ORD.map((w, i) => (new RegExp(`\\b${w}\\b`).test(t) ? i : -1)).filter(i => i >= 0 && i < options.length);
  if (ords.length) return ords.map(i => options[i]!.key);
  const tokens = new Set(t.split(/\s+/).filter(Boolean));
  return options.filter(o => tokens.has(o.key.toLowerCase())).map(o => o.key);
}

/** "Would you do this again?" asked after a plan (on a feedback_request). */
export const PLAN_AGAIN_RE = /\bwould you do (this|that|it) again\b/i;

/** Reference parser for the persona's answer to "Would you do this again?". */
export function planAgainAnswer(text: string): "yes" | "no" | "unclear" {
  const t = text.toLowerCase().replace(/[‘’]/g, "'");
  if (/\b(couldn'?t make it|didn'?t (go|make it)|nobody else|no one else|never showed)\b/.test(t)) return "unclear";
  if (/\b(probably not|not really|no\b|nah|wouldn'?t)\b/.test(t)) return "no";
  if (/\b(yes|yeah|yep|definitely|absolutely|for sure|again)\b/.test(t)) return "yes";
  return "unclear";
}

/** Persona words for "Would you do this again?" (facts first, then the answer). */
export function planAgainText(f: { showed: boolean; othersShowed: boolean; again: boolean }, rng: Rng): string {
  if (!f.showed) return "I couldn't make it in the end, sorry.";
  if (!f.othersShowed) return "Nobody else came, so hard to say.";
  return f.again
    ? rng.pick(["Yes, I'd do it again!", "Definitely, that was fun. Would do it again.", "Yes! Count me in next time."])
    : rng.pick(["Probably not, it wasn't really my thing.", "Not really, but thanks for setting it up.", "Probably not, thanks though."]);
}
