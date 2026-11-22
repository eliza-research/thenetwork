import { expect, test } from "vitest";
import { DAY, HOUR, MINUTE } from "@thenetwork/core";
import { attention } from "@thenetwork/engine";
import { calendarSchedulingPurpose, calendarSource } from "../../core/src/generated/calendarFreeBusy.ts";
import { readCalendarFreeBusy, type CalendarFreeBusyScope } from "../../core/src/calendar-free-busy.ts";
import { Mini, START } from "./mini.ts";

const scopeAt = (now: number): CalendarFreeBusyScope => ({ app: "ntwrk", memberId: "a", purpose: calendarSchedulingPurpose, now });
const connectionId = "private-scheduling-connection";

function authorized(scope: CalendarFreeBusyScope) {
  const { app, memberId, purpose, now } = scope;
  const binding = { app, memberId, purpose, provider: calendarSource, connectionId };
  const coverage = { start: now, end: now + 8 * DAY };
  return { grant: { ...binding, active: true, grantedAt: START - DAY, expiresAt: now + 5 * MINUTE },
    observation: { ...binding, coverage, observedAt: now, busy: [{ start: now + 25 * HOUR, end: now + 27 * HOUR }] } };
}

test("only the authorized member's current anonymous observation changes slot selection", () => {
  // spec/calendarFreeBusy.md, "Read only current anonymous intervals for the exact authorized connection"
  // spec/calendarFreeBusy.md, "A known busy interval excludes the slot and incomplete coverage cannot make it free"
  const scope = scopeAt(START);
  const source = authorized(scope);
  const read = (observation: unknown) => readCalendarFreeBusy(scope, true, true, () => ({ grant: source.grant, observation }));
  const ev = read(source.observation)!;
  expect(ev).toEqual({ observedAt: START, expiresAt: source.grant.expiresAt, coverage: source.observation.coverage, busy: source.observation.busy });
  expect(read({ ...source.observation, busy: [{ ...source.observation.busy[0]!, summary: "private" }] })).toBeUndefined();
  expect(read({ ...source.observation, ownerEmail: "private@example.test" })).toBeUndefined();
  expect(read({ ...source.observation, app: "friends" })).toBeUndefined();
  expect(read({ ...source.observation, memberId: "b" })).toBeUndefined();
  expect(read({ ...source.observation, purpose: "profile-learning" })).toBeUndefined();
  expect(read({ ...source.observation, connectionId: "other" })).toBeUndefined();
  expect(read({ ...source.observation, observedAt: START - 5 * MINUTE })).toBeUndefined();
  expect(read({ ...source.observation, observedAt: START + 1 })).toBeUndefined();
  expect(read({ ...source.observation, busy: [{ start: START - 1, end: START + MINUTE }] })).toBeUndefined();
  expect(readCalendarFreeBusy(scope, false, true, () => source)).toBeUndefined();
  expect(readCalendarFreeBusy(scope, true, false, () => source)).toBeUndefined();
  expect(readCalendarFreeBusy(scope, true, true, () => ({ ...source, grant: { ...source.grant, active: false } }))).toBeUndefined();

  const busy = { start: START + 25 * HOUR, end: START + 26 * HOUR };
  const free = { start: START + 27 * HOUR, end: START + 28 * HOUR };
  const partial = { start: START + 8 * DAY - MINUTE, end: START + 8 * DAY + MINUTE };
  const schedule = { memberId: "a", tz: "America/New_York" };
  expect(attention.calendarAvailability(ev, busy, START)).toBe("busy");
  expect(attention.calendarAvailability(ev, free, START)).toBe("free");
  expect(attention.calendarAvailability(ev, partial, START)).toBe("unknown");
  expect(attention.calendarAvailability(ev, busy, START + 5 * MINUTE)).toBe("unknown");
  expect(attention.availabilityProb({ ...schedule, calendar: ev }, partial, START)).toBe(attention.availabilityProb(schedule, partial, START));
  expect(attention.chooseTimeOptions([{ ...schedule, calendar: ev }], START, { tz: schedule.tz, fixed: true, window: busy }).slots).toEqual([]);
  expect(attention.chooseTimeOptions([{ ...schedule, calendar: ev }], START, { tz: schedule.tz, candidates: [busy, free] }).slots.map(result => result.slot)).toEqual([free]);
});

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });

test("an opted-in calendar changes actual probe options and CALENDAR OFF leaves the probe open", async () => {
  // spec/calendarFreeBusy.md, "A known busy interval excludes the slot and incomplete coverage cannot make it free"
  const calls: CalendarFreeBusyScope[] = [];
  const world = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { plans: false, growth: false, calendarFreeBusy: scope => {
    calls.push(scope);
    const { grant, observation } = authorized(scope);
    return { grant, observation: { ...observation, busy: [observation.coverage] } };
  } });
  await world.onboard("a", "b");
  await world.net.onInbound({ id: "assistant-calendar", memberId: "b", body: "CALENDAR", source: "mcp", ts: world.clock.now(), channel: "sms" });
  await world.say("a", "CALENDAR");
  const oppId = world.propose(["a", "b"]);
  expect(await world.runUntil(() => world.probed("a"), 2 * DAY)).toBe(true);
  const probe = world.to("a").find(sent => sent.meta.probe?.key === oppId);
  expect(probe).toBeDefined();
  expect(probe?.meta.timeOptions ?? []).toEqual([]);
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every(call => call.app === "ntwrk" && call.memberId === "a" && call.purpose === calendarSchedulingPurpose)).toBe(true);
  expect(JSON.stringify(world.net.exportState())).not.toContain(connectionId);

  await world.say("a", "CALENDAR OFF");
  expect(world.probed("a")).toBe(true);
  const reads = calls.length;
  await world.answerProbes(["a", "b"]);
  const partnerProbe = world.to("b").find(sent => sent.meta.probe?.key === oppId);
  expect(partnerProbe?.meta.timeOptions?.length).toBeGreaterThan(0);
  expect(world.meetings).toHaveLength(1);
  expect(calls).toHaveLength(reads);
});

