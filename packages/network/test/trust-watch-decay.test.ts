// Trust watch (trust.ts): a score of 3 to 5 is "watch", and clean time pays the score down one point
// per 14 days. So a watch from 3 lasts 14 clean days. The decay clock starts again at each new abuse
// event: an event the day before an old 14-day step must not lose its point the next day (SD-141).
import { describe, expect, test } from "bun:test";
import { DAY, HOUR } from "@thenetwork/core";
import { Mini } from "./mini.ts";

const SPAM = "Use my code for 20% off my coaching business"; // sales_spam, 2 points
const level = (w: Mini, id: string) => w.net.exportState().trust.find(r => r.id === id)?.level ?? "ok";
const score = (w: Mini, id: string) => w.net.exportState().trust.find(r => r.id === id)?.score ?? 0;

describe("trust watch decay", () => {
  test("SD-141: a watch reached the day before an old decay step lasts 14 days", async () => {
    const w = new Mini([{ id: "a", name: "Ana Diaz", age: 30, interests: ["climbing"] }], { review: "auto" });
    await w.onboard("a");
    const t0 = w.clock.now();
    await w.say("a", SPAM);
    expect(score(w, "a")).toBe(2);
    await w.run(15 * DAY);
    expect(score(w, "a")).toBe(1); // one clean step (the daily run on day 15)
    // Day 28, after that day's run: the second event takes the score to 3 (watch), less than a day
    // before the next daily run, which is past the old grid's second step (day 28).
    await w.run(t0 + 28 * DAY + HOUR - w.clock.now());
    await w.say("a", SPAM);
    expect(level(w, "a")).toBe("watch");
    const watchAt = w.clock.now();
    await w.run(13 * DAY);
    expect(w.clock.now() - watchAt).toBeLessThan(14 * DAY);
    expect(level(w, "a")).toBe("watch");
  });
});
