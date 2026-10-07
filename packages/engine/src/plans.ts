// Plans: "I'm free Saturday night and into X" (docs/design/2026-10-07-experience-design.md section 4,
// Phase 2). A planner that runs BESIDE the generators (design 4.4): it starts from members' open
// windows, not from an intent or a pair, and builds activity x public venue x group, scored by least
// misery with one familiar face plus new people. Its output becomes attention items (attention.ts):
// always an anonymous probe first, carrying the time (D5, founder decision 2), then the booked-plan
// reveal once quorum is reached (attention v1.2, iteration 4 "(c)").
//
// MVP scope (growth doc section 3): public venues and events only, never a member's home; no money
// through the Network (everyone pays their own way, PRD 32.12); volunteer shifts at existing
// organizations are activities. Hard rules: members under 18 are never in a plan in any role
// (participant, alternate, host); plans are never romance (category "social", no romance framing,
// D15); blocks, opt-ins, dealbreakers and safety holds come from filters.ts; the cap, quiet hours and
// review are applied by the attention layer and the Network (every plan item involves other members,
// so it waits for review before its first probe).
//
// Engine-visible inputs only. Nothing here reads hidden truth.
import type { Category, City, MemberId, ScoreComponents } from "@thenetwork/core";
import { DAY, HOUR } from "@thenetwork/core";
import { ACTIVITIES, activitiesForTags, activityById, type ActivityType, type Daypart, type Venue } from "./activities.ts";
import { availabilityProb, candidateSlots, timeOptionsPhrase, type AvailabilityEvidence, type TimeSlot } from "./attention.ts";
import { DEFAULT_ATTENTION, DEFAULT_PLANS, type AttentionConfig, type PlansConfig } from "./config.ts";
import { tokenize } from "./embed.ts";
import { privateVocabulary } from "./explain.ts";
import { isMinor, memberReason, pairReason } from "./filters.ts";
import { makeCompat } from "./group.ts";
import { checkMemberFacing } from "./judgeCommon.ts";
import { localParts } from "./outreach.ts";
import { sha256 } from "./rng.ts";
import { objectivesFor } from "./taxonomy.ts";
import type { AttentionItem, EngineProposal, NetworkEvent, Role } from "./types.ts";
import type { World } from "./world.ts";

export { ACTIVITIES, activityById, type ActivityType, type Venue } from "./activities.ts";

/** Plans are social, never romance (D15, 2.2 row 12). */
export const PLAN_CATEGORY: Category = "social";

// ------------------------------------------------------------------------------------------------
// Availability windows (1.11, 4.2)

/** One-off windows a member stated for this week ("free Saturday night"), from the opt-in weekly check-in or a pull. Matchable, never shareable. */
export interface StatedWindows { windows: TimeSlot[]; at: number; until: number; confidence?: number }
/** Everything the planner knows about when a member is free: the attention evidence plus stated windows. */
export interface PlanEvidence extends AvailabilityEvidence { stated?: StatedWindows }
export type WindowSource = "stated" | "standing" | "learned" | "prior";

const jsDay = (t: number, tz: string) => (localParts(t, tz).weekday + 1) % 7;
export function daypartOf(t: number, tz: string, att: AttentionConfig = DEFAULT_ATTENTION): Daypart | "weekday_day" {
  const weekend = att.sendTime.weekendDays.includes(jsDay(t, tz));
  const evening = localParts(t, tz).hour >= 17;
  return weekend ? (evening ? "weekend_evening" : "weekend_day") : evening ? "weekday_evening" : "weekday_day";
}

/**
 * P(member free for `slot`) and the strongest evidence behind it. Stated windows (this week's
 * check-in) pull P toward `stated.inside`; a slot outside every stated window, inside the stated
 * week, is pushed down like a standing window that does not cover it. Otherwise attention's
 * availabilityProb (standing windows, learned accepts and attends, calendar busy, away, quiet hours).
 */
export function planFreeProb(ev: PlanEvidence, slot: TimeSlot, now: number, pcfg: PlansConfig = DEFAULT_PLANS, att: AttentionConfig = DEFAULT_ATTENTION): { p: number; source: WindowSource } {
  let p = availabilityProb(ev, slot, now, att);
  if (p === 0) return { p, source: "prior" };
  const st = ev.stated;
  if (st && st.until > slot.start && st.at <= now) {
    const c = st.confidence ?? pcfg.stated.confidence;
    if (st.windows.some(w => w.start <= slot.start && w.end >= slot.end)) return { p: p + c * (pcfg.stated.inside - p), source: "stated" };
    p *= 1 - pcfg.stated.outsideFactor * c;
    return { p, source: "stated" };
  }
  const lp = localParts(slot.start, ev.tz), day = (lp.weekday + 1) % 7;
  if ((ev.standing ?? []).some(w => w.byDay.includes(day) && lp.hour >= w.startHour && lp.hour < w.endHour)) return { p, source: "standing" };
  const part = daypartOf(slot.start, ev.tz, att);
  if ((ev.history ?? []).some(h => h.outcome !== "declined_time" && h.at <= now && daypartOf(h.at, ev.tz, att) === part)) return { p, source: "learned" };
  return { p, source: "prior" };
}

