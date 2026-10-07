// Fuzzy private-fact matching, ported from prototypes/connector-mcp/tests/leak-fuzzy.test.ts (audit
// 2026-10-07 P1-3): the guard must catch partial, leetspeak and reordered leaks of private facts, not
// only exact strings. These facts deliberately have no canary.
import { describe, expect, test } from "bun:test";
import { findLeaks, LeakGuard, stem, textVariants } from "../src/index.ts";

const FACT = "feeling isolated since the move";
const SECRET = "job search is secret from her manager";
const facts = [FACT, SECRET];
const leaks = (text: string, fs = facts) => findLeaks(text, { facts: fs, contacts: false });

describe("findLeaks: fuzzy private-fact matching (facts)", () => {
  test.each([
    ["exact", "She's feeling isolated since the move."],
    ["fragment", "Honestly, isolated since the move, poor thing"],
    ["leetspeak", "she has felt 1s0lat3d since the m0ve"],
    ["reordered", "the move has left her really isolated"],
    ["inflected", "isolation after moving is hard for her"],
    ["spaced letters", "she is i s o l a t e d after the move"],
    ["zero-width joiners", "she is iso​lated since the mo​ve"],
    ["homoglyphs", "she is іsolated since the mоve"], // Cyrillic і and о
    ["second fact fragment", "keep her job search quiet, it's secret"],
    ["second fact reordered", "a secret: she's searching for a new job"],
  ])("%s is blocked", (_label, text) => {
    expect(leaks(text).length).toBeGreaterThan(0);
  });

  test.each([
    "Maya, a product designer who also boulders, is around on Thursday evenings.",
    "Want an intro? You can say no at any time.",
    "We moved the event to Saturday.",
    "Nothing new right now. I'll reach out when something genuinely fits.",
    "Here's what I use to look out for you: Climbs at Mission Cliffs on Thursdays",
  ])("benign output %p is not blocked", (text) => {
    expect(leaks(text)).toEqual([]);
  });

  test("labels never contain the blocked value", () => {
    const out = leaks("isolated since the move");
    expect(out.length).toBe(1);
    expect(out[0]).toMatch(/^forbidden:[0-9a-f]{8}$/);
    expect(out[0]).not.toContain("isolat");
  });

  test("canary prefixes and (ref …) markers are stripped so the fact body alone is matched", () => {
    expect(leaks("she was recently divorced", ["CANARY_MAYA_MATCHABLE_recently divorced"]).length).toBe(1);
    expect(leaks("divorced, recently", ["CANARY_MAYA_MATCHABLE_recently divorced"]).length).toBe(1);
    // The marker's words ("ref", the token) do not count as fact words.
    expect(leaks("ref thistle, see you there", ["recently divorced (ref XE-4029-THISTLE)"])).toEqual([]);
    expect(leaks("divorced, recently", ["recently divorced (ref XE-4029-THISTLE)"]).length).toBe(1);
  });

  test("forbidden strings keep whole/4-gram matching unless fuzzy is on", () => {
    expect(findLeaks("the move has left her really isolated", { forbidden: [FACT] })).toEqual([]);
    expect(findLeaks("the move has left her really isolated", { forbidden: [FACT], fuzzy: true })).toHaveLength(1);
  });

  test("leetspeak and spaced letters also reach whole/4-gram, vocabulary and canary matching", () => {
    expect(findLeaks("sam is g0ing thr0ugh a d1vorce", { forbidden: ["is going through a divorce"] })).toHaveLength(1);
    expect(findLeaks("she is d i v o r c i n g", { privateVocab: ["divorcing"] })).toHaveLength(1);
    expect(findLeaks("ref XE-4O29-THISTLE", { canaries: ["XE-4029-THISTLE"] })).toEqual([]); // letter O for zero: not undone in a digit-only token
    expect(findLeaks("ref xe4029thistle", { canaries: ["XE-4029-THISTLE"] })).toHaveLength(1);
  });

  test("stemmer basics", () => {
    expect(stem("isolated")).toBe(stem("isolation"));
    expect(stem("moving")).toBe(stem("moved"));
    expect(stem("divorced")).toBe(stem("divorce"));
  });

  test("textVariants undoes leetspeak only inside mixed letter/digit tokens", () => {
    expect(textVariants("c0cktail at 7 PM")).toContain("cocktail at 7 pm");
    expect(textVariants("c0cktail at 7 PM").some(v => v.includes("at t pm"))).toBe(false);
  });
});

