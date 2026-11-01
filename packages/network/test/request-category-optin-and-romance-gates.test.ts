import { describe, expect, test } from "bun:test";
import { Mini } from "./mini.ts";

describe("people request category opt-in and romance gates", () => {
  test("searchFor excludes candidates who have opted out of the requested category", async () => {
    // Member A is seeking someone for professional networking/startups
    // Candidate B has fundraising skill, but categoriesOptIn: ["social"]
    // Candidate C has fundraising skill, and categoriesOptIn: ["social", "professional"]
    const w = new Mini([
      { id: "a", name: "Alice Adams", age: 28, area: "Williamsburg", interests: ["startups"], wants: [{ objective: "meet other founders", category: "professional" }] },
      { id: "b", name: "Bob Brown", age: 30, area: "Greenpoint", skills: ["fundraising"], interests: ["startups"] },
      { id: "c", name: "Charlie Chen", age: 32, area: "Greenpoint", skills: ["fundraising"], interests: ["startups"] },
    ], { review: "auto" });

    // Explicitly configure categoriesOptIn
    w.members.find(m => m.id === "b")!.prefs.categoriesOptIn = ["social"];
    w.members.find(m => m.id === "c")!.prefs.categoriesOptIn = ["social", "professional"];
    (w.net as any).dirty = true;

    await w.onboard("a", "b", "c");

    const memA = (w.net as any).member("a");
    const cands = w.net.searchFor(memA, { category: "professional", desireId: "meet_founders", tags: ["startups"] });

    // Candidate B must be excluded because B opted out of "professional"
    const candIds = cands.map(x => x.id);
    expect(candIds).toContain("c");
    expect(candIds).not.toContain("b");
  });

  test("searchFor excludes romance-incompatible candidates when category is romance", async () => {
    // Alice seeks romance (adult, woman seeking men)
    // Bob is minor (17) or not opted in
    // Charlie is adult man seeking women
    // David is adult man seeking men (incompatible orientation)
    const w = new Mini([
      { id: "a", name: "Alice Adams", age: 28, area: "Williamsburg", romance: { is: "woman", seeks: ["man"] }, interests: ["dating", "coffee"] },
      { id: "b", name: "Bob Minor", age: 17, area: "Williamsburg", romance: { is: "man", seeks: ["woman"] }, interests: ["dating", "coffee"] },
      { id: "c", name: "Charlie Chen", age: 29, area: "Williamsburg", romance: { is: "man", seeks: ["woman"] }, interests: ["dating", "coffee"] },
      { id: "d", name: "David Day", age: 30, area: "Williamsburg", romance: { is: "man", seeks: ["man"] }, interests: ["dating", "coffee"] },
    ], { review: "auto", allowedCategories: ["romance", "social"] });

    await w.onboard("a", "b", "c", "d");

    const memA = (w.net as any).member("a");
    // With category: "romance", askFit returns s = 0 and romanceGate filters incompatible pairs
    const cands = w.net.searchFor(memA, { category: "romance", tags: ["dating", "coffee"] });

    // Romance requests never match candidates via people search (fails closed: romance is engine-only)
    expect(cands).toHaveLength(0);

    // Verify romanceGate directly on the pairs
    expect((w.net as any).romanceGate(["a", "b"])).toBe("romance_not_verified_adult");
    expect((w.net as any).romanceGate(["a", "d"])).toBe("romance_mismatch");
    expect((w.net as any).romanceGate(["a", "c"])).toBeUndefined();
  });

  test("openRequest rejects requests in categories the requester has opted out of", async () => {
    const w = new Mini([
      { id: "a", name: "Alice Adams", age: 28, area: "Williamsburg", interests: ["coffee"] },
    ], { review: "auto" });

    // Alice is only opted into hobby
    w.members.find(m => m.id === "a")!.prefs.categoriesOptIn = ["hobby"];
    (w.net as any).dirty = true;

    await w.onboard("a");

    const from = w.mark();
    const memA = (w.net as any).member("a");
    // Alice submits a people request in "social" category
    (w.net as any).openRequest(memA, { kind: "people_request", category: "social", tags: ["coffee"] }, {});

    // Must be logged as request_out_of_scope
    const outOfScopeLogs = w.log("request_out_of_scope");
    expect(outOfScopeLogs).toHaveLength(1);
    expect(outOfScopeLogs[0]!.detail).toEqual({ memberId: "a", category: "social" });

    // Alice receives copy.requestOutOfScope
    const msgs = w.to("a", from).map(s => s.body);
    expect(msgs.some(m => m.includes("That's not something I can help with here"))).toBe(true);

    // No request should be stored
    expect((w.net as any).requests).toHaveLength(0);
  });

  test("openRequest rejects romance requests when requester has not opted into romance", async () => {
    const w = new Mini([
      { id: "a", name: "Alice Adams", age: 28, area: "Williamsburg", interests: ["dating"] },
    ], { review: "auto", allowedCategories: ["romance", "social"] });

    // Alice does NOT have romanceOptIn or "romance" in categoriesOptIn
    w.members.find(m => m.id === "a")!.prefs.romanceOptIn = false;
    w.members.find(m => m.id === "a")!.prefs.categoriesOptIn = ["social"];
    (w.net as any).dirty = true;

    await w.onboard("a");

    const from = w.mark();
    const memA = (w.net as any).member("a");
    (w.net as any).openRequest(memA, { kind: "people_request", category: "romance", tags: ["dating"] }, {});

    const outOfScopeLogs = w.log("request_out_of_scope");
    expect(outOfScopeLogs).toHaveLength(1);
    expect(outOfScopeLogs[0]!.detail).toEqual({ memberId: "a", category: "romance" });

    const msgs = w.to("a", from).map(s => s.body);
    expect(msgs.some(m => m.includes("That's not something I can help with here"))).toBe(true);
    expect((w.net as any).requests).toHaveLength(0);
  });

  test("retryRequests skips requests if requester has subsequently opted out of the category", async () => {
    const w = new Mini([
      { id: "a", name: "Alice Adams", age: 28, area: "Williamsburg", interests: ["pottery"] },
      { id: "b", name: "Bob Brown", age: 30, area: "Greenpoint", interests: ["pottery"] },
    ], { review: "auto" });

    // Both opted into hobby initially
    w.members.find(m => m.id === "a")!.prefs.categoriesOptIn = ["social", "hobby"];
    w.members.find(m => m.id === "b")!.prefs.categoriesOptIn = ["social", "hobby"];
    (w.net as any).dirty = true;

    await w.onboard("a");

    // Simulate a request that was created and currently outcome: "none"
    const req = {
      id: "rq1", memberId: "a", at: w.clock.now(), kind: "people" as const, category: "hobby" as const,
      tags: ["pottery"], outcome: "none" as const, lastTry: 0,
    };
    (w.net as any).requests.push(req);

    // Alice updates preferences: opts out of "hobby", only keeps "social"
    w.members.find(m => m.id === "a")!.prefs.categoriesOptIn = ["social"];
    (w.net as any).dirty = true;

    // Trigger retryRequests
    const oppsBefore = [...(w.net as any).opps.values()].length;
    (w.net as any).retryRequests(w.clock.now() + 24 * 60 * 60 * 1000);

    // No opportunity should have been created because Alice opted out of hobby
    const oppsAfter = [...(w.net as any).opps.values()].length;
    expect(oppsAfter).toBe(oppsBefore);
    expect(req.outcome).toBe("none");
  });
});
