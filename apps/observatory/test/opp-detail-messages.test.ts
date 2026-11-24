// R16-TA: an opportunity's detail must show that opportunity's own
// messages — not a reply the member sent about a different opportunity.
//
// Journey: pipeline card click -> OpportunityPanel -> GET /api/opportunity/:id
// -> GameSource.opportunity() (game mode). The detail's History lists
// d.messages; admin-console.md 3.5 promises "drill into one opportunity
// with its messages". The real-mode twin (sources/real.ts messages())
// selects strictly `opportunity_id = ${id}`, and the Network's own
// decision record carries the proposal the reply answers
// (packages/sim/src/world.ts: a persona reply is scheduled with
// inReplyTo: msg.id, and the decision record carries proposalId).
//
// Game mode instead attributes inbound messages with a 2-day nearness
// window (sources/game.ts opportunity()): any inbound message within
// two days after an outbound message about this opportunity is shown
// as this opportunity's message — even when its inReplyTo names a
// message about another opportunity, or when it answers nothing at
// all. Maya in two open opportunities, replying to the second one,
// sees her reply in BOTH details.
//
// Fixture (real GameSource.opportunity code; only the data is synthetic):
//   Maya m1 in oppA (with Jon m2) and oppB (with Leo m3).
//   oA: outbound proposal about oppA at T-2d.
//   oB: outbound proposal about oppB at T-1d.
//   iA: inbound from Maya at T-2d+1h, inReplyTo oA ("yes-to-A").
//   iB: inbound from Maya at T-1d+1h, inReplyTo oB ("yes-to-B").
//   iFree: inbound from Maya at T-1d+2h, no meta (member-initiated text).
// Correct: A shows oA + iA only; B shows oB + iB only; neither shows iFree.
import { expect, test } from "vitest";
import { DAY } from "@thenetwork/core";
import { GameSource } from "../src/sources/game.ts";
import { Store, emptyCounters } from "../src/store.ts";
import type { ObsMember, ObsOpportunity } from "../src/types.ts";

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const counters = () => emptyCounters();
const member = (id: string, name: string): ObsMember => ({
  id, name, city: "nyc", area: "East Village", state: "normal", joined: true, joinedAt: NOW - 30 * DAY,
  minor: false, age: 30, counters: counters(),
});
const opp = (id: string, participants: string[], createdAt: number): ObsOpportunity => ({
  id, kind: "intro", source: "engine", generator: "probe", city: "nyc",
  objective: "meet", score: 1, explanations: {}, exploration: false,
  participants, alternates: [], state: "INVITING", status: {}, enjoyment: {},
  createdAt, updatedAt: NOW - DAY,
});

test("opportunity detail shows only its own messages, not a reply about another opportunity", async () => {
  const store = new Store({} as never, { now: NOW, start: 0, day: 1, playing: false, speed: 0, waitingForPlayer: false } as never);
  for (const m of [member("m1", "Maya Rao"), member("m2", "Jon Park"), member("m3", "Leo Diaz")]) store.upsertMember(m);
  store.upsertOpp(opp("oppA", ["m1", "m2"], NOW - 3 * DAY));
  store.upsertOpp(opp("oppB", ["m1", "m3"], NOW - 2 * DAY));
  const msgs: Record<string, { id: string; ts: number; direction: "inbound" | "outbound"; body: string; status: string; memberId: string; meta?: Record<string, unknown> }[]> = {
    m1: [
      { id: "oA", ts: NOW - 2 * DAY, direction: "outbound", body: "proposal-A", status: "delivered", memberId: "m1", meta: { type: "proposal", proposalId: "oppA" } },
      { id: "oB", ts: NOW - DAY, direction: "outbound", body: "proposal-B", status: "delivered", memberId: "m1", meta: { type: "proposal", proposalId: "oppB" } },
      { id: "iA", ts: NOW - 2 * DAY + 3_600_000, direction: "inbound", body: "yes-to-A", status: "delivered", memberId: "m1", meta: { inReplyTo: "oA" } },
      { id: "iB", ts: NOW - DAY + 3_600_000, direction: "inbound", body: "yes-to-B", status: "delivered", memberId: "m1", meta: { inReplyTo: "oB" } },
      { id: "iFree", ts: NOW - DAY + 7_200_000, direction: "inbound", body: "weekly-checkin", status: "delivered", memberId: "m1" },
    ],
    m2: [
      { id: "oA2", ts: NOW - 2 * DAY, direction: "outbound", body: "proposal-A-jon", status: "delivered", memberId: "m2", meta: { type: "proposal", proposalId: "oppA" } },
    ],
    m3: [
      { id: "oB3", ts: NOW - DAY, direction: "outbound", body: "proposal-B-leo", status: "delivered", memberId: "m3", meta: { type: "proposal", proposalId: "oppB" } },
    ],
  };
  const g = new GameSource({});
  (g as unknown as { store: Store }).store = store;
  (g as unknown as { world: { channel: { messagesFor: (id: string) => unknown[] } } }).world = {
    channel: { messagesFor: (id: string) => msgs[id] ?? [] },
  };
  const bodies = (d: { messages: { body: string }[] } | undefined) => (d?.messages ?? []).map(m => m.body);
  const a = bodies(await g.opportunity("oppA"));
  const b = bodies(await g.opportunity("oppB"));
  expect(a).toContain("proposal-A");
  expect(a).toContain("yes-to-A");
  expect(a).not.toContain("yes-to-B");
  expect(a).not.toContain("proposal-B");
  expect(a).not.toContain("weekly-checkin");
  expect(b).toContain("proposal-B");
  expect(b).toContain("yes-to-B");
  expect(b).not.toContain("yes-to-A");
  expect(b).not.toContain("proposal-A");
  expect(b).not.toContain("weekly-checkin");
});
