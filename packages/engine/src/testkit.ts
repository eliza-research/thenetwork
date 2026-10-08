// Small seeded random-world generator for engine tests and the benchmark. Deliberately
// independent of packages/sim: it only needs to produce varied, adversarial-enough inputs
// (canary facets, aliases, blocks, holds, minors, travel, cooldowns, history) to exercise every
// hard constraint.
import type { Category, City, Edge, Facet, Intent, Member, Preferences, Presence, Proposal } from "@thenetwork/core";
import { DAY, HOUR } from "@thenetwork/core";
import { Rng } from "./rng.ts";
import type { EngineInput, FeedbackRecord, InteractionRecord, NetworkEvent, SafetyHold } from "./types.ts";

interface Theme {
  tag: string; category: Category;
  interests: string[]; skills: string[]; offers: string[];
  intents: [string, Category][]; events: string[];
}
export const THEMES: Theme[] = [
  { tag: "music", category: "hobby", interests: ["live music and indie rock shows", "jazz bars and vinyl"], skills: ["plays guitar in a rock band", "plays drums", "sings and writes songs"], offers: ["happy to jam with newer musicians"], intents: [["start a rock band with a guitarist and a drummer", "hobby"], ["find people to jam music with on weekends", "hobby"]], events: ["Indie rock night", "Open mic music jam"] },
  { tag: "climbing", category: "hobby", interests: ["bouldering and rock climbing"], skills: ["experienced climbing route setter"], offers: ["teaches beginners to boulder and climb"], intents: [["find a climbing partner for weekday bouldering", "hobby"], ["learn to climb outdoors", "hobby"]], events: ["Bouldering social at the climbing gym"] },
  { tag: "tennis", category: "hobby", interests: ["playing tennis on weekends"], skills: ["former college tennis player"], offers: ["happy to hit tennis balls with beginners"], intents: [["find a weekend tennis partner nearby", "hobby"], ["play doubles tennis with a group", "hobby"]], events: ["Doubles tennis mixer"] },
  { tag: "film", category: "social", interests: ["independent film and cinema", "film photography and movies"], skills: ["works as a film editor"], offers: ["hosts small film screenings"], intents: [["find friends to watch independent film with", "social"]], events: ["Indie film screening and discussion"] },
  { tag: "ceramics", category: "hobby", interests: ["pottery and ceramics"], skills: ["ceramics teacher with a wheel studio"], offers: ["teaches pottery wheel basics"], intents: [["make things with my hands like pottery", "hobby"]], events: ["Ceramics open studio night"] },
  { tag: "climate", category: "professional", interests: ["climate tech and clean energy"], skills: ["founded a climate tech startup", "grid energy storage engineer"], offers: ["advises early climate founders"], intents: [["meet climate tech founders", "professional"], ["find a cofounder for a clean energy startup", "professional"]], events: ["Climate tech founder demo night"] },
  { tag: "design", category: "professional", interests: ["product design and typography"], skills: ["senior product designer", "brand and typography designer"], offers: ["gives design portfolio feedback"], intents: [["hire a product designer for my startup", "professional"], ["get feedback on my design portfolio", "professional"]], events: ["Design critique meetup"] },
  { tag: "cooking", category: "social", interests: ["cooking dinners and trying new restaurants"], skills: ["trained pastry chef"], offers: ["hosts dinner parties and cooks for friends"], intents: [["find people for a supper club dinner group", "social"]], events: ["Night market food crawl"] },
  { tag: "sailing", category: "hobby", interests: ["sailing on the bay"], skills: ["certified sailing instructor"], offers: ["teaches sailing to beginners"], intents: [["learn sailing this season", "hobby"]], events: ["Beginner sailing afternoon"] },
  { tag: "running", category: "hobby", interests: ["running trails and marathons"], skills: ["marathon running coach"], offers: ["leads easy morning running groups"], intents: [["find a running buddy for morning runs", "hobby"]], events: ["Saturday running club 10k"] },
  { tag: "boardgames", category: "social", interests: ["board games and strategy games"], skills: ["designs tabletop board games"], offers: ["hosts board game nights"], intents: [["start a board game night group", "social"]], events: ["Board game cafe night"] },
  { tag: "ai", category: "professional", interests: ["machine learning and AI research"], skills: ["machine learning engineer", "AI researcher working on language models"], offers: ["mentors people breaking into AI"], intents: [["find a cofounder for an AI startup", "professional"], ["meet people working on AI agents", "professional"]], events: ["AI agents hack night"] },
];
const HELP_INTENTS: [string, string][] = [
  ["need two people to help move a couch Saturday", "moving"],
  ["practice interview feedback for a design role", "career"],
  ["feedback on my startup pitch deck", "startups"],
];
const HELP_OFFERS: [string, string][] = [
  ["happy to help friends move furniture, strong and has a truck", "moving"],
  ["gives mock interview practice and career feedback", "career"],
  ["reviews startup pitch decks and fundraising stories", "startups"],
];
const AREAS: Record<City, string[]> = {
  sf: ["mission", "soma", "noe", "richmond", "sunset", "dogpatch"],
  nyc: ["williamsburg", "bushwick", "les", "harlem", "astoria", "park-slope"],
  la: [], // the testkit generates sf / nyc members only
};
const NAMES = ["Maya", "Theo", "Ava", "Leo", "Iris", "Noah", "Zoe", "Eli", "Nina", "Omar", "Ruby", "Sam", "Tara", "Jon", "Lena", "Max", "Ivy", "Ben", "Cleo", "Dev"];
const CATS: Category[] = ["social", "professional", "romance", "hobby", "help", "events", "growth"];

