import { describe, expect, test } from "vitest";
import { HOUR } from "@thenetwork/core";
import { Mini, type Spec } from "./mini.ts";
import { simulatedReviewJudge } from "../../engine/src/reviewJudge.ts";

const climber = (id: string, name: string): Spec => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" }] });

async function probedPair(app: "ntwrk" | "slop") {
  const slop = app === "slop";
  const people = slop
    ? [{ ...climber("a", "Ana Diaz"), romance: { is: "woman", seeks: ["man"] } }, { ...climber("b", "Ben Ito"), romance: { is: "man", seeks: ["woman"] } }]
    : [climber("a", "Ana Diaz"), climber("b", "Ben Ito")];
  const w = new Mini(people, { app, inlineJudge: simulatedReviewJudge({ exceptions: false }) });
  await w.onboard("a", "b");
  w.propose(["a", "b"], slop ? { category: "romance", objective: "a first date" } : {});
  expect(await w.runUntil(() => w.probed("a") || w.probed("b"))).toBe(true);
  const id = w.probed("a") ? "a" : "b";
  return { w, id, other: id === "a" ? "b" : "a" };
}

const lastAsk = (w: Mini, id: string, type: string) => w.to(id).filter(s => s.meta.type === type).at(-1)!;

async function tickAt(w: Mini, at: number) {
  w.clock.set(at);
  await w.net.tick(at);
}

describe("probeDispatch: A reply or an expired deadline settles the probe", () => {
  test.each([["ntwrk", 48], ["slop", 24]] as const)("an unanswered %s probe expires %d hours after it went out", async (app, hours) => {
    const { w, id } = await probedPair(app);
    const probe = lastAsk(w, id, "probe");
    await tickAt(w, probe.t + hours * HOUR - 1);
    expect(w.probed(id)).toBe(true);
    expect(w.log("probe_answer").filter(l => l.detail.memberId === id)).toEqual([]);
    await tickAt(w, probe.t + hours * HOUR);
    expect(w.probed(id)).toBe(false);
    expect(w.log("probe_answer").filter(l => l.detail.memberId === id).map(l => l.detail.expired)).toEqual([true]);
  });

  test("an unanswered time question ends 24 hours after it went out and keeps the yes", async () => {
    const { w, id, other } = await probedPair("ntwrk");
    await w.say(id, "Yes, but none of those times work for me");
    const question = lastAsk(w, id, "scheduling");
    expect(question).toBeDefined();
    expect(w.probed(id)).toBe(true);
    await tickAt(w, question.t + 24 * HOUR - 1);
    expect(w.probed(id)).toBe(true);
    expect(w.probed(other)).toBe(false);
    await tickAt(w, question.t + 24 * HOUR);
    expect(w.probed(other)).toBe(true);
    expect(w.log("probe_answer").filter(l => l.detail.memberId === id && l.detail.expired)).toEqual([]);
  });
});
