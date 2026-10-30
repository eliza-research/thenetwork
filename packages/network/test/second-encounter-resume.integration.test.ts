import { expect, test } from "bun:test";
import { DAY, HOUR } from "@thenetwork/core";
import { Mini } from "./mini.ts";

test("mutual repeat interest survives a temporary pause and queues once after resume", async () => {
  for (const seed of [1, 2, 3]) for (const pause of [false, true]) {
    const x = new Mini([{ id: "a", name: "Alice Able", age: 30, interests: ["climbing", "hiking"] }, { id: "b", name: "Boris Bell", age: 32, interests: ["climbing", "hiking"] }], { seed, review: "auto" });
    await x.onboard("a", "b");
    x.propose(["a", "b"]); await x.answerProbes(["a", "b"]);
    expect(x.meetings.length).toBe(1);
    await x.run(x.meetings[0]!.at + 4 * HOUR - x.clock.now());
    for (const id of ["a", "b"]) await x.say(id, "We clicked, it was great, would meet again.");
    const mutual = () => x.net.exportState().again.some(([key, ids]) => key === "a|b" && ids.includes("a") && ids.includes("b"));
    const repeats = () => x.net.exportState().opps.filter(o => o.origin === "second_encounter");
    expect(mutual()).toBe(true);
    if (pause) x.members.find(m => m.id === "a")!.state = "paused";
    const mark = x.mark();
    x.restart(); await x.run(DAY);
    if (pause) {
      expect(repeats().length).toBe(0);
      expect(mutual()).toBe(true);
      expect(x.sent.slice(mark).some(s => s.meta.type === "probe")).toBe(false);
      x.members.find(m => m.id === "a")!.state = "normal";
      for (const id of ["a", "b"]) await x.say(id, "hi");
      x.restart(); await x.run(2 * DAY);
    }
    expect(repeats().length).toBe(1);
    expect(mutual()).toBe(false);
  }
});
