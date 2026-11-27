import { describe, expect, test } from "vitest";
import { phoneChangeLinkRequest } from "../service/phone-change-link.ts";

describe("phone-change text after onboarding", () => {
  test("a member who reports a changed number gets the phone-change link", () => {
    const reports = [
      "change my phone number",
      "CHANGE NUMBER",
      "update my phone number",
      "I changed my number to 415-555-0199.",
      "I changed my number to +1 415 555 0199",
      "I just changed my phone number.",
      "I have changed my number.",
      "My number changed.",
      "My phone number has changed to 415-555-0199.",
      "I have a new number.",
      "I got a new phone number: 415-555-0199",
      "My new number is 415-555-0199.",
      "change my number to 415-555-0199",
      "Please update my number to +14155550199.",
      "I switched my number to 415-555-0199.",
    ];
    for (const text of reports) expect(phoneChangeLinkRequest(text), text).toBe(true);
  });

  test("mentions that are not the sender's own number change get no link", () => {
    const mentions = [
      "I didn't change my number.",
      "If I change my number, I'll tell you.",
      "My friend changed her number to 415-555-0199.",
      "She changed her number.",
      "What's her new number?",
      "Did you change my number?",
      "Call me at 415-555-0199.",
      "I changed my mind about dinner.",
      "My number is 415-555-0199.",
      "\"I changed my number to 415-555-0199,\" she said.",
      "I might change my number next month.",
      "Don't change my number.",
      "change her number",
      "I changed my number to a new apartment.",
    ];
    for (const text of mentions) expect(phoneChangeLinkRequest(text), text).toBe(false);
  });
});
