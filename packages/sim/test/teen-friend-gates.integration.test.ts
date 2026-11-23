import { expect, test } from "vitest";
import { Rng, canBeMatched, hash32, type MemberId } from "@thenetwork/core";
import { ageOnDay } from "../../core/src/generated/memberAge.ts";
import { runEngine } from "@thenetwork/engine/src/engine.ts";
import { friendsPack, hood } from "@thenetwork/engine/src/packs/friends/index.ts";
import { venueAllAges } from "@thenetwork/engine/src/packs/network/activities.ts";
import { friendsMetrics, friendsOutboundLog, teenBreachesOf } from "../src/apps/friends/metrics.ts";
import { engineInputOf, friendsPackMatcher, friendsTeenMatcher, planToProposal, slotIndexOf, teenProposalOf } from "../src/apps/friends/packMatcher.ts";
import type { FriendsPlan } from "@thenetwork/engine/src/packs/friends/index.ts";
import { FRIENDS_START_DAY_KEY, SLOTS, generateFriendsPersonas, type FriendsPersona } from "../src/apps/friends/persona.ts";
import { TEEN_WORLD } from "../src/generator.ts";
import { cuesOf, slotTime, type FriendsSnapshot } from "../src/apps/friends/snapshot.ts";
import { VENUES, runFriendsWorld, runFriendsWorldAsync, type FriendsMatcher, type FriendsProposal, type FriendsWorld } from "../src/apps/friends/world.ts";

type Cast = Record<"a16" | "b17" | "c18" | "d19" | "e15" | "poser" | "adult", string>;

function cast(): { personas: FriendsPersona[]; ids: Cast } {
  const personas = generateFriendsPersonas({ seed: 5, n: 80, ...TEEN_WORLD });
  const used = new Set<string>();
  const pick = (statedKey: number) => {
    const claimedAge = ageOnDay(statedKey, FRIENDS_START_DAY_KEY);
    const honest = (x: FriendsPersona): FriendsPersona => { const { adversary: _, ...hidden } = x.hidden; return { ...x, stated: { ...x.stated, claimedAge }, hidden }; };
    const p = personas.find(x => !used.has(x.id) && cuesOf(honest(x)).length === 0)!;
    used.add(p.id);
    return p;
  };
  const set = (statedKey: number, trueKey = statedKey, poser = false) => {
    const p = pick(statedKey);
    p.stated.birthKey = statedKey;
    p.stated.birthExact = true;
    p.stated.claimedAge = ageOnDay(statedKey, FRIENDS_START_DAY_KEY);
    p.hidden.trueBirthKey = trueKey;
    p.hidden.trueAge = ageOnDay(trueKey, FRIENDS_START_DAY_KEY);
    p.hidden.isMinor = p.hidden.trueAge < 18;
    delete p.hidden.adversary;
    if (poser) p.hidden.poser = true; else delete p.hidden.poser;
    expect(cuesOf(p)).toEqual([]);
    return p.id;
  };
  const ids: Cast = {
    a16: set(20100315), b17: set(20090101), c18: set(20080601), d19: set(20070901),
    e15: set(20110102), poser: set(20100601, 19960101, true), adult: set(19950101),
  };
  return { personas, ids };
}

const fixedWeek = (proposals: FriendsProposal[]) => (w: FriendsWorld): FriendsMatcher => {
  w.oracle.answer = (_id, _key, c) => ({ replied: true, yes: true, picks: [...c.options] });
  w.oracle.backsOut = () => false;
  w.oracle.attends = () => true;
  return { name: "teen rule fixture", propose: ctx => (ctx.week === 0 ? proposals : []) };
};

