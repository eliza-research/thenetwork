import { describe, expect, test } from "bun:test";
import { DAY, HOUR } from "@thenetwork/core";
import { candidateReason, memberReason, pairReason } from "../src/filters.ts";
import { baseMember, cand, emptyInput, facet, mkWorld, NOW } from "./helpers.ts";
import type { EngineInput } from "../src/types.ts";

const chk = { category: "social" as const, role: "peer" as const, format: "one_to_one" as const, timeSensitive: false };

function two(over: (i: EngineInput) => void = () => {}): EngineInput {
  const inp = emptyInput(NOW);
  inp.members.push(baseMember("a"), baseMember("b"));
  over(inp);
  return inp;
}

describe("member-level hard filters", () => {
  test("eligible baseline", () => expect(memberReason(mkWorld(two()), "a", chk)).toBeNull());
  test("unknown member", () => expect(memberReason(mkWorld(two()), "zzz", chk)).toBe("unknown_member"));
  test("18+ only", () => expect(memberReason(mkWorld(two(i => { i.members[0]!.age = 17; })), "a", chk)).toBe("underage"));
  test("active safety hold excludes; expired hold does not", () => {
    expect(memberReason(mkWorld(two(i => { i.safetyHolds = [{ memberId: "a", from: NOW - DAY }]; })), "a", chk)).toBe("safety_hold");
    expect(memberReason(mkWorld(two(i => { i.safetyHolds = [{ memberId: "a", from: NOW - 3 * DAY, to: NOW - DAY }]; })), "a", chk)).toBeNull();
  });
  test("paused state excludes everything", () => expect(memberReason(mkWorld(two(i => { i.members[0]!.state = "paused"; })), "a", chk)).toBe("state_paused"));
  test("receiving members are never contributors but may receive", () => {
    const w = mkWorld(two(i => { i.members[0]!.state = "receiving"; }));
    expect(memberReason(w, "a", { ...chk, role: "helper" })).toBe("state_receiving_contributor");
    expect(memberReason(w, "a", { ...chk, role: "seeker" })).toBeNull();
  });
  test("category opt-in is required", () => {
    expect(memberReason(mkWorld(two(i => { i.members[0]!.prefs.categoriesOptIn = ["hobby"]; })), "a", chk)).toBe("category_opt_out");
  });
  test("romance requires romanceOptIn", () => {
    const w = mkWorld(two(i => { i.members[0]!.prefs.categoriesOptIn.push("romance"); }));
    expect(memberReason(w, "a", { ...chk, category: "romance" })).toBe("romance_opt_out");
  });
  test("only-when-asked / two-unanswered: only as initiator of a fresh intent", () => {
    const w = mkWorld(two(i => { i.members[0]!.unansweredProactive = 2; i.members[1]!.prefs.onlyWhenAsked = true; }));
    expect(memberReason(w, "a", chk)).toBe("only_when_asked");
    expect(memberReason(w, "b", chk)).toBe("only_when_asked");
    expect(memberReason(w, "a", { ...chk, ownIntentCreatedAt: NOW - HOUR })).toBeNull();
    expect(memberReason(w, "a", { ...chk, ownIntentCreatedAt: NOW - 10 * DAY })).toBe("only_when_asked");
  });
  test("interruption budget (Normal 2/week) counts recent proposals, rolling", () => {
    const rp = (id: string, ago: number) => ({ id, kind: "intro" as const, participants: ["a", "b"], alternates: [], objective: "x", city: "sf" as const, score: 0, components: {} as any, exploration: false, explanations: {}, generator: "t", createdAt: NOW - ago });
    const w = mkWorld(two(i => { i.members[0]!.state = "normal"; i.recentProposals = [rp("p1", DAY), rp("p2", 2 * DAY)]; }));
    expect(memberReason(w, "a", chk)).toBe("interruption_budget");
    const w2 = mkWorld(two(i => { i.members[0]!.state = "normal"; i.recentProposals = [rp("p1", DAY), rp("p2", 8 * DAY)]; }));
    expect(memberReason(w2, "a", chk)).toBeNull();
    // Quiet: 1 per 30 days
    const w3 = mkWorld(two(i => { i.members[0]!.state = "quiet"; i.recentProposals = [rp("p1", 20 * DAY)]; }));
    expect(memberReason(w3, "a", chk)).toBe("interruption_budget");
    // In-run usage counts too
    expect(memberReason(mkWorld(two()), "a", { ...chk, extraProactive: 4 })).toBe("interruption_budget");
  });
  test("contribution budget only for contributor roles", () => {
    const w = mkWorld(two(i => { i.interactions = [1, 2].map(n => ({ id: `h${n}`, kind: "help" as const, category: "help" as const, participants: ["b", "a"], at: NOW - n * DAY, outcome: "completed" as const, contributors: ["a"] })); }));
    expect(memberReason(w, "a", { ...chk, role: "helper" })).toBe("contribution_budget");
    expect(memberReason(w, "a", { ...chk, role: "seeker" })).toBeNull();
  });
  test("member-set category quota", () => {
    const w = mkWorld(two(i => {
      i.categoryQuotas = { a: { professional: 1 } };
      i.recentProposals = [{ id: "p", kind: "intro", participants: ["a", "b"], alternates: [], objective: "", city: "sf", score: 0, components: {} as any, exploration: false, explanations: {}, generator: "t", createdAt: NOW - 10 * DAY, ...({ category: "professional" } as any) }];
    }));
    expect(memberReason(w, "a", { ...chk, category: "professional" })).toBe("category_quota");
    expect(memberReason(w, "a", chk)).toBeNull();
  });
  test("per-category cooldown after a decline", () => {
    const w = mkWorld(two(i => { i.interactions = [{ id: "d", kind: "intro", category: "hobby", participants: ["a", "b"], at: NOW - 2 * DAY, outcome: "declined", declinedBy: ["a"] }]; }));
    expect(memberReason(w, "a", { ...chk, category: "hobby" })).toBe("category_cooldown");
    expect(memberReason(w, "b", { ...chk, category: "hobby" })).toBeNull();
    expect(memberReason(w, "a", chk)).toBeNull();
  });
  test("reliability holdout: groups and time-sensitive only", () => {
    const w = mkWorld(two(i => { i.reliability = { a: { noShows: 2, completedSinceLastNoShow: 0 } }; }));
    expect(memberReason(w, "a", { ...chk, format: "small_group" })).toBe("reliability_holdout");
    expect(memberReason(w, "a", { ...chk, timeSensitive: true })).toBe("reliability_holdout");
    expect(memberReason(w, "a", chk)).toBeNull();
    const forgiven = mkWorld(two(i => { i.reliability = { a: { noShows: 1, completedSinceLastNoShow: 0 } }; }));
    expect(memberReason(forgiven, "a", { ...chk, format: "small_group" })).toBeNull();
  });
});

