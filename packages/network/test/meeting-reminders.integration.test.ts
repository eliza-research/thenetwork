import { expect, test } from "vitest";
import { DAY, HOUR } from "@thenetwork/core";
import { Mini } from "./mini.ts";

test.each([false, true])("the day-before reminder and day-of check-in retain their windows after restart (STOP: %s)", async stop => {
  // spec/meetingSettlement.md, "A day-before reminder has its own send window"
  // spec/meetingSettlement.md, "The day-of check-in uses one near-meeting message"
  const w = new Mini(["a", "b"].map((id, i) => ({
    id, name: i ? "Ben Ito" : "Ana Diaz", age: 30, area: "Greenpoint",
    interests: ["climbing", "hiking"], skills: ["belaying"], quietHours: [0, 0],
  })), { review: "auto", plans: false, growth: false });
  await w.onboard("a", "b");
  const id = w.propose(["a", "b"]);
  await w.answerProbes(["a", "b"]);
  const meetingAt = w.meetings[0]!.at;
  const earlyAt = meetingAt - DAY;
  expect(earlyAt).toBeGreaterThan(w.clock.now());
  const earlyHour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "numeric", hourCycle: "h23",
  }).format(earlyAt));
  w.members[1]!.prefs!.quietHours = [earlyHour, (earlyHour + 2) % 24];
  const reminders = () => w.sent.filter(s => s.meta.type === "reminder" && s.meta.proposalId === id);

  w.clock.set(earlyAt);
  await w.net.tick(w.clock.now());
  expect(reminders().map(s => s.to)).toEqual(["a"]);
  w.restart();
  await w.run(2 * HOUR);
  expect(reminders().map(s => s.to)).toEqual(["a", "b"]);
  await w.run(4 * HOUR);
  expect(reminders().map(s => s.to)).toEqual(["a", "b"]);

  if (stop) {
    await w.net.onInbound({ id: "stop-after-early-reminder", memberId: "b", body: "STOP", keyword: "STOP", ts: w.clock.now(), channel: "sms" });
  }
  w.restart();
  w.clock.set(meetingAt - 3 * HOUR);
  const explicitBefore = w.net.exportState().opps.find(o => o.id === id)?.explicit;
  await w.net.tick(w.clock.now());
  expect(reminders().map(s => s.to)).toEqual(stop ? ["a", "b"] : ["a", "b", "a", "b"]);
  expect(reminders().filter(s => s.body.includes("Still good for")).map(s => s.to)).toEqual(stop ? [] : ["a", "b"]);
  expect(w.net.exportState().opps.find(o => o.id === id)?.explicit).toEqual(explicitBefore);
  if (!stop) {
    w.restart();
    await w.run(HOUR);
    expect(reminders().map(s => s.to)).toEqual(["a", "b", "a", "b"]);
    expect(w.net.memberList().find(m => m.id === "a")?.awaiting).toMatchObject({ kind: "booked", oppId: id });
    await w.say("a", "no");
    expect(w.net.exportState().opps.find(o => o.id === id)?.stage).toBe("closed");
  }
});

test.each(["previous evening", "unrelated question"] as const)("the near reminder stays informational when it reaches a member with %s", async reason => {
  // spec/meetingSettlement.md, "The day-of check-in uses one near-meeting message"
  const w = new Mini(["a", "b"].map(id => ({
    id, name: `${id.toUpperCase()}nton Q`, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"],
    quietHours: reason === "previous evening" ? [21, 9] : [0, 0],
  })), { plans: false, growth: false });
  await w.onboard("a", "b");
  const id = w.propose(["a", "b"]);
  await w.answerProbes(["a", "b"]);
  const state = w.net.exportState();
  const booked = state.opps.find(o => o.id === id)!;
  const overnight = reason === "previous evening";
  booked.meetingAt = Date.UTC(2026, 9, 9, overnight ? 12 : 19); // Friday 08:00 or 15:00 in New York.
  const tickAt = overnight ? Date.UTC(2026, 9, 9, 0) : booked.meetingAt - 3 * HOUR;
  const member = state.members.find(m => m.id === "a")!;
  if (!overnight) member.awaiting = { kind: "crew", crewId: "another-crew", at: tickAt - HOUR };
  w.net.importState(state);
  w.clock.set(tickAt);
  const before = w.mark();
  await w.net.tick(tickAt);
  expect(w.to("a", before).find(s => s.meta.type === "reminder")?.body).toMatch(/^Reminder:/);
  if (!overnight) expect(w.net.memberList().find(m => m.id === "a")?.awaiting).toEqual(member.awaiting);
});

