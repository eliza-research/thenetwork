// Build the engine's snapshot for friends.help from what the agent KNOWS: stated profile facets
// (filtered by richness), the onboarding checks and safety cues the Network observed, and what the
// Network recorded (interactions, feedback, blocks, reports, crews, post-plan outcomes, check-in
// answers). Hidden truth never enters it: no true age, no likes, no chemistry, no adversary label,
// no reliability, no true tolerance. Each member's canary is planted in one agent_private fact
// (the leak gate must keep it out of every member-facing string).
//
// Field mapping (also in the results doc):
//   Member.age = claimed age; homeCity "nyc"; categoriesOptIn ["social","hobby"] (claimed minors: ["social"], never matched)
//   Presence {home, areas: [home neighborhood, often-around neighborhoods]}
//   interest        <activity tag>                       60% shareable, else matchable
//   trait           friends:energy:<low|mid|high>        matchable
//   preference      friends:group_pref:<pref>            matchable
//   fact            friends:life_stage:<stage>           matchable
//   availability    friends:free:<slot>                  agent_private
//   preference      friends:max_travel:<min>             agent_private
//   fact            friends:new_to_city                  agent_private (timing and tone only; never shown)
//   fact            verify:liveness:<r>, verify:age:<r>  agent_private (r: pass, fail or pending; info.ts VERIFY_PASS)
//   fact            safety:<cue>                         agent_private, inferred
//   Intent          category "social", "meet people nearby to do things with"
import { DAY, canBeMatched, type Edge, type Facet, type Intent, type Member, type MemberId, type Presence, type WorldSnapshot } from "@thenetwork/core";
import type { FeedbackRecord, InteractionRecord, SafetyHold } from "@thenetwork/engine/src/types.ts";
import { activityById } from "@thenetwork/engine/src/packs/network/activities.ts";
import type { Crew, PlanOutcomeRecord } from "@thenetwork/engine/src/plans.ts";
import { fromLocal } from "@thenetwork/core";
import { Rng, hash32 } from "@thenetwork/core";
import { SLOT_TIME } from "@thenetwork/engine/src/packs/friends/index.ts";
import { verifyTag } from "@thenetwork/engine/src/packs/friends/info.ts";
import { SLOTS, h01, hoodOf, type FriendsPersona, type FriendsSlot, type RichnessTier } from "./persona.ts";

export const NYC_TZ = "America/New_York";
/** Monday 2026-10-12 (local): week 0 of every friends run. */
export const FRIENDS_WORLD_DATE = { y: 2026, m: 10, d: 12 };
export const FRIENDS_WORLD_START = fromLocal(2026, 10, 12, 0, NYC_TZ);

/** Local instant of `hour` on day `dayOffset` (0 = Monday) of week `week`. */
export function weekTime(week: number, dayOffset: number, hour: number): number {
  const base = new Date(Date.UTC(FRIENDS_WORLD_DATE.y, FRIENDS_WORLD_DATE.m - 1, FRIENDS_WORLD_DATE.d + week * 7 + dayOffset));
  return fromLocal(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), hour, NYC_TZ);
}
/** Instant of a weekly slot (index into SLOTS) in week `week`. */
export function slotTime(week: number, slot: number): number {
  const s = SLOT_TIME[SLOTS[slot]!];
  return weekTime(week, (s.day + 6) % 7, s.hour);
}
/** Day number (since the world start) of a slot. */
export const slotDay = (week: number, slot: number) => week * 7 + ((SLOT_TIME[SLOTS[slot]!].day + 6) % 7);

/** A crew the Network formed (engine plans.Crew) plus its counters. */
export interface CrewState extends Crew { sessionsHeld: number; formedWeek: number }

export interface FriendsNetworkState {
  now: number; week: number;
  interactions: InteractionRecord[];
  feedback: FeedbackRecord[];
  safetyHolds: SafetyHold[];
  edges: Edge[];
  crews: CrewState[];
  /** Every crew offered so far (formed or not): never re-offered. */
  offered: Crew[];
  /** Post-plan records: who came, who said they'd do it again. */
  outcomes: PlanOutcomeRecord[];
  /** This week's check-in answers ("free Thu evening and Saturday afternoon"). */
  checkIns: Map<MemberId, FriendsSlot[]>;
  /** When each member was last sent a new-plan invite. */
  lastPlannedAt: Map<MemberId, number>;
}

export interface FriendsSnapshot extends WorldSnapshot {
  interactions: InteractionRecord[]; feedback: FeedbackRecord[]; safetyHolds: SafetyHold[];
  crews: CrewState[]; offered: Crew[]; outcomes: PlanOutcomeRecord[];
  checkIns: Record<MemberId, FriendsSlot[]>; lastPlannedAt: Record<MemberId, number>;
  week: number;
}

