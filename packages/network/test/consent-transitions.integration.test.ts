// The ConsentNetwork state machine after the decisions moved to transitions.ts: the real Network, the
// real engine and a recording channel, driven by member texts and hourly ticks (Mini). Each case is a
// defect that shipped: consent read from a counter, silence read as a yes, approval past the SLA, a
// number that went one way, a crew offer past the about-others checks, an open report in a plan.
import { describe, expect, test } from "bun:test";
import { DAY, HOUR } from "@thenetwork/core";
import * as plans from "@thenetwork/engine/src/plans.ts";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });
const pair = () => [climber("a", "Ana Diaz"), climber("b", "Ben Ito")];
const opp = (w: Mini, id: string) => (w.net as any).opps.get(id);
const mem = (w: Mini, id: string) => (w.net as any).members.get(id);
const contactOf = (id: string) => (id === "a" ? "+12125550101" : "+12125550102");

/** Who gets the first probe, once it is out. */
async function firstProbed(w: Mini, ids: string[]) {
  expect(await w.runUntil(() => ids.some(id => w.probed(id)))).toBe(true);
  return ids.find(id => w.probed(id))!;
}

describe("only a yes is consent", () => {
  for (const counter of ["rain check", "how about next week?", "could we do a different day", "neither", "none of those work"]) {
    test(`"${counter}" and then silence reaches no reveal`, async () => {
      const w = new Mini(pair());
      await w.onboard("a", "b");
      const id = w.propose(["a", "b"]);
      const first = await firstProbed(w, ["a", "b"]);
      const other = first === "a" ? "b" : "a";
      expect(opp(w, id).offered[first].length).toBeGreaterThan(0);
      await w.say(first, counter);
      expect(opp(w, id).status.get(first)).toBe("probing");
      expect(opp(w, id).primed.has(first)).toBe(false);
      // The other member says yes to anything that reaches them; the first stays silent.
      await w.run(3 * DAY);
      if (w.probed(other)) await w.say(other, "yes");
      await w.run(3 * DAY);
      expect(w.meetings).toEqual([]);
      expect(opp(w, id).stage).toBe("closed");
      expect(w.to(other).some(s => s.body.includes(first === "a" ? "Ana" : "Ben"))).toBe(false);
    });
  }

  test("a counter on a probe with no time options (a job seat) reaches nobody else", async () => {
    const w = new Mini(pair(), { review: "human" });
    await w.onboard("a", "b");
    const id = w.propose(["a", "b"]);
    expect(await w.runUntil(() => opp(w, id)?.stage === "review")).toBe(true);
    opp(w, id).seat = { id: "job:p1", manager: "b" };
    opp(w, id).requester = undefined;
    expect(w.net.decide(id, "approve", { reviewer: "staff" })).toEqual({ ok: true });
    const first = await firstProbed(w, ["a", "b"]);
    const other = first === "a" ? "b" : "a";
    expect(opp(w, id).offered[first]).toEqual([]);
    await w.say(first, "rain check");
    expect(opp(w, id).status.get(first)).toBe("probing");
    expect(w.probed(other)).toBe(false);
  });

  test("other times after a counter: a yes to one of them books it", async () => {
    const w = new Mini(pair());
    await w.onboard("a", "b");
    const id = w.propose(["a", "b"]);
    const first = await firstProbed(w, ["a", "b"]);
    await w.say(first, "neither");
    expect(opp(w, id).timeRetry).toEqual([first]);
    await w.say(first, "yes");
    expect(opp(w, id).status.get(first)).toBe("available");
    await w.answerProbes(["a", "b"]);
    expect(w.meetings.length).toBe(1);
  });

  test('a real yes keeps its place: "yes, but none of those" and then silence stays a yes', async () => {
    const w = new Mini(pair());
    await w.onboard("a", "b");
    const id = w.propose(["a", "b"]);
    const first = await firstProbed(w, ["a", "b"]);
    await w.say(first, "yes, but none of those times work");
    expect(opp(w, id).primed.has(first)).toBe(true);
    expect(opp(w, id).status.get(first)).toBe("probing");
    await w.run(2 * DAY);
    expect(opp(w, id).status.get(first)).toBe("available");
  });
});

