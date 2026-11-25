import { expect, test } from "vitest";
import { DAY } from "@thenetwork/core";
import { copy } from "../src/copy.ts";
import { nextAt } from "../src/outreach.ts";
import { Mini } from "./mini.ts";
import { holdEveryItem } from "../../engine/src/reviewJudge.ts";

test.each(["expiry", "expiry followed by STOP", "quorum failure"] as const)("the Network releases only contacted acceptors on %s", async cause => {
  // spec/opportunityLifecycle.md, "Closing an underfilled proposal releases the members who accepted"
  const group = cause === "quorum failure";
  const ids = group ? ["a", "b", "c"] : ["a", "b"];
  const w = new Mini(ids.map(id => ({
    id, name: `${id.toUpperCase()}nton Q`, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"],
    skills: ["belaying"], quietHours: id === "c" ? [20, 19] : [21, 9],
  })), { inlineJudge: holdEveryItem.inline, plans: false, growth: false });
  await w.onboard(...ids);
  const id = w.propose(ids);
  const opportunity = () => w.net.exportState().opps.find(o => o.id === id);
  const notices = () => w.sent.filter(s => s.meta.type === "cancellation" && s.meta.proposalId === id);
  expect(await w.runUntil(() => w.net.reviewQueue().some(item => item.oppId === id), 2 * DAY)).toBe(true);
  expect(w.net.review(id, "approve", { reviewer: "sim_staff" })).toBe(true);
  expect(await w.runUntil(() => w.probed("a"), DAY)).toBe(true);
  await w.say("a", "yes");
  expect(opportunity()?.status).toContainEqual(["a", "available"]);
  expect(await w.runUntil(() => w.probed("b"), DAY)).toBe(true);
  expect(notices()).toEqual([]);
  if (group) {
    expect(opportunity()?.contacted).not.toContain("c");
    await w.say("b", "no");
  } else {
    w.clock.set(nextAt(w.clock.now() + 2 * DAY, 22));
    await w.net.tick(w.clock.now());
    expect(notices()).toEqual([]);
    expect(w.net.exportState().deferred.filter(d => d.meta.proposalId === id && d.meta.type === "cancellation")).toHaveLength(1);
  }
  expect(opportunity()?.stage).toBe("closed");
  expect(w.meetings).toEqual([]);
  expect(w.net.memberList().filter(m => m.awaiting?.oppId === id)).toEqual([]);

  w.restart();
  if (cause === "expiry followed by STOP") {
    await w.net.onInbound({ id: "stop-while-release-waits", memberId: "a", body: "STOP", keyword: "STOP", ts: w.clock.now(), channel: "sms" });
  }
  await w.run(DAY);
  w.restart();
  await w.run(DAY);
  const sent = notices();
  if (cause === "expiry followed by STOP") {
    expect(sent).toEqual([]);
    return;
  }
  expect(sent.map(s => s.to)).toEqual(["a"]);
  expect([copy.declinedQuiet, `Great, thanks. ${copy.declinedQuiet}`]).toContain(sent[0]?.body);
  expect(sent[0]?.meta).toEqual({ type: "cancellation", proposalId: id });
  expect(sent[0]?.reply).toBeUndefined();
});