/** Demand: the slot is a stated or inferred window for the member (not the daypart prior alone) and P(free) >= minFree. */
export function hasWindow(ev: PlanEvidence, slot: TimeSlot, now: number, pcfg: PlansConfig = DEFAULT_PLANS, att: AttentionConfig = DEFAULT_ATTENTION): number {
  const r = planFreeProb(ev, slot, now, pcfg, att);
  return r.source !== "prior" && r.p >= pcfg.minFree ? r.p : 0;
}

// ------------------------------------------------------------------------------------------------
// Activity fit (engine-visible: matchable / shareable facet tags and live intents)

/**
 * activity_fit_i(a): 1 when a stated interest, skill or want maps to the activity (tags or a
 * taxonomy.ts objective); `familyFit` for another activity in a family the member likes; else 0.
 * `hints`: activities the member named in a check-in ("into live music").
 */
export function activityFit(w: World, id: MemberId, pcfg: PlansConfig = DEFAULT_PLANS, hints: readonly string[] = []): Map<string, number> {
  const mi = w.get(id);
  const out = new Map<string, number>();
  if (!mi) return out;
  const objs = new Set(mi.intents.flatMap(i => objectivesFor(i.objective, i.details, i.category).map(o => o.id)));
  const fams = new Set<string>();
  for (const a of ACTIVITIES) {
    if (a.tags.some(t => mi.tags.has(t)) || a.objectives.some(o => objs.has(o)) || hints.includes(a.id)) { out.set(a.id, 1); fams.add(a.family); }
  }
  for (const a of ACTIVITIES) if (!out.has(a.id) && fams.has(a.family)) out.set(a.id, pcfg.familyFit);
  return out;
}

/**
 * Member-level hard rules for a plan seat: every filters.ts memberReason except the interruption and
 * contribution budgets (the attention layer enforces the cap at send time). Minors, paused, safety
 * holds, category opt-out, only-when-asked and the reliability hold-out all exclude.
 */
export function planMemberReason(w: World, id: MemberId, role: Role = "guest"): string | null {
  const r = memberReason(w, id, { category: PLAN_CATEGORY, role, format: "small_group", timeSensitive: true });
  return r === "interruption_budget" || (r === "contribution_budget" && role !== "host") ? null : r;
}

// ------------------------------------------------------------------------------------------------
// Plan scoring (4.5 steps 4-6)

export interface PlanMemberInput { id: MemberId; fit: number; venueFit: number; timeFit: number }

/** u_i(G) = activity_fit x venue_fit x time_fit x (0.5 + 0.5 x mean_j compat(i, j)); compat clamped to [0, 1]. */
export function memberUtility(m: PlanMemberInput, others: readonly MemberId[], compat: (a: MemberId, b: MemberId) => number): number {
  const cs = others.map(o => Math.max(0, Math.min(1, compat(m.id, o))));
  const mc = cs.length ? cs.reduce((s, x) => s + x, 0) / cs.length : 0;
  return m.fit * m.venueFit * m.timeFit * (0.5 + 0.5 * mc);
}

export interface PlanScore { score: number; u: Record<MemberId, number>; min: number; mean: number; familiarity: number; familiar: Record<MemberId, MemberId[]> }

/**
 * Least misery (4.5): U = w x min_i u_i + (1 - w) x mean_i u_i, plus familiarity: +oneBonus for
 * each member with exactly one familiar face and at least one new face, -cliquePenalty for each
 * member with two or more (a closed clique), nothing for a newcomer with none; total clamped.
 * Returns null when a hard pair rule fails (block, dealbreaker, cooldown: compat = -Infinity).
 */
export function scorePlanGroup(members: readonly PlanMemberInput[], compat: (a: MemberId, b: MemberId) => number, familiar: (a: MemberId, b: MemberId) => boolean, pcfg: PlansConfig = DEFAULT_PLANS): PlanScore | null {
  const ids = members.map(m => m.id);
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (compat(ids[i]!, ids[j]!) === -Infinity) return null;
  const u: Record<MemberId, number> = {};
  const fam: Record<MemberId, MemberId[]> = {};
  let adj = 0;
  for (const m of members) {
    const others = ids.filter(x => x !== m.id);
    u[m.id] = memberUtility(m, others, compat);
    fam[m.id] = others.filter(o => familiar(m.id, o));
    const f = fam[m.id]!.length, fresh = others.length - f;
    if (f === 1 && fresh >= 1) adj += pcfg.familiarity.oneBonus;
    else if (f >= 2) adj -= pcfg.familiarity.cliquePenalty;
  }
  const us = Object.values(u);
  const min = Math.min(...us), mean = us.reduce((s, x) => s + x, 0) / us.length;
  const familiarity = Math.max(-pcfg.familiarity.maxPenalty, Math.min(pcfg.familiarity.maxBonus, adj));
  return { score: pcfg.minWeight * min + (1 - pcfg.minWeight) * mean + familiarity, u, min, mean, familiarity, familiar: fam };
}

