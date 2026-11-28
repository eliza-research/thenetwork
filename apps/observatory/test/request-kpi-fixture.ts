import { emptyCounters, Store } from "../src/store.ts";
import type { ObsState } from "../src/types.ts";

export const waitingLabel = "Find a weekend tennis partner";
export const closedLabel = "Find an art partner";
export function requestKpiFixture(): ObsState {
  const now = Date.UTC(2026, 10, 26, 18);
  const projected = new Store({
    mode: "game", app: "ntwrk", label: "SIM · synthetic request dashboard", dataset: "synthetic",
    capabilities: { canStep: false, canIntervene: false, hiddenTruth: false, readOnly: false },
  }, { now, start: now - 86_400_000, day: 1, playing: false, speed: 0, waitingForPlayer: false });
  projected.upsertMember({
    id: "a", name: "Maya Rao", city: "nyc", area: "Harlem", state: "normal",
    age: 30, joined: true, minor: false, counters: emptyCounters(),
  });
  projected.setRequests([
    { id: "wait", memberId: "a", kind: "people", category: "hobby", label: waitingLabel, outcome: "open", tries: 1, openedAt: now - 3_600_000, ageHours: 1 },
    { id: "done", memberId: "a", kind: "people", category: "hobby", label: closedLabel, outcome: "fulfilled", tries: 2, openedAt: now - 7_200_000, ageHours: 2,
      fulfilledAt: now - 3_600_000, hoursToFulfil: 1 },
  ]);
  return {
    ...projected.snapshot(), version: 1,
    network: {
      kind: "consent", review: { queued: 0, approved: 0, rejected: 0, expired: 0 }, gateReasons: {}, counters: {},
      requests: { total: 2, fulfilled: 1, probing: 0, waiting: 1, plans: 0 }, trust: { hold: 0, watch: 0 },
    },
  };
}
