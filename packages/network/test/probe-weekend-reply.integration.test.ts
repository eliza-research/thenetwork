// A reply that names the weekend picks only the offered weekend times (packages/network/src/classify.ts,
// parseProbeReply), and with no weekend time offered it is asked again. NYC world, seed 2: a member
// with a probe for Monday, Tuesday or Thursday 7pm was asked "is that a yes or a no?" and wrote
// "Weekends work best. ✨💯". The Network read the emoji as a yes to every offered time, booked a
// weekday plan and named the member to the other person; the member's real answer was "Can't this
// week, maybe another time."
import { expect, test } from "vitest";
import { HOUR } from "@thenetwork/core";
import { Mini } from "./mini.ts";

const newcomer = (id: string, name: string) => ({ id, name, age: 30, area: "Williamsburg", interests: ["board games", "live music"], wants: [{ objective: "make a few new friends in the city", category: "social" as const }] });

test("a weekend preference is a yes only to the offered weekend times", async () => {
  const w = new Mini([newcomer("a", "Ana Diaz"), newcomer("b", "Ben Ito")], { review: "auto" });
  // Both said they are free on weekday evenings: the probe offers a weekday evening and the weekend.
  for (const id of ["a", "b"]) w.facets.push({ id: `${id}:availability`, memberId: id, kind: "availability_pattern", value: "weekday evenings", tags: ["evening:Mon", "evening:Tue", "evening:Wed", "evening:Thu"], scope: "agent_private", provenance: "said", confidence: 0.9, validFrom: w.clock.now(), source: "chat", observedAt: w.clock.now(), inferred: false, confirmedByMember: true });
  await w.onboard("a", "b");
  w.propose(["a", "b"]);
  expect(await w.runUntil(() => w.probed("a"))).toBe(true);
  const options = w.sent.filter(s => s.to === "a").at(-1)!.meta.timeOptions ?? [];
  const weekend = options.filter(o => /^(Saturday|Sunday)/.test(o.label)).map(o => o.key);
  expect(weekend.length).toBeGreaterThan(0);
  expect(weekend.length).toBeLessThan(options.length);
  await w.say("a", "Weekends work best. ✨💯");
  expect(w.log("probe_answer").filter(l => l.detail.memberId === "a").map(l => [l.detail.yes, l.detail.picked])).toEqual([[true, weekend]]);
});

test("a reviewed offer keeps exclusions and the member's time-of-day limit", async () => {
  const ids = ["a", "b"];
  const starts = [Date.UTC(2026, 9, 8, 23), Date.UTC(2026, 9, 10, 15), Date.UTC(2026, 9, 11, 18)];
  const w = new Mini([newcomer("a", "Ana Diaz"), newcomer("b", "Ben Ito")], {
    plans: false, growth: false, review: "human",
    hooks: { timeOptions: () => starts.map(start => ({ start, end: start + HOUR })) },
  });
  await w.onboard(...ids);
  const id = w.propose(ids, { category: "social", objective: "play board games together" });
  expect(await w.runUntil(() => w.net.reviewQueue().some(item => item.oppId === id))).toBe(true);
  expect(w.net.decide(id, "approve", { reviewer: "staff" })).toEqual({ ok: true });
  expect(await w.runUntil(() => w.probed("a"))).toBe(true);
  await w.say("a", "Any morning but Saturday works.");
  expect(w.meetings).toEqual([]);
  expect(w.log("probe_answer").filter(item => item.detail.memberId === "a")).toEqual([]);
  await w.say("a", "Every day but Monday works.");
  await w.say("a", "Every day but Saturday works for Morgan.");
  expect(w.log("probe_answer").filter(item => item.detail.memberId === "a")).toEqual([]);
  await w.say("a", "Every day but Saturday works.");
  expect(w.log("probe_answer").filter(item => item.detail.memberId === "a").map(item => item.detail.picked)).toEqual([["a", "c"]]);
  expect(await w.runUntil(() => w.probed("b"))).toBe(true);
  await w.say("b", "Thursday 7pm works.");
  expect(w.meetings).toMatchObject([{ proposalId: id, participants: ids, at: starts[0] }]);
});

