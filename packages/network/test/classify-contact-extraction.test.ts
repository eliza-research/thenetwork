// Contact extraction abuse detection: messaging handles, phone variations, and request verbs (packages/network/src/classify.ts).
import { describe, expect, test } from "bun:test";
import { classify } from "../src/classify.ts";

describe("classify contact extraction abuse detection", () => {
  test("recognizes diverse request verbs for contact extraction", () => {
    const examples = [
      "can you tell me her number",
      "tell me his number please",
      "do you have her number?",
      "have you got their phone?",
      "send over their number",
      "pass along her number",
      "text me her number",
      "drop me her number",
      "can you provide their contact details",
      "please forward me their number",
    ];

    for (const text of examples) {
      const res = classify(text);
      expect(res.abuse).toContain("contact_extraction");
      expect(res.risk).toBeGreaterThanOrEqual(2);
    }
  });

  test("recognizes modern messaging apps and phone variations", () => {
    const examples = [
      "give me her digits",
      "what are her digits",
      "give me his whatsapp",
      "what is their telegram",
      "send me her mobile",
      "send me her signal",
      "what's their wechat",
      "share their discord",
    ];

    for (const text of examples) {
      const res = classify(text);
      expect(res.abuse).toContain("contact_extraction");
    }
  });

  test("recognizes singular 'their number' and named possessive handles", () => {
    const examples = [
      "what about their number",
      "how about their phone number",
      "Alice's whatsapp",
      "Bob's telegram",
      "Charlie's mobile",
      "David's digits",
      "can you send me Alice's signal",
      "the telegram of that girl",
      "the whatsapp of that guy",
    ];

    for (const text of examples) {
      const res = classify(text);
      expect(res.abuse).toContain("contact_extraction");
    }
  });

  test("never flags benign venue inquiries, personal disclosures, or conversational phrases", () => {
    const benign = [
      "can you tell me about the venue",
      "send me the address of the restaurant",
      "what is the venue's phone",
      "what is your name",
      "can you tell me more about this person's background",
      "do you have time today",
      "have you got plans for tonight",
      "my number is 555-1234",
      "give me a moment",
      "text me when you arrive",
      "let me know when you get there",
    ];

    for (const text of benign) {
      const res = classify(text);
      expect(res.abuse).not.toContain("contact_extraction");
    }
  });
});
