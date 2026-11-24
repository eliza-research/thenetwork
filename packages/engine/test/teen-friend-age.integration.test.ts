import { expect, test } from "vitest";
import { DAY, earliestDayKeyOf, EngineRng, HOUR, localParts, type Category, type Facet, type Member, type MemberId } from "@thenetwork/core";
import { laneLimits } from "../../core/src/generated/matchLane.ts";
import { ageOnDay } from "../../core/src/generated/memberAge.ts";
import { plantedEngineInput } from "../../sim/src/planted.ts";
import { buildProbe, defaultCadence, itemGate, type MemberAttention } from "../src/attention.ts";
import { resolveConfig } from "../src/config.ts";
import { localEmbed } from "../src/embed.ts";
import { canonicalInput, runEngine } from "../src/engine.ts";
import { candidateAgeReason, involvedMembers, memberReason, pairReason, requiredPairValues, sendTimeReason, type AgeCheckedCandidate } from "../src/filters.ts";
import type { GenCtx } from "../src/genkit.ts";
import { validatePack } from "../src/pack.ts";
import { friendsInfo, friendsPack, nycVenues, transitMinutes } from "../src/packs/friends/index.ts";
import { sameTableAgain } from "../src/packs/friends/generators.ts";
import { DEFAULT_FRIENDS_POLICY, FRIENDS_PLANS, friendsPartnerEligible, planFriendsWeek } from "../src/packs/friends/planner.ts";
import { activityById, type Venue } from "../src/packs/network/activities.ts";
import { networkPack } from "../src/packs/network/index.ts";
import { slopPack } from "../src/packs/slop/index.ts";
import { buildPlanProbe, crewSessionPlan, planMemberReason, planPlaceOffered, teenPlanReason, venueAgesIn, type Crew, type Plan, type PlanEvidence } from "../src/plans.ts";
import { relayItem, relayItemAsync, type RelayContext, type RelayItem, type RelayRecord } from "../src/relay.ts";
import type { AttentionItem, EngineInput, Format, Role } from "../src/types.ts";
import { World } from "../src/world.ts";

const NOW = Date.UTC(2026, 10, 22, 6);
const cfg = resolveConfig({ seed: 1 });
const base: EngineInput = canonicalInput(plantedEngineInput({ seed: "teen-friend-age", n: 200, lanes: ["Friend"], app: "friends", minorShare: 0, now: NOW }).input);
const adults = new World(base, cfg, localEmbed, friendsPack);

const born = (birthKey: number, ready = true): Partial<Member> => ({
  age: ageOnDay(birthKey, earliestDayKeyOf(NOW)), birthKey, birthExact: true, teenReady: ready,
});
const withAges = (input: EngineInput, ages: Readonly<Record<MemberId, Partial<Member>>>, teenIntros: boolean): EngineInput => ({
  ...input, ...(teenIntros ? { teenIntros } : {}), members: input.members.map(m => (ages[m.id] ? { ...m, ...ages[m.id] } : m)),
});
const worldOf = (ages: Readonly<Record<MemberId, Partial<Member>>>, teenIntros = true, input: EngineInput = base): World =>
  new World(withAges(input, ages, teenIntros), cfg, localEmbed, friendsPack);

const valuedGroupIn = (w: World, size: number): MemberId[] => {
  const profiles = w.match.profiles.filter(p => p.lane === "Friend" && p.capacity > 0);
  for (const first of profiles) {
    const group = [first];
    for (const p of profiles) if (group.length < size && !group.includes(p) && group.every(g => w.match.value(g, p) >= 0)) group.push(p);
    if (group.length === size) return group.map(p => p.memberId);
  }
  throw new Error(`no ${size} Friend profiles with a pair value between each two`);
};
const [a, b, c] = valuedGroupIn(adults, 3) as [MemberId, MemberId, MemberId];

const rolesOf = (ids: readonly MemberId[], role: Role): Record<MemberId, Role> => Object.fromEntries(ids.map(id => [id, role]));
const intro = (participants: MemberId[], o: Partial<AgeCheckedCandidate> = {}): AgeCheckedCandidate => {
  const alternates = o.alternates ?? [];
  const format: Format = o.format ?? (participants.length + alternates.length > 2 ? "small_group" : "one_to_one");
  return {
    participants, alternates, category: "social", format,
    generator: format === "small_group" ? "friend_circle" : "activity_partner",
    roles: rolesOf([...participants, ...alternates], format === "small_group" ? "guest" : "peer"), ...o,
  };
};

test("the chosen members pass every pair and member check as adults", () => {
  expect(pairReason(adults, a, b, "social", "Friend")).toBeNull();
  expect(pairReason(adults, b, c, "social", "Friend")).toBeNull();
  expect(pairReason(adults, a, c, "social", "Friend")).toBeNull();
  for (const id of [a, b, c]) expect(memberReason(adults, id, { category: "social", role: "peer", format: "small_group", timeSensitive: false })).toBeNull();
});

test("friends while teen introductions run pairs teen-ready teens born at most 2 years apart and refuses every other pair", () => {
  const pair = (first: Partial<Member>, second: Partial<Member>, teenIntros = true, category: Category = "social") =>
    pairReason(worldOf({ [a]: first, [b]: second }, teenIntros), a, b, category, "Friend");
  expect(pair(born(20100315), born(20090601))).toBeNull();
  expect(pair(born(20100315), born(20090601), false)).toBe("underage");
  expect(pair(born(20110701), born(20090601))).toBe("underage");
  expect(pair(born(20090601), born(20080601))).toBeNull();
  expect(pair(born(20090601), born(20070601))).toBe("underage");
  expect(pair(born(20100315, false), born(20090601))).toBe("underage");
  expect(pair(born(20100315), born(20090601), true, "romance")).toBe("underage");
  expect(pair(born(20100315), born(20090601), true, "professional")).toBe("underage");
});

test("a partner who turns 19 anywhere on Earth today is refused at 06:00 UTC on the birthday", () => {
  const at = (older: number) => pairReason(worldOf({ [a]: born(older), [b]: born(20091122) }), a, b, "social", "Friend");
  expect(born(20071122).age).toBe(18);
  expect(at(20071122)).toBe("underage");
  expect(at(20071123)).toBeNull();
});