const LIBRARY = VENUES.find(v => v.activities.includes("library_games") && venueAllAges(v))!;
const rolesOf = (ids: readonly MemberId[], role: string) => Object.fromEntries(ids.map(id => [id, role]));
const meet = (slot: (typeof SLOTS)[number]) => ({
  activity: "library_games", venueHood: hood(LIBRARY.area)!.id, venueId: LIBRARY.id, options: [SLOTS.indexOf(slot)], alternates: [] as MemberId[],
});
const pair = (ids: [MemberId, MemberId], slot: (typeof SLOTS)[number], o: Partial<FriendsProposal> = {}): FriendsProposal => ({
  ...meet(slot), kind: "partner", invited: ids, quorum: 2, category: "hobby", generator: "activity_partner", format: "one_to_one", roles: rolesOf(ids, "peer"), ...o,
});
const table = (ids: MemberId[], slot: (typeof SLOTS)[number], o: Partial<FriendsProposal> = {}): FriendsProposal => ({
  ...meet(slot), kind: "plan", invited: ids, quorum: 3, category: "social", generator: "plan", format: "small_group", roles: rolesOf(ids, "guest"), ...o,
});

function proposalsOf(ids: Cast): FriendsProposal[] {
  const { category: _, ...noCategory } = table([ids.a16, ids.b17, ids.adult], "sun_am");
  return [
    pair([ids.a16, ids.b17], "sat_pm"),
    pair([ids.b17, ids.c18], "sun_pm"),
    pair([ids.b17, ids.d19], "sat_am"),
    pair([ids.b17, ids.e15], "sat_am"),
    noCategory,
    pair([ids.poser, ids.e15], "sun_am"),
  ];
}

const NO_BREACH = { adult: 0, gap: 0, lane: 0, unready: 0, switchOff: 0, group: 0, place: 0 };

test("friends world, teen introductions on by default: friendship pairs within 2 years and up to 18 meet; 19, a gap of 2 years and 1 day, and a plan without a friendship category are refused", () => {
  const { personas, ids } = cast();
  const result = runFriendsWorld({ seed: 5, n: personas.length, weeks: 1, personas, matcher: fixedWeek(proposalsOf(ids)) });
  const [teens, partner18, adult19, gap, plan, poser] = result.flows;
  expect([teens!.ruleOk, teens!.stage, [...teens!.going].sort()]).toEqual([true, "held", [ids.a16, ids.b17].sort()]);
  expect([partner18!.ruleOk, partner18!.stage]).toEqual([true, "held"]);
  expect([adult19!.ruleOk, adult19!.ageRuleBroken, adult19!.stage, adult19!.probed]).toEqual([false, true, "dropped_policy", 0]);
  expect(teenBreachesOf(adult19!.sides, adult19!)).toMatchObject({ adult: 1, gap: 0, lane: 0, switchOff: 0, place: 0 });
  expect([gap!.ruleOk, gap!.probed]).toEqual([false, 0]);
  expect(teenBreachesOf(gap!.sides, gap!)).toEqual({ ...NO_BREACH, gap: 1 });
  expect([plan!.ruleOk, plan!.probed]).toEqual([false, 0]);
  expect(teenBreachesOf(plan!.sides, plan!)).toMatchObject({ lane: 1, adult: 1, group: 1 });
  expect([poser!.ruleOk, poser!.stage]).toEqual([true, "held"]);
  const teen = friendsMetrics(result).safety.teen;
  expect(teen.contacts).toEqual(NO_BREACH);
  expect(teen.proposals).toMatchObject({ adult: 2, gap: 2, lane: 1, switchOff: 0, group: 1, place: 0 });
  expect(teen.introductions).toBe(3);
  expect([teen.posersReachingMinor, teen.hiddenOutsideRule, teen.hTeen]).toEqual([1, 1, 2]);
});

test("friends world, teen introductions stopped: the same proposals never reach a minor", () => {
  const { personas, ids } = cast();
  const result = runFriendsWorld({ seed: 5, n: personas.length, weeks: 1, teenStop: true, personas, matcher: fixedWeek(proposalsOf(ids)) });
  expect(result.flows.map(f => [f.ruleOk, f.probed, f.stage])).toEqual(result.flows.map(() => [false, 0, "dropped_policy"]));
  expect(result.contacts).toEqual([]);
  const m = friendsMetrics(result);
  expect(m.safety.teen.proposals.switchOff).toBe(6);
  expect(m.safety.teen.minorContacts).toBe(0);
  expect(m.safety.ageRuleBrokenProposals).toBe(6);
});

