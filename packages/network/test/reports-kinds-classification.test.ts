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
      "he shoved me outside",
      "he beat me up in the alley",
      "he physically beat me",
    ];

    for (const phrase of unsafePhrases) {
      const kind = reportKindOf(phrase);
      expect(kind).toBe("unsafe");
      expect(URGENT_REPORTS.has(kind)).toBe(true);
      expect(checkInReport(phrase)).toBe("unsafe");
    }
  });

  test("classifies explicit person subjects and noun targets in minor reports", () => {
    const minorPhrases = [
      "that girl was only 15",
      "the guy was 16",
      "this person is 14",
      "she was 16yo",
      "he was 15 yo",
      "my date was 16 years old",
      "underage member",
      "a minor joined",
    ];

    for (const phrase of minorPhrases) {
      const kind = reportKindOf(phrase);
      expect(kind).toBe("minor");
      expect(URGENT_REPORTS.has(kind)).toBe(true);
      expect(checkInReport(phrase)).toBe("minor");
    }
  });

  test("does not falsely flag benign figurative idioms or non-violent text as unsafe", () => {
    const benignIdioms = [
      "she beat me at chess",
      "he beat me at ping pong",
      "it hit me later that we want different things",
      "he hit me up the next day",
      "she struck me as kind",
      "she struck me as very smart",
    ];

    for (const phrase of benignIdioms) {
      expect(reportKindOf(phrase)).not.toBe("unsafe");
      expect(checkInReport(phrase)).toBeUndefined();
    }
  });

  test("does not falsely flag dates, groups, ratings, or weather as minor reports", () => {
    const benignConversations = [
      "there were 6 of us at the table",
      "we were 4 people",
      "dinner was 10/10",
      "it was 9 when we left",
      "ran into 2 old friends",
      "March was 12 degrees",
      "he was 15 minutes late",
      "she was 10 mins late",
      "waited 15 hours",
      "lived 2 blocks away",
      "he was 5 years in the army",
    ];

    for (const phrase of benignConversations) {
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

  test("does not falsely flag benign payment methods as scam reports", () => {
    const benignPayments = [
      "we split dinner on apple pay",
      "paid with apple pay",
      "split the tab via apple pay",
    ];

    for (const phrase of benignPayments) {
      expect(reportKindOf(phrase)).not.toBe("scam");
      expect(checkInReport(phrase)).toBeUndefined();
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

  test("does not falsely flag third-party transit delays as no-show", () => {
    const transitDelays = [
      "my train didn't arrive until 8",
      "the bus didn't arrive on time",
    ];

    for (const phrase of transitDelays) {
      expect(reportKindOf(phrase)).not.toBe("no_show");
      expect(checkInReport(phrase)).toBeUndefined();
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
