import { expect, test } from "vitest";
import { DAY } from "@thenetwork/core";
import { Mini } from "./mini.ts";
import { holdEveryItem } from "../../engine/src/reviewJudge.ts";

const CLOSED_REPLY = "Closed: “find a regular climbing partner”. Reply UNDO within 24 hours to keep it.";

test("an explicitly withdrawn waiting request stays closed after restart and a new ask can reopen the search", async () => {
  for (const seed of [1, 2, 3]) for (const mode of ["withdraw", "keep", "other-want", "assistant"] as const) {
    const x = new Mini([{ id: "a", name: "Alice Able", age: 30, interests: ["climbing"] }], { seed, inlineJudge: holdEveryItem.inline, onboardingRequests: true });
    await x.onboard("a");
    await x.say("a", "Find me a climbing partner.");
    const request = x.net.exportState().requests.at(-1)!;
    expect(request.outcome).toBe("none");
    expect(request.tries).toBe(1);
    if (mode === "withdraw") await x.say("a", "I no longer want a climbing partner.");
    else if (mode !== "keep") await x.net.onInbound({ id: "correction", memberId: "a", source: "mcp", channel: "sms", ts: x.clock.now(),
      body: mode === "other-want" ? "I no longer want to meet other founders." : "I no longer want a climbing partner." });
    const memberA = x.net.exportState().members.find(m => m.id === "a")!;
    const check = memberA.assistantProfileCheck;
    if (mode === "assistant") {
      expect(request.desireId).toBe("climbing_partner");
      expect(memberA.learned.desires.map(([d]) => d)).toContain("climbing_partner");
      expect(check?.items).toEqual([{ key: "learned:climbing_partner", reason: "said_not_wanted" }]);
    }
    else expect(check?.items ?? []).toEqual([]);
    expect(x.sent.filter(s => s.to === "a").at(-1)!.body === CLOSED_REPLY).toBe(mode === "withdraw");
    x.restart();
    x.add({ id: "b", name: "Boris Bell", age: 32, interests: ["climbing"], skills: ["climbing_belay"], shareable: true });
    await x.onboard("b");
    const withdrawn = mode === "withdraw";
    expect(await x.runUntil(() => x.net.reviewQueue().length > 0, 2 * DAY)).toBe(!withdrawn);
    const old = x.net.exportState().requests.find(r => r.id === request.id)!;
    expect(old.closed ?? false).toBe(withdrawn);
    expect(old.withdrawn ?? false).toBe(withdrawn);
    expect(old.outcome).toBe(withdrawn ? "none" : "probing");
    if (withdrawn) expect(old.tries).toBe(1);
    else expect(old.tries!).toBeGreaterThan(1);
    expect(x.net.reviewQueue().map(item => item.oppId)).toEqual(withdrawn ? [] : [old.oppId]);
    expect(x.sent.some(s => s.meta.type === "probe")).toBe(false);
    if (withdrawn) {
      await x.say("a", "Find me a climbing partner.");
      await x.net.tick(x.clock.now());
      expect(x.net.exportState().requests.at(-1)!.id).not.toBe(request.id);
      expect(x.net.reviewQueue()).toHaveLength(1);
    }
  }
  for (const seed of [1, 2, 3]) for (const source of ["thread", "mcp"] as const) {
    const x = new Mini([{ id: "a", name: "Alice Able", age: 30, interests: ["climbing"] },
      { id: "b", name: "Boris Bell", age: 32, interests: ["climbing"], skills: ["climbing_belay"], shareable: true }], { seed, inlineJudge: holdEveryItem.inline, onboardingRequests: false });
    await x.onboard("a", "b");
    await x.say("a", "Find me a climbing partner.");
    await x.net.tick(x.clock.now());
    const request = x.net.exportState().requests.at(-1)!;
    expect(request.outcome).toBe("probing");
    expect(x.net.reviewQueue()).toHaveLength(1);
    if (source === "thread") await x.say("a", "I no longer want a climbing partner.");
    else await x.net.onInbound({ id: "withdraw-in-review", memberId: "a", source: "mcp", channel: "sms", ts: x.clock.now(), body: "I no longer want a climbing partner." });
    expect(x.sent.filter(s => s.to === "a").at(-1)!.body === CLOSED_REPLY).toBe(source === "thread");
    x.restart();
    expect(x.net.exportState().requests.find(r => r.id === request.id)!.withdrawn ?? false).toBe(source === "thread");
    expect(x.net.reviewQueue()).toHaveLength(source === "thread" ? 0 : 1);
    expect(x.net.review(request.oppId!, "approve", { reviewer: "sim_staff" })).toBe(source === "mcp");
    await x.run(2 * DAY);
    expect(x.sent.some(s => s.meta.type === "probe")).toBe(source === "mcp");
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