// ------------------------------------------------------------------------------------------------
// The plan object (4.3)

export interface Plan {
  id: string; city: City; activityId: string; venueId?: string; eventId?: string;
  /** Public place shown in the probe: venue or event name and area. */
  place: { name: string; area?: string };
  window: TimeSlot;
  /** Members probed (primary group, plus alternates once backfilled). */
  invited: MemberId[];
  alternates: MemberId[];
  hostId?: MemberId; crewId?: string;
  /** Activity-partner plan (exactly 2, one-to-one rules) or a group plan (3-6). */
  partner: boolean;
  size: { min: number; target: number; max: number };
  quorum: number;
  probeDeadline: number;
  score: number; u: Record<MemberId, number>; familiar: Record<MemberId, MemberId[]>;
  createdAt: number;
  category: Category;
}

export interface PlannerInput {
  now: number; city: City; tz: string;
  /** Members with any availability evidence (others are never planned: "only with a stated or inferred window"). */
  evidence: ReadonlyMap<MemberId, PlanEvidence>;
  venues: readonly Venue[];
  /** Member is already committed at that slot (open opportunity, booked plan). */
  busyAt?: (id: MemberId, slot: TimeSlot) => boolean;
  /** Members not to plan this run (in a live plan or crew session). */
  exclude?: ReadonlySet<MemberId>;
  /** Demand carried from a plan that did not come together (fallback 3). */
  carry?: readonly { memberId: MemberId; activityId: string; until: number }[];
  /** Members with an engine item held or in flight (unservedOnly). */
  served?: ReadonlySet<MemberId>;
  /** When each member was last invited to a plan (memberCooldownDays). */
  lastPlannedAt?: ReadonlyMap<MemberId, number>;
  /** Activities a member named ("into live music"), from a check-in. */
  hints?: ReadonlyMap<MemberId, string[]>;
}

const openAt = (v: Venue, slot: TimeSlot, durMin: number, tz: string, att: AttentionConfig) => {
  const lp = localParts(slot.start, tz);
  const [o, c] = att.sendTime.weekendDays.includes((lp.weekday + 1) % 7) ? v.hours.weekend : v.hours.weekday;
  return lp.hour >= o && lp.hour + durMin / 60 <= c;
};

interface Cand { plan: Plan; rank: number }

/**
 * The planner (4.5). For each candidate slot (attention.candidateSlots, minLeadHours..horizonDays)
 * and each public event in the horizon: the demand pool D(w) = eligible adults with a stated or
 * inferred window in it; per activity with >= 2 fitting members, the open, age-appropriate public
 * venue that covers the most of their areas; beam search over the pool for a 3-6 group (or a pair
 * for activity-partner activities when no group clears the floors) by least misery; floors on
 * min u_i and U. Greedy across candidates by U: one plan per member per run.
 */
