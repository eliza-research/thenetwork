import { describe, expect, test } from "bun:test";
import { checkInReport, reportKindOf, URGENT_REPORTS } from "../src/reports.ts";

describe("safety report classification with uncontracted modals, violence, and direct scam/harassment", () => {
  describe("unsafe category", () => {
    test("recognizes uncontracted forms of detainment and movement restriction", () => {
      expect(reportKindOf("he would not let me leave")).toBe("unsafe");
      expect(reportKindOf("he did not let me leave")).toBe("unsafe");
      expect(reportKindOf("he didn't let me leave")).toBe("unsafe");
      expect(reportKindOf("he refused to let me leave")).toBe("unsafe");
      expect(reportKindOf("he would not let me go")).toBe("unsafe");
      expect(reportKindOf("he refused to let me out")).toBe("unsafe");
      expect(checkInReport("he would not let me leave")).toBe("unsafe");
      expect(checkInReport("he refused to let me go")).toBe("unsafe");
    });

    test("recognizes physical violence, battery, and assault", () => {
      expect(reportKindOf("he hit me")).toBe("unsafe");
      expect(reportKindOf("he punched me")).toBe("unsafe");
      expect(reportKindOf("he choked me")).toBe("unsafe");
      expect(reportKindOf("he strangled me")).toBe("unsafe");
      expect(reportKindOf("he slapped me")).toBe("unsafe");
      expect(reportKindOf("he shoved me")).toBe("unsafe");
      expect(reportKindOf("he pushed me")).toBe("unsafe");
      expect(reportKindOf("he cornered me in the hallway")).toBe("unsafe");
      expect(reportKindOf("he trapped me in the car")).toBe("unsafe");
      expect(reportKindOf("he locked me in the room")).toBe("unsafe");
      expect(reportKindOf("he attacked me")).toBe("unsafe");
      expect(reportKindOf("he physically attacked me")).toBe("unsafe");
      expect(checkInReport("he attacked me and hit me")).toBe("unsafe");
    });

    test("recognizes weapons and stalking threats", () => {
      expect(reportKindOf("he had a weapon")).toBe("unsafe");
      expect(reportKindOf("he pulled a knife")).toBe("unsafe");
      expect(reportKindOf("he pulled a gun")).toBe("unsafe");
      expect(reportKindOf("he threatened me with a knife")).toBe("unsafe");
      expect(reportKindOf("he stalked me home")).toBe("unsafe");
      expect(reportKindOf("he is a stalker")).toBe("unsafe");
      expect(reportKindOf("I was terrified")).toBe("unsafe");
      expect(checkInReport("I was terrified, he had a weapon")).toBe("unsafe");
    });
  });

  describe("harassment category", () => {
    test("recognizes uncontracted refusal to stop", () => {
      expect(reportKindOf("he would not stop texting me")).toBe("harassment");
      expect(reportKindOf("she refused to stop calling")).toBe("harassment");
      expect(checkInReport("he would not stop")).toBe("harassment");
    });

    test("recognizes unsolicited imagery and unwanted touching", () => {
      expect(reportKindOf("he sent unsolicited pics")).toBe("harassment");
      expect(reportKindOf("he sent unsolicited photos")).toBe("harassment");
      expect(reportKindOf("he sent unsolicited nudes")).toBe("harassment");
      expect(reportKindOf("he sent a dick pic")).toBe("harassment");
      expect(reportKindOf("unwanted touching throughout the date")).toBe("harassment");
      expect(reportKindOf("inappropriate physical contact")).toBe("harassment");
      expect(checkInReport("he sent unsolicited photos")).toBe("harassment");
    });
  });

  describe("scam category", () => {
    test("recognizes cash demands and borrowing pitches", () => {
      expect(reportKindOf("he asked for cash")).toBe("scam");
      expect(reportKindOf("he demanded cash")).toBe("scam");
      expect(reportKindOf("he demanded money")).toBe("scam");
      expect(reportKindOf("he asked to borrow money")).toBe("scam");
      expect(reportKindOf("trying to borrow money from me")).toBe("scam");
      expect(reportKindOf("asked me to lend money")).toBe("scam");
      expect(reportKindOf("asked me to wire funds")).toBe("scam");
      expect(reportKindOf("asked me to send money via paypal")).toBe("scam");
      expect(checkInReport("he demanded cash and asked to borrow money")).toBe("scam");
    });
  });

  describe("lying category", () => {
    test("recognizes uncontracted photo discrepancies", () => {
      expect(reportKindOf("he did not look like his photos")).toBe("lying");
      expect(reportKindOf("she does not look like her pictures")).toBe("lying");
      expect(checkInReport("he did not look like his photos")).toBe("lying");
    });
  });

  describe("no_show category", () => {
    test("recognizes uncontracted absence and arrival phrases", () => {
      expect(reportKindOf("she did not show up")).toBe("no_show");
      expect(reportKindOf("he did not come")).toBe("no_show");
      expect(reportKindOf("they did not turn up")).toBe("no_show");
      expect(reportKindOf("he did not arrive")).toBe("no_show");
      expect(reportKindOf("they never arrived")).toBe("no_show");
      expect(reportKindOf("he stood us up")).toBe("no_show");
      expect(checkInReport("she did not show up")).toBe("no_show");
    });
  });

  describe("benign non-report check-ins", () => {
    test("keeps ordinary conversation and polite feedback clean", () => {
      expect(checkInReport("it was fine, not my type")).toBeUndefined();
      expect(checkInReport("great time, would see them again")).toBeUndefined();
      expect(checkInReport("nice dinner, we talked about work")).toBeUndefined();
      expect(checkInReport("we had a good coffee")).toBeUndefined();
    });
  });

  describe("urgency classification", () => {
    test("marks unsafe, harassment, scam, and minor as urgent staff targets", () => {
      expect(URGENT_REPORTS.has("unsafe")).toBe(true);
      expect(URGENT_REPORTS.has("harassment")).toBe(true);
      expect(URGENT_REPORTS.has("scam")).toBe(true);
      expect(URGENT_REPORTS.has("minor")).toBe(true);
      expect(URGENT_REPORTS.has("lying")).toBe(false);
      expect(URGENT_REPORTS.has("no_show")).toBe(false);
    });
  });
});
