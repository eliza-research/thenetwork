// Append-only evasion and benign corpora for the shared leak guard (audit 2026-10-08 core-1, core-2,
// core-3, core-13, core-14, core-15, core-19..23, core-m3, core-m4). Each row was a miss or a false
// positive in the audit probes. Never delete a row to make a change pass.
import { describe, expect, test } from "bun:test";
import { contactVariants, findLeaks, fold, isSensitiveTerm, labelHash, LeakGuard, SENSITIVE_TERMS, setLeakLabelKey } from "../src/index.ts";

describe("core-2: contact details in disguise", () => {
  const EVASIONS: string[] = [
    "call two one two five five five zero one zero two",
    "call 212 five five five 0102",
    "call ２１２５５５０１０２",
    "call ٢١٢٥٥٥٠١٠٢",
    "call २१२५५५०१०२",
    "call 𝟐𝟏𝟐𝟓𝟓𝟓𝟎𝟏𝟎𝟐",
    "call 212 555 O1O2",
    "212_555_0102",
    "212x555x0102",
    "call 2️⃣1️⃣2️⃣5️⃣5️⃣5️⃣0️⃣1️⃣0️⃣2️⃣",
    "call 555-0102",
    "text 5550102",
    "my cell is five five five oh one oh two",
    "llamame al dos uno dos cinco cinco cinco cero uno cero dos",
    "WhatsApp +44 20 7946 0958",
    "212​555​0102",
    "sam (at) example (dot) com",
    "sam AT example DOT com",
    "sam＠example.com",
    "sam﹫example.com",
    "sam at gmail",
    "sam@gmail",
    "sam at mail dot example dot co dot uk",
    "sam[at]example[dot]com",
    "sam_at_example_dot_com",
    "sam @ example . com",
    "hxxps://evil example",
    "visit sam.dev",
    "visit mysite.ai",
    "notion.so/sam",
    "example . com",
    "t.me/samlee",
    "my insta is samlee_nyc",
    "ig: samlee_nyc",
    "insta:@samlee",
    "follow ＠samlee",
    "dm me@samlee",
    "discord samlee#1234",
    "snap: samleee",
  ];
  for (const t of EVASIONS) test(`caught: ${JSON.stringify(t)}`, () => expect(findLeaks(t).some(r => r.startsWith("contact:"))).toBe(true));

  const BENIGN: string[] = [
    "Your order #5550102 is confirmed.",
    "Booking ref 555-0102 at the front desk.",
    "We met in 2019, 2020 and 2021.",
    "Saturday 7 PM at Pier 25 (Tribeca).",
    "See you at 7:30-9:30 at the park.",
    "Hi Sam, I'm the Network's agent (an AI). Reply STOP anytime to opt out. To start: what would you like more of in your life right now?",
    "Meet at the gym at 6, then dinner at 8.",
    "It's one of the two best spots, three blocks from the five-way intersection.",
    "Looking at gmail is not my favorite thing.",
    "I'm into polka dot dresses and com sci memes.",
    "Pottery class at Greenpoint Clay, Sunday 2 PM. Beginners welcome, no experience needed.",
    "The event is free. Out. To the park we go!",
    "Board games night in a big group at the library. Want in?",
    "Theo is into urbanism. Dev (late 30s) is about 2-5 mi away. Ai is into chess. Co is too.",
  ];
  for (const t of BENIGN) test(`benign: ${JSON.stringify(t)}`, () => expect(findLeaks(t)).toEqual([]));

  test("venue addresses the Network sends on purpose pass with `allow`", () => {
    expect(findLeaks("Meet at 123 Bedford Ave", { allow: ["123 Bedford Ave"] })).toEqual([]);
  });
  test("contactVariants normalizes number words and other-script digits", () => {
    expect(contactVariants("two one two").some(v => v.includes("2 1 2"))).toBe(true);
    expect(contactVariants("٢١٢").some(v => v.includes("212"))).toBe(true);
  });
});

describe("core-1: short sensitive facts", () => {
  const facts = ["gay", "HIV+", "goes to AA", "IVF", "sober", "bipolar", "recently divorced"];
  const g = new LeakGuard({ facts: facts.map((text, i) => ({ text, owner: `m${i}` })), contacts: false });
  test.each([
    "fyi she's gay", "he is HIV positive", "he goes to AA on tuesdays", "they're doing IVF", "she's sober now",
    "he's bipolar", "she just got divorced", "heads up: g a y", "she's s0ber",
  ])("caught: %p", t => expect(g.check(t).length).toBeGreaterThan(0));
  test("the owner is not blocked by their own fact", () => expect(g.check("she's sober now", { exceptOwner: "m4" })).toEqual([]));
  test.each([
    "Want to grab coffee Saturday?", "A small group dinner on Friday.", "Board games night at the library. Want in?",
  ])("benign: %p", t => expect(g.check(t)).toEqual([]));
  test("forbidden (not only facts) also protects sensitive terms", () => {
    expect(findLeaks("she's in AA", { forbidden: ["AA meetings"] }).length).toBe(1);
  });
  test("a public phrase never cuts the sensitive part out (core-21)", () => {
    expect(findLeaks("someone who is sober", { forbidden: ["sober for two years"], publicPhrases: ["sober"] }).length).toBe(1);
  });
  test("one- and two-word facts with no sensitive term still do not block generic words", () => {
    expect(findLeaks("a climbing session", { forbidden: ["climbing", "rock music"] })).toEqual([]);
  });
  test("SENSITIVE_TERMS is folded and stem-aware", () => {
    for (const t of SENSITIVE_TERMS) expect(fold(t)).toBe(t);
    expect(isSensitiveTerm("divorced")).toBe(true);
    expect(isSensitiveTerm("climbing")).toBe(false);
  });
});