export function planProposals(w: World, inp: PlannerInput, pcfg: PlansConfig = DEFAULT_PLANS, att: AttentionConfig = DEFAULT_ATTENTION): Plan[] {
  const { now, city, tz } = inp;
  const compat = makeCompat(w, PLAN_CATEGORY);
  const familiar = (a: MemberId, b: MemberId) => w.isWarm(a, b);
  // Eligible members with evidence.
  const people: MemberId[] = [];
  const fits = new Map<MemberId, Map<string, number>>();
  for (const [id] of inp.evidence) {
    const mi = w.get(id);
    if (!mi || mi.m.homeCity !== city || inp.exclude?.has(id) || isMinor(w, id) || planMemberReason(w, id)) continue;
    if (now - (inp.lastPlannedAt?.get(id) ?? -Infinity) < pcfg.memberCooldownDays * DAY) continue;
    if (pcfg.unservedOnly && inp.served?.has(id)) continue;
    const f = activityFit(w, id, pcfg, inp.hints?.get(id) ?? []);
    for (const c of inp.carry ?? []) if (c.memberId === id && c.until > now && f.has(c.activityId)) f.set(c.activityId, Math.min(1, f.get(c.activityId)! + pcfg.fallback.carryBonus));
    if (!f.size) continue;
    people.push(id); fits.set(id, f);
  }
  if (people.length < 2) return [];
  const areas = new Map(people.map(id => [id, new Set((w.get(id)!.presence.find(p => p.city === city)?.areas ?? []).map(a => a.toLowerCase()))]));
  const ageOk = (id: MemberId, min: number) => (w.get(id)!.m.age ?? 0) >= min;

  // Candidate times: template slots, plus public events (fixed time and place).
  type When = { slot: TimeSlot; event?: NetworkEvent; acts: ActivityType[] };
  const whens: When[] = [];
  const window = { start: now + pcfg.minLeadHours * HOUR, end: now + pcfg.horizonDays * DAY };
  for (const slot of candidateSlots(tz, now, { window }, att)) {
    const dp = daypartOf(slot.start, tz, att);
    whens.push({ slot, acts: ACTIVITIES.filter(a => (a.dayparts as string[]).includes(dp)) });
  }
  for (const e of w.events) {
    if (e.city !== city || e.start < window.start || e.start > window.end || e.riskTags?.length) continue;
    const acts = activitiesForTags(e.tags);
    if (acts.length) whens.push({ slot: { start: e.start, end: e.end }, event: e, acts: [acts[0]!] });
  }

  const cands: Cand[] = [];
  for (const wh of whens) {
    const avail = new Map<MemberId, number>();
    for (const id of people) {
      if (inp.busyAt?.(id, wh.slot)) continue;
      const p = hasWindow(inp.evidence.get(id)!, wh.slot, now, pcfg, att);
      if (p > 0) avail.set(id, p);
    }
    if (avail.size < 2) continue;
    for (const a of wh.acts) {
      const pool = [...avail.keys()].filter(id => (fits.get(id)!.get(a.id) ?? 0) >= pcfg.minFit && ageOk(id, a.ageMin))
        .sort((x, y) => (fits.get(y)!.get(a.id)! * avail.get(y)! - fits.get(x)!.get(a.id)! * avail.get(x)!) || (x < y ? -1 : 1)).slice(0, pcfg.poolSize);
      if (pool.length < 2) continue;
      // Place: the event itself, or the open public venue covering the most pool members' areas.
      let place: { name: string; area?: string; venueId?: string; ageMin: number; priceTier: number };
      if (wh.event) place = { name: wh.event.title, area: wh.event.area, ageMin: a.ageMin, priceTier: a.costTier };
      else {
        const vs = inp.venues.filter(v => v.public && v.city === city && v.activities.includes(a.id) && openAt(v, wh.slot, a.durationMin, tz, att));
        if (!vs.length) continue;
        const cover = (v: Venue) => pool.filter(id => areas.get(id)!.has(v.area.toLowerCase())).length;
        const v = [...vs].sort((x, y) => (cover(y) - cover(x)) || (x.id < y.id ? -1 : 1))[0]!;
        place = { name: v.name, area: v.area, venueId: v.id, ageMin: Math.max(v.ageMin, a.ageMin), priceTier: v.priceTier };
      }
      const pool2 = pool.filter(id => ageOk(id, place.ageMin));
      const input = (id: MemberId): PlanMemberInput => ({
        id, fit: fits.get(id)!.get(a.id)!, timeFit: avail.get(id)!,
        venueFit: !place.area || areas.get(id)!.has(place.area.toLowerCase()) ? 1 : pcfg.otherAreaFit,
      });
      const score = (ids: MemberId[]) => scorePlanGroup(ids.map(input), compat, familiar, pcfg);
      const passes = (s: PlanScore | null): s is PlanScore => !!s && s.min >= pcfg.minMemberU && s.score >= pcfg.threshold;
      let best: { ids: MemberId[]; s: PlanScore } | undefined;
      const minG = Math.max(pcfg.size.min, a.groupSize[0]), maxG = Math.min(pcfg.size.max, a.groupSize[1], pcfg.size.target);
      const minInvite = Math.min(maxG, Math.max(minG, pcfg.minInvite));
      if (pool2.length >= minInvite) best = beam(pool2, minInvite, maxG, score, passes, pcfg);
      let partner = false;
      if (!best && pcfg.partnerPlans && a.groupSize[0] <= 2) {
        // Activity-partner plan: the best pair (one-to-one intro rules: sequential probes, double opt-in).
        for (let i = 0; i < pool2.length; i++) for (let j = i + 1; j < pool2.length; j++) {
          const s = score([pool2[i]!, pool2[j]!]);
          if (passes(s) && (!best || s.score > best.s.score)) best = { ids: [pool2[i]!, pool2[j]!], s };
        }
        partner = !!best;
      }
      if (!best) continue;
      const primary = best.ids;
      const alternates = pool2.filter(id => !primary.includes(id) && primary.every(p => compat(p, id) !== -Infinity))
        .sort((x, y) => (fits.get(y)!.get(a.id)! * avail.get(y)! - fits.get(x)!.get(a.id)! * avail.get(x)!) || (x < y ? -1 : 1)).slice(0, partner ? 1 : pcfg.alternates);
      const host = partner ? undefined : primary.find(id => w.get(id)!.isHost && !planMemberReason(w, id, "host"));
      const start = wh.slot.start;
      const id = `plan_${sha256(`${city}|${a.id}|${place.venueId ?? wh.event?.id}|${start}|${[...primary].sort().join(",")}|${now}`).slice(0, 16)}`;
      cands.push({
        rank: best.s.score + 0.015 * primary.length,
        plan: {
          id, city, activityId: a.id, ...(place.venueId ? { venueId: place.venueId } : {}), ...(wh.event ? { eventId: wh.event.id } : {}),
          place: { name: place.name, ...(place.area ? { area: place.area } : {}) },
          window: { start, end: wh.event ? wh.slot.end : start + a.durationMin * 60_000 },
          invited: [...primary], alternates, ...(host ? { hostId: host } : {}), partner,
          size: partner ? { min: 2, target: 2, max: 2 } : { min: minG, target: primary.length, max: maxG },
          quorum: partner ? pcfg.quorum.partner : Math.min(primary.length, Math.max(minG, pcfg.quorum.group)),
          probeDeadline: Math.min(start - pcfg.deadlineBeforeStartHours * HOUR, now + pcfg.probeWindowHours * HOUR),
          score: round(best.s.score), u: Object.fromEntries(Object.entries(best.s.u).map(([k, v]) => [k, round(v)])), familiar: best.s.familiar,
          createdAt: now, category: PLAN_CATEGORY,
        },
      });
    }
  }
  // Greedy: best plans first, each member in at most one plan per run (participants and alternates).
  cands.sort((x, y) => (y.rank - x.rank) || (x.plan.id < y.plan.id ? -1 : 1));
  const used = new Set<MemberId>();
  const out: Plan[] = [];
  for (const c of cands) {
    if (out.length >= pcfg.maxPlansPerCityRun) break;
    if (c.plan.invited.some(id => used.has(id))) continue;
    c.plan.alternates = c.plan.alternates.filter(id => !used.has(id) && !out.some(p => p.invited.includes(id)));
    for (const id of c.plan.invited) used.add(id);
    out.push(c.plan);
  }
  // Alternates are never someone already invited elsewhere this run.
  for (const p of out) p.alternates = p.alternates.filter(id => !used.has(id));
  return out;
}