describe("pair-level hard filters", () => {
  test("blocked either direction, and avoid", () => {
    expect(pairReason(mkWorld(two(i => { i.edges.push({ from: "b", to: "a", type: "blocked", strength: 1, explicit: true, createdAt: NOW }); })), "a", "b", "social")).toBe("blocked");
    expect(pairReason(mkWorld(two(i => { i.edges.push({ from: "a", to: "b", type: "avoid", strength: 1, explicit: true, createdAt: NOW }); })), "b", "a", "social")).toBe("blocked");
  });
  test("negative feedback cooldown (90d) regardless of processed flag", () => {
    const mk = (processed: boolean, ago: number) => mkWorld(two(i => { i.feedback = [{ id: "f", from: "a", about: "b", at: NOW - ago, sentiment: "negative", processed }]; }));
    expect(pairReason(mk(false, DAY), "a", "b", "social")).toBe("negative_feedback_cooldown");
    expect(pairReason(mk(true, DAY), "b", "a", "social")).toBe("negative_feedback_cooldown");
    expect(pairReason(mk(true, 100 * DAY), "a", "b", "social")).toBeNull();
  });
  test("pair cooldown after decline/expiry; active duplicate guard", () => {
    expect(pairReason(mkWorld(two(i => { i.interactions = [{ id: "x", kind: "intro", category: "social", participants: ["a", "b"], at: NOW - 5 * DAY, outcome: "expired" }]; })), "a", "b", "hobby")).toBe("pair_cooldown");
    expect(pairReason(mkWorld(two(i => { i.interactions = [{ id: "x", kind: "intro", category: "social", participants: ["a", "b"], at: NOW - DAY, outcome: "pending" }]; })), "a", "b", "hobby")).toBe("active_duplicate");
  });
  test("completed / positive history never blocks (ME-005)", () => {
    const w = mkWorld(two(i => {
      i.interactions = [{ id: "x", kind: "intro", category: "social", participants: ["a", "b"], at: NOW - 3 * DAY, outcome: "completed" }];
      i.feedback = [{ id: "f1", from: "a", about: "b", at: NOW - 2 * DAY, sentiment: "positive", wouldMeetAgain: true, processed: true }];
      i.edges.push({ from: "a", to: "b", type: "enjoyed", strength: 0.9, explicit: true, createdAt: NOW - 2 * DAY });
    }));
    expect(pairReason(w, "a", "b", "social")).toBeNull();
  });
  test("romance: mutual opt-in + compatible stated preferences (age range, seeks/is)", () => {
    const rom = (i: EngineInput, seeksB: string, isB: string, ageB = 31) => {
      for (const m of i.members) { m.prefs.romanceOptIn = true; m.prefs.categoriesOptIn.push("romance"); }
      i.members[1]!.age = ageB;
      i.facets.push(facet("a", 0, "preference", "romance", ["romance:is:x", `romance:seeks:${seeksB === "x" ? "y" : "y"}`, "romance:age:25-35"], "agent_private"));
      i.facets.push(facet("b", 0, "preference", "romance", [`romance:is:${isB}`, `romance:seeks:${seeksB}`], "agent_private"));
    };
    expect(pairReason(mkWorld(two(i => rom(i, "x", "y"))), "a", "b", "romance")).toBeNull();
    expect(pairReason(mkWorld(two(i => rom(i, "x", "z"))), "a", "b", "romance")).toBe("romance_incompatible");
    expect(pairReason(mkWorld(two(i => rom(i, "x", "y", 50))), "a", "b", "romance")).toBe("romance_incompatible");
    expect(pairReason(mkWorld(two(i => { rom(i, "x", "y"); i.members[1]!.prefs.romanceOptIn = false; })), "a", "b", "romance")).toBe("romance_incompatible");
  });
  test("stated dealbreakers are hard filters", () => {
    const w = mkWorld(two(i => {
      i.facets.push(facet("a", 0, "boundary", "no smokers", ["dealbreaker:smoking"], "matchable"));
      i.facets.push(facet("b", 0, "trait", "smokes socially", ["smoking"], "matchable"));
    }));
    expect(pairReason(w, "a", "b", "social")).toBe("dealbreaker");
    expect(pairReason(w, "b", "a", "social")).toBe("dealbreaker");
  });
});

