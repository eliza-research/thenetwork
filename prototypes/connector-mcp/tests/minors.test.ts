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

// Audit 2026-10-07 P1-6: the report branch runs before the minors people-filter, so an under-18
// member can always report harassment. (Reports are tier 3: confirmed in the Network's own channel.)
describe("under-18 members can always report a safety problem", () => {
  const SAFETY_SCOPES = ["network.read.basic", "network.write.requests", "network.write.profile", "network.write.responses", "network.sensitive.safety"];
  for (const client of CLIENTS) {
    test(`${client}: "someone is harassing me" starts a safety report`, async () => {
      const w = world();
      const { call } = await connect(w.net, principal(w, w.kai, { client, scopes: SAFETY_SCOPES }));
      for (const instruction of ["someone is harassing me", "a guy from the robotics club keeps threatening me", "I want to report a person who is bullying me"]) {
        const r = await call("tell_network_agent", { instruction, idempotency_key: key() });
        expect(r.isError).toBe(false);
        expect(r.data.status).not.toBe("not_available_here");
        expect(r.data.pending_confirmation?.summary ?? "").toContain("safety report");
      }
    });
  }

  test("without the safety scope, a minor still gets the Network's channel and an emergency resource", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.kai));
    const r = await call("tell_network_agent", { instruction: "someone is harassing me", idempotency_key: key() });
    expect(r.data.status).toBe("not_available_here");
    expect(r.data.reply).toContain("text The Network");
    expect(r.data.reply).toContain("911");
    expect(r.data.reply).not.toBe(NOT_AVAILABLE);
  });

  test("ask: a minor asking about harassment is pointed to reporting, not refused", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.kai));
    const r = await call("ask_network_agent", { question: "someone is harassing me, what do I do?" });
    expect(r.data.answer).not.toBe(NOT_AVAILABLE);
    expect(r.data.answer).toContain("safety report");
    expect(r.data.suggested_tool).toBe("tell_network_agent");
  });

  test("people-involving requests are still refused for minors", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.kai));
    const r = await call("tell_network_agent", { instruction: "introduce me to other skaters", idempotency_key: key() });
    expect(r.data.status).toBe("not_available_here");
  });
});

// Founder decision 2026-10-07: minimum age to join is 13. Under-13s are declined kindly and nothing is stored.
describe("under-13: declined kindly, nothing stored", () => {
  test("statedAge reads first-person ages only", async () => {
    const { statedAge } = await import("../src/policy.ts");
    expect(statedAge("I'm 12", 2026)).toBe(12);
    expect(statedAge("i am twelve years old", 2026)).toBe(12);
    expect(statedAge("I was born in 2015", 2026)).toBe(11);
    for (const t of ["my son is 12", "I've climbed for 12 years", "I'm one of the hosts", "I'm 5 minutes away", "I'm 12:30 free"]) expect(statedAge(t, 2026)).toBeNull();
  });

  test("share_profile from someone who says they are 12 stores nothing and gets the kind decline", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.kai));
    const before = w.net.proposals.length, msgs = w.net.channelMessages.length;
    const r = await call("share_profile_with_network", { interests: ["robotics", "I'm 12 and love lego"], member_approved: true });
    expect(r.isError).toBe(false);
    expect(r.data.accepted_count).toBe(0);
    expect(r.data.next_step).toContain("at least 13");
    expect(w.net.proposals.length).toBe(before);
    expect(w.net.channelMessages.length).toBe(msgs);
  });

  test("tell_network_agent: 'I was born in 2015' is declined kindly with no confirmation", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.kai));
    const r = await call("tell_network_agent", { instruction: "I was born in 2015, sign me up for robotics events", idempotency_key: key() });
    expect(r.data).toMatchObject({ status: "not_available_here", changes: [], pending_confirmation: null });
    expect(r.data.reply).toContain("at least 13");
  });

  test("a 16-year-old stating their age is not declined", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.kai));
    const r = await call("share_profile_with_network", { interests: ["I'm 16 and into robotics"], member_approved: true });
    expect(r.data.accepted_count).toBe(1);
  });

  test("an under-13 member record can't be created", () => {
    const w = world();
    expect(() => w.net.addMember({ ...w.kai, id: "mem_kid_0001", age: 12 })).toThrow("at least 13");
    expect(w.net.members.has("mem_kid_0001")).toBe(false);
  });
});
