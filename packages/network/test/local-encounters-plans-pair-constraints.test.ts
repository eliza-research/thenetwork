import { describe, expect, it } from "bun:test";
import { DAY, HOUR } from "@thenetwork/core";

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
import { planAgainOf } from "../src/classify.ts";
import { Mini } from "./mini.ts";

describe("planAgainOf", () => {
  it("recognizes natural positive affirmations", () => {
    expect(planAgainOf("I'd love to!")).toBe("yes");
    expect(planAgainOf("would love to")).toBe("yes");
    expect(planAgainOf("loved it")).toBe("yes");
    expect(planAgainOf("had a blast")).toBe("yes");
    expect(planAgainOf("sure thing")).toBe("yes");
    expect(planAgainOf("sure")).toBe("yes");
    expect(planAgainOf("totally")).toBe("yes");
    expect(planAgainOf("of course")).toBe("yes");
    expect(planAgainOf("100%")).toBe("yes");
    expect(planAgainOf("sign me up")).toBe("yes");
    expect(planAgainOf("i'm down")).toBe("yes");
    expect(planAgainOf("im down")).toBe("yes");
    expect(planAgainOf("down to")).toBe("yes");
    expect(planAgainOf("anytime")).toBe("yes");
    expect(planAgainOf("let's do it")).toBe("yes");
    expect(planAgainOf("lets do it")).toBe("yes");
  });

  it("recognizes polite and colloquial refusals", () => {
    expect(planAgainOf("pass")).toBe("no");
    expect(planAgainOf("hard pass")).toBe("no");
    expect(planAgainOf("i'll pass")).toBe("no");
    expect(planAgainOf("i will pass")).toBe("no");
    expect(planAgainOf("rather not")).toBe("no");
    expect(planAgainOf("i'd rather not")).toBe("no");
    expect(planAgainOf("not for me")).toBe("no");
    expect(planAgainOf("not my thing")).toBe("no");
    expect(planAgainOf("don't think so")).toBe("no");
    expect(planAgainOf("i don't think so")).toBe("no");
    expect(planAgainOf("no thanks")).toBe("no");
    expect(planAgainOf("decline")).toBe("no");
  });

  it("keeps attendance statements as unclear", () => {
    expect(planAgainOf("couldn't make it")).toBe("unclear");
    expect(planAgainOf("nobody else showed up")).toBe("unclear");
  });
});

describe("stale again and planAgain invalidation on block and avoid", () => {
  it("clears again and planAgain when a block is recorded", async () => {
    const mini = new Mini([
      { id: "m1", name: "Alice", area: "Williamsburg" },
      { id: "m2", name: "Bob", area: "Williamsburg" },
    ]);
    await mini.onboard("m1", "m2");

    const k = pairKey("m1", "m2");
    (mini.net as any).again.set(k, new Set(["m1", "m2"]));
    (mini.net as any).planAgain.set(k, mini.clock.now());

    expect((mini.net as any).again.has(k)).toBe(true);
    expect((mini.net as any).planAgain.has(k)).toBe(true);

    // m1 blocks Bob
    await mini.say("m1", "block Bob");

    expect((mini.net as any).again.has(k)).toBe(false);
    expect((mini.net as any).planAgain.has(k)).toBe(false);
  });

  it("clears again and planAgain when avoid is recorded via negative feedback", async () => {
    const mini = new Mini([
      { id: "m1", name: "Alice", age: 25, area: "Williamsburg" },
      { id: "m2", name: "Bob", age: 25, area: "Williamsburg" },
    ]);
    await mini.onboard("m1", "m2");

    const k = pairKey("m1", "m2");
    (mini.net as any).again.set(k, new Set(["m1", "m2"]));
    (mini.net as any).planAgain.set(k, mini.clock.now());

    // Create a scheduled meeting opportunity between m1 and m2
    const opp = (mini.net as any).newOpp({
      origin: "engine", kind: "intro", category: "social",
      objective: "coffee", detail: "coffee", participants: ["m1", "m2"],
      alternates: [], primed: [], explanations: { m1: "why", m2: "why" }, score: 0.8,
      generator: "test", tags: [],
    });
    opp.stage = "scheduled";
    opp.status.set("m1", "yes");
    opp.status.set("m2", "yes");
    (mini.net as any).opps.set(opp.id, opp);
    (mini.net as any).members.get("m1").awaiting = { kind: "feedback", oppId: opp.id, at: mini.clock.now() };

    // m1 submits negative feedback about m2
    await mini.say("m1", "it was terrible and awkward, not for me");

    expect((mini.net as any).avoid.has(k)).toBe(true);
    expect((mini.net as any).again.has(k)).toBe(false);
    expect((mini.net as any).planAgain.has(k)).toBe(false);
  });
});

