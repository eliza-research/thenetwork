import { expect, test } from "vitest";
import { DAY, HOUR, MINUTE } from "@thenetwork/core";
import { Mini } from "./mini.ts";

test("feedback: resumed ticks keep check-in reply state after a booking expires", async () => {
    const outcomes: { seed: number; kind: string; prompts: number; awaiting: string; recorded: string; stage: string }[] = [];
    for (const seed of [1, 2, 3]) for (const kind of ["continuous", "resumed_missed", "resumed_neutral", "quiet_gap", "future_booking"]) {
      const w = new Mini([
        { id: "a", name: "Ana Diaz", age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], quietHours: kind === "quiet_gap" ? [16, 9] : [23, 8] },
        { id: "b", name: "Ben Ito", age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], quietHours: kind === "quiet_gap" ? [16, 9] : [23, 8] },
      ], { seed, review: "human", growth: false });
      // Friday: book Saturday, so the booking reply state is still live an hour before the meeting.
      w.clock.advance(4 * DAY);
      await w.onboard("a", "b");
      const id = w.propose(["a", "b"], { category: "hobby", objective: "a climbing session" });
      await w.runUntil(() => w.net.reviewQueue().some(q => q.oppId === id), DAY);
      expect(w.net.decide(id, "approve", { reviewer: "staff" })).toEqual({ ok: true });
      await w.answerProbes(["a", "b"]);
      expect(w.meetings.length).toBe(1);
      const at = w.meetings[0]!.at;
      await w.run(at - HOUR - w.clock.now());
      // A new inbound clears the conversation streak without answering the booked question.
      for (const id of ["a", "b"]) await w.say(id, "I visited the library this morning.");
      w.restart();
      expect(w.net.memberList().find(m => m.id === "a")?.awaiting?.kind).toBe("booked");
      const prompts = () => w.sent.filter(m => m.to === "a" && m.meta.type === "feedback_request").length;
      if (kind === "continuous") await w.runUntil(() => prompts() > 0, DAY);
      else {
        w.clock.set(at + (kind === "future_booking" ? -HOUR / 2 : 3 * HOUR));
        await w.net.tick(w.clock.now());
      }
      if (kind === "quiet_gap") {
        expect(prompts()).toBe(0);
        await w.runUntil(() => prompts() > 0, DAY);
      }
      // A second tick must not send the question again. Persist the new waiting state before replying.
      w.clock.advance(MINUTE);
      await w.net.tick(w.clock.now());
      w.restart();
      const awaiting = w.net.memberList().find(m => m.id === "a")?.awaiting?.kind ?? "none";
      await w.say("a", kind === "future_booking" ? "I can't make it" : kind === "resumed_neutral" ? "A little tiring." : "I couldn't make it");
      w.restart();
      const history = w.net.engineInput(w.clock.now()).interactions?.filter(r => r.id === `${id}:fb:a`) ?? [];
      expect(history.length).toBeLessThanOrEqual(1);
      outcomes.push({ seed, kind, prompts: prompts(), awaiting, recorded: history[0]?.outcome ?? "none",
        stage: w.net.exportState().opps.find(o => o.id === id)!.stage });
    }
    for (const row of outcomes) expect(row).toEqual({ seed: row.seed, kind: row.kind,
      prompts: row.kind === "future_booking" ? 0 : 1, awaiting: row.kind === "future_booking" ? "booked" : "feedback",
      recorded: row.kind === "future_booking" ? "none" : row.kind === "resumed_neutral" ? "completed" : "no_show",
      stage: row.kind === "future_booking" ? "closed" : "done" });
  });
