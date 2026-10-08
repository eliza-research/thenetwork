// slopPack's typed view of a member: the dating profile parsed from facet tags, plus what the
// Network itself recorded about them (probe answers, dates, feedback, reports). Everything here is
// agent-visible (the member's own agent may use agent_private facets to FILTER and RANK; it never
// shows them to anyone). Hidden truth never reaches this module: it reads only the EngineInput.
//
// Facet tag schema (docs/results/2026-10-08-slop-world.md "Snapshot mapping"; the platform writes
// the same tags from the onboarding chat):
//   preference  romance:is:<g> romance:seeks:<g> romance:age:<lo>-<hi>
//   fact        slop:zip:<zip>
//   preference  slop:scope:city | slop:scope:radius:<mi> | slop:scope:multi:<c1>,<c2>; slop:max_miles:<mi>
//   goal        slop:goal:<casual|long_term|unsure>
//   fact        slop:smoking:* slop:drinking:* slop:has_kids:* slop:wants_kids:* slop:religion:*
//               slop:religion_importance:<0-3> slop:politics:*
//   boundary    slop:dealbreaker:<smoker|heavy_drinker|has_kids|wants_kids|no_kids_ever|religious|nonreligious|right_politics|left_politics>
//   interest    <tag>; preference slop:activity:<activity>; availability_pattern slop:free:<slot>
//   preference  slop:wants:<dim>=<x>; fact slop:self:<dim>=<x>
//   fact        safety:<scam_pattern|age_signal|photo_mismatch|hostile_language|relationship_signal>
// NO RACE OR ETHNICITY: there is no field for it; tags that look like one are dropped here, so no
// rule, score or explanation can read them (PRD 40.5; conformance test "no race filters").
import type { City, Facet, MemberId } from "@thenetwork/core";
import { canBeMatched, DAY } from "@thenetwork/core";
import type { EngineInput } from "../../types.ts";
import { cellOfZip, MARKET_ANCHOR_ZIP, type Cell } from "./zips.ts";
import { APPEARANCE_PREFIX, canRatePhotos, parseAppearance } from "./appearance.ts";

export type Gender = "woman" | "man" | "nonbinary";
export type Goal = "casual" | "long_term" | "unsure";
export type Scope = { mode: "city" } | { mode: "radius"; miles: number } | { mode: "multi"; markets: City[] };
export const SLOTS = ["mon_eve", "tue_eve", "wed_eve", "thu_eve", "fri_eve", "sat_day", "sat_eve", "sun_day", "sun_eve"] as const;
export type Slot = (typeof SLOTS)[number];
export const SAFETY_CUES = ["safety:scam_pattern", "safety:age_signal", "safety:photo_mismatch", "safety:hostile_language", "safety:relationship_signal"] as const;

/** Tags never read for matching (no race / ethnicity field, filter or inference). */
const NEVER_USED = /^(race|ethnicity|skin|nationality|immigration|hiv|sti|health|income)\b|:(race|ethnicity)\b/i;

export interface History {
  /** Probes this member answered yes / no / never answered (interaction records). */
  yes: number; no: number; silent: number;
  /** Booked first dates that happened, no-shows (either side), back-outs at the reveal by this member. */
  dates: number; noShows: number; backouts: number;
  /** Feedback this member gave: mean of positive=1 / neutral=0.5 / negative=0, and count. */
  givenMean: number; given: number;
  /** Feedback about this member: same scale, count, distinct people who were negative. */
  receivedMean: number; received: number; negativeFrom: number;
  /** Members who blocked this member. */
  blockedBy: number;
  /** Last completed date (ms), and whether this member wanted to see that person again. */
  lastDateAt?: number; lastDateLiked?: boolean;
  /** Last time the member asked the agent for a date (the live want). */
  lastAskAt?: number;
  /** Week slots (SLOTS index) the member attended a date at (learned availability). */
  attendedSlots: number[];
  /** Ratings this member gave (0..1) about people they met, by id (revealed taste). */
  rated: { about: MemberId; v: number }[];
  /** The same, joined with the rated person's self-description when known (filled after all profiles are parsed). */
  ratedSelf: { self: number[]; v: number }[];
  /** The same, joined with the rated person's (confident) body type when rated (iteration 4; revealed body-type preference). */
  ratedBody: { type: string; v: number }[];
}

