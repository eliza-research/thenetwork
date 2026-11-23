import { HOUR } from "@thenetwork/core";
import type { EngineProposal } from "@thenetwork/engine";
import { expect, test } from "vitest";
import { Mini } from "./mini.ts";

async function ceramics(
  options: { optOut?: boolean; networkGrowth?: boolean; relabel?: boolean; category?: "growth" | "hobby" } = {},
) {
  const members = [{ id: "a", name: "Alice Able" }, { id: "b", name: "Boris Bell" }];
  const proposals: EngineProposal[] = [];
  const w = new Mini(members.map(member => ({
    ...member, age: 30, interests: ["ceramics"], skills: ["pottery_wheel"], shareable: true,
    wants: [{ objective: "try ceramics", category: options.category ?? "growth" }],
  })), {
    review: "human", onboardingRequests: false, maxNewPerDay: 1, runHour: 14, plans: false, growth: false,
    engine: { personalGrowthAsHobby: options.relabel ?? true },
    onEngineRun: (_log, generated) => proposals.push(...generated),
  });
  if (options.optOut) {
    const member = w.members.find(row => row.id === "b")!;
    member.prefs.categoriesOptIn = member.prefs.categoriesOptIn.filter(category => category !== "hobby");
  }
  if (options.networkGrowth) w.intents.find(intent => intent.memberId === "b")!.details = "Invite members to the Network";
  await w.onboard("a", "b");
  await w.run(HOUR);
  return { w, proposals };
}

// spec/standingIntent.md, "Use the matching category for known want evidence"
test("a known personal-growth pair is eligible for hobby review", async () => {
  const { w, proposals } = await ceramics();
  expect(proposals).toContainEqual(expect.objectContaining({ category: "hobby", generator: "intent_to_capability", lane: "Friend" }));
  expect(w.log("gate_reason").map(row => row.detail.reason)).not.toContain("want_not_named");
  const [review] = w.net.reviewQueue();
  expect(review?.proposal).toMatchObject({ category: "hobby", generator: "intent_to_capability", participants: ["a", "b"] });
  expect(w.sent.some(message => message.meta.type === "probe")).toBe(false);
  expect(w.net.review(review!.oppId, "approve", { reviewer: "sim_staff" })).toBe(true);
  expect(await w.runUntil(() => w.sent.some(message => message.meta.type === "probe"))).toBe(true);
});

test("a personal-growth want cannot consent to hobby contact", async () => {
  const { w, proposals } = await ceramics({ optOut: true });
  expect(proposals).toContainEqual(expect.objectContaining({ category: "hobby", generator: "intent_to_capability", lane: "Friend" }));
  expect(w.log("gate_reason").map(row => row.detail.reason)).toContain("category_opt_out");
  expect(w.net.reviewQueue()).toHaveLength(0);
  expect(w.sent.some(message => message.meta.type === "probe")).toBe(false);
});

test("growing the Network does not count as reciprocal hobby evidence", async () => {
  const { w } = await ceramics({ networkGrowth: true });
  expect(w.net.knownWantMet("b", ["a"], "hobby")).toBe(0);
  expect(w.net.knownWantMet("a", ["b"], "hobby")).toBeLessThan(0.8);
  expect(w.net.reviewQueue()).toHaveLength(0);
});

test("disabling personal-growth relabeling keeps the original known want category", async () => {
  const { w } = await ceramics({ relabel: false });
  expect(w.net.knownWantMet("a", ["b"], "growth")).toBe(0.85);
  expect(w.net.knownWantMet("a", ["b"], "hobby")).toBe(0);
  expect(w.net.reviewQueue()).toHaveLength(0);
});

test("an explicitly recorded hobby want keeps its category when relabeling is off", async () => {
  const { w } = await ceramics({ category: "hobby", relabel: false });
  const [review] = w.net.reviewQueue();
  expect(review?.proposal).toMatchObject({ category: "hobby", generator: "intent_to_capability" });
});
