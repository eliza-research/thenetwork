import type { City, Facet, MemberId } from "@thenetwork/core";
import { canBeMatched, CITY_TZ, DAY, DAYTIME_ONLY_TOKENS, DRINKING_VALUE_NON_DRINKER_TOKENS, extractMemberRedLines, localParts, LOW_NOISE_TOKENS, LOW_WALKING_TOKENS, STRICT_SOBER_TOKENS, temporaryPresenceWindow } from "@thenetwork/core";
import { slopContextualBlockAllowed, slopRecordedBlockContext } from "../../../../core/src/generated/datingRadius.ts";
import { completedDateFeedbackMatches, completedDatePacingAt, completedMeetingSlot, slopCompletedDateCounts, slopNoShowCounts } from "../../../../core/src/generated/meetingSettlement.ts";
import { presenceWindowContains } from "../../../../core/src/generated/travelPresence.ts";
import type { DatingStatement, StatedGender, TransOpenness } from "../../../../core/src/generated/mutualOpenness.ts";
import { standingIntentLive } from "../../../../core/src/standing-intent.ts";
import type { EngineInput, InteractionRecord } from "../../types.ts";
import { memberIdResolver, pairKey, type MemberIdResolver } from "../../world.ts";
import { cellOfZip, isKnownZip, MARKET_ANCHOR_ZIP, normalizeZip, zipForArea, type Cell } from "./zips.ts";
import { APPEARANCE_PREFIX, canRatePhotos, parseAppearance } from "./appearance.ts";

export type Gender = "woman" | "man" | "nonbinary";
export type Goal = "casual" | "long_term" | "unsure";
export type Scope = { mode: "city" } | { mode: "radius"; miles: number } | { mode: "multi"; markets: City[] };
export const SLOTS = ["mon_eve", "tue_eve", "wed_eve", "thu_eve", "fri_eve", "sat_day", "sat_eve", "sun_day", "sun_eve"] as const;
export type Slot = (typeof SLOTS)[number];

const NEVER_USED = /^(race|ethnicity|skin|nationality|immigration|hiv|sti|health|income)\b|:(race|ethnicity)\b/i;

export interface History {
  yes: number; no: number; silent: number;
  dates: number; noShows: number; backouts: number;
  negativeFrom: number;
  contextualBlocks: number;
  lastDateAt?: number; lastDateLiked?: boolean;
  lastAskAt?: number;
  attendedSlots: number[];
  rated: { about: MemberId; v: number }[];
  ratedSelf: { self: number[]; v: number }[];
  ratedBody: { type: string; v: number }[];
}

export interface SlopProfileRedLines {
  readonly strictSober: boolean;
  readonly nonDrinker: boolean;
  readonly lowWalking: boolean;
  readonly lowNoise: boolean;
  readonly daytimeOnly: boolean;
}

export interface SlopProfile {
  id: MemberId; age: number; adult: boolean; optedIn: boolean; paused: boolean;
  zip?: string; homeMarket: City; cell?: Cell;
  zipUnknown: boolean;
  is?: Gender; seeks: Gender[];
  trans?: "yes" | "no";
  transOpenness?: "open" | "not_open" | "only" | "declined";
  shownTo: Gender[];
  ageRange?: [number, number]; scope?: Scope; maxMiles?: number; goal?: Goal;
  values: { smoking?: string; drinking?: string; hasKids?: string; wantsKids?: string; religion?: string; religionImportance?: number; politics?: string };
  dealbreakers: string[];
  redLines?: SlopProfileRedLines;
  interests: string[]; shareableInterests: string[]; activities: string[]; free: Slot[];
  wants?: number[]; self?: number[];
  wantsBody: string[];
  identity?: string; orientation?: string;
  safety: string[];
  verification: string[];
  ageVerified?: boolean;
  appearance?: { face: number; body: number; overall: number; confidence: number; bodyType?: string; bodyTypeConfidence?: number; photos?: number; spread?: number };
  appearanceEvidenceIds?: readonly string[];
  silentAsks: string[];
  openAsks: string[];
  askCounts: Record<string, number>;
  review?: "cleared" | "confirmed";
  visiting: City[];
  interestFacet: Map<string, string>;
  history: History;
}

export type DatingProfile = SlopProfile;