test("a group with a minor holds only people who pass the pair rule with every other member", () => {
  const far = worldOf({ [a]: born(20120316), [b]: born(20110601), [c]: born(20100315) });
  expect(pairReason(far, a, b, "social", "Friend")).toBeNull();
  expect(pairReason(far, b, c, "social", "Friend")).toBeNull();
  expect(pairReason(far, a, c, "social", "Friend")).toBe("underage");
  expect(candidateAgeReason(far, intro([a, b, c]))).toBe("underage");
  const close = worldOf({ [a]: born(20110601), [b]: born(20100315), [c]: born(20101122) });
  expect(candidateAgeReason(close, intro([a, b, c]))).toBeNull();
  expect(candidateAgeReason(close, intro([a, b, c], { category: "romance" }))).toBe("underage");
  expect(candidateAgeReason(close, intro([a, b, c], { lane: "Friend" }))).toBeNull();
  expect(candidateAgeReason(close, intro([a, b, c], { lane: "Date" }))).toBe("underage");
  expect(candidateAgeReason(close, intro([a, b, c], { lane: "Cofounder" }))).toBe("underage");
  const withAdult = worldOf({ [a]: born(20110601), [b]: born(20100315), [c]: born(19950101) });
  expect(candidateAgeReason(withAdult, intro([a, b], { alternates: [c] }))).toBe("underage");
  expect(candidateAgeReason(withAdult, intro([a, b], { via: c }))).toBe("underage");
  expect(candidateAgeReason(withAdult, intro([a]))).toBe("underage");
});

test("the send-time check refuses an adult and a teen together and admits a teen pair only in a friendship category", () => {
  const w = worldOf({ [a]: born(20100315), [b]: born(20090601), [c]: born(19950101) });
  expect(sendTimeReason(w, a, [b], undefined, "social")).toBeNull();
  expect(sendTimeReason(w, a, [b])).toBe("underage");
  expect(sendTimeReason(w, a, [b], undefined, "romance")).toBe("underage");
  expect(sendTimeReason(w, c, [a], undefined, "social")).toBe("underage");
  expect(sendTimeReason(w, c, [], undefined, "social")).toBeNull();
  const off = worldOf({ [a]: born(20100315), [b]: born(20090601) }, false);
  expect(sendTimeReason(off, a, [b], undefined, "social")).toBe("underage");
});

test("a teen-ready teen gets a friends Friend profile only while teen introductions run", () => {
  const ages = { [a]: born(20100315), [b]: born(20090601) };
  expect(worldOf(ages).match.profileIn(a, "Friend")).toBeDefined();
  expect(worldOf(ages, false).match.profileIn(a, "Friend")).toBeUndefined();
  expect(worldOf({ [a]: born(20100315, false) }).match.profileIn(a, "Friend")).toBeUndefined();
  expect(memberReason(worldOf(ages), a, { category: "social", role: "peer", format: "small_group", timeSensitive: false })).toBeNull();
  expect(memberReason(worldOf(ages, false), a, { category: "social", role: "peer", format: "small_group", timeSensitive: false })).toBe("underage");
});

test("romance in slop.date refuses a teen-ready teen while teen introductions run", () => {
  const slop = new World(withAges(base, { [a]: born(20100315), [b]: born(20090601) }, true), cfg, localEmbed, slopPack);
  expect(pairReason(slop, a, b, "romance")).toBe("underage");
  expect(pairReason(slop, a, b, "social", "Friend")).toBe("underage");
});

test("a plan seat and a partner session take a teen only as a guest or peer and only within 2 years", () => {
  const grouped = metAgain(base);
  const w = worldOf({ [a]: born(20100315), [b]: born(20090601) }, true, grouped);
  expect(pairReason(w, a, b, "social", "Friend")).toBeNull();
  expect(planMemberReason(w, a)).toBeNull();
  expect(planMemberReason(w, b)).toBeNull();
  expect(planMemberReason(w, a, "host")).toBe("underage");
  expect(friendsPartnerEligible(w, a, b, "social")).toBe(true);
  const apart = worldOf({ [a]: born(20100315), [b]: born(20080314) }, true, grouped);
  expect(friendsPartnerEligible(apart, a, b, "social")).toBe(false);
  expect(friendsPartnerEligible(apart, a, b, "hobby")).toBe(false);
  const unready = worldOf({ [a]: born(20100315, false), [b]: born(20090601) }, true, grouped);
  expect(planMemberReason(unready, a)).toBe("underage");
  expect(friendsPartnerEligible(unready, a, b, "social")).toBe(false);
  const stopped = worldOf({ [a]: born(20100315), [b]: born(20090601) }, false, grouped);
  expect(planMemberReason(stopped, a)).toBe("underage");
  expect(friendsPartnerEligible(stopped, a, b, "social")).toBe(false);
  const ntwrk = new World(withAges(base, { [a]: born(20100315), [b]: born(20090601) }, true), cfg, localEmbed, networkPack);
  expect(planMemberReason(ntwrk, a)).toBe("underage");
});

const teenKey = (i: number): number => (2009 + (i % 2)) * 10000 + ((i % 12) + 1) * 100 + ((i % 28) + 1);
const allTeens: Record<MemberId, Partial<Member>> = Object.fromEntries(base.members.map((m, i) => [m.id, born(teenKey(i))]));
const someTeens: Record<MemberId, Partial<Member>> = Object.fromEntries(base.members.slice(0, 12).map((m, i) => [m.id, born(teenKey(i))]));
const strip = (input: EngineInput): EngineInput => ({
  ...input, members: input.members.map(({ birthKey: _k, birthExact: _e, teenReady: _r, ...m }) => m),
});

test("while teen introductions are stopped the proposals are byte-identical to a world without teen fields", async () => {
  const off = await runEngine(withAges(base, someTeens, false), { seed: 1 }, { pack: friendsPack });
  const plain = await runEngine(strip(withAges(base, someTeens, false)), { seed: 1 }, { pack: friendsPack });
  expect(off.proposals.length).toBeGreaterThan(0);
  expect(JSON.stringify(off.proposals)).toBe(JSON.stringify(plain.proposals));
  const teens = new Set(Object.keys(someTeens));
  for (const p of off.proposals) expect([...p.participants, ...p.alternates].some(id => teens.has(id))).toBe(false);
});

