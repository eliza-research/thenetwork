/** GET_UPDATES against the single inbox (packages/notify): read in the thread, seen everywhere. */
import type { Memory, UUID } from "@elizaos/core";
import { createMockRuntime } from "@elizaos/testing";
import { describe, expect, it } from "bun:test";
import { MemoryNotifyStore, Notifier, threadHooks } from "../../notify/src/index.ts";
import { createNetworkEdgePlugin, InMemoryNetworkStore, type NetworkMemberContext, type NetworkStore } from "../src/index.js";

const MEMBER: NetworkMemberContext = {
  memberId: "mem_ada", firstName: "Ada", city: "San Francisco", state: "open", stateUntil: null, facets: [], activeItems: [],
};
const msg = (text: string): Memory => ({
  id: "00000000-0000-0000-0000-0000000000a1" as UUID, entityId: "00000000-0000-0000-0000-0000000000aa" as UUID,
  roomId: "00000000-0000-0000-0000-0000000000cc" as UUID, agentId: "00000000-0000-0000-0000-000000000000" as UUID, content: { text },
}) as Memory;

function setup(withInbox = true) {
  const now = Date.UTC(2026, 9, 8, 16);
  const inbox = new MemoryNotifyStore();
  const notifier = new Notifier(inbox, { get: () => undefined });
  const base = new InMemoryNetworkStore([MEMBER], () => new Date(now));
  const store: NetworkStore = withInbox ? Object.assign(base, { readUpdates: threadHooks(notifier, () => now).readUpdates }) : base;
  const plugin = createNetworkEdgePlugin({ store, authority: { memberId: "mem_ada" } });
  return { inbox, notifier, plugin, now };
}

describe("GET_UPDATES", () => {
  it("is registered only when the store reads the inbox, in both routing modes", () => {
    expect(setup(false).plugin.actions?.map((a) => a.name)).toEqual(["SET_STATE"]);
    expect(setup().plugin.actions?.map((a) => a.name)).toEqual(["SET_STATE", "GET_UPDATES"]);
    const structured = createNetworkEdgePlugin({
      store: Object.assign(new InMemoryNetworkStore([MEMBER]), { readUpdates: async () => ({ items: [] }) }),
      authority: { memberId: "mem_ada" }, routing: "structured",
    });
    expect(structured.actions?.map((a) => a.name)).toEqual(["GET_UPDATES"]);
  });

  it("lists the member's own unseen updates and marks them seen everywhere", async () => {
    const { inbox, notifier, plugin, now } = setup();
    await notifier.add({ personId: "mem_ada", app: "friends", eventType: "plan", subjectId: "p1", urgency: "normal", summary: "Dev is free Thursday." }, now);
    await notifier.add({ personId: "mem_bob", app: "friends", eventType: "plan", subjectId: "p2", urgency: "normal", summary: "Not Ada's." }, now);
    const action = plugin.actions!.find((a) => a.name === "GET_UPDATES")!;
    const r = await action.handler(createMockRuntime(), msg("updates"), undefined, { parameters: { memberId: "mem_bob" } } as any);
    expect(r?.success).toBe(true);
    expect(r?.text).toBe("Network updates:\n- Dev is free Thursday.");
    expect((await inbox.unseen("mem_ada", now)).length).toBe(0);
    expect((await inbox.unseen("mem_bob", now)).length).toBe(1);
    const again = await action.handler(createMockRuntime(), msg("updates"), undefined, {} as any);
    expect(again?.text).toBe("No new Network updates.");
  });
});