describe("plans buddy pair constraints", () => {
  it("does not pair members who have an avoid edge, recent decline, or identical first name", async () => {
    const mini = new Mini([
      { id: "m1", name: "Alex", area: "Williamsburg" },
      { id: "m2", name: "Alex", area: "Williamsburg" },
      { id: "m3", name: "Charlie", area: "Williamsburg" },
    ]);
    await mini.onboard("m1", "m2", "m3");

    // m3 has avoid with m1
    (mini.net as any).avoid.add(pairKey("m1", "m3"));

    // m2 (Alex) asks for plans first
    await mini.say("m2", "anything fun happening this weekend?");
    // m3 (Charlie) asks for plans next
    await mini.say("m3", "anything fun happening this weekend?");

    // Now m1 (Alex) asks for plans:
    // - m2 matches criteria except identical first name "Alex"
    // - m3 matches criteria except avoid relationship with m1
    await mini.say("m1", "anything fun happening this weekend?");

    const opps = [...(mini.net as any).opps.values()].filter((o: any) => o.origin === "plans");
    // No plans opp should have been formed between m1 and m2 (same name) or m1 and m3 (avoid)
    const m1Opps = opps.filter((o: any) => o.participants.includes("m1"));
    expect(m1Opps.length).toBe(0);
  });
});

describe("localEncounters constraints", () => {
  it("does not create second_encounter if members block each other, avoid each other, or share first name", async () => {
    const mini = new Mini([
      { id: "m1", name: "Sam", age: 25, area: "Williamsburg" },
      { id: "m2", name: "Sam", age: 25, area: "Williamsburg" },
      { id: "m3", name: "David", age: 25, area: "Williamsburg" },
      { id: "m4", name: "Emma", age: 25, area: "Williamsburg" },
    ]);
    await mini.onboard("m1", "m2", "m3", "m4");

    // Case 1: same name (m1 Sam & m2 Sam)
    const k1 = pairKey("m1", "m2");
    (mini.net as any).again.set(k1, new Set(["m1", "m2"]));

    // Case 2: avoid edge (m3 David & m4 Emma)
    const k2 = pairKey("m3", "m4");
    (mini.net as any).again.set(k2, new Set(["m3", "m4"]));
    (mini.net as any).avoid.add(k2);

    (mini.net as any).localEncounters(mini.clock.now());

    const secondEncounterOpps = [...(mini.net as any).opps.values()].filter((o: any) => o.origin === "second_encounter");
    expect(secondEncounterOpps.length).toBe(0);
  });

  it("does not select newcomer_welcome host who is blocked, avoided, shares first name, or was invited by newcomer", async () => {
    const now = miniNow();
    const mini = new Mini([
      // Newcomer: joined 3 days ago, active, has an invitedBy
      { id: "newbie", name: "Jordan", age: 25, area: "Williamsburg", interests: ["running"] },
      // Host 1: blocked
      { id: "host1", name: "Morgan", age: 25, area: "Williamsburg", interests: ["running"] },
      // Host 2: avoid edge
      { id: "host2", name: "Taylor", age: 25, area: "Williamsburg", interests: ["running"] },
      // Host 3: same first name "Jordan"
      { id: "host3", name: "Jordan", age: 25, area: "Williamsburg", interests: ["running"] },
      // Host 4: invited by newbie
      { id: "host4", name: "Riley", age: 25, area: "Williamsburg", interests: ["running"] },
      // Host 5: clean host
      { id: "host5", name: "Casey", age: 25, area: "Williamsburg", interests: ["running"] },
    ], { matchingEnabled: true });

    function miniNow() { return Date.UTC(2026, 9, 20, 12); }
    mini.clock.set(now);

    await mini.onboard("newbie", "host1", "host2", "host3", "host4", "host5");

    const mNew = (mini.net as any).members.get("newbie");
    mNew.joinedAt = now - 3 * DAY;
    mNew.invitedBy = "other_member";

    for (const hId of ["host1", "host2", "host3", "host4", "host5"]) {
      const h = (mini.net as any).members.get(hId);
      h.joinedAt = now - 15 * DAY;
      h.noShows = 0;
    }

    // Set constraints:
    // host1 blocked
    (mini.net as any).blocks.add(pairKey("newbie", "host1"));
    // host2 avoided
    (mini.net as any).avoid.add(pairKey("newbie", "host2"));
    // host4 was invited by newbie
    (mini.net as any).members.get("host4").invitedBy = "newbie";

    (mini.net as any).localEncounters(now);

    const welcomeOpps = [...(mini.net as any).opps.values()].filter((o: any) => o.origin === "newcomer_welcome");
    expect(welcomeOpps.length).toBe(1);
    expect(welcomeOpps[0].participants).toEqual(["newbie", "host5"]);
  });
});
