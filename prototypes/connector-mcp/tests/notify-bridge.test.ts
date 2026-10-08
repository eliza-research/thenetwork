// get_network_updates with the single inbox (packages/notify): update codes from a Network text,
// and items shown here are seen everywhere, so no text follows for them.
import { describe, expect, test } from "bun:test";
import { SimClock } from "@thenetwork/core";
import { MemoryNotifyStore, Notifier, connectorInbox } from "../../../packages/notify/src/index.ts";
import { FakeNetwork, seedWorld } from "../src/fake-network.ts";
import { connect, principal } from "./helpers.ts";

async function setup() {
  const clock = new SimClock();
  const store = new MemoryNotifyStore();
  const notifier = new Notifier(store, { get: () => undefined });
  const net = new FakeNetwork(clock, { inbox: connectorInbox(notifier, () => clock.now()) });
  const seed = seedWorld(net);
  // The engine's inbox rows for Ava's two seeded items; the subject is the Network's item id.
  const add = async (subjectId: string) =>
    (await notifier.add({ personId: seed.ava.id, app: "ntwrk", eventType: "item", subjectId, urgency: "urgent", summary: "New from The Network." }, clock.now())).item;
  const introRow = await add(seed.intro.internalId);
  const questionRow = await add(seed.question.internalId);
  const token = async (itemId: string, code = "T-7F3K9Q") => {
    await store.insertToken({ token: code, personId: seed.ava.id, itemIds: [itemId], issuedAt: clock.now(), expiresAt: clock.now() + 7 * 86_400_000 });
    return code;
  };
  const item = async (id: string) => (await store.getItems([id]))[0]!;
  return { clock, net, store, seed, introRow, questionRow, token, item };
}

describe("get_network_updates and the single inbox", () => {
  test("an update code shows only its item; reading it marks it seen everywhere", async () => {
    const w = await setup();
    const tok = await w.token(w.introRow.id);
    const { call } = await connect(w.net, principal(w, w.seed.ava, { client: "chatgpt" }));
    const r = await call("get_network_updates", { update_token: tok });
    expect(r.isError).toBe(false);
    expect(r.data.items.map((i: any) => i.title)).toEqual([w.seed.intro.title]);
    expect((await w.item(w.introRow.id)).seenOn).toBe("chatgpt");
    expect((await w.item(w.questionRow.id)).seenAt).toBeUndefined();
    expect((await w.store.getToken(tok))!.redeemedOn).toBe("chatgpt");
  });

  test("someone else's code, or an unknown one, looks like an empty inbox", async () => {
    const w = await setup();
    const tok = await w.token(w.introRow.id);
    const asMaya = await connect(w.net, principal(w, w.seed.maya, { client: "claude" }));
    expect((await asMaya.call("get_network_updates", { update_token: tok })).data.items).toEqual([]);
    const asAva = await connect(w.net, principal(w, w.seed.ava, { client: "claude" }));
    expect((await asAva.call("get_network_updates", { update_token: "T-ZZZZZZ" })).data.items).toEqual([]);
    expect((await w.store.unseen(w.seed.ava.id, w.clock.now())).length).toBe(2);
  });

  test("a plain read marks what was shown as seen, so the scheduler sends nothing for it", async () => {
    const w = await setup();
    const { call } = await connect(w.net, principal(w, w.seed.ava, { client: "claude" }));
    const r = await call("get_network_updates", { limit: 10 });
    expect(r.data.items.length).toBeGreaterThanOrEqual(2);
    expect((await w.store.unseen(w.seed.ava.id, w.clock.now())).length).toBe(0);
  });

  test("a malformed code is rejected by the schema", async () => {
    const w = await setup();
    const { call } = await connect(w.net, principal(w, w.seed.ava, { client: "claude" }));
    expect((await call("get_network_updates", { update_token: "Maya wants to meet" })).isError).toBe(true);
  });
});
