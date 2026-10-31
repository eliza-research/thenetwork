import { describe, expect, test } from "bun:test";
import { feedbackOf } from "../src/classify.ts";

describe("feedbackOf sentiment analysis", () => {
  test("recognizes common positive descriptors as positive sentiment", () => {
    const positiveReplies = [
      "it was fun",
      "we had fun",
      "so much fun",
      "really enjoyed it",
      "enjoyed meeting them",
      "it was very enjoyable",
      "had a blast",
      "it was awesome",
      "it was wonderful",
      "had a fantastic time",
      "it went really well",
      "it went well",
      "had a good time",
      "she was lovely",
      "delightful conversation",
    ];

    for (const reply of positiveReplies) {
      const res = feedbackOf(reply);
      expect(res.sentiment).toBe("positive");
      expect(res.otherNoShow).toBe(false);
      expect(res.selfNoShow).toBe(false);
    }
  });

  test("recognizes 'hit it off' as positive sentiment and indicates mutual interest to meet again", () => {
    const res = feedbackOf("we hit it off");
    expect(res.sentiment).toBe("positive");
    expect(res.again).toBe(true);

    const res2 = feedbackOf("we really hit it off right away");
    expect(res2.sentiment).toBe("positive");
    expect(res2.again).toBe(true);
  });

  test("maintains negative sentiment on negations of positive descriptors", () => {
    const negativeReplies = [
      "wasn't fun at all",
      "didn't enjoy it",
      "not great",
      "wasn't awesome",
      "not wonderful",
      "didn't hit it off",
      "didn't click",
      "not my type",
      "nothing in common",
      "it was awkward",
    ];

    for (const reply of negativeReplies) {
      const res = feedbackOf(reply);
      expect(res.sentiment).toBe("negative");
      expect(res.again).toBe(false);
    }
  });

  test("keeps neutral sentiment for neutral or unremarkable statements", () => {
    const neutralReplies = [
      "it was ok",
      "it was fine",
      "we talked for an hour",
      "met up at the cafe",
    ];

    for (const reply of neutralReplies) {
      const res = feedbackOf(reply);
      expect(res.sentiment).toBe("neutral");
      expect(res.again).toBe(false);
    }
  });

  test("correctly flags again when explicitly requested without negation", () => {
    expect(feedbackOf("would love to meet again").again).toBe(true);
    expect(feedbackOf("we clicked right away").again).toBe(true);
    expect(feedbackOf("would not meet again").again).toBe(false);
    expect(feedbackOf("never want to see them again").again).toBe(false);
  });
});