/** What the agent learned at onboarding, by richness tier. */
export const KNOWS: Record<RichnessTier, { activities: number; free: number; tolerance: boolean; energy: boolean; groupPref: boolean; lifeStage: boolean }> = {
  minimal: { activities: 0.5, free: 0.3, tolerance: false, energy: false, groupPref: false, lifeStage: false },
  light: { activities: 0.7, free: 0.6, tolerance: true, energy: false, groupPref: true, lifeStage: false },
  medium: { activities: 0.85, free: 0.8, tolerance: true, energy: true, groupPref: true, lifeStage: true },
  rich: { activities: 1, free: 0.95, tolerance: true, energy: true, groupPref: true, lifeStage: true },
  very_rich: { activities: 1, free: 1, tolerance: true, energy: true, groupPref: true, lifeStage: true },
};

/** P(the agent noticed a safety cue in onboarding chat), by adversary kind and richness (observable behaviour, not the label). */
export const CUE_RATES: Record<string, { tag: string; byTier: Record<RichnessTier, number> }> = {
  romance_seeker: { tag: "safety:dating_intent", byTier: { minimal: 0.3, light: 0.4, medium: 0.5, rich: 0.6, very_rich: 0.65 } },
  mlm: { tag: "safety:sales_pitch", byTier: { minimal: 0.35, light: 0.45, medium: 0.55, rich: 0.6, very_rich: 0.65 } },
  bot: { tag: "safety:bot_pattern", byTier: { minimal: 0.4, light: 0.5, medium: 0.6, rich: 0.65, very_rich: 0.7 } },
  harasser: { tag: "safety:hostile_language", byTier: { minimal: 0.15, light: 0.2, medium: 0.3, rich: 0.35, very_rich: 0.4 } },
  age_liar: { tag: "safety:age_signal", byTier: { minimal: 0.2, light: 0.3, medium: 0.4, rich: 0.5, very_rich: 0.6 } },
};
export const CUE_FALSE_POSITIVE = 0.01, AGE_CUE_FALSE_POSITIVE_YOUNG = 0.05;

/**
 * Verification over time: a member who did not finish a check at onboarding ("pending") is reminded
 * and finishes it in a later week with p = 0.25 per week (real people only: a bot never passes a
 * pending liveness check, a lying minor never passes a pending ID check). Failed stays failed.
 */
export function verifyAt(p: FriendsPersona, week: number): FriendsPersona["stated"]["verify"] {
  const v = { ...p.stated.verify };
  const done = (what: string) => { for (let k = 1; k <= week; k++) if (h01("friends-verify", p.hidden.canary, what, k) < 0.25) return true; return false; };
  if (v.liveness === "pending" && p.hidden.adversary !== "bot" && p.stated.claimedAge >= 18 && done("liveness")) v.liveness = "passed";
  if (v.age === "pending" && !p.hidden.isMinor && p.stated.claimedAge >= 18 && done("age")) v.age = "passed";
  return v;
}

/** Safety cues the agent noticed at onboarding (observable chat behaviour, not the label). */
export function cuesOf(p: FriendsPersona): string[] {
  const S = p.stated, tier = p.hidden.richness;
  const sr = new Rng(hash32("friends-cue", p.id, p.hidden.canary));
  const out: string[] = [];
  for (const [kind, cue] of Object.entries(CUE_RATES)) {
    const fp = kind === "age_liar" && S.claimedAge <= 20 ? AGE_CUE_FALSE_POSITIVE_YOUNG : CUE_FALSE_POSITIVE;
    const pr = p.hidden.adversary === kind ? cue.byTier[tier] : fp;
    if (sr.next() < pr) out.push(cue.tag);
  }
  return out;
}

/**
 * Human review of a cue (PRD 40.4: human review of proactive matches): each week a reviewer reads
 * the flagged chat. An honest member's false positive is cleared with p = 0.6 per week; a real
 * adversary is wrongly cleared with p = 0.05 per week. Cleared from week k on.
 */
export function clearedAt(p: FriendsPersona, week: number): boolean {
  const pr = p.hidden.adversary ? 0.05 : 0.6;
  for (let k = 1; k <= week; k++) if (h01("friends-review", p.hidden.canary, k) < pr) return true;
  return false;
}

/** A red flag the Network can see at the start of `week`: an uncleared cue or a check not passed. */
export function visibleRedFlag(p: FriendsPersona, week: number): boolean {
  const v = verifyAt(p, week);
  return v.liveness !== "passed" || v.age !== "passed" || (cuesOf(p).length > 0 && !clearedAt(p, week));
}

