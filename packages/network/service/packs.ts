// The engine pack of each app, wired into its ConsentNetwork (AGENTS.md founder decision 5; the pack
// results: docs/results/2026-10-08-slop-pack.md section 9, -peon-pack.md, -friends-pack.md).
//   ntwrk    networkPack (the engine default): nothing changes.
//   slop     makeSlopPack({ verification: { required: false } }) (founder decision 9) with SLOP_ENGINE_CONFIG on nyc, and the
//            slop hooks below: verified adults only, the hard-field asks in one message (each asked at
//            most twice by the pack), answers parsed into the pack's tags, the anonymous date probe
//            with an age band and a distance band, a public place near the midpoint, the booked
//            date with the share-my-date tip, and the check-in that can file a report.
//   peon     peonPack with PEON_ENGINE_CONFIG on nyc. Each open job posting is a job seat (snapshot.ts,
//            engine peonSeats), and the hook below keeps the seat's capacity: openings minus the
//            candidates who took one or are in flight (engine peonSeatCapacity), so a seat is never
//            over-filled and a filled or closed posting gets no new match. Local only: peon matching
//            and sends are not enabled in production (AGENTS.md decision 4).
//   friends  friendsPack with its plans config (FRIENDS_PLANS).
// Every pack stays behind the Network's human review gate. Matching is off until an admin turns it on
// (the stored switch starts off; platform.networks.matching_enabled only allows the switch). Minors
// never enter a pack's input (ConsentNetwork.packInput). Nothing here reads hidden truth.
import { DAY, HOUR, type Facet, type MemberId } from "@thenetwork/core";
import {
  friendsPack, FRIENDS_PLANS, makeSlopPack, peonPack, PEON_ENGINE_CONFIG, peonSeatCapacity, planFromInput, SLOP_ENGINE_CONFIG, slopProfiles,
  type AppPack, type EngineConfigInput, type EngineInput, type PlansConfigInput,
} from "@thenetwork/engine";
import { ageBand } from "@thenetwork/engine/src/packs/slop/copy.ts";
import { ZIPS } from "@thenetwork/engine/src/packs/slop/zips.ts";
import type { AppHooks, AppTag, HookOpp, HookVenue } from "../src/apphooks.ts";
import { km, NEIGHBORHOOD, VENUES } from "../src/geo.ts";
import { nextAt } from "../src/outreach.ts";
import type { AppId } from "../../platform/src/apps.ts";

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
        pack: peonPack, engine: { ...PEON_ENGINE_CONFIG, cities: ["nyc"] }, plans: false, hooks: { engineInput: peonSeatCapacity },
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
const ZIP_BY = new Map(ZIPS.map(z => [z.zip, z]));
const GENDERS = ["woman", "man", "nonbinary"] as const;
type Gender = (typeof GENDERS)[number];

/** The nearest zip in the pack's table to a neighborhood the member named (a coarse cell, never an address). */
export function zipForArea(area: string | undefined): string | undefined {
  const n = area ? NEIGHBORHOOD.get(area) : undefined;
  if (!n) return undefined;
  let best: { zip: string; d: number } | undefined;
  for (const z of NYC_ZIPS) { const d = km(n, { lat: z.lat, lng: z.lon }); if (!best || d < best.d) best = { zip: z.zip, d }; }
  return best?.zip;
}

const tag = (t: string, kind: Facet["kind"], at: number): AppTag => ({ tag: t, kind, scope: "agent_private", at });
const words = (s: string) => ` ${s.normalize("NFKC").toLowerCase().replace(/[‘’]/g, "'").replace(/[^\p{L}\p{N}' -]+/gu, " ").replace(/\s+/g, " ")} `;

/** "woman", "a guy", "nb" ... -> the pack's gender id. */
function genderOf(w: string): Gender | undefined {
  if (/^(woman|women|girl|girls|female|females|lady|ladies|gal|gals|she|her)$/.test(w)) return "woman";
  if (/^(man|men|guy|guys|male|males|dude|dudes|boy|boys|he|him)$/.test(w)) return "man";
  if (/^(nonbinary|non-binary|nb|enby|enbies|genderqueer|they)$/.test(w)) return "nonbinary";
  return undefined;
}

