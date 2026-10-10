// The engine pack of each app, wired into its ConsentNetwork (AGENTS.md founder decision 5; the pack
// results: docs/results/2026-10-08-slop-pack.md section 9, -peon-pack.md, -friends-pack.md).
//   ntwrk    networkPack (the engine default): nothing changes.
//   slop     makeSlopPack({ verification: { required: false } }) (founder decision 9) with SLOP_ENGINE_CONFIG on nyc, and the
//            slop hooks below: verified adults only, the engine's onboarding loop (extract, tags, read-back,
//            one question at a time, each asked at most twice), the anonymous date probe
//            with an age band and a distance band, a public place near the midpoint, the booked
//            date with the share-my-date tip, and the check-in that can file a report.
//   peon     peonPack with PEON_ENGINE_CONFIG on nyc. Each open job posting is a job seat (snapshot.ts,
//            engine peonSeats), and the hook below keeps the seat's capacity: openings minus the
//            candidates who took one or are in flight (engine peonSeatCapacity), so a seat is never
//            over-filled and a filled or closed posting gets no new match. The Network routes a seat to
//            its hiring manager (network.ts seatRoute): the candidate says yes first, then the manager
//            reviews a blind summary, and the intro goes out only after both yeses (peonHooks below,
//            src/jobs.ts). Managers post, update and close jobs by text (read back, saved on a yes).
//            Local only: peon matching and sends are not enabled in production (AGENTS.md decision 4).
//   friends  friendsPack with its plans config (FRIENDS_PLANS).
// Every pack stays behind the Network's human review gate. Matching is off until an admin turns it on
// (the stored switch starts off; platform.networks.matching_enabled only allows the switch). Minors
// never enter a pack's input (ConsentNetwork.packInput). Nothing here reads hidden truth.
import { DAY, HOUR, type Facet, type MemberId } from "@thenetwork/core";
import {
  friendsPack, FRIENDS_PLANS, makeSlopPack, peonPack, PEON_ENGINE_CONFIG, peonSeatCapacity, planFromInput, SLOP_ENGINE_CONFIG, slopProfiles,
  type AppPack, type EngineConfigInput, type EngineInput, type PlansConfigInput,
} from "@thenetwork/engine";
import { classifyYesNo } from "@thenetwork/core";
import {
  ageBand, applyCorrection, distancePhrase, emptyOnboarding, extractSlopProfile, hardComplete, markAsked, MAX_ASKS_PER_QUESTION, nextQuestion, readBack,
  SLOP_ONBOARD_QUESTIONS, slopBookedText, slopCheckInText, slopOnboardTags, slopProbeText, type OnboardField, type SlopOnboarding,
} from "@thenetwork/engine/src/packs/slop/index.ts";
import { finalize } from "@thenetwork/engine/src/packs/slop/extract.ts";
import { slopProbeMessage } from "@thenetwork/engine/src/packs/slop/copy.ts";
import { probePhotoRefs } from "@thenetwork/engine/src/packs/slop/plan.ts";
import { ZIPS } from "@thenetwork/engine/src/packs/slop/zips.ts";
import type { AppHooks, AppOnboarding, HookOpp, HookVenue } from "../src/apphooks.ts";
import { mustMarks, seatJob, SEAT_COPY } from "../src/jobs.ts";
import { km, NEIGHBORHOOD, VENUES } from "../src/geo.ts";
import { nextAt } from "../src/outreach.ts";
import type { AppId } from "../../platform/src/apps.ts";

/**
 * Photo in the probe (founder decision 2026-10-08): off. The upload consent says no other member sees
 * a photo, so no member can consent to showing one to a proposed match until Legal approves a new
 * consent version. Until then no subject has `photoConsent` and `probePhotoRefs` returns nothing; the
 * attach itself (an opaque id the platform resolves) also waits for the Cloud deliver path to carry media.
 */
export const SLOP_PROBE_PHOTOS = false;

/** What one app's network gets: its pack, the engine config the pack was tuned with, plans config and hooks. */
export interface AppWiring {
  pack?: AppPack;
  engine?: EngineConfigInput;
  plansConfig?: PlansConfigInput;
  hooks?: AppHooks;
  /** The Network's planner and plan lane (plans v1.1). Off for slop (romance never goes in plans) and peon. */
  plans?: boolean;
  /** The member prefs a new member of this app starts with (createMember). Romance only for adults. */
  prefs(age: number): { categoriesOptIn: string[]; romanceOptIn: boolean };
}

