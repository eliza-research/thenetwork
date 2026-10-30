import { describe, expect, it } from "bun:test";
import { checkInReport, reportKindOf, URGENT_REPORTS } from "../src/reports.ts";
import { otherAgeStated, classify } from "../src/classify.ts";

describe("minor report and age detection phrasing", () => {
  it("classifies natural check-in replies about minor counterparts as urgent minor reports", () => {
    const minorCases = [
      "my date was 16",
      "my date was only 15",
      "my match was 16",
      "the guy was 15",
      "the girl was 16",
      "this person was 16",
      "he was a 16-year-old",
      "she was a 15-year-old",
      "she is 15yo",
      "he is 16 yo",
      "she is 15 y/o",
      "he turned out to be 15",
      "turns out they were 16",
      "bob was 15",
      "alex was 17",
      "he was 15",
      "she was 16",
      "they were 14",
    ];

    for (const text of minorCases) {
      expect(reportKindOf(text)).toBe("minor");
      expect(checkInReport(text)).toBe("minor");
    }
  });

  it("does not false-positive on adult or non-age expressions", () => {
    const benignCases = [
      "it was fine, not my type",
      "great time, would see them again",
      "he is 25",
      "my date was 25",
      "my son is 12",
      "he was 15 minutes late",
      "she is 12 years older than me",
      "he was 5 blocks away",
      "I felt unsafe, he wouldn't let me leave",
      "they never showed up",
      "she lied about her age, she is way older than she said",
      "12 yo whisky is great",
      "our team is 15 people",
    ];

    for (const text of benignCases) {
      expect(checkInReport(text)).not.toBe("minor");
    }
  });

  it("extracts third-party stated ages with past tense, noun subjects, and compound forms", () => {
    expect(otherAgeStated("he was 15")).toBe(15);
    expect(otherAgeStated("she was 16")).toBe(16);
    expect(otherAgeStated("they were 14")).toBe(14);
    expect(otherAgeStated("bob was 15")).toBe(15);
    expect(otherAgeStated("alex was 17")).toBe(17);
    expect(otherAgeStated("my date was 16")).toBe(16);
    expect(otherAgeStated("my match was 15")).toBe(15);
    expect(otherAgeStated("the guy was 15")).toBe(15);
    expect(otherAgeStated("this person was 16")).toBe(16);
    expect(otherAgeStated("he was a 16-year-old")).toBe(16);
    expect(otherAgeStated("she is 15yo")).toBe(15);
    expect(otherAgeStated("he is 16 yo")).toBe(16);
    expect(otherAgeStated("she is 15 y/o")).toBe(15);

    // Adults and non-ages return undefined
    expect(otherAgeStated("he is 25")).toBeUndefined();
    expect(otherAgeStated("my date was 25")).toBeUndefined();
    expect(otherAgeStated("he was 15 minutes late")).toBeUndefined();
    expect(otherAgeStated("she is 12 years older than me")).toBeUndefined();
  });

  it("classifies inbound report commands with past-tense minor descriptions", () => {
    const c1 = classify("report Bob: he was a 16-year-old");
    expect(c1.kind).toBe("report");
    expect(c1.target).toBe("Bob");
    expect(c1.otherAge).toBe(16);

    const c2 = classify("report Alice, she was 15");
    expect(c2.kind).toBe("report");
    expect(c2.target).toBe("Alice");
    expect(c2.otherAge).toBe(15);
  });

  it("ensures minor is flagged as an urgent report kind", () => {
    expect(URGENT_REPORTS.has("minor")).toBe(true);
  });
});