/**
 * Who the member is and who they seek, from their words. A label ("straight woman", "gay man",
 * "lesbian", "bi guy", "queer") gives both; "I'm a woman looking for men" gives both; "a mix",
 * "anyone" or "everyone" seeks all three. Nothing is guessed when the words do not say it.
 */
export function parseOrientation(text: string, bare = false): { is?: Gender; seeks?: Gender[] } {
  const t = words(text);
  const out: { is?: Gender; seeks?: Gender[] } = {};
  const self = /\b(?:i'm|im|i am|as|me) (?:a |an )?(?:(straight|gay|lesbian|bi|bisexual|pan|pansexual|queer|trans) )?(woman|man|guy|girl|gal|dude|female|male|nonbinary|non-binary|nb|enby|lady)\b/.exec(t)
    ?? /^ (?:(straight|gay|lesbian|bi|bisexual|pan|pansexual|queer|trans) )?(woman|man|guy|girl|female|male|nonbinary|non-binary|nb|enby|lady)\b/.exec(t);
  if (self) out.is = genderOf(self[2]!);
  const label = self?.[1] ?? /\b(straight|gay|lesbian|bisexual|bi|pansexual|pan|queer)\b/.exec(t)?.[1];
  const all: Gender[] = ["man", "nonbinary", "woman"];
  const seekRe = /\b(?:looking for|into|seeking|interested in|date|dating|meet|meeting|like|prefer|want)\s+(?:a |an |only |just |mostly )?((?:(?:women|woman|men|man|guys|guy|girls|girl|ladies|lady|dudes|nonbinary|non-binary|nb|enbies|people|folks|everyone|anyone|all|both|either|any gender|all genders)(?:,| and| or| &| plus)?\s*)+)/g;
  const seeks = new Set<Gender>();
  for (const m of t.matchAll(seekRe)) {
    for (const w of m[1]!.split(/[ ,&]+/)) { const g = genderOf(w); if (g) seeks.add(g); }
    if (/\b(everyone|anyone|all|any gender|all genders|either|both)\b/.test(m[1]!)) {
      if (/\b(both)\b/.test(m[1]!)) { seeks.add("man"); seeks.add("woman"); } else all.forEach(g => seeks.add(g));
    }
  }
  if (/\b(a mix|open to (everyone|anyone|all)|all genders|any gender)\b/.test(t)) all.forEach(g => seeks.add(g));
  if (!seeks.size && label && out.is) {
    if (label === "straight") seeks.add(out.is === "woman" ? "man" : out.is === "man" ? "woman" : "man");
    else if (label === "gay" || label === "lesbian") seeks.add(out.is);
    else if (label === "bi" || label === "bisexual") { seeks.add("man"); seeks.add("woman"); }
    else if (label === "pan" || label === "pansexual" || label === "queer") all.forEach(g => seeks.add(g));
  }
  if (!seeks.size && label === "lesbian") { out.is ??= "woman"; seeks.add("woman"); }
  // A bare answer to "who are you hoping to meet?": plural words name who they seek ("women", "men and nonbinary people", "anyone").
  if (!seeks.size && bare) {
    const rest = t.replace(/\b(?:i'm|im|i am|as|me) (?:a |an )?\S+/, " ");
    for (const w of rest.split(" ")) {
      if (/^(women|girls|ladies|gals)$/.test(w)) seeks.add("woman");
      else if (/^(men|guys|dudes|boys)$/.test(w)) seeks.add("man");
      else if (/^(enbies|nonbinary|non-binary)$/.test(w) && /\b(nonbinary|non-binary) (people|folks)\b|enbies/.test(rest)) seeks.add("nonbinary");
      else if (/^(anyone|everyone|either|all)$/.test(w)) all.forEach(g => seeks.add(g));
    }
  }
  if (seeks.size) out.seeks = [...seeks].sort();
  return out;
}

/** "25-35", "25 to 35", "between 25 and 35", "30s" (bare answer only) -> [lo, hi], with lo >= 18. */
export function parseAgeRange(text: string, bare: boolean): [number, number] | undefined {
  const t = words(text);
  const m = /\b(\d{2})\s*(?:-|to|and|through|thru|–)\s*(\d{2})\b/.exec(t);
  if (m) {
    const lo = Number(m[1]), hi = Number(m[2]);
    if (lo >= 18 && hi >= lo && hi <= 99) return [lo, hi];
    if (hi >= 18 && hi >= lo && lo < 18) return [18, hi]; // never under 18
    return undefined;
  }
  if (!bare) return undefined;
  const d = /\b(?:my |their |late |early |mid )?(20|30|40|50|60)s\b/.exec(t);
  if (d) { const lo = Number(d[1]); return [Math.max(18, lo), lo + 9]; }
  return undefined;
}

/** "just the city", "within 5 miles", "10mi", "5" (a bare answer) -> the scope and limit tags. */
export function parseDistance(text: string, bare: boolean): { miles?: number; city?: boolean } | undefined {
  const t = words(text);
  const m = /\b(\d{1,3})\s*(?:mi|mile|miles)\b/.exec(t) ?? (bare ? /^ (?:within |about |around |up to )?(\d{1,3}) $/.exec(t) : null);
  if (m) { const n = Number(m[1]); return n > 0 && n <= 200 ? { miles: n } : undefined; }
  if (/\b(just|only|anywhere in) (my|the) city\b|\b(the )?(whole|entire) city\b|\bcity( wide|wide)?\b|\ball (of )?(nyc|new york)\b|\banywhere in (nyc|new york)\b/.test(t)) return { city: true };
  return undefined;
}

/** A 5-digit zip the member gave. */
export const parseZip = (text: string): string | undefined => /(?:^|\D)(\d{5})(?:\D|$)/.exec(text)?.[1];

/** The basics: what they are looking for right now, and a few stated dealbreakers. Unknown stays unknown. */
export function parseBasics(text: string): { goal?: "casual" | "long_term" | "unsure"; dealbreakers: string[] } {
  const t = words(text);
  const goal = /\b(not sure|unsure|don't know|dont know|open to (either|both|anything)|see where it goes)\b/.test(t) ? "unsure"
    : /\b(long[- ]term|serious|relationship|something (real|longer|lasting)|marriage|settle down|partner)\b/.test(t) ? "long_term"
    : /\b(casual|nothing serious|fun|hookups?|keep it light)\b/.test(t) ? "casual" : undefined;
  const dealbreakers: string[] = [];
  if (/\b(no smok(ers|ing)|smok(ers|ing) (is|are) a dealbreaker|can't (date|stand) smokers|non[- ]?smokers? only)\b/.test(t)) dealbreakers.push("smoker");
  if (/\b(no (heavy )?drinkers|sober|heavy drink(ers|ing) (is|are) a dealbreaker)\b/.test(t)) dealbreakers.push("heavy_drinker");
  if (/\b(no kids ever|never want kids|don't want kids|dont want kids|childfree|child-free)\b/.test(t)) dealbreakers.push("wants_kids");
  if (/\b(want(s)? kids|want(ing)? children)\b/.test(t) && !dealbreakers.includes("wants_kids")) dealbreakers.push("no_kids_ever");
  return { ...(goal ? { goal } : {}), dealbreakers };
}

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
    askText(reasons) {
      const hard = reasons.filter(r => ["slop_orientation", "slop_age_range", "slop_distance"].includes(r));
      if (hard.length < 2) return undefined;
      const parts: string[] = [];
      if (hard.includes("slop_orientation")) parts.push("who you're hoping to meet (women, men, nonbinary people, or a mix) and how you describe yourself");
      if (hard.includes("slop_age_range")) parts.push("what age range feels right");
      if (hard.includes("slop_distance")) parts.push("how far you'd go for a first date (just your city, or within 2, 5, 10 or 25 miles of your zip, and your zip)");
      return `Before I suggest anyone, a few quick ones: ${parts.join("; ")}.`;
    },
    learn(body, reasons, { now }) {
      const tags: AppTag[] = [];
      const replaces: string[] = [];
      const asked = (r: string) => reasons.includes(r);
      const o = parseOrientation(body, asked("slop_orientation"));
      if (o.is) { tags.push(tag(`romance:is:${o.is}`, "preference", now)); replaces.push("romance:is:"); }
      if (o.seeks?.length) { for (const g of o.seeks) tags.push(tag(`romance:seeks:${g}`, "preference", now)); replaces.push("romance:seeks:"); }
      const age = parseAgeRange(body, asked("slop_age_range"));
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
      return `How did your date with ${others} go? If anything felt wrong (they were rude, didn't show, or weren't who they said), tell me and I'll pass it to our safety team. If you ever feel unsafe, call 911 first.`;
    },
    postDateReports: true,
  };
}