const NTWRK_CATEGORIES = ["social", "hobby", "professional", "events", "growth", "help"];

/** The wiring for one app. A new instance each time (packs hold no state, but options are per network). */
export function appWiring(app: AppId): AppWiring {
  switch (app) {
    case "slop": {
      // Founder decision 9: no ID check (phone login is the identity check; a stated age is enough).
      const pack = makeSlopPack({ verification: { required: false } });
      return {
        pack, engine: { ...SLOP_ENGINE_CONFIG, cities: ["nyc"] }, hooks: slopHooks(pack.options), plans: false,
        // Dating only, and only for adults: a member under 18 never opts in to romance (core invariant 1).
        prefs: age => ({ categoriesOptIn: age >= 18 ? ["romance"] : [], romanceOptIn: age >= 18 }),
      };
    }
    case "peon":
      return {
        pack: peonPack, engine: { ...PEON_ENGINE_CONFIG, cities: ["nyc"] }, plans: false, hooks: peonHooks(),
        prefs: () => ({ categoriesOptIn: ["professional"], romanceOptIn: false }),
      };
    case "friends":
      return { pack: friendsPack, plansConfig: FRIENDS_PLANS, prefs: () => ({ categoriesOptIn: ["social", "hobby"], romanceOptIn: false }) };
    default:
      return { prefs: () => ({ categoriesOptIn: NTWRK_CATEGORIES, romanceOptIn: false }) };
  }
}

// ==================================================================================== slop
const NYC_ZIPS = ZIPS.filter(z => z.market === "nyc");

/** The nearest zip in the pack's table to a neighborhood the member named (a coarse cell, never an address). */
export function zipForArea(area: string | undefined): string | undefined {
  const n = area ? NEIGHBORHOOD.get(area) : undefined;
  if (!n) return undefined;
  let best: { zip: string; d: number } | undefined;
  for (const z of NYC_ZIPS) { const d = km(n, { lat: z.lat, lng: z.lon }); if (!best || d < best.d) best = { zip: z.zip, d }; }
  return best?.zip;
}

// ---- onboarding: the engine's loop (AGENTS.md "Clef ratings (2026-10-09)"; engine packs/slop/onboard.ts)
// Every answer -> extractSlopProfile (applyCorrection after a read-back) -> slopOnboardTags, then the
// next message: the read-back once every hard field is set and not yet confirmed, else nextQuestion.
// Rules only, no model. Orientation follows PRD 40.5: "bi", "pan", "queer", "both" and "a mix" leave
// who they seek unset and the question is asked again (a founder decision may still change this).

/** The read-back's reason: the member's next message confirms or corrects it. */
export const SLOP_READBACK = "slop_readback";
/** The field each question is about (onboarding questions and the pack's own asks), so bare answers ("30s", "5") are read. */
const ASKED: Record<string, OnboardField> = Object.fromEntries(Object.entries(SLOP_ONBOARD_QUESTIONS).map(([r, q]) => [r, q.field]));

/** The stored state (MemberState.onboarding, plain JSON), with the age the member gave at join so it is not asked again. */
function stateOf(s: unknown, age: number | undefined): SlopOnboarding {
  const p = s && typeof s === "object" ? (s as SlopOnboarding) : emptyOnboarding();
  if (p.age || age === undefined) return p;
  return finalize({ ...p, age: { value: age, confidence: 1, evidence: { turn: -1, start: 0, end: 0, text: "" }, source: "rules" } });
}
/** What is stored keeps values and spans, never the member's words. */
const withoutWords = (p: SlopOnboarding): SlopOnboarding => JSON.parse(JSON.stringify(p), (k, v) => (k === "evidence" && v ? { ...v, text: "" } : v));

