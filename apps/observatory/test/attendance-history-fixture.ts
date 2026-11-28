import type { RunRecord } from "@thenetwork/core";
import { describe, eventOf } from "../src/events.ts";
import { Projector } from "../src/projector.ts";
import { emptyCounters, Store } from "../src/store.ts";

export function attendanceHistoryFixture(attendees: number) {
  const now = Date.UTC(2026, 10, 26, 18), participants = ["a", "b"];
  const projected = new Store({
    mode: "game", app: "ntwrk", label: "SIM · synthetic meeting outcome", dataset: "synthetic",
    capabilities: { canStep: false, canIntervene: false, hiddenTruth: false, readOnly: false },
  }, { now, start: now - 86_400_000, day: 1, playing: false, speed: 0, waitingForPlayer: false });
  for (const [id, name] of [["a", "Maya Rao"], ["b", "Jon Park"]] as const) projected.upsertMember({
    id, name, city: "nyc", area: "Harlem", state: "normal", age: 30, joined: true, minor: false, counters: emptyCounters(),
  });
  const oppId = "synthetic-meeting", projector = new Projector(projected);
  projected.upsertOpp({
    id: oppId, city: "nyc", kind: "intro", source: "network", generator: "player", objective: "Plan a coffee",
    score: 0.5, explanations: {}, exploration: false, participants, alternates: [],
    state: "SCHEDULED", status: { a: "confirmed", b: "confirmed" }, enjoyment: {},
    createdAt: now - 86_400_000, updatedAt: now - 3_600_000, meetingAt: now - 3_600_000,
  });
  const record: Extract<RunRecord, { type: "outcome" }> = {
    type: "outcome", meetingId: "meeting", proposalId: oppId, at: now - 3_600_000, t: now - 1_800_000,
    attendance: Object.fromEntries(participants.map((id, i) => [id, { showed: i < attendees, cancelledWithNotice: false, enjoyment: i < attendees ? 0.9 : 0 }])),
  };
  projector.apply(record);
  const event = describe(eventOf(record)!, id => projected.members.get(id)?.name ?? id);
  return { projected, oppId, event };
}
