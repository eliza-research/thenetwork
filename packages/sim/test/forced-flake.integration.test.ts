import { expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import { DAY, HOUR, type RunRecord } from "@thenetwork/core";
import { loadScenario, scenarioWorldOptions } from "../src/scenario.ts";
import { StubNetwork } from "../src/stubNetwork.ts";
import { World } from "../src/world.ts";

test("forced flakes: a booked member cancels or no-shows as scripted, then the one-shot ends", async () => {
    const scenario = await loadScenario(fileURLToPath(new URL("../scenarios/group-flake-morning-of.json", import.meta.url)));
    for (const how of [undefined, "notice", "no_show", "late_notice"] as const) {
      const w = new World(scenarioWorldOptions({ ...scenario, actions: scenario.actions.filter(a => a.do !== "force_flake") }, {
        network: () => new StubNetwork({ seed: scenario.seed, randomIntros: false }),
      }));
      await w.begin();
      await w.advanceTo(w.clock.now() + DAY + 11 * HOUR);
      const meeting = w.records.find((r): r is Extract<RunRecord, { type: "meeting_scheduled" }> => r.type === "meeting_scheduled")!;
      expect(w.memories.get("dinner-1")!.proposals[meeting.proposalId]!.plannedShow).toBe(true);
      if (how === "late_notice") await w.advanceTo(meeting.at - 2 * HOUR);
      if (how) w.act({ do: "force_flake", persona: "dinner-1", how: how === "no_show" ? "no_show" : "notice" });
      await w.advanceTo(w.end);
      const r = await w.complete();
      const outcome = r.records.find((x): x is Extract<RunRecord, { type: "outcome" }> => x.type === "outcome" && x.proposalId === meeting.proposalId)!;
      expect(outcome.attendance["dinner-1"]!.showed).toBe(how === undefined);
      expect(outcome.attendance["dinner-1"]!.cancelledWithNotice).toBe(how === "notice" || how === "late_notice");
      expect(w.memories.get("dinner-1")!.forceFlake).toBeUndefined();
    }
}, 60_000);
