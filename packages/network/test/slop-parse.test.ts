// slop.date's parsers (service/slopParse.ts): the misreads found in the 2026-10-08 gap review, then
// edge cases. The eval corpora in evals/slop/ score them at scale (scripts/sim/evals.ts).
import { describe, expect, test } from "bun:test";
import { parseAgeRange, parseBasics, parseDistance, parseOrientation, parseZip } from "../service/slopParse.ts";
import * as packs from "../service/packs.ts";

describe("the four misreads", () => {
  test("negation: not into men, looking for women", () => {
    expect(parseOrientation("I'm a woman, not into men, looking for women")).toEqual({ is: "woman", seeks: ["woman"] });
  });
  test("a bare 'no women please, men only' seeks men", () => {
    expect(parseOrientation("no women please, men only", true)).toEqual({ seeks: ["man"] });
  });
  test("a man who likes men", () => {
    expect(parseOrientation("I'm a man who likes men")).toEqual({ is: "man", seeks: ["man"] });
  });
  test("late 20s to mid 30s is [27, 36]", () => {
    expect(parseAgeRange("late 20s to mid 30s", true)).toEqual([27, 36]);
  });
});

describe("orientation", () => {
  test.each([
    ["straight guy", true, { is: "man", seeks: ["woman"] }],
    ["gay woman", true, { is: "woman", seeks: ["woman"] }],
    ["lesbian", true, { is: "woman", seeks: ["woman"] }],
    ["I'm bi", true, { seeks: ["man", "woman"] }],
    ["queer, open to anyone", true, { seeks: ["man", "nonbinary", "woman"] }],
    ["anyone but men", true, { seeks: ["nonbinary", "woman"] }],
    ["only women", true, { seeks: ["woman"] }],
    ["women only", true, { seeks: ["woman"] }],
    ["I'm nonbinary, into women and nonbinary people", true, { is: "nonbinary", seeks: ["nonbinary", "woman"] }],
    ["I'm non-binary and I date men", false, { is: "nonbinary", seeks: ["man"] }],
    ["I'm a man looking for women", false, { is: "man", seeks: ["woman"] }],
    ["guys mostly", true, { seeks: ["man"] }],
    ["both", true, { seeks: ["man", "woman"] }],
    ["I'm a trans woman into women", false, { is: "woman", seeks: ["woman"] }],
    ["m4w", true, { is: "man", seeks: ["woman"] }],
  ] as const)("%p (bare %p)", (text, bare, want) => {
    expect(parseOrientation(text, bare)).toEqual(want as never);
  });
  test("nothing is guessed", () => {
    expect(parseOrientation("I'm into all kinds of music")).toEqual({});
    expect(parseOrientation("I like both hiking and music")).toEqual({});
    expect(parseOrientation("yes all good", true)).toEqual({});
    expect(parseOrientation("not into men", true)).toEqual({});
    // "Not straight" is not a label about who they seek.
    expect(parseOrientation("I'm a woman, not straight", true)).toEqual({ is: "woman" });
    // A negation about anyone is not about gender.
    expect(parseOrientation("not into anyone who smokes, looking for women")).toEqual({ seeks: ["woman"] });
  });
});

describe("age range", () => {
  test.each([
    ["25-35", false, [25, 35]],
    ["25 to 35", false, [25, 35]],
    ["between 25 and 30", false, [25, 30]],
    ["25–30", true, [25, 30]],
    ["30s", true, [30, 39]],
    ["mid 30s", true, [34, 36]],
    ["early to mid thirties", true, [30, 36]],
    ["25 to early 30s", true, [25, 33]],
    ["late 20s-35", true, [27, 35]],
    ["around 30", true, [27, 33]],
    ["30ish", true, [27, 33]],
    ["30+", true, [30, 99]],
    ["under 40", true, [18, 39]],
    ["16-25", true, [18, 25]],
    ["35-28", true, [28, 35]],
  ] as const)("%p (bare %p)", (text, bare, want) => {
    expect(parseAgeRange(text, bare)).toEqual([...want] as [number, number]);
  });
  test("my age needs a stated age", () => {
    expect(parseAgeRange("around my age", true, 31)).toEqual([28, 34]);
    expect(parseAgeRange("my age", true)).toBeUndefined();
    expect(parseAgeRange("my age", true, 19)).toEqual([18, 22]);
  });
  test("not a range", () => {
    expect(parseAgeRange("30s", false)).toBeUndefined();
    expect(parseAgeRange("I'm in my late 20s", true)).toBeUndefined();
    expect(parseAgeRange("10-20 minutes away", false)).toBeUndefined();
    expect(parseAgeRange("I live in 11211", true)).toBeUndefined();
  });
});

describe("distance and zip", () => {
  test.each([
    ["within 5 miles", false, { miles: 5 }],
    ["10mi", false, { miles: 10 }],
    ["two miles", false, { miles: 2 }],
    ["8 km", false, { miles: 5 }],
    ["walking distance", false, { miles: 2 }],
    ["same borough", false, { miles: 5 }],
    ["just the city", false, { city: true }],
    ["5", true, { miles: 5 }],
    ["half a mile", false, { miles: 2 }],
  ] as const)("%p (bare %p)", (text, bare, want) => {
    expect(parseDistance(text, bare)).toEqual(want);
  });
  test("not a distance", () => {
    expect(parseDistance("5", false)).toBeUndefined();
    expect(parseDistance("I ran a 5k today", true)).toBeUndefined();
  });
  test("zip: a 5-digit token, never part of a longer number", () => {
    expect(parseZip("11211")).toBe("11211");
    expect(parseZip("I'm in 11211, Williamsburg")).toBe("11211");
    expect(parseZip("11211-1234")).toBe("11211");
    expect(parseZip("call 2125550102")).toBeUndefined();
    expect(parseZip("123456")).toBeUndefined();
    expect(parseZip("$12000")).toBeUndefined();
    expect(parseZip("1,11211")).toBeUndefined();
  });
});

describe("basics", () => {
  test("goal, dealbreakers and none", () => {
    expect(parseBasics("something serious")).toEqual({ goal: "long_term", dealbreakers: [] });
    expect(parseBasics("not looking for anything serious").goal).toBe("casual");
    expect(parseBasics("no smokers, and no kids").dealbreakers).toEqual(["smoker", "has_kids"]);
    expect(parseBasics("none really")).toEqual({ dealbreakers: [], none: true });
  });
  test("packs.ts re-exports the parsers", () => {
    expect(packs.parseOrientation).toBe(parseOrientation);
    expect(packs.parseZip).toBe(parseZip);
  });
});