test("friends world, teen groups: a table of 16, 17 and 18 at a library on Saturday morning meets; with a 19-year-old, at a wine bar, in the evening, with a contributor role or with 7 people it is refused and counted", () => {
  const { personas, ids } = cast();
  const three = [ids.a16, ids.b17, ids.c18];
  const seven = [...three, ids.e15, ids.poser, ...personas.filter(p => !Object.values(ids).includes(p.id)).slice(0, 2).map(p => p.id)];
  const proposals = [
    table(three, "sat_am"),
    table([ids.a16, ids.b17, ids.d19], "sat_pm"),
    table(three, "sun_am", { activity: "wine_bar" }),
    table(three, "sat_eve"),
    table(three, "sun_pm", { roles: { ...rolesOf(three, "guest"), [ids.c18]: "host" } }),
    table(seven, "sun_pm"),
  ];
  const result = runFriendsWorld({ seed: 5, n: personas.length, weeks: 1, personas, matcher: fixedWeek(proposals) });
  const [ok, nineteen, wine, evening, host, big] = result.flows;
  expect([ok!.ruleOk, ok!.stage, [...ok!.going].sort()]).toEqual([true, "held", [...three].sort()]);
  expect(teenBreachesOf(ok!.sides, ok!)).toEqual(NO_BREACH);
  expect([nineteen!.ruleOk, nineteen!.probed]).toEqual([false, 0]);
  expect(teenBreachesOf(nineteen!.sides, nineteen!)).toMatchObject({ adult: 1, group: 1, place: 0 });
  expect([wine!.ruleOk, wine!.placeOk, wine!.probed]).toEqual([false, false, 0]);
  expect(teenBreachesOf(wine!.sides, wine!)).toEqual({ ...NO_BREACH, place: 1 });
  expect([evening!.ruleOk, evening!.placeOk]).toEqual([false, false]);
  expect(teenBreachesOf(evening!.sides, evening!)).toEqual({ ...NO_BREACH, place: 1 });
  expect([host!.ruleOk, host!.laneOk]).toEqual([false, false]);
  expect(teenBreachesOf(host!.sides, host!)).toEqual({ ...NO_BREACH, lane: 1 });
  expect([big!.ruleOk, big!.probed]).toEqual([false, 0]);
  expect(teenBreachesOf(big!.sides, big!).group).toBe(1);
  const teen = friendsMetrics(result).safety.teen;
  expect(teen.contacts).toEqual(NO_BREACH);
  expect([teen.teenMeetups, teen.teenGroupMeetups, teen.groupShare]).toEqual([1, 1, 1]);
});

test("friends world, teen groups: a planner table is judged on its own start and end, so a 09:00 start booked in the 10:00 slot and a 17:30 start that ends at 19:30 are counted as place breaches", () => {
  const { personas, ids } = cast();
  const three = [ids.a16, ids.b17, ids.c18];
  const saturday10 = slotTime(0, SLOTS.indexOf("sat_am"));
  const at = (startHour: number, minutes: number) => [{ start: saturday10 + (startHour - 10) * 3_600_000, end: saturday10 + (startHour - 10) * 3_600_000 + minutes * 60_000 }];
  const proposals = [
    table(three, "sat_am", { times: at(10, 120) }),
    table(three, "sat_am", { times: at(9, 120) }),
    table(three, "sat_am", { times: [...at(10, 120), ...at(17.5, 120)] }),
    table(three, "sat_am", { times: at(17, 120) }),
  ];
  const result = runFriendsWorld({ seed: 5, n: personas.length, weeks: 1, personas, matcher: fixedWeek(proposals) });
  const [ok, early, late, edge] = result.flows;
  expect([ok!.ruleOk, ok!.placeOk, ok!.stage]).toEqual([true, true, "held"]);
  for (const f of [early!, late!]) {
    expect([f.ruleOk, f.placeOk, f.probed]).toEqual([false, false, 0]);
    expect(teenBreachesOf(f.sides, f)).toEqual({ ...NO_BREACH, place: 1 });
  }
  expect([edge!.ruleOk, edge!.placeOk]).toEqual([true, true]);
  expect(friendsMetrics(result).safety.teen.contacts).toEqual(NO_BREACH);
});