/** Facets the agent extracted for one persona at the start of `week` (deterministic; no hidden truth). */
export function friendsFacetsOf(p: FriendsPersona, joinedAt: number, week = 0): Facet[] {
  const S = p.stated, tier = p.hidden.richness, K = KNOWS[tier];
  const minor = !canBeMatched(S.claimedAge);
  const r = new Rng(hash32("friends-knows", p.id));
  const out: Facet[] = [];
  const f = (kind: Facet["kind"], value: string, tags: string[], scope: Facet["scope"], extra: Partial<Facet> = {}) => out.push({
    id: `${p.id}:fr:${out.length}`, memberId: p.id, kind, value, tags, scope: minor ? "agent_private" : scope,
    provenance: "said", confidence: 0.8, validFrom: joinedAt, source: "chat", observedAt: joinedAt, inferred: false, confirmedByMember: true, ...extra,
  });
  for (const a of S.activities) if (r.next() < K.activities) {
    const act = activityById.get(a)!;
    f("interest", act.tags[0]!.replace(/_/g, " "), [act.tags[0]!], h01("share", p.id, a) < 0.6 ? "shareable" : "matchable");
  }
  if (K.energy) f("trait", `${S.energy} social energy`, [`friends:energy:${S.energy}`], "matchable");
  if (K.groupPref) f("preference", S.groupPref === "one_to_one" ? "prefers one-on-one" : S.groupPref === "group" ? "prefers groups" : "groups or one-on-one", [`friends:group_pref:${S.groupPref}`], "matchable");
  if (K.lifeStage) f("fact", S.lifeStage.replace(/_/g, " "), [`friends:life_stage:${S.lifeStage}`], "matchable");
  for (const s of S.usuallyFree) if (r.next() < K.free) f("availability_pattern", `usually free ${s}`, [`friends:free:${s}`], "agent_private");
  if (K.tolerance) f("preference", `travel tolerance ${S.maxTravel}`, [`friends:max_travel:${S.maxTravel}`], "agent_private");
  if (S.newToCity) f("fact", "recently moved", ["friends:new_to_city"], "agent_private");
  const v = verifyAt(p, week);
  // The tag is the one the staff verify path and slop write: verify:<check>:<pass|fail> (pending until a result).
  f("fact", `liveness ${v.liveness}`, [`verify:liveness:${verifyTag(v.liveness)}`], "agent_private", { provenance: "connected_source" });
  f("fact", `ageassurance ${v.age}`, [`verify:age:${verifyTag(v.age)}`], "agent_private", { provenance: "connected_source" });
  const cues = cuesOf(p);
  for (const tag of cues) f("fact", "flagged for review", [tag], "agent_private", { provenance: "inferred", inferred: true, confirmedByMember: false, confidence: 0.6 });
  if (cues.length && clearedAt(p, week)) f("fact", "review cleared", ["review:cleared"], "agent_private", { provenance: "inferred" });
  f("fact", `private note ${p.hidden.canary}`, [], "agent_private");
  return out;
}

export function friendsMemberOf(p: FriendsPersona, joinedAt: number): Member {
  const S = p.stated, adult = canBeMatched(S.claimedAge);
  return {
    id: p.id, name: p.name, homeCity: "nyc", state: "normal",
    prefs: {
      categoriesOptIn: adult ? ["social", "hobby"] : ["social"], quietHours: [22, 8], romanceOptIn: false,
      formats: ["small_group", "one_to_one"], maxTravelMinutes: KNOWS[p.hidden.richness].tolerance ? S.maxTravel : 40, onlyWhenAsked: false,
    },
    joinedAt, age: S.claimedAge, unansweredProactive: 0,
  };
}

export function emptyFriendsState(): FriendsNetworkState {
  return { now: FRIENDS_WORLD_START, week: 0, interactions: [], feedback: [], safetyHolds: [], edges: [], crews: [], offered: [], outcomes: [], checkIns: new Map(), lastPlannedAt: new Map() };
}

export function buildFriendsSnapshot(personas: readonly FriendsPersona[], state: FriendsNetworkState): FriendsSnapshot {
  const members: Member[] = [], facets: Facet[] = [], intents: Intent[] = [], presence: Presence[] = [];
  const joinedAt = FRIENDS_WORLD_START;
  for (const p of personas) {
    members.push(friendsMemberOf(p, joinedAt));
    facets.push(...friendsFacetsOf(p, joinedAt, state.week));
    if (canBeMatched(p.stated.claimedAge)) intents.push({ id: `${p.id}:friends`, memberId: p.id, category: "social", objective: "meet people nearby to do things with", horizonDays: 365, status: "active", createdAt: joinedAt });
    presence.push({ memberId: p.id, city: "nyc", type: "home", areas: [hoodOf(p.stated.home).name, ...p.stated.often.map(h => hoodOf(h).name)] });
  }
  return {
    now: state.now, members, facets, intents, presence, edges: state.edges.map(e => ({ ...e })), recentProposals: [],
    interactions: state.interactions.map(i => ({ ...i })), feedback: state.feedback.map(f => ({ ...f })), safetyHolds: state.safetyHolds.map(h => ({ ...h })),
    crews: state.crews.map(c => ({ ...c, members: [...c.members], sessions: [...c.sessions] })), offered: state.offered.map(c => ({ ...c })),
    outcomes: state.outcomes.map(o => ({ ...o })), checkIns: Object.fromEntries([...state.checkIns].map(([k, v]) => [k, [...v]])),
    lastPlannedAt: Object.fromEntries(state.lastPlannedAt), week: state.week,
  };
}

export const DAY_MS = DAY;