test("while teen introductions run a teen world gets only friend circles and activity partners that pass the rule", async () => {
  const on = await runEngine(withAges(base, allTeens, true), { seed: 1 }, { pack: friendsPack });
  const off = await runEngine(withAges(base, allTeens, false), { seed: 1 }, { pack: friendsPack });
  expect(off.proposals).toHaveLength(0);
  expect(on.proposals.length).toBeGreaterThan(0);
  const w = worldOf(allTeens);
  for (const p of on.proposals) {
    expect(["friend_circle", "activity_partner"]).toContain(p.generator);
    expect(["social", "hobby"]).toContain(p.category);
    expect(p.via).toBeUndefined();
    expect(p.format).toBeDefined();
    expect(candidateAgeReason(w, { participants: p.participants, alternates: p.alternates, category: p.category, roles: p.roles, format: p.format!, generator: p.generator, anchor: p.anchor })).toBeNull();
  }
});

test("validatePack refuses a teen friendship lane outside friends.help", () => {
  expect(validatePack(friendsPack)).toBe(friendsPack);
  const teenRomance = { ...slopPack, ontology: { ...slopPack.ontology, lanes: [{ id: "romance", minors: "teenFriendship" as const }] } };
  expect(() => validatePack(teenRomance)).toThrow("lane romance cannot admit minors");
  const teenWork = { ...friendsPack, ontology: { ...friendsPack.ontology, lanes: [{ id: "professional", minors: "teenFriendship" as const }] } };
  expect(() => validatePack(teenWork)).toThrow("lane professional cannot admit minors");
});

test("a minor's item with other members passes the attention gate only when the network marks it a teen friendship item", () => {
  const minor: MemberAttention = {
    memberId: "t1", state: "normal", age: 16, tz: "America/New_York", quietHours: [22, 8], onlyWhenAsked: false,
    prefs: defaultCadence("normal"), categoriesOptIn: ["social"],
  };
  const item: AttentionItem = {
    id: "item", memberId: "t1", kind: "group_probe", category: "social", others: ["t2"], involvesMember: true,
    effort: "meet_short", enjoy: 0.9, accept: 0.5, urgency: { expiresAt: NOW + DAY }, createdAt: NOW, reviewState: "approved", key: "item",
  };
  expect(itemGate(minor, item, NOW, friendsPack.attention.config, friendsPack)).toBe("minor_restricted");
  expect(itemGate(minor, { ...item, teenFriendAllowed: true }, NOW, friendsPack.attention.config, friendsPack)).toBeNull();
  expect(itemGate(minor, { ...item, teenFriendAllowed: true, reviewState: "pending" }, NOW, friendsPack.attention.config, friendsPack)).toBe("awaiting_review");
});

const relayCtx = (o: { teen: boolean; ages?: [number, number]; metAt?: number; history?: RelayRecord[] }): RelayContext => ({
  now: NOW,
  opportunity: { id: "opp", app: "friends", participants: ["t1", "t2"], acceptedBy: ["t1", "t2"], status: "mutual", ...(o.metAt === undefined ? {} : { metAt: o.metAt }) },
  sender: { id: "t1", firstName: "Ana", age: o.ages?.[0] ?? 16, photoIds: ["photo_abcdefgh"], photoConsent: true },
  recipient: { id: "t2", firstName: "Bea", age: o.ages?.[1] ?? 17 },
  blocked: false,
  ...(o.history ? { history: o.history } : {}),
  ...(o.teen ? { teenFriendPair: true } : {}),
});
const textItem = (text: string, id = "i1"): RelayItem => ({ id, kind: "text", from: "t1", to: "t2", at: NOW, text });
const CLEAN = "Want to try the climbing gym on Saturday afternoon?";

test("a teen friendship pair gets moderated text relay only: no number and no photo", () => {
  expect(relayItem(textItem(CLEAN), relayCtx({ teen: true })).decision).toBe("pass");
  const outside = relayItem(textItem(CLEAN), relayCtx({ teen: false }));
  expect(outside.decision).toBe("block");
  expect(outside.reasons).toContain("minor:party");
  const share: RelayItem = { id: "i2", kind: "contact_share", from: "t1", to: "t2", at: NOW, contact: { kind: "phone", value: "+12125550123" }, consent: { kind: "contact_share", by: "t1", itemId: "i2", at: NOW } };
  const photo: RelayItem = { id: "i3", kind: "photo", from: "t1", to: "t2", at: NOW, photoIds: ["photo_abcdefgh"], consent: { kind: "photo", by: "t1", itemId: "i3", at: NOW, photoIds: ["photo_abcdefgh"] } };
  for (const item of [share, photo]) {
    const result = relayItem(item, relayCtx({ teen: true }));
    expect(result.decision).toBe("block");
    expect(result.reasons).toContain("minor:party");
    expect(result.rendered).toBe("");
  }
  expect(relayItem(share, relayCtx({ teen: false, ages: [25, 26] })).decision).toBe("pass");
});

test("an off-platform move after a meeting is blocked for a teen pair and passes for an adult pair", () => {
  const met = NOW - DAY;
  const teen = relayItem(textItem("add me on snap"), relayCtx({ teen: true, metAt: met }));
  expect(teen.decision).toBe("block");
  expect(teen.reasons).toContain("offplatform:app");
  expect(relayItem(textItem("add me on snap"), relayCtx({ teen: false, ages: [25, 26], metAt: met })).decision).toBe("pass");
});

test.each([
  ["teen:secrecy", "this is our secret ok"],
  ["teen:age_probe", "how old are you really"],
  ["teen:gift", "i can buy you a new game"],
  ["teen:picture", "send me a pic"],
  ["teen:alone", "lets meet alone at the park"],
  ["teen:location", "which school do you go to"],
  ["teen:contact", "whats your discord"],
])("a teen pair text with %s is blocked and the code is not checked for adults", (code, text) => {
  const teen = relayItem(textItem(text), relayCtx({ teen: true }));
  expect(teen.decision).toBe("block");
  expect(teen.reasons).toContain(code);
  expect(relayItem(textItem(text), relayCtx({ teen: false, ages: [25, 26] })).reasons).not.toContain(code);
});