test("friends world, planToProposal: a planner plan with minors keeps its 08:00 and 20:00 options, its host keeps the host role and its event stays the anchor, and the world counts each as a breach", () => {
  const { personas, ids } = cast();
  const three = [ids.a16, ids.b17, ids.c18];
  const saturday10 = slotTime(0, SLOTS.indexOf("sat_am"));
  const plan = (startHour: number, id: string): FriendsPlan => {
    const window = { start: saturday10 + (startHour - 10) * 3_600_000, end: saturday10 + (startHour - 8) * 3_600_000 };
    return {
      id, city: "nyc", activityId: "library_games", venueId: LIBRARY.id, place: { name: LIBRARY.name, area: LIBRARY.area }, window, options: [window],
      invited: [...three], alternates: [], partner: false, size: { min: 3, target: 3, max: 6 }, quorum: 3, probeDeadline: window.start,
      score: 1, u: {}, familiar: {}, createdAt: saturday10 - 86_400_000, category: "social", minutes: {}, source: "new",
    };
  };
  const plans = [plan(10, "day"), plan(8, "early"), plan(20, "evening"), { ...plan(10, "hosted"), hostId: ids.c18 }, { ...plan(10, "fair"), eventId: "event:library-fair" }];
  const proposals = plans.map(p => planToProposal(p)!);
  for (const x of proposals) expect([x.options.length > 0, x.times!.length]).toEqual([true, 2]);
  expect([proposals[3]!.roles?.[ids.c18], proposals[3]!.roles?.[ids.a16], proposals[4]!.anchor]).toEqual(["host", "guest", { type: "event", id: "event:library-fair" }]);
  const result = runFriendsWorld({ seed: 5, n: personas.length, weeks: 1, personas, matcher: fixedWeek(proposals) });
  const [day, early, evening, hosted, fair] = result.flows;
  expect([day!.ruleOk, day!.placeOk, day!.stage]).toEqual([true, true, "held"]);
  for (const f of [early!, evening!]) {
    expect([f.ruleOk, f.placeOk, f.probed, f.stage]).toEqual([false, false, 0, "dropped_policy"]);
    expect(teenBreachesOf(f.sides, f)).toEqual({ ...NO_BREACH, place: 1 });
  }
  for (const f of [hosted!, fair!]) {
    expect([f.ruleOk, f.laneOk, f.placeOk, f.probed, f.stage]).toEqual([false, false, true, 0, "dropped_policy"]);
    expect(teenBreachesOf(f.sides, f)).toEqual({ ...NO_BREACH, lane: 1 });
  }
  const teen = friendsMetrics(result).safety.teen;
  expect(teen.contacts).toEqual(NO_BREACH);
  expect([teen.proposals.place, teen.proposals.lane]).toEqual([2, 2]);
});

function teenSnapshots(seed: number, weeks: number): FriendsSnapshot[] {
  const seen: FriendsSnapshot[] = [];
  runFriendsWorld({ seed, n: 160, weeks, ...TEEN_WORLD, matcher: { name: "snapshot capture", propose: ctx => { seen.push(ctx.snapshot); return []; } } });
  return seen;
}
const minorsOf = (s: FriendsSnapshot) => new Set(s.members.filter(m => !canBeMatched(m.age)).map(m => m.id));

