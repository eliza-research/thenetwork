import { expect, test } from "vitest";
import { parseOptOut, SimClock } from "@thenetwork/core";
import { APPS } from "../../platform/src/apps.ts";
import { detectKeyword, keywordEvent, leaveTarget, resolveConsent } from "../../platform/src/consent.ts";
import { SimChannel } from "../src/channel.ts";

// spec/carrierConsent.md, "Direct repeated and permanent refusals stop the shared line"
test.each([
  { text: "I said stop", stops: true },
  { text: "I already said stop", stops: true },
  { text: "I told you to stop", stops: true },
  { text: "STOP!! I said stop", stops: true },
  { text: "STOP, I told you to stop", stops: true },
  { text: "I never want to hear from you again", stops: true },
  { text: "I never want to hear from you", stops: true },
  { text: "I don’t want to hear from you anymore", stops: true },
  { text: "I do not want to hear from you again", stops: true },
  { text: "I said I never want to hear from you again", stops: true },
  { text: '"I said stop"', stops: false },
  { text: '“I told you to stop”', stops: false },
  { text: '"I never want to hear from you again"', stops: false },
  { text: "I did not say I said stop", stops: false },
  { text: "I told you to stop slop", stops: false },
  { text: "I told you to stop until Monday", stops: false },
  { text: "She was laughing when I told you to stop dancing", stops: false },
  { text: "I said stop?", stops: false },
  { text: "I told you to stop?", stops: false },
  { text: "I don't want to hear from you anymore, at least until next week", stops: false },
  { text: "I don't want to hear from you again about jobs", stops: false },
  { text: "My ex said I never want to hear from you again", stops: false },
  { text: "I never want to hear from you again?", stops: false },
  { text: "Stop slop", stops: false, leave: "slop" },
])("the shared line honors the scope of $text", ({ text, stops, leave }) => {
  const phone = "+12125550111";
  const now = Date.UTC(2026, 10, 22, 17);
  const apps = Object.values(APPS);
  expect(leaveTarget(text)).toBe(leave);
  const keyword = detectKeyword(text);
  expect(keyword).toBe(stops ? "stop" : undefined);
  const global = keyword ? keywordEvent(keyword, phone, APPS.friends, now, { scope: "global" }).event : undefined;
  expect(global?.app === null).toBe(stops);
  for (const app of apps) {
    const appEvent = keywordEvent("start", phone, app, now - 1).event;
    expect(resolveConsent({ app: appEvent, global })).toBe(stops ? "opted_out" : "opted_in");
  }

  const conversation = parseOptOut(text, { apps: apps.map(app => app.domain) });
  expect(conversation.match !== "none" && conversation.scope === "all").toBe(stops);
  const channel = new SimChannel(new SimClock(now));
  channel.register(phone);
  expect(channel.receive(phone, text).keyword).toBe(stops ? "STOP" : undefined);
  expect(channel.messagesFor(phone).filter(message => message.system)).toHaveLength(stops ? 1 : 0);
  expect(channel.send(phone, "An update for you.").status).toBe(stops ? "suppressed_opted_out" : "delivered");
});
