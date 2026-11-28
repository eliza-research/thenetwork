import { describe, expect, test } from "vitest";
import { parseReply } from "../src/replies.ts";

// Regression: parseReply was quadratic in the number of signal words in a reply.
// extract() rebuilt the whole string once per regex match (masking), sliced the
// sentence prefix once per yes word (negation scope), sliced the remainder once
// per condition word, and scanned the sentence-start list once per match. A
// ~140 KB reply dense in ordinary yes/no/if words took seconds (the "if" shape
// below took ~87 s on a throttled 1.5-CPU box); the same shapes now finish in
// well under a second. The readings are unchanged.
describe("parseReply on long signal-dense replies", () => {
  const shapes: [string, string, string][] = [
    // [shape, text, expected answer]
    ["refusal salad", "no but yes maybe cancel stop start ".repeat(4000), "no"],
    ["conditions only", "if ".repeat(46666), "unsure"],
    ["yes repeated", "yes ".repeat(35000), "yes"],
    ["no repeated", "no ".repeat(46666), "no"],
    ["dense sentences", "no. yes. ".repeat(15555), "no"],
  ];
  for (const [name, text, answer] of shapes) {
    test(`${name}: reads as ${answer} and stays fast`, () => {
      const t0 = performance.now();
      const r = parseReply(text);
      const ms = performance.now() - t0;
      expect(r.answer).toBe(answer);
      expect(ms).toBeLessThan(3000);
    }, 30_000);
  }

  test("time conditions in a long reply still constrain a yes", () => {
    const r = parseReply("yes " + "if friday ".repeat(2000));
    expect(r.answer).toBe("yes");
    expect(r.reason).toBe("yes_with_time_constraint");
    expect(r.constraints.length).toBeGreaterThan(0);
    expect(r.constraints.every(c => c.kind === "time")).toBe(true);
  }, 30_000);
});
