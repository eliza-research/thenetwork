import { expect, test } from "vitest";
import type { RunRecordInput } from "@thenetwork/core";
import { Projector } from "../src/projector.ts";
import { emptyCounters, Store } from "../src/store.ts";

// spec/observatoryRoster.md, "Reviewed offers contribute to a member's proposal activity after approval":
// "Count a participant's opportunity once after approval."
// The member panel shows that count next to the member's opportunity list, so the count must follow
// the roster when a probe replaces a participant.

function proposal(id: string, participants: string[], alternates: string[]) {
  return {
    id, participants, kind: "intro" as const, city: "nyc" as const,
    alternates, objective: "Meet", score: 0, exploration: false, explanations: {}, generator: "network",
    createdAt: 1_760_000_000_000,
    components: {
      fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0,
      interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0,
    },
  };
}

function reviewedThenReplaced() {
  const start = 1_760_000_000_000;
  const store = new Store({
    mode: "game", label: "Synthetic", dataset: "Synthetic",
    capabilities: { canStep: true, canIntervene: true, hiddenTruth: true, readOnly: false },
  }, { now: start, start, day: 1, playing: false, speed: 0, waitingForPlayer: false });
  for (const id of ["a", "b", "c"]) {
    store.upsertMember({ id, name: id, city: "nyc", joined: true, minor: false, state: "normal", counters: emptyCounters() });
  }
  const projector = new Projector(store);
  let time = start;
  const apply = (record: RunRecordInput) => projector.apply({ ...record, t: ++time });
  const oracle = { compatible: true, quality: 1, minEnjoyment: 1, flags: [], participants: {} };
  apply({ type: "proposal", source: "network", proposal: proposal("intro-1", ["a", "b"], ["c"]), oracle });
  apply({ type: "network_log", kind: "review_queued", detail: { proposal: proposal("intro-1", ["a", "b"], ["c"]), origin: "network", deadline: time + 86_400_000 } });
  apply({ type: "network_log", kind: "review_decision", detail: { oppId: "intro-1", decision: "approve" } });
  apply({ type: "network_log", kind: "probe_started", detail: { proposal: proposal("intro-1", ["a", "b"], ["c"]), primed: [], origin: "network" } });
  apply({ type: "network_log", kind: "probe_replaced", detail: { oppId: "intro-1", out: "b", in: "c", proposal: proposal("intro-1", ["a", "c"], []) } });
  // The member panel list: the opportunities that name the member, shadow runs left out.
  const listedFor = (id: string) => [...store.opps.values()].filter(o => o.source !== "shadow" && o.participants.includes(id)).length;
  const countedFor = (id: string) => store.member(id)!.counters.proposals;
  return { store, listedFor, countedFor };
}

test("a probe replacement moves the proposal count with the roster", () => {
  const { store, listedFor, countedFor } = reviewedThenReplaced();
  expect(store.opps.get("intro-1")!.participants).toEqual(["a", "c"]);
  expect([listedFor("a"), listedFor("b"), listedFor("c")]).toEqual([1, 0, 1]);
  expect([countedFor("a"), countedFor("b"), countedFor("c")]).toEqual([1, 0, 1]);
});

test("a probe replacement before approval counts only the final roster", () => {
  const start = 1_760_000_000_000;
  const store = new Store({
    mode: "game", label: "Synthetic", dataset: "Synthetic",
    capabilities: { canStep: true, canIntervene: true, hiddenTruth: true, readOnly: false },
  }, { now: start, start, day: 1, playing: false, speed: 0, waitingForPlayer: false });
  for (const id of ["a", "b", "c"]) {
    store.upsertMember({ id, name: id, city: "nyc", joined: true, minor: false, state: "normal", counters: emptyCounters() });
  }
  const projector = new Projector(store);
  let time = start;
  const apply = (record: RunRecordInput) => projector.apply({ ...record, t: ++time });
  const oracle = { compatible: true, quality: 1, minEnjoyment: 1, flags: [], participants: {} };
  apply({ type: "proposal", source: "network", proposal: proposal("intro-1", ["a", "b"], ["c"]), oracle });
  apply({ type: "network_log", kind: "review_queued", detail: { proposal: proposal("intro-1", ["a", "b"], ["c"]), origin: "network", deadline: time + 86_400_000 } });
  // The reviewer re-rolls b out for c while the item still waits; approval must count the final roster.
  apply({ type: "network_log", kind: "review_queued", detail: { proposal: proposal("intro-1", ["a", "c"], []), origin: "network", deadline: time + 86_400_000, rerolled: true } });
  apply({ type: "network_log", kind: "review_decision", detail: { oppId: "intro-1", decision: "approve" } });
  expect(store.opps.get("intro-1")!.participants).toEqual(["a", "c"]);
  expect([store.member("a")!.counters.proposals, store.member("b")!.counters.proposals, store.member("c")!.counters.proposals]).toEqual([1, 0, 1]);
});
