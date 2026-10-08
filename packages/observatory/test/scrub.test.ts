// OBS-09 (audit observatory-7, P2): the PII scrub of real-mode staff views. A golden corpus of
// contact details (phones as digits and as words, emails, addresses, links, handles, card numbers,
// social security numbers) must be masked; benign text the agent writes must come through unchanged;
// scrubbing is idempotent; displayName never shows a full last name. Phone numbers are the 555-01xx
// fiction range.
import { describe, expect, test } from "bun:test";
import { displayName, scrubText } from "../src/scrub.ts";

/** [text, the secret part that must not survive] */
const PII: [string, string][] = [
  ["call me at (212) 555-0101", "555-0101"],
  ["my number is +1 212 555 0102", "555 0102"],
  ["text 212.555.0103 anytime", "555.0103"],
  ["2125550104", "2125550104"],
  ["+12125550105", "2125550105"],
  ["reach me on 212-555-0106 after 6", "555-0106"],
  ["it's 1 (646) 555 0107", "555 0107"],
  ["646 555 0108!", "555 0108"],
  ["number: 718/555/0109", "555/0109"],
  ["two one two five five five zero one one zero", "five five five zero one one zero"],
  ["call six four six, five five five, zero one one one", "five five five, zero one one one"],
  ["my cell is 2 1 2 5 5 5 0 1 1 2", "5 5 5 0 1 1 2"],
  ["nine one seven five five five oh one one three", "five five five oh one one three"],
  ["it's 212 five five five 0114", "five five five 0114"],
  ["Seven one eight five five five zero one one five", "five five five zero one one five"],
  ["maya@example.org", "maya@example.org"],
  ["email me: maya.rose+date@example.com", "maya.rose+date@example.com"],
  ["MAYA@EXAMPLE.ORG", "MAYA@EXAMPLE.ORG"],
  ["write to j_doe99@mail.example.net", "j_doe99@mail.example.net"],
  ["maya at example dot com", "maya at example dot com"],
  ["maya [at] example [dot] org", "maya [at] example [dot] org"],
  ["ben (at) mail (dot) com", "ben (at) mail (dot) com"],
  ["I live at 123 Bedford Ave", "123 Bedford Ave"],
  ["come to 40 W 25th St", "40 W 25th St"],
  ["meet at 9 Ocean Parkway", "9 Ocean Parkway"],
  ["my place is 55 Water Street", "55 Water Street"],
  ["410 Grand Blvd apt 2", "410 Grand Blvd"],
  ["see https://example.org/me", "https://example.org/me"],
  ["profile at www.example.com/maya", "www.example.com/maya"],
  ["check maya.example.io", "maya.example.io"],
  ["my site is rose.me", "rose.me"],
  ["linktr.ee? no: maya.link", "maya.link"],
  ["follow @maya.rose", "@maya.rose"],
  ["dm me @mayarose_", "@mayarose_"],
  ["(@ben_k on there)", "@ben_k"],
  ["insta: maya.rose", "maya.rose"],
  ["Instagram: mayarose99", "mayarose99"],
  ["snap = mayaxo", "mayaxo"],
  ["tiktok:benk", "benk"],
  ["telegram: @ben_k", "ben_k"],
  ["my insta is maya.rose", "maya.rose"],
  ["add me on snap mayaxo", "mayaxo"],
  ["find me on instagram as rose_m", "rose_m"],
  ["my venmo is ben-k", "ben"],
  ["my whatsapp is benk22", "benk22"],
  ["venmo: ana_m", "ana_m"],
  ["card 4111 1111 1111 1111 exp 12/29", "4111 1111 1111 1111"],
  ["4111-1111-1111-1111", "4111-1111-1111-1111"],
  ["5500000000000004", "5500000000000004"],
  ["amex 3782 822463 10005", "3782 822463 10005"],
  ["my ssn is 123-45-6789", "123-45-6789"],
  ["SSN 123 45 6789", "123 45 6789"],
  ["social: 078-05-1120", "078-05-1120"],
  ["phone 212 555 0116, email ana@example.org", "ana@example.org"],
  ["call 212 555 0117 or ana@example.org", "555 0117"],
  ["at 123 Bedford Ave, or 212-555-0118", "555-0118"],
  ["ig: ben.k and 646-555-0119", "ben.k"],
  ["my discord is benk#0001", "benk"],
  ["cashapp: $benk", "benk"],
  ["text me 212 555 0120 thx", "555 0120"],
  ["number is two one two, five five five, zero one two one", "zero one two one"],
  ["kik: maya_r", "maya_r"],
];