/** The slop onboarding loop (AppHooks.onboarding; exported for the sims). */
export const slopOnboarding: AppOnboarding = {
  read(state, body, reasons, { now, age }) {
    let p = stateOf(state, age);
    if (reasons.includes(SLOP_READBACK)) p = applyCorrection(p, body, { market: "nyc" });
    else {
      const before = JSON.stringify(p.distance?.value);
      p = extractSlopProfile([{ text: body, asked: reasons.map(r => ASKED[r]).find(Boolean) }], p, { market: "nyc" });
      // "Would you consider people up to 25 miles away?" "Sure": the radius widens to 25.
      if (reasons.includes("slop_widen") && JSON.stringify(p.distance?.value) === before && classifyYesNo(body) === "yes") {
        p = finalize({ ...p, distance: { value: { mode: "radius", miles: 25 }, confidence: 0.9, evidence: { turn: p.turns - 1, start: 0, end: body.length, text: body }, source: "rules" } }, true);
      }
    }
    // A minor or a declined person keeps no dating tags at all.
    if (p.minor || p.declined) return { state: withoutWords(p), tags: [], replaces: ["romance:", "slop:"] };
    const r = slopOnboardTags(p);
    return { state: withoutWords(p), tags: r.tags.map(t => ({ tag: t.tag, kind: t.kind, scope: t.scope, at: now })), replaces: r.replaces };
  },
  next(state, { age, skip = [] }) {
    const p = stateOf(state, age);
    if (p.minor || p.declined) return undefined;
    if (hardComplete(p) && !p.confirmed && !skip.includes(SLOP_READBACK) && (p.askCounts[SLOP_READBACK] ?? 0) < MAX_ASKS_PER_QUESTION) {
      const text = readBack(p);
      if (text) return { reason: SLOP_READBACK, text };
    }
    // A question that just went unanswered is not asked again right away (the pack's own asks come back to it later).
    const q = nextQuestion({ ...p, askCounts: { ...p.askCounts, ...Object.fromEntries(skip.map(r => [r, MAX_ASKS_PER_QUESTION])) } });
    return q && { reason: q.reason, text: q.text };
  },
  asked: (state, reasons, { age }) => reasons.reduce((p, r) => markAsked(p, r), stateOf(state, age)),
};

const ACTIVITY_PHRASE: Record<string, string> = {
  coffee: "coffee", drinks: "drinks", walk: "a walk", museum: "a museum visit", dinner: "dinner", live_music: "live music",
  comedy: "a comedy show", climbing: "climbing", cooking_class: "a cooking class", hike: "a daytime hike",
};
/** Public places that suit each date activity (geo.ts venue tags). */
const ACTIVITY_TAGS: Record<string, string[]> = {
  coffee: ["social", "walk", "market"], drinks: ["social"], walk: ["walk", "outdoors"], museum: ["arts", "museums"], dinner: ["food", "market"],
  live_music: ["music"], comedy: ["social", "arts"], climbing: ["sports"], cooking_class: ["cooking", "food"], hike: ["hiking", "walk"],
};
/**
 * Busy, lit, indoor or plaza places for a date after dark (approximate coordinates; real public
 * places, open in the evening). A venue database replaces this list later. Parks, waterfronts and the
 * open-air greenmarkets (geo.ts) are for daytime dates only.
 */
const EVENING_VENUES: HookVenue[] = [
  { id: "chelsea-market", name: "Chelsea Market", neighborhood: "Chelsea", lat: 40.7424, lng: -74.006 },
  { id: "bryant-park", name: "Bryant Park", neighborhood: "Midtown", lat: 40.7536, lng: -73.9832 },
  { id: "urbanspace-vanderbilt", name: "Urbanspace Vanderbilt", neighborhood: "Midtown", lat: 40.7537, lng: -73.9767 },
  { id: "lincoln-center-plaza", name: "Lincoln Center Plaza", neighborhood: "Upper West Side", lat: 40.7725, lng: -73.9835 },
  { id: "essex-market", name: "Essex Market", neighborhood: "Lower East Side", lat: 40.7188, lng: -73.9883 },
  { id: "time-out-market", name: "Time Out Market", neighborhood: "DUMBO", lat: 40.7033, lng: -73.9903 },
  { id: "dekalb-market-hall", name: "DeKalb Market Hall", neighborhood: "Fort Greene", lat: 40.6905, lng: -73.9835 },
  { id: "industry-city", name: "Industry City food hall", neighborhood: "Sunset Park", lat: 40.6553, lng: -74.0076 },
];
/** When each slot of the dating week starts, New York time. */
const SLOT_TIME: Record<string, { day: string; hour: number }> = {
  mon_eve: { day: "Mon", hour: 19 }, tue_eve: { day: "Tue", hour: 19 }, wed_eve: { day: "Wed", hour: 19 }, thu_eve: { day: "Thu", hour: 19 }, fri_eve: { day: "Fri", hour: 19 },
  sat_day: { day: "Sat", hour: 14 }, sat_eve: { day: "Sat", hour: 19 }, sun_day: { day: "Sun", hour: 14 }, sun_eve: { day: "Sun", hour: 18 },
};

