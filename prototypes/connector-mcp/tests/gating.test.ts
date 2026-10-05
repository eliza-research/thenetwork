import { describe, expect, test } from "bun:test";
import { HOUR } from "@thenetwork/core";
import { connect, rid, world } from "./helpers.ts";

describe("confirmation gating", () => {
  test("high risk (invite) cannot be completed by the host; only the Network channel executes it", async () => {
    const w = world();
    const { call } = await connect(w.net, w.ava.id);
    const t = await call("network_talk", { message: "Please invite my friend Sam", client_request_id: rid() });
    const p = t.data.pending_confirmation;
    expect(p).toMatchObject({ risk: "high", confirm_via: "network_channel" });
    expect(w.net.effects).toHaveLength(0);

    const r = await call("network_respond", { item_id: p.confirmation_id, decision: "confirm", client_request_id: rid() });
    expect(r.data.status).toBe("awaiting_network_channel");
    expect(w.net.effects).toHaveLength(0); // the model saying "confirm" is not consent

    expect(w.net.confirmOnNetworkChannel(p.confirmation_id, w.maya.id)).toBe(false); // wrong member
    expect(w.net.confirmOnNetworkChannel(p.confirmation_id, w.ava.id)).toBe(true);
    expect(w.net.effects).toEqual([{ memberId: w.ava.id, capability: "invite", payload: { name: "Sam" } }]);
  });

  test("contact sharing is high risk too", async () => {
    const w = world();
    const { call } = await connect(w.net, w.ava.id);
    const t = await call("network_talk", { message: "share my number with her", client_request_id: rid() });
    expect(t.data.pending_confirmation).toMatchObject({ risk: "high", confirm_via: "network_channel" });
  });

  test("medium risk without elicitation: host asks the member, then confirms via respond", async () => {
    const w = world();
    const { call } = await connect(w.net, w.ava.id);
    const t = await call("network_talk", { message: "I need help moving a couch on Saturday", client_request_id: rid() });
    const p = t.data.pending_confirmation;
    expect(p).toMatchObject({ risk: "medium", confirm_via: "host_respond" });
    expect(w.net.effects).toHaveLength(0); // drafting contacts nobody
    const r = await call("network_respond", { item_id: p.confirmation_id, decision: "confirm", client_request_id: rid() });
    expect(r.data.status).toBe("done");
    expect(w.net.effects.map((e) => e.capability)).toEqual(["ask_for_help"]);
    expect(r.data.receipt.action_id).toMatch(/^act_/);
  });

  test("medium risk with elicitation: the member answers in host UI; a decline does nothing", async () => {
    const w = world();
    const asked: string[] = [];
    let answer = false;
    const { call } = await connect(w.net, w.ava.id, { elicit: (m) => (asked.push(m), answer) });
    const t = await call("network_talk", { message: "I'm slammed, pause for now", client_request_id: rid() });
    const p = t.data.pending_confirmation;
    expect(p.confirm_via).toBe("host_elicitation");
    const no = await call("network_respond", { item_id: p.confirmation_id, decision: "confirm", client_request_id: rid() });
    expect(no.data.status).toBe("needs_confirmation");
    expect(w.net.effects).toHaveLength(0);
    answer = true;
    const yes = await call("network_respond", { item_id: p.confirmation_id, decision: "confirm", client_request_id: rid() });
    expect(yes.data.status).toBe("done");
    expect(asked).toHaveLength(2);
    expect(w.net.effects.map((e) => e.capability)).toEqual(["set_state"]);
  });

  test("cancel discards; expired or foreign confirmations are indistinguishable from missing ones", async () => {
    const w = world();
    const ava = await connect(w.net, w.ava.id);
    const maya = await connect(w.net, w.maya.id);
    const a = (await ava.call("network_talk", { message: "anyone know a good guitar teacher?", client_request_id: rid() })).data.pending_confirmation;
    const c = await ava.call("network_respond", { item_id: a.confirmation_id, decision: "cancel", client_request_id: rid() });
    expect(c.data.status).toBe("done");
    const after = await ava.call("network_respond", { item_id: a.confirmation_id, decision: "confirm", client_request_id: rid() });
    expect(after.data.status).toBe("not_available");

    const b = (await ava.call("network_talk", { message: "looking for a running buddy", client_request_id: rid() })).data.pending_confirmation;
    const foreign = await maya.call("network_respond", { item_id: b.confirmation_id, decision: "confirm", client_request_id: rid() });
    const missing = await maya.call("network_respond", { item_id: "cnf_nope", decision: "confirm", client_request_id: rid() });
    expect(foreign.data.message).toBe(missing.data.message);
    expect(foreign.data.status).toBe("not_available");

    w.clock.advance(25 * HOUR);
    const expired = await ava.call("network_respond", { item_id: b.confirmation_id, decision: "confirm", client_request_id: rid() });
    expect(expired.data.status).toBe("not_available");
    expect(w.net.effects).toHaveLength(0);
  });

  test("writes are idempotent per client_request_id and conflicting reuse is refused", async () => {
    const w = world();
    const { call } = await connect(w.net, w.ava.id);
    const p = (await call("network_talk", { message: "I need help with my resume", client_request_id: rid() })).data.pending_confirmation;
    const key = rid();
    const first = await call("network_respond", { item_id: p.confirmation_id, decision: "confirm", client_request_id: key });
    const again = await call("network_respond", { item_id: p.confirmation_id, decision: "confirm", client_request_id: key });
    expect(again.data.receipt.action_id).toBe(first.data.receipt.action_id);
    expect(again.data.receipt.replayed).toBe(true);
    expect(w.net.effects).toHaveLength(1);
    const conflict = await call("network_respond", { item_id: p.confirmation_id, decision: "cancel", client_request_id: key });
    expect(conflict.isError).toBe(true);
    expect(conflict.text).toContain("idempotency_conflict");
  });

  test("accepting a cleared item records a receipt; disallowed decisions are refused", async () => {
    const w = world();
    const { call } = await connect(w.net, w.ava.id, { clientId: "claude-ai" });
    const q = await call("network_respond", { item_id: w.question.item_id, decision: "accept", client_request_id: rid() });
    expect(q.data.status).toBe("not_available"); // question only allows decline
    const r = await call("network_respond", { item_id: w.intro.item_id, decision: "accept", client_request_id: rid() });
    expect(r.data.status).toBe("done");
    const receipts = w.net.audit.filter((e) => e.memberId === w.ava.id && e.receipt);
    expect(receipts.at(-1)!.clientId).toBe("claude-ai");
    expect(receipts.at(-1)!.summary).toContain("Accepted");
  });

  test("rate limits are enforced server-side with a retry hint", async () => {
    const w = world();
    const { call } = await connect(w.net, w.ava.id);
    for (let i = 0; i < 30; i++) expect((await call("network_talk", { message: "hello", client_request_id: rid() })).isError).toBe(false);
    const limited = await call("network_talk", { message: "hello", client_request_id: rid() });
    expect(limited.isError).toBe(true);
    expect(JSON.parse(limited.text)).toMatchObject({ error: "rate_limited" });
    expect(JSON.parse(limited.text).retry_after_seconds).toBeGreaterThan(0);
    w.clock.advance(11 * 60_000);
    expect((await call("network_talk", { message: "hello", client_request_id: rid() })).isError).toBe(false);
  });
});