test("a teen pair has a daily relay limit of 10 and never fails open", async () => {
  const history: RelayRecord[] = Array.from({ length: 10 }, (_, i) => ({
    itemId: `h${i}`, opportunityId: "opp", app: "friends", kind: "text", from: "t1", to: "t2", at: NOW - (i + 1) * HOUR,
    decision: "pass", reasons: [], photoCount: 0, contactShared: false, ageSignal: false, policy: "relay-1.0.0",
  }));
  expect(relayItem(textItem(CLEAN, "i9"), relayCtx({ teen: true, history })).reasons).toContain("rate:daily");
  expect(relayItem(textItem(CLEAN, "i9"), relayCtx({ teen: false, ages: [25, 26], history })).reasons).not.toContain("rate:daily");
  const failing = async (): Promise<never> => { throw new Error("classifier down"); };
  for (const teen of [true, false]) {
    const down = await relayItemAsync(textItem(CLEAN), relayCtx(teen ? { teen } : { teen, ages: [25, 26] }), { hook: failing });
    expect(down.decision).toBe("block");
    expect(down.reasons).toEqual(["classifier:unavailable"]);
    expect(down.rendered).toBe("");
    expect(down.classifierError).toBe("Error");
  }
});

test("a photo relayed later in the history does not count toward the daily photo limit", () => {
  const photoRow = (i: number, at: number): RelayRecord => ({
    itemId: `p${i}`, opportunityId: "opp", app: "friends", kind: "photo", from: "t1", to: "t2", at,
    decision: "pass", reasons: [], photoCount: 1, contactShared: false, ageSignal: false, policy: "relay-1.0.0",
  });
  const photo: RelayItem = { id: "i4", kind: "photo", from: "t1", to: "t2", at: NOW, photoIds: ["photo_abcdefgh"], consent: { kind: "photo", by: "t1", itemId: "i4", at: NOW, photoIds: ["photo_abcdefgh"] } };
  const earlier = Array.from({ length: 6 }, (_, i) => photoRow(i, NOW - (i + 1) * HOUR));
  const later = Array.from({ length: 6 }, (_, i) => photoRow(i, NOW + (i + 1) * HOUR));
  expect(relayItem(photo, relayCtx({ teen: false, ages: [25, 26], history: earlier })).reasons).toContain("rate:photos");
  expect(relayItem(photo, relayCtx({ teen: false, ages: [25, 26], history: later })).reasons).not.toContain("rate:photos");
});

test("a partner who turns 19 before the meeting ends is refused in the candidate check and in the probe", () => {
  const w = worldOf({ [a]: born(20091122), [b]: born(20071125) });
  const meeting = { start: NOW + DAY, end: NOW + 4 * DAY };
  expect(born(20071125).age).toBe(18);
  expect(candidateAgeReason(w, intro([a, b]))).toBeNull();
  expect(candidateAgeReason(w, intro([a, b], { window: meeting }))).toBe("underage");
  expect(candidateAgeReason(w, intro([a, b], { fixedWindow: meeting }))).toBe("underage");
  expect(candidateAgeReason(w, intro([a, b], { window: { start: NOW + DAY, end: NOW + 2 * DAY } }))).toBeNull();
  const spec = {
    proposalId: "p1", kind: "intro" as const, category: "social" as const, objective: "Climbing at the gym", tz: "America/New_York",
    generator: "activity_partner", format: "one_to_one" as const, roles: rolesOf([a, b], "peer"),
  };
  expect(buildProbe(w, { ...spec, window: { start: NOW + DAY, end: NOW + 2 * DAY } }, a, [b], NOW)).not.toBeNull();
  expect(buildProbe(w, { ...spec, window: meeting }, a, [b], NOW)).toBeNull();
  expect(buildProbe(w, { ...spec, options: [{ start: NOW + DAY, end: NOW + DAY + 2 * HOUR }, meeting] }, a, [b], NOW)).toBeNull();
  const { generator: _g, ...unnamed } = spec;
  expect(buildProbe(w, { ...unnamed, window: { start: NOW + DAY, end: NOW + 2 * DAY } }, a, [b], NOW)).toBeNull();
});

test("a minor's item that names no other member fails the attention gate even when it is marked a teen friendship item", () => {
  const minor: MemberAttention = {
    memberId: "t1", state: "normal", age: 16, tz: "America/New_York", quietHours: [22, 8], onlyWhenAsked: false,
    prefs: defaultCadence("normal"), categoriesOptIn: ["social"],
  };
  const anonymous: AttentionItem = {
    id: "anon", memberId: "t1", kind: "intro_probe", category: "social", others: [], involvesMember: true, teenFriendAllowed: true,
    effort: "meet_short", enjoy: 0.9, accept: 0.5, urgency: { expiresAt: NOW + DAY }, createdAt: NOW, reviewState: "approved", key: "anon",
  };
  expect(itemGate(minor, anonymous, NOW, friendsPack.attention.config, friendsPack)).toBe("minor_restricted");
  expect(itemGate(minor, { ...anonymous, others: ["t2"] }, NOW, friendsPack.attention.config, friendsPack)).toBeNull();
});

const planted = canonicalInput(plantedEngineInput({ seed: "teen-friend-minors", n: 200, lanes: ["Friend"], app: "friends", minorShare: 0.15, now: NOW }).input);
const plantedMinors = planted.members.filter(m => m.age !== undefined && m.age < 18);
const plantedReady: Record<MemberId, Partial<Member>> = Object.fromEntries(plantedMinors.map(m => [m.id, born((2025 - m.age!) * 10000 + 1201)]));

test("while teen introductions are stopped no proposal of a planted world involves a teen-ready minor in any role", async () => {
  expect(plantedMinors.length).toBeGreaterThan(5);
  for (const m of plantedMinors) expect(plantedReady[m.id]!.age).toBe(m.age);
  const off = await runEngine(withAges(planted, plantedReady, false), { seed: 1 }, { pack: friendsPack });
  expect(off.proposals.length).toBeGreaterThan(0);
  for (const p of off.proposals) expect(involvedMembers(p).some(id => plantedReady[id] !== undefined)).toBe(false);
});

