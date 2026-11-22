import { expect, test } from "vitest";
import { relayGuard, relayItem, type RelayContext, type RelayItem } from "@thenetwork/engine/src/relay.ts";
import { SLOP_RELAY_TEMPLATES as T } from "../src/apps/slop/relay.ts";

test("Every scam and harassment relay template stops on its content alone", () => {
  const party = (id: string) => ({ id, firstName: id, age: 30, held: false, photoIds: [], photoConsent: true });
  const texts = [...T.harassment, ...T.scam.offplatform_move, ...T.scam.money_ask, ...T.scam.financial_loss];
  const passed = texts.filter((text, i) => {
    const ctx: RelayContext = {
      now: 1_000_000, opportunity: { id: "op", app: "slop", participants: ["a", "b"], acceptedBy: ["a", "b"], status: "mutual" },
      sender: party("a"), recipient: party("b"), blocked: false, history: [], recentTexts: [], guard: relayGuard(),
    };
    const item: RelayItem = { kind: "text", text, id: `t${i}`, from: "a", to: "b", at: 1_000_000 };
    return relayItem(item, ctx).decision === "pass";
  });
  expect(passed).toEqual([]);
});