/** The concrete time of a dating-week slot: its next start at least a day away. */
export function slotStart(slot: string, now: number): number | undefined {
  const s = SLOT_TIME[slot];
  return s ? nextAt(now + DAY, s.hour, wd => wd === s.day) : undefined;
}

/** A public place near the midpoint of two members' cells that suits the activity. Never a home. */
export function slopVenue(cells: { lat: number; lon: number }[], activity: string, at?: number): HookVenue | undefined {
  if (!cells.length) return undefined;
  const want = new Set(ACTIVITY_TAGS[activity] ?? ["social"]);
  // After dark, a busy, lit public place (EVENING_VENUES), never a park or a waterfront.
  const hour = at === undefined ? 12 : Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", hour: "2-digit" }).format(at));
  const dark = hour >= 17 || hour < 9;
  const pool: (HookVenue & { tags: string[] })[] = dark
    ? EVENING_VENUES.map(v => ({ ...v, tags: ["social", "food"] }))
    : VENUES.map(v => ({ id: v.id, name: v.name, neighborhood: v.neighborhood, lat: v.lat, lng: v.lng, tags: v.tags }));
  let best: { v: (typeof pool)[number]; cost: number } | undefined;
  for (const v of pool) {
    // The longest of the two trips (km), less a bonus for a place that suits the activity.
    const worst = Math.max(...cells.map(c => km({ lat: c.lat, lng: c.lon }, v)));
    const cost = worst - 1.2 * Math.min(2, v.tags.filter(t => want.has(t)).length);
    if (!best || cost < best.cost || (cost === best.cost && v.id < best.v.id)) best = { v, cost };
  }
  return best && { id: best.v.id, name: best.v.name, neighborhood: best.v.neighborhood, lat: best.v.lat, lng: best.v.lng };
}

