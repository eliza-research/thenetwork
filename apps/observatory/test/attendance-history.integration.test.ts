import { expect, test } from "vitest";
import { attendanceHistoryFixture } from "./attendance-history-fixture.ts";

test.each([0, 1, 2])("history agrees with the opportunity outcome with %i attendees", attendees => {
  const { projected, oppId, event } = attendanceHistoryFixture(attendees);
  expect(projected.opps.get(oppId)?.state).toBe(attendees === 2 ? "COMPLETED" : "ABANDONED");
  expect(projected.stats().meetingsHeld).toBe(attendees === 2 ? 1 : 0);
  expect(event).toMatchObject({
    text: attendees === 2 ? "Meeting happened (2 showed)" : `Meeting fell through (${attendees} showed)`,
    severity: attendees === 2 ? "good" : "warn",
    opportunityId: oppId,
    detail: { showed: attendees },
  });
});
