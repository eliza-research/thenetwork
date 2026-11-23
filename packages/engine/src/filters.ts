// Hard filters (Section 33.5). Hard constraints are never traded for score (33.1): a candidate
// failing any of these is dropped before scoring, and the reason is counted in the run funnel.
import type { Category, Member, MemberId } from "@thenetwork/core";
import { ADULT_AGE as CORE_ADULT_AGE, ageSideOf, canBeMatched, DAY, HOUR, latestDayKeyOf, type AgeSide } from "@thenetwork/core";
import { initial, step, type CheckPhase } from "../../core/src/generated/candidateScreening.ts";
import {
  groupAgeAllowed, rosterHasMinor, teenFriendCandidate, teenFriendFormat, teenFriendRole, teenIntroShape, teenRosterSizeAllowed, viaAllowedForRoster,
} from "../../core/src/generated/friendIntroAge.ts";
import { laneSidesCompatible, teenFriendCategory, teenFriendLane, teenGenerator, teenGroupPlanApp, type MatchLane } from "../../core/src/generated/matchLane.ts";
import { publicEventMemberAllowsMatch } from "../../core/src/generated/publicEventCatalog.ts";
import type { EngineConfig } from "./config.ts";
import type { MatchProfile } from "./match/profile.ts";
import type { Candidate } from "./types.ts";
import { pairKey, type MemberIndex, type World } from "./world.ts";

/**
 * Funnel reasons. The core reasons (unknown_member, underage, safety_hold, state_paused, blocked,
 * duplicate_participant, no_presence_overlap) plus networkPack's; other packs' rules may return
 * their own reason strings (the `string & {}` arm keeps autocomplete for the known ones).
 */
export type FilterReason =
  | "unknown_member" | "underage" | "safety_hold" | "state_paused" | "state_receiving_contributor"
  | "category_opt_out" | "romance_opt_out" | "only_when_asked" | "interruption_budget"
  | "contribution_budget" | "category_quota" | "category_cooldown" | "reliability_holdout"
  | "blocked" | "negative_feedback_cooldown" | "pair_cooldown" | "active_duplicate"
  | "romance_incompatible" | "dealbreaker" | "high_risk" | "home_entry_rule"
  | "no_presence_overlap" | "group_size" | "romance_group" | "duplicate_participant"
  | "no_lane" | "no_pair_value" | (string & {});

import type { MemberCheck } from "./pack.ts";
export type { MemberCheck };

export const ADULT_AGE = CORE_ADULT_AGE;
export const isMinorAge = (age: unknown): boolean => !canBeMatched(age);
/** Scope the shared catalog's event format separately from each member's matching category. */
export function publicEventPreferencesAllow(member: Member | undefined, category: Category, minimumAge: number): boolean {
  const categories = member?.prefs?.categoriesOptIn, formats = member?.prefs?.formats;
  return publicEventMemberAllowsMatch(canBeMatched(member?.age), (member?.age ?? -1) >= minimumAge,
    Array.isArray(categories) && categories.includes(category), Array.isArray(formats) && formats.includes("event"));
}
/** True if `id` is a known member under 18 (or with an unknown/invalid age). Unknown ids are not minors here. */
export function isMinor(w: World, id: MemberId): boolean {
  const mi = w.get(id);
  return !!mi && isMinorAge(mi.m.age);
}
export function involvedMembers(c: Pick<Candidate, "participants" | "alternates" | "via">): MemberId[] {
  return [...c.participants, ...(c.alternates ?? []), ...(c.via ? [c.via] : [])];
}

const friendshipLaneOf = (w: World, category: Category, lane: MatchLane | undefined): boolean =>
  teenFriendCategory(w.pack.id, category) && (lane === undefined || teenFriendLane(w.pack.id, lane));

const belowMatchAge = (w: World, age: number): boolean =>
  isMinorAge(age) || !(age >= w.cfg.ageMin) || !(age >= w.pack.eligibility.minMatchAge);

