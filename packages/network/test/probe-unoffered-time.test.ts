// A probe reply that names a day nobody offered must never book: "Friday works" is not "any of these".
// These drive the real Network/engine through Mini and assert what lands in the opportunity (picks,
// declinedTimes) and in the member's availability history, not just the parser's return value.
import { describe, expect, test } from "bun:test";
import { availabilityTags } from "../src/classify.ts";
import { Mini } from "./mini.ts";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });

type Offered = { key: string; start: number; label: string }[];

function oppOf(w: Mini, id: string) {
  return [...(w.net as any).opps.values()].find((o: any) => (o.offered?.[id]?.length ?? 0) > 0) as any;
}

function offeredOf(w: Mini, id: string): Offered {
  return (oppOf(w, id)?.offered?.[id] ?? []) as Offered;
}

function historyOf(w: Mini, id: string): { at: number; outcome: string }[] {
  return ((w.net as any).memberList().find((m: any) => m.id === id)?.availHistory ?? []) as { at: number; outcome: string }[];
}

const dayOf = (label: string) => label.split(" ")[0]!;

/** A day the engine did not offer for this member. */
function unofferedDay(offered: Offered): string {
  const have = new Set(offered.map(o => dayOf(o.label)));
  return DAYS.find(d => !have.has(d))!;
}

async function probing() {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "auto" });
  await w.onboard("a", "b");
  w.propose(["a", "b"]);
  await w.runUntil(() => w.probed("a"), 2 * 24 * 60 * 60 * 1000);
  expect(w.probed("a")).toBe(true);
  return w;
}

