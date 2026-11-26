import { expect, test } from "vitest";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, eventOf } from "../src/events.ts";
import type { ObsOpportunity, OpportunityDetail, SystemEvent } from "../src/types.ts";
import { installDom } from "./dom.ts";
import { HOUR } from "@thenetwork/core";
import { PLAN_VENUES } from "../../../packages/network/src/plans.ts";
import { describeBookingStart, localBookingStart } from "../../../packages/network/src/rescheduling.ts";
import { Mini } from "../../../packages/network/test/mini.ts";

const ids = ["a", "b", "c"];
const originalAt = Date.UTC(2026, 9, 10, 17);
const proposedAt = Date.UTC(2026, 9, 11, 18);
const request = `RESCHEDULE ${localBookingStart(originalAt)} TO ${localBookingStart(proposedAt)}`;

async function bookedFixture() {
  const w = new Mini(ids.map(id => ({
    id, name: `${id.toUpperCase()}nton Q`, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"],
    skills: ["belaying"], wants: [{ objective: "find climbing partners", category: "hobby" as const }],
  })), { plans: false });
  await w.onboard(...ids);
  const id = w.propose(ids);
  await w.answerProbes(ids);
  expect(w.meetings).toHaveLength(1);
  const state = w.net.exportState();
  const o = state.opps.find(item => item.id === id)!;
  expect(o.stage).toBe("scheduled");
  const venue = PLAN_VENUES.find(place => place.id === "mccarren-park")!;
  Object.assign(o, { meetingAt: originalAt, venue: venue.name, venueArea: venue.area });
  w.net.importState(state);
  const booking = () => w.net.exportState().opps.find(item => item.id === id)!;
  const vote = (member: string) => {
    const line = w.to(member).find(message => message.body.includes("Reply RESCHEDULE YES"))?.body;
    expect(line, JSON.stringify({ member, messages: w.to(member), guard: w.log("guard_blocked"), refusals: w.log("send_refused") })).toBeDefined();
    expect(line!).toContain(describeBookingStart(proposedAt));
    return /RESCHEDULE YES [a-p]{16}/.exec(line!)![0];
  };
  return { w, id, booking, vote };
}

test("committed change of time is labeled separately from the initial booking in opportunity History", async () => {
  const { w, id, booking, vote } = await bookedFixture();
  await w.say("a", request);
  await w.run(HOUR);
  for (const id of ids) await w.say(id, vote(id));
  expect(booking()).toMatchObject({ meetingAt: proposedAt, scheduleRevision: 1 });
  const rescheduled = w.log("meeting_rescheduled");
  expect(rescheduled).toHaveLength(1);
  expect(rescheduled[0]!.detail).toMatchObject({ oppId: id, previousAt: originalAt, at: proposedAt });

  const mapMeeting = (m: (typeof w.meetings)[number]) => eventOf({
    t: w.clock.now(), type: "meeting_scheduled", meetingId: m.proposalId, proposalId: m.proposalId,
    participants: m.participants, at: m.at, city: m.city,
    ...(m.previousAt === undefined ? {} : { previousAt: m.previousAt }),
  });
  const original = mapMeeting(w.meetings[0]!)!;
  expect(describe(original, String).text).toBe("Meeting scheduled");

  const changed = mapMeeting(w.meetings.at(-1)!)!;
  expect(changed.object_id).toBe(id);
  expect(changed.payload).toMatchObject({ previousAt: originalAt, at: proposedAt });
  const revised = describe(changed);
  const label = `Meeting rescheduled: ${describeBookingStart(originalAt)} → ${describeBookingStart(proposedAt)} (New York time)`;
  expect(revised).toMatchObject({ text: label, detail: { previousAt: originalAt, at: proposedAt } });
  await expectHistory(id, [describe(original), revised], label);
});


async function expectHistory(id: string, events: SystemEvent[], label: string) {
  const opportunity: ObsOpportunity = {
    id, kind: "group", source: "network", generator: "engine", city: "nyc", objective: "climb",
    score: 0, explanations: {}, exploration: false, participants: ids, alternates: [],
    state: "SCHEDULED", status: {}, enjoyment: {}, createdAt: originalAt - HOUR, updatedAt: originalAt, meetingAt: proposedAt,
  };
  const response: OpportunityDetail = { opportunity, members: [], messages: [], events };
  const window = new Window({ url: "http://observatory.test" });
  const restore = installDom(window, {
    window, document: window.document, navigator: window.navigator,
    location: window.location, history: window.history, localStorage: window.localStorage,
    sessionStorage: window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: (input: string | URL) => Promise.resolve(new URL(String(input), window.location.href).pathname === `/api/opportunity/${id}`
      ? Response.json(response) : new Response(null, { status: 404 })),
  });
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const { createRoot } = await import("react-dom/client");
  const { store } = await import("../web/store.ts");
  const { Inspector } = await import("../web/panels.tsx");
  const root = createRoot(container as unknown as HTMLElement);
  try {
    store.mode = "game";
    store.app = "ntwrk";
    store.me = { id: "staff", roles: ["admin"], grants: [{ role: "admin", app: "*" }], via: "token" };
    store.opps.set(id, opportunity);
    await act(async () => {
      store.focus({ kind: "opportunity", id });
      root.render(createElement(Inspector));
    });
    for (let i = 0; i < 100 && !container.textContent?.includes(label); i++) await act(async () => { await sleep(5); });
    expect(container.innerHTML).toContain("History");
    expect(container.textContent).toContain("Meeting scheduled");
    expect(container.textContent).toContain(label);
  } finally {
    await act(async () => { root.unmount(); });
    store.disconnect();
    await window.happyDOM.close();
    restore();
  }
}
