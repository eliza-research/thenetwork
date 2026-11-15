import { describe, expect, test } from "bun:test";
import { agesStated, classify, minorSignOf, sentencesOf } from "../src/classify.ts";

// A self-declared minor who writes the age in the "y.o." form ("I'm 15 y.o."). The sentence
// splitter used to break on every period, tearing "y.o." into "y." and "o." so the explicit-age
// rule (which reads each sentence) never saw the whole form: the member was classified with no
// age and no minor signal, and stayed in matching. Minors are never matched (Platform decision 1,
// PRD 17.4/28), so this is a fail-open safety defect. A period that starts an abbreviation is not
// a sentence end: it is followed by a lowercase letter, a real break is followed by a space, a
// capital, or end of text.
describe("classify: the y.o. age form is read as a minor (regression)", () => {
  test("sentencesOf keeps an abbreviated age one sentence", () => {
    expect(sentencesOf("i'm 15 y.o.").map(s => s.text)).toEqual(["i'm 15 y.o."]);
    // real breaks still split
    expect(sentencesOf("i'm 30. i'm 15.").map(s => s.text)).toEqual(["i'm 30.", " i'm 15."]);
  });

  for (const t of ["I'm 15 y.o.", "im 15 y.o.", "I'm 15 y.o., nyc", "I'm 15 y.o. I live in nyc"]) {
    test(`minor: ${JSON.stringify(t)}`, () => {
      const c = classify(t);
      expect(c.statedAge).toBe(15);
      expect(c.minorSignal).toBe(true);
    });
  }

  test("an adult who writes y.o. is not a minor", () => {
    for (const t of ["I'm 25 y.o.", "I'm 30 y.o. I live in Queens"]) {
      const c = classify(t);
      expect(c.statedAge).toBeGreaterThanOrEqual(18);
      expect(c.minorSignal).toBe(false);
    }
  });

  test("a real sentence break still reads the youngest age", () => {
    expect(agesStated("I'm 30. I'm 15.").age).toBe(15);
    expect(agesStated("I am 40 years old. I am 12 years old.").age).toBe(12);
    // the existing service-apps case
    expect(classify("Rae. I am 30 years old. I am 15.").statedAge).toBe(15);
  });
});
