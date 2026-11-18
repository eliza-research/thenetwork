// A late answer to an expired one-to-one probe (audit OPP19). Before the fix, a short "yep" after the
// 26-hour response window was dropped without a reply, and "yes I'm in" opened a model turn with no
// matching item, so the member could believe the introduction was going ahead. Now the member hears
// once that the invitation ended and nothing was shared; nothing counts as consent.
// spec/probeReply.md, "A late answer to an expired probe hears once that the invitation ended"
import { expect, test } from "vitest";
import { HOUR } from "@thenetwork/core";
import { copy } from "../src/copy.ts";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });

test.each(["yep", "Yes I'm in!", "no thanks"])("a late %s hears once that the invitation ended", async late => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "auto" });
  await w.onboard("a", "b");
  w.propose(["a", "b"]);
  expect(await w.runUntil(() => w.probed("a") || w.probed("b"))).toBe(true);
  const id = w.probed("a") ? "a" : "b";
  const oppId = w.net.memberList().find(m => m.id === id)!.awaiting!.oppId!;
  expect(await w.runUntil(() => !w.probed(id), 30 * HOUR)).toBe(true);
  expect(w.log("probe_answer").filter(l => l.detail.memberId === id).map(l => l.detail.expired)).toEqual([true]);

  const mark = w.mark();
  const turn = await w.net.onInbound({ id: "late-1", memberId: id, body: late, ts: w.clock.now(), channel: "sms" });
  expect(turn).toBe("handled");
  expect(w.to(id, mark).map(s => s.body)).toEqual([copy.probeEnded]);
  expect(w.log("late_probe_answer")).toMatchObject([{ detail: { oppId, memberId: id } }]);
  expect(w.log("probe_answer").filter(l => l.detail.memberId === id)).toHaveLength(1);
  expect(w.meetings).toEqual([]);

  // Once only: a second reply is ordinary conversation.
  const again = w.mark();
  await w.net.onInbound({ id: "late-2", memberId: id, body: late, ts: w.clock.now(), channel: "sms" });
  expect(w.to(id, again).some(s => s.body === copy.probeEnded)).toBe(false);
  expect(w.log("late_probe_answer")).toHaveLength(1);
});