function beam(pool: MemberId[], minG: number, maxG: number, score: (ids: MemberId[]) => PlanScore | null, passes: (s: PlanScore | null) => s is PlanScore, pcfg: PlansConfig):
  { ids: MemberId[]; s: PlanScore } | undefined {
  const key = (ids: MemberId[]) => [...ids].sort().join(",");
  let states: { ids: MemberId[]; v: number }[] = pool.slice(0, pcfg.beamWidth).map(id => ({ ids: [id], v: 0 }));
  const seen = new Set<string>();
  let best: { ids: MemberId[]; s: PlanScore; r: number } | undefined;
  for (let size = 1; size < maxG && states.length; size++) {
    const next: { ids: MemberId[]; v: number; s: PlanScore | null }[] = [];
    for (const st of states) for (const id of pool) {
      if (st.ids.includes(id)) continue;
      const ids = [...st.ids, id], k = key(ids);
      if (seen.has(k)) continue;
      seen.add(k);
      const s = score(ids);
      if (!s) continue;
      next.push({ ids, v: s.score, s });
    }
    next.sort((a, b) => (b.v - a.v) || (key(a.ids) < key(b.ids) ? -1 : 1));
    states = next.slice(0, pcfg.beamWidth);
    for (const st of next.slice(0, pcfg.beamWidth)) {
      if (st.ids.length < minG || !passes(st.s)) continue;
      const r = st.s.score + 0.015 * st.ids.length;
      if (!best || r > best.r) best = { ids: st.ids, s: st.s, r };
    }
  }
  return best && { ids: best.ids, s: best.s };
}
const round = (x: number) => Math.round(x * 1e4) / 1e4;

// ------------------------------------------------------------------------------------------------
// Attention items (always probe first, carrying the time) and the proposal record

const ZERO: ScoreComponents = { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0 };

/** The plan as an EngineProposal (for review queues, logs and the Network's opportunity record). Never romance. */
export function planToProposal(plan: Plan, pcfg: PlansConfig = DEFAULT_PLANS): EngineProposal {
  const a = activityById.get(plan.activityId)!;
  const roles: Record<MemberId, Role> = Object.fromEntries(plan.invited.map(id => [id, id === plan.hostId ? "host" : plan.partner ? "peer" : "guest"]));
  return {
    id: plan.id, kind: plan.partner ? "intro" : "group", participants: [...plan.invited], alternates: [...plan.alternates],
    objective: `plan: ${a.label}`, city: plan.city, window: { ...plan.window }, score: plan.score, components: ZERO, exploration: false,
    explanations: Object.fromEntries(plan.invited.map(id => [id, `${a.label} fits a window you said you're free`])),
    generator: "plan", createdAt: plan.createdAt, category: plan.category, roles, expiresAt: plan.probeDeadline,
    anchor: plan.eventId ? { type: "event", id: plan.eventId, label: plan.place.name } : { type: "interest", id: plan.activityId, label: a.label },
    safetyClass: "low", threshold: pcfg.threshold, channels: ["plan"], judged: false, selectorRank: 0, selectionProbability: 1,
  };
}

/**
 * The plan_probe item for one member. Group plans probe everyone in parallel (quorum); partner plans
 * use the one-to-one order (the caller probes the second after the first's yes). Expires at the probe
 * deadline. Ê = clamp(enjoyIntercept + enjoySlope x U). Involves other members, so it needs review.
 */