describe("fuzzy facts: no false positives on ordinary Network messages", () => {
  // Realistic private facts (multi-word, as stored on agent_private facets).
  const PRIVATE = [
    "is going through a divorce and doesn't want anyone to know yet (ref XE-4029-THISTLE)",
    "feeling isolated since the move",
    "job search is secret from her manager",
    "still lives near Hell's Kitchen with an ex who stalks them",
    "recovering from knee surgery, can't climb until spring",
    "struggles with social anxiety in big groups",
  ];
  const g = new LeakGuard({
    facts: PRIVATE.map((text, i) => ({ text, owner: `m${i}` })),
    canaries: ["XE-4029-THISTLE"],
    allow: ["Reply STOP to opt out."],
    publicPhrases: ["Hell's Kitchen"],
  });

  test.each([
    "Quick check, no names yet: would you be up for a climbing session this weekend near Greenpoint (someone who's into rock music too)? Yes or no is all I need, and no is completely fine.",
    "Thanks Ana! Here's who: Sam K.. They play tennis. I'd suggest Saturday 11 AM at NYPL Stephen A. Schwarzman Building (Midtown). Want me to set it up?",
    "You're set with Sam: Thursday 7 PM at Pier 25 (Tribeca). I'll send a reminder that day.",
    "Hi Sam, I'm the Network's agent (an AI). Reply STOP anytime to opt out. To start: what would you like more of in your life right now?",
    "A few ideas nearby: McCarren Park; Domino Park; St. George Library Center.",
    "Thanks Remy! Here's who: Tariq F.. I'd suggest Monday 7 PM at St. Mary's Park (Mott Haven). Want me to set it up?",
    "Would you be up for a coffee this week near Hell's Kitchen?",
    "A small group dinner on Friday: four people who just moved to the city and want to meet friends.",
    "Pottery class at Greenpoint Clay, Sunday 2 PM. Beginners welcome, no experience needed.",
    "Board games night in a big group at the library. Want in?",
    "Job fair for designers next Thursday; want me to send details?",
  ])("passes: %p", (text) => {
    expect(g.check(text)).toEqual([]);
  });

  test("but paraphrases of those facts are caught, and owners are respected", () => {
    expect(g.check("heads up, she is going through a d1vorce")).toHaveLength(1);
    expect(g.check("FYI she can't climb, knee surgery recovery")).toHaveLength(1);
    expect(g.check("they get anxious in big groups, social anxiety")).toHaveLength(1);
    expect(g.check("careful, with an ex who stalks them")).toHaveLength(1);
    expect(g.check("FYI she can't climb, knee surgery recovery", { exceptOwner: "m4" })).toEqual([]);
  });
});

describe("exact strings (ids, names, contact values)", () => {
  test("any substring, case- and Unicode-insensitive; squashed when 6+ chars", () => {
    expect(findLeaks("ask Maya about it", { exact: ["Maya"], contacts: false })).toHaveLength(1);
    expect(findLeaks("id: MEM_ab12", { exact: ["mem_ab12"], contacts: false })).toHaveLength(1);
    expect(findLeaks("s.a.m.l.e.e.n.y.c", { exact: ["samleenyc"], contacts: false })).toHaveLength(1);
    expect(findLeaks("nothing here", { exact: ["", "Maya"] })).toEqual([]);
  });

  test("labels are hashes", () => {
    const [l] = findLeaks("ask Maya", { exact: ["Maya"] });
    expect(l).toMatch(/^forbidden:[0-9a-f]{8}$/);
  });
});