type ProfileCache = { defaultProfiles?: Map<MemberId, SlopProfile>; byResolver: WeakMap<MemberIdResolver, Map<MemberId, SlopProfile>> };
const cache = new WeakMap<EngineInput, ProfileCache>();
const SILENT_AFTER_DAYS = 7;

export function datingProfiles(input: EngineInput, canonical?: MemberIdResolver): Map<MemberId, SlopProfile> {
  let entry = cache.get(input);
  if (!entry) {
    entry = { byResolver: new WeakMap() };
    cache.set(input, entry);
  }
  const cached = canonical ? entry.byResolver.get(canonical) : entry.defaultProfiles;
  if (cached) return cached;
  const profiles = buildProfiles(input, canonical ?? memberIdResolver(input));
  if (canonical) entry.byResolver.set(canonical, profiles);
  else entry.defaultProfiles = profiles;
  return profiles;
}
export const slopProfiles = datingProfiles;

function indexTagsByPrefix(tags: readonly string[]): (prefix: string) => readonly string[] {
  const byPrefix = new Map<string, string[]>();
  const add = (prefix: string, rest: string) => {
    let list = byPrefix.get(prefix);
    if (!list) { list = []; byPrefix.set(prefix, list); }
    list.push(rest);
  };
  for (const t of tags) {
    const first = t.indexOf(":");
    if (first < 0) continue;
    const second = t.indexOf(":", first + 1);
    if (second >= 0) add(t.slice(0, second + 1), t.slice(second + 1));
    add(t.slice(0, first + 1), t);
  }
  const empty: readonly string[] = [];
  return prefix => byPrefix.get(prefix) ?? empty;
}

