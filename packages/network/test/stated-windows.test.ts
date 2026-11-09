import { expect, test } from "bun:test";
import { DAY, fromLocal } from "@thenetwork/core";
import { statedWindows } from "../src/plans.ts";

const NY = "America/New_York";

// A check-in states availability for THIS week only (the stated windows carry `until = now + 7 days`).
// A tag whose weekday is the same as the check-in day must not also produce a window for the SAME
// weekday in the following week (a window that starts after the stated windows have already expired).
test("a same-weekday check-in produces one window inside the stated horizon", () => {
  const now = fromLocal(2026, 11, 2, 9, NY); // Monday 09:00 America/New_York
  const st = statedWindows(["evening:Mon"], now, NY);
  expect(st).toBeDefined();
  // Exactly one Monday-evening window: this Monday, not also next Monday.
  expect(st!.windows.length).toBe(1);
  // No window may begin after the stated windows expire.
  for (const w of st!.windows) expect(w.start).toBeLessThan(st!.until);
  expect(st!.until).toBe(now + 7 * DAY);
});

// When this week's part has already passed, the one upcoming window (next week's same weekday) must
// still be produced, and it falls inside the 7-day horizon.
test("a passed same-weekday part still yields next week's window inside the horizon", () => {
  const now = fromLocal(2026, 11, 2, 23, NY); // Monday 23:00, after the evening part
  const st = statedWindows(["evening:Mon"], now, NY);
  expect(st).toBeDefined();
  expect(st!.windows.length).toBe(1);
  for (const w of st!.windows) expect(w.start).toBeLessThan(st!.until);
});