export function planItem(plan: Plan, member: MemberId, o: { now: number; reviewState?: AttentionItem["reviewState"]; accept?: number; stage?: "first" | "partner"; pcfg?: PlansConfig; att?: AttentionConfig }): AttentionItem {
  const pcfg = o.pcfg ?? DEFAULT_PLANS, att = o.att ?? DEFAULT_ATTENTION;
  const a = activityById.get(plan.activityId)!;
  const others = plan.invited.filter(x => x !== member);
  return {
    id: `${plan.id}:${member}`, memberId: member, kind: "plan_probe", category: plan.category, sourceProposalId: plan.id, others,
    involvesMember: true, effort: member === plan.hostId ? "contribute" : a.durationMin <= 90 ? "meet_short" : "meet_long",
    enjoy: Math.max(0, Math.min(1, pcfg.enjoyIntercept + pcfg.enjoySlope * plan.score)), accept: o.accept ?? att.acceptancePrior,
    urgency: { expiresAt: plan.probeDeadline, bestBy: plan.window.start },
    createdAt: o.now, reviewState: o.reviewState ?? "pending", key: `plan:${plan.id}`, stage: o.stage ?? "first",
  };
}

// ------------------------------------------------------------------------------------------------
// Probe content (D5)

const COST = ["Free.", "About $10-20 each; everyone pays their own way.", "About $20-40 each; everyone pays their own way.", "About $40+ each; everyone pays their own way."];

/**
 * The anonymous plan probe (D5, founder decision 2). It shows the activity, the time (the plan's
 * window: the yes is a yes to that time), the public place and its area, the number of others and
 * the cost; never a name, photo, employer or any matchable / agent_private fact. "who are into X" is
 * said only when every other invitee has X as a shareable facet (it is a fact about them). Every
 * text goes through the leak gate (judgeCommon.checkMemberFacing with the others' private
 * vocabulary) and a name-token check; richer variants are dropped first; null if none passes.
 * Null for any minor involved and for anything romance (plans never are).
 */
export function buildPlanProbe(w: World, plan: Plan, recipient: MemberId, now: number, tz: string): string | null {
  const others = plan.invited.filter(x => x !== recipient);
  if (!plan.invited.includes(recipient) || plan.category === "romance") return null;
  if ([recipient, ...others].some(id => !w.get(id) || isMinor(w, id))) return null;
  const a = activityById.get(plan.activityId);
  if (!a) return null;
  const when = timeOptionsPhrase([plan.window], tz);
  const ah = a.tags.find(t => others.length > 0 && others.every(o => w.get(o)!.share.some(f => f.tags.includes(t))));
  const into = ah ? ` who are into ${ah.replace(/_/g, " ")}` : "";
  const cost = COST[a.costTier]!;
  const frame = (withInto: boolean, withArea: boolean) => {
    const near = withArea && plan.place.area ? ` near ${plan.place.area}` : "";
    const i = withInto ? into : "";
    if (plan.crewId) return `Your ${a.label} crew is on again: ${when}, ${plan.place.name}${near}. In? ${cost}`;
    if (plan.partner) return `Up for ${a.label} with someone${i}, ${when} at ${plan.place.name}${near}? ${cost} I'll only share who it is if you both say yes.`;
    return `${when}: ${a.label} at ${plan.place.name}${near} with ${others.length} others${i}. ${cost} Want in? I'll share who's coming once enough people say yes.`;
  };
  const names = new Set(others.flatMap(id => tokenize(w.get(id)!.m.name).map(t => t.toLowerCase())));
  // The plan's own public content (taxonomy activity label and tags, the public place) is what the
  // probe is about, not a fact about any member, so its words are not private vocabulary here. Any
  // other private word of the others (canaries, agent_private values, matchable facets) still blocks.
  const own = new Set(tokenize(`${a.label} ${a.tags.join(" ")} ${plan.place.name} ${plan.place.area ?? ""}`).map(t => t.toLowerCase()));
  const vocab = new Set([...privateVocabulary(w, others)].filter(t => !own.has(t.toLowerCase())));
  for (const [i, ar] of [[true, true], [false, true], [false, false]] as const) {
    if (i && !into) continue;
    const text = frame(i, ar);
    if (!tokenize(text).some(t => names.has(t.toLowerCase())) && checkMemberFacing(text, vocab).ok) return text;
  }
  return null;
}

// ------------------------------------------------------------------------------------------------
// Quorum, backfill and fallbacks (4.6)

export type PlanAnswer = "pending" | "yes" | "no";
export interface PlanRun {
  plan: Plan;
  answers: Record<MemberId, PlanAnswer>;
  /** Alternates not yet probed. */
  bench: MemberId[];
  stage: "probing" | "booked" | "closed";
}
export type PlanAction =
  | { kind: "none" } | { kind: "book"; going: MemberId[] } | { kind: "join"; member: MemberId }
  | { kind: "probe_partner"; member: MemberId } | { kind: "backfill"; member: MemberId } | { kind: "fallback" };

