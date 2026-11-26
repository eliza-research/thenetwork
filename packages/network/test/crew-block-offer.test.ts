// A block stops pair contact: a member who blocked a plan attendee is not offered a weekly
// crew with that attendee (spec/product/stories.md F23; copy.blocked "You won't be matched
// with them").
import { expect, test } from "vitest";
import { DAY, HOUR } from "@thenetwork/core";
import { Mini } from "./mini.ts";
import { holdEveryItem } from "../../engine/src/reviewJudge.ts";

const ids = ["a", "b", "c", "d", "e", "f"];
const members = ids.map(id => ({ id, name: `${id.toUpperCase()}nton Q`, age: 30, area: "Prospect Heights", interests: ["coffee", "climbing"] }));

test("a blocked attendee is not offered a crew with the member who blocked them", async () => {
  const w = new Mini(members, { inlineJudge: holdEveryItem.inline, plans: true, matchingEnabled: true });
  await w.onboard(...ids);
  expect(await w.runUntil(() => w.net.reviewQueue().some(q => q.origin === "planner"), 14 * DAY)).toBe(true);
  const q = w.net.reviewQueue().find(q => q.origin === "planner")!;
  expect(w.net.review(q.oppId, "approve", { reviewer: "sim_staff", revision: q.revision })).toBe(true);
  await w.answerProbes(ids);
  const plan = w.net.exportState().opps.find(o => o.id === q.oppId)!;
  expect(plan.stage).toBe("scheduled");
  const going = plan.status.filter(([, status]) => status === "yes").map(([id]) => id);
  expect(going).toContain("a");
  expect(going).toContain("b");
  await w.run(plan.plan!.window.start + HOUR - w.clock.now());
  for (const id of going) await w.say(id, "Thanks for arranging this.");
  await w.run(3 * HOUR);
  // a and b answer first (two positives: no crew yet), then a blocks b, then the rest answer.
  await w.say("a", "We all came, it was great. I'd do it again.");
  await w.say("b", "We all came, it was great. I'd do it again.");
  const from = w.mark();
  await w.say("a", "block Bnton");
  expect(w.net.exportState().blocks).toContain("a|b");
  for (const id of going.filter(x => x !== "a" && x !== "b")) await w.say(id, "We all came, it was great. I'd do it again.");
  // No crew offer reaches a (the blocker) or b (the blocked member) after the block.
  const offerText = /weekly thing with the same people/;
  expect(w.to("a", from).map(s => s.body).join(" ")).not.toMatch(offerText);
  expect(w.to("b", from).map(s => s.body).join(" ")).not.toMatch(offerText);
  for (const o of w.net.exportState().plans.crewOffers) expect(o.offered.includes("a") && o.offered.includes("b")).toBe(false);
});
