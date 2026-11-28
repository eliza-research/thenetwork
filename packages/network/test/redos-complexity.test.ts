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
});
