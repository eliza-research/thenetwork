import { expect, test } from "vitest";
import { DAY } from "@thenetwork/core";
import { Mini } from "./mini.ts";
import { holdEveryItem } from "../../engine/src/reviewJudge.ts";

test("an explicitly withdrawn waiting request stays closed after restart and a new ask can reopen the search", async () => {
  for (const seed of [1, 2, 3]) for (const mode of ["withdraw", "keep", "other-want", "reask"] as const) {
    const x = new Mini([{ id: "a", name: "Alice Able", age: 30, interests: ["climbing"] }], { seed, inlineJudge: holdEveryItem.inline, onboardingRequests: true });
    await x.onboard("a");
    await x.say("a", "Find me a climbing partner.");
    const request = x.net.exportState().requests.at(-1)!;
    expect(request.outcome).toBe("none");
    expect(request.tries).toBe(1);
    if (mode === "withdraw") await x.say("a", "I no longer want a climbing partner.");
    else if (mode !== "keep") await x.net.onInbound({ id: "correction", memberId: "a", source: "mcp", channel: "sms", ts: x.clock.now(),
      body: mode === "other-want" ? "I no longer want to meet other founders." : "I no longer want a climbing partner." });
    x.restart();
    x.add({ id: "b", name: "Boris Bell", age: 32, interests: ["climbing"], skills: ["climbing_belay"], shareable: true });
    await x.onboard("b");
    await x.run(2 * DAY);
    const old = x.net.exportState().requests.find(r => r.id === request.id)!;
    const withdrawn = mode === "withdraw" || mode === "reask";
    expect(old.closed ?? false).toBe(withdrawn);
    expect(old.withdrawn ?? false).toBe(withdrawn);
    expect(old.outcome).toBe(withdrawn ? "none" : "probing");
    if (withdrawn) expect(old.tries).toBe(1);
    else expect(old.tries!).toBeGreaterThan(1);
    expect(x.net.reviewQueue().length).toBe(withdrawn ? 0 : 1);
    expect(x.sent.some(s => s.meta.type === "probe")).toBe(false);
    if (mode === "reask") {
      await x.say("a", "Find me a climbing partner.");
      await x.net.tick(x.clock.now());
      expect(x.net.exportState().requests.at(-1)!.id).not.toBe(request.id);
      expect(x.net.reviewQueue()).toHaveLength(1);
    }
  }
  for (const seed of [1, 2, 3]) {
    const x = new Mini([{ id: "a", name: "Alice Able", age: 30, interests: ["climbing"] },
      { id: "b", name: "Boris Bell", age: 32, interests: ["climbing"], skills: ["climbing_belay"], shareable: true }], { seed, inlineJudge: holdEveryItem.inline, onboardingRequests: false });
    await x.onboard("a", "b");
    await x.say("a", "Find me a climbing partner.");
    await x.net.tick(x.clock.now());
    const request = x.net.exportState().requests.at(-1)!;
    expect(request.outcome).toBe("probing");
    expect(x.net.reviewQueue()).toHaveLength(1);
    await x.net.onInbound({ id: "withdraw-in-review", memberId: "a", source: "mcp", channel: "sms", ts: x.clock.now(), body: "I no longer want a climbing partner." });
    x.restart();
    expect(x.net.exportState().requests.find(r => r.id === request.id)!.withdrawn).toBe(true);
    expect(x.net.reviewQueue()).toHaveLength(0);
    expect(x.net.review(request.oppId!, "approve", { reviewer: "sim_staff" })).toBe(false);
    await x.run(2 * DAY);
    expect(x.sent.some(s => s.meta.type === "probe")).toBe(false);
  }
});

// spec/opportunityLifecycle.md, "A member can withdraw probe consent before the reveal"
test("a requester can withdraw an accepted probe while the other reply is pending", async () => {
  const x = new Mini([
    { id: "a", name: "Alice Able", age: 30, interests: ["climbing"] },
    { id: "b", name: "Boris Bell", age: 32, interests: ["climbing"], skills: ["climbing_belay"], shareable: true },
  ], { inlineJudge: holdEveryItem.inline, onboardingRequests: false });
  await x.onboard("a", "b");
  await x.say("a", "Find me a climbing partner.");
  const request = x.net.exportState().requests.at(-1)!;
  const oppId = request.oppId!;
  await x.net.tick(x.clock.now());
  expect(x.net.review(oppId, "approve", { reviewer: "sim_staff" })).toBe(true);
  expect(await x.runUntil(() => x.probed("a"))).toBe(true);
  await x.say("a", "Yes, that works for me.");
  const opportunity = () => x.net.exportState().opps.find(o => o.id === oppId)!;
  expect(opportunity().status).toContainEqual(["a", "available"]);
  await x.net.onInbound({ id: "assistant-not-consent", memberId: "a", source: "mcp", channel: "sms", ts: x.clock.now(), body: "Not this week, thanks." });
  expect(opportunity().stage).toBe("probing");
  await x.say("a", "Not this week, thanks.");
  expect(opportunity()).toMatchObject({ stage: "closed", closedReason: "consent withdrawn" });
  expect(opportunity().status).toContainEqual(["a", "no"]);
  x.restart();
  await x.say("b", "Yes, that works for me.");
  await x.run(2 * DAY);
  expect(x.meetings.some(meeting => meeting.proposalId === oppId)).toBe(false);
  expect(x.sent.some(message => message.meta.type === "proposal" && message.meta.proposalId === oppId)).toBe(false);
});
