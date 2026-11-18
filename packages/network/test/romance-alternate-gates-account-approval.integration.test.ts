// Integration: Romance alternate validation and account status enforcement in ConsentNetwork.
// Verifies:
// 1. replaceOrClose skips romance-incompatible alternates (gender/seeks mismatch, not opted-in).
// 2. replaceOrClose successfully substitutes a romance-compatible alternate.
// 3. reroll in review skips romance-incompatible alternates and picks a compatible one.
// 4. Alternates who opted out of the opportunity's category are rejected.
// 5. approvalCheck rejects opportunities containing members with account suspensions (m.account).
// 6. approvalCheck validates romanceGate for non-engine origins (player/scenario).
import { describe, expect, test } from "bun:test";
import { Mini, type Spec } from "./mini.ts";

const person = (id: string, name: string, extra: Partial<Spec> = {}): Spec => ({
  id, name, age: 28, area: "Williamsburg", interests: ["dining", "coffee", "art", "music"],
  ...extra,
});

const miniOpts = {
  review: "auto" as const,
  selective: false,
  allowedCategories: ["social", "romance", "events", "hobby", "professional"] as const,
};

describe("ConsentNetwork: romance alternate gates and account approval", () => {
  test("replaceOrClose rejects romance mismatch alternate and closes opportunity", async () => {
    // a: woman seeks man; b: man seeks woman; c: woman seeks man (mismatch for a)
    const w = new Mini([
      person("a", "Alice Wu", { romance: { is: "woman", seeks: ["man"] } }),
      person("b", "Bob Smith", { romance: { is: "man", seeks: ["woman"] } }),
      person("c", "Carol Danvers", { romance: { is: "woman", seeks: ["man"] } }),
    ], miniOpts);
    await w.onboard("a", "b", "c");

    const opp = (w.net as any).newOpp({
      origin: "engine", kind: "intro", category: "romance", objective: "dinner date",
      participants: ["a", "b"], alternates: ["c"], primed: [],
      explanations: { a: "good match", b: "good match" }, score: 0.8,
    });
    (w.net as any).submit(opp);

    expect(opp.stage).toBe("probing");
    expect(opp.participants).toEqual(["a", "b"]);

    // Bob becomes unavailable during probing
    opp.status.set("b", "unavailable");
    (w.net as any).replaceOrClose(opp, "b");

    // Carol is a woman and Alice seeks man -> romance_mismatch, so Carol is rejected
    // With no valid alternates, the opportunity must close
    expect(opp.stage).toBe("closed");
    expect(opp.closedReason).toBe("no one available");
    expect(opp.participants.includes("c")).toBe(false);
  });

  test("replaceOrClose skips mismatch alternate and accepts a compatible romance alternate", async () => {
    // a: woman seeks man; b: man seeks woman; c: woman seeks man (mismatch); d: man seeks woman (compatible)
    const w = new Mini([
      person("a", "Alice Wu", { romance: { is: "woman", seeks: ["man"] } }),
      person("b", "Bob Smith", { romance: { is: "man", seeks: ["woman"] } }),
      person("c", "Carol Danvers", { romance: { is: "woman", seeks: ["man"] } }),
      person("d", "David Miller", { romance: { is: "man", seeks: ["woman"] } }),
    ], miniOpts);
    await w.onboard("a", "b", "c", "d");

    const opp = (w.net as any).newOpp({
      origin: "engine", kind: "intro", category: "romance", objective: "dinner date",
      participants: ["a", "b"], alternates: ["c", "d"], primed: [],
      explanations: { a: "good match", b: "good match" }, score: 0.8,
    });
    (w.net as any).submit(opp);

    expect(opp.stage).toBe("probing");

    // Bob becomes unavailable
    opp.status.set("b", "unavailable");
    (w.net as any).replaceOrClose(opp, "b");

    // Carol is skipped (mismatch), David is accepted
    expect(opp.stage).toBe("probing");
    expect(opp.participants).toEqual(["a", "d"]);
    expect(opp.alternates).toEqual([]);
    expect(opp.status.get("d")).toBe("queued");

    // Once first participant confirms, replacement advances to probing
    opp.status.set("a", "available");
    (w.net as any).advanceProbes(opp);
    expect(opp.status.get("d")).toBe("probing");
  });

  test("replaceOrClose rejects alternate who has not opted in to romance", async () => {
    // a: woman seeks man; b: man seeks woman; e: man without romance opt-in
    const w = new Mini([
      person("a", "Alice Wu", { romance: { is: "woman", seeks: ["man"] } }),
      person("b", "Bob Smith", { romance: { is: "man", seeks: ["woman"] } }),
      person("e", "Ethan Hunt"), // no romance config
    ], miniOpts);
    await w.onboard("a", "b", "e");

    const opp = (w.net as any).newOpp({
      origin: "engine", kind: "intro", category: "romance", objective: "dinner date",
      participants: ["a", "b"], alternates: ["e"], primed: [],
      explanations: { a: "good match", b: "good match" }, score: 0.8,
    });
    (w.net as any).submit(opp);

    opp.status.set("b", "unavailable");
    (w.net as any).replaceOrClose(opp, "b");

    expect(opp.stage).toBe("closed");
    expect(opp.closedReason).toBe("no one available");
  });

  test("reroll in review selects romance-compatible alternate over mismatch", async () => {
    const w = new Mini([
      person("a", "Alice Wu", { romance: { is: "woman", seeks: ["man"] } }),
      person("b", "Bob Smith", { romance: { is: "man", seeks: ["woman"] } }),
      person("c", "Carol Danvers", { romance: { is: "woman", seeks: ["man"] } }),
      person("d", "David Miller", { romance: { is: "man", seeks: ["woman"] } }),
    ], { ...miniOpts, review: "human" });
    await w.onboard("a", "b", "c", "d");

    const opp = (w.net as any).newOpp({
      origin: "engine", kind: "intro", category: "romance", objective: "dinner date",
      participants: ["a", "b"], alternates: ["c", "d"], primed: [],
      explanations: { a: "good match", b: "good match" }, score: 0.8,
    });
    (w.net as any).submit(opp);

    expect(opp.stage).toBe("review");

    // Reviewer swaps out Bob
    const res = (w.net as any).reroll(opp, { swapOut: "b" }, "test-reviewer", {});
    expect(res.ok).toBe(true);
    // Carol is skipped because of gender mismatch; David is chosen
    expect(opp.participants).toEqual(["a", "d"]);
    expect(opp.alternates).toEqual(["c"]);
  });

  test("altOk rejects alternate who opted out of the category", async () => {
    const w = new Mini([
      person("a", "Alice Wu"),
      person("b", "Bob Smith"),
      person("f", "Frank Hall"),
    ], miniOpts);
    await w.onboard("a", "b", "f");

    // Frank opts out of 'events' category
    const frankRecord = (w.net as any).record("f");
    frankRecord.prefs.categoriesOptIn = ["social", "hobby"];

    const opp = (w.net as any).newOpp({
      origin: "engine", kind: "event_coattend", category: "events", objective: "concert",
      participants: ["a", "b"], alternates: ["f"], primed: [],
      explanations: { a: "event match", b: "event match" }, score: 0.7,
    });
    (w.net as any).submit(opp);

    opp.status.set("b", "unavailable");
    (w.net as any).replaceOrClose(opp, "b");

    // Frank has opted out of 'events', so he cannot be substituted
    expect(opp.stage).toBe("closed");
    expect(opp.closedReason).toBe("no one available");
  });

  test("approvalCheck rejects opportunities containing members with account suspensions", async () => {
    const w = new Mini([
      person("a", "Alice Wu"),
      person("b", "Bob Smith"),
    ], { ...miniOpts, review: "human" });
    await w.onboard("a", "b");

    const opp = (w.net as any).newOpp({
      origin: "player", kind: "intro", category: "social", objective: "coffee",
      participants: ["a", "b"], alternates: [], primed: [],
      explanations: { a: "match", b: "match" }, score: 0.8,
    });
    (w.net as any).submit(opp);

    // Baseline: approvalCheck passes
    expect((w.net as any).approvalCheck(opp)).toBeUndefined();

    // Bob's account is suspended / paused by platform admin
    const bob = (w.net as any).member("b");
    bob.account = "paused";

    expect((w.net as any).approvalCheck(opp)).toBe("account_paused");

    bob.account = "restricted";
    expect((w.net as any).approvalCheck(opp)).toBe("account_restricted");
  });

  test("approvalCheck rejects romance proposal with mismatch regardless of origin", async () => {
    // Both are women seeking men (mismatch for each other)
    const w = new Mini([
      person("a", "Alice Wu", { romance: { is: "woman", seeks: ["man"] } }),
      person("c", "Carol Danvers", { romance: { is: "woman", seeks: ["man"] } }),
    ], { ...miniOpts, review: "human" });
    await w.onboard("a", "c");

    // Scenario / player proposal in romance category
    const opp = (w.net as any).newOpp({
      origin: "scenario", kind: "intro", category: "romance", objective: "date",
      participants: ["a", "c"], alternates: [], primed: [],
      explanations: { a: "test", c: "test" }, score: 0.8,
    });
    (w.net as any).submit(opp);

    expect((w.net as any).approvalCheck(opp)).toBe("romance_mismatch");
  });
  test("replaceOrClose syncs member record and rejects alternate when snapshot record was updated to paused", async () => {
    const w = new Mini([
      person("a", "Alice Wu"),
      person("b", "Bob Smith"),
      person("c", "Charlie Brown"),
    ], miniOpts);
    await w.onboard("a", "b", "c");

    // Initially c is normal in memory
    const cMem = (w.net as any).member("c");
    expect(cMem.state).toBe("normal");

    // Later, snapshot record is updated to paused (e.g. from platform/account sync)
    const cRec = (w.net as any).record("c");
    cRec.state = "paused";

    const opp = (w.net as any).newOpp({
      origin: "engine", kind: "intro", category: "social", objective: "coffee",
      participants: ["a", "b"], alternates: ["c"], primed: [],
      explanations: { a: "match", b: "match" }, score: 0.8,
    });
    (w.net as any).submit(opp);

    // Bob becomes unavailable
    opp.status.set("b", "unavailable");
    (w.net as any).replaceOrClose(opp, "b");

    // altOk should have synced c's record to paused and rejected c as alternate
    expect(cMem.state).toBe("paused");
    expect(opp.stage).toBe("closed");
    expect(opp.closedReason).toBe("no one available");
  });

  test("altOk accepts alternate for hobby category when opted in via personal-growth intent", async () => {
    const w = new Mini([
      person("a", "Alice Wu"),
      person("b", "Bob Smith"),
      person("g", "Grace Hopper"),
    ], miniOpts);
    await w.onboard("a", "b", "g");

    // Grace only has 'social' explicitly in categoriesOptIn (not 'hobby')
    const gRec = (w.net as any).record("g");
    gRec.prefs.categoriesOptIn = ["social"];

    // Add personal-growth intent for Grace to snapshot
    const snap = (w.net as any).snapshotCached();
    snap.intents.push({
      id: "intent-g-growth",
      memberId: "g",
      category: "growth",
      objective: "learn ceramics and pottery",
      createdAt: 0,
      horizonDays: 30,
      status: "active",
    });

    const opp = (w.net as any).newOpp({
      origin: "engine", kind: "activity", category: "hobby", objective: "pottery workshop",
      participants: ["a", "b"], alternates: ["g"], primed: [],
      explanations: { a: "pottery", b: "pottery" }, score: 0.85,
    });
    (w.net as any).submit(opp);

    // Bob becomes unavailable
    opp.status.set("b", "unavailable");
    (w.net as any).replaceOrClose(opp, "b");

    // Grace is accepted because personal-growth intent maps to hobby opt-in
    expect(opp.stage).toBe("probing");
    expect(opp.participants).toEqual(["a", "g"]);
    expect(opp.status.get("g")).toBe("queued");
  });

  test("altOk rejects alternate in receiving state when replacing a contributor role and updates o.roles", async () => {
    const w = new Mini([
      person("a", "Alice Wu"),
      person("b", "Bob Smith"),
      person("c", "Charlie Brown", { state: "receiving" as any }),
      person("d", "David Miller"),
    ], miniOpts);
    await w.onboard("a", "b", "c", "d");

    const opp = (w.net as any).newOpp({
      origin: "engine", kind: "group", category: "social", objective: "hiking trip",
      participants: ["a", "b"], alternates: ["c", "d"], primed: [],
      explanations: { a: "hiking", b: "hiking" }, score: 0.8,
    });
    opp.roles = { a: "participant", b: "host" };
    (w.net as any).submit(opp);

    // Host Bob becomes unavailable
    opp.status.set("b", "unavailable");
    (w.net as any).replaceOrClose(opp, "b");

    // Charlie is in receiving state, so he cannot take the 'host' contributor role
    // David is chosen instead, and host role is transferred to David
    expect(opp.participants).toEqual(["a", "d"]);
    expect(opp.roles.d).toBe("host");
    expect(opp.roles.b).toBeUndefined();
  });
});
