// A probe answer that names a time nobody offered (issue #134). The member may say yes to meeting
// but name a time that was not offered ("Friday night works"). The Network must never read that as
// a yes to Saturday and Sunday: it books none of the offered times, never writes a "declined_time"
// for a time the member never refused, and offers other times. With no reader, and with a scripted
// reader that names no time either, the result is the same.
import { describe, expect, test } from "bun:test";
import { DAY } from "@thenetwork/core";
import { copy } from "../src/copy.ts";
import type { Understand } from "../src/extract.ts";
import type { TimeOption } from "../src/classify.ts";
import type { NetworkOptions } from "../src/index.ts";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });

async function probeThenAnswer(understand?: NetworkOptions["understand"], reply = "Friday night works") {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "auto", ...(understand ? { understand } : {}) });
  await w.onboard("a", "b");
  w.propose(["a", "b"]);
  await w.runUntil(() => w.probed("a") || w.probed("b"), 4 * DAY);
  const first = w.probed("a") ? "a" : "b";
  expect(w.probed(first)).toBe(true);
  expect(w.probed("a") && w.probed("b")).toBe(false);
  const o = [...(w.net as any).opps.values()][0];
  const offered = o.offered[first].map((x: TimeOption) => x.key);
  const from = w.sent.length;
  await w.say(first, reply);
  await w.run(DAY);
  return { w, o, offered, first, from };
}


describe("a probe answer naming a time nobody offered", () => {
  // A scripted reading with no time either. It may not add a pick back: the parser's unoffered flag wins.
  const noTime: Understand = async () => ({ consent: "yes", times: [], wants: [], notWanted: [], interests: [], skills: [] });
  for (const [name, understand] of [["no LLM reader", undefined], ["an LLM reader that names no time", noTime]] as const) {
    test(`${name}: books no offered time`, async () => {
      const { w, o, offered, first, from } = await probeThenAnswer(understand);
      // No offered time is recorded as accepted or declined for this member.
      const log = w.log("probe_answer").filter(l => l.detail.memberId === first).at(-1)?.detail;
      expect({ picks: o.picks?.[first] ?? [], declined: (o.declinedTimes ?? []).filter((t: number) => o.offered[first].some((x: TimeOption) => x.start === t)), log }).toEqual({ picks: [], declined: [], log: { oppId: o.id, memberId: first, yes: true, picked: [], unoffered: true } });
      // Other times are offered; the probe is still open and the opportunity not closed.
      const fresh = w.to(first, from).filter(s => (s.meta as { timeOptions?: unknown[] }).timeOptions?.length);
      expect(fresh.length).toBe(1);
      expect(fresh[0]!.meta.timeOptions!.length).toBeGreaterThan(0);
      expect(w.probed(first)).toBe(true);
      expect(o.stage).toBe("probing");
      expect(offered.length).toBeGreaterThan(1);
    });
  }
  test("a request for another day books no offered time, and offers other times", async () => {
    const { w, o, first, from } = await probeThenAnswer(undefined, "How about a different day?");
    expect(o.picks?.[first] ?? []).toEqual([]);
    const sent = w.to(first, from);
    expect(sent.length).toBe(1);
    expect(sent[0]!.body.startsWith("No problem.")).toBe(true);
    expect(sent[0]!.meta.timeOptions!.length).toBeGreaterThan(0);
  });
  test("the yes still counts: the offered times stay open for the partner", async () => {
    const { w, o, first } = await probeThenAnswer();
    expect(o.status.get(first)).toBe("probing");
    expect(o.primed.has(first)).toBe(true);
  });
});