test("a check-in expires at its booking's start before a later cancellation is routed", async () => {
  // spec/meetingSettlement.md, "The day-of check-in uses one near-meeting message"
  const w = new Mini(["a", "b"].map(id => ({
    id, name: `${id.toUpperCase()}nton Q`, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], quietHours: [0, 0],
  })), { plans: false, growth: false });
  await w.onboard("a", "b");
  const id = w.propose(["a", "b"]);
  await w.answerProbes(["a", "b"]);
  const state = w.net.exportState();
  const booked = state.opps.find(o => o.id === id)!;
  const start = booked.meetingAt!;
  const later = "later-booking";
  state.opps.push({ ...booked, id: later, meetingAt: start + 2 * HOUR });
  w.net.importState(state);
  w.clock.set(start - HOUR);
  await w.net.tick(w.clock.now());
  expect(w.net.memberList().find(m => m.id === "a")?.awaiting).toMatchObject({ kind: "booked", oppId: id, bookedCheckIn: { meetingAt: start, revision: 0 } });

  w.restart();
  w.clock.set(start);
  await w.say("a", "Sorry, I can’t make it anymore.");
  expect(w.net.opps.get(id)?.stage).toBe("scheduled");
  expect(w.net.opps.get(later)?.stage).toBe("closed");
});

test("the near reminder uses the last open hour at or before the three-hour mark", async () => {
  // spec/meetingSettlement.md, "A day-before reminder has its own send window"
  // Quiet hours cover 16:00-18:00. The three-hour aim (17:00) is closed, and 18:00 is open.
  // The reminder must go at 15:00, the last open tick that is still at or before 17:00.
  const w = new Mini(["a", "b"].map((id, i) => ({
    id, name: i ? "Ben Ito" : "Ana Diaz", age: 30, area: "Greenpoint",
    interests: ["climbing", "hiking"], skills: ["belaying"], quietHours: [0, 0],
  })), { review: "auto", plans: false, growth: false });
  await w.onboard("a", "b");
  const id = w.propose(["a", "b"]);
  await w.answerProbes(["a", "b"]);
  const meetingAt = Date.UTC(2026, 9, 10, 0); // Friday 20:00 in New York.
  const state = w.net.exportState();
  const booked = state.opps.find(o => o.id === id)!;
  expect(booked.stage).toBe("scheduled");
  expect(booked.bookedTold).toEqual(expect.arrayContaining(["a", "b"]));
  booked.meetingAt = meetingAt;
  const openAt = meetingAt - 6 * HOUR; // 14:00, before the closed hours.
  state.lastTick = openAt - HOUR;
  state.tickGap = HOUR;
  w.net.importState(state);
  for (const member of w.members) member.prefs!.quietHours = [16, 18];
  w.clock.set(openAt - HOUR);
  const before = w.mark();
  await w.run(6 * HOUR);
  const reminders = w.sent.slice(before).filter(s => s.meta.type === "reminder" && s.meta.proposalId === id);
  expect(reminders.map(s => [s.to, s.t])).toEqual([
    ["a", meetingAt - 5 * HOUR],
    ["b", meetingAt - 5 * HOUR],
  ]);
});
