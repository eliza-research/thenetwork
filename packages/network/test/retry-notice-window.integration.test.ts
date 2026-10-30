import { expect, test } from "bun:test";
import { DAY, HOUR, MINUTE } from "@thenetwork/core";
import { allowedAt } from "../src/outreach.ts";
import { Mini } from "./mini.ts";

test("an unsolicited request-retry notice waits for the member's send window through restart", async () => {
  for (const seed of [1, 2, 3]) {
    const x = new Mini([{ id: "a", name: "Alice Able", age: 30, state: "open", interests: ["climbing"], quietHours: [22, 8] }], { seed, review: "human", onboardingRequests: false });
    await x.onboard("a"); await x.say("a", "Find me a climbing partner.");
    await x.run(3 * DAY);
    x.add({ id: "b", name: "Boris Bell", age: 32, interests: ["climbing"], skills: ["climbing_belay"], shareable: true });
    await x.onboard("b");
    expect(await x.runUntil(() => x.net.reviewQueue().length > 0, 2 * DAY)).toBe(true);
    const q = x.net.reviewQueue()[0]!;
    expect(x.net.review(q.oppId, "approve", { reviewer: "sim_staff" })).toBe(true);
    expect(await x.runUntil(() => x.probed("a") || x.probed("b"))).toBe(true);
    if (x.probed("a")) await x.say("a", "yes");
    expect(await x.runUntil(() => x.probed("b"))).toBe(true);
    // The candidate replies at 08:05 NY, outside Alice's quiet hours but before her send window.
    x.clock.set(Math.floor((x.clock.now() + DAY) / DAY) * DAY + 12 * HOUR + 5 * MINUTE);
    const mark = x.mark();
    await x.say("b", "no");
    const notices = () => x.to("a", mark).filter(s => s.body.includes("didn't come together"));
    expect(notices()).toHaveLength(0);
    x.restart();
    expect(await x.runUntil(() => notices().length > 0, 2 * DAY)).toBe(true);
    expect(notices()).toHaveLength(1);
    expect(allowedAt(notices()[0]!.t, [22, 8])).toBe(true);
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" }).format(notices()[0]!.t));
    expect(hour).toBeGreaterThanOrEqual(9);
  }
});
