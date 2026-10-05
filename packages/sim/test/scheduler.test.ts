import { describe, expect, test } from "bun:test";
import { HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { EventQueue, Scheduler } from "../src/index.ts";

describe("SimClock", () => {
  test("is monotonic", () => {
    const c = new SimClock(1000);
    c.advance(10); c.set(2000);
    expect(c.now()).toBe(2000);
    expect(() => c.set(1999)).toThrow();
    expect(() => c.advance(-1)).toThrow();
  });
});

describe("discrete-event scheduler", () => {
  test("orders by time, then insertion order for ties", () => {
    const q = new EventQueue();
    q.push(30, "c", 1); q.push(10, "a", 1); q.push(20, "b", 1); q.push(10, "a", 2); q.push(10, "a", 3);
    const out: string[] = [];
    while (q.size) { const e = q.pop()!; out.push(`${e.kind}${e.data}`); }
    expect(out).toEqual(["a1", "a2", "a3", "b1", "c1"]);
  });

  test("jumps the clock to each event; events scheduled in handlers run in order; clock never goes back", async () => {
    const clock = new SimClock(0);
    const s = new Scheduler(clock, { mode: "discrete" });
    const seen: [string, number][] = [];
    s.on<string>("e", ev => {
      seen.push([ev.data, clock.now()]);
      if (ev.data === "first") { s.after(5 * MINUTE, "e", "child"); s.at(0, "e", "past-clamped"); }
    });
    s.at(HOUR, "e", "first");
    s.at(2 * HOUR, "e", "last");
    await s.runUntil(3 * HOUR);
    expect(seen).toEqual([["first", HOUR], ["past-clamped", HOUR], ["child", HOUR + 5 * MINUTE], ["last", 2 * HOUR]]);
    expect(clock.now()).toBe(3 * HOUR);
    for (let i = 1; i < seen.length; i++) expect(seen[i]![1]).toBeGreaterThanOrEqual(seen[i - 1]![1]);
  });

  test("events beyond the horizon stay queued", async () => {
    const clock = new SimClock(0);
    const s = new Scheduler(clock, { mode: "discrete" });
    let n = 0;
    s.on("e", () => { n++; });
    s.at(10, "e", 0); s.at(100, "e", 0);
    await s.runUntil(50);
    expect(n).toBe(1);
    expect(s.queue.size).toBe(1);
  });

  test("accelerated mode sleeps (sim gap / speed) wall-ms between events", async () => {
    const clock = new SimClock(0);
    const sleeps: number[] = [];
    const s = new Scheduler(clock, { mode: "accelerated", speed: 60, sleep: async ms => { sleeps.push(ms); } });
    s.on("e", () => {});
    s.at(MINUTE, "e", 0); s.at(3 * MINUTE, "e", 0);
    await s.runUntil(3 * MINUTE);
    expect(sleeps).toEqual([1000, 2000]);
  });
});
