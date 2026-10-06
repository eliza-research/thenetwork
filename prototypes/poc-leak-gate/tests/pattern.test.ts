// Fix 5: cross-message pattern-of-life check (deterministic prototype).
import { test, expect, describe } from "bun:test";
import { extractSchedule, PatternTracker, type GateInput, type MemberCard } from "../src/index.ts";

const teo: MemberCard = { id: "t", name: "Teodoro Reyes", facets: [
  { id: "t:a", kind: "availability_pattern", value: "Sat and Sun afternoons", scope: "public" },
  { id: "t:r", kind: "routine", value: "swims at the Alder St rec center pool at 6:10am on Tuesdays and Thursdays", scope: "agent_private", topic: "location" },
] };
const ana: MemberCard = { id: "a", name: "Ana Lindqvist", facets: [{ id: "a:a", kind: "availability_pattern", value: "Mon/Wed/Fri evenings", scope: "public" }] };
const rec: MemberCard = { id: "r", name: "Rui Costa", facets: [] };
const rec2: MemberCard = { id: "r2", name: "Bea Moss", facets: [] };
const mk = (draft: string, recipientId = "r"): GateInput => ({
  draft, recipientId, participantIds: [recipientId, "t", "a"], members: [rec, rec2, teo, ana],
  directory: [], canaries: [],
});

describe("extractSchedule", () => {
  test("days, parts, times, places, recurrence", () => {
    const s = extractSchedule("He swims every Tuesday and Thursday at 6:10am at the pool");
    expect([...s.days].sort()).toEqual(["thu", "tue"]);
    expect([...s.parts]).toContain("morning");
    expect([...s.times]).toContain("06:10");
    expect([...s.places]).toContain("pool");
    expect(s.recurring).toBe(true);
  });
  test("a one-off plan is not recurring, and 'sat'/'sun' as words are not days", () => {
    const s = extractSchedule("We sat in the sun on Thursday at 6pm.");
    expect([...s.days]).toEqual(["thu"]);
    expect(s.recurring).toBe(false);
  });
});

describe("PatternTracker", () => {
  test("individually harmless messages add up to a hidden routine -> cross-message alert", () => {
    const t = new PatternTracker({ windowMessages: 10 });
    expect(t.record(mk("Teodoro can't do Tuesday mornings, so let's aim for the weekend."), "m1", 1)).toEqual([]);
    // Tue + Thu mornings together already match "pool at 6:10am on Tuesdays and Thursdays".
    const a2 = t.record(mk("Quick note: Teodoro is tied up Thursday too."), "m2", 2);
    expect(a2.length).toBe(1);
    expect(a2[0]!.kind).toBe("routine_match");
    expect(a2[0]!.subjectId).toBe("t");
    expect(a2[0]!.crossMessage).toBe(true);
    expect(a2[0]!.messageIds).toEqual(["m1", "m2"]);
  });
  test("each message alone stays below the threshold", () => {
    for (const d of ["Teodoro can't do Tuesday mornings, so let's aim for the weekend.", "Quick note: Teodoro is tied up Thursday too.", "Teodoro will come from the pool."])
      expect(new PatternTracker().record(mk(d), "x", 1)).toEqual([]);
  });
  test("a single message that spells out the routine is flagged, not as cross-message", () => {
    const t = new PatternTracker();
    const a = t.record(mk("Teodoro swims Tuesdays and Thursdays at 6:10am, so mornings are out."), "m1", 1);
    expect(a[0]?.kind).toBe("routine_match");
    expect(a[0]?.crossMessage).toBe(false);
  });
  test("schedule the recipient can already see is not a disclosure", () => {
    const t = new PatternTracker();
    t.record(mk("Ana is usually free Monday evenings."), "m1", 1);
    t.record(mk("Ana also does Wednesday evenings."), "m2", 2);
    expect(t.record(mk("And Ana is around Friday evenings every week."), "m3", 3)).toEqual([]);
  });
  test("a recurring weekly unavailability with no registry match -> recurring_pattern", () => {
    const t = new PatternTracker();
    t.record(mk("Teodoro keeps Monday evenings clear every week."), "m1", 1);
    const a = t.record(mk("Teodoro is also never free Wednesday or Friday evenings."), "m2", 2);
    expect(a.map(x => x.kind)).toContain("recurring_pattern");
  });
  test("facts about different people are not pooled", () => {
    const t = new PatternTracker();
    t.record(mk("Teodoro can't do Tuesday mornings."), "m1", 1);
    expect(t.record(mk("Ana is busy Thursday mornings at the pool."), "m2", 2)).toEqual([]);
  });
  test("recipients are isolated", () => {
    const t = new PatternTracker();
    t.record(mk("Teodoro can't do Tuesday mornings."), "m1", 1);
    expect(t.record(mk("Teodoro is tied up Thursday morning too.", "r2"), "m2", 2)).toEqual([]);
  });
  test("old messages leave the window (last N messages)", () => {
    const t = new PatternTracker({ windowMessages: 2 });
    t.record(mk("Teodoro can't do Tuesday mornings."), "m1", 1);
    t.record(mk("Logistics only: see you at the cafe."), "m2", 2);
    t.record(mk("Logistics only: bring water."), "m3", 3);
    expect(t.record(mk("Teodoro is tied up Thursday too."), "m4", 4)).toEqual([]);
  });
  test("peek() checks a draft against the window without recording it", () => {
    const t = new PatternTracker();
    t.record(mk("Teodoro can't do Tuesday mornings."), "m1", 1);
    expect(t.peek(mk("Teodoro is tied up Thursday too."), "m2", 2).length).toBe(1);
    expect(t.record(mk("See you Saturday."), "m3", 3)).toEqual([]);
  });
});