export function startPlanRun(plan: Plan): PlanRun {
  // Partner plans follow one-to-one rules: the second member is probed only after the first said yes.
  const first = plan.partner ? plan.invited.slice(0, 1) : plan.invited;
  return { plan, answers: Object.fromEntries(first.map(id => [id, "pending" as PlanAnswer])), bench: [...(plan.partner ? plan.invited.slice(1) : []), ...plan.alternates], stage: "probing" };
}
export const yesOf = (r: PlanRun) => Object.keys(r.answers).filter(x => r.answers[x] === "yes");
export const pendingOf = (r: PlanRun) => Object.keys(r.answers).filter(x => r.answers[x] === "pending");

/**
 * Record a probe answer. Yes: quorum reached -> "book" (the reveal is the booked plan); after
 * booking, a late yes -> "join" until lateJoinHours before the start. Partner plans: the first yes
 * -> "probe_partner". No (or silence): the next alternate -> "backfill" while before the deadline;
 * when nobody is pending and quorum can no longer be reached -> "fallback". Never says who declined.
 */
export function recordPlanAnswer(run: PlanRun, member: MemberId, yes: boolean, now: number, pcfg: PlansConfig = DEFAULT_PLANS): { run: PlanRun; action: PlanAction } {
  if (run.stage === "closed" || run.answers[member] !== "pending") return { run, action: { kind: "none" } };
  const r: PlanRun = { ...run, answers: { ...run.answers, [member]: yes ? "yes" : "no" }, bench: [...run.bench] };
  const p = r.plan;
  if (yes) {
    if (r.stage === "booked") return { run: r, action: now <= p.window.start - pcfg.lateJoinHours * HOUR ? { kind: "join", member } : { kind: "none" } };
    const y = yesOf(r);
    if (y.length >= p.quorum) { r.stage = "booked"; return { run: r, action: { kind: "book", going: y } }; }
    if (p.partner && r.bench.length && now < p.probeDeadline) { const nx = r.bench.shift()!; r.answers[nx] = "pending"; return { run: r, action: { kind: "probe_partner", member: nx } }; }
    return { run: r, action: { kind: "none" } };
  }
  if (r.stage === "booked") return { run: r, action: { kind: "none" } };
  // Partner plan: a no from the first ends it (one-to-one rules: no swap without re-review); a no from the partner tries the next.
  if (p.partner && member === p.invited[0]) { r.stage = "closed"; return { run: r, action: { kind: "fallback" } }; }
  if (r.bench.length && now < p.probeDeadline) {
    const nx = r.bench.shift()!;
    r.answers[nx] = "pending";
    return { run: r, action: { kind: "backfill", member: nx } };
  }
  if (!pendingOf(r).length && yesOf(r).length < p.quorum) { r.stage = "closed"; return { run: r, action: { kind: "fallback" } }; }
  return { run: r, action: { kind: "none" } };
}

/** At the probe deadline without quorum: close and fall back. */
export function checkPlanDeadline(run: PlanRun, now: number): { run: PlanRun; action: PlanAction } {
  if (run.stage !== "probing" || now < run.plan.probeDeadline) return { run, action: { kind: "none" } };
  return { run: { ...run, stage: "closed" }, action: { kind: "fallback" } };
}

export type Fallback =
  | { kind: "smaller"; members: MemberId[] }
  | { kind: "solo_event"; members: MemberId[]; eventId: string }
  | { kind: "next_week"; members: MemberId[] }
  | { kind: "none" };

/**
 * Fallbacks, in order (4.6): (1) a smaller plan of the yes-sayers when >= 2 said yes and the
 * activity allows 2; (2) a solo public event matching the activity for each yes-sayer; (3) next
 * week: the demand is carried (carry: same activity, bonus for `carryDays`). Carry is returned
 * whenever next-week is on and somebody said yes, whatever else happens.
 */
export function planFallback(run: PlanRun, now: number, events: readonly NetworkEvent[], pcfg: PlansConfig = DEFAULT_PLANS):
  { fallback: Fallback; carry: { memberId: MemberId; activityId: string; until: number }[] } {
  const yes = yesOf(run), p = run.plan;
  const a = activityById.get(p.activityId)!;
  const carry = pcfg.fallback.nextWeek ? yes.map(memberId => ({ memberId, activityId: p.activityId, until: now + pcfg.fallback.carryDays * DAY })) : [];
  if (!yes.length) return { fallback: { kind: "none" }, carry };
  if (pcfg.fallback.smaller && yes.length >= 2 && a.groupSize[0] <= 2 && p.window.start - now > pcfg.lateJoinHours * HOUR) return { fallback: { kind: "smaller", members: yes }, carry: [] };
  if (pcfg.fallback.soloEvent) {
    const ev = events.find(e => e.city === p.city && !e.riskTags?.length && e.start > now + 24 * HOUR && e.start < now + 7 * DAY && e.tags.some(t => a.tags.includes(t)));
    if (ev) return { fallback: { kind: "solo_event", members: yes, eventId: ev.id }, carry };
  }
  return { fallback: pcfg.fallback.nextWeek ? { kind: "next_week", members: yes } : { kind: "none" }, carry };
}