describe("the review gate", () => {
  test("past the SLA deadline an item cannot be approved, edited or rerolled before the tick runs", async () => {
    const w = new Mini(pair(), { review: "human", reviewSlaHours: 2 });
    await w.onboard("a", "b");
    const id = w.propose(["a", "b"]);
    expect(await w.runUntil(() => opp(w, id)?.stage === "review")).toBe(true);
    const from = w.mark();
    w.clock.advance(3 * HOUR); // No tick: the expiry in advance() has not run.
    for (const d of ["approve", "edit", "reroll"] as const) expect(w.net.decide(id, d, { reviewer: "staff", objective: "x" })).toEqual({ ok: false, reason: "review_expired" });
    expect(opp(w, id).stage).toBe("review");
    expect(w.to("a", from).concat(w.to("b", from))).toEqual([]);
    await w.net.tick(w.clock.now());
    expect(opp(w, id).stage).toBe("closed");
    expect(opp(w, id).review.decision).toBe("expired");
  });

  test("an open urgent report stops the approval gates and the crew path, not only the engine's gates", async () => {
    const w = new Mini([...pair(), climber("c", "Cal Reyes")], { review: "auto" });
    await w.onboard("a", "b", "c");
    w.propose(["a", "b"]);
    await w.answerProbes(["a", "b"]);
    expect(w.meetings.length).toBe(1);
    await w.say("a", "report Ben, he threatened me");
    expect(w.net.eligible("b" as never)).toBe(false);
    // Filing the report drops the member from open items, so these two gates see a later item: a crew session, or a plan probe.
    expect((w.net as any).planSeatOk(mem(w, "b"))).toBe(false);
    expect((w.net as any).approvalCheck({ id: "later", origin: "player", participants: ["b", "c"] })).toBe("report_held");
  });
});

describe("a number swap", () => {
  async function matched() {
    const w = new Mini(pair(), { review: "auto" });
    await w.onboard("a", "b");
    w.propose(["a", "b"]);
    await w.answerProbes(["a", "b"]);
    expect(w.meetings.length).toBe(1);
    await w.say("a", "thanks!"); await w.say("b", "thanks!");
    await w.until(14);
    expect(await w.net.relayRequest({ itemId: "c1", from: "a", kind: "contact_share" }, { contactOf })).toMatchObject({ decision: "held" });
    return w;
  }
  const numbers = (w: Mini, from: number) => w.sent.slice(from).filter(s => /\+1212/.test(s.body));

  test("goes both ways when both shares can go", async () => {
    const w = await matched();
    const from = w.mark();
    expect(await w.net.relayRequest({ itemId: "c2", from: "b", kind: "contact_share" }, { contactOf })).toMatchObject({ decision: "sent" });
    expect(numbers(w, from).map(s => s.to).sort()).toEqual(["a", "b"]);
  });

  test("never goes one way: a member past the streak limit stops both shares", async () => {
    const w = await matched();
    mem(w, "a").outbound = 3; // Three texts since the first member's request: send() refuses logistics to them.
    const from = w.mark();
    expect(await w.net.relayRequest({ itemId: "c2", from: "b", kind: "contact_share" }, { contactOf })).toMatchObject({ decision: "refused" });
    expect(numbers(w, from)).toEqual([]);
    expect((w.net as any).relayDesk.records().filter((r: any) => r.contactShared)).toEqual([]);
  });

  test("never goes one way: a share that would wait for quiet hours stops both", async () => {
    const w = await matched();
    mem(w, "a").quietHours = [0, 23.99];
    w.members.find(x => x.id === "a")!.prefs!.quietHours = [0, 23.99] as never;
    const from = w.mark();
    expect(await w.net.relayRequest({ itemId: "c2", from: "b", kind: "contact_share" }, { contactOf })).toMatchObject({ decision: "refused" });
    expect(numbers(w, from)).toEqual([]);
    expect((w.net as any).deferred.filter((d: any) => d.kind === "relay")).toEqual([]);
  });
});

describe("crew offers", () => {
  test("a member found to be a minor after the plan gets no offer, and no crew names them", async () => {
    const ids = ["a", "b", "c", "d"];
    const w = new Mini(ids.map((id, i) => climber(id, `${["Ana Diaz", "Ben Ito", "Cal Reyes", "Dee Marsh"][i]}`)));
    await w.onboard(...ids);
    const id = w.propose(ids);
    await w.answerProbes(ids);
    expect(w.meetings.length).toBe(1);
    const o = opp(w, id);
    const activity = [...plans.activityById.values()][0]!;
    o.stage = "done";
    o.plan = { activityId: activity.id, window: { start: w.clock.now() }, place: { name: "the wall" } };
    o.post = Object.fromEntries(ids.map(p => [p, { came: true, again: true, otherNoShow: false, named: [] }]));
    w.members.find(x => x.id === "b")!.age = 16;
    const from = w.mark();
    (w.net as any).crewCheck(mem(w, "a"), o, ids);
    expect(w.to("b", from)).toEqual([]);
    const offers = (w.net as any).crewOffers;
    if (offers.length) expect(offers[0].crew.members).not.toContain("b");
  });
});