describe("configuration-level hard filters", () => {
  test("high-risk exclusions", () => {
    const w = mkWorld(two());
    expect(candidateReason(w, cand(["a", "b"], { riskText: "help with childcare for my kids" }))).toBe("high_risk");
    expect(candidateReason(w, cand(["a", "b"], { riskText: "home_hosted dinner" }))).toBe("high_risk");
  });
  test("home-entry help needs 2+ helpers or acquainted helpers (F14)", () => {
    const w = mkWorld(two(i => { i.members.push(baseMember("c")); }));
    const roles = { a: "seeker", b: "helper", c: "helper" } as const;
    expect(candidateReason(w, cand(["a", "b"], { kind: "help", category: "help", roles, riskText: "help move a couch from my apartment" }))).toBe("home_entry_rule");
    const two_ = cand(["a", "b", "c"], { kind: "help", category: "help", roles, format: "small_group", riskText: "help move a couch from my apartment" });
    expect(candidateReason(w, two_)).toBeNull();
    expect(two_.safetyClass).toBe("medium");
    const met = mkWorld(two(i => { i.edges.push({ from: "a", to: "b", type: "met", strength: 0.5, explicit: true, createdAt: NOW - DAY }); }));
    expect(candidateReason(met, cand(["a", "b"], { kind: "help", category: "help", roles, riskText: "help move a couch from my apartment" }))).toBeNull();
  });
  test("group size 3..6", () => {
    const inp = emptyInput(NOW);
    for (const id of "abcdefg") inp.members.push(baseMember(id));
    const w = mkWorld(inp);
    expect(candidateReason(w, cand(["a", "b"], { kind: "group", format: "small_group" }))).toBe("group_size");
    expect(candidateReason(w, cand([..."abcdefg"], { kind: "group", format: "small_group" }))).toBe("group_size");
    expect(candidateReason(w, cand([..."abc"], { kind: "group", format: "small_group" }))).toBeNull();
  });
  test("duplicate participants rejected", () => expect(candidateReason(mkWorld(two()), cand(["a", "a"]))).toBe("duplicate_participant"));
  test("presence: different cities never overlap; temporary travel creates overlap (ME-011)", () => {
    const w = mkWorld(two(i => { i.members[1]!.homeCity = "nyc"; }));
    expect(candidateReason(w, cand(["a", "b"]))).toBe("no_presence_overlap");
    const travel = mkWorld(two(i => { i.members[1]!.homeCity = "nyc"; i.presence.push({ memberId: "b", city: "sf", type: "temporary", areas: ["soma"], from: NOW + 2 * DAY, to: NOW + 4 * DAY }); }));
    const c = cand(["a", "b"]);
    expect(candidateReason(travel, c)).toBeNull();
    expect(c.city).toBe("sf");
    expect(c.window!.start).toBe(NOW + 2 * DAY);
    expect(c.window!.end).toBe(NOW + 4 * DAY);
  });
  test("presence: a member travelling away for the whole window cannot meet at home", () => {
    const w = mkWorld(two(i => { i.presence.push({ memberId: "b", city: "nyc", type: "temporary", areas: [], from: NOW - DAY, to: NOW + 10 * DAY }); }));
    expect(candidateReason(w, cand(["a", "b"]))).toBe("no_presence_overlap");
  });
  test("fixed event window requires presence in the event city at event time", () => {
    const w = mkWorld(two(i => { i.presence.push({ memberId: "b", city: "nyc", type: "temporary", areas: [], from: NOW + DAY, to: NOW + 2 * DAY }); }));
    const ev = { start: NOW + 30 * HOUR, end: NOW + 33 * HOUR };
    expect(candidateReason(w, cand(["a", "b"], { fixedWindow: ev, preferredCity: "sf", format: "event" }))).toBe("no_presence_overlap");
    expect(candidateReason(w, cand(["a", "b"], { fixedWindow: { start: NOW + 3 * DAY, end: NOW + 3 * DAY + 3 * HOUR }, preferredCity: "sf", format: "event" }))).toBeNull();
  });
});