export function teenCandidateIn(w: World, id: MemberId, category: Category): boolean {
  const mi = w.get(id);
  if (!mi) return false;
  const side = ageSideOf(mi.m);
  return teenFriendCandidate(side.adult, side.ready, side.birthKey, w.minDay, w.maxDay, w.teenIntros, teenFriendCategory(w.pack.id, category));
}

const ageSidesOf = (w: World, ids: readonly MemberId[]): AgeSide[] =>
  ids.flatMap(id => { const mi = w.get(id); return mi ? [ageSideOf(mi.m)] : []; });

function rosterAgeReason(w: World, ids: readonly MemberId[], friendshipLane: boolean, maxDay: number = w.maxDay): "underage" | null {
  const roster = [...new Set(ids)];
  const sides = ageSidesOf(w, roster);
  if (!rosterHasMinor(sides)) return null;
  if (sides.length !== roster.length || roster.length < 2) return "underage";
  return groupAgeAllowed(w.teenIntros, friendshipLane, w.minDay, maxDay, sides) ? null : "underage";
}

const meetingMaxDay = (w: World, ends: readonly (number | undefined)[]): number =>
  latestDayKeyOf(Math.max(w.now, ...ends.filter((end): end is number => end !== undefined)));

export type AgeCheckedCandidate = Pick<Candidate, "participants" | "alternates" | "category">
  & Partial<Pick<Candidate, "via" | "roles" | "format" | "generator" | "window" | "fixedWindow" | "anchor" | "lane">>;

export function candidateAgeReason(w: World, c: AgeCheckedCandidate): "underage" | null {
  const roster = [...new Set([...c.participants, ...c.alternates])];
  if (c.via !== undefined && !viaAllowedForRoster(ageSidesOf(w, [...roster, c.via]))) return "underage";
  const friendshipLane = friendshipLaneOf(w, c.category, c.lane);
  const reason = rosterAgeReason(w, roster, friendshipLane, meetingMaxDay(w, [c.window?.end, c.fixedWindow?.end]));
  if (reason !== null || !rosterHasMinor(ageSidesOf(w, roster))) return reason;
  const { roles, format, generator } = c;
  if (roles === undefined || format === undefined || generator === undefined) return "underage";
  const everyRoleTeen = roster.every(id => { const role = roles[id]; return role !== undefined && teenFriendRole(role); });
  return teenGenerator(w.pack.id, generator)
    && teenIntroShape(friendshipLane, format, everyRoleTeen, c.via !== undefined, c.anchor?.type === "event")
    && teenRosterSizeAllowed(true, roster.length) ? null : "underage";
}

export function teenGroupReason(w: World, ids: readonly MemberId[], category: Category, meetingEnd: number): "underage" | null {
  const roster = [...new Set(ids)];
  if (!rosterHasMinor(ageSidesOf(w, roster))) return null;
  if (!teenGroupPlanApp(w.pack.id) || !teenRosterSizeAllowed(true, roster.length)) return "underage";
  return rosterAgeReason(w, roster, teenFriendCategory(w.pack.id, category), meetingMaxDay(w, [meetingEnd]));
}

const teenSeat = (w: World, id: MemberId, c: Pick<MemberCheck, "category" | "lane" | "role" | "format">): boolean =>
  teenCandidateIn(w, id, c.category) && friendshipLaneOf(w, c.category, c.lane) && teenFriendRole(c.role) && teenFriendFormat(c.format);

/** Member-level hard constraints for taking part in a candidate with a given role. */
export function memberReason(w: World, id: MemberId, c: MemberCheck): FilterReason | null {
  const cfg = w.cfg;
  const mi = w.get(id);
  if (!mi) return "unknown_member";
  const m = mi.m;
  if (!teenSeat(w, id, c) && belowMatchAge(w, m.age)) return "underage";
  if (w.holds.has(id)) return "safety_hold";
  if (m.state === "paused") return "state_paused";
  // Pack rules in order (networkPack: packs/network/rules.ts, the pre-refactor order).
  for (const r of w.pack.eligibility.memberRules) {
    const reason = r.check(w, id, mi, c);
    if (reason) return reason;
  }
  return null;
}

