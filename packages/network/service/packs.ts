// The engine pack of each app, wired into its ConsentNetwork (AGENTS.md founder decision 5; the pack
// results: docs/results/2026-10-08-slop-pack.md section 9, -peon-pack.md, -friends-pack.md).
//   ntwrk    networkPack (the engine default): nothing changes.
//   slop     makeSlopPack({ verification: { required: false } }) (founder decision 9) with SLOP_ENGINE_CONFIG on nyc, and the
//            slop hooks below: verified adults only, the hard-field asks in one message (each asked at
//            most twice by the pack), answers parsed into the pack's tags, the anonymous date probe
//            with an age band and a distance band (and, with SLOP_PROBE_PHOTO=1 only, one approved photo
//            of the other person, checked again at send time), a public place near the midpoint, the booked
//            date with the share-my-date tip, the check-in that can file a report, and the dating
//            onboarding (slopOnboarding.ts) that collects the hard fields while matching is off.
//   peon     peonPack with PEON_ENGINE_CONFIG on nyc.
//   friends  friendsPack with its plans config (FRIENDS_PLANS).
// Every pack stays behind the Network's human review gate. Matching is off until an admin turns it on
// (the stored switch starts off; platform.networks.matching_enabled only allows the switch). Minors
// never enter a pack's input (ConsentNetwork.packInput). Nothing here reads hidden truth.
import { DAY, HOUR, type Facet, type MemberId } from "@thenetwork/core";
import {
  friendsPack, FRIENDS_PLANS, makeSlopPack, peonPack, PEON_ENGINE_CONFIG, planFromInput, SLOP_ENGINE_CONFIG, slopProfiles,
  type AppPack, type EngineConfigInput, type EngineInput, type PlansConfigInput,
} from "@thenetwork/engine";
import { ageBand } from "@thenetwork/engine/src/packs/slop/copy.ts";
import { ZIPS } from "@thenetwork/engine/src/packs/slop/zips.ts";
import type { AppHooks, AppTag, HookOpp, HookVenue } from "../src/apphooks.ts";
import { km, NEIGHBORHOOD, VENUES } from "../src/geo.ts";
import { nextAt } from "../src/outreach.ts";
import { parseAgeRange, parseBasics, parseDistance, parseOrientation, parseZip, words } from "./slopParse.ts";
import { slopOnboarding } from "./slopOnboarding.ts";
import { eveningVenues } from "./venues-nyc.ts";
import { brandOf, copyFor } from "../src/copy.ts";
import { APPS, REVIEW_SLA_HOURS, type AppId } from "../../platform/src/apps.ts";

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
  /** The app's review SLA in hours (platform REVIEW_SLA_HOURS, the console's numbers too): an item waiting longer expires unsent. */
  reviewSlaHours: number;
  /** The launch gate's "committed adult" (PRD 37.3): the app's hard fields are known. Default: any active adult. */
  committed?(tags: readonly string[], area: string | undefined): boolean;
}

const NTWRK_CATEGORIES = ["social", "hobby", "professional", "events", "growth", "help"];

/** The wiring for one app. A new instance each time (packs hold no state, but options are per network). `env`: SLOP_PROBE_PHOTO. */
export function appWiring(app: AppId, env: Record<string, string | undefined> = process.env): AppWiring {
  const reviewSlaHours = REVIEW_SLA_HOURS[app] ?? 12;
  switch (app) {
    case "slop": {
      // Founder decision 9: no ID check (phone login is the identity check; a stated age is enough).
      const pack = makeSlopPack({ verification: { required: false } });
      return {
        pack, engine: { ...SLOP_ENGINE_CONFIG, cities: ["nyc"] }, hooks: slopHooks(pack.options, { probePhoto: env.SLOP_PROBE_PHOTO === "1" }), plans: false, reviewSlaHours,
        // Dating only, and only for adults: a member under 18 never opts in to romance (core invariant 1).
        prefs: age => ({ categoriesOptIn: age >= 18 ? ["romance"] : [], romanceOptIn: age >= 18 }),
        // Orientation (who they are and who they seek), an age range, a distance, and a zip or a neighborhood.
        committed: (tags, area) => ["romance:is:", "romance:seeks:", "romance:age:", "slop:max_miles:"].every(p => tags.some(t => t.startsWith(p)))
          && (tags.some(t => t.startsWith("slop:zip:")) || (!!area && NEIGHBORHOOD.has(area))),
      };
    }
    case "peon":
      return { pack: peonPack, engine: { ...PEON_ENGINE_CONFIG, cities: ["nyc"] }, plans: false, reviewSlaHours, prefs: () => ({ categoriesOptIn: ["professional"], romanceOptIn: false }) };
    case "friends":
      return { pack: friendsPack, plansConfig: FRIENDS_PLANS, reviewSlaHours, prefs: () => ({ categoriesOptIn: ["social", "hobby"], romanceOptIn: false }) };
    default:
      return { reviewSlaHours, prefs: () => ({ categoriesOptIn: NTWRK_CATEGORIES, romanceOptIn: false }) };
  }
}

