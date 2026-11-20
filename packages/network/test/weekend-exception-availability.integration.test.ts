// "Free on weekends except Sunday mornings" is free for the rest of the weekend.
// Sunday morning is the refused part. Saturday, and the rest of Sunday, stay free.
import { expect, test } from "vitest";
import { HOUR, SimClock, type NetworkContext, type SimMessage } from "@thenetwork/core";
import { attention } from "@thenetwork/engine";
import { randomWorld } from "../../engine/src/testkit.ts";
import { ConsentNetwork, NY } from "../src/index.ts";

const KEPT = ["afternoon:Sun", "evening:Sun", "morning:Sat", "afternoon:Sat", "evening:Sat"];

async function savedStanding(body: string): Promise<string[]> {
  const input = randomWorld({ seed: 1, members: 120, minors: false });
  const member = input.members.find(m => m.homeCity === "nyc" && m.state === "normal")!;
  const clock = new SimClock(input.now);
  let seq = 0;
  const ctx: NetworkContext = {
    clock, snapshot: () => input,
    send: (memberId, text, options) => ({ id: `availability:${++seq}`, ts: clock.now(), direction: "outbound", channel: "sms", from: "network", to: memberId, memberId, body: text, status: "delivered", meta: options?.meta } satisfies SimMessage),
    recordProposal: () => {}, recordMeeting: () => "unused", recordBlock: () => {}, log: () => {},
  };
  const opts = { seed: 1, review: "human" as const, matchingEnabled: false };
  let net = new ConsentNetwork(opts);
  net.init(ctx);
  await net.onInbound({ id: "join", memberId: member.id, body: "Hi", ts: clock.now(), channel: "sms" });
  await net.onInbound({ id: "availability", memberId: member.id, body, ts: clock.now(), channel: "sms" });
  const state = JSON.parse(JSON.stringify(net.exportState()));
  net = new ConsentNetwork(opts);
  net.init(ctx);
  net.importState(state);
  return net.memberList().find(m => m.id === member.id)!.standing?.tags ?? [];
}

test("a weekend exception drops only Sunday morning", async () => {
  // spec/planFormation.md, "A standing window applies to the whole activity"
  for (const body of ["Free on weekends except Sunday mornings", "Free weekends other than Sunday mornings"]) {
    expect(await savedStanding(body)).toEqual(KEPT);
  }
  // A day with no part is still the whole day. A weekday exception still drops only that day.
  const weekend = ["Sun", "Sat"].flatMap(day => ["morning", "afternoon", "evening"].map(part => `${part}:${day}`));
  expect(await savedStanding("I'm free on weekends except Sunday")).toEqual(weekend.filter(tag => tag.endsWith(":Sat")));
  expect(await savedStanding("I'm free on weekdays except Tuesday")).toEqual(["evening:Mon", "evening:Wed", "evening:Thu", "evening:Fri"]);
  const now = Date.UTC(2026, 9, 5, 17);
  const standing = attention.standingFromFacets([{ kind: "availability_pattern", tags: await savedStanding("Free on weekends except Sunday mornings"), observedAt: now }], now);
  const slot = (start: number) => ({ start, end: start + 2 * HOUR });
  const covers = (start: number) => standing.some(window => attention.standingWindowCoversSlot(window, slot(start), NY));
  // Sunday 10:00 in New York is the refused morning. Saturday afternoon and Sunday afternoon stay open.
  expect(covers(Date.UTC(2026, 9, 11, 14))).toBe(false);
  expect(covers(Date.UTC(2026, 9, 10, 18))).toBe(true);
  expect(covers(Date.UTC(2026, 9, 11, 18))).toBe(true);
});
