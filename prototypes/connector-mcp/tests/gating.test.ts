import { describe, expect, test } from "bun:test";
import { HOUR, MINUTE } from "@thenetwork/core";
import { DEFAULT_SCOPES, SCOPES } from "../src/schemas.ts";
import { connect, key, principal, world } from "./helpers.ts";

const WITH_P2 = [...DEFAULT_SCOPES, SCOPES.writeRelay, SCOPES.writeInvites, SCOPES.sensitiveSafety];
const handleOf = async (call: any, title: string) => (await call("get_network_updates", { limit: 10 })).data.items.find((i: any) => i.title === title).item_id;

describe("tier 3: high-risk actions need confirmation in the Network's own channel", () => {
  test("invite: the host's confirm never executes it; only the member's reply on the Network channel does", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.ava, { scopes: WITH_P2 }));
    const t = await call("tell_network_agent", { instruction: "Please invite my friend Sam" });
    expect(t.data.status).toBe("confirm_in_network_app");
    const p = t.data.pending_confirmation;
    expect(p.how_to_confirm).toBe("member_confirms_in_network_app");
    expect(w.net.channelMessages.at(-1)).toMatchObject({ memberId: w.ava.id, confirmationId: p.confirmation_id });
    expect(w.net.channelMessages.at(-1)!.text).toContain("Claude asked me to");
    expect(w.net.effects).toHaveLength(0);

    const r = await call("respond_to_network_item", { item_id: p.confirmation_id, response: "confirm" });
    expect(r.data.status).toBe("confirm_in_network_app");
    expect(w.net.effects).toHaveLength(0); // the model saying "confirm" is not consent

    expect(w.net.confirmOnNetworkChannel(p.confirmation_id, w.maya.id)).toBe(false); // wrong member
    expect(w.net.confirmOnNetworkChannel(p.confirmation_id, w.ava.id)).toBe(true);
    expect(w.net.effects).toEqual([{ memberId: w.ava.id, action: "invite", payload: { name: "Sam" }, via: "network_channel" }]);
    expect(w.net.confirmOnNetworkChannel(p.confirmation_id, w.ava.id)).toBe(false); // single use
  });

  for (const [instruction, action] of [
    ["share my number with her", "share_contact"], ["message Maya that Thursday works", "relay_message"], ["I want to report someone who harassed me", "safety_report"],
  ] as const) {
    test(`${action} is tier 3`, async () => {
      const w = world();
      const { call } = await connect(w.net, principal(w, w.ava, { scopes: WITH_P2 }));
      const t = await call("tell_network_agent", { instruction });
      expect(t.data.pending_confirmation.how_to_confirm).toBe("member_confirms_in_network_app");
      await call("respond_to_network_item", { item_id: t.data.pending_confirmation.confirmation_id, response: "confirm" });
      expect(w.net.effects).toHaveLength(0);
    });
  }

  test("without the optional P2 scope the action is not available here (no step-up loop)", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.ava));
    const t = await call("tell_network_agent", { instruction: "Please invite my friend Sam" });
    expect(t.data).toMatchObject({ status: "not_available_here", pending_confirmation: null });
    expect(t.data.reply).toContain("ntwrk.love/assistants");
    expect(w.net.channelMessages).toHaveLength(0);
  });

  test("accepting a contact-swap item is tier 3 even through respond", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.ava));
    const r = await call("respond_to_network_item", { item_id: await handleOf(call, w.contactSwap.title), response: "interested" });
    expect(r.data.status).toBe("confirm_in_network_app");
    expect(w.contactSwap.status).toBe("open");
    expect(w.net.effects).toHaveLength(0);
  });
});