describe("core-3: homoglyphs and non-Latin facts", () => {
  const FACT = "is going through a divorce";
  test.each([
    "she is going through a ᴅɪᴠᴏʀᴄᴇ",
    "she is going through a divօrce",
    "she is going through a dıvorce",
    "she is going through a ᎠIVORCE",
    "she is going through a 𝒹𝒾𝓋𝑜𝓇𝒸𝑒",
    "she is going through a ⓓⓘⓥⓞⓡⓒⓔ",
    "she is going through a 🇩🇮🇻🇴🇷🇨🇪",
    "she is going through a di­vorce",
    "she is going through a d̶i̶v̶o̶r̶c̶e̶",
    "she is going through a di-vorce",
    "she is going through a di💔vorce",
  ])("forbidden, facts and vocabulary catch %p", t => {
    expect(findLeaks(t, { forbidden: [FACT], contacts: false }).length).toBe(1);
    expect(findLeaks(t, { facts: [FACT], contacts: false }).length).toBe(1);
    expect(findLeaks(t, { privateVocab: ["divorce"], contacts: false }).length).toBe(1);
  });
  test("non-Latin private facts compile and match", () => {
    expect(findLeaks("ella está pasando por un divorcio difícil", { facts: ["está pasando por un divorcio difícil"], contacts: false }).length).toBe(1);
    expect(findLeaks("он переживает развод", { facts: ["переживает развод"], contacts: false }).length).toBe(1);
    expect(findLeaks("她正在离婚", { facts: ["离婚"], contacts: false }).length).toBe(1);
    expect(findLeaks("今天天气很好", { facts: ["离婚"], contacts: false })).toEqual([]);
  });
  test("fold keeps letters of every script", () => expect(fold("Развод, 离婚!")).not.toBe(""));
});

describe("core-13: stopword runs do not block", () => {
  test("a 4-word run of stopwords is not evidence", () => {
    expect(findLeaks("and it is a great day", { forbidden: ["what it is a secret and it is a big deal"] })).toEqual([]);
    expect(findLeaks("it is a big deal for her", { forbidden: ["what it is a secret and it is a big deal"] }).length).toBe(1);
  });
});

describe("core-14: split across messages", () => {
  test("checkThread catches a number split over two messages", () => {
    const g = new LeakGuard();
    expect(g.check("0102")).toEqual([]);
    expect(g.checkThread(["call me at 212 555", "0102"]).some(r => r.startsWith("contact:"))).toBe(true);
  });
});

describe("core-15: vocabulary inflections and splits", () => {
  test.each(["she got divorced", "the divorcing couple", "di-vorce", "d.i.v.o.r.c.e"])("%p", t =>
    expect(findLeaks(t, { privateVocab: ["divorce"], contacts: false }).length).toBe(1));
});

describe("core-20: exact strings", () => {
  test("short names match whole words only", () => {
    expect(findLeaks("also, see you there", { exact: ["Al"], contacts: false })).toEqual([]);
    expect(findLeaks("ask Al about it", { exact: ["Al"], contacts: false }).length).toBe(1);
  });
  test("phone values match on their digits, however formatted", () => {
    expect(findLeaks("reach her on 2125550102", { exact: ["+1 (212) 555-0102"], contacts: false }).length).toBe(1);
    expect(findLeaks("reach her on two one two five five five zero one zero two", { exact: ["+1 (212) 555-0102"], contacts: false }).length).toBe(1);
  });
});

describe("core-23, core-7, core-m3, core-6", () => {
  test("bidi controls are flagged", () => expect(findLeaks("hello ‮world", { contacts: false })).toEqual(["format:bidi"]));
  test("long text is refused, and the email pattern is linear", () => {
    expect(findLeaks("a".repeat(20_001))).toEqual(["too_long"]);
    const evil = `${"a.".repeat(5000)}@${"a.".repeat(4000)}`;
    const t0 = performance.now();
    findLeaks(evil);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
  test("empty canaries and exact strings are reported as dropped; short canaries match as words", () => {
    const g = new LeakGuard({ canaries: ["", "XQ7"], exact: [""] });
    expect(g.dropped.length).toBe(2);
    expect(g.check("ref xq7 here")).toEqual([expect.stringMatching(/^canary:/)]);
    expect(g.check("xq7z")).toEqual([]);
  });
  test("labels can be keyed", () => {
    const plainLabel = labelHash("divorce");
    setLeakLabelKey("secret");
    try {
      expect(labelHash("divorce")).not.toBe(plainLabel);
      expect(labelHash("divorce")).toMatch(/^[0-9a-f]{8}$/);
    } finally { setLeakLabelKey(undefined); }
    expect(labelHash("divorce")).toBe(plainLabel);
  });
});

describe("core-m4: cost does not scan every fact", () => {
  test("10,000 facts check quickly", () => {
    const facts = Array.from({ length: 10_000 }, (_, i) => ({ text: `member ${i} privately worries about topic${i} and thing${i}`, owner: `m${i}` }));
    const g = new LeakGuard({ facts, contacts: false });
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) g.check("Saturday 7 PM bouldering at the mission climbing gym with 3 others. Want in?");
    expect((performance.now() - t0) / 20).toBeLessThan(50);
    expect(g.check("she worries about topic77 and thing77").length).toBe(1);
  });
});