describe("a probe reply that names a day nobody offered", () => {
  test("books nothing and records no availability, even with \"anytime\"", async () => {
    const w = await probing();
    const offered = offeredOf(w, "a");
    expect(offered.length).toBeGreaterThan(1);
    await w.say("a", `${unofferedDay(offered)} anytime works`);
    const o = oppOf(w, "a");
    expect(o.picks?.["a"]).toBeUndefined();
    expect(o.declinedTimes ?? []).toEqual([]);
    expect(historyOf(w, "a")).toEqual([]);
    expect(w.meetings.length).toBe(0);
  });

  test("a contrastive \"but\" still picks the day that was named", async () => {
    const w = await probing();
    const offered = offeredOf(w, "a");
    await w.say("a", `Sorry, but ${dayOf(offered[0]!.label)} works`);
    const o = oppOf(w, "a");
    expect(o.picks?.["a"]).toEqual([offered[0]!.start]);
    const hist = historyOf(w, "a");
    expect(hist.filter(h => h.outcome === "accepted").map(h => h.at)).toEqual([offered[0]!.start]);
    expect(hist.filter(h => h.outcome === "declined_time").map(h => h.at).sort()).toEqual(offered.slice(1).map(x => x.start).sort());
    expect(w.meetings.length).toBe(0);
  });

  // The rules behind these are cue words, so the matrix pins the whole class in the flow, not just in
  // the parser: every reply either picks only offered times, or picks nothing and asks again.
  test("no reply ever records a time the member did not name", async () => {
    const w = await probing();
    const offered = offeredOf(w, "a");
    const d0 = dayOf(offered[0]!.label);
    const dUn = unofferedDay(offered);
    const rest = offered.slice(1).map(x => x.start).sort();
    const cases: { reply: string; picks: number[] }[] = [
      { reply: `${dUn} works`, picks: [] },
      { reply: `${dUn} anytime works`, picks: [] },
      { reply: `any time ${dUn} works`, picks: [] },
      { reply: `Sorry, but ${d0} works`, picks: [offered[0]!.start] },
      { reply: `any day but ${d0} works`, picks: rest },
      { reply: `anything but ${d0} works`, picks: rest },
      { reply: `anytime but ${d0} works`, picks: rest },
      { reply: `apart from ${d0}, anytime works`, picks: rest },
    ];
    for (const c of cases) {
      const before = historyOf(w, "a").length;
      await w.say("a", c.reply);
      const o = oppOf(w, "a");
      const picks = ((o.picks?.["a"] ?? []) as number[]).slice().sort();
      const hist = historyOf(w, "a").slice(before);
      expect({ reply: c.reply, picks }).toEqual({ reply: c.reply, picks: c.picks.slice().sort() });
      for (const p of picks) expect(offered.map(x => x.start)).toContain(p);
      for (const h of hist) if (h.outcome === "accepted") expect(c.picks).toContain(h.at);
      // Reset the member so each case starts from a fresh probe with the same options.
      if (!o.picks) o.picks = {};
      delete (o.picks as any)["a"];
      const m = (w.net as any).memberList().find((x: any) => x.id === "a");
      m.availHistory = [];
      o.status.set("a", "probing");
      o.stage = "probing";
      m.awaiting = { kind: "probe", oppId: o.id, at: w.clock.now() };
    }
  });

  test("the partner's yes cannot book a time the first member never named", async () => {
    const w = await probing();
    const offered = offeredOf(w, "a");
    await w.say("a", `${unofferedDay(offered)} anytime works`);
    // The other member answers the probe normally, as in the reviewer's full-flow run.
    await w.runUntil(() => w.probed("b"), 2 * 24 * 60 * 60 * 1000);
    if (w.probed("b")) await w.say("b", "yes");
    await w.run(60 * 60 * 1000);
    expect(w.meetings.length).toBe(0);
    const o = oppOf(w, "a");
    expect(o.picks?.["a"]).toBeUndefined();
    expect(o.stage).not.toBe("scheduled");
    expect(historyOf(w, "a")).toEqual([]);
  });

  test("a partner who names a new day cannot book either", async () => {
    const w = await probing();
    const offered = offeredOf(w, "a");
    await w.say("a", `${unofferedDay(offered)} works`);
    await w.runUntil(() => w.probed("b"), 2 * 24 * 60 * 60 * 1000);
    const offeredB = offeredOf(w, "b");
    const missB = unofferedDay(offeredB.length ? offeredB : offered);
    if (w.probed("b")) await w.say("b", `${missB} anytime works`);
    await w.run(60 * 60 * 1000);
    expect(w.meetings.length).toBe(0);
    expect(historyOf(w, "a")).toEqual([]);
    const o = oppOf(w, "a");
    expect(o.stage).not.toBe("scheduled");
    for (const id of ["a", "b"]) expect(o.picks?.[id]).toBeUndefined();
  });

  test("a partner's generic acceptance cannot cover a day the first member only named", async () => {
    const w = await probing();
    const offered = offeredOf(w, "a");
    await w.say("a", `${unofferedDay(offered)} works`);
    await w.runUntil(() => w.probed("b"), 2 * 24 * 60 * 60 * 1000);
    if (w.probed("b")) await w.say("b", "anytime works");
    await w.run(2 * 60 * 60 * 1000);
    expect(w.meetings.length).toBe(0);
    const o = oppOf(w, "a");
    expect(o.stage).not.toBe("scheduled");
    expect(o.picks?.["a"]).toBeUndefined();
    expect(historyOf(w, "a")).toEqual([]);
  });

  test("a true exclusion picks the day that was not excluded", async () => {
    const w = await probing();
    const offered = offeredOf(w, "a");
    await w.say("a", `any day but ${dayOf(offered[0]!.label)} works`);
    const o = oppOf(w, "a");
    expect(o.picks?.["a"]).toEqual(offered.slice(1).map(x => x.start));
    expect(historyOf(w, "a").filter(h => h.outcome === "accepted").map(h => h.at).sort()).toEqual(offered.slice(1).map(x => x.start).sort());
    expect(w.meetings.length).toBe(0);
  });
});

// The cue scan is shared with availabilityTags (and checkinTags, its alias): an excluded day must not
// be tagged as free, and a contrastive "but" must still tag the day that was named.
describe("the same cue scan in availabilityTags", () => {
  test("an excluded day is not tagged free, a named day still is", () => {
    expect(availabilityTags("excluding Friday")).toEqual([]);
    expect(availabilityTags("any day but Friday works")).toEqual([]);
    expect(availabilityTags("anytime but Sunday works")).toEqual([]);
    expect(availabilityTags("apart from Saturday, anytime works")).toEqual([]);
    expect(availabilityTags("Sorry, but Saturday works")).toContain("evening:Sat");
    expect(availabilityTags("Sorry, but Monday works")).toEqual(["evening:Mon"]);
    expect(availabilityTags("I'm free Thursday")).toEqual(["evening:Thu"]);
  });
});