describe("tier 1: host confirmation through respond_to_network_item", () => {
  test("a help request from tell is drafted, then submitted only after respond(confirm)", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.ava));
    const t = await call("tell_network_agent", { instruction: "I need help moving a couch on Saturday" });
    expect(t.data.status).toBe("needs_confirmation");
    expect(t.data.changes.map((c: any) => c.kind)).toEqual(["request_drafted"]);
    const p = t.data.pending_confirmation;
    expect(p.how_to_confirm).toBe("ask_member_then_respond");
    expect(w.net.effects).toHaveLength(0);
    const r = await call("respond_to_network_item", { item_id: p.confirmation_id, response: "confirm" });
    expect(r.data.status).toBe("done");
    expect(w.net.effects.map((e) => [e.action, e.via])).toEqual([["submit_request", "host"]]);
  });

  test("state changes from tell are proposals; confirming executes exactly the server-built payload", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.ava));
    const t = await call("tell_network_agent", { instruction: "I'm slammed, pause for now" });
    expect(t.data.status).toBe("needs_confirmation");
    expect(w.ava.state).toBe("normal");
    await call("respond_to_network_item", { item_id: t.data.pending_confirmation.confirmation_id, response: "confirm", note: "actually set me to open" });
    expect(w.ava.state).toBe("quiet");
    expect(w.net.effects[0]!.payload).toEqual({ state: "quiet" });
  });

  test("interested / not_for_me on a cleared item execute immediately on an established verified grant", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.ava));
    const r = await call("respond_to_network_item", { item_id: await handleOf(call, w.intro.title), response: "interested" });
    expect(r.data.status).toBe("done");
    expect(w.intro.status).toBe("answered");
    const again = await call("respond_to_network_item", { item_id: await handleOf(call, w.question.title), response: "not_for_me" });
    expect(again.data.status).toBe("done");
    expect(w.net.effects.map((e) => e.action)).toEqual(["respond_interested", "respond_not_for_me"]);
  });

  test("tell never accepts or declines; it points to respond_to_network_item", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.ava));
    const t = await call("tell_network_agent", { instruction: "accept the climbing intro" });
    expect(t.data.status).toBe("nothing_changed");
    expect(t.data.reply).toContain("respond_to_network_item");
    expect(w.intro.status).toBe("open");
  });
});

describe("tier 2: new grants and unverified clients confirm out of band", () => {
  test("the first consequential action from a grant younger than 24 h goes to the Network channel; later ones don't", async () => {
    const w = world();
    const p = principal(w, w.ava, { grantAgeMs: 1 * HOUR });
    const { call } = await connect(w.net, p);
    const r = await call("respond_to_network_item", { item_id: await handleOf(call, w.intro.title), response: "interested" });
    expect(r.data.status).toBe("confirm_in_network_app");
    expect(r.data.pending_confirmation.how_to_confirm).toBe("member_confirms_in_network_app");
    expect(w.intro.status).toBe("open");
    expect(w.net.confirmOnNetworkChannel(r.data.pending_confirmation.confirmation_id, w.ava.id)).toBe(true);
    expect(w.intro.status).toBe("answered");
    const next = await call("respond_to_network_item", { item_id: await handleOf(call, w.question.title), response: "not_for_me" });
    expect(next.data.status).toBe("done");
  });

  test("an unverified client never completes a consequential action on the host's word", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.ava, { client: "unknown" }));
    const r = await call("respond_to_network_item", { item_id: await handleOf(call, w.intro.title), response: "interested" });
    expect(r.data.status).toBe("confirm_in_network_app");
    const t = await call("tell_network_agent", { instruction: "I need help with my resume" });
    expect(t.data.status).toBe("confirm_in_network_app");
    expect((await call("respond_to_network_item", { item_id: t.data.pending_confirmation.confirmation_id, response: "confirm" })).data.status).toBe("confirm_in_network_app");
    expect(w.net.effects).toHaveLength(0);
    expect(w.net.channelMessages.every((m) => m.text.startsWith("an assistant asked me to"))).toBe(true);
  });

  test("tier 0 actions (tell_me_more, maybe_later, drafts) never need confirmation, even on a new grant", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.ava, { grantAgeMs: 1 * MINUTE }));
    const more = await call("respond_to_network_item", { item_id: await handleOf(call, w.intro.title), response: "tell_me_more" });
    expect(more.data.status).toBe("details");
    expect(more.data.details.length).toBeGreaterThan(20);
    const later = await call("respond_to_network_item", { item_id: await handleOf(call, w.question.title), response: "maybe_later" });
    expect(later.data.status).toBe("done");
    const avail = await call("tell_network_agent", { instruction: "I'm free weeknights after 7" });
    expect(avail.data).toMatchObject({ status: "done", pending_confirmation: null });
    expect(w.net.channelMessages).toHaveLength(0);
  });
});

