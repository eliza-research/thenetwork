import { describe, expect, test } from "vitest";
import { hasOrElseThreat, OR_ELSE_THREAT } from "@thenetwork/core";
import { relayItem, type RelayContext } from "@thenetwork/engine";
import { classify } from "../src/classify.ts";

const relayPattern = new RegExp(OR_ELSE_THREAT, "i");

function adultRelayContext(): RelayContext {
  return {
    now: 1_760_000_000_000,
    opportunity: {
      id: "opp-or-else-1",
      app: "slop",
      participants: ["m-sender", "m-recipient"],
      acceptedBy: ["m-sender", "m-recipient"],
      status: "mutual",
    },
    sender: { id: "m-sender", firstName: "Alex", age: 29 },
    recipient: { id: "m-recipient", firstName: "Blair", age: 30 },
    blocked: false,
  };
}

describe("or-else threat detection across inbound classification and relay blocking", () => {
  test("detects multi-sentence terminal threats, curly apostrophes, and full future/going-to harmful tails", () => {
    const threats = [
      "Answer me or else. Stop ignoring my messages.",
      "Don't ignore me or else. I am serious.",
      "Pick up the phone or else! I am done waiting.",
      "Are you going to reply or else? Last chance.",
      "Reply to me right now or else\nI know you saw this",
      "Answer me or  else.",
      "Reply or else you’ll regret it.",
      "Answer me or else you're going to be sorry.",
      "Reply or else you're gonna pay for ignoring me.",
      "Call me back or else I'm going to show up at your apartment.",
      "Reply or else I’m gonna make you pay.",
      "Answer us or else we're going to show up at your house.",
      "Reply or else he's gonna hurt you.",
      "Answer me or else they're going to dox you.",
      "Text back or else she's going to ruin him.",
    ];

    for (const sample of threats) {
      expect(hasOrElseThreat(sample), sample).toBe(true);
      expect(relayPattern.test(sample), sample).toBe(true);
      const inbound = classify(sample);
      expect(inbound.abuse, sample).toContain("harassment");
      expect(inbound.risk, sample).toBeGreaterThanOrEqual(3);
      const relayed = relayItem(
        { id: "item-threat", kind: "text", from: "m-sender", to: "m-recipient", at: 1_760_000_000_000, text: sample },
        adultRelayContext(),
      );
      expect(relayed.decision, sample).toBe("block");
      expect(relayed.reasons, sample).toContain("harass_severe:threat");
    }
  });

  test("keeps benign alternative choices, dash/ellipsis pauses, quotes, benign advice, and third-party disclosures safe", () => {
    const benignChoices = [
      "Thursday works, or else Saturday.",
      "Thursday works; or else, Saturday works too.",
      "We could try climbing; or else: bouldering.",
      "We can meet at 6 or else — 7 works too.",
      "Coffee on Saturday or else - Sunday if that's easier.",
      "Let's do tacos or else -- sushi, your call.",
      "Thursday or else – Friday morning?",
      "Bowling or else… mini golf? Up to you.",
      "My favorite movie line is \"give me the remote or else!\" from that comedy.",
      "Grab the keys or else she's going to be sorry she lent us the car.",
      "Hurry or else it won't end well for our dinner reservation.",
      "Leave early or else things are going to get ugly on the highway.",
      "Meet me by the entrance, or else I'll wait by the fountain.",
      "I'll grab the coffee, or else you'll pay next time.",
      "I can do coffee or else we'll meet Thursday.",
      "Tuesday after 6, or else any time Sunday.",
    ];

    for (const sample of benignChoices) {
      expect(hasOrElseThreat(sample), sample).toBe(false);
      expect(relayPattern.test(sample), sample).toBe(false);
      const inbound = classify(sample);
      expect(inbound.abuse, sample).not.toContain("harassment");
      expect(inbound.risk, sample).toBe(0);
      const relayed = relayItem(
        { id: "item-benign", kind: "text", from: "m-sender", to: "m-recipient", at: 1_760_000_000_000, text: sample },
        adultRelayContext(),
      );
      expect(relayed.decision, sample).toBe("pass");
    }

    const disclosure = classify("He texted me answer me right now or else I'm going to show up at your apartment.");
    expect(disclosure.abuse).not.toContain("harassment");
    expect(disclosure.disclosure).toContain("harassment");
    expect(disclosure.risk).toBe(0);
  });
});