test("a past date reference neither books nor replaces the active time choice", async () => {
  const ids = ["rae", "sam"];
  const thursday = Date.UTC(2026, 9, 8, 22);
  const saturday = Date.UTC(2026, 9, 10, 22);
  const sunday = Date.UTC(2026, 9, 11, 22);
  const pastReply = "Saturday was great.";
  const world = new Mini([
    { id: "rae", name: "Rae", age: 29, romance: { is: "woman", seeks: ["man"] } },
    { id: "sam", name: "Sam", age: 31, romance: { is: "man", seeks: ["woman"] } },
  ], { app: "slop", plans: false, growth: false, review: "human", hooks: {
    timeOptions: () => [thursday, saturday, sunday].map(start => ({ start, end: start + HOUR })),
    venue: () => ({ id: "test-cafe", name: "Cafe", neighborhood: "Downtown", lat: 40.7, lng: -74 }),
  }, understand: async (text, ctx) => text === pastReply ? {
    consent: "yes", times: ctx.options?.slice(0, 1).map(item => item.key),
    wants: [], notWanted: [], interests: [], skills: [],
  } : undefined });
  await world.onboard(...ids);
  const id = world.propose(ids, { category: "romance", objective: "a coffee date" });
  expect(await world.runUntil(() => world.net.reviewQueue().some(item => item.oppId === id))).toBe(true);
  expect(world.net.decide(id, "approve", { reviewer: "staff" })).toEqual({ ok: true });
  expect(await world.runUntil(() => world.probed("rae"))).toBe(true);
  for (const unoffered of ["9pm works", "Friday anytime works", "Friday 7pm works"]) {
    await world.say("rae", unoffered);
    expect(world.log("probe_answer").filter(item => item.detail.memberId === "rae")).toEqual([]);
    expect(world.meetings).toEqual([]);
  }
  await world.say("rae", "Saturday or Sunday works.");
  expect(await world.runUntil(() => world.probed("sam"))).toBe(true);
  await world.say("sam", pastReply);
  expect(world.meetings).toEqual([]);
  expect(world.probed("sam")).toBe(true);
  expect(world.log("probe_answer").filter(item => item.detail.memberId === "sam")).toEqual([]);

  await world.say("sam", "Last Saturday was great and Sunday works.");
  expect(world.meetings).toMatchObject([{ proposalId: id, participants: ids, at: sunday }]);
});


test.each([
  { first: "weekend mornings work", second: "first works", selected: 1, firstPicks: ["b"], secondKey: "a" },
  { first: "a weeknight works", second: "first works", selected: 0, firstPicks: ["a"], secondKey: "a" },
  { first: "Yes.", second: "second works", selected: 1, firstPicks: ["a", "b", "c"], secondKey: "b" },
  { first: "Yes.", second: "last works", selected: 2, firstPicks: ["a", "b", "c"], secondKey: "c" },
])("books only the common explicit time for $first and $second", async ({ first, second, selected, firstPicks, secondKey }) => {
  const ids = ["rae", "sam"];
  const starts = [Date.UTC(2026, 9, 8, 23), Date.UTC(2026, 9, 10, 15), Date.UTC(2026, 9, 11, 18)];
  const world = new Mini([
    { id: "rae", name: "Rae", age: 29, romance: { is: "woman", seeks: ["man"] } },
    { id: "sam", name: "Sam", age: 31, romance: { is: "man", seeks: ["woman"] } },
  ], { app: "slop", plans: false, growth: false, review: "human", hooks: {
    timeOptions: () => starts.map(start => ({ start, end: start + HOUR })),
    venue: () => ({ id: "test-cafe", name: "Cafe", neighborhood: "Downtown", lat: 40.7, lng: -74 }),
  } });
  await world.onboard(...ids);
  const id = world.propose(ids, { category: "romance", objective: "a coffee date" });
  expect(await world.runUntil(() => world.net.reviewQueue().some(item => item.oppId === id))).toBe(true);
  expect(world.net.decide(id, "approve", { reviewer: "staff" })).toEqual({ ok: true });
  expect(await world.runUntil(() => world.probed("rae"))).toBe(true);
  await world.say("rae", first);
  expect(await world.runUntil(() => world.probed("sam"))).toBe(true);
  await world.say("sam", "Fourth works.");
  expect(world.probed("sam")).toBe(true);
  expect(world.meetings).toEqual([]);
  const offered = world.to("sam").find(send => send.meta.probe?.key === id)?.meta.timeOptions;
  expect(offered?.find(option => option.key === secondKey)?.start).toBe(starts[selected]);
  await world.say("sam", second);
  expect(world.log("probe_answer").map(item => item.detail.picked)).toEqual([firstPicks, [secondKey]]);
  expect(world.meetings).toMatchObject([{ proposalId: id, participants: ids, at: starts[selected] }]);
});