// ==================================================================================== slop
// The parsers live in slopParse.ts (scored by evals/slop/); re-exported here for older imports.
export { parseAgeRange, parseBasics, parseDistance, parseOrientation, parseZip } from "./slopParse.ts";
const NYC_ZIPS = ZIPS.filter(z => z.market === "nyc");
const ZIP_BY = new Map(ZIPS.map(z => [z.zip, z]));
/** The nearest zip in the pack's table to a neighborhood the member named (a coarse cell, never an address). */
export function zipForArea(area: string | undefined): string | undefined {
  const n = area ? NEIGHBORHOOD.get(area) : undefined;
  if (!n) return undefined;
  let best: { zip: string; d: number } | undefined;
  for (const z of NYC_ZIPS) { const d = km(n, { lat: z.lat, lng: z.lon }); if (!best || d < best.d) best = { zip: z.zip, d }; }
  return best?.zip;
}

const tag = (t: string, kind: Facet["kind"], at: number): AppTag => ({ tag: t, kind, scope: "agent_private", at });

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
 * Places for a date after dark: indoor and open in the evening (venues-nyc.ts). Parks, plazas,
 * waterfronts and the open-air greenmarkets (geo.ts) are for daytime dates only.
 */
const EVENING_VENUES: HookVenue[] = eveningVenues().map(v => ({ id: v.id, name: v.name, neighborhood: v.neighborhood, lat: v.lat, lng: v.lon }));
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

