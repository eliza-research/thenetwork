// The check-in answer after a date is a record for the engine's history (slopPack histories):
// dates, no-shows and the week slots a member went to a date at. Each answer is about the member
// who gave it. A member who says "I couldn't make it" is the no-show, not the partner who came
// (SD-222). The slot learned is the slot of the date, not the time of the answer (SD-442).
import { describe, expect, test } from "bun:test";
import { DAY, HOUR } from "@thenetwork/core";
import { slopProfiles } from "@thenetwork/engine";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });
const awaiting = (w: Mini, id: string) => w.net.memberList().find(m => m.id === id)?.awaiting?.kind;

async function afterDate() {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "auto" });
  await w.onboard("a", "b");
  w.propose(["a", "b"]);
  await w.answerProbes(["a", "b"]);
  expect(w.meetings.length).toBe(1);
  expect(await w.runUntil(() => awaiting(w, "a") === "feedback" && awaiting(w, "b") === "feedback", 10 * DAY)).toBe(true);
  return w;
}

/** The engine's slop history of each member, from the Network's own records. */
function histories(w: Mini) {
  const snap = w.ctx().snapshot();
  const st = w.net.exportState();
  const input = { ...snap, feedback: st.feedback, interactions: st.interactions };
  const p = slopProfiles(input);
  return { a: p.get("a")!.history, b: p.get("b")!.history };
}

describe("the check-in answer in the engine's history", () => {
  test("SD-222: a self-reported no-show counts against that member only", async () => {
    const w = await afterDate();
    await w.say("b", "Sorry, I couldn't make it.");
    await w.say("a", "It was fine.");
    const h = histories(w);
    expect([h.a.noShows, h.a.dates]).toEqual([0, 1]);
    expect([h.b.noShows, h.b.dates]).toEqual([1, 0]);
  });

  test("SD-442: the slot learned is the slot of the date, not of the answer", async () => {
    const soon = await afterDate();
    await soon.say("a", "It was fine.");
    const late = await afterDate();
    await late.run(DAY + 12 * HOUR);
    await late.say("a", "It was fine.");
    const at = late.meetings[0]!.at;
    expect(late.net.exportState().interactions.find(x => x.id.endsWith(":fb:a"))?.at).toBe(at);
    expect(histories(late).a.attendedSlots).toEqual(histories(soon).a.attendedSlots);
  });
});