test("while teen introductions run a planted world never puts a minor with a person aged 19 or more", async () => {
  const input = withAges(planted, plantedReady, true);
  const on = await runEngine(input, { seed: 1 }, { pack: friendsPack });
  const w = new World(input, cfg, localEmbed, friendsPack);
  for (const p of on.proposals) {
    const ids = involvedMembers(p);
    if (!ids.some(id => plantedReady[id] !== undefined)) continue;
    expect(ids.every(id => w.get(id)!.m.age <= 18)).toBe(true);
    expect(["social", "hobby"]).toContain(p.category);
    expect(p.via).toBeUndefined();
    expect(candidateAgeReason(w, { participants: p.participants, alternates: p.alternates, category: p.category, window: p.window, roles: p.roles, format: p.format!, generator: p.generator, anchor: p.anchor })).toBeNull();
  }
});

const teenTable: Record<MemberId, Partial<Member>> = { [a]: born(20100315), [b]: born(20090601), [c]: born(20101122) };
const metAgain = (input: EngineInput): EngineInput => ({
  ...input,
  interactions: [...(input.interactions ?? []), { id: "met1", kind: "group", category: "social", participants: [a, b, c], at: NOW - 2 * DAY, outcome: "completed" }],
  feedback: [...(input.feedback ?? []), ...[a, b, c].flatMap(from => [a, b, c].filter(about => about !== from).map(about => ({
    id: `fb_${from}_${about}`, from, about, opportunityId: "met1", at: NOW - DAY, sentiment: "positive" as const, wouldMeetAgain: true,
  })))],
});
const genCtx = (w: World): GenCtx => ({ w, memberExclusions: {}, rng: new EngineRng(1), unmatchedIntents: new Set() });

test("the same table again never seats a teen-ready teen while teen introductions run", () => {
  const adultsAgain = new World(metAgain(base), cfg, localEmbed, friendsPack);
  expect(sameTableAgain(genCtx(adultsAgain)).some(x => [a, b, c].every(id => x.participants.includes(id)))).toBe(true);
  const teensAgain = worldOf(teenTable, true, metAgain(base));
  expect(pairReason(teensAgain, a, b, "social", "Friend")).toBeNull();
  expect(sameTableAgain(genCtx(teensAgain)).some(x => x.participants.some(id => id === a || id === b || id === c))).toBe(false);
});

const SATURDAY_11 = Date.UTC(2026, 10, 28, 16);
const SATURDAY_1930 = Date.UTC(2026, 10, 29, 0, 30);

test("a crew session plan takes a teen crew only for an all-ages activity at an all-ages venue in the daytime, with no host, and within 2 years", () => {
  const crew: Crew = {
    id: "crew_teen", activityId: "restaurant_dinner", city: "nyc", members: [a, b, c], cadenceDays: 7,
    hostRotation: [a, b, c], sessions: [], handedOff: false, slot: { start: NOW + 3 * DAY },
  };
  expect(crewSessionPlan(adults, crew, NOW, undefined, FRIENDS_PLANS)).not.toBeNull();
  const teens = worldOf(teenTable);
  expect(requiredPairValues(teens, { participants: [a, b, c], lane: "Friend" })?.every(v => v >= 0)).toBe(true);
  expect(crewSessionPlan(teens, crew, NOW, undefined, FRIENDS_PLANS)).toBeNull();
  const games: Crew = { ...crew, id: "crew_library", activityId: "library_games", venueId: library.id, slot: { start: SATURDAY_11 } };
  const session = crewSessionPlan(teens, games, NOW, library, FRIENDS_PLANS);
  expect(session).not.toBeNull();
  expect(session!.hostId).toBeUndefined();
  expect(session!.venueId).toBe(library.id);
  expect(session!.place).toEqual({ name: library.name, area: library.area });
  expect(venueAgesIn([library])(session!.venueId!)).toMatchObject({ allAges: true, ageMin: 13, adultPlans: false });
  expect(crewSessionPlan(adults, games, NOW, library, FRIENDS_PLANS)?.hostId).toBeDefined();
  expect(crewSessionPlan(teens, games, NOW, undefined, FRIENDS_PLANS)).toBeNull();
  expect(crewSessionPlan(teens, games, NOW, { ...library, allAges: false }, FRIENDS_PLANS)).toBeNull();
  expect(crewSessionPlan(teens, games, NOW, { ...library, id: "v_other_test" }, FRIENDS_PLANS)).toBeNull();
  expect(crewSessionPlan(teens, { ...games, slot: { start: SATURDAY_1930 } }, NOW, library, FRIENDS_PLANS)).toBeNull();
  const apart = worldOf({ [a]: born(20100315), [b]: born(20080314), [c]: born(20090601) });
  expect(crewSessionPlan(apart, games, NOW, library, FRIENDS_PLANS)).toBeNull();
});

test.each([
  "I'm actually 25 lol",
  "im 30",
  "i was born in 1998",
  "my birthday is march 3 1999",
  "born in 94",
  "i'm in my twenties",
])("a teen pair text that states an adult age (%s) is blocked with teen:adult_age and passes for adults", text => {
  const teen = relayItem(textItem(text), relayCtx({ teen: true }));
  expect(teen.decision).toBe("block");
  expect(teen.reasons).toContain("teen:adult_age");
  const adult = relayItem(textItem(text), relayCtx({ teen: false, ages: [25, 26] }));
  expect(adult.reasons).not.toContain("teen:adult_age");
});

test.each([
  "im 18",
  "im 20 minutes away",
  "i'm 99% sure",
  "i was born in 2009",
  CLEAN,
])("a teen pair text without an adult age (%s) gets no teen:adult_age", text => {
  expect(relayItem(textItem(text), relayCtx({ teen: true })).reasons).not.toContain("teen:adult_age");
});

