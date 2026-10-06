import { describe, expect, test } from "bun:test";
import { connect, key, principal, visible, world, type ClientName } from "./helpers.ts";

// Founder decision 3: members under 18 can join but are never connected to other people. Tool
// outputs for a minor never include intros, groups, relay or contact items, any attempt to accept
// one returns a polite not-available, and romance is adult-only. Applies on every surface profile.
const CLIENTS: ClientName[] = ["chatgpt", "claude", "unknown"];
const NOT_AVAILABLE = "That isn't available.";

describe("under-18 members are never connected to other people", () => {
  for (const client of CLIENTS) {
    test(`${client}: updates contain no intro, group, relay or contact items`, async () => {
      const w = world();
      const { call } = await connect(w.net, principal(w, w.kai, { client }));
      const r = await call("get_network_updates", { limit: 10 });
      expect(r.data.items.map((i: any) => i.title)).toEqual([w.kaiEvent.title]);
      expect(visible(r)).not.toMatch(/CANARY_KAI_(INTRO|GROUP|RELAY|CONTACT)/);
    });

    test(`${client}: accepting a connection item by handle is politely not available and does nothing`, async () => {
      const w = world();
      const p = principal(w, w.kai, { client });
      const { call } = await connect(w.net, p);
      for (const it of [w.kaiIntro, w.kaiGroup, w.kaiContact]) {
        for (const response of ["interested", "tell_me_more", "confirm"] as const) {
          const r = await call("respond_to_network_item", { item_id: w.net.itemHandle(p.grantId, it), response, idempotency_key: key() });
          expect(r.isError).toBe(false);
          expect(r.data).toMatchObject({ status: "not_available_here", message: NOT_AVAILABLE });
          expect(visible(r)).not.toMatch(/CANARY_/);
        }
        expect(it.status).toBe("open");
      }
      const relay = await call("respond_to_network_item", { item_id: w.net.itemHandle(p.grantId, w.kaiRelay), response: "tell_me_more" });
      expect(relay.data.status).toBe("not_available_here");
      expect(w.net.effects).toHaveLength(0);
      expect(w.net.channelMessages).toHaveLength(0);
    });
  }

  test("people-involving requests through tell are not available; no confirmation is created", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.kai, { client: "claude", scopes: ["network.read.basic", "network.write.requests", "network.write.profile", "network.write.responses", "network.write.relay", "network.write.invites"] }));
    for (const instruction of [
      "introduce me to other skaters", "find me a robotics buddy", "invite my friend Sam", "share my number with my match",
      "message Maya that I'm in", "I need help with my science project", "looking for friends who code", "find me a date",
    ]) {
      const r = await call("tell_network_agent", { instruction, idempotency_key: key() });
      expect(r.data).toMatchObject({ changes: [], pending_confirmation: null });
      expect(r.data.status).toBe("not_available_here");
    }
    expect(w.net.effects).toHaveLength(0);
    expect(w.net.channelMessages).toHaveLength(0);
  });

  test("ask never offers introductions to a minor and lists only non-connection items", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.kai));
    const intro = await call("ask_network_agent", { question: "can you introduce me to other skaters?" });
    expect(intro.data).toMatchObject({ answer: NOT_AVAILABLE, suggested_tool: "none", related_items: [] });
    const news = await call("ask_network_agent", { question: "anything new for me?" });
    expect(news.data.related_items.map((r: any) => r.title)).toEqual([w.kaiEvent.title]);
    expect(visible(news)).not.toMatch(/CANARY_/);
  });

  test("an all-ages event without other people can still be answered", async () => {
    const w = world();
    const p = principal(w, w.kai);
    const { call } = await connect(w.net, p);
    const r = await call("respond_to_network_item", { item_id: w.net.itemHandle(p.grantId, w.kaiEvent), response: "interested" });
    expect(r.data.status).toBe("done");
    expect(w.net.effects.map((e) => e.action)).toEqual(["respond_interested"]);
  });

  test("share_profile: people-connecting looking_for values are rejected for minors; things_to_do is accepted", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.kai));
    const r = await call("share_profile_with_network", {
      interests: ["skateboarding"], looking_for: ["new_friends", "activity_partners", "things_to_do", "being_mentored"], member_approved: true,
    });
    expect(r.data.accepted_count).toBe(2);
    expect(r.data.rejected).toEqual([
      { field: "looking_for", index: 0, reason: "not_available_here" },
      { field: "looking_for", index: 1, reason: "not_available_here" },
      { field: "looking_for", index: 3, reason: "not_available_here" },
    ]);
  });

  test("adults on the same hosts still get connection items (the gate is the member's age, not the host)", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.ava, { client: "chatgpt" }));
    expect((await call("get_network_updates", {})).data.items.map((i: any) => i.title)).toContain(w.intro.title);
  });
});