/** Both members' romance preferences admit each other (opt-in, stated orientation, age range). */
export function romanceMutual(w: World, a: MemberId, b: MemberId): boolean {
  const A = w.get(a), B = w.get(b);
  if (!A || !B) return false;
  const admits = (x: MemberIndex, y: MemberIndex) => !!x.romance && x.m.prefs.romanceOptIn && !!y.romance && y.romance.is.some(g => x.romance!.seeks.includes(g))
    && (y.m.age ?? 0) >= x.romance.ageMin && (y.m.age ?? 0) <= x.romance.ageMax;
  return admits(A, B) && admits(B, A);
}

/** Pair-level hard constraints. Completed / positive history never blocks (ME-005). */
export function pairReason(w: World, a: MemberId, b: MemberId, category: Category, lane?: MatchLane): FilterReason | null {
  if (a === b) return "duplicate_participant";
  if (rosterAgeReason(w, [a, b], friendshipLaneOf(w, category, lane))) return "underage";
  // Core prefix: blocks win (either direction).
  if (w.blocked.has(pairKey(a, b))) return "blocked";
  const ma = w.get(a), mb = w.get(b);
  // Pack rules always get two known members (engine-pipeline-16): an unknown id ends here.
  if (!ma || !mb) return "unknown_member";
  // Pack rules in order (networkPack: cooldowns, active duplicate, known members, romance, dealbreakers).
  for (const r of w.pack.eligibility.pairRules) {
    const reason = r.check(w, a, b, category, ma, mb, lane);
    if (reason) return reason;
  }
  // Optional geo hard filter (radius packs: mutual radius). Absent for networkPack.
  return w.pack.geo.pairReason?.(w, a, b, lane) ?? null;
}

/**
 * Curated safety corpus (audit engine-pipeline-4), applied on top of config.highRiskTerms /
 * highRiskPatterns and not part of the config: a safety floor that tuning cannot switch off.
 * Each rule names who would be put at risk, so benign mentions ("parents with young kids",
 * "a 5 year old startup", "dog sitter", "diet coke", "mushroom foraging") pass. Checked against
 * a risky and a benign corpus (the 2026-10-08 audit; in git history at 16cde70).
 */