/** The slop hooks (exported for tests). `probePhoto`: SLOP_PROBE_PHOTO=1 (off by default; PRD 37.2 P5 decides the arm). */
export function slopHooks(options: Parameters<typeof planFromInput>[4], flags: { probePhoto?: boolean } = {}): AppHooks {
  const probePhotoOn = flags.probePhoto === true;
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
    askText(reasons) {
      const hard = reasons.filter(r => ["slop_orientation", "slop_age_range", "slop_distance"].includes(r));
      if (hard.length < 2) return undefined;
      const parts: string[] = [];
      if (hard.includes("slop_orientation")) parts.push("who you're hoping to meet (women, men, nonbinary people, or a mix) and how you describe yourself");
      if (hard.includes("slop_age_range")) parts.push("what age range feels right");
      if (hard.includes("slop_distance")) parts.push("how far you'd go for a first date (just your city, or within 2, 5, 10 or 25 miles of your zip, and your zip)");
      return `Before I suggest anyone, a few quick ones: ${parts.join("; ")}.`;
    },
    learn(body, reasons, { now, age: statedAge }) {
      const tags: AppTag[] = [];
      const replaces: string[] = [];
      const asked = (r: string) => reasons.includes(r);
      const o = parseOrientation(body, asked("slop_orientation"));
      if (o.is) { tags.push(tag(`romance:is:${o.is}`, "preference", now)); replaces.push("romance:is:"); }
      if (o.seeks?.length) { for (const g of o.seeks) tags.push(tag(`romance:seeks:${g}`, "preference", now)); replaces.push("romance:seeks:"); }
      const age = parseAgeRange(body, asked("slop_age_range"), statedAge);
      if (age) { tags.push(tag(`romance:age:${age[0]}-${age[1]}`, "preference", now)); replaces.push("romance:age:"); }
      const d = parseDistance(body, asked("slop_distance"));
      const widen = asked("slop_widen") && /\b(yes|yeah|yep|sure|ok|okay|fine|why not)\b/.test(words(body));
      if (d?.miles !== undefined || widen) {
        const n = d?.miles ?? 25;
        tags.push(tag(`slop:scope:radius:${n}`, "preference", now), tag(`slop:max_miles:${n}`, "preference", now));
        replaces.push("slop:scope:", "slop:max_miles:");
      } else if (d?.city) {
        // "Just the city": the whole of New York, which the pack reads as 25 miles.
        tags.push(tag("slop:scope:city", "preference", now), tag("slop:max_miles:25", "preference", now));
        replaces.push("slop:scope:", "slop:max_miles:");
      }
      const zip = parseZip(body);
      if (zip && ZIP_BY.has(zip)) { tags.push(tag(`slop:zip:${zip}`, "fact", now)); replaces.push("slop:zip:"); }
      if (asked("slop_basics")) {
        const b = parseBasics(body);
        if (b.goal) { tags.push(tag(`slop:goal:${b.goal}`, "goal", now)); replaces.push("slop:goal:"); }
        for (const x of b.dealbreakers) tags.push(tag(`slop:dealbreaker:${x}`, "boundary", now));
      }
      return { tags, replaces };
    },
    learnUnderstood(u, parsed, { now }) {
      // Only fields the offline parser read nothing for in this message, tagged as the LLM's reading.
      const tags: AppTag[] = [];
      const replaces: string[] = [];
      const llm = (t: string, kind: Facet["kind"]): AppTag => ({ ...tag(t, kind, now), provenance: "llm" });
      const had = (prefix: string) => parsed.some(t => t.tag.startsWith(prefix));
      const field = (prefix: string, add: AppTag[]) => { if (!add.length || had(prefix)) return; tags.push(...add); replaces.push(prefix); };
      if (u.is) field("romance:is:", [llm(`romance:is:${u.is}`, "preference")]);
      if (u.seeks?.length) field("romance:seeks:", u.seeks.map(g => llm(`romance:seeks:${g}`, "preference")));
      if (u.ageRange) field("romance:age:", [llm(`romance:age:${u.ageRange[0]}-${u.ageRange[1]}`, "preference")]);
      if (!had("slop:scope:") && !had("slop:max_miles:")) {
        const n = u.radiusMiles ?? (u.cityWide ? 25 : undefined);
        if (n !== undefined) {
          tags.push(llm(u.radiusMiles !== undefined ? `slop:scope:radius:${n}` : "slop:scope:city", "preference"), llm(`slop:max_miles:${n}`, "preference"));
          replaces.push("slop:scope:", "slop:max_miles:");
        }
      }
      if (u.zip && ZIP_BY.has(u.zip)) field("slop:zip:", [llm(`slop:zip:${u.zip}`, "fact")]);
      if (u.goal) field("slop:goal:", [llm(`slop:goal:${u.goal}`, "goal")]);
      if (!had("slop:dealbreaker:")) for (const x of u.dealbreakers ?? []) tags.push(llm(`slop:dealbreaker:${x}`, "boundary"));
      return { tags, replaces };
    },
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
      const when = ctx.times ? `${ctx.times}` : ctx.when;
      const about = [age !== undefined && age >= 18 ? `in their ${ageBand(age)}` : undefined, p ? `${p.distance.startsWith("under") ? p.distance : `about ${p.distance}`} away` : undefined].filter(Boolean).join(", ");
      const facts = [about ? `They're ${about}.` : "", fact ? `They're into ${fact.replace(/_/g, " ")}.` : ""].filter(Boolean).join(" ");
      return `There's someone I think you might like to go on a date with: ${activity}, ${when}. ${facts}${facts ? " " : ""}Want me to check if they're up for it? I'll only tell you who it is if you both say yes.${ctx.times ? " Tell me which time works, or no." : ""}`;
    },
    probePhoto(o, id, ctx) {
      // Off unless the flag is on. One photo of the other person, both adults in the pack's input
      // (minors never are); the service checks both people, the photo and the caption again at send time.
      if (!probePhotoOn) return undefined;
      if (o.category !== "romance" || o.participants.length !== 2) return undefined;
      const other = o.participants.find(x => x !== id);
      const ages = ctx.input().members.filter(m => m.id === id || m.id === other).map(m => m.age);
      return other && ages.length === 2 && ages.every(a => a >= 18) ? other : undefined;
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
      return `You're both in: a first date with ${ctx.others[0]}, ${ctx.when}. Meet at ${ctx.where}, a public place. Reply if you can't make it. Tip: forward this text to a friend so someone knows where you'll be. I'll check in after to see how it went.`;
    },
    checkIn(o, _id, others) {
      if (o.category !== "romance") return undefined;
      // "Would you see them again?": a yes from both becomes a second-date proposal (human review first).
      return `How did your date with ${others} go, and would you see them again? If anything felt wrong (they were rude, didn't show, or weren't who they said), tell me and I'll pass it to our safety team. If you ever feel unsafe, call 911 first.`;
    },
    postDateReports: true,
    // The dating onboarding: the hard fields before matching is on (slopOnboarding.ts).
    onboarding: slopOnboarding(copyFor(brandOf(APPS.slop)), APPS.slop.domain),
  };
}