/** The slop hooks (exported for tests). */
export function slopHooks(options: Parameters<typeof planFromInput>[4]): AppHooks {
  const plan = (o: HookOpp, input: EngineInput) => {
    const [a, b] = o.participants as [MemberId, MemberId];
    const first = o.first && o.participants.includes(o.first) ? o.first : a;
    return planFromInput(input, first, first === a ? b : a, ["nyc"], options);
  };
  return {
    engineInput(input) {
      const now = input.now;
      const facets = [...input.facets];
      const presence = input.presence.map(p => ({ ...p, areas: [...p.areas] }));
      const intents = [...input.intents];
      for (const m of input.members) {
        const mine = facets.filter(f => f.memberId === m.id).flatMap(f => f.tags);
        // A zip the member gave, else the nearest table zip to the neighborhood they named.
        let zip = mine.find(t => t.startsWith("slop:zip:"))?.slice(9);
        if (!zip) {
          const area = presence.find(p => p.memberId === m.id && p.type === "home")?.areas.find(x => NEIGHBORHOOD.has(x));
          zip = zipForArea(area);
          if (zip) facets.push({ id: `${m.id}:slop:area-zip`, memberId: m.id, kind: "fact", value: zip, tags: [`slop:zip:${zip}`], scope: "agent_private", provenance: "inferred", confidence: 0.6, validFrom: now, source: "chat", observedAt: now, inferred: true, confirmedByMember: false });
        }
        const home = presence.find(p => p.memberId === m.id && p.type === "home");
        if (zip && home && !home.areas.includes(`zip:${zip}`)) home.areas.push(`zip:${zip}`);
        // One romance intent per member who opted in (the live want: their join, or their last "find me a date").
        if (m.prefs.romanceOptIn && m.prefs.categoriesOptIn.includes("romance") && !intents.some(i => i.memberId === m.id && i.category === "romance")) {
          intents.push({ id: `${m.id}:slop:date`, memberId: m.id, objective: "go on a date", category: "romance", horizonDays: 60, status: "active", createdAt: m.joinedAt });
        }
      }
      return { ...input, facets, presence, intents };
    },
    onboarding: slopOnboarding,
    timeOptions(o, now, input) {
      const p = plan(o, input());
      if (!p) return undefined;
      return p.slots.map(s => slotStart(s, now)).filter((t): t is number => t !== undefined).map(t => ({ start: t, end: t + 2 * HOUR }));
    },
    probe(o, id, ctx) {
      if (o.category !== "romance" || o.participants.length !== 2) return undefined;
      const input = ctx.input();
      const p = plan(o, input);
      const other = o.participants.find(x => x !== id)!;
      const age = input.members.find(m => m.id === other)?.age;
      const P = slopProfiles(input);
      // At most one fact, and only one the other person allowed us to share.
      const fact = P.get(other)?.shareableInterests.find(t => P.get(id)?.interests.includes(t)) ?? P.get(other)?.shareableInterests[0];
      const activity = ACTIVITY_PHRASE[p?.activity ?? "coffee"] ?? "coffee";
      const about = [age !== undefined && age >= 18 ? `in their ${ageBand(age)}` : undefined, p ? distancePhrase(p.distance) : undefined].filter(Boolean).join(", ");
      const text = slopProbeText({ when: ctx.times ?? ctx.when, times: !!ctx.times }, activity, fact?.replace(/_/g, " "), about || undefined);
      // The engine's rule decides whether a photo may go (adults both sides, photo consent, not held, opaque ids, at most one).
      const photos = probePhotoRefs({ age, photoConsent: SLOP_PROBE_PHOTOS, photoIds: [] }, { age: input.members.find(m => m.id === id)?.age });
      return slopProbeMessage({ text }, photos).text;
    },
    venue(o, input) {
      const inp = input();
      const P = slopProfiles(inp);
      const cells = o.participants.map(id => P.get(id)?.cell).filter((c): c is NonNullable<typeof c> => !!c);
      const p = plan(o, inp);
      return slopVenue(cells, p?.activity ?? "coffee", o.meetingAt);
    },
    booked(o, _id, ctx) {
      if (o.category !== "romance") return undefined;
      return slopBookedText(ctx.others[0]!, ctx.when, ctx.where);
    },
    checkIn(o, _id, others) {
      if (o.category !== "romance") return undefined;
      return slopCheckInText(others);
    },
    postDateReports: true,
  };
}

// ==================================================================================== peon
/**
 * peon's hooks (#9): the seat capacity (engine peonSeatCapacity), job posts by text, and the seat
 * copy. Candidate first: the candidate hears the job (title, pay range, place; never the manager's
 * name); after their yes the hiring manager gets a blind summary (must-have checkmarks, start time;
 * never a name, a score or a rank); the intro names each side only after both yeses.
 */
export function peonHooks(): AppHooks {
  const seatOf = (o: HookOpp) => o.seat;
  return {
    engineInput: peonSeatCapacity,
    postings: true,
    probe(o, id, ctx) {
      const seat = seatOf(o);
      if (!seat) return undefined;
      const input = ctx.input();
      const job = seatJob(input, seat.id);
      if (id !== seat.manager) return SEAT_COPY.candidateProbe(job);
      const cand = o.participants.find(p => p !== seat.manager)!;
      const start = input.facets.filter(f => f.memberId === cand).flatMap(f => f.tags).find(t => t.startsWith("peon:start_weeks:"));
      const weeks = start ? Number(start.slice("peon:start_weeks:".length)) : undefined;
      return SEAT_COPY.managerProbe(job, mustMarks(input, cand, job), Number.isInteger(weeks) ? weeks : undefined);
    },
    booked(o, id, ctx) {
      const seat = seatOf(o);
      if (!seat) return undefined;
      const job = { title: seat.title ?? "the role", must: [] };
      const other = ctx.others[0] ?? "them";
      return id === seat.manager ? SEAT_COPY.managerIntro(job, other) : SEAT_COPY.candidateIntro(job, other);
    },
    checkIn(o, _id, others) {
      const seat = seatOf(o);
      return seat ? SEAT_COPY.checkIn({ title: seat.title ?? "the role", must: [] }, others) : undefined;
    },
  };
}
