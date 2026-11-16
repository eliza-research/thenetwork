import { expect, test } from "vitest";
import { DAY, HOUR } from "@thenetwork/core";
import { Mini } from "./mini.ts";

test.each([false, true])("day-before reminders survive quiet hours and restart (subsequent STOP: %s)", async stop => {
  // spec/meetingSettlement.md, "A day-before reminder has its own send window"
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
  await w.net.tick(w.clock.now());
  expect(reminders().map(s => s.to)).toEqual(stop ? ["a", "b"] : ["a", "b", "a", "b"]);
});
