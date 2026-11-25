import { expect, test } from "vitest";
import { networkPack } from "@thenetwork/engine";
import { resolveConfig } from "@thenetwork/engine/src/config.ts";
import { localEmbed } from "@thenetwork/engine/src/embed.ts";
import { World } from "@thenetwork/engine/src/world.ts";
import { Mini } from "./mini.ts";
import { holdEveryItem } from "../../engine/src/reviewJudge.ts";

async function setup() {
  const w = new Mini([
    { id: "a", name: "Alice Able", age: 30, interests: ["climbing"] },
    { id: "b", name: "Boris Bell", age: 32, interests: ["climbing"], skills: ["climbing_belay"], shareable: true },
  ], { inlineJudge: holdEveryItem.inline, onboardingRequests: false });
  await w.onboard("a", "b");
  return w;
}

test.each(["a", "b"])("a request cannot select a member who opted out of its category (%s)", async id => {
  const w = await setup();
  const record = w.members.find(member => member.id === id)!;
  record.prefs.categoriesOptIn = record.prefs.categoriesOptIn.filter(category => category !== "hobby");
  w.restart();
  await w.say("a", "Find me a climbing partner.");
  expect(await w.runUntil(() => w.net.reviewQueue().length > 0, 60 * 60 * 1000)).toBe(false);
  expect(w.net.reviewQueue()).toHaveLength(0);
  expect(w.sent.some(message => message.meta.type === "probe")).toBe(false);
});

test.each(["paused", "category"] as const)("staff approval rechecks participation after intake (%s)", async change => {
  const w = await setup();
  await w.say("a", "Find me a climbing partner.");
  expect(await w.runUntil(() => w.net.reviewQueue().length > 0)).toBe(true);
  const [queued] = w.net.reviewQueue();
  expect(queued?.proposal.participants).toEqual(["a", "b"]);
  const record = w.members.find(member => member.id === "b")!;
  if (change === "paused") record.state = "paused";
  else record.prefs.categoriesOptIn = record.prefs.categoriesOptIn.filter(category => category !== "hobby");
  w.restart();
  expect(w.net.review(queued!.oppId, "approve", { reviewer: "sim_staff" })).toBe(false);
  expect(w.sent.some(message => message.meta.type === "probe")).toBe(false);
});

test("a matching pause blocks a probe while an existing booking can use its logistics", async () => {
  const w = await setup();
  w.members.find(member => member.id === "b")!.state = "paused";
  w.restart();
  expect(w.net.recipientPolicy("b", "probe", { about: ["a"] })).toMatchObject({ ok: false });
  expect(w.net.recipientPolicy("a", "probe", { about: ["b"] })).toMatchObject({ ok: false });
  expect(w.net.recipientPolicy("b", "reminder", { about: ["a"] })).toMatchObject({ ok: true });
  expect(w.net.recipientPolicy("b", "relay", { about: ["a"] })).toMatchObject({ ok: true });
});


test("a public venue request skips earlier members who opted out of event matches", async () => {
  const w = new Mini([
    { id: "a", name: "Alice Able", age: 30, area: "Williamsburg" },
    { id: "b", name: "Boris Bell", age: 32, area: "Williamsburg" },
    { id: "c", name: "Casey Cole", age: 31, area: "Williamsburg" },
  ], { inlineJudge: holdEveryItem.inline, onboardingRequests: false, plans: false });
  await w.onboard("a", "b", "c");
  const first = w.members.find(member => member.id === "a")!;
  first.prefs.categoriesOptIn = first.prefs.categoriesOptIn.filter(category => category !== "events");
  w.restart();
  for (const id of ["a", "b", "c"]) await w.say(id, "Anything fun near Williamsburg this weekend?");
  expect(w.sent.find(message => message.to === "a" && message.body.startsWith("A few ideas nearby"))?.body)
    .toContain("Happy to suggest more anytime.");
  expect(await w.runUntil(() => w.net.reviewQueue().length > 0)).toBe(true);
  const [queued] = w.net.reviewQueue();
  expect(queued?.proposal.participants).toEqual(["c", "b"]);
  expect(w.net.requests.find(request => request.memberId === "a")?.oppId).toBeUndefined();
  expect(w.net.requests.find(request => request.memberId === "b")?.oppId).toBe(queued?.oppId);
  expect(w.sent.some(message => message.meta.type === "probe")).toBe(false);
});

// spec/newMatchParticipation.md, "Keep the seat's role when another member takes it"
test.each([["helper", "available"], ["peer", "receiving"]] as const)("a staff reroll keeps the %s seat's role", async (role, picked) => {
  const w = new Mini([
    { id: "a", name: "Alice Able", age: 30, interests: ["climbing"] },
    { id: "b", name: "Boris Bell", age: 32, interests: ["climbing"] },
    { id: "receiving", name: "Casey Cole", age: 30, interests: ["climbing"] },
    { id: "available", name: "Drew Dale", age: 32, interests: ["climbing"] },
  ], { inlineJudge: holdEveryItem.inline, onboardingRequests: false, plans: false });
  await w.onboard("a", "b", "receiving", "available");
  const id = w.propose(["a", "b"], { alternates: ["receiving", "available"] });
  expect(await w.runUntil(() => w.net.reviewQueue().some(item => item.oppId === id))).toBe(true);
  const state = w.net.exportState();
  state.opps.find(row => row.id === id)!.roles = { a: "seeker", b: role };
  w.members.find(member => member.id === "receiving")!.state = "receiving";
  w.net.importState(state);
  w.restart();
  expect(w.net.review(id, "reroll", { reviewer: "sim_staff", swapOut: "b" })).toBe(true);
  expect(w.net.exportState().opps.find(row => row.id === id)).toMatchObject({
    stage: "review", participants: ["a", picked], roles: { a: "seeker", [picked]: role },
  });
  expect(w.net.exportState().opps.find(row => row.id === id)?.roles).not.toHaveProperty("b");
});


// spec/newMatchParticipation.md, "A refused draft does not consume a matching slot"
test("open review keeps its duplicate lock and a closed unsent draft is not billed", async () => {
  const w = await setup();
  const id = w.propose(["a", "b"]);
  expect(await w.runUntil(() => w.net.reviewQueue().some(item => item.oppId === id))).toBe(true);
  const input = () => w.net.engineInput(w.clock.now());
  expect(input().recentProposals?.some(proposal => proposal.id === id)).toBe(true);
  expect(input().unsentProposalIds ?? []).not.toContain(id);
  expect(w.net.review(id, "reject", { reviewer: "sim_staff", reason: "weak_reason" })).toBe(true);
  expect(input().recentProposals?.some(proposal => proposal.id === id)).toBe(true);
  expect(input().unsentProposalIds).toContain(id);
  const matchWorld = new World(input(), resolveConfig({ dispatch: { billOnlySent: true } }), localEmbed, networkPack);
  expect(matchWorld.get("a")?.recentProactive).toBe(0);
  expect(w.sent.some(message => message.meta.proposalId === id)).toBe(false);
});