export interface WorldOptions {
  members?: number; seed?: number; now?: number;
  /** Turn on adversarial / edge-case features (all on by default). */
  minors?: boolean; aliases?: boolean; canaries?: boolean;
  /**
   * Share of members under 18 (ages 13-17). Default 0.03 at ages 16-17 (legacy). Minors get the
   * same facets, intents, edges, host tags, invites and history as adults, so every generator
   * sees them as attractive candidates and the minors policy has to actively exclude them.
   */
  minorShare?: number;
}

export function randomWorld(opts: WorldOptions = {}): EngineInput {
  const n = opts.members ?? 60;
  const rng = new Rng(opts.seed ?? 42);
  const now = opts.now ?? Date.UTC(2026, 9, 5, 16);
  const members: Member[] = [], facets: Facet[] = [], intents: Intent[] = [], presence: Presence[] = [], edges: Edge[] = [];
  const idAliases: Record<string, string> = {};
  const safetyHolds: SafetyHold[] = [], feedback: FeedbackRecord[] = [], interactions: InteractionRecord[] = [];
  const recentProposals: Proposal[] = [];
  const reliability: Record<string, { noShows: number; completedSinceLastNoShow: number }> = {};
  const themesOf = new Map<string, Theme[]>();
  const aliasOf = (id: string) => (opts.aliases !== false && idAliases[`phone:${id}`] ? `phone:${id}` : id);

  for (let i = 0; i < n; i++) {
    const id = `m${String(i).padStart(4, "0")}`;
    const city: City = rng.chance(0.6) ? "sf" : "nyc";
    const r = rng.next();
    const state = r < 0.15 ? "open" : r < 0.7 ? "normal" : r < 0.82 ? "quiet" : r < 0.9 ? "receiving" : "paused";
    const romanceOptIn = rng.chance(0.3);
    const cats = CATS.filter(c => c === "romance" ? romanceOptIn : rng.chance(0.85));
    const formats = (["one_to_one", "small_group", "event"] as const).filter(() => rng.chance(0.75));
    const joinedDaysAgo = rng.chance(0.12) ? rng.int(14) : 14 + rng.int(200);
    const age = opts.minors !== false && rng.chance(opts.minorShare ?? 0.03)
      ? (opts.minorShare === undefined ? 16 + rng.int(2) : 13 + rng.int(5))
      : 19 + rng.int(45);
    members.push({
      id, name: `${rng.pick(NAMES)}${i}`, homeCity: city, state,
      prefs: {
        categoriesOptIn: cats, quietHours: rng.pick([[22, 8], [23, 7], [21, 9]] as [number, number][]), romanceOptIn,
        formats: formats.length ? [...formats] : ["one_to_one"], maxTravelMinutes: rng.pick([15, 30, 45, 60]),
        onlyWhenAsked: rng.chance(0.05),
      },
      invitedBy: i > 0 && rng.chance(0.8) ? `m${String(rng.int(i)).padStart(4, "0")}` : undefined,
      joinedAt: now - joinedDaysAgo * DAY - rng.int(20) * HOUR, age,
      unansweredProactive: rng.chance(0.05) ? 2 : rng.int(2),
    });
    if (opts.aliases !== false && rng.chance(0.25)) idAliases[`phone:${id}`] = id;
    // Presence: home, sometimes a second home city, sometimes temporary travel.
    presence.push({ memberId: aliasOf(id), city, type: "home", areas: [rng.pick(AREAS[city])] });
    const other: City = city === "sf" ? "nyc" : "sf";
    if (rng.chance(0.08)) presence.push({ memberId: id, city: other, type: "home", areas: [rng.pick(AREAS[other])] });
    if (rng.chance(0.15)) {
      const from = now + rng.int(5) * DAY;
      presence.push({ memberId: id, city: other, type: "temporary", areas: [rng.pick(AREAS[other])], from, to: from + (1 + rng.int(4)) * DAY });
    }
    // Facets from 1-2 themes.
    const ts = rng.sample(THEMES, rng.chance(0.6) ? 2 : 1);
    themesOf.set(id, ts);
    let fi = 0;
    const addF = (kind: Facet["kind"], value: string, tags: string[], scope: Facet["scope"], prov: Facet["provenance"] = "said") =>
      facets.push({ id: `${id}-f${fi++}`, memberId: rng.chance(0.1) ? aliasOf(id) : id, kind, value, tags, scope, provenance: prov, confidence: 0.5 + rng.next() * 0.5 });
    for (const t of ts) {
      addF("interest", rng.pick(t.interests), [t.tag], rng.chance(0.85) ? "shareable" : "matchable");
      if (rng.chance(0.55)) addF("skill", rng.pick(t.skills), [t.tag], rng.chance(0.8) ? "shareable" : "matchable", rng.chance(0.2) ? "inferred" : "said");
      if (rng.chance(0.35)) addF("offer", rng.pick(t.offers), [t.tag, ...(t.offers[0]!.includes("host") ? ["host"] : [])], "shareable");
    }
    if (rng.chance(0.12)) addF("offer", "loves hosting gatherings and dinners", ["host"], "shareable");
    if (rng.chance(0.25)) { const [v, tag] = rng.pick(HELP_OFFERS); addF("offer", v, [tag], "shareable"); }
    if (rng.chance(0.2)) { const t = rng.pick(THEMES); addF("desire", `I miss ${rng.pick(t.interests)}`, [t.tag], "shareable"); }
    if (opts.canaries !== false && rng.chance(0.4)) addF("fact", `zq canary ${id} private disclosure about health`, ["private"], "agent_private");
    if (opts.canaries !== false && rng.chance(0.3)) addF("desire", `matchcanary ${id} wants more low pressure local contact`, [ts[0]!.tag], "matchable");
    if (rng.chance(0.05)) addF("boundary", "no smokers", ["dealbreaker:smoking"], "matchable");
    if (rng.chance(0.06)) addF("trait", "smokes socially", ["smoking"], "matchable");
    if (romanceOptIn) {
      const is = rng.pick(["a", "b"]); const seeks = rng.chance(0.7) ? rng.pick(["a", "b"]) : undefined;
      const lo = Math.max(18, age - 8), hi = age + 8;
      addF("preference", "romance preferences", ["romance:is:" + is, ...(seeks ? ["romance:seeks:" + seeks] : []), `romance:age:${lo}-${hi}`], "agent_private");
    }
    // Intents.
    const ni = rng.chance(0.5) ? 1 : rng.chance(0.4) ? 2 : 0;
    for (let k = 0; k < ni; k++) {
      const t = rng.pick(ts);
      const [obj, cat] = rng.pick(t.intents);
      intents.push({ id: `${id}-i${k}`, memberId: rng.chance(0.1) ? aliasOf(id) : id, objective: obj, category: cat, horizonDays: 60, status: rng.chance(0.9) ? "active" : "paused", createdAt: now - rng.int(25) * DAY });
    }
    if (rng.chance(0.1)) { const [obj] = rng.pick(HELP_INTENTS); intents.push({ id: `${id}-h`, memberId: id, objective: obj, category: "help", horizonDays: 30, status: "active", createdAt: now - rng.int(5) * DAY }); }
    if (romanceOptIn && rng.chance(0.5)) intents.push({ id: `${id}-r`, memberId: id, objective: `open to dating someone who loves ${ts[0]!.interests[0]}`, category: "romance", horizonDays: 90, status: "active", createdAt: now - rng.int(20) * DAY });
    if (rng.chance(0.03)) intents.push({ id: `${id}-x`, memberId: id, objective: "need someone for childcare babysitting my kids", category: "help", horizonDays: 30, status: "active", createdAt: now - DAY });
    if (rng.chance(0.03)) safetyHolds.push({ memberId: aliasOf(id), from: now - DAY, reason: "report under review" });
    if (rng.chance(0.03)) reliability[id] = { noShows: 2, completedSinceLastNoShow: 0 };
  }
  const ids = members.map(m => m.id);
  const byCity = (c: City) => members.filter(m => m.homeCity === c).map(m => m.id);
  for (const m of members) {
    if (m.invitedBy) edges.push({ from: m.id, to: m.invitedBy, type: "invited_by", strength: 0.6, explicit: true, createdAt: m.joinedAt });
    const local = byCity(m.homeCity);
    const isNew = now - m.joinedAt < 14 * DAY;
    const k = isNew ? (rng.chance(0.3) ? 1 : 0) : rng.int(4);
    for (let j = 0; j < k; j++) {
      const o = rng.pick(local);
      if (o === m.id) continue;
      edges.push({ from: m.id, to: o, type: rng.pick(["knows", "met", "enjoyed", "would_interact_again"] as const), strength: 0.2 + rng.next() * 0.8, explicit: rng.chance(0.7), createdAt: now - rng.int(100) * DAY });
    }
    if (rng.chance(0.05)) {
      const o = rng.pick(local);
      // Blocks are sometimes stored with alias ids (ME-006 regression).
      if (o !== m.id) edges.push({ from: aliasOf(m.id), to: aliasOf(o), type: rng.chance(0.7) ? "blocked" : "avoid", strength: 1, explicit: true, createdAt: now - rng.int(30) * DAY });
    }
  }
  // History: completed + positive (second encounters; must never block), declines, negative feedback.
  for (let j = 0; j < Math.floor(n / 8); j++) {
    const a = rng.pick(ids), b = rng.pick(ids);
    if (a === b) continue;
    const r = rng.next();
    const at = now - (2 + rng.int(40)) * DAY;
    const iid = `h${j}`;
    if (r < 0.5) {
      interactions.push({ id: iid, kind: "intro", category: "social", participants: [a, b], at, outcome: "completed" });
      feedback.push({ id: `fb${j}a`, from: a, about: b, opportunityId: iid, at: at + DAY, sentiment: "positive", wouldMeetAgain: true, processed: true });
      feedback.push({ id: `fb${j}b`, from: aliasOf(b), about: a, opportunityId: iid, at: at + DAY, sentiment: "positive", wouldMeetAgain: true, processed: true });
    } else if (r < 0.75) {
      interactions.push({ id: iid, kind: "intro", category: rng.pick(CATS), participants: [a, b], at, outcome: "declined", declinedBy: [b] });
    } else {
      interactions.push({ id: iid, kind: "intro", category: "social", participants: [a, b], at, outcome: "completed" });
      feedback.push({ id: `fb${j}n`, from: a, about: aliasOf(b), opportunityId: iid, at: at + DAY, sentiment: "negative", wouldMeetAgain: false, processed: true });
    }
  }
  for (let j = 0; j < Math.floor(n / 6); j++) {
    const a = rng.pick(ids), b = rng.pick(ids);
    if (a === b) continue;
    const createdAt = now - rng.int(10) * DAY - HOUR;
    recentProposals.push({
      id: `rp${j}`, kind: "intro", participants: [a, b], alternates: [], objective: "Intro", city: members.find(m => m.id === a)!.homeCity,
      score: 0.5, components: { fit: 0.5, mutualBenefit: 0.5, warmPath: 0, novelty: 0.5, timingFit: 0.5, activationCost: 0.2, interruptionCost: 0.2, load: 0, repetition: 0, socialRisk: 0, confidence: 0.8 },
      exploration: false, explanations: {}, generator: "seed", createdAt,
      ...({ category: "social", roles: { [a]: "seeker", [b]: rng.chance(0.5) ? "provider" : "peer" } } as any),
    });
  }
  const events: NetworkEvent[] = [];
  let ei = 0;
  for (const city of ["sf", "nyc"] as City[]) {
    for (let j = 0; j < Math.max(4, Math.floor(n / 25)); j++) {
      const t = rng.pick(THEMES);
      const start = now + (6 + rng.int(9 * 24)) * HOUR;
      const risky = rng.chance(0.05);
      events.push({ id: `e${ei++}`, title: rng.pick(t.events), city, area: rng.pick(AREAS[city]), start, end: start + 3 * HOUR, tags: [t.tag, ...(risky ? ["home_hosted"] : [])], category: rng.chance(0.5) ? "events" : t.category, riskTags: risky ? ["home_hosted"] : undefined });
    }
  }
  return { now, members, facets, intents, presence, edges, recentProposals, events, safetyHolds, feedback, interactions, idAliases, reliability, categoryQuotas: {} };
}

/** A fixed small cast for unit tests. */
export function baseMember(id: string, over: Partial<Omit<Member, "prefs">> & { prefs?: Partial<Preferences> } = {}): Member {
  const { prefs, ...rest } = over;
  return {
    id, name: id.toUpperCase(), homeCity: "sf", state: "open",
    joinedAt: Date.UTC(2026, 0, 1), age: 30, unansweredProactive: 0, ...rest,
    prefs: { categoriesOptIn: ["social", "professional", "hobby", "help", "events", "growth"], quietHours: [22, 8], romanceOptIn: false, formats: ["one_to_one", "small_group", "event"], maxTravelMinutes: 45, onlyWhenAsked: false, ...prefs },
  };
}
export function facet(memberId: string, n: number, kind: Facet["kind"], value: string, tags: string[], scope: Facet["scope"] = "shareable"): Facet {
  return { id: `${memberId}-f${n}`, memberId, kind, value, tags, scope, provenance: "said", confidence: 0.9 };
}
export function emptyInput(now = Date.UTC(2026, 9, 5, 16)): EngineInput {
  return { now, members: [], facets: [], intents: [], presence: [], edges: [], recentProposals: [], events: [], safetyHolds: [], feedback: [], interactions: [], idAliases: {} };
}
