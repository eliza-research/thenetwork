// Send-time recipient eligibility through the real ConsentNetwork: each refusal is reached the way
// production reaches it (a STOP text, a block or report text, a staff hold, a member record that a
// staff or settings change paused, an age under 18, a state restored from the store) and read back
// through recipientPolicy, the check the delivery queue's recipient hook calls before every send.
// spec/recipientEligibility.md, "Check the recipient's own state in a fixed order"; "A message about another member needs two adults with no block between them"
import { describe, expect, test } from "vitest";
import { SimClock } from "@thenetwork/core";
import type { SendRequest } from "../../blooio/src/types.ts";
import { reengagementDeliveryPrefix } from "../../core/src/generated/outreachPolicy.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { APPS } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { lateArrivalDeliveryId } from "../src/group-late-arrival.ts";
import { BlooioAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";
import { Mini, type Spec } from "./mini.ts";

const person = (id: string, name: string, o: Partial<Spec> = {}): Spec => ({
  id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" }], ...o,
});

async function world(extra: Spec[] = []) {
  const w = new Mini([person("a", "Ana Diaz"), person("b", "Ben Ito"), person("c", "Cy Moss"), person("d", "Dee Park"), ...extra]);
  await w.onboard("a", "b", "c", "d", ...extra.map(s => s.id));
  return w;
}

/** A store restart that brings back a member state the store holds (the same JSON PgStore keeps). */
function restore(w: Mini, edit: (state: any) => void) {
  const state = JSON.parse(JSON.stringify(w.net.exportState()));
  edit(state);
  w.net.importState(state);
}

describe("send-time recipient eligibility", () => {
  test("the recipient's own state: unknown, STOP, paused account, hold, only when asked", async () => {
    const w = await world();
    expect(w.net.recipientPolicy("a", "probe", { about: ["b"] })).toEqual({ ok: true });
    expect(w.net.recipientPolicy("nobody", "reply")).toEqual({ ok: false, reason: "unknown_member" });

    // STOP refuses every message the network sends, a reply and a safety notice too.
    // The carrier keyword, as the service passes it on.
    await w.net.onInbound({ id: "stop-d", memberId: "d", body: "STOP", ts: w.clock.now(), channel: "sms", keyword: "STOP" });
    for (const kind of ["reply", "safety", "probe", "info", "reengage"] as const)
      expect(w.net.recipientPolicy("d", kind)).toEqual({ ok: false, reason: "opted_out" });

    // A paused account gets only replies and safety notices.
    // The platform's member record carries the account state the Network reads (MemberRecord.accountStatus).
    Object.assign(w.members.find(m => m.id === "c")!, { accountStatus: "paused" });
    w.clock.advance(1);
    expect(w.net.recipientPolicy("c", "info", { proactive: true })).toEqual({ ok: false, reason: "account_paused" });
    expect(w.net.recipientPolicy("c", "reply")).toEqual({ ok: true });
    expect(w.net.recipientPolicy("c", "safety")).toEqual({ ok: true });

    // A held member gets replies and safety notices, never a message about another member.
    expect(w.net.holdMember("b", "staff", "test hold").ok).toBe(true);
    expect(w.net.recipientPolicy("b", "checkin")).toEqual({ ok: false, reason: "held" });
    expect(w.net.recipientPolicy("b", "probe", { about: ["a"] })).toEqual({ ok: false, reason: "held" });
    expect(w.net.recipientPolicy("b", "reply")).toEqual({ ok: true });
    expect(w.net.recipientPolicy("b", "safety")).toEqual({ ok: true });

    // "Only when I ask": no proactive message except the one re-engagement message.
    restore(w, s => { s.members.find((m: any) => m.id === "a").onlyWhenAsked = true; });
    expect(w.net.recipientPolicy("a", "info", { proactive: true })).toEqual({ ok: false, reason: "only_when_asked" });
    expect(w.net.recipientPolicy("a", "reengage", { proactive: true })).toEqual({ ok: true });
    expect(w.net.recipientPolicy("a", "reply")).toEqual({ ok: true });
  });

  test("an under-13 decline keeps only the id, and nothing goes to it", async () => {
    const w = new Mini([person("k", "Kid Lee", { age: undefined })]);
    await w.say("k", "hi!");
    await w.say("k", "I'm 11");
    expect(w.log("join_declined")).toHaveLength(1);
    for (const kind of ["reply", "safety", "info"] as const)
      expect(w.net.recipientPolicy("k", kind)).toEqual({ ok: false, reason: "declined" });
  });

  test("an unknown age is not a known adult: no message to them or about them", async () => {
    const w = await world();
    restore(w, s => { s.members.find((m: any) => m.id === "d").ageUnknown = true; });
    expect(w.net.recipientPolicy("d", "probe", { about: ["a"] })).toEqual({ ok: false, reason: "minor" });
    expect(w.net.recipientPolicy("a", "probe", { about: ["d"] })).toEqual({ ok: false, reason: "other_not_matchable" });
    expect(w.net.recipientPolicy("d", "reply")).toEqual({ ok: true });
  });

  test("a minor recipient: no message about another member, a neutral cancellation still goes", async () => {
    const w = await world([person("t", "Tess Ray", { age: 15 })]);
    expect(w.net.recipientPolicy("t", "probe", { about: ["a"] })).toEqual({ ok: false, reason: "minor" });
    expect(w.net.recipientPolicy("t", "reveal", { about: ["a"] })).toEqual({ ok: false, reason: "minor" });
    expect(w.net.recipientPolicy("t", "cancellation", { about: ["a"] })).toEqual({ ok: true });
    // And no adult hears about the minor.
    expect(w.net.recipientPolicy("a", "probe", { about: ["t"] })).toEqual({ ok: false, reason: "other_not_matchable" });
    expect(w.net.recipientPolicy("a", "probe", { about: ["gone"] })).toEqual({ ok: false, reason: "other_not_matchable" });
  });

  test("a block, either way, refuses every message about the other person", async () => {
    const w = await world();
    await w.say("c", "block Ben Ito");
    expect(w.net.recipientPolicy("c", "probe", { about: ["b"] })).toEqual({ ok: false, reason: "blocked_pair" });
    expect(w.net.recipientPolicy("b", "probe", { about: ["c"] })).toEqual({ ok: false, reason: "blocked_pair" });
    expect(w.net.recipientPolicy("b", "reveal", { about: ["c", "a"] })).toEqual({ ok: false, reason: "blocked_pair" });
    expect(w.net.recipientPolicy("b", "probe", { about: ["a"] })).toEqual({ ok: true });
  });

  test("a recipient or another person on watch or on a staff hold", async () => {
    const w = await world();
    restore(w, s => {
      const ok = { score: 3, level: "watch", events: [], reportsFrom: [], blocksMade: [] };
      s.trust = [...(s.trust ?? []).filter((r: any) => r.id !== "a"), { id: "a", ...ok }];
    });
    expect(w.net.recipientPolicy("a", "probe", { about: ["b"] })).toEqual({ ok: false, reason: "on_watch" });
    expect(w.net.recipientPolicy("b", "probe", { about: ["a"] })).toEqual({ ok: false, reason: "other_on_watch" });
    expect(w.net.holdMember("d", "staff", "test hold").ok).toBe(true);
    // A staff hold is a trust level past watch; "other_held" is an open report (report-booked.test.ts).
    expect(w.net.recipientPolicy("b", "probe", { about: ["d"] })).toEqual({ ok: false, reason: "other_on_watch" });
  });

  test("the verdict names the first failed check, whatever the order of the other people", async () => {
    const w = await world();
    expect(w.net.holdMember("d", "staff", "test hold").ok).toBe(true);
    await w.say("c", "block Ben Ito");
    // d is held and listed first; the block between c and b is the earlier check.
    expect(w.net.recipientPolicy("c", "probe", { about: ["d", "b"] })).toEqual({ ok: false, reason: "blocked_pair" });
    expect(w.net.recipientPolicy("c", "probe", { about: ["b", "d"] })).toEqual({ ok: false, reason: "blocked_pair" });
  });

  test("quiet hours defer an interruption and a logistics send, never a reply", async () => {
    const w = new Mini([person("q", "Quinn Ash"), person("r", "Rae Lin")], { matchingEnabled: false, growth: false, plans: false });
    await w.onboard("q", "r");
    const night = Date.UTC(2026, 10, 8, 4);
    const saved = w.net.exportState();
    saved.deferred = [
      { memberId: "q", body: "How did your week of climbing go?", meta: { type: "checkin" }, kind: "checkin", o: {}, timing: "slot" },
      { memberId: "r", body: "Your climbing session moved to 7pm.", meta: { type: "info" }, kind: "reminder", o: {}, timing: "logistics" },
    ];
    w.net.importState(saved);
    w.clock.set(night);

    const asked = w.mark();
    await w.say("r", "cancel my plan");
    expect(w.to("r", asked).map(sent => sent.reply)).toEqual([true]);

    const atNight = w.mark();
    await w.net.tick(night);
    expect(w.sent.slice(atNight)).toEqual([]);
    expect(w.net.exportState().deferred.map(item => [item.memberId, item.kind])).toEqual([["q", "checkin"], ["r", "reminder"]]);

    const morning = Date.UTC(2026, 10, 8, 15);
    w.clock.set(morning);
    const atMorning = w.mark();
    await w.net.tick(morning);
    expect(w.sent.slice(atMorning).map(sent => [sent.to, sent.body])).toEqual([["r", "Your climbing session moved to 7pm."]]);
    expect(w.net.exportState().deferred.map(item => [item.memberId, item.kind])).toEqual([["q", "checkin"]]);
  });
});

// The same verdict at the real send boundary: rows in the Postgres outbound queue (platform.outbound),
// drained through the channel.ts recipient hook. Each refused row ends with its reason and never reaches the provider.
test.skipIf(!pgAvailable)("the persisted queue refuses each ineligible row with its reason and sends the eligible one", async () => {
  const url = await migratedDb("recipient_eligibility");
  const sql = new SQL(url);
  const clock = new SimClock(Date.UTC(2026, 10, 7, 21)); // 16:00 New York, inside the send window.
  const app = APPS.friends;
  const calls: SendRequest[] = [];
  const adapter = new BlooioAdapter({ app: app.id, from: "+12125550680", clock, log: () => {}, liveGate: () => true,
    provider: { kind: "sim", async send(request) {
      calls.push(request);
      return { providerMessageId: `sim:${request.idempotencyKey}`, status: "sent", acceptedAt: clock.now() };
    } },
  });
  const service = new NetworkService({ url, clock, photoStorage: null, notify: false, log: () => {}, adapter: () => adapter,
    env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off" },
    networks: [{ id: "friends:nyc", matchingEnabled: false }], network: { plans: false, growth: false, runHour: 16 },
  });
  try {
    await service.start();
    const members: (Spec & { e164: string })[] = [];
    for (const [name, e164] of [["Ari", "+12125550681"], ["Bea", "+12125550682"], ["Cal", "+12125550683"], ["Dot", "+12125550684"], ["Eve", "+12125550685"]] as const) {
      const joined = await service.accounts.join(app, { e164, personId: null }, { firstName: name, age: 30, consent: { sms: true, wording: app.consent.text } });
      if (!joined.ok) throw new Error(`Fixture join refused for ${name}: ${joined.error}`);
      members.push({ id: joined.membership.memberId, name, e164, age: 30 });
    }
    const [ari, bea, cal, dot, eve] = members as [typeof members[0], typeof members[0], typeof members[0], typeof members[0], typeof members[0]];
    const mini = new Mini(members, { app: app.id, matchingEnabled: false, growth: false, plans: false });
    await mini.onboard(...members.map(m => m.id));
    const rt = service.runtimeFor(app.id)!;
    // Dot has no age the Network can trust (a state with the age unknown, as a member who never gave one).
    const saved = mini.net.exportState();
    saved.members.find(m => m.id === dot.id)!.ageUnknown = true;
    await rt.unitOfWork(net => net.importState(saved));
    await rt.unitOfWork(net => {
      expect(net.holdMember(cal.id, "staff", "test hold").ok).toBe(true);
      return net.onInbound({ id: "block-ari", memberId: ari.id, body: "block Bea", ts: clock.now(), channel: "sms" });
    });
    expect(await rt.readState(net => net.recipientPolicy(ari.id, "relay", { about: [bea.id] }))).toEqual({ ok: false, reason: "blocked_pair" });

    const late = (from: typeof ari, to: typeof ari) => ({
      id: lateArrivalDeliveryId({ app: app.id, oppId: "opp-late", meetingAt: clock.now() + 3_600_000, revision: 0, from: from.id, to: to.id }),
      memberId: to.id, to: to.e164, kind: "proactive" as const, text: "Someone in your group is running late.",
    });
    const reengage = (to: typeof ari) => ({ id: `${reengagementDeliveryPrefix}${to.id}:1`, memberId: to.id, to: to.e164, kind: "proactive" as const, text: "Still up for meeting people?" });
    const rows = [
      { row: late(bea, ari), reason: "blocked_pair" },
      { row: late(dot, eve), reason: "other_not_matchable" },
      { row: reengage(dot), reason: "minor" },
      { row: late(eve, dot), reason: "minor" },
      { row: reengage(cal), reason: "held" },
      { row: late(eve, cal), reason: "held" },
    ];
    await adapter.queue.enqueue(sql, rows.map(r => ({ ...r.row, city: "nyc" })));
    await adapter.queue.drain();
    for (const { row, reason } of rows) {
      const [stored] = await sql<{ status: string; note: string | null }[]>`select status, note from platform.outbound where id=${row.id}`;
      expect({ id: row.id, ...stored }).toEqual({ id: row.id, status: "suppressed_ineligible", note: reason });
    }
    expect(calls.filter(call => rows.some(r => call.idempotencyKey.endsWith(r.row.id)))).toEqual([]);

    // The same hook passes an eligible member: a re-engagement to Eve is not refused for the recipient.
    const ok = reengage(eve);
    await adapter.queue.enqueue(sql, [{ ...ok, city: "nyc" }]);
    await adapter.queue.drain();
    const [stored] = await sql<{ status: string; note: string | null }[]>`select status, note from platform.outbound where id=${ok.id}`;
    expect(["blocked_pair", "other_not_matchable", "minor", "held"]).not.toContain(stored?.note);

    const info = { id: `eligible-info:${eve.id}`, memberId: eve.id, to: eve.e164, kind: "proactive" as const, text: "The climbing gym on Kent Ave opens early on Saturdays." };
    await adapter.queue.enqueue(sql, [{ ...info, city: "nyc" }]);
    await rt.unitOfWork(() => undefined);
    const [sent] = await sql<{ status: string; note: string | null }[]>`select status, note from platform.outbound where id=${info.id}`;
    expect(sent).toEqual({ status: "sent", note: null });
    expect(calls.filter(call => call.idempotencyKey.endsWith(info.id)).map(call => [call.to, call.text])).toEqual([[eve.e164, info.text]]);
  } finally {
    await service.close();
    await sql.close();
    await dropDb(url);
  }
}, 120_000);