test("a text passes only after a classifier reads it cleanly, for a teen pair and for adults", async () => {
  const clean = async () => ({ flags: [] });
  for (const ctx of [relayCtx({ teen: true }), relayCtx({ teen: false, ages: [25, 26] })]) {
    const unread = await relayItemAsync(textItem(CLEAN), ctx);
    expect(unread.decision).toBe("block");
    expect(unread.reasons).toEqual(["classifier:unavailable"]);
    expect(unread.rendered).toBe("");
    expect(unread.classifierError).toBe("no_classifier");
    const refused = await relayItemAsync(textItem(CLEAN), ctx, { hook: async () => ({ flags: [], unavailable: true }) });
    expect(refused.reasons).toEqual(["classifier:unavailable"]);
    expect(refused.classifierError).toBe("unavailable");
    expect((await relayItemAsync(textItem(CLEAN), ctx, { hook: clean })).decision).toBe("pass");
  }
  const flagged = await relayItemAsync(textItem(CLEAN), relayCtx({ teen: true }), { hook: async () => ({ flags: ["grooming"] }) });
  expect(flagged.decision).toBe("block");
  expect(flagged.reasons).toEqual(["clef:grooming"]);
});

const ntwrkBase: EngineInput = canonicalInput(plantedEngineInput({ seed: "teen-ntwrk-friend", n: 200, lanes: ["Friend"], app: "ntwrk", minorShare: 0, now: NOW }).input);
const ntwrkAdults = new World(ntwrkBase, cfg, localEmbed, networkPack);
const [x, y, z] = valuedGroupIn(ntwrkAdults, 3) as [MemberId, MemberId, MemberId];
const ntwrkOf = (ages: Readonly<Record<MemberId, Partial<Member>>>, teenIntros = true): World =>
  new World(withAges(ntwrkBase, ages, teenIntros), cfg, localEmbed, networkPack);

test("the ntwrk Friend lane pairs teens born at most 2 years apart and refuses a partner aged 19", () => {
  const close = ntwrkOf({ [x]: born(20100315), [y]: born(20090601) });
  expect(pairReason(close, x, y, "social", "Friend")).toBeNull();
  expect(candidateAgeReason(close, intro([x, y], { generator: "intent_to_capability" }))).toBeNull();
  const older = ntwrkOf({ [x]: born(20090601), [y]: born(20070601) });
  expect(pairReason(older, x, y, "social", "Friend")).toBe("underage");
  expect(candidateAgeReason(older, intro([x, y], { generator: "intent_to_capability" }))).toBe("underage");
  expect(pairReason(close, x, y, "professional", "Intro")).toBe("underage");
  expect(pairReason(close, x, y, "hobby")).toBe("underage");
  expect(pairReason(ntwrkOf({ [x]: born(20100315), [y]: born(20090601) }, false), x, y, "social", "Friend")).toBe("underage");
});

test.each(["event_anchor", "warm_path", "newcomer_welcome", "help_request", "second_encounter", "network_growth", "expansion"])(
  "an ntwrk candidate from %s with a teen pair is refused although the pair passes the age rule", generator => {
    const w = ntwrkOf({ [x]: born(20100315), [y]: born(20090601) });
    expect(candidateAgeReason(w, intro([x, y], { generator: "intent_to_capability" }))).toBeNull();
    expect(candidateAgeReason(w, intro([x, y], { generator }))).toBe("underage");
  });

test("an ntwrk teen circle of 3 passes and the same circle with a person aged 19 is refused", () => {
  const circle = (w: World) => candidateAgeReason(w, intro([x, y, z], { generator: "group_composer", anchor: { type: "interest", id: "nyc:chess", label: "chess" } }));
  expect(circle(ntwrkOf({ [x]: born(20100315), [y]: born(20090601), [z]: born(20101122) }))).toBeNull();
  expect(circle(ntwrkOf({ [x]: born(20100315), [y]: born(20090601), [z]: born(20071122) }))).toBe("underage");
  const teens = ntwrkOf({ [x]: born(20100315), [y]: born(20090601), [z]: born(20101122) });
  expect(candidateAgeReason(teens, intro([x, y, z], { generator: "group_composer", anchor: { type: "event", id: "ev1" } }))).toBe("underage");
  expect(candidateAgeReason(teens, intro([x, y, z], { generator: "group_composer", format: "event" }))).toBe("underage");
  expect(candidateAgeReason(teens, intro([x, y, z], { generator: "group_composer", roles: { ...rolesOf([x, y], "guest"), [z]: "host" } }))).toBe("underage");
});

test("a friends candidate with a minor is refused for an unknown generator, an alternate with no role, or a roster of 7", () => {
  const w = worldOf({ [a]: born(20110601), [b]: born(20100315), [c]: born(20101122) });
  expect(candidateAgeReason(w, intro([a, b], { generator: "expansion" }))).toBe("underage");
  expect(candidateAgeReason(w, intro([a, b], { generator: "same_table_again" }))).toBe("underage");
  expect(candidateAgeReason(w, intro([a, b], { alternates: [c] }))).toBeNull();
  expect(candidateAgeReason(w, intro([a, b], { alternates: [c], roles: rolesOf([a, b], "guest") }))).toBe("underage");
  const seven = base.members.slice(0, 7).map(m => m.id);
  const sevenTeens = worldOf(Object.fromEntries(seven.map((id, i) => [id, born(20100101 + i * 100)])));
  expect(candidateAgeReason(sevenTeens, intro(seven.slice(0, 6)))).toBeNull();
  expect(candidateAgeReason(sevenTeens, intro(seven))).toBe("underage");
});

test("the engine gives a teen roster only intent pairs and Friend circles on ntwrk, and nothing while teen introductions are stopped", async () => {
  const allNtwrkTeens: Record<MemberId, Partial<Member>> = Object.fromEntries(ntwrkBase.members.map((m, i) => [m.id, born(teenKey(i))]));
  const on = await runEngine(withAges(ntwrkBase, allNtwrkTeens, true), { seed: 1 }, { pack: networkPack });
  const off = await runEngine(withAges(ntwrkBase, allNtwrkTeens, false), { seed: 1 }, { pack: networkPack });
  expect(off.proposals).toHaveLength(0);
  expect(on.proposals.length).toBeGreaterThan(0);
  const w = ntwrkOf(allNtwrkTeens);
  for (const p of on.proposals) {
    expect(["intent_to_capability", "group_composer"]).toContain(p.generator);
    expect(p.category).toBe("social");
    expect(p.via).toBeUndefined();
    expect(p.anchor?.type).not.toBe("event");
    expect(involvedMembers(p).length).toBeLessThanOrEqual(6);
    expect(candidateAgeReason(w, { participants: p.participants, alternates: p.alternates, category: p.category, window: p.window, roles: p.roles, format: p.format!, generator: p.generator, anchor: p.anchor })).toBeNull();
  }
});

