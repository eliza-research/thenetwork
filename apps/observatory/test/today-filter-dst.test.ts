import { expect, test, vi } from "vitest";
import { nycDayStart, store } from "../web/store.ts";

const utc = (value: string) => Date.parse(value);

test.each([
  ["2026-03-08T16:00:00.321Z", "2026-03-08T05:00:00Z"],
  ["2026-11-01T17:00:00.987Z", "2026-11-01T04:00:00Z"],
  ["2026-11-01T05:30:00Z", "2026-11-01T04:00:00Z"],
  ["2026-11-01T06:30:00Z", "2026-11-01T04:00:00Z"],
  ["2026-07-14T12:00:00.321Z", "2026-07-14T04:00:00Z"],
])("New York midnight at %s is %s", (input, expected) => {
  expect(nycDayStart(utc(input))).toBe(utc(expected));
});

test.each([
  ["2026-03-08T16:00:00Z", "2026-03-08T05:00:00Z"],
  ["2026-11-01T17:00:00Z", "2026-11-01T04:00:00Z"],
])("Today includes midnight but excludes the previous millisecond (%s)", (input, expected) => {
  const previousUi = store.ui;
  const now = vi.spyOn(store, "now").mockReturnValue(utc(input));
  store.ui = { ...previousUi, filters: { ...previousUi.filters, range: "today" } };
  try {
    expect(store.inRange(utc(expected) - 1)).toBe(false);
    expect(store.inRange(utc(expected))).toBe(true);
    expect(store.inRange(utc(expected) + 30 * 60_000)).toBe(true);
  } finally {
    store.ui = previousUi;
    now.mockRestore();
  }
});
