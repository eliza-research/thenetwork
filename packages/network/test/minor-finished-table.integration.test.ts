import { expect, test } from "vitest";
import { DAY, HOUR, type InitialInviteReceipt } from "@thenetwork/core";
import { FRIENDS_PLANS, friendsPack } from "@thenetwork/engine";
import { bookingNoticeReceiptKey, meetingFeedbackKey } from "../src/network.ts";
import { PLAN_VENUES } from "../src/plans.ts";
import { Mini } from "./mini.ts";
import { holdEveryItem } from "../../engine/src/reviewJudge.ts";

test.each(["adult", "record"] as const)("a finished Friends table that a child was asked about is not repeated: %s", async arm => {
  const activity = "coffee_crawl";
  const venue = PLAN_VENUES.find(v => v.activities.includes(activity))!;
  const ids = ["a", "b", "c"];
  const w = new Mini([...ids, "d"].map((id, index) => ({ id, name: ["Ari", "Ben", "Cara", "Dov"][index]!, age: id === "d" ? undefined : 30,
    area: venue.area, interests: ["coffee", "climbing"] })), { app: "friends", pack: friendsPack, inlineJudge: holdEveryItem.inline, plans: true,
    plansConfig: { ...FRIENDS_PLANS, crews: { ...FRIENDS_PLANS.crews, enabled: false } } });
  for (const id of [...ids, "d"]) w.facets.push({ id: `${id}:verified`, memberId: id, kind: "fact", value: "Verified",
    tags: ["verify:liveness:pass", "verify:age:pass"], scope: "agent_private", provenance: "said", confidence: 1 });
  await w.onboard(...ids);
  for (const text of ["hi!", "I'm 30.", "More time outdoors.", "Weekends, mostly.", "One-on-one is good."]) await w.say("d", text);
  const at = Date.UTC(2026, 9, 10, 16);
  const now = Date.UTC(2026, 9, 15, 15);
  const future = at + 7 * DAY;
  const source = w.net["submitPlan"]({ id: "original-table", city: "nyc",
    activityId: activity, venueId: venue.id, place: { name: venue.name, area: venue.area }, window: { start: at, end: at + 90 * 60_000 },
    invited: ids, alternates: [], hostId: "a", partner: false, size: { min: 3, target: 3, max: 3 }, quorum: 3,
    probeDeadline: at - HOUR, score: 0.8, u: {}, familiar: {}, createdAt: at - DAY, category: "social" }, at - DAY)!;
  const state = w.net.exportState();
  const completed = state.opps.find(o => o.id === source.id)!;
  completed.stage = "done";
  completed.meetingAt = at;
  completed.status = ids.map(id => [id, "yes"]);
  completed.bookedAt = Object.fromEntries(ids.map(id => [id, at - HOUR]));
  completed.contacted = [...ids, "d"];
  for (const member of state.members) member.stated = { at: now - 1, until: future + DAY, windows: [{ start: future, end: future + 3 * HOUR }] };
  w.net.importState(state);
  const receipts = new Map<string, InitialInviteReceipt>();
  for (const id of ids) {
    receipts.set(meetingFeedbackKey(source.id, id, 0), { kind: "accepted", at: at + 3 * HOUR });
    receipts.set(bookingNoticeReceiptKey(source.id, id, 0), { kind: "accepted", at: at - HOUR });
  }
  w.net.init({ ...w.ctx(), initialInviteReceipt: id => receipts.get(id) });
  w.clock.set(at + 4 * HOUR);
  for (const id of ids) await w.say(id, "We all came. It was great. I'd do it again.");
  await w.net.tick(w.clock.now());
  expect(w.net.exportState().opps.find(o => o.id === source.id)).toMatchObject({ finalized: true, feedbackFrom: ids });
  w.restart();
  if (arm === "record") {
    w.members.find(m => m.id === "d")!.age = 16;
    w.clock.set(now - 6 * HOUR);
    await w.net.tick(w.clock.now());
    w.net.forgetMember("d");
  }
  w.clock.set(now);
  if (arm !== "adult") expect(w.net.exportState().opps.find(o => o.id === source.id)!.contacted).not.toContain("d");
  await w.net.tick(now);
  const proposed = w.net.exportState().opps.find(o => o.plan?.repeatOf === source.id);
  if (arm === "adult") expect(proposed).toMatchObject({ generator: "friends_repeat", participants: ids });
  else expect(proposed).toBeUndefined();
});
