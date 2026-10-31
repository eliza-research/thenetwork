import { describe, expect, test } from "bun:test";
import { checkInReport, reportKindOf, URGENT_REPORTS } from "../src/reports.ts";

describe("reports classification and post-date checkInReport", () => {
  test("classifies physical violence, weapons, and assault as urgent unsafe reports", () => {
    const unsafePhrases = [
      "he pulled a knife on me",
      "he had a gun in his car",
      "he punched me after dinner",
      "he hit me in the face",
      "she struck me during the date",
      "threatened me with physical violence",
      "he attacked me on the walk",
      "there was a dangerous weapon",
    ];

    for (const phrase of unsafePhrases) {
      const kind = reportKindOf(phrase);
      expect(kind).toBe("unsafe");
      expect(URGENT_REPORTS.has(kind)).toBe(true);
      expect(checkInReport(phrase)).toBe("unsafe");
    }
  });

  test("classifies named subjects and noun targets in minor reports", () => {
    const minorPhrases = [
      "that girl was only 15",
      "the guy was 16",
      "this person is 14",
      "she was 16yo",
      "he was 15 yo",
      "Alice was 16",
    ];

    for (const phrase of minorPhrases) {
      const kind = reportKindOf(phrase);
      expect(kind).toBe("minor");
      expect(URGENT_REPORTS.has(kind)).toBe(true);
      expect(checkInReport(phrase)).toBe("minor");
    }
  });

  test("negative lookaheads in minor do not falsely flag durations, distances, or ages relative to user", () => {
    const falsePositives = [
      "he was 15 minutes late",
      "she was 10 mins late",
      "waited 15 hours",
      "lived 2 blocks away",
      "he was 5 years in the army",
    ];

    for (const phrase of falsePositives) {
      expect(reportKindOf(phrase)).not.toBe("minor");
      expect(checkInReport(phrase)).toBeUndefined();
    }
  });

  test("classifies modern payment methods and scams as urgent scam reports", () => {
    const scamPhrases = [
      "asked me to send money via paypal",
      "demanded cash through apple pay",
      "wanted me to transfer crypto via usdt",
      "it was a pyramid scheme",
      "tried to borrow money and never paid back",
    ];

    for (const phrase of scamPhrases) {
      const kind = reportKindOf(phrase);
      expect(kind).toBe("scam");
      expect(URGENT_REPORTS.has(kind)).toBe(true);
      expect(checkInReport(phrase)).toBe("scam");
    }
  });

  test("classifies no-show variations in checkInReport without requiring explicit report keyword", () => {
    const noShowPhrases = [
      "never showed up at the cafe",
      "he didn't arrive",
      "she never arrived",
      "he bailed on me",
      "they ghosted me completely",
      "stood me up outside",
    ];

    for (const phrase of noShowPhrases) {
      const kind = reportKindOf(phrase);
      expect(kind).toBe("no_show");
      expect(checkInReport(phrase)).toBe("no_show");
    }
  });

  test("classifies stalking under harassment", () => {
    const harassmentPhrases = [
      "he was stalking me after the date",
      "she stalked me on the way back",
    ];

    for (const phrase of harassmentPhrases) {
      const kind = reportKindOf(phrase);
      expect(kind).toBe("harassment");
      expect(URGENT_REPORTS.has(kind)).toBe(true);
      expect(checkInReport(phrase)).toBe("harassment");
    }
  });

  test("returns undefined for ordinary conversational check-ins", () => {
    const neutralPhrases = [
      "it was fine",
      "not really my type",
      "we had coffee and talked about books",
      "seemed nice enough",
    ];

    for (const phrase of neutralPhrases) {
      expect(checkInReport(phrase)).toBeUndefined();
    }
  });
});
