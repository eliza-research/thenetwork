// Offline Network plugin boundary scenarios: app/member scope survives reads, effects and retries.
import type { IAgentRuntime, Memory } from "@elizaos/core";
import { createNetworkEdgePlugin } from "../../packages/plugin-network/src/edge.ts";
import { InMemoryNetworkStore } from "../../packages/plugin-network/src/memory-store.ts";
import { createMemberContextProvider } from "../../packages/plugin-network/src/providers/member-context.ts";
import type { NetworkContextStore, NetworkMemberContext, NetworkTurnAuthority } from "../../packages/plugin-network/src/types.ts";
import type { Block } from "./gate.ts";
import { expect } from "./gate.ts";

export async function networkPluginScope(b: Block): Promise<void> {
  const now = () => new Date("2026-10-08T12:00:00Z");
  const fixtures: NetworkMemberContext[] = [
    { app: "slop", memberId: "same-local-id", firstName: "Dating canary", city: "nyc", state: "open", stateUntil: null, facets: ["PRIVATE_DATING_CANARY"], activeItems: [] },
    { app: "friends", memberId: "same-local-id", firstName: "Friendship canary", city: "nyc", state: "open", stateUntil: null, facets: ["FRIENDS_ONLY_CANARY"], activeItems: [] },
  ];
  await b.run("Network plugin: identical member ids never cross app context", async () => {
    const store = new InMemoryNetworkStore(fixtures, now);
    expect((await store.getMemberContext("same-local-id", "slop"))?.facets).toEqual(["PRIVATE_DATING_CANARY"]);
    expect((await store.getMemberContext("same-local-id", "friends"))?.facets).toEqual(["FRIENDS_ONLY_CANARY"]);
    expect(await store.getMemberContext("same-local-id", "peon")).toBeNull();
    const context = await createMemberContextProvider({store, authority: {app: "friends", memberId: "same-local-id"}}).get({} as IAgentRuntime, {} as Memory, { values: {}, data: {}, text: "" });
    expect(context.text).toContain("FRIENDS_ONLY_CANARY");
    expect(context.text).not.toContain("PRIVATE_DATING_CANARY");
  });
  await b.run("Network plugin: mismatched store context is never rendered", async () => {
    const store = new InMemoryNetworkStore(fixtures, now);
    // A misbound host store returning another app must not leak its canary into a prompt.
    store.getMemberContext = async () => structuredClone(fixtures[0]!);
    const context = await createMemberContextProvider({store, authority: {app: "friends", memberId: "same-local-id"}}).get({} as IAgentRuntime, {} as Memory, { values: {}, data: {}, text: "" });
    expect(context.text).toBe("");
    expect(context.data?.member).toBeNull();
  });
  await b.run("Network plugin: missing or unknown host app fails before exposing context", async () => {
    const store = new InMemoryNetworkStore(fixtures, now);
    expect(() => createNetworkEdgePlugin({store, authority: {memberId: "same-local-id"} as NetworkTurnAuthority})).toThrow();
    expect(() => createNetworkEdgePlugin({store, authority: {memberId: "same-local-id", app: "unknown"} as unknown as NetworkTurnAuthority})).toThrow();
    expect(() => createNetworkEdgePlugin({store, authority: {memberId: "", app: "slop"}})).toThrow();
  });
  await b.run("Network plugin: same transport nonce yields independent app effects and replays", async () => {
    const store = new InMemoryNetworkStore(fixtures, now);
    const base = {memberId: "same-local-id", state: "paused" as const, until: null, note: null, idempotencyKey: "same-provider-message"};
    const dating = await store.setState({...base, app: "slop"});
    const friends = await store.setState({...base, app: "friends"});
    expect(store.events.length).toBe(2);
    expect(dating.eventId).not.toBe(friends.eventId);
    expect((await store.setState({...base, app: "slop"})).replayed).toBe(true);
    expect(store.events.length).toBe(2);
    let refused = false;
    try { await store.setState({...base, app: "slop", state: "busy"}); } catch { refused = true; }
    expect(refused).toBe(true);
    expect((await store.getMemberContext(base.memberId, "slop"))?.state).toBe("paused");
    expect((await store.getMemberContext(base.memberId, "friends"))?.state).toBe("paused");
  });
  await b.run("Network plugin: unknown app membership cannot write signals or availability", async () => {
    const store = new InMemoryNetworkStore(fixtures, now);
    let signalRefused = false, stateRefused = false;
    try { await store.recordSignals({app: "peon", memberId: "same-local-id", messageId: "m", signals: [{kind: "safety_concern", evidence: "report"}]}); } catch { signalRefused = true; }
    try { await store.setState({app: "peon", memberId: "same-local-id", state: "paused", until: null, note: null, idempotencyKey: "m"}); } catch { stateRefused = true; }
    expect(signalRefused).toBe(true); expect(stateRefused).toBe(true);
    expect(store.signals.length).toBe(0); expect(store.events.length).toBe(0);
  });
  await b.run("Network plugin: host object mutation cannot switch an installed plugin app", async () => {
    const store = new InMemoryNetworkStore(fixtures, now);
    const authority: NetworkTurnAuthority = {app: "friends", memberId: "same-local-id"};
    const plugin = createNetworkEdgePlugin({store, authority});
    authority.app = "slop";
    const context = await plugin.providers![0]!.get({} as IAgentRuntime, {} as Memory, { values: {}, data: {}, text: "" });
    expect(context.text).toContain("FRIENDS_ONLY_CANARY");
    expect(context.text).not.toContain("PRIVATE_DATING_CANARY");
  });
  await b.run("Network plugin: a context-only host exposes no writes and marks active items unavailable", async () => {
    const authority: NetworkTurnAuthority = {app: "friends", memberId: "read-only-member"};
    const member: NetworkMemberContext = {
      ...authority, firstName: "Ada", city: "nyc", state: "open", stateFrom: null,
      stateUntil: null, facets: ["plays chess"], activeItems: null,
    };
    const store: NetworkContextStore = {
      getMemberContext: async (memberId, app) => app === authority.app && memberId === authority.memberId ? structuredClone(member) : null,
    };
    for (const routing of ["planner", "structured"] as const) {
      const plugin = createNetworkEdgePlugin({store, authority, routing});
      expect(plugin.actions).toEqual([]);
      expect(plugin.evaluators).toEqual([]);
      expect(plugin.responseHandlerFieldEvaluators).toBeUndefined();
      const rendered = await plugin.providers![0]!.get({} as IAgentRuntime, {} as Memory, {values: {}, data: {}, text: ""});
      expect(rendered.text).toContain("plays chess");
      expect(rendered.text).toContain("Active items unavailable from this host");
    }
  });

}