function buildProfiles(input: EngineInput, C: (id: MemberId) => MemberId): Map<MemberId, SlopProfile> {
  const now = input.now;
  const facetsBy = new Map<MemberId, Facet[]>();
  for (const f of input.facets) {
    if (f.validTo !== undefined && f.validTo < now) continue;
    if (f.validFrom !== undefined && f.validFrom > now) continue;
    const id = C(f.memberId);
    let l = facetsBy.get(id);
    if (!l) { l = []; facetsBy.set(id, l); }
    l.push(f);
  }
  const visitsByMember = new Map<MemberId, Set<City>>();
  const visitAt = now + 2 * DAY;
  for (const row of input.presence) {
    const trip = temporaryPresenceWindow(row);
    if (!trip || !presenceWindowContains(trip, visitAt)) continue;
    const id = C(row.memberId);
    let cities = visitsByMember.get(id);
    if (!cities) {
      cities = new Set();
      visitsByMember.set(id, cities);
    }
    cities.add(row.city);
  }
  const hist = histories(input, C);
  const silent = new Map<MemberId, string[]>();
  const answeredAny = new Map<string, boolean>();
  for (const a of input.recentAsks ?? []) { const k = `${C(a.memberId)}|${a.reason}`; answeredAny.set(k, (answeredAny.get(k) ?? false) || (a.answeredAt !== undefined && a.answeredAt <= now)); }
  const open = new Map<MemberId, string[]>();
  const counts = new Map<MemberId, Record<string, number>>();
  for (const a of input.recentAsks ?? []) { const c = counts.get(C(a.memberId)) ?? {}; c[a.reason] = (c[a.reason] ?? 0) + 1; counts.set(C(a.memberId), c); }
  for (const a of input.recentAsks ?? []) {
    const id = C(a.memberId), k = `${id}|${a.reason}`;
    const askField = a.reason.startsWith("dating_") ? a.reason.slice(7) : a.reason.startsWith("slop_") ? a.reason.slice(5) : undefined;
    if (askField && !answeredAny.get(k) && now - a.at < SILENT_AFTER_DAYS * DAY) { const l = open.get(id) ?? []; if (!l.includes(askField)) l.push(askField); open.set(id, l.sort()); }
    if (!askField || answeredAny.get(k) || now - a.at < SILENT_AFTER_DAYS * DAY) continue;
    const l = silent.get(id) ?? [];
    if (!l.includes(askField)) l.push(askField);
    silent.set(id, l.sort());
  }
  const out = new Map<MemberId, SlopProfile>();
  const sortedMembers = [...input.members].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const m of sortedMembers) {
    const fs = (facetsBy.get(m.id) ?? []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
    const appearanceFacets: Facet[] = [];
    const cleanTags: string[] = [];
    let verifyPass = false, verifyFail = false, reviewConfirmed = false, reviewCleared = false;
    for (const f of fs) {
      let hasApp = false;
      for (const t of f.tags) {
        if (t.startsWith(APPEARANCE_PREFIX)) hasApp = true;
        if (NEVER_USED.test(t)) continue;
        cleanTags.push(t);
        if (t === "verify:age:pass") verifyPass = true;
        else if (t === "verify:age:fail") verifyFail = true;
        else if (t === "review:confirmed") reviewConfirmed = true;
        else if (t === "review:cleared") reviewCleared = true;
      }
      if (hasApp) appearanceFacets.push(f);
    }
    const ageVerified = verifyPass ? true : verifyFail ? false : undefined;
    const appearance = canRatePhotos({ age: m.age, ageVerified: verifyFail ? false : undefined })
      ? parseAppearance(appearanceFacets.flatMap(f => f.tags)) : undefined;
    const appearanceSources = new Map<string, string>();
    if (appearance) for (const facet of appearanceFacets) for (const tag of facet.tags) {
      const key = /^appearance:(face|body|overall|conf|photos|spread)=/.exec(tag)?.[1];
      if (key && (key !== "photos" || appearance.photos !== undefined) && (key !== "spread" || appearance.spread !== undefined)) appearanceSources.set(key, facet.id);
    }
    const has = indexTagsByPrefix(cleanTags);
    const one = (prefix: string) => has(prefix)[0];
    const hasDomain = (suffix: string) => {
      const a = has(`dating:${suffix}`), b = has(`slop:${suffix}`);
      return a.length ? (b.length ? [...a, ...b] : a) : b;
    };
    const oneDomain = (suffix: string) => has(`dating:${suffix}`)[0] ?? has(`slop:${suffix}`)[0];
    const zips = hasDomain("zip:");
    const zip = zips.find(isKnownZip) ?? zips[0];
    const area = zip && isKnownZip(zip) ? undefined : hasDomain("area:").map(a => zipForArea(a.replace(/_/g, " "), m.homeCity)).find(Boolean);
    const cell = zip && isKnownZip(zip) ? cellOfZip(zip) : area ? cellOfZip(area.zip) : undefined;
    const age = one("romance:age:");
    const sc = oneDomain("scope:");
    const scope: Scope | undefined = !sc ? undefined : sc === "city" ? { mode: "city" }
      : sc.startsWith("radius:") ? { mode: "radius", miles: Number(sc.slice(7)) }
      : sc.startsWith("multi:") ? { mode: "multi", markets: sc.slice(6).split(",").filter(Boolean) as City[] } : undefined;
    const mm = oneDomain("max_miles:");
    const ri = oneDomain("religion_importance:");
    const num = (t: string) => Number(t.slice(t.indexOf("=") + 1));
    const wants = hasDomain("wants:"), self = hasDomain("self:");
    const freeSet = new Set(hasDomain("free:"));
    const interestFacets = fs.filter(f => f.kind === "interest" && f.tags[0] && f.tags[0].trim().length > 0 && !NEVER_USED.test(f.tags[0]));
    const interestFacet = new Map<string, string>();
    for (const f of interestFacets) if (f.scope === "shareable") interestFacet.set(f.tags[0]!, f.id);
    const visiting = [...(visitsByMember.get(m.id) ?? [])].filter(city => city !== m.homeCity).sort();
    const trans = one("romance:trans:"), openTrans = one("romance:open_trans:"), isRaw = one("romance:is:");
    const datingFacts: DatingFacts = {
      is: isRaw !== undefined && isGender(isRaw) ? isRaw : undefined,
      seeks: [...new Set(has("romance:seeks:"))].filter(isGender).sort(),
      trans: trans !== undefined && isTransStatus(trans) ? trans : undefined,
      transOpenness: openTrans !== undefined && isTransOpenness(openTrans) ? openTrans : undefined,
      shownTo: [...new Set(has("romance:shown_to:"))].filter((g): g is Gender => g === "woman" || g === "man").sort(),
    };
    const drinkingVal = oneDomain("drinking:");
    const dealbreakers = [...new Set(hasDomain("dealbreaker:"))].sort();
    const drinkNorm = drinkingVal?.trim().toLowerCase() ?? "";
    const coreRl = extractMemberRedLines(fs, dealbreakers);
    const strictSober = coreRl.strictSober || STRICT_SOBER_TOKENS.has(drinkNorm);
    const nonDrinker = strictSober || coreRl.nonDrinker || DRINKING_VALUE_NON_DRINKER_TOKENS.has(drinkNorm) || dealbreakers.some(d => {
      const low = d.trim().toLowerCase();
      return DRINKING_VALUE_NON_DRINKER_TOKENS.has(low);
    });
    const lowWalking = coreRl.lowWalking || dealbreakers.some(d => LOW_WALKING_TOKENS.has(d.trim().toLowerCase()));
    const lowNoise = coreRl.lowNoiseRequired || dealbreakers.some(d => {
      const low = d.trim().toLowerCase();
      return LOW_NOISE_TOKENS.has(low) || low === "sensory_quiet" || low === "no_loud_venues";
    });
    const daytimeOnly = coreRl.daytimeOnly || dealbreakers.some(d => DAYTIME_ONLY_TOKENS.has(d.trim().toLowerCase()));
    out.set(m.id, {
      id: m.id, age: m.age, adult: canBeMatched(m.age), optedIn: m.prefs.romanceOptIn && m.prefs.categoriesOptIn.includes("romance"), paused: m.state === "paused",
      zip: zip && isKnownZip(zip) ? normalizeZip(zip) : zip, homeMarket: m.homeCity, cell, zipUnknown: !!zip && !cell,
      ...datingFacts,
      ageRange: age ? (age.split("-").map(Number) as [number, number]) : undefined,
      scope, maxMiles: mm !== undefined ? Number(mm) : undefined,
      goal: oneDomain("goal:") as Goal | undefined,
      values: {
        smoking: oneDomain("smoking:"), drinking: drinkingVal, hasKids: oneDomain("has_kids:"), wantsKids: oneDomain("wants_kids:"),
        religion: oneDomain("religion:"), religionImportance: ri !== undefined ? Number(ri) : undefined, politics: oneDomain("politics:"),
      },
      dealbreakers,
      redLines: { strictSober, nonDrinker, lowWalking, lowNoise, daytimeOnly },
      interests: [...new Set(interestFacets.map(f => f.tags[0]!))].sort(),
      shareableInterests: [...new Set(interestFacets.filter(f => f.scope === "shareable").map(f => f.tags[0]!))].sort(),
      activities: [...new Set(hasDomain("activity:"))].sort(),
      free: SLOTS.filter(s => freeSet.has(s)),
      wants: wants.length === 5 ? wants.map(num) : undefined,
      wantsBody: [...new Set(hasDomain("wants_body:"))].sort(),
      self: self.length === 5 ? self.map(num) : undefined,
      identity: oneDomain("identity:"), orientation: oneDomain("orientation:"),
      safety: [...new Set(has("safety:"))].sort(),
      verification: [...new Set(has("verify:"))].sort(),
      ageVerified,
      appearance, appearanceEvidenceIds: [...new Set(appearanceSources.values())],
      visiting, interestFacet, silentAsks: silent.get(m.id) ?? [], openAsks: open.get(m.id) ?? [], askCounts: counts.get(m.id) ?? {},
      review: reviewConfirmed ? "confirmed" : reviewCleared ? "cleared" : undefined,
      history: hist.get(m.id) ?? emptyHistory(),
    });
  }
  for (const p of out.values()) {
    p.history.rated.sort((x, y) => (x.about < y.about ? -1 : x.about > y.about ? 1 : x.v - y.v));
    for (const r of p.history.rated) {
      const q = out.get(r.about);
      if (q?.self) p.history.ratedSelf.push({ self: q.self, v: r.v });
      const ap = q?.appearance;
      if (ap?.bodyType && (ap.bodyTypeConfidence ?? 0) >= 0.4) p.history.ratedBody.push({ type: ap.bodyType, v: r.v });
    }
  }
  return out;
}

