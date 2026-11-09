// Game mode: the console projection of a booked plan that the consent Network closes (SD-279).
// A participant leaves (STOP) after the plan is booked. The Network closes the plan; the console must
// show it closed, also after the meeting time passes.
import { afterEach, expect, test } from "bun:test";
import { DAY, HOUR } from "@thenetwork/core";
import { GameSource } from "../src/sources/game.ts";

const live: GameSource[] = [];
afterEach(async () => { for (const g of live.splice(0)) await g.dispose(); });

test("a booked pair plan that the Network closes reads CANCELLED, before and after the meeting time", async () => {
  const g = new GameSource({ pushMs: 3_600_000, tickMs: 3_600_000, seed: 1 });
  live.push(g);
  await g.init();
  const now = () => g.world.clock.now();
  let booked: ReturnType<typeof g.state>["opportunities"][number] | undefined;
  for (let day = 0; day < 12 && !booked; day++) {
    await g.control({ type: "step", ms: DAY });
    booked = g.state().opportunities.find(o => o.state === "SCHEDULED" && o.participants.length === 2 && (o.meetingAt ?? 0) > now() + 6 * HOUR
      && g.consent!.opps.get(o.id)?.stage === "scheduled");
  }
  expect(booked).toBeDefined();
  const id = booked!.id;
  expect((await g.control({ type: "god", action: "opt_out", memberId: booked!.participants[0]! })).ok).toBe(true);
  // The Network closed the plan.
  expect(g.consent!.opps.get(id)?.stage).toBe("closed");
  expect(g.state().opportunities.find(o => o.id === id)!.state).toBe("CANCELLED");
  // The world still holds its meeting; the closed plan stays closed in the console.
  await g.control({ type: "step", ms: (booked!.meetingAt! - now()) + 12 * HOUR });
  expect(g.consent!.opps.get(id)?.stage).toBe("closed");
  expect(g.state().opportunities.find(o => o.id === id)!.state).toBe("CANCELLED");
}, 300_000);
