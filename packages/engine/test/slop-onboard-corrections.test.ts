import { describe, expect, it } from "bun:test";
import { extractSlopProfile } from "../src/packs/slop/extract.ts";
import { applyCorrection } from "../src/packs/slop/onboard.ts";

describe("slop onboarding: derived seeks updates and correction confirmation", () => {
  it("updates derived seeks when a member corrects orientation from straight to gay", () => {
    const p0 = extractSlopProfile(["straight guy 28-38 within 5 mi of 11211"]);
    expect(p0.gender?.value).toBe("man");
    expect(p0.orientation?.value).toBe("straight");
    expect(p0.seeks?.value).toEqual(["woman"]);
    expect(p0.seeks?.confidence).toBe(0.7);

    const p1 = applyCorrection(p0, "no, i'm gay");
    expect(p1.gender?.value).toBe("man");
    expect(p1.orientation?.value).toBe("gay");
    expect(p1.seeks?.value).toEqual(["man"]);
    expect(p1.confirmed).toBe(false);
  });

  it("clears derived seeks when a member corrects orientation to bisexual or queer", () => {
    const p0 = extractSlopProfile(["straight guy 28-38 within 5 mi of 11211"]);
    expect(p0.seeks?.value).toEqual(["woman"]);

    const p1 = applyCorrection(p0, "actually i'm bi");
    expect(p1.orientation?.value).toBe("bisexual");
    // Seeking from a stated label only applies where the label settles it; bi never settles it
    expect(p1.seeks).toBeUndefined();
    expect(p1.confirmed).toBe(false);
  });

  it("updates derived seeks when a member corrects gender", () => {
    const p0 = extractSlopProfile(["straight guy 28-38 within 5 mi of 11211"]);
    expect(p0.gender?.value).toBe("man");
    expect(p0.seeks?.value).toEqual(["woman"]);

    const p1 = applyCorrection(p0, "no, i'm a woman");
    expect(p1.gender?.value).toBe("woman");
    expect(p1.orientation?.value).toBe("straight");
    expect(p1.seeks?.value).toEqual(["man"]);
    expect(p1.confirmed).toBe(false);
  });

  it("does not confirm when correction is negative even if it starts with an affirmation word", () => {
    const p0 = extractSlopProfile(["woman into men 28-38 within 5 mi of 11211"]);
    const p1 = applyCorrection(p0, "right, no");
    expect(p1.confirmed).toBe(false);

    const p2 = applyCorrection(p0, "correct, wait no");
    expect(p2.confirmed).toBe(false);

    const p3 = applyCorrection(p0, "yep, no");
    expect(p3.confirmed).toBe(false);
  });

  it("does not confirm when correction reveals minor status", () => {
    const p0 = extractSlopProfile(["woman into men 28-38 within 5 mi of 11211"]);
    const p1 = applyCorrection(p0, "actually im 16");
    expect(p1.minor).toBe(true);
    expect(p1.confirmed).toBe(false);
  });
});