export interface SlopProfile {
  id: MemberId; age: number; adult: boolean; optedIn: boolean; paused: boolean;
  zip?: string; homeMarket: City; cell?: Cell;
  is?: Gender; seeks: Gender[];
  ageRange?: [number, number]; scope?: Scope; maxMiles?: number; goal?: Goal;
  values: { smoking?: string; drinking?: string; hasKids?: string; wantsKids?: string; religion?: string; religionImportance?: number; politics?: string };
  dealbreakers: string[];
  interests: string[]; shareableInterests: string[]; activities: string[]; free: Slot[];
  wants?: number[]; self?: number[];
  /** Stated body-type preferences (slop:wants_body:<type>, appearance.ts BODY_TYPES); [] = none stated. Never shown. */
  wantsBody: string[];
  identity?: string; orientation?: string;
  safety: string[];
  /** Verification results: verify:<check>:<pass|fail> tags. */
  verification: string[];
  /** Age verification: true = passed, false = failed, undefined = no check recorded. */
  ageVerified?: boolean;
  /** Appearance rating (iteration 3), read only for adults whose age is not known to be unverified. */
  appearance?: { face: number; body: number; overall: number; confidence: number; bodyType?: string; bodyTypeConfidence?: number;
    /** Iteration 5: rank of `overall` among the rated members in this input, 0 (lowest) .. 1. Internal only. */
    quantile?: number };
  /**
   * Hard-filter questions asked at least `silentAfterDays` ago and never answered (age_range,
   * distance, orientation): the pack proposes on a narrow fallback instead of locking them out.
   */
  silentAsks: string[];
  /** Questions asked less than 7 days ago and not answered yet (reason minus "slop_"). */
  openAsks: string[];
  /** How many times each question (reason) was asked (re-ask cap). */
  askCounts: Record<string, number>;
  /** Human review of a safety hold: cleared (a false positive) or confirmed. */
  review?: "cleared" | "confirmed";
  /** Markets this member is visiting in the coming days (an announced trip in progress at now + 2 days). */
  visiting: City[];
  /** Facet ids by role, for evidence (only shareable ones ever reach member-facing text). */
  interestFacet: Map<string, string>;
  history: History;
}

const cache = new WeakMap<EngineInput, Map<MemberId, SlopProfile>>();
/** An unanswered question older than this counts as silence (SlopPackOptions.silentFallback). */
export const SILENT_AFTER_DAYS = 7;

/** Typed dating profiles for every member of an engine input (cached per input object). */
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
  const hist = histories(input, C);
  // Questions asked >= 7 days ago and never answered (recentAsks; reason slop_<field>).
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
    const tags = fs.flatMap(f => f.tags.filter(t => !NEVER_USED.test(t)).map(t => ({ t, f })));
    const has = (prefix: string) => tags.filter(x => x.t.startsWith(prefix)).map(x => x.t.slice(prefix.length));
    const one = (prefix: string) => has(prefix)[0];
    const zip = one("slop:zip:");
    const age = one("romance:age:");
    const sc = one("slop:scope:");
    const scope: Scope | undefined = !sc ? undefined : sc === "city" ? { mode: "city" }
      : sc.startsWith("radius:") ? { mode: "radius", miles: Number(sc.slice(7)) }
      : sc.startsWith("multi:") ? { mode: "multi", markets: sc.slice(6).split(",").filter(Boolean) as City[] } : undefined;
    const mm = one("slop:max_miles:");
    const ri = one("slop:religion_importance:");
    const num = (t: string) => Number(t.slice(t.indexOf("=") + 1));
    const wants = has("slop:wants:"), self = has("slop:self:");
    const interestFacets = fs.filter(f => f.kind === "interest" && f.tags[0] && !NEVER_USED.test(f.tags[0]));
    const interestFacet = new Map<string, string>();
    for (const f of interestFacets) if (f.scope === "shareable") interestFacet.set(f.tags[0]!, f.id);
    const is = one("romance:is:") as Gender | undefined;
    const seeks = [...new Set(has("romance:seeks:"))].sort() as Gender[];
    const visiting = [...new Set(input.presence.filter(p => C(p.memberId) === m.id && p.type === "temporary" && (p.from ?? -Infinity) <= now + 2 * DAY && now + 2 * DAY < (p.to ?? Infinity) && p.city !== m.homeCity).map(p => p.city))].sort();
    out.set(m.id, {
      id: m.id, age: m.age, adult: canBeMatched(m.age), optedIn: m.prefs.romanceOptIn && m.prefs.categoriesOptIn.includes("romance"), paused: m.state === "paused",
      zip, homeMarket: m.homeCity, cell: zip ? cellOfZip(zip) : undefined,
      is, seeks,
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
      ageVerified: tags.some(x => x.t === "verify:age:pass") ? true : tags.some(x => x.t === "verify:age:fail") ? false : undefined,
      // Adults only: a rating on anyone else is ignored, whatever the snapshot says.
      appearance: canRatePhotos({ age: m.age, ageVerified: tags.some(x => x.t === "verify:age:fail") ? false : undefined })
        ? parseAppearance(fs.filter(f => f.tags.some(t => t.startsWith(APPEARANCE_PREFIX))).flatMap(f => f.tags)) : undefined,
      visiting, interestFacet, silentAsks: silent.get(m.id) ?? [], openAsks: open.get(m.id) ?? [], askCounts: counts.get(m.id) ?? {},
      review: tags.some(x => x.t === "review:confirmed") ? "confirmed" : tags.some(x => x.t === "review:cleared") ? "cleared" : undefined,
      history: hist.get(m.id) ?? emptyHistory(),
    });
  }
  // Iteration 5: each rating's quantile among the rated members of this input (ties by id).
  const ratedP = [...out.values()].filter(p => p.appearance).sort((x, y) => (x.appearance!.overall - y.appearance!.overall) || (x.id < y.id ? -1 : 1));
  ratedP.forEach((p, i) => { p.appearance!.quantile = ratedP.length > 1 ? i / (ratedP.length - 1) : 0.5; });
  // Revealed taste: the self-descriptions of the people a member rated, with the rating.
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

