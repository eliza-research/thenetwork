import { expect, test } from "bun:test";
import { DAY } from "@thenetwork/core";
import { Mini } from "./mini.ts";

test("an explicitly withdrawn waiting request stays closed after restart and a new ask can reopen the search", async () => {
  for (const seed of [1, 2, 3]) for (const mode of ["withdraw", "keep", "other-want", "reask"] as const) {
    const x = new Mini([{ id: "a", name: "Alice Able", age: 30, interests: ["climbing"] }], { seed, review: "human", onboardingRequests: true });
    await x.onboard("a");
    await x.say("a", "Find me a climbing partner.");
    const request = x.net.exportState().requests.at(-1)!;
    expect(request.outcome).toBe("none");
    expect(request.tries).toBe(1);
    if (mode !== "keep") await x.net.onInbound({ id: "correction", memberId: "a", source: "mcp", channel: "sms", ts: x.clock.now(),
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
      expect(x.net.exportState().requests.at(-1)!.id).not.toBe(request.id);
      expect(x.net.reviewQueue()).toHaveLength(1);
    }
  }
  for (const seed of [1, 2, 3]) {
    const x = new Mini([{ id: "a", name: "Alice Able", age: 30, interests: ["climbing"] },
      { id: "b", name: "Boris Bell", age: 32, interests: ["climbing"], skills: ["climbing_belay"], shareable: true }], { seed, review: "human", onboardingRequests: false });
    await x.onboard("a", "b");
    await x.say("a", "Find me a climbing partner.");
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
