import { expect, test } from "bun:test";
import { parseRelayRequest, relayItemFromRequest, relayItem, type RelayContext } from "../../engine/src/relay.ts";

const baseCtx = (): RelayContext => ({
  now: 1_700_000_000_000,
  opportunity: { id: "m1", app: "friends", participants: ["a", "b"], acceptedBy: ["a", "b"], status: "mutual" },
  sender: { id: "a", firstName: "Alice", age: 28 },
  recipient: { id: "b", firstName: "Bob", age: 30 },
  blocked: false,
});

test("parseRelayRequest: recognizes polite modal text requests and question forms", () => {
  const modalTextRequests: [string, string][] = [
    ["tell them I'm running late", "I'm running late"],
    ["Can you tell them I'm running late", "I'm running late"],
    ["Can you tell them I'm running late?", "I'm running late"],
    ["Could you tell Sam that I will be 5 minutes late", "I will be 5 minutes late"],
    ["Could you tell Sam that I will be 5 minutes late?", "I will be 5 minutes late"],
    ["Can you please tell my date I am wearing a blue hat", "I am wearing a blue hat"],
    ["Could you please let them know that I am outside", "I am outside"],
    ["Can you let her know I arrived", "I arrived"],
    ["Can you let her know I arrived?", "I arrived"],
    ["Would you tell them I will be right there", "I will be right there"],
    ["Would you tell them I will be right there?", "I will be right there"],
    ["Would you please tell her I'm at the bar", "I'm at the bar"],
    ["Can u tell them I'm on my way", "I'm on my way"],
    ["Could u let her know I'm parking", "I'm parking"],
    ["Please can you tell them I'm here", "I'm here"],
    ["Please could you tell them I'll be right outside", "I'll be right outside"],
    ["Can you ask them what table they are at?", "what table they are at?"],
    ["Could you ask them if 7 works?", "if 7 works?"],
  ];

  for (const [text, expectedBody] of modalTextRequests) {
    const res = parseRelayRequest(text);
    expect(res.kind).toBe("text");
    if (res.kind === "text") {
      expect(res.body).toBe(expectedBody);
    }
  }
});

test("parseRelayRequest: preserves negated message content without falsely marking relay request as negated", () => {
  const contentWithNegations: [string, string][] = [
    ["tell them that I won't be long", "I won't be long"],
    ["let Sam know I do not eat dairy", "I do not eat dairy"],
    ["tell her I've never been here before", "I've never been here before"],
    ["tell them don't wait for me", "don't wait for me"],
    ["tell them that I'm not yet at the station", "I'm not yet at the station"],
    ["let them know I cannot make it until 7", "I cannot make it until 7"],
    ["Can you tell them don't worry about being late?", "don't worry about being late"],
    ["Could you tell Sam that I'd rather not do sushi?", "I'd rather not do sushi"],
    ["tell them we shouldn't rush", "we shouldn't rush"],
  ];

  for (const [text, expectedBody] of contentWithNegations) {
    const res = parseRelayRequest(text);
    expect(res.kind).toBe("text");
    if (res.kind === "text") {
      expect(res.body).toBe(expectedBody);
    }
  }
});

test("parseRelayRequest: honors pre-verb request negations as none", () => {
  const negatedRequests = [
    "don't tell them I'm running late",
    "do not tell Sam that I arrived",
    "please don't tell them I am late",
    "never tell Sam about this",
    "no need to tell them I am here",
    "can you not tell them I arrived",
    "could you please not let them know",
  ];

  for (const text of negatedRequests) {
    expect(parseRelayRequest(text).kind).toBe("none");
  }
});

test("parseRelayRequest: recognizes modal requests for contact share and photo sends", () => {
  const contactShares = [
    "send them my number",
    "Can you give her my number?",
    "Could you share my number with him?",
    "Would you send them my number?",
    "Would you send them my number",
    "Would you please share my contact info with them?",
    "text my number to her",
    "forward my number to them",
    "pass my contact info to Jordan",
  ];

  for (const text of contactShares) {
    expect(parseRelayRequest(text).kind).toBe("contact_share");
  }

  const photoSends = [
    "send them this photo",
    "Can you send them this photo?",
    "Could you share this pic with her?",
    "Would you send them this photo?",
    "Would you share this picture with Sam?",
    "show this photo to Sam",
    "send the photo to them",
    "send this image to her",
    "pass this photo to them",
  ];

  for (const text of photoSends) {
    expect(parseRelayRequest(text).kind).toBe("photo");
  }
});

test("parseRelayRequest: continues to hold true hedges, advice questions, and explicit refusals as none", () => {
  const hedgesAndRefusals = [
    "should I send them my number?",
    "don't send them my number",
    "not yet, don't share my number",
    "maybe send my number later",
    "do you think I should share my number?",
    "I'll send my number after the date",
    "Is it ok to send them my number?",
    "Would it be okay to send my number?",
    "would that work if I send my number?",
    "would I be allowed to share my number?",
    "never give anyone my number",
    "what's their number?",
    "can I see their photo?",
    "could I see their picture?",
    "hold off on sending my number",
    "wait before you send them my number",
    "I don't want to send my photo",
    "stop, don't send that photo",
  ];

  for (const text of hedgesAndRefusals) {
    expect(parseRelayRequest(text).kind).toBe("none");
  }
});

test("relay pipeline: end-to-end delivery of modal requests and messages with negative content", () => {
  const ctx = baseCtx();
  const at = ctx.now;

  // 1. Polite modal text request
  const req1 = parseRelayRequest("Can you tell them that I will be 5 minutes late?");
  expect(req1.kind).toBe("text");
  const item1 = relayItemFromRequest(req1, { id: "item-1", from: "a", to: "b", at });
  expect(item1).not.toBeNull();
  const res1 = relayItem(item1!, ctx);
  expect(res1.decision).toBe("pass");
  expect(res1.rendered).toBe('Alice says: "I will be 5 minutes late"');

  // 2. Message with negative content
  const req2 = parseRelayRequest("tell them that I won't be long");
  expect(req2.kind).toBe("text");
  const item2 = relayItemFromRequest(req2, { id: "item-2", from: "a", to: "b", at });
  expect(item2).not.toBeNull();
  const res2 = relayItem(item2!, ctx);
  expect(res2.decision).toBe("pass");
  expect(res2.rendered).toBe('Alice says: "I won\'t be long"');

  // 3. Polite modal contact share request
  const req3 = parseRelayRequest("Would you please send them my number?");
  expect(req3.kind).toBe("contact_share");
  const item3 = relayItemFromRequest(req3, {
    id: "item-3",
    from: "a",
    to: "b",
    at,
    contact: { kind: "phone", value: "+12125550181" },
  });
  expect(item3).not.toBeNull();
  const res3 = relayItem(item3!, ctx);
  expect(res3.decision).toBe("pass");
  expect(res3.rendered).toContain("+12125550181");

  // 4. Reverse preposition photo send
  const req4 = parseRelayRequest("show this photo to Sam");
  expect(req4.kind).toBe("photo");
  const item4 = relayItemFromRequest(req4, {
    id: "item-4",
    from: "a",
    to: "b",
    at,
    photoIds: ["ph_valid1234"],
  });
  expect(item4).not.toBeNull();
});
