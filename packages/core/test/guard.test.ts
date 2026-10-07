import { describe, expect, test } from "bun:test";
import { findLeaks, fold, LeakGuard } from "../src/index.ts";

const FACT = "is going through a divorce and doesn't want anyone to know yet (ref XE-4029-THISTLE)";

describe("leak guard", () => {
  test("fold: case, diacritics, homoglyphs, punctuation", () => {
    expect(fold("  Dívorce,\tＳoon!! ")).toBe("divorce soon");
    expect(fold("Gоing—through")).toBe("going through"); // Cyrillic о
  });

  test("contact details are caught in their common disguises", () => {
    const cases: [string, string][] = [
      ["Text me at (212) 555-0102", "contact:phone"],
      ["her number is +1 212 555 0102", "contact:phone"],
      ["write to sam.lee@example.com", "contact:email"],
      ["it's sam at example dot com", "contact:email_spelled"],
      ["come by 123 Bedford Ave tonight", "contact:street_address"],
      ["see bit.ly/grow-123", "contact:url"],
      ["https://example.test/x", "contact:url"],
      ["follow @samlee_nyc", "contact:handle"],
    ];
    for (const [text, reason] of cases) expect([text, findLeaks(text)]).toEqual([text, expect.arrayContaining([reason])]);
  });

  test("other members' private facts are caught whole and by 4-word fragments", () => {
    expect(findLeaks(`Heads up: Sam ${FACT}`, { forbidden: [FACT] })).toHaveLength(1);
    expect(findLeaks("I heard Sam is Going Through a Divorce.", { forbidden: [FACT] })).toHaveLength(1);
    expect(findLeaks("sam doesn't want anyone to find out", { forbidden: [FACT] })).toHaveLength(1);
    expect(findLeaks("the canary xe 4029 thistle", { canaries: ["XE-4029-THISTLE"] })).toEqual([expect.stringMatching(/^canary:/)]);
    // Three short boundary phrases are matched whole.
    expect(findLeaks("Fair warning, no loud venues for them.", { forbidden: ["no loud venues"] })).toHaveLength(1);
    // Reasons never carry the private text.
    expect(findLeaks(`x ${FACT}`, { forbidden: [FACT] }).join(" ")).not.toMatch(/divorce/);
  });

  test("ordinary Network messages pass (no false positives on generic words)", () => {
    const g = new LeakGuard({
      forbidden: [FACT, "climbing", "rock music", "no loud venues", "Open to dating; interested in women, ages 23-36"],
      canaries: ["XE-4029-THISTLE"],
      allow: ["Reply STOP to opt out."],
    });
    for (const text of [
      "Quick check, no names yet: would you be up for a climbing session this weekend near Greenpoint (someone who's into rock music too)? Yes or no is all I need, and no is completely fine.",
      "Thanks Ana! Here's who: Sam K.. They play tennis. I'd suggest Saturday 11 AM at NYPL Stephen A. Schwarzman Building (Midtown). Want me to set it up?",
      "You're set with Sam: Thursday 7 PM at Pier 25 (Tribeca). I'll send a reminder that day.",
      "Hi Sam, I'm the Network's agent (an AI). Reply STOP anytime to opt out. To start: what would you like more of in your life right now?",
      "A few ideas nearby: McCarren Park; Domino Park; St. George Library Center.",
      "Thanks Remy! Here's who: Tariq F.. I'd suggest Monday 7 PM at St. Mary's Park (Mott Haven). Want me to set it up?",
    ]) expect([text, g.check(text)]).toEqual([text, []]);
  });

  test("public vocabulary is cut out of private facts (place names, interest labels)", () => {
    const facts = ["lives near Hell's Kitchen", "AI and machine learning"];
    const probe = "Would you be up for a coffee this week near Hell's Kitchen (someone who's into AI and machine learning too)?";
    expect(findLeaks(probe, { forbidden: facts })).toHaveLength(2); // without the vocabulary both block
    expect(findLeaks(probe, { forbidden: facts, publicPhrases: ["Hell's Kitchen", "AI and machine learning"] })).toEqual([]);
    // What is left of a fact still counts.
    expect(findLeaks("an ex who stalks them", { forbidden: ["still lives near Hell's Kitchen with an ex who stalks them"], publicPhrases: ["Hell's Kitchen"] })).toHaveLength(1);
  });

  test("owner exclusion: a member's own facts are not a leak to themselves; canaries always are", () => {
    const g = new LeakGuard({ forbidden: [{ text: FACT, owner: "a" }], canaries: ["XE-4029-THISTLE"] });
    expect(g.check("going through a divorce and", { exceptOwner: "a" })).toEqual([]);
    expect(g.check("going through a divorce and", { exceptOwner: "b" })).toHaveLength(1);
    expect(g.check("ref XE-4029-THISTLE", { exceptOwner: "a" })).toHaveLength(1);
  });
});