const NY = "America/New_York";
const boardGames = (input: EngineInput): EngineInput => ({
  ...input,
  facets: [...input.facets, ...input.members.map((m): Facet => ({
    id: `${m.id}:board_games`, memberId: m.id, kind: "interest", value: "board games", tags: ["board_games"], scope: "shareable", provenance: "said", confidence: 1,
  }))],
});
const gamesBase = boardGames(base);
const gamesAdults = new World(gamesBase, cfg, localEmbed, friendsPack);

const neighbourTable = (): { ids: [MemberId, MemberId, MemberId]; area: string } => {
  const info = friendsInfo(gamesAdults);
  const floor = laneLimits("Friend").circlePairFloor;
  const byHome = new Map<string, MemberId[]>();
  for (const id of gamesAdults.ids) {
    const home = info.get(id)?.home;
    const profile = gamesAdults.match.profileIn(id, "Friend");
    if (!home || !profile || transitMinutes(home, home) > info.get(id)!.tolerance * DEFAULT_FRIENDS_POLICY.toleranceSlack) continue;
    byHome.set(home.id, [...(byHome.get(home.id) ?? []), id]);
  }
  for (const [area, ids] of [...byHome].sort(([x0], [y0]) => (x0 < y0 ? -1 : 1))) {
    const value = (p: MemberId, q: MemberId) => gamesAdults.match.value(gamesAdults.match.profileIn(p, "Friend")!, gamesAdults.match.profileIn(q, "Friend")!);
    for (const first of ids) {
      const table = [first];
      for (const id of ids) if (table.length < 3 && !table.includes(id) && table.every(t => value(t, id) >= floor)) table.push(id);
      if (table.length === 3) return { ids: table as [MemberId, MemberId, MemberId], area };
    }
  }
  throw new Error("no three neighbours with a Friend pair value at the circle floor between each two");
};
const { ids: trio, area: trioArea } = neighbourTable();
const trioAges: Record<MemberId, Partial<Member>> = { [trio[0]]: born(20110601), [trio[1]]: born(20100315), [trio[2]]: born(20090901) };
const library: Venue = {
  id: "v_library_test", city: "nyc", area: trioArea, name: "the public library", activities: ["library_games"], priceTier: 0, ageMin: 13,
  hours: { weekday: [9, 20], weekend: [9, 18] }, public: true, source: "curated", allAges: true, adultPlans: false,
};
const saturday = (memberId: MemberId): PlanEvidence => ({
  memberId, tz: NY, quietHours: [22, 8], stated: { windows: [{ start: Date.UTC(2026, 10, 28, 15), end: Date.UTC(2026, 10, 28, 19) }], at: NOW, until: NOW + 7 * DAY },
});
const nyMinute = (t: number) => { const lp = localParts(t, NY); return lp.hour * 60 + lp.minute; };

test("friends plans a table of teens born within 2 years at board games at the library on a Saturday morning", () => {
  const w = worldOf(trioAges, true, gamesBase);
  const week = planFriendsWeek(w, { now: NOW, tz: NY, evidence: new Map(trio.map(id => [id, saturday(id)])), venues: [library], crews: [], outcomes: [], offered: [] });
  const table = week.plans.find(p => p.activityId === "library_games");
  expect(table).toBeDefined();
  const plan = table!;
  expect([...plan.invited].sort()).toEqual([...trio].sort());
  expect(plan.alternates).toEqual([]);
  expect(plan.hostId).toBeUndefined();
  expect(plan.venueId).toBe(library.id);
  for (const option of plan.options) {
    expect(nyMinute(option.start)).toBeGreaterThanOrEqual(600);
    expect(nyMinute(option.start) + (option.end - option.start) / 60_000).toBeLessThanOrEqual(1140);
  }
  const atLibrary = venueAgesIn([library]);
  expect(teenPlanReason(w, plan, atLibrary, plan.options)).toBeNull();
  const probe = buildPlanProbe(w, plan, trio[0], NY, atLibrary);
  expect(probe).not.toBeNull();
  expect(probe).toContain("board games at the library");
  expect(probe).not.toContain(" near ");
  for (const id of trio) expect(probe).not.toContain(w.get(id)!.m.name.split(" ")[0]!);
  const evening = { start: SATURDAY_1930, end: SATURDAY_1930 + 2 * HOUR };
  expect(teenPlanReason(w, { ...plan, window: evening }, atLibrary, [evening])).toBe("underage");
  expect(teenPlanReason(w, { ...plan, activityId: "wine_bar" }, atLibrary)).toBe("underage");
  expect(teenPlanReason(w, { ...plan, hostId: trio[0] }, atLibrary)).toBe("underage");
  expect(planPlaceOffered(true, activityById.get("library_games")!, library)).toBe(true);
  expect(planPlaceOffered(true, activityById.get("wine_bar")!, library)).toBe(false);
  expect(planPlaceOffered(true, activityById.get("library_games")!, { ...library, allAges: false })).toBe(false);
  expect(planPlaceOffered(false, activityById.get("library_games")!, library)).toBe(false);
});