test("a current busy conflict discovered after the probes cannot book the picked slot", async () => {
  // spec/calendarFreeBusy.md, "A known busy interval excludes the slot and incomplete coverage cannot make it free"
  let busy: attention.TimeSlot | undefined;
  const world = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { plans: false, growth: false, calendarFreeBusy: scope => {
    if (!busy) return;
    const { grant, observation } = authorized(scope);
    return { grant, observation: { ...observation, busy: [busy] } };
  } });
  await world.onboard("a", "b");
  await world.say("a", "CALENDAR");
  const oppId = world.propose(["a", "b"]);
  expect(await world.runUntil(() => world.probed("a"), 2 * DAY)).toBe(true);
  await world.say("a", "Yes, the first time works");
  expect(await world.runUntil(() => world.probed("b"), DAY)).toBe(true);
  const picked = world.to("b").find(sent => sent.meta.probe?.key === oppId)?.meta.timeOptions?.[0];
  expect(picked).toBeDefined();
  busy = { start: picked!.start, end: picked!.end };
  await world.say("b", "Yes, the first time works");
  expect(world.meetings).toHaveLength(0);
  expect(world.net.exportState().opps.find(opp => opp.id === oppId)?.stage).toBe("closed");
});

test.each([-1, 0, 1])("the default meeting slot includes the exact search boundary (%d ms)", async offset => {
  // spec/opportunityLifecycle.md, "Only an approved proposal with enough consent can book"
  // spec/calendarFreeBusy.md, "A known busy interval excludes the slot and incomplete coverage cannot make it free"
  const world = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], {
    plans: false, growth: false, calendarFreeBusy: scope => {
      const { grant, observation } = authorized(scope);
      // The supported template times are busy. The weekend default at 11:00 stays open.
      const busy = attention.candidateSlots("America/New_York", scope.now)
        .map(slot => ({ start: slot.start, end: slot.start + 30 * MINUTE }));
      return { grant, observation: { ...observation, busy } };
    },
  });
  await world.onboard("a", "b");
  await world.say("a", "CALENDAR");
  world.clock.set(Date.UTC(2026, 9, 8, 16)); // Thursday 12:00 local.
  const oppId = world.propose(["a", "b"]);
  expect(await world.runUntil(() => world.probed("a"), DAY)).toBe(true);
  await world.say("a", "yes");
  expect(await world.runUntil(() => world.probed("b"), DAY)).toBe(true);
  const probes = world.sent.filter(message => message.meta.probe?.key === oppId);
  expect(probes.map(message => message.meta.timeOptions ?? [])).toEqual([[], []]);

  const saturday = Date.UTC(2026, 9, 10, 15); // Saturday 11:00 local.
  world.clock.set(saturday - 20 * HOUR + offset);
  await world.say("b", "yes");
  expect(world.log("venue").find(entry => entry.detail.oppId === oppId)?.detail.time).toBe("default");
  expect(world.meetings.map(meeting => meeting.at)).toEqual([saturday + (offset > 0 ? DAY : 0)]);
});

// spec/probeReply.md, "An untimed probe needs an answer to the opportunity"
test.each(["neither works this week sorry", "Neither."])("an untimed probe keeps %j open for a clear answer", async text => {
  const ids = ["a", "b"];
  let modelReads = 0;
  const world = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], {
    plans: false, growth: false, review: "human",
    calendarFreeBusy: scope => {
      const { grant, observation } = authorized(scope);
      const busy = attention.candidateSlots("America/New_York", scope.now)
        .map(slot => ({ start: slot.start, end: slot.start + 30 * MINUTE }));
      return { grant, observation: { ...observation, busy } };
    },
    understand: async body => {
      if (body !== text) return;
      modelReads++;
      return { consent: "yes", wants: [], notWanted: [], interests: [], skills: [] };
    },
  });
  await world.onboard(...ids);
  await world.say("a", "CALENDAR");
  world.clock.set(Date.UTC(2026, 9, 8, 16));
  const oppId = world.propose(ids);
  expect(await world.runUntil(() => world.net.reviewQueue().some(item => item.oppId === oppId))).toBe(true);
  expect(world.net.decide(oppId, "approve", { reviewer: "staff" })).toEqual({ ok: true });
  expect(await world.runUntil(() => world.probed("a"), DAY)).toBe(true);
  expect(world.to("a").find(message => message.meta.probe?.key === oppId)?.meta.timeOptions).toBeUndefined();

  await world.say("a", text);
  expect(modelReads).toBe(1);
  expect(world.probed("a")).toBe(true);
  expect(world.log("probe_answer")).toEqual([]);
  expect(world.meetings).toEqual([]);

  await world.say("a", "Yes.");
  expect(await world.runUntil(() => world.probed("b"), DAY)).toBe(true);
  expect(world.to("b").find(message => message.meta.probe?.key === oppId)?.meta.timeOptions).toBeUndefined();
  await world.say("b", "Yes.");
  expect(world.meetings).toMatchObject([{ proposalId: oppId, participants: ids, at: Date.UTC(2026, 9, 10, 15) }]);
});