const STATED_GENDER: Record<Gender, StatedGender> = { woman: "GenderWoman", man: "GenderMan", nonbinary: "GenderNonbinary" };
const isGender = (g: string): g is Gender => Object.hasOwn(STATED_GENDER, g);
const OPENNESS: Record<NonNullable<SlopProfile["transOpenness"]>, TransOpenness> = { open: "OpenToTrans", not_open: "NotOpenToTrans", only: "OnlyTrans", declined: "TransUnanswered" };
const isTransStatus = (x: string): x is NonNullable<SlopProfile["trans"]> => x === "yes" || x === "no";
const isTransOpenness = (x: string): x is NonNullable<SlopProfile["transOpenness"]> => Object.hasOwn(OPENNESS, x);

export type DatingFacts = Pick<SlopProfile, "is" | "seeks" | "trans" | "transOpenness" | "shownTo">;
export function datingFactsOf(tags: readonly string[]): DatingFacts {
  const has = indexTagsByPrefix(tags);
  const one = (prefix: string) => has(prefix)[0];
  const trans = one("romance:trans:"), open = one("romance:open_trans:"), is = one("romance:is:");
  return {
    is: is !== undefined && isGender(is) ? is : undefined,
    seeks: [...new Set(has("romance:seeks:"))].filter(isGender).sort(),
    trans: trans !== undefined && isTransStatus(trans) ? trans : undefined,
    transOpenness: open !== undefined && isTransOpenness(open) ? open : undefined,
    shownTo: [...new Set(has("romance:shown_to:"))].filter((g): g is Gender => g === "woman" || g === "man").sort(),
  };
}