const CHILD = "(kids?|child|children|minors?|teens?|teenagers?|toddlers?|bab(?:y|ies)|sons?|daughters?|little ones?|(?:1[0-7]|[1-9]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\\s?-?\\s?(?:yo|y\\/?o|yrs?(?:\\s|-)?olds?|years?(?:\\s|-)?olds?))";
export const SAFETY_RISK_PATTERNS: readonly string[] = [
  // Care, transport or time alone with someone's child; a child's age may be written as digits or
  // words ("my 6 year old", "my 8yo", "15 y/o", "twelve-year-old").
  `\\b(watch(ing)?|sit(ting)?|mind(ing)?|look(ing)? after|care for|caring for|stay with|hang out with|pick(ing)? up|drop(ping)? off|tutor\\w*|mentor\\w*|teach\\w*|coach\\w*|alone with)\\b(\\W+\\w+){0,3}?\\W+(my|our|your|their|his|her)\\s+${CHILD}`,
  `\\b(my|our|your|their)\\s+${CHILD}\\b(\\W+\\w+){0,4}?\\W+(a )?(ride|lift|sitter|nanny|tutor|mentor|coach)\\b`,
  `\\b(ride|rides|lift|sitter|nanny)\\s+(for|to)\\s+(my|our|your|their)\\s+${CHILD}`,
  "\\bbaby[\\s-]?sit", "(?<!(dog|pet|cat|plant|house|bird)[\\s-]?)\\bsitters?\\b",
  "\\b(school|daycare|day care|preschool|kindergarten)[\\s-]?(pick[\\s-]?ups?|drop[\\s-]?offs?|run)\\b",
  "\\bfrom (school|daycare|day care|preschool|kindergarten)\\b",
  // Money asks and transactional dating.
  "\\b(spot|front|venmo|zelle|cash ?app|paypal|wire|send|loan|lend|give)\\s+(me|us)\\b(\\W+\\w+){0,2}?\\W*(\\$\\s?\\d|\\d+\\s?(k|bucks|dollars|usd)\\b|money|cash|rent|funds?)",
  "\\b\\d+\\s?(bucks|dollars)\\b(\\W+\\w+){0,3}?\\W+(till|until|by) (friday|payday|next week|the \\d+)",
  "\\b(sugar (daddy|daddies|mommy|mommies|mama|baby|babies)|pay ?pig|findom|allowance arrangement)\\b",
  "\\b(guaranteed returns?|crypto (signals|opportunity)|forex (signals|opportunity)|investment opportunity)\\b",
  // Drugs (named substances; "diet coke", "mushroom foraging" and "joint venture" pass).
  "\\b(edibles?|molly|mdma|ecstasy|ketamine|shrooms|magic mushrooms?|psilocybin|lsd|adderall|xanax|oxy(codone|contin)?|percocet|opioids?|meth|heroin|fentanyl|thc|dabs?|blunts?|420|psychedelics?)\\b",
  "(?<!diet |cherry |vanilla )\\b(coke|cocaine)\\b", "\\b(my|your|his|her|their) (meds|pills)\\b",
  // Medical escort / care.
  "\\b(ride|rides|lift|drive|take me|go with me|come with me|accompany me)\\b(\\W+\\w+){0,4}?\\W+(clinic|hospital|surgery|procedure|chemo|chemotherapy|dialysis)\\b",
  "\\bafter (my|the) (procedure|surgery|operation)\\b",
];
/** Home entry (F14), on top of config.homeEntryTerms: rooms, dwellings with a possessive, and in-home jobs. */
export const HOME_ENTRY_PATTERNS: readonly string[] = [
  "\\b(home|house|apartment|apt|condo|walk-?up|bedroom|living room|kitchen|bathroom|basement|attic|garage|backyard)\\b",
  "\\b(my|our|their|his|her|the|new) (place|flat|studio|room|unit|loft|building|floor)\\b",
  "\\b(plumbing|sink|toilet|faucet|ikea|dresser|bed ?frame|shelves|furniture|couch|sofa|mattress)\\b",
  "\\b(move|moving|movers?)\\b", "\\bcome over\\b",
];

const riskCache = new WeakMap<EngineConfig, RegExp[]>();
const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function riskMatchers(cfg: EngineConfig): RegExp[] {
  let rs = riskCache.get(cfg);
  if (!rs) {
    rs = [
      // Whole words / phrases only (plural allowed; "-" or "_" may stand for a space).
      ...cfg.highRiskTerms.map(t => new RegExp(`\\b${escapeRe(t.toLowerCase().replace(/_/g, " ")).replace(/ /g, "[\\s-]+")}(s|es)?\\b`)),
      ...(cfg.highRiskPatterns ?? []).map(p => new RegExp(p)),
      ...SAFETY_RISK_PATTERNS.map(p => new RegExp(p)),
    ];
    riskCache.set(cfg, rs);
  }
  return rs;
}
/**
 * High-risk content in candidate text (F14/F15): the matched words or phrases, empty if none.
 * Whole-word terms plus context rules (see config.highRiskPatterns), so "parents with young
 * kids" or "lend a hand" pass while "babysit my kids" or "lend me cash" do not.
 */