test('friends requires staff verification for an adult-only table (spec/friendIntroAge.md, "A teen-ready person needs no staff verification on friends.help")', () => {
  const [eighteen, first, second] = trio;
  const venue: Venue = { ...library, id: "v_cafe_test", name: "the public cafe", activities: ["coffee_crawl"], adultPlans: true };
  const input: EngineInput = {
    ...gamesBase,
    facets: [...gamesBase.facets, ...trio.map((memberId): Facet => ({
      id: `${memberId}:coffee`, memberId, kind: "interest", value: "coffee", tags: ["coffee"], scope: "shareable", provenance: "said", confidence: 1,
    }))],
  };
  const failedAgeCheck: EngineInput = {
    ...input,
    facets: input.facets.map(f => f.memberId === eighteen ? { ...f, tags: f.tags.map(t => t === "verify:age:pass" ? "verify:age:fail" : t) } : f),
  };
  const adultAges = { [eighteen]: born(20080701), [first]: born(19990101, false), [second]: born(19980101, false) };
  const teenAges = { ...adultAges, [first]: born(20090501), [second]: born(20100501) };
  const evidence = new Map(trio.map(id => [id, saturday(id)]));
  const offers = (ages: typeof adultAges, snapshot: EngineInput) => {
    const week = planFriendsWeek(worldOf(ages, true, snapshot), { now: NOW, tz: NY, evidence, venues: [venue], crews: [], outcomes: [], offered: [] });
    return [...week.plans, ...week.partners];
  };

  const wholeTable = expect.objectContaining({ invited: expect.arrayContaining(trio), venueId: venue.id });
  expect(offers(adultAges, input)).toContainEqual(wholeTable);
  expect(offers(teenAges, failedAgeCheck)).toContainEqual(wholeTable);
  const adultOffers = offers(adultAges, failedAgeCheck).flatMap(p => [...p.invited, ...p.alternates]);
  expect(adultOffers).not.toContain(eighteen);
});

test("a teen table is refused with a person aged 19, at a wine bar, in the evening, or with a 7th member", () => {
  const week = (ages: Readonly<Record<MemberId, Partial<Member>>>, venue: Venue) =>
    planFriendsWeek(worldOf(ages, true, gamesBase), { now: NOW, tz: NY, evidence: new Map(trio.map(id => [id, saturday(id)])), venues: [venue], crews: [], outcomes: [], offered: [] });
  const withNineteen = { ...trioAges, [trio[2]]: born(20071122) };
  const nineteen = week(withNineteen, library);
  expect([...nineteen.plans, ...nineteen.partners].some(p => p.invited.includes(trio[0]) && p.invited.includes(trio[2]))).toBe(false);
  const wine: Venue = { ...library, id: "v_wine_test", activities: ["wine_bar"], ageMin: 21, allAges: false, adultPlans: true, hours: { weekday: [9, 23], weekend: [9, 23] } };
  const bar = week(trioAges, wine);
  expect([...bar.plans, ...bar.partners].some(p => p.invited.some(id => trio.includes(id)))).toBe(false);
  const extra = base.members.map(m => m.id).filter(id => !trio.includes(id)).slice(0, 4);
  const sevenAges = { ...trioAges, ...Object.fromEntries(extra.map((id, i) => [id, born(20100601 + i * 100)])) };
  const w = worldOf(sevenAges, true, gamesBase);
  const plan: Plan = {
    id: "plan_teen_seven", city: "nyc", activityId: "library_games", venueId: library.id, place: { name: library.name, area: library.area },
    window: { start: SATURDAY_11, end: SATURDAY_11 + 2 * HOUR }, invited: [...trio, ...extra.slice(0, 3)], alternates: [], partner: false,
    size: { min: 3, target: 6, max: 6 }, quorum: 3, probeDeadline: SATURDAY_11 - DAY, score: 0.5, u: {}, familiar: {}, createdAt: NOW, category: "social",
  };
  const atLibrary = venueAgesIn([library]);
  expect(teenPlanReason(w, plan, atLibrary)).toBeNull();
  expect(teenPlanReason(w, { ...plan, venueId: "v_unknown_test" }, atLibrary)).toBe("underage");
  expect(teenPlanReason(w, { ...plan, venueId: undefined }, atLibrary)).toBe("underage");
  expect(teenPlanReason(w, plan, venueAgesIn([{ ...library, allAges: false }]))).toBe("underage");
  expect(teenPlanReason(w, { ...plan, alternates: [extra[3]!] }, atLibrary)).toBe("underage");
  expect(teenPlanReason(w, { ...plan, invited: [...plan.invited, extra[3]!] }, atLibrary)).toBe("underage");
});

test("an adult-only week is byte-identical with and without the all-ages entries", () => {
  const adultActivities = friendsPack.plans!.activities.filter(x => x.adultPlans);
  expect(adultActivities.length).toBeLessThan(friendsPack.plans!.activities.length);
  const adultPack = { ...friendsPack, plans: { ...friendsPack.plans!, activities: adultActivities } };
  const evidence = new Map<MemberId, PlanEvidence>(base.members.map(m => [m.id, {
    memberId: m.id, tz: NY, quietHours: [22, 8], stated: { windows: [{ start: NOW, end: NOW + 8 * DAY }], at: NOW, until: NOW + 8 * DAY },
  }]));
  const run = (pack: typeof friendsPack, venues: Venue[]) =>
    planFriendsWeek(new World(base, cfg, localEmbed, pack), { now: NOW, tz: NY, evidence, venues, crews: [], outcomes: [], offered: [] });
  const withAll = run(friendsPack, nycVenues(friendsPack.plans!.activities));
  const without = run(adultPack, nycVenues(adultActivities));
  expect(withAll.plans.length + withAll.partners.length).toBeGreaterThan(0);
  expect(JSON.stringify(withAll)).toBe(JSON.stringify(without));
  for (const p of [...withAll.plans, ...withAll.partners]) expect(activityById.get(p.activityId)!.adultPlans).toBe(true);
});

test("a minor's own age words in a teen pair block with teen:age_talk, not minor:signal, and block with minor:signal between adults", () => {
  const teen = relayItem(textItem("my mom won't let me go that late"), relayCtx({ teen: true }));
  expect(teen.decision).toBe("block");
  expect(teen.reasons).toContain("teen:age_talk");
  expect(teen.reasons).not.toContain("minor:signal");
  expect(teen.record.ageSignal).toBe(true);
  const adult = relayItem(textItem("my mom won't let me go that late"), relayCtx({ teen: false, ages: [25, 26] }));
  expect(adult.decision).toBe("block");
  expect(adult.reasons).toContain("minor:signal");
});
