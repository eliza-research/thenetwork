import { expect, test } from "bun:test";
import { generatePersonas } from "../src/generator.ts";
import { StubNetwork } from "../src/stubNetwork.ts";
import { World } from "../src/world.ts";

test("conversation snapshots preserve answered intent check-ins when responsiveness changes", async () => {
  const regressions: string[] = [];
  let closed = 0, confirmed = 0, silent = 0;
  for (const seed of [7, 9]) for (const richness of [false, true]) {
    const personas = generatePersonas({ n: 40, seed, richness, adversarialRate: 0, minorShare: 0, joinSpreadDays: 1, intentLapse: { meanDays: 20 } });
    const seen = new Map<string, { status: string; createdAt: number }>();
    const w = new World({ seed, personas, days: 100, writeLog: false, network: new StubNetwork({ seed }), onDay() {
      const snapshot = w.snapshot();
      for (const intent of snapshot.intents) {
        const prev = seen.get(intent.id);
        if (intent.status === "closed") closed++;
        if (prev?.status === "closed" && intent.status !== "closed") regressions.push(`${seed}/${richness}/${intent.id}: withdrawal lost`);
        if (prev && intent.createdAt < prev.createdAt) regressions.push(`${seed}/${richness}/${intent.id}: confirmation lost`);
        const joined = w.memories.get(intent.memberId)!.joinedAt!;
        if (intent.createdAt > joined) {
          confirmed++;
          // The actual conversation at the confirmation time must allow an answer. A later
          // inbound cannot retroactively answer a check-in skipped during two unanswered asks.
          let unanswered = 0;
          for (const r of w.records) if (r.type === "message" && r.msg.memberId === intent.memberId && r.msg.ts <= intent.createdAt) {
            if (r.msg.direction === "inbound") unanswered = 0;
            else if (r.msg.status === "delivered" && r.msg.meta?.proactive) unanswered++;
          }
          if (unanswered >= 2) regressions.push(`${seed}/${richness}/${intent.id}: retroactive answer`);
        }
        seen.set(intent.id, { status: intent.status, createdAt: intent.createdAt });
      }
      silent += snapshot.members.filter(m => m.unansweredProactive >= 2).length;
    } });
    const result = await w.run();
    expect(result.metrics.errors).toBe(0);
  }
  expect(closed).toBeGreaterThan(0);
  expect(confirmed).toBeGreaterThan(0);
  expect(silent).toBeGreaterThan(0);
  expect(regressions).toEqual([]);
}, 30_000);
