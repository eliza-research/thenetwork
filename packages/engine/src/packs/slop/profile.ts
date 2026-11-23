import type { City, Facet, MemberId } from "@thenetwork/core";
import { canBeMatched, CITY_TZ, DAY, localParts, temporaryPresenceWindow } from "@thenetwork/core";
import { slopContextualBlockAllowed, slopRecordedBlockContext } from "../../../../core/src/generated/datingRadius.ts";
import { completedMeetingSlot } from "../../../../core/src/generated/meetingSettlement.ts";
import { presenceWindowContains } from "../../../../core/src/generated/travelPresence.ts";
import type { DatingStatement, StatedGender, TransOpenness } from "../../../../core/src/generated/mutualOpenness.ts";
import { standingIntentLive } from "../../../../core/src/standing-intent.ts";
import type { EngineInput, InteractionRecord } from "../../types.ts";
import { pairKey } from "../../world.ts";
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

const cache = new WeakMap<EngineInput, Map<MemberId, SlopProfile>>();
const SILENT_AFTER_DAYS = 7;

export function slopProfiles(input: EngineInput, canonical: (id: MemberId) => MemberId = x => x): Map<MemberId, SlopProfile> {
  let out = cache.get(input);
  if (out) return out;
  out = buildProfiles(input, canonical);
  cache.set(input, out);
  return out;
}