export function riskTerms(cfg: EngineConfig, text: string): string[] {
  const norm = text.toLowerCase().replace(/_/g, " ").replace(/[\u2018\u2019]/g, "'");
  const out: string[] = [];
  for (const re of riskMatchers(cfg)) {
    const m = norm.match(re);
    if (m) out.push(m[0].trim());
  }
  return out;
}
const HOME_RES = HOME_ENTRY_PATTERNS.map(p => new RegExp(p));
export function isHomeEntry(cfg: EngineConfig, text: string): boolean {
  const low = ` ${text.toLowerCase().replace(/_/g, " ").replace(/[\u2018\u2019]/g, "'")} `;
  if (cfg.homeEntryTerms.some(t => low.includes(` ${t} `) || low.includes(` ${t}.`) || low.includes(` ${t},`))) return true;
  return HOME_RES.some(re => re.test(low));
}

export interface RunUsage { proactive: Map<MemberId, number>; contribution: Map<MemberId, number> }

/** A passed candidate carries the alternates that keep a pair value with the primary participants; the caller applies them. */
export type CandidateScreenResult = { phase: "Passed"; alternates: MemberId[] } | { phase: "Refused"; refusal: FilterReason };

type ScreeningCheck = Exclude<CheckPhase, CandidateScreenResult["phase"]>;

/** The full ordered screen. Passing presence also resolves the candidate's city and window. */
export function screenCandidate(w: World, c: Candidate, usage?: RunUsage): CandidateScreenResult {
  let screen = initial;
  // spec/candidateScreening.md, "Hard checks run in a fixed order"
  while (screen.phase !== "Passed" && screen.phase !== "Refused") {
    const checked = screen.phase;
    screen = step(screen, { type: "recordCheck", checked, reason: screeningReason(checked, w, c, usage) ?? "" });
  }
  return screen.phase === "Passed" ? { phase: "Passed", alternates: keptAlternates(w, c) } : { phase: "Refused", refusal: screen.refusal };
}

/** Returns the first failing reason or null for callers that need only the original reason. */
export function candidateReason(w: World, c: Candidate, usage?: RunUsage): FilterReason | null {
  const result = screenCandidate(w, c, usage);
  return result.phase === "Refused" ? result.refusal : null;
}

function screeningReason(check: ScreeningCheck, w: World, c: Candidate, usage?: RunUsage): FilterReason | null {
  switch (check) {
    case "Duplicates":
      return new Set(c.participants).size !== c.participants.length ? "duplicate_participant" : null;
    case "PackPre":
    case "PackPost": {
      const rules = check === "PackPre" ? w.pack.eligibility.candidatePreRules : w.pack.eligibility.candidatePostRules;
      for (const rule of rules) {
        const reason = rule.check(w, c);
        if (reason) return reason;
      }
      return null;
    }
    case "Age":
      return candidateAgeReason(w, c);
    case "Intermediary": {
      // The warm-path intermediary is named to both sides and asked to vouch.
      if (!c.via) return null;
      const v = w.get(c.via);
      if (!v) return "unknown_member";
      if (w.holds.has(c.via)) return "safety_hold";
      if (v.m.state === "paused") return "state_paused";
      return c.participants.some(id => w.blocked.has(pairKey(id, c.via!))) ? "blocked" : null;
    }
    case "Members":
      for (const id of c.participants) {
        const own = c.anchor?.type === "intent" ? w.intentById.get(c.anchor.id) : undefined;
        const reason = memberReason(w, id, {
          category: c.category, role: c.roles[id] ?? "peer", format: c.format, timeSensitive: c.timeSensitive, lane: c.lane,
          extraProactive: usage?.proactive.get(id), extraContribution: usage?.contribution.get(id),
          ownIntentCreatedAt: own && own.memberId === id ? own.createdAt : undefined,
        });
        if (reason) return reason;
      }
      return null;
    case "Pairs":
      for (let i = 0; i < c.participants.length; i++) for (let j = i + 1; j < c.participants.length; j++) {
        const reason = pairReason(w, c.participants[i]!, c.participants[j]!, c.category, c.lane);
        if (reason) return reason;
      }
      return c.participants.length < 2 ? null : laneReason(w, c);
    case "Presence":
      return presenceReason(w, c);
  }
}

