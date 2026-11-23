import { expect, test } from "vitest";
import { DAY, HOUR } from "@thenetwork/core";
import { standingIntentCommand } from "../src/standing-intents.ts";
import { Mini } from "./mini.ts";
import { holdEveryItem } from "../../engine/src/reviewJudge.ts";

const climber = { id: "a", name: "Alice Able", age: 30, interests: ["climbing"] };
const belayer = { id: "b", name: "Boris Bell", age: 32, interests: ["climbing"], skills: ["climbing_belay"], shareable: true };

function command(x: Mini, text: string, causeId: string) {
  const parsed = standingIntentCommand(text);
  expect(parsed).toBeDefined();
  return x.net.manageStandingIntents("a", parsed!, true, causeId);
}

function profileText(x: Mini, id: string, body: string) {
  return x.net.onInbound({ id, memberId: "a", source: "mcp", channel: "sms", ts: x.clock.now(), body });
}

test("a paused want stays paused when profile text or the member's own ask names it again", async () => {
  for (const seed of [1, 2, 3]) {
    const x = new Mini([climber, belayer], { seed, inlineJudge: holdEveryItem.inline, onboardingRequests: false });
    await x.onboard("a", "b");
    await x.say("a", "Find me a climbing partner.");
    await x.net.tick(x.clock.now());
    const requests = x.net.exportState().requests.length;
    expect(x.net.reviewQueue()).toHaveLength(1);
    expect(command(x, "what am I looking for", "list-1").kind).toBe("reply");
    expect(command(x, "pause 1", "pause-1")).toEqual({ kind: "reply", body: "Paused: “find a regular climbing partner”. No new searches for it. Reply UNDO to turn it back on." });
    expect(x.net.reviewQueue()).toHaveLength(0);

    await profileText(x, "profile-again", "I want a climbing partner.");
    expect(x.net.exportState().requests).toHaveLength(requests);
    expect(x.net.reviewQueue()).toHaveLength(0);
    expect(x.net.standingView("a").entries.map(e => e.status)).toEqual(["paused"]);

    const before = x.sent.length;
    await x.say("a", "Find me a climbing partner.");
    expect(x.net.exportState().requests).toHaveLength(requests);
    expect(x.net.reviewQueue()).toHaveLength(0);
    expect(x.sent.slice(before).filter(s => s.to === "a").map(s => s.body)).toEqual([
      "“find a regular climbing partner” is paused, so I'm not looking for it now. Say “what am I looking for” to see your list and turn it back on.",
    ]);

    await x.run(2 * DAY);
    expect(x.sent.some(s => s.meta.type === "probe")).toBe(false);
    expect(x.net.standingView("a").entries.map(e => e.status)).toEqual(["paused"]);
  }
});

test("profile text does not bring back a closed request that has no desire, and the member's own ask does", async () => {
  for (const seed of [1, 2, 3]) {
    const x = new Mini([climber], { seed, inlineJudge: holdEveryItem.inline, onboardingRequests: false });
    await x.onboard("a");
    await x.say("a", "Find me someone who loves birdwatching.");
    const closed = x.net.exportState().requests.at(-1)!;
    expect(closed.desireId).toBeUndefined();
    expect(command(x, "what am I looking for", "list-1").kind).toBe("reply");
    const close = command(x, "close 1", "close-1");
    expect(close.kind === "reply" && close.body.startsWith("Closed: ")).toBe(true);
    const requests = x.net.exportState().requests.length;

    await profileText(x, "profile-replay", "Find me someone who loves birdwatching.");
    expect(x.net.exportState().requests).toHaveLength(requests);
    expect(x.net.standingView("a").checkWithPerson.map(c => c.reason)).toEqual(["ended_recently"]);
    expect(x.net.standingView("a").entries).toHaveLength(0);

    await x.say("a", "Find me someone who loves birdwatching.");
    const reopened = x.net.exportState().requests.at(-1)!;
    expect(x.net.exportState().requests).toHaveLength(requests + 1);
    expect(reopened.id).not.toBe(closed.id);
    expect(reopened.withdrawn ?? false).toBe(false);
  }
});

test("the later close of an introduction that a pause kept tells the paused member nothing", async () => {
  for (const seed of [1, 2, 3]) {
    const x = new Mini([climber, belayer], { seed, inlineJudge: holdEveryItem.inline, onboardingRequests: false });
    await x.onboard("a", "b");
    await x.say("a", "Find me a climbing partner.");
    const request = x.net.exportState().requests.at(-1)!;
    const oppId = request.oppId!;
    await x.net.tick(x.clock.now());
    expect(x.net.review(oppId, "approve", { reviewer: "sim_staff" })).toBe(true);
    expect(await x.runUntil(() => x.probed("a"))).toBe(true);
    await x.say("a", "Yes, that works for me.");
    expect(await x.runUntil(() => x.probed("b"))).toBe(true);
    expect(command(x, "what am I looking for", "list-1").kind).toBe("reply");
    expect(command(x, "pause 1", "pause-1")).toEqual({ kind: "reply", body:
      "Paused: “find a regular climbing partner”. No new searches for it. Reply UNDO to turn it back on. An introduction already in progress continues. Reply CLOSE to close that too." });
    const pausedAt = x.mark();
    await x.say("b", "No, thanks.");
    await x.run(2 * HOUR);
    expect(x.net.exportState().opps.find(o => o.id === oppId)!.stage).toBe("closed");
    expect(x.sent.slice(pausedAt).filter(s => s.to === "a")).toEqual([]);
    const after = x.net.exportState().requests.find(r => r.id === request.id)!;
    expect(after).toMatchObject({ withdrawn: true, closed: true, outcome: "none" });
  }
});

test("CLOSE to a pause text that named no introduction asks first when an introduction started later", async () => {
  for (const seed of [1, 2, 3]) {
    const x = new Mini([climber, belayer], { seed, inlineJudge: holdEveryItem.inline, onboardingRequests: false });
    await x.onboard("a", "b");
    await x.say("a", "Find me a climbing partner.");
    const oppId = x.net.exportState().requests.at(-1)!.oppId!;
    await x.net.tick(x.clock.now());
    expect(x.net.review(oppId, "approve", { reviewer: "sim_staff" })).toBe(true);
    expect(await x.runUntil(() => x.probed("a"))).toBe(true);
    expect(command(x, "what am I looking for", "list-1").kind).toBe("reply");
    expect(command(x, "pause 1", "pause-1")).toEqual({ kind: "reply", body: "Paused: “find a regular climbing partner”. No new searches for it. Reply UNDO to turn it back on." });
    await x.say("a", "Yes, that works for me.");
    expect(await x.runUntil(() => x.probed("b"))).toBe(true);
    expect(command(x, "CLOSE", "close-reply")).toEqual({ kind: "reply", body:
      "“find a regular climbing partner” is paused: no new searches. An introduction for it is already in progress. Reply CLOSE to close it and that introduction, or KEEP to turn the search back on." });
    expect(x.net.exportState().opps.find(o => o.id === oppId)!.stage).toBe("probing");
  }
});