describe("confirmation lifecycle, idempotency and limits", () => {
  test("cancel discards; foreign, cross-grant and unknown ids are indistinguishable; expired and finished are reported", async () => {
    const w = world();
    const ava = await connect(w.net, principal(w, w.ava));
    const avaOtherGrant = await connect(w.net, principal(w, w.ava, { client: "chatgpt" }));
    const maya = await connect(w.net, principal(w, w.maya));
    const a = (await ava.call("tell_network_agent", { instruction: "anyone know a good guitar teacher?" })).data.pending_confirmation;
    expect((await ava.call("respond_to_network_item", { item_id: a.confirmation_id, response: "cancel" })).data.status).toBe("done");
    expect((await ava.call("respond_to_network_item", { item_id: a.confirmation_id, response: "confirm" })).data.status).toBe("already_done");

    const b = (await ava.call("tell_network_agent", { instruction: "looking for a running buddy" })).data.pending_confirmation;
    const foreign = await maya.call("respond_to_network_item", { item_id: b.confirmation_id, response: "confirm" });
    const crossGrant = await avaOtherGrant.call("respond_to_network_item", { item_id: b.confirmation_id, response: "confirm" });
    const missing = await maya.call("respond_to_network_item", { item_id: "cnf_nope12", response: "confirm" });
    for (const r of [foreign, crossGrant, missing]) {
      expect(r.isError).toBe(true);
      expect(r.meta["network/error"].code).toBe("item_not_found");
      expect(r.text).toBe(missing.text);
    }
    w.clock.advance(31 * MINUTE); // tier-1 confirmations live 30 minutes
    expect((await ava.call("respond_to_network_item", { item_id: b.confirmation_id, response: "confirm" })).data.status).toBe("expired");
    expect(w.net.effects).toHaveLength(0);
  });

  test("idempotency_key replays the stored result; reuse with different args is refused", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.ava));
    const p = (await call("tell_network_agent", { instruction: "I need help with my resume" })).data.pending_confirmation;
    const k = key();
    const first = await call("respond_to_network_item", { item_id: p.confirmation_id, response: "confirm", idempotency_key: k });
    const again = await call("respond_to_network_item", { item_id: p.confirmation_id, response: "confirm", idempotency_key: k });
    expect(again.data).toEqual(first.data);
    expect(again.meta["network/receipt"].action_id).toBe(first.meta["network/receipt"].action_id);
    expect(again.meta["network/receipt"].replayed).toBe(true);
    expect(w.net.effects).toHaveLength(1);
    const conflict = await call("respond_to_network_item", { item_id: p.confirmation_id, response: "cancel", idempotency_key: k });
    expect(conflict.isError).toBe(true);
    expect(conflict.meta["network/error"].code).toBe("idempotency_conflict");
  });

  test("without a key, identical calls within 10 minutes replay (server fallback key)", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.ava));
    const a = await call("tell_network_agent", { instruction: "I'm free weekends most Saturdays" });
    const b = await call("tell_network_agent", { instruction: "I'm free weekends most Saturdays" });
    expect(b.meta["network/receipt"]).toMatchObject({ action_id: a.meta["network/receipt"].action_id, replayed: true });
    w.clock.advance(11 * MINUTE);
    const c = await call("tell_network_agent", { instruction: "I'm free weekends most Saturdays" });
    expect(c.meta["network/receipt"].replayed).toBe(false);
  });

  test("agent turns are rate limited per member across grants, with a retry hint", async () => {
    const w = world();
    const one = await connect(w.net, principal(w, w.ava));
    const two = await connect(w.net, principal(w, w.ava, { client: "chatgpt" }));
    for (let i = 0; i < 15; i++) expect((await one.call("ask_network_agent", { question: `hello ${i}` })).isError).toBe(false);
    for (let i = 0; i < 15; i++) expect((await two.call("ask_network_agent", { question: `hello ${i}` })).isError).toBe(false);
    const limited = await two.call("ask_network_agent", { question: "hello again" });
    expect(limited.isError).toBe(true);
    expect(limited.meta["network/error"]).toMatchObject({ code: "rate_limited", retryable: true });
    expect(limited.meta["network/retry_after_seconds"]).toBeGreaterThan(0);
    w.clock.advance(HOUR);
    expect((await one.call("ask_network_agent", { question: "hello" })).isError).toBe(false);
  });

  test("share_profile_with_network is limited to 5 per day", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.ava));
    for (let i = 0; i < 5; i++) expect((await call("share_profile_with_network", { interests: [`hobby ${i}`], member_approved: true })).isError).toBe(false);
    const r = await call("share_profile_with_network", { interests: ["one more"], member_approved: true });
    expect(r.meta["network/error"].code).toBe("rate_limited");
  });
});
