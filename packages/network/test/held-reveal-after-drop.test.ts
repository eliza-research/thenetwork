// A group of three keeps going when one member drops (PRD F17, F18). Texts held for quiet hours must
// match the group as it is when they go out: a held reveal names only the people still going, and a
// held "the rest of you are still on" goes only to someone still going while the plan still stands.
import { expect, test } from "bun:test";
import { HOUR } from "@thenetwork/core";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });
const nyHour = (t: number) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", hour: "2-digit" }).format(t));
const toNight = (w: Mini) => { while (nyHour(w.clock.now()) !== 22) w.clock.advance(HOUR / 4); };
const group = (w: Mini) => [...(w.net as any).opps.values()].find((o: any) => o.participants.length === 3);

test("a reveal held overnight does not name the member who dropped before it went out", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cal Moss")], { review: "auto" });
  await w.onboard("a", "b", "c");
  w.propose(["a", "b", "c"]);
  for (let i = 0; i < 200 && !w.probed("c"); i++) { await w.run(HOUR); for (const id of ["a", "b"]) if (w.probed(id)) await w.say(id, "yes"); }
  for (const id of ["a", "b"]) if (w.probed(id)) await w.say(id, "yes");
  expect(w.probed("c")).toBe(true);
  // Cal says yes at night: Cal hears at once, Ana's and Ben's reveals wait for the morning.
  toNight(w);
  await w.say("c", "yes");
  const o = group(w);
  expect(o.stage).toBe("scheduled");
  w.clock.advance(HOUR / 2);
  await w.say("c", "sorry, I can't make it anymore");
  expect(o.status.get("c")).toBe("dropped");
  expect(o.stage).toBe("scheduled");
  const from = w.mark();
  await w.run(12 * HOUR);
  for (const id of ["a", "b"]) {
    const reveals = w.to(id as any, from).filter(s => (s.meta as any).type === "proposal");
    expect(reveals.length).toBe(1);
    expect(reveals[0]!.body).not.toContain("Cal");
    expect((reveals[0]!.meta as any).participants).toEqual(["a", "b"]);
  }
}, 60_000);

test("a held 'still on' notice does not reach a member who dropped since, or the last one left", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cal Moss")], { review: "auto" });
  await w.onboard("a", "b", "c");
  w.propose(["a", "b", "c"]);
  await w.answerProbes(["a", "b", "c"]);
  await w.run(12 * HOUR);
  const o = group(w);
  expect(o.bookedTold?.length).toBe(3);
  toNight(w);
  await w.say("a", "sorry, I can't make it anymore");
  w.clock.advance(HOUR / 2);
  await w.say("b", "sorry, I can't make it anymore");
  expect(o.stage).toBe("closed");
  const from = w.mark();
  await w.run(12 * HOUR);
  const notices = w.sent.slice(from).filter(s => (s.meta as any).type === "cancellation");
  expect(notices.filter(s => s.to === "b")).toEqual([]);
  expect(notices.filter(s => s.to === "c").map(s => s.body)).toEqual([expect.stringContaining("off now")]);
}, 60_000);