/** What the agent writes to members every day: none of it may change. */
const BENIGN = [
  "Want to grab coffee with Maya on Saturday at 10?",
  "You two both play tennis on weekends in Park Slope.",
  "Your plan is booked: Thursday 7 PM at St. Mary's Park.",
  "Reply YES to say hi, or NO to pass.",
  "She has been in New York for 3 years and loves jazz.",
  "Meet at 7 pm near the fountain.",
  "We found 2 people who want a running partner.",
  "The event starts at 6:30 and ends at 9.",
  "Two of you said yes, one said maybe.",
  "Is 8 or 9 better for you?",
  "Ben is a nurse who likes climbing.",
  "I'll be there in 15 minutes.",
  "It was a snap decision but a good one.",
  "Your score this week: 3 meetings.",
  "Happy birthday! You turned 30 this year.",
  "We are at table 12.",
  "Reply STOP to opt out, HELP for help.",
  "One of them is free on Monday, the other on Friday.",
];

describe("PII scrub (OBS-09)", () => {
  test(`the golden corpus (${PII.length} strings) is masked`, () => {
    expect(PII.length).toBeGreaterThanOrEqual(60);
    for (const [text, secret] of PII) {
      const out = scrubText(text, false);
      expect([text, out.includes(secret)]).toEqual([text, false]);
      expect([text, /\[(phone|email|address|link|handle|card|ssn)\]/.test(out)]).toEqual([text, true]);
    }
  });

  test("benign agent text is unchanged", () => {
    for (const t of BENIGN) expect(scrubText(t, false)).toBe(t);
  });

  test("idempotent: scrubbing a scrubbed text changes nothing (property over the corpus and joined pairs)", () => {
    const all = [...PII.map(x => x[0]), ...BENIGN];
    for (const a of all) for (const b of [all[0]!, all[17]!, all[40]!, BENIGN[2]!]) {
      const once = scrubText(`${a} ${b}`, false);
      expect(scrubText(once, false)).toBe(once);
    }
  });

  test("revealed text is returned as it is", () => {
    for (const [t] of PII) expect(scrubText(t, true)).toBe(t);
  });

  test("displayName: first name and an initial, never the full last name; a missing name is 'Unnamed member'", () => {
    expect(displayName("Maya Rose Chen", false)).toBe("Maya C.");
    expect(displayName("  ana   lopez ", false)).toBe("ana L.");
    expect(displayName("Prince", false)).toBe("Prince");
    expect(displayName(null, false)).toBe("Unnamed member");
    expect(displayName(undefined, false)).toBe("Unnamed member");
    expect(displayName("   ", false)).toBe("Unnamed member");
    expect(displayName("Maya Rose Chen", true)).toBe("Maya Rose Chen");
    // Property: for any two-word name, the shown name never contains the last word when it is longer than one letter.
    for (const [first, last] of [["Ana", "Lopez"], ["Ben", "Ka"], ["Zoë", "Ångström"], ["李", "小龙"], ["Jo", "O'Neil"]]) {
      const shown = displayName(`${first} ${last}`, false);
      expect(shown.startsWith(first!)).toBe(true);
      expect(shown.includes(last!)).toBe(false);
    }
  });
});
