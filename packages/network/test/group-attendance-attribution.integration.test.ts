import { expect, test } from "vitest";
import { DAY, HOUR } from "@thenetwork/core";
import { Mini, START } from "./mini.ts";
import { holdEveryItem } from "../../engine/src/reviewJudge.ts";

test("group attendance: a no-show report identifies the silent member", async () => {
    const cases = [
      { kind: "unnamed", text: "Someone didn't show up." },
      { kind: "named", text: "Ben didn't show up." },
      { kind: "all", text: "Nobody else came." },
      { kind: "all_showed", text: "No one else showed up." },
      { kind: "positive", text: "It was great!" },
      { kind: "self", text: "I couldn't make it." },
      { kind: "disputed", text: "Ben didn't show up.", response: true },
      { kind: "voucher", text: "Someone didn't show up.", response: true },
      { kind: "present_then_missing", text: "Cara came. Ben didn't show up.", missing: ["b"] },
      { kind: "missing_then_present", text: "Ben didn't show up. Cara came.", missing: ["b"] },
      { kind: "semicolon", text: "Cara came; Ben didn't show up.", missing: ["b"] },
      { kind: "newline", text: "Cara came\nBen didn't show up.", missing: ["b"] },
      { kind: "but", text: "Cara came, but Ben didn't show up.", missing: ["b"] },
      { kind: "while", text: "Cara came, while Ben didn't show up.", missing: ["b"] },
      { kind: "whereas", text: "Cara came, whereas Ben didn't show up.", missing: ["b"] },
      { kind: "two_named", text: "Ben and Cara didn't show up.", missing: ["b", "c"] },
      { kind: "comma_list", text: "Ben, Cara and Dan didn't show up.", missing: ["b", "c", "d"] },
      { kind: "two_sentences", text: "Ben didn't show up. Cara never came.", missing: ["b", "c"] },
      { kind: "quoted", text: 'Someone quoted "Ben did not come." That is not what I saw.' },
      { kind: "unidentified_cohort", text: "Ben and some other people didn't come." },
    ];
    const failures: { kind: string; flow: string; actual: number[]; expected: number[] }[] = [];
    const seed = 1;
    for (const flow of ["pair", "group", "plan"]) for (const c of cases) {
      if (flow === "pair" && ["quoted", "unidentified_cohort"].includes(c.kind)) continue;
      const ids = ["a", "b", "c", "d"].slice(0, flow === "pair" ? 2 : flow === "group" ? 3 : 4);
      const w = new Mini(ids.map((id, i) => ({ id, name: ["Ana Diaz", "Ben Ito", "Cara Li", "Dan May"][i]!, age: 30, area: flow === "plan" ? "Prospect Heights" : "Greenpoint", interests: flow === "plan" ? ["coffee", "climbing"] : ["hiking", "outdoors"] })),
        { seed, inlineJudge: holdEveryItem.inline, growth: false, plans: flow === "plan", matchingEnabled: true });
      w.clock.set(START + (flow === "plan" ? 3 : 4) * DAY);
      await w.onboard(...ids);
      let id: string;
      if (flow === "plan") {
        expect(await w.runUntil(() => w.net.reviewQueue().some(q => q.origin === "planner"), 4 * DAY)).toBe(true);
        id = w.net.reviewQueue().find(q => q.origin === "planner")!.oppId;
        expect(w.net.exportState().opps.find(x => x.id === id)?.plan?.invited).toEqual(ids);
      } else {
        id = w.propose(ids, { category: "hobby", objective: "a hiking group" });
        expect(await w.runUntil(() => w.net.reviewQueue().some(q => q.oppId === id), DAY)).toBe(true);
      }
      expect(w.sent.some(s => s.meta.probe || s.meta.proposalId)).toBe(false);
      expect(w.net.decide(id, "approve", { reviewer: "sim_staff" })).toEqual({ ok: true });
      await w.answerProbes(ids);
      expect(w.meetings.every(m => m.proposalId === id)).toBe(true);
      expect(w.meetings.flatMap(m => m.participants).sort()).toEqual(ids);
      const meetingAt = w.meetings[0]!.at;
      await w.run(meetingAt - HOUR - w.clock.now());
      for (const id of ids) await w.say(id, "Thanks, still coming.");
      const prompted = () => w.net.memberList().find(member => member.id === "a")?.awaiting?.kind === "feedback";
      expect(await w.runUntil(prompted, 2 * DAY)).toBe(true);
      w.restart();
      expect(w.net.memberList().find(m => m.id === "a")?.awaiting?.kind).toBe("feedback");
      await w.say("a", c.text);
      if (c.response) await w.say("b", "It was great!");
      const misses = () => ids.map(p => w.net.memberList().find(m => m.id === p)!.noShows);
      // A report alone does not count before the unanswered check-in window ends.
      expect(misses().slice(1)).toEqual(ids.slice(1).map(() => 0));
      w.restart(); await w.run(5 * DAY); w.restart();
      expect(w.net.exportState().opps.find(x => x.id === id)?.finalized).toBe(true);
      const names = c.kind === "comma_list" && flow === "group" ? [] : c.missing;
      const expected = ids.map((p, i) => i === 0 ? Number(c.kind === "self") : names ? Number(names.includes(p)) :
        Number(c.kind === "all" || c.kind === "all_showed" || c.kind === "named" && p === "b" || c.kind === "unnamed" && flow === "pair"));
      const actual = misses();
      if (actual.some((value, i) => value !== expected[i])) failures.push({ kind: c.kind, flow, actual, expected });
      await w.run(DAY); w.restart(); expect(misses()).toEqual(actual);
    }
    expect(failures).toEqual([]);
}, 60_000);
