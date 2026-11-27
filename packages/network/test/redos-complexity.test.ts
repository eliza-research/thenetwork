import { describe, expect, test } from "vitest";
import { parseProbeReply } from "../src/classify.ts";
import { pendingReportReplyNames } from "../src/network.ts";

// Regression: two regexes that run on raw inbound text backtracked exponentially.
// - ACK_ONLY (network.ts) tokenized a message into ack words; its "k|kk"
//   alternatives give a run of k's exponentially many tilings, so
//   "k".repeat(40) + "x" took ~5 s in ACK_ONLY.test(body). The k-run is now
//   matched atomically ((?=(k+))\1): only the k alternative can match at a k,
//   so consuming the whole run at once accepts exactly the same strings
//   (checked by differential fuzzing against the old pattern).
// - The affirmation-prefix check in consentScan (classify.ts) listed "thats"
//   and "its" alongside "that'?s" / "it'?s", which already match them, so each
//   repeated word doubled the search: "its ".repeat(25) + "itself great" took
//   >20 s through parseProbeReply. The duplicates are gone; the set of accepted
//   prefixes is unchanged.
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
});