type LaneSeats = Pick<Candidate, "participants" | "lane" | "entities">;

/** A participant's profile in the lane: the entity the candidate names for it, else its own membership. */
function laneProfile(w: World, c: LaneSeats, id: MemberId, lane: MatchLane): MatchProfile | undefined {
  const entity = c.entities?.[id];
  const profile = entity === undefined ? w.match.profileIn(id, lane) : w.match.profile(entity);
  return profile?.lane === lane && profile.memberId === id ? profile : undefined;
}

/**
 * The pair values the candidate's lane requires: every pair in a Peers lane, each Offering-Seeking
 * pair in a TwoSided lane (spec/matchLane.md, "Two members pair only on compatible sides of the
 * same lane"). Null when there is no lane, a participant has no profile in it, or it pairs nobody.
 */
export function requiredPairValues(w: World, c: LaneSeats): readonly number[] | null {
  const lane = c.lane;
  if (!lane) return null;
  // Screening, scoring and the judge rescore ask for the same candidate; compute its values once.
  const seats = `${lane}|${c.participants.join(",")}|${c.participants.map(id => c.entities?.[id] ?? "").join(",")}`;
  const known = pairValueMemo.get(c);
  if (known && known.w === w && known.seats === seats) return known.values;
  const values = pairValuesOf(w, c, lane);
  pairValueMemo.set(c, { w, seats, values });
  return values;
}

const pairValueMemo = new WeakMap<LaneSeats, { w: World; seats: string; values: readonly number[] | null }>();

function pairValuesOf(w: World, c: LaneSeats, lane: MatchLane): readonly number[] | null {
  const profiles: MatchProfile[] = [];
  for (const id of c.participants) {
    const profile = laneProfile(w, c, id, lane);
    if (!profile) return null;
    profiles.push(profile);
  }
  const values: number[] = [];
  for (let i = 0; i < profiles.length; i++) for (let j = i + 1; j < profiles.length; j++) {
    if (laneSidesCompatible(lane, profiles[i]!.side, profiles[j]!.side)) values.push(w.match.value(profiles[i]!, profiles[j]!));
  }
  return values.length > 0 ? values : null;
}

/** An alternate stays only when it has a pair value with every primary participant the lane pairs it with. */
function alternateFits(w: World, c: Candidate, lane: MatchLane, alternate: MatchProfile): boolean {
  let paired = false;
  for (const primary of c.participants) {
    const profile = laneProfile(w, c, primary, lane)!;
    if (!laneSidesCompatible(lane, alternate.side, profile.side)) continue;
    if (w.match.value(alternate, profile) < 0) return false;
    paired = true;
  }
  return paired;
}

/**
 * Pair eligibility and parity for every screened candidate: a candidate with two or more
 * participants names a lane, and every pair the lane requires has a pair value through the one pair
 * gate (w.match.value).
 */
function laneReason(w: World, c: Candidate): FilterReason | null {
  if (!c.lane) return "no_lane";
  const values = requiredPairValues(w, c);
  return !values || values.some(value => value < 0) ? "no_pair_value" : null;
}

/**
 * The alternates, in the candidate's order, that keep a pair value with every primary participant
 * and with every alternate kept before them that the lane pairs them with, so any backfill from them
 * values every pair (spec/models/candidate_pool.md, blockedApart). A failing alternate is
 * dropped and never refuses the candidate. With one participant an alternate replaces that
 * participant and pairs with nobody, so there is no pair to check.
 */