// ------------------------------------------------------------------------------------------------
// Recurring crews (4.7)

export interface PlanOutcomeRecord { planId: string; activityId: string; venueId?: string; city: City; at: number; attended: MemberId[]; positive: MemberId[]; recurringWant: MemberId[] }
export interface Crew {
  id: string; activityId: string; venueId?: string; city: City; members: MemberId[]; cadenceDays: number;
  /** Hosts rotate among members with the host tag (else everyone); hosting uses the contribution budget. */
  hostRotation: MemberId[]; sessions: string[]; handedOff: boolean;
  /** Local weekday and hour of the plans that formed it. */
  slot: { start: number };
}

/**
 * A crew is proposed when >= minMembers attended >= minPlans plans of the same activity together
 * and all reported it positive, or after one such plan when one of them stated a recurring want
 * ("weekly", "regular", "club"). Members already in a crew for that activity are not re-grouped.
 */
export function detectCrews(history: readonly PlanOutcomeRecord[], existing: readonly Crew[], isHost: (id: MemberId) => boolean, pcfg: PlansConfig = DEFAULT_PLANS): Crew[] {
  if (!pcfg.crews.enabled) return [];
  const inCrew = new Set(existing.flatMap(c => c.members.map(m => `${c.activityId}|${m}`)));
  const out: Crew[] = [];
  const byAct = new Map<string, PlanOutcomeRecord[]>();
  for (const h of history) byAct.set(h.activityId, [...(byAct.get(h.activityId) ?? []), h]);
  for (const [act, hs] of byAct) {
    const sorted = [...hs].sort((a, b) => a.at - b.at);
    for (let i = 0; i < sorted.length; i++) {
      const pos = new Set(sorted[i]!.positive.filter(m => !inCrew.has(`${act}|${m}`)));
      const groups: MemberId[][] = [];
      if (pos.size >= pcfg.crews.minMembers && (pcfg.crews.minPlans <= 1 || sorted[i]!.recurringWant.some(m => pos.has(m)))) groups.push([...pos]);
      // minPlans = 2: the same members positive at a later plan of the same activity.
      for (let j = i + 1; j < sorted.length && pcfg.crews.minPlans === 2; j++) {
        const both = [...pos].filter(m => sorted[j]!.positive.includes(m));
        if (both.length >= pcfg.crews.minMembers) groups.push(both);
      }
      const g = groups.sort((a, b) => b.length - a.length)[0];
      if (!g) continue;
      const members = [...g].sort();
      for (const m of members) inCrew.add(`${act}|${m}`);
      const last = sorted[i]!;
      const hosts = members.filter(isHost);
      out.push({ id: `crew_${sha256(`${act}|${members.join(",")}`).slice(0, 12)}`, activityId: act, ...(last.venueId ? { venueId: last.venueId } : {}), city: last.city, members,
        cadenceDays: pcfg.crews.cadenceDays, hostRotation: hosts.length ? hosts : members, sessions: [], handedOff: false, slot: { start: last.at } });
    }
  }
  return out;
}

/** The crew's next session (same weekday and time, `cadenceDays` after the last), as a plan; each session is opt-in. Hosts rotate. */
export function crewSessionPlan(crew: Crew, now: number, place: Plan["place"], pcfg: PlansConfig = DEFAULT_PLANS): Plan | null {
  if (crew.handedOff) return null;
  let start = crew.slot.start;
  while (start < now + pcfg.minLeadHours * HOUR) start += crew.cadenceDays * DAY;
  const a = activityById.get(crew.activityId)!;
  const host = crew.hostRotation[crew.sessions.length % crew.hostRotation.length];
  const n = crew.members.length;
  return {
    id: `plan_${sha256(`${crew.id}|${start}`).slice(0, 16)}`, city: crew.city, activityId: crew.activityId, ...(crew.venueId ? { venueId: crew.venueId } : {}),
    place, window: { start, end: start + a.durationMin * 60_000 }, invited: [...crew.members], alternates: [], ...(host ? { hostId: host } : {}), crewId: crew.id,
    partner: false, size: { min: Math.min(3, n), target: n, max: Math.max(n, 3) }, quorum: Math.min(pcfg.quorum.group, n),
    probeDeadline: Math.min(start - pcfg.deadlineBeforeStartHours * HOUR, now + pcfg.probeWindowHours * HOUR), score: 0.6, u: {}, familiar: {}, createdAt: now, category: PLAN_CATEGORY,
  };
}

/** A recurring want ("weekly run club", "regular dinner group"): seeds a crew after one positive plan. */
export const RECURRING_WANT = /\b(weekly|regular(ly)?|every (week|weekend|sunday|saturday|monday|tuesday|wednesday|thursday|friday)|club|crew|group)\b/i;
