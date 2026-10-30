// Sim gate for the re-engagement fix: reengagement must not judge a held item
// against itself when the member has no value history. Before the fix, an empty
// valueHistory made the bar fall back to the candidates' own values, so a single
// held item (or tied items) set its own bar and always failed the strict > check
// with "not_high_value" — the most common re-engagement shape could never send.
// After the fix, an empty history uses the member state's quality bar instead.
// This gate fails before the fix (no send) and passes after it (send). It is a
// sim gate, not a unit test: it runs inside `bun run sim --only network` via
// the network block.
import { DAY } from "../../packages/core/src/index.ts";
import { reengagement, type MemberAttention } from "../../packages/engine/src/attention.ts";
import type { AttentionItem } from "../../packages/engine/src/types.ts";
import { Block, expect } from "./gate.ts";

const NOW = Date.UTC(2026, 9, 5, 16); // 12:00 EDT, outside quiet hours [22, 8]

function member(): MemberAttention {
  return {
    memberId: "a", state: "normal", age: 30, tz: "America/New_York", quietHours: [22, 8],
    onlyWhenAsked: false,
    prefs: { mode: "digest", digestDays: [4], digestHour: 12, digestPeriod: "week", categoryWeight: {}, maxItemsPerDigest: 3, romanceInDigest: false },
  };
}

function item(id: string, enjoy: number): AttentionItem {
  return {
    id, memberId: "a", kind: "intro_probe", category: "social", others: [], involvesMember: false,
    effort: "glance", enjoy, accept: 1, urgency: { expiresAt: NOW + 30 * DAY },
    createdAt: NOW - DAY, reviewState: "not_needed", key: id,
  };
}

function call(items: AttentionItem[], valueHistory: number[]) {
  return reengagement({
    member: member(), autoPaused: true, optedOut: false,
    conversation: { outboundSinceInbound: 0, lastInboundAt: NOW - 60 * DAY },
    joinedAt: NOW - 60 * DAY, items, valueHistory, now: NOW,
  });
}

export async function reengagementGate(b: Block): Promise<void> {
  await b.run("engine: a single high-value held item with no history sends a re-engagement", () => {
    const r = call([item("x", 0.9)], []);
    expect(r.send).toBe(true);
    expect(r.reason).toBe("ok");
    expect(r.item?.id).toBe("x");
  });

  await b.run("engine: tied held items with no history send a re-engagement (control for the same circular bar)", () => {
    const r = call([item("x", 0.9), item("z", 0.9)], []);
    expect(r.send).toBe(true);
    expect(r.reason).toBe("ok");
  });

  await b.run("engine: a single low-value held item with no history still does not send (the floor still guards)", () => {
    const r = call([item("y", 0.2)], []);
    expect(r.send).toBe(false);
    expect(r.reason).toBe("not_high_value");
  });

  await b.run("engine: a single high-value held item with a real history still sends (unchanged path)", () => {
    const r = call([item("x", 0.9)], [0.1, 0.2, 0.3, 0.4]);
    expect(r.send).toBe(true);
    expect(r.reason).toBe("ok");
  });
}
