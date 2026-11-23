import { expect, test } from "vitest";
import { DAY, HOUR } from "@thenetwork/core";
import { Mini, type Spec } from "./mini.ts";

const person = (id: string, name: string, area: string): Spec => ({ id, name, area, age: 30, interests: ["hiking"] });

test.each(["none", "blocked", "avoid"] as const)("a newcomer welcome ranks only compatible hosts (%s)", async type => {
  const w = new Mini([
    person("preferred", "Anna Reed", "Williamsburg"),
    person("fallback", "Bea Lane", "Greenpoint"),
    person("inviter", "Cam Fox", "Williamsburg"),
  ], { review: "human", plans: false });
  await w.onboard("preferred", "fallback", "inviter");
  w.clock.advance(8 * DAY);
  w.add(person("new", "Dev Singh", "Williamsburg"));
  w.members.find(member => member.id === "new")!.invitedBy = "inviter";
  if (type !== "none") w.edges.push({ from: "preferred", to: "new", type, explicit: true, strength: 1, createdAt: w.clock.now() });
  await w.onboard("new");
  await w.run(2 * DAY);
  const welcomes = w.net.exportState().opps.filter(row => row.origin === "newcomer_welcome");
  expect(welcomes).toHaveLength(1);
  expect(welcomes[0]).toMatchObject({ stage: "review", participants: ["new", type === "none" ? "preferred" : "fallback"] });
  expect(w.sent.some(message => message.meta.proposalId === welcomes[0]!.id)).toBe(false);
});

test("a saved avoidance edge stops a reviewed introduction and a local plans pairing", async () => {
  const w = new Mini([person("a", "Ari Ajit", "Williamsburg"), person("b", "Bo Berg", "Greenpoint")],
    { review: "human", plans: false });
  await w.onboard("a", "b");
  await w.say("a", "Any plans this weekend?");
  w.edges.push({ from: "b", to: "a", type: "avoid", explicit: true, strength: 1, createdAt: w.clock.now() });
  w.restart();
  await w.say("b", "Any plans this weekend?");
  expect(w.net.exportState().opps.some(row => row.origin === "plans")).toBe(false);
  expect(w.to("b").some(message => message.meta.type === "concierge")).toBe(true);
  const review = w.propose(["a", "b"]);
  await w.run(DAY);
  expect(w.net.exportState().opps.filter(row => row.id === review).every(row => row.stage === "closed")).toBe(true);
  expect(w.sent.some(message => message.meta.proposalId === review)).toBe(false);
});

test("an avoid edge learned after intake is rechecked at approval and the first matching contact", async () => {
  const w = new Mini([person("a", "Ari Ajit", "Williamsburg"), person("b", "Bo Berg", "Greenpoint")],
    { review: "human", plans: false });
  await w.onboard("a", "b");
  const id = w.propose(["a", "b"]);
  expect(await w.runUntil(() => w.net.reviewQueue().some(item => item.oppId === id), DAY + HOUR)).toBe(true);
  expect(w.net.recipientPolicy("a", "probe", { about: ["b"] }).ok).toBe(true);
  w.edges.push({ from: "b", to: "a", type: "avoid", explicit: true, strength: 1, createdAt: w.clock.now() });
  w.restart();
  expect(w.net.recipientPolicy("a", "probe", { about: ["b"] })).toEqual({ ok: false, reason: "blocked_pair" });
  expect(w.net.recipientPolicy("a", "relay", { about: ["b"] }).ok).toBe(true);
  expect(w.net.review(id, "approve", { reviewer: "sim_staff" })).toBe(false);
  expect(w.sent.some(message => message.meta.proposalId === id)).toBe(false);
});
