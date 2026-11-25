import { describe, expect, it } from "vitest";
import { vouchCapacity } from "../src/levers.ts";
import type { LedgerEntry } from "../src/types.ts";

const DAY = 86_400_000;
const at = Date.UTC(2026, 10, 25);
const member = "a" as LedgerEntry["member"];

function stake(id: string, t: number): LedgerEntry {
  return {
    id,
    member,
    t,
    category: "vouch_stake",
    sign: -1,
    amount: -1,
    base: 1,
    multiplier: 1,
    provenance: {
      eventId: `ev-${id}`,
      eventType: "member_removed",
      counterparts: [],
      confirmedBy: [],
      outcome: "lost",
    },
  };
}

function reversal(id: string, t: number, target: string): LedgerEntry {
  return {
    id,
    member,
    t,
    category: "clawback",
    sign: 1,
    amount: 1,
    base: 1,
    multiplier: 1,
    provenance: {
      eventId: `ev-${id}`,
      eventType: "member_removed",
      counterparts: [],
      confirmedBy: [],
      outcome: "reversed",
      reverses: target,
    },
  };
}

describe("vouchCapacity", () => {
  it("does not count a reversed lost stake", () => {
    const lost = [stake("stake-1", at - DAY)];
    const reversedStake = [
      stake("stake-1", at - DAY),
      reversal("claw-1", at - DAY / 2, "stake-1"),
    ];
    expect(vouchCapacity([], at)).toBe(2);
    expect(vouchCapacity(lost, at)).toBe(0);
    expect(vouchCapacity(reversedStake, at)).toBe(2);
  });
});