function keptAlternates(w: World, c: Candidate): MemberId[] {
  const lane = c.lane;
  if (!lane || c.participants.length < 2) return [...c.alternates];
  const kept: MatchProfile[] = [];
  for (const id of c.alternates) {
    const alternate = laneProfile(w, c, id, lane);
    if (!alternate || !alternateFits(w, c, lane, alternate)) continue;
    if (kept.some(other => laneSidesCompatible(lane, alternate.side, other.side) && w.match.value(alternate, other) < 0)) continue;
    kept.push(alternate);
  }
  return kept.map(profile => profile.memberId);
}

/** Resolve the shared city and window after the other checks (ME-011). */
function presenceReason(w: World, c: Candidate): FilterReason | null {
  const cfg = w.cfg;
  const start = c.fixedWindow?.start ?? w.now;
  const end = c.fixedWindow?.end ?? w.now + cfg.windowDays * DAY;
  if (end <= w.now) return "no_presence_overlap";
  const ov = w.overlap(c.participants, Math.max(start, w.now), end, c.preferredCity);
  if (!ov) return "no_presence_overlap";
  if (c.preferredCity && c.fixedWindow && ov.city !== c.preferredCity) return "no_presence_overlap";
  c.city = ov.city;
  const first = ov.intervals[0]!;
  c.window = c.fixedWindow ? { start: Math.max(c.fixedWindow.start, first[0]), end: Math.min(c.fixedWindow.end, first[1]) } : { start: first[0], end: first[1] };
  if (c.window.end - c.window.start < Math.min(cfg.minOverlapHours * HOUR, (end - start) * 0.99)) {
    // Fall back to the longest interval if the first is short.
    const longest = [...ov.intervals].sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]))[0]!;
    c.window = { start: longest[0], end: longest[1] };
  }
  return null;
}

/**
 * Send-time re-check for invites, accepts and backfills (audit P1-5). Narrower than memberReason:
 * budgets, quotas and cooldowns were already applied when the opportunity was proposed and must
 * not cancel a live invite, but these always win at send time:
 *  - unknown member, under 18 (or unknown age), safety hold, paused;
 *  - opted out of proactive contact ("only when I ask" / two-unanswered) is NOT included: the
 *    member already has the invite; it is handled by outreach.ts on the next proactive message;
 *  - a block (either direction) with anyone else still in the opportunity.
 * `optedOut` lets the caller add channel-level opt-outs (STOP) that the World doesn't model.
 */
export function sendTimeReason(w: World, id: MemberId, others: MemberId[] = [], optedOut?: (id: MemberId) => boolean, category?: Category): FilterReason | "opted_out" | null {
  const mi = w.get(id);
  if (!mi) return "unknown_member";
  if (!(category !== undefined && teenCandidateIn(w, id, category)) && belowMatchAge(w, mi.m.age)) return "underage";
  const roster = others.filter(o => o !== id);
  if (roster.length > 0 && rosterAgeReason(w, [id, ...roster], category !== undefined && teenFriendCategory(w.pack.id, category))) return "underage";
  if (w.holds.has(id)) return "safety_hold";
  if (mi.m.state === "paused") return "state_paused";
  if (optedOut?.(id)) return "opted_out";
  // With the lane: a lane opt-in withdrawn after the proposal (engine-pipeline-10), romance included.
  if (lane !== undefined) {
    if (!mi.m.prefs.categoriesOptIn.includes(lane)) return "category_opt_out";
    if (lane === "romance" && !mi.m.prefs.romanceOptIn) return "romance_opt_out";
  }
  for (const o of others) if (o !== id && w.blocked.has(pairKey(id, o))) return "blocked";
  return null;
}

/**
 * An opportunity.ts `EligibilityCheck` over a World snapshot. `lane` (the opportunity's category)
 * re-checks lane opt-ins; a caller may also pass the lane per call (attention.ts revalidateHold).
 */
export const eligibilityFor = (w: World, optedOut?: (id: MemberId) => boolean, lane?: Category) =>
  (id: MemberId, others: MemberId[], itemLane?: Category): string | null => sendTimeReason(w, id, others, optedOut, itemLane ?? lane);
