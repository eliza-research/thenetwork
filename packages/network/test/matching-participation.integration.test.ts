import { expect, test } from "vitest";
import { Mini } from "./mini.ts";

async function setup() {
  const w = new Mini([
    { id: "a", name: "Alice Able", age: 30, interests: ["climbing"] },
    { id: "b", name: "Boris Bell", age: 32, interests: ["climbing"], skills: ["climbing_belay"], shareable: true },
  ], { review: "human", onboardingRequests: false });
  await w.onboard("a", "b");
  return w;
}

test.each(["a", "b"])("a request cannot select a member who opted out of its category (%s)", async id => {
  const w = await setup();
  const record = w.members.find(member => member.id === id)!;
  record.prefs.categoriesOptIn = record.prefs.categoriesOptIn.filter(category => category !== "hobby");
  w.restart();
  await w.say("a", "Find me a climbing partner.");
  expect(w.net.reviewQueue()).toHaveLength(0);
  expect(w.sent.some(message => message.meta.type === "probe")).toBe(false);
});

test.each(["paused", "category"] as const)("staff approval rechecks participation after intake (%s)", async change => {
  const w = await setup();
  await w.say("a", "Find me a climbing partner.");
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
