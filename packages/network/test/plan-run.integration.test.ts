// The plan run (machines M-045 plan-run, M-046 plan-fallback, M-124 crew sessions) on the real
// ConsentNetwork and the real engine, in the small NYC world. A test hands one plan to the Network
// as the planner would (submitPlan), then drives the members' answers and the clock.
import { describe, expect, test } from "bun:test";
import { DAY, HOUR, type MemberId } from "@thenetwork/core";
import { plans } from "@thenetwork/engine";
import { Mini, START } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });
const PEOPLE: [string, string][] = [["a", "Ana Diaz"], ["b", "Ben Ito"], ["c", "Cy Moss"], ["d", "Dee Park"], ["e", "Eve Lu"], ["f", "Fay Oh"]];

/** The planner is off (no run days): only the plans a test submits exist. */
async function world(ids: MemberId[], opts: { review?: "auto" | "human" } = {}) {
  const w = new Mini(PEOPLE.filter(([id]) => ids.includes(id)).map(([id, name]) => climber(id, name)), { review: opts.review ?? "auto", plansConfig: { runDays: [] } });
  await w.onboard(...ids);
  return w;
}

/** A group plan for bouldering (groupSize [2, 6]) on Saturday 2026-10-17 11:00 New York, as the planner makes it. */
function groupPlan(w: Mini, invited: MemberId[], o: { alternates?: MemberId[]; quorum?: number } = {}): plans.Plan {
  const now = w.clock.now();
  const start = START + 11 * DAY + 22 * HOUR;
  return {
    id: `plan_test_${invited.join("")}`, city: "nyc", activityId: "bouldering", place: { name: "Brooklyn Boulders", area: "Gowanus" },
    window: { start, end: start + 2 * HOUR }, invited, alternates: o.alternates ?? [], partner: false,
    size: { min: 3, target: invited.length, max: 6 }, quorum: o.quorum ?? 3,
    probeDeadline: Math.min(start - 30 * HOUR, now + 96 * HOUR), score: 0.6, u: {}, familiar: {}, createdAt: now, category: "hobby",
  };
}

const submit = (w: Mini, p: plans.Plan): string => (w.net as any).submitPlan(p, w.clock.now()).id;
const opp = (w: Mini, id: string) => (w.net as any).opps.get(id);
const booked = (w: Mini, from: number, id: MemberId) => w.to(id, from).filter(s => /^You're in:/.test(s.body));

/** Answer each member's plan probe as it arrives (probes wait for the send window). */
async function answer(w: Mini, answers: Record<MemberId, string>) {
  const left = new Set(Object.keys(answers));
  for (let i = 0; i < 8 && left.size; i++) {
    await w.runUntil(() => [...left].some(x => w.probed(x)), 2 * DAY);
    for (const x of [...left]) if (w.probed(x)) { await w.say(x, answers[x]!); left.delete(x); }
  }
  return left.size === 0;
}

describe("plan run", () => {
  // SD-008: the engine's fallback for two yes-sayers is a fresh activity-partner plan (one-to-one
  // consent); the Network booked the pair directly and named them to each other.
  test("a group plan that falls to two yes-sayers never books the pair directly", async () => {
    const w = await world(["a", "b", "c"]);
    const from = w.mark();
    submit(w, groupPlan(w, ["a", "b", "c"]));
    expect(await answer(w, { a: "yes", b: "yes", c: "no thanks" })).toBe(true);
    await w.run(2 * DAY);
    expect(w.meetings).toHaveLength(0);
    for (const x of ["a", "b"]) {
      expect(booked(w, from, x)).toHaveLength(0);
      expect(w.to(x, from).map(s => s.body).join(" ")).not.toMatch(/Ana|Ben/);
    }
    // The pair is asked again: a fresh activity-partner plan for the two, through review.
    const partner = [...(w.net as any).opps.values()].filter((o: any) => o.plan?.partner);
    expect(partner.map((o: any) => [...o.participants].sort())).toEqual([["a", "b"]]);
    expect(partner[0].review?.decision).toBe("approve");
  });

  // SD-046: the probe's `about` list was the plan's invited list as approved. A member who left the
  // plan (here: on watch) stayed in it, so every later probe was refused with other_on_watch.
  test("a member who left the plan does not stop the probes to the others", async () => {
    const w = await world(["a", "b", "c", "d"]);
    const id = submit(w, groupPlan(w, ["a", "b", "c", "d"]));
    (w.net as any).trust.add("c", w.clock.now(), "report_received", 3);
    expect(opp(w, id).status.get("c")).toBe("unavailable");
    await answer(w, { a: "yes", b: "yes", d: "yes" });
    expect(w.log("send_refused").filter(l => l.detail.reason === "other_on_watch")).toEqual([]);
    expect(w.meetings.map(m => [...m.participants].sort())).toEqual([["a", "b", "d"]]);
  });

  // SD-078: a booked group that shrank to two stayed on as a two-person meeting nobody agreed to.
  test("a booked group plan that shrinks to two is off", async () => {
    const w = await world(["a", "b", "c"]);
    const id = submit(w, groupPlan(w, ["a", "b", "c"]));
    expect(await answer(w, { a: "yes", b: "yes", c: "yes" })).toBe(true);
    expect(opp(w, id).stage).toBe("scheduled");
    const from = w.mark();
    await w.say("c", "sorry, I can't make it anymore");
    expect(opp(w, id).status.get("c")).toBe("dropped");
    for (const x of ["a", "b"]) expect(w.to(x, from).map(s => s.body)).toEqual([expect.stringMatching(/this one is off now/)]);
    expect(opp(w, id).stage).toBe("closed");
  });
});
