import { describe, expect, test } from "vitest";
import { parseProbeReply } from "../src/classify.ts";
import { pendingReportReplyNames } from "../src/network.ts";

describe("inbound-text regexes on adversarial repeats", () => {
  test("a long k-run is still a bare ack, and stays fast", () => {
    const t0 = performance.now();
    expect(pendingReportReplyNames("k".repeat(48))).toEqual([]);
    expect(performance.now() - t0).toBeLessThan(3000);
  }, 30_000);

  test("a long k-run with a non-ack tail is not an ack, and stays fast", () => {
    const body = "k".repeat(48) + "x";
    const t0 = performance.now();
    expect(pendingReportReplyNames(body)).toEqual([{ name: body, routable: true }]);
    expect(performance.now() - t0).toBeLessThan(3000);
  }, 30_000);

  test("repeated affirmation words before 'great' stay fast and read the same", () => {
    const t0 = performance.now();
    const r = parseProbeReply("its ".repeat(25) + "itself great", []);
    const ms = performance.now() - t0;
    expect(r).toEqual(parseProbeReply("its itself great", []));
    expect(ms).toBeLessThan(3000);
  }, 30_000);

  test("repeated 'thats' before 'great' stays fast and reads the same", () => {
    const t0 = performance.now();
    const r = parseProbeReply("thats ".repeat(25) + "itself great", []);
    const ms = performance.now() - t0;
    expect(r).toEqual(parseProbeReply("thats itself great", []));
    expect(ms).toBeLessThan(3000);
  }, 30_000);

  test("a long reply affirmed only at the end stays fast and reads the same", () => {
    const start = Date.UTC(2026, 11, 4, 15, 0, 0);
    const options = [{ key: "a", start, end: start + 3_600_000, label: "Friday 3pm" }];
    const ctx = { now: Date.UTC(2026, 11, 1), tz: "UTC" };
    const t0 = performance.now();
    const r = parseProbeReply("lorem ipsum dolor sit ".repeat(1600) + "sounds good", options, false, ctx);
    const ms = performance.now() - t0;
    expect(r).toEqual(parseProbeReply("sounds good", options, false, ctx));
    expect(ms).toBeLessThan(3000);
  }, 30_000);

  test("many repeated offered dates with times stay fast and read the same", () => {
    const start = Date.UTC(2026, 11, 4, 15, 0, 0);
    const options = [{ key: "a", start, end: start + 3_600_000, label: "Friday 3pm" }];
    const ctx = { now: Date.UTC(2026, 11, 1), tz: "UTC" };
    const t0 = performance.now();
    const r = parseProbeReply("4 dec at 3pm ".repeat(1600), options, false, ctx);
    const ms = performance.now() - t0;
    expect(r).toEqual(parseProbeReply("4 dec at 3pm ", options, false, ctx));
    expect(ms).toBeLessThan(3000);
  }, 30_000);
});

describe("probe reply parsing on mention-dense repeats", () => {
  const options = [
    { key: "a", start: Date.UTC(2026, 11, 4, 15), end: Date.UTC(2026, 11, 4, 16), label: "Friday 3pm" },
    { key: "b", start: Date.UTC(2026, 11, 5, 15), end: Date.UTC(2026, 11, 5, 16), label: "Saturday 3pm" },
  ];

  test("repeated bare clock mentions stay fast and read the same", () => {
    const unit = "maybe 3pm or 4pm ";
    const t0 = performance.now();
    const r = parseProbeReply(unit.repeat(3200), options as never);
    const ms = performance.now() - t0;
    expect(r).toEqual(parseProbeReply(unit, options as never));
    expect(ms).toBeLessThan(10000);
  }, 60_000);

  test("repeated weekday mentions stay fast and read the same", () => {
    const unit = "friday saturday sunday monday ";
    const t0 = performance.now();
    const r = parseProbeReply(unit.repeat(3200), options as never);
    const ms = performance.now() - t0;
    expect(r).toEqual(parseProbeReply(unit, options as never));
    expect(ms).toBeLessThan(10000);
  }, 60_000);
});
