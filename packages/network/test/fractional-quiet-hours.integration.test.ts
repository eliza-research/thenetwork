import { expect, test } from "bun:test";
import { localParts } from "@thenetwork/core";
import { generatePersonas, runWorld } from "@thenetwork/sim";
import { ConsentNetwork } from "../src/network.ts";

test("reminders respect a member's half-hour quiet-hours boundary", async () => {
  const seed = 2;
  const personas = generatePersonas({
    n: 60, seed, cityWeights: { sf: 0, nyc: 1 }, adversarialRate: 0, minorShare: 0, joinSpreadDays: 1,
  });
  for (const p of personas) p.routine.sleep = 21.5;
  const result = await runWorld({
    seed, personas, days: 14, tickMinutes: 15, writeLog: false,
    network: new ConsentNetwork({ seed, review: "auto", growth: false }),
  });
  const reminders = result.channel.all().filter(m => m.direction === "outbound" && m.status === "delivered" && m.meta?.type === "reminder");
  const late = reminders.filter(m => {
    const { hour, minute } = localParts(m.ts, "America/New_York");
    return hour + minute / 60 >= 21.5;
  }).map(m => ({ memberId: m.memberId, at: new Date(m.ts).toISOString() }));
  expect({ joined: result.metrics.run.joined, sentReminders: reminders.length > 0, late, errors: result.metrics.errors })
    .toEqual({ joined: 60, sentReminders: true, late: [], errors: 0 });
}, 30_000);