export function datingStatementOf(p: DatingFacts): DatingStatement {
  return {
    gender: p.is ? STATED_GENDER[p.is] : "GenderUnstated",
    trans: p.trans === "yes" ? "StatedTrans" : p.trans === "no" ? "StatedNotTrans" : "TransNotStated",
    seeksWomen: p.seeks.includes("woman"), seeksMen: p.seeks.includes("man"), seeksNonbinary: p.seeks.includes("nonbinary"),
    shownToWomenSeekers: p.shownTo.includes("woman"), shownToMenSeekers: p.shownTo.includes("man"),
    transOpenness: p.transOpenness ? OPENNESS[p.transOpenness] : "TransUnanswered",
  };
}

const emptyHistory = (): History => ({ yes: 0, no: 0, silent: 0, dates: 0, noShows: 0, backouts: 0, negativeFrom: 0, contextualBlocks: 0, attendedSlots: [], rated: [], ratedSelf: [], ratedBody: [] });
const SENT = { positive: 1, neutral: 0.5, negative: 0 } as const;

function attendedSlot(r: InteractionRecord, homeZone: string): number {
  if (r.bookedMeeting === null) return -1;
  const parts = localParts(r.bookedMeeting?.at ?? r.at, r.bookedMeeting?.timeZone ?? homeZone);
  return completedMeetingSlot(parts.weekday, parts.hour);
}