test("friends pack matcher on a teen world: every planner proposal keeps every option of its plan, minors included, and a plan host has the host role", async () => {
  let teen = 0;
  for (const seed of [5, 6]) for (const s of teenSnapshots(seed, 2)) {
    const minors = minorsOf(s);
    const out = await friendsPackMatcher().propose({ week: s.week, snapshot: s, rng: new Rng(hash32(seed, "matcher", s.week)) });
    for (const x of out) {
      expect(x.options).toEqual([...new Set(x.times!.slice(1).map(t => slotIndexOf(t.start)).filter(k => k >= 0))]);
      if (x.hostId !== undefined) expect(x.roles?.[x.hostId]).toBe("host");
      if ([...x.invited, ...x.alternates, ...(x.hostId !== undefined ? [x.hostId] : [])].some(id => minors.has(id))) teen++;
    }
  }
  expect(teen).toBeGreaterThan(0);
});

test("friends teen matcher: an engine proposal with a minor that carries a via or an event anchor reaches the world and is counted as a lane breach; an unanchored one that cannot be placed is not sent", async () => {
  const found = await (async () => {
    for (const seed of [5, 6, 7, 8]) {
      const s = teenSnapshots(seed, 1)[0]!;
      const minors = minorsOf(s);
      const { proposals } = await runEngine(engineInputOf(s), { seed: s.week + 1 }, { pack: friendsPack });
      const p = proposals.find(x => [...x.participants, ...x.alternates].some(id => minors.has(id)) && (teenProposalOf(x, s)?.options.length ?? 0) > 0);
      if (p) return { seed, s, p };
    }
    return undefined;
  })();
  expect(found).toBeDefined();
  const { seed, s, p } = found!;
  const roster = [...p.participants, ...p.alternates];
  const adult = s.members.find(m => canBeMatched(m.age) && !roster.includes(m.id))!.id;
  const { anchor: _, ...bare } = p;
  expect(teenProposalOf(bare, s)).toBeNull();
  const base = teenProposalOf(p, s)!;
  const event = teenProposalOf({ ...p, anchor: { type: "event", id: "event:street-fair", label: "street fair" } }, s)!;
  const via = teenProposalOf({ ...p, via: adult }, s)!;
  const viaBare = teenProposalOf({ ...bare, via: adult }, s)!;
  expect([event.options, event.anchor, via.via, via.options.length > 0, viaBare.via, viaBare.options]).toEqual([[], { type: "event", id: "event:street-fair" }, adult, true, adult, []]);
  const result = runFriendsWorld({ seed, n: 160, weeks: 1, ...TEEN_WORLD, matcher: fixedWeek([base, event, via, viaBare]) });
  const [ok, ...breaches] = result.flows;
  expect([ok!.ruleOk, ok!.laneOk]).toEqual([true, true]);
  expect(teenBreachesOf(ok!.sides, ok!)).toEqual(NO_BREACH);
  for (const f of breaches) {
    expect([f.ruleOk, f.laneOk, f.probed, f.stage]).toEqual([false, false, 0, "dropped_policy"]);
    expect(teenBreachesOf(f.sides, f).lane).toBe(1);
  }
  const teen = friendsMetrics(result).safety.teen;
  expect(teen.contacts).toEqual(NO_BREACH);
  expect(teen.proposals.lane).toBe(3);
});

test("friends world, the stopped arm equals the reference arm (no member teen ready) byte for byte, metrics and outbound log", async () => {
  for (const seed of [5, 6]) {
    const o = { seed, n: 160, weeks: 2, ...TEEN_WORLD, matcher: friendsTeenMatcher() };
    const stopped = await runFriendsWorldAsync({ ...o, teenStop: true });
    const reference = await runFriendsWorldAsync({ ...o, teenBirthDates: false });
    expect(reference.world.personas.some(p => p.stated.claimedAge < 18)).toBe(true);
    expect(JSON.stringify({ metrics: friendsMetrics(reference), outbound: friendsOutboundLog(reference) }))
      .toBe(JSON.stringify({ metrics: friendsMetrics(stopped), outbound: friendsOutboundLog(stopped) }));
  }
});