const emptyHistory = (): History => ({ yes: 0, no: 0, silent: 0, dates: 0, noShows: 0, backouts: 0, givenMean: 0, given: 0, receivedMean: 0, received: 0, negativeFrom: 0, blockedBy: 0, attendedSlots: [], rated: [], ratedSelf: [], ratedBody: [] });
const SENT = { positive: 1, neutral: 0.5, negative: 0 } as const;

/** Slot index of a timestamp in the dating week (the slop world's slots: weekday evenings 19:00, weekend 14:00 / 19:00 UTC). */
function slotOf(t: number): number | undefined {
  const d = new Date(t);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  const eve = d.getUTCHours() >= 17;
  if (dow <= 4) return eve ? dow : undefined;
  return dow === 5 ? (eve ? 6 : 5) : (eve ? 8 : 7);
}

function histories(input: EngineInput, C: (id: MemberId) => MemberId): Map<MemberId, History> {
  const out = new Map<MemberId, History>();
  const h = (id: MemberId) => { let x = out.get(id); if (!x) { x = emptyHistory(); out.set(id, x); } return x; };
  const now = input.now;
  for (const r of input.interactions ?? []) {
    if (r.at > now) continue;
    for (const id of r.acceptedBy ?? []) h(C(id)).yes++;
    if (r.outcome === "declined") for (const id of r.declinedBy ?? []) h(C(id)).no++;
    if (r.outcome === "cancelled") for (const id of r.declinedBy ?? []) h(C(id)).backouts++;
    for (const id of r.noResponse ?? []) h(C(id)).silent++;
    if (r.outcome === "completed") for (const id of r.participants) {
      const x = h(C(id)); x.dates++;
      const s = slotOf(r.at);
      if (s !== undefined) x.attendedSlots.push(s);
    }
    if (r.outcome === "no_show") for (const id of r.participants) h(C(id)).noShows++;
  }
  const negFrom = new Map<MemberId, Set<MemberId>>();
  const lastDate = new Map<MemberId, { at: number; liked?: boolean }>();
  for (const r of input.interactions ?? []) if (r.outcome === "completed" && r.at <= now) for (const id of r.participants) {
    const k = C(id), cur = lastDate.get(k);
    if (!cur || r.at > cur.at) lastDate.set(k, { at: r.at });
  }
  const sum = new Map<MemberId, { g: number; gn: number; r: number; rn: number }>();
  const s = (id: MemberId) => { let x = sum.get(id); if (!x) { x = { g: 0, gn: 0, r: 0, rn: 0 }; sum.set(id, x); } return x; };
  // Order-independent: feedback in (time, id) order, so "the last word on the last date" is stable under shuffles.
  const fbs = [...(input.feedback ?? [])].sort((x, y) => (x.at - y.at) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  for (const f of fbs) {
    if (f.at > now) continue;
    const from = C(f.from), about = C(f.about);
    const v = (SENT[f.sentiment] + (f.wouldMeetAgain === undefined ? SENT[f.sentiment] : f.wouldMeetAgain ? 1 : 0)) / 2;
    h(from).rated.push({ about, v });
    s(from).g += v; s(from).gn++;
    s(about).r += v; s(about).rn++;
    if (f.sentiment === "negative") { const set = negFrom.get(about) ?? new Set(); set.add(from); negFrom.set(about, set); }
    const ld = lastDate.get(from);
    if (ld && f.at >= ld.at) ld.liked = f.wouldMeetAgain === true;
  }
  for (const [id, x] of sum) { const y = h(id); y.given = x.gn; y.givenMean = x.gn ? x.g / x.gn : 0; y.received = x.rn; y.receivedMean = x.rn ? x.r / x.rn : 0; }
  for (const [id, set] of negFrom) h(id).negativeFrom = set.size;
  for (const [id, d] of lastDate) { const y = h(id); y.lastDateAt = d.at; y.lastDateLiked = d.liked; }
  for (const e of input.edges) if (e.type === "blocked") h(C(e.to)).blockedBy++;
  for (const it of input.intents) if (it.category === "romance") { const y = h(C(it.memberId)); y.lastAskAt = Math.max(y.lastAskAt ?? -Infinity, it.createdAt); }
  return out;
}

/** Markets a member dates in this week: a stated multi-city set; else the trip market while traveling, else home. */
export function datingMarkets(p: SlopProfile): City[] {
  if (p.scope?.mode === "multi") return [...new Set([...p.scope.markets, ...p.visiting])].sort();
  return p.visiting.length ? [...p.visiting] : [p.homeMarket];
}

/** The member's cell when meeting in `market`: their own zip cell at home, the market's anchor cell elsewhere. */
export function cellIn(p: SlopProfile, market: City): Cell | undefined {
  return p.homeMarket === market && p.cell ? p.cell : cellOfZip(MARKET_ANCHOR_ZIP[market]);
}