function histories(input: EngineInput, C: (id: MemberId) => MemberId): Map<MemberId, History> {
  const out = new Map<MemberId, History>();
  const h = (id: MemberId) => { let x = out.get(id); if (!x) { x = emptyHistory(); out.set(id, x); } return x; };
  const now = input.now;
  const zoneOf = new Map(input.members.map(m => [C(m.id), CITY_TZ[m.homeCity]]));
  const firstEncounter = new Map<string, number>();
  const attendance = new Map<string, { completed?: InteractionRecord; absent: Set<MemberId> }>();
  for (const r of input.interactions ?? []) {
    if (r.at > now) continue;
    if (r.participants.length === 2 && slopRecordedBlockContext(r.outcome)) {
      const key = pairKey(C(r.participants[0]!), C(r.participants[1]!));
      firstEncounter.set(key, Math.min(firstEncounter.get(key) ?? r.at, r.at));
    }
    for (const id of r.acceptedBy ?? []) h(C(id)).yes++;
    if (r.outcome === "declined") for (const id of r.declinedBy ?? []) h(C(id)).no++;
    if (r.outcome === "cancelled") for (const id of r.declinedBy ?? []) h(C(id)).backouts++;
    for (const id of r.noResponse ?? []) h(C(id)).silent++;
    if (r.outcome !== "completed" && r.outcome !== "no_show") continue;

    const opportunityId = r.opportunityId ?? r.id;
    const known = attendance.get(opportunityId) ?? { absent: new Set<MemberId>() };
    attendance.set(opportunityId, known);
    if (r.outcome === "completed") {
      const previous = known.completed;
      if (!previous || (previous.bookedMeeting == null && r.bookedMeeting != null)
        || ((previous.bookedMeeting != null) === (r.bookedMeeting != null) && r.at < previous.at)) known.completed = r;
    } else {
      const roster = new Set(r.participants.map(C));
      for (const id of r.noShowBy ?? []) {
        const member = C(id);
        if (slopNoShowCounts(true, roster.has(member))) known.absent.add(member);
      }
    }
  }

  const negFrom = new Map<MemberId, Set<MemberId>>();
  const lastDate = new Map<MemberId, { opportunityId: string; at: number; participants: MemberId[]; liked?: boolean }>();
  for (const { completed, absent } of attendance.values()) {
    for (const id of absent) h(id).noShows++;
    if (!completed) continue;

    const marker = completed.id.lastIndexOf(":fb:");
    const opportunityId = completed.opportunityId ?? (marker < 0 ? completed.id : completed.id.slice(0, marker));
    const booked = completed.bookedMeeting;
    const at = completedDatePacingAt(booked != null, booked?.at ?? 0, completed.at);
    const participants = [...new Set(completed.participants.map(C))];
    for (const id of participants) {
      if (!slopCompletedDateCounts(true, absent.has(id))) continue;
      const history = h(id);
      history.dates++;
      const slot = attendedSlot(completed, zoneOf.get(id) ?? CITY_TZ.nyc);
      if (slot >= 0) history.attendedSlots.push(slot);
      const cur = lastDate.get(id);
      if (!cur || at > cur.at || (at === cur.at && opportunityId < cur.opportunityId)) {
        lastDate.set(id, { opportunityId, at, participants });
      }
    }
  }
  const fbs = [...(input.feedback ?? [])].sort((x, y) => (x.at - y.at) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  for (const f of fbs) {
    if (f.at > now) continue;
    const from = C(f.from), about = C(f.about);
    const v = (SENT[f.sentiment] + (f.wouldMeetAgain === undefined ? SENT[f.sentiment] : f.wouldMeetAgain ? 1 : 0)) / 2;
    h(from).rated.push({ about, v });
    if (f.sentiment === "negative") { const set = negFrom.get(about) ?? new Set(); set.add(from); negFrom.set(about, set); }
    const ld = lastDate.get(from);
    if (ld && completedDateFeedbackMatches(f.at, ld.at, f.opportunityId !== undefined, f.opportunityId === ld.opportunityId,
      from !== about && ld.participants.includes(about))) {
      ld.liked = f.wouldMeetAgain === true;
    }
  }
  for (const [id, set] of negFrom) h(id).negativeFrom = set.size;
  for (const [id, d] of lastDate) { const y = h(id); y.lastDateAt = d.at; y.lastDateLiked = d.liked; }
  const blockers = new Map<MemberId, Set<MemberId>>();
  for (const e of input.edges) {
    if (e.type !== "blocked") continue;
    const from = C(e.from), to = C(e.to);
    if (from === to || !slopContextualBlockAllowed(firstEncounter.get(pairKey(from, to)) ?? -1, e.createdAt, now)) continue;
    const known = blockers.get(to) ?? new Set<MemberId>();
    known.add(from);
    blockers.set(to, known);
  }
  for (const [id, from] of blockers) h(id).contextualBlocks = from.size;
  for (const it of input.intents) if (it.category === "romance" && standingIntentLive(it, input.now)) {
    const y = h(C(it.memberId));
    y.lastAskAt = Math.max(y.lastAskAt ?? -Infinity, it.createdAt);
  }
  return out;
}

export function datingMarkets(p: SlopProfile): City[] {
  if (p.scope?.mode === "multi") return [...new Set([...p.scope.markets, ...p.visiting])].sort();
  return p.visiting.length ? [...p.visiting] : [p.homeMarket];
}

export function cellIn(p: SlopProfile, market: City): Cell | undefined {
  return p.homeMarket === market && p.cell ? p.cell : cellOfZip(MARKET_ANCHOR_ZIP[market]);
}