function buildProfiles(input: EngineInput, C: (id: MemberId) => MemberId): Map<MemberId, SlopProfile> {
  const now = input.now;
  const facetsBy = new Map<MemberId, Facet[]>();
  for (const f of input.facets) {
    if (f.validTo !== undefined && f.validTo < now) continue;
    if (f.validFrom !== undefined && f.validFrom > now) continue;
    const id = C(f.memberId);
    const l = facetsBy.get(id) ?? [];
    l.push(f);
    facetsBy.set(id, l);
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
    if (a.reason.startsWith("slop_") && !answeredAny.get(k) && now - a.at < SILENT_AFTER_DAYS * DAY) { const l = open.get(id) ?? []; if (!l.includes(a.reason.slice(5))) l.push(a.reason.slice(5)); open.set(id, l.sort()); }
    if (!a.reason.startsWith("slop_") || answeredAny.get(k) || now - a.at < SILENT_AFTER_DAYS * DAY) continue;
    const l = silent.get(id) ?? [];
    const f = a.reason.slice(5);
    if (!l.includes(f)) l.push(f);
    silent.set(id, l.sort());
  }
  const out = new Map<MemberId, SlopProfile>();
  for (const m of [...input.members].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const fs = (facetsBy.get(m.id) ?? []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
    const appearanceFacets = fs.filter(f => f.tags.some(t => t.startsWith(APPEARANCE_PREFIX)));
    const tags = fs.flatMap(f => f.tags.filter(t => !NEVER_USED.test(t)).map(t => ({ t, f })));
    const ageVerified = tags.some(x => x.t === "verify:age:pass") ? true : tags.some(x => x.t === "verify:age:fail") ? false : undefined;
    const appearance = canRatePhotos({ age: m.age, ageVerified: tags.some(x => x.t === "verify:age:fail") ? false : undefined })
      ? parseAppearance(appearanceFacets.flatMap(f => f.tags)) : undefined;
    const appearanceSources = new Map<string, string>();
    if (appearance) for (const facet of appearanceFacets) for (const tag of facet.tags) {
      const key = /^appearance:(face|body|overall|conf|photos|spread)=/.exec(tag)?.[1];
      if (key && (key !== "photos" || appearance.photos !== undefined) && (key !== "spread" || appearance.spread !== undefined)) appearanceSources.set(key, facet.id);
    }
    const has = (prefix: string) => tags.filter(x => x.t.startsWith(prefix)).map(x => x.t.slice(prefix.length));
    const one = (prefix: string) => has(prefix)[0];
    const zips = has("slop:zip:");
    const zip = zips.find(isKnownZip) ?? zips[0];
    const area = zip && isKnownZip(zip) ? undefined : has("slop:area:").map(a => zipForArea(a.replace(/_/g, " "), m.homeCity)).find(Boolean);
    const cell = zip && isKnownZip(zip) ? cellOfZip(zip) : area ? cellOfZip(area.zip) : undefined;
    const age = one("romance:age:");
    const sc = one("slop:scope:");
    const scope: Scope | undefined = !sc ? undefined : sc === "city" ? { mode: "city" }
      : sc.startsWith("radius:") ? { mode: "radius", miles: Number(sc.slice(7)) }
      : sc.startsWith("multi:") ? { mode: "multi", markets: sc.slice(6).split(",").filter(Boolean) as City[] } : undefined;
    const mm = one("slop:max_miles:");
    const ri = one("slop:religion_importance:");
    const num = (t: string) => Number(t.slice(t.indexOf("=") + 1));
    const wants = has("slop:wants:"), self = has("slop:self:");
    const interestFacets = fs.filter(f => f.kind === "interest" && f.tags[0] && f.tags[0].trim().length > 0 && !NEVER_USED.test(f.tags[0]));
    const interestFacet = new Map<string, string>();
    for (const f of interestFacets) if (f.scope === "shareable") interestFacet.set(f.tags[0]!, f.id);
    const visiting = [...(visitsByMember.get(m.id) ?? [])].filter(city => city !== m.homeCity).sort();
    out.set(m.id, {
      id: m.id, age: m.age, adult: canBeMatched(m.age), optedIn: m.prefs.romanceOptIn && m.prefs.categoriesOptIn.includes("romance"), paused: m.state === "paused",
      zip: zip && isKnownZip(zip) ? normalizeZip(zip) : zip, homeMarket: m.homeCity, cell, zipUnknown: !!zip && !cell,
      ...datingFactsOf(tags.map(x => x.t)),
      ageRange: age ? (age.split("-").map(Number) as [number, number]) : undefined,
      scope, maxMiles: mm !== undefined ? Number(mm) : undefined,
      goal: one("slop:goal:") as Goal | undefined,
      values: {
        smoking: one("slop:smoking:"), drinking: one("slop:drinking:"), hasKids: one("slop:has_kids:"), wantsKids: one("slop:wants_kids:"),
        religion: one("slop:religion:"), religionImportance: ri !== undefined ? Number(ri) : undefined, politics: one("slop:politics:"),
      },
      dealbreakers: [...new Set(has("slop:dealbreaker:"))].sort(),
      interests: [...new Set(interestFacets.map(f => f.tags[0]!))].sort(),
      shareableInterests: [...new Set(interestFacets.filter(f => f.scope === "shareable").map(f => f.tags[0]!))].sort(),
      activities: [...new Set(has("slop:activity:"))].sort(),
      free: SLOTS.filter(s => has("slop:free:").includes(s)),
      wants: wants.length === 5 ? wants.map(num) : undefined,
      wantsBody: [...new Set(has("slop:wants_body:"))].sort(),
      self: self.length === 5 ? self.map(num) : undefined,
      identity: one("slop:identity:"), orientation: one("slop:orientation:"),
      safety: [...new Set(tags.filter(x => x.t.startsWith("safety:")).map(x => x.t))].sort(),
      verification: [...new Set(tags.filter(x => x.t.startsWith("verify:")).map(x => x.t))].sort(),
      ageVerified,
      appearance, appearanceEvidenceIds: [...new Set(appearanceSources.values())],
      visiting, interestFacet, silentAsks: silent.get(m.id) ?? [], openAsks: open.get(m.id) ?? [], askCounts: counts.get(m.id) ?? {},
      review: tags.some(x => x.t === "review:confirmed") ? "confirmed" : tags.some(x => x.t === "review:cleared") ? "cleared" : undefined,
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
  const has = (prefix: string) => tags.filter(t => t.startsWith(prefix)).map(t => t.slice(prefix.length));
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
    if (r.outcome === "completed") for (const id of r.participants) {
      const x = h(C(id)); x.dates++;
      const slot = attendedSlot(r, zoneOf.get(C(id)) ?? CITY_TZ.nyc);
      if (slot >= 0) x.attendedSlots.push(slot);
    }
    if (r.outcome === "no_show") for (const id of r.participants) h(C(id)).noShows++;
  }
  const negFrom = new Map<MemberId, Set<MemberId>>();
  const lastDate = new Map<MemberId, { at: number; liked?: boolean }>();
  for (const r of input.interactions ?? []) if (r.outcome === "completed" && r.at <= now) for (const id of r.participants) {
    const k = C(id), cur = lastDate.get(k);
    if (!cur || r.at > cur.at) lastDate.set(k, { at: r.at });
  }
  const fbs = [...(input.feedback ?? [])].sort((x, y) => (x.at - y.at) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  for (const f of fbs) {
    if (f.at > now) continue;
    const from = C(f.from), about = C(f.about);
    const v = (SENT[f.sentiment] + (f.wouldMeetAgain === undefined ? SENT[f.sentiment] : f.wouldMeetAgain ? 1 : 0)) / 2;
    h(from).rated.push({ about, v });
    if (f.sentiment === "negative") { const set = negFrom.get(about) ?? new Set(); set.add(from); negFrom.set(about, set); }
    const ld = lastDate.get(from);
    if (ld && f.at >= ld.at) ld.liked = f.wouldMeetAgain === true;
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
