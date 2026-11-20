import { expect, test } from "vitest";
import { Mini } from "./mini.ts";

test("a group intro rebuilds its reason after the only person with that interest says no", async () => {
  // The booked line is the introduction. It may describe only people who are still in the group.
  const w = new Mini([
    { id: "ana", name: "Ana Diaz", age: 31, area: "Williamsburg", interests: ["ceramics", "hiking"], shareable: true },
    { id: "ben", name: "Ben Ito", age: 32, area: "Williamsburg", interests: ["hiking"], shareable: true },
    { id: "cy", name: "Cy Moss", age: 33, area: "Williamsburg", interests: ["ceramics"], shareable: true },
    { id: "dee", name: "Dee Park", age: 34, area: "Williamsburg", interests: ["hiking"], shareable: true },
  ], { plans: false, growth: false });
  await w.onboard("ana", "ben", "cy", "dee");
  // Ana's stored reason is the one the roster justified while Cy was in it: ceramics is shareable
  // only for Ana and Cy. Hiking is what Ana still shares with Ben and Dee.
  const oppId = w.propose(["ana", "ben", "cy", "dee"], {
    category: "hobby",
    objective: "a weekend hike",
    explanations: {
      ana: "others here are into ceramics",
      ben: "others here are into hiking",
      cy: "others here are into ceramics",
      dee: "others here are into hiking",
    },
  });
  expect(await w.runUntil(() => w.probed("ana"))).toBe(true);
  expect(w.net.exportState().opps.find(o => o.id === oppId)?.explanations.ana).toBe("others here are into ceramics");
  await w.say("ana", "yes");
  expect(await w.runUntil(() => w.probed("cy"))).toBe(true);
  await w.say("cy", "no");
  for (const id of ["ben", "dee"] as const) {
    if (!w.probed(id)) expect(await w.runUntil(() => w.probed(id))).toBe(true);
    await w.say(id, "yes");
  }
  const booked = () => w.to("ana").find(m => m.meta.type === "proposal" && m.meta.proposalId === oppId);
  expect(await w.runUntil(() => booked() !== undefined)).toBe(true);

  const body = booked()!.body;
  const saved = w.net.exportState().opps.find(o => o.id === oppId);
  expect(saved?.participants).toEqual(["ana", "ben", "dee"]);
  expect(saved?.explanations.ana).toBe("others here are into hiking");
  expect(saved?.explanations.cy).toBeUndefined();
  expect(body.toLowerCase()).toContain("others here are into hiking");
  expect(body.toLowerCase()).not.toContain("ceramics");
  expect(body).not.toMatch(/\bCy\b/);
});
