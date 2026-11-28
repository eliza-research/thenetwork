import { expect, test } from "vitest";
import { DAY, HOUR } from "@thenetwork/core";
import { Mini } from "./mini.ts";
import { holdEveryItem } from "../../engine/src/reviewJudge.ts";

const ids = ["a", "b", "c", "d", "e", "f"];
const members = ids.map(id => ({ id, name: `${id.toUpperCase()}nton Q`, age: 30, area: "Prospect Heights", interests: ["coffee", "climbing"] }));

test("a yes from a member who can no longer take a seat does not count toward forming the crew", async () => {
  const w = new Mini(members, { inlineJudge: holdEveryItem.inline, plans: true, matchingEnabled: true });
  await w.onboard(...ids);
  expect(await w.runUntil(() => w.net.reviewQueue().some(q => q.origin === "planner"), 14 * DAY)).toBe(true);
  const q = w.net.reviewQueue().find(q => q.origin === "planner")!;
  expect(w.net.review(q.oppId, "approve", { reviewer: "sim_staff", revision: q.revision })).toBe(true);
  await w.answerProbes(ids);
  const plan = w.net.exportState().opps.find(o => o.id === q.oppId)!;
  expect(plan.stage).toBe("scheduled");
  const going = plan.status.filter(([, status]) => status === "yes").map(([id]) => id);
  await w.run(plan.plan!.window.start + HOUR - w.clock.now());
  for (const id of going) await w.say(id, "Thanks for arranging this.");
  await w.run(3 * HOUR);
  for (const id of going) await w.say(id, "We all came, it was great. I'd do it again.");
  const offer = w.net.exportState().plans!.crewOffers.find(o => !o.resolved)!;
  expect(offer).toBeDefined();
  const [first, second, third, ...rest] = offer.offered;
  expect(third).toBeDefined();
  await w.say(first!, "Yes, I'm in.");
  await w.say(second!, "Yes, I'm in.");
  await w.net.onInbound({ id: "crew-stop", memberId: first!, body: "STOP", ts: w.clock.now(), channel: "sms", keyword: "STOP" });
  expect(w.net.memberList().find(m => m.id === first)?.optedOut).toBe(true);
  await w.say(third!, "Yes, I'm in.");
  for (const id of rest) await w.say(id, "no");
  expect(w.log("crew_formed")).toEqual([]);
  expect(w.log("crew_not_formed")).toHaveLength(1);
  expect(w.net.crews).toEqual([]);
  const told = w.to(second!).map(s => s.body).join(" ");
  expect(told).toMatch(/Not enough people for a weekly crew/);
  expect(told).not.toMatch(/crew is on/);
});
