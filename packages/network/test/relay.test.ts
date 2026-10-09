// Relay between matched members (relay.ts, PRD 32.11, F16, 40.5): threads open only after a mutual
// yes and only between adults, texts go out with the sender's first name, scam, leak and appearance
// texts are held for staff, threads close on STOP, leave, block and ban, a ban notice goes out once,
// a delete scrubs names and texts, and a number swap needs both yeses. Also the scam corpus
// (evals/safety/scam.jsonl) and the relay tables in Postgres (migration 0013).
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { SQL } from "bun";
import { DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { migrate } from "../../observatory/db/migrate.ts";
import { PgStore } from "../src/store.ts";
import { againOf, contactIntentOf, contactNameOf, explicitRelayOf, isReschedule, isRunningLate, relayCheck } from "../src/relay.ts";
import { bookDate, DAY, HOUR, say, slopNet, World } from "./world.ts";

const T = 120_000;

/** Ana (29) and Ben (31) booked for a first date; Cara (34) and Dan (16) are around. */
async function booked() {
  const w = new World();
  w.add("ana", "Ana Lopez", 29); w.add("ben", "Ben Kim", 31, "Midtown"); w.add("cara", "Cara Diaz", 34); w.add("dan", "Dan Ruiz", 16);
  const net = slopNet(w);
  const oppId = await bookDate(net, w, "ana", "ben");
  return { w, net, oppId };
}

describe("relay threads", () => {
  test("a thread opens only after the mutual yes, and only between adults", async () => {
    const w = new World();
    w.add("ana", "Ana Lopez", 29); w.add("ben", "Ben Kim", 31, "Midtown"); w.add("dan", "Dan Ruiz", 16);
    const net = slopNet(w);
    // A proposal with a minor is never approved, so no thread can exist.
    await say(net, w, "dan", "hi"); await say(net, w, "ana", "hi");
    net.submitProposal({ id: "p-minor", kind: "intro", participants: ["ana", "dan"], alternates: [], objective: "x", category: "romance", city: "nyc", score: 0.9, exploration: false, explanations: {}, generator: "player", createdAt: w.t, components: { fit: 1, mutualBenefit: 1, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 1 } });
    await net.tick(w.t);
    for (const i of net.reviewQueue()) expect(net.decide(i.oppId, "approve", { reviewer: "staff@example.com" }).ok).toBe(false);
    expect(net.relayThreads()).toEqual([]);
    // Before the second yes there is no thread, and a text is not relayed.
    await say(net, w, "ben", "hi");
    net.submitProposal({ id: "p-ab", kind: "intro", participants: ["ana", "ben"], alternates: [], objective: "x", category: "romance", city: "nyc", score: 0.9, exploration: false, explanations: {}, generator: "player", createdAt: w.t, components: { fit: 1, mutualBenefit: 1, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 1 } });
    w.t += DAY; await net.tick(w.t);
    const item = net.reviewQueue().find(i => i.oppId === "p-ab")!;
    expect(net.decide(item.oppId, "approve", { reviewer: "staff@example.com" }).ok).toBe(true);
    const first = net.opps.get("p-ab")!.first!;
    await say(net, w, first, "yes, the first one works");
    expect(net.relayThreads()).toEqual([]);
    const before = w.sent.length;
    await say(net, w, first, "Looking forward to meeting them, whoever it is");
    expect(w.sent.slice(before).filter(s => s.meta?.type === "relay")).toEqual([]);
    await say(net, w, first === "ana" ? "ben" : "ana", "yes");
    const [t] = net.relayThreads();
    expect(t).toMatchObject({ oppId: "p-ab", members: expect.arrayContaining(["ana", "ben"]) });
    expect(t!.closesAt).toBe(net.opps.get("p-ab")!.meetingAt! + 7 * DAY);
  }, T);

  test("a text goes to the other member with the sender's first name in front; the sender hears once how it works", async () => {
    const { w, net } = await booked();
    const at = w.sent.length;
    await say(net, w, "ana", "Hey! Looking forward to Wednesday. I hear the dumplings there are great");
    expect(w.to("ben", at).map(s => s.body)).toEqual(["Ana: Hey! Looking forward to Wednesday. I hear the dumplings there are great"]);
    expect(w.to("ben", at)[0]!.meta).toMatchObject({ type: "relay", relayFrom: "ana" });
    expect(w.to("ana", at).map(s => s.body)).toEqual([net["copy"].relayFirst("Ben")]);
    const at2 = w.sent.length;
    await say(net, w, "ben", "Same! See you at 7");
    await say(net, w, "ana", "Perfect, I'll grab a table near the dumpling stand");
    expect(w.to("ana", at2).map(s => s.body)).toEqual(["Ben: Same! See you at 7"]);
    expect(w.to("ben", at2).map(s => s.body)).toContain("Ana: Perfect, I'll grab a table near the dumpling stand");
    // Ana was told once; Ben once.
    expect(w.sent.filter(s => s.to === "ana" && s.body.startsWith("Sent to ")).length).toBe(1);
    expect(w.sent.filter(s => s.to === "ben" && s.body.startsWith("Sent to ")).length).toBe(1);
    // The log keeps a hash, never the text, once it went out.
    for (const e of net.relayLog()) { expect(e.status).toBe("sent"); expect(e.body).toBeUndefined(); expect(e.bodyHash).toMatch(/^[0-9a-f]{32}$/); }
    // "me:" talks to the agent.
    const at3 = w.sent.length;
    await say(net, w, "ana", "me: what time was it again?");
    expect(w.to("ben", at3)).toEqual([]);
    // "pretty" as an adverb is not about looks: passed on, not held.
    await say(net, w, "ana", "I'm pretty excited for Wednesday honestly");
    expect(w.to("ben", at3).map(s => s.body)).toEqual(["Ana: I'm pretty excited for Wednesday honestly"]);
  }, T);

  test("scam, leak and appearance texts are held for staff; nothing goes out until a release", async () => {
    const { w, net } = await booked();
    // A private fact of someone else (Cara): never relayed.
    w.facets.push({ id: "cara:f1", memberId: "cara", kind: "fact", value: "going through a divorce with Mark right now", tags: [], scope: "agent_private", provenance: "said", confidence: 0.9 });
    const at = w.sent.length;
    await say(net, w, "ana", "fun fact, my friend is going through a divorce with Mark right now");
    await say(net, w, "ana", "you're really cute in your photos btw");
    await say(net, w, "ana", "add me on whatsapp, it's easier");
    expect(w.to("ben", at)).toEqual([]);
    // One notice: the same text twice within 10 minutes is never sent (the duplicate rule).
    expect(w.to("ana", at).map(s => s.body)).toEqual([net["copy"].relayHeld]);
    const held = net.relayHeld();
    expect(held.map(e => e.reason!.split(",")[0]!.split(":")[0])).toEqual(["forbidden", "appearance", "scam"]);
    expect(held[2]!.reason).toContain("scam:off_platform");
    expect(held.every(e => e.body && e.from === "ana" && e.to === "ben")).toBe(true);
    // A review event: the sender's safety case, with no text in it. None of these is the classifier's abuse.
    expect(net.safetyCases().find(c => c.memberId === "ana")!.events.filter(e => e.kind === "relay_held").length).toBe(3);
    expect(net.trust.get("ana").score).toBe(0);
    // Staff release one: it goes out with the prefix and its text is dropped.
    const at2 = w.sent.length;
    expect(net.releaseRelay(held[1]!.id, "staff@example.com")).toEqual({ ok: true });
    expect(w.to("ben", at2).map(s => s.body)).toEqual(["Ana: you're really cute in your photos btw"]);
    expect(net.relayLog().find(e => e.id === held[1]!.id)).toMatchObject({ status: "sent", decidedBy: "staff@example.com" });
    expect(net.relayLog().find(e => e.id === held[1]!.id)!.body).toBeUndefined();
    // A reject keeps it from going out; a second decision is refused.
    expect(net.rejectRelay(held[0]!.id, "staff@example.com")).toEqual({ ok: true });
    expect(net.releaseRelay(held[0]!.id, "staff@example.com")).toEqual({ ok: false, reason: "not_held" });
    expect(net.relayLog().find(e => e.id === held[0]!.id)).toMatchObject({ status: "blocked" });
    expect(net.releaseRelay(held[2]!.id, " ")).toEqual({ ok: false, reason: "actor_required" });
    // A money ask is held too, and the classifier's scam costs trust points as anywhere else.
    const at3 = w.sent.length;
    await say(net, w, "ana", "Hey can you venmo me $20 for the drinks?");
    expect(w.to("ben", at3).filter(s => s.body.includes("venmo"))).toEqual([]);
    expect(net.relayHeld().at(-1)!.reason).toContain("scam:money");
    expect(net.trust.get("ana").score).toBeGreaterThan(0);
    expect(JSON.stringify(net.safetyCases())).not.toContain("venmo");
  }, T);

  test("a no to the booked plan, an opt-in keyword or a short yes is for the agent, never relayed", async () => {
    const { w, net, oppId } = await booked();
    const at = w.sent.length;
    await say(net, w, "ana", "WEEKLY");
    await say(net, w, "ben", "No thanks, not right now. 😕");
    expect(w.sent.slice(at).filter(s => s.meta?.type === "relay")).toEqual([]);
    expect(net.opps.get(oppId)!.stage).not.toBe("scheduled");
    expect(w.sent.slice(at).some(s => s.to === "ana" && /Ben/.test(s.body))).toBe(false);
  }, T);

  test("STOP, leave, block and ban close the thread; nothing is relayed after", async () => {
    for (const how of ["stop", "leave", "block", "ban"] as const) {
      const { w, net } = await booked();
      if (how === "stop") await say(net, w, "ben", "STOP", "STOP");
      if (how === "leave") net.forgetMember("ben");
      if (how === "block") await say(net, w, "ana", "block Ben");
      if (how === "ban") net.markBanned("ben", "staff@example.com");
      const [t] = net.relayThreads();
      expect([how, t!.closedReason]).toEqual([how, how === "leave" ? "left" : how]);
      const at = w.sent.length;
      await say(net, w, "ana", "Hey, are we still on for Wednesday?");
      expect([how, w.to("ben", at).filter(s => s.meta?.type === "relay")]).toEqual([how, []]);
    }
  }, T);

  test("a ban tells everyone who had a thread with them once (open or long closed), with no name or reason", async () => {
    const { w, net } = await booked();
    await bookDate(net, w, "cara", "dan").catch(() => undefined); // a minor is never booked: no thread
    // The date happened a week and more ago: the thread closed, but the relay log remembers who met.
    w.t += 9 * DAY; await net.tick(w.t);
    expect(net.relayThreads()[0]).toMatchObject({ closedReason: "expired" });
    const at = w.sent.length;
    expect(net.markBanned("ben", "staff@example.com")).toEqual({ ok: true });
    const notices = w.sent.slice(at).filter(s => s.body === net["copy"].banNotice);
    expect(notices.map(s => s.to)).toEqual(["ana"]);
    expect(notices[0]!.meta).toMatchObject({ safety: true });
    expect(/Ben/.test(notices[0]!.body)).toBe(false);
    expect(net.markBanned("ben", "staff@example.com")).toEqual({ ok: true });
    expect(w.sent.filter(s => s.body === net["copy"].banNotice).length).toBe(1);
    expect(w.logged("safety_action").at(-2)!.detail).toMatchObject({ action: "ban", banNotices: 1 });
  }, T);

  test("a delete removes the member's name and texts from the relay log; ids and statuses stay", async () => {
    const { w, net } = await booked();
    await say(net, w, "ana", "Looking forward to it!! Ben you're going to love the place");
    await say(net, w, "ben", "venmo me $30 for the tickets ok?");
    await say(net, w, "ana", "Ben, quick question about Wednesday, what do you like to drink?");
    expect(net.relayLog().filter(e => e.from === "ben" && e.status === "held").length).toBe(1);
    const ids = net.relayLog().map(e => [e.id, e.from, e.to]);
    net.forgetMember("ben");
    const log = net.relayLog();
    expect(log.map(e => [e.id, e.from, e.to])).toEqual(ids);
    for (const e of log.filter(x => x.from === "ben")) { expect(e.fromName).toBeUndefined(); expect(e.body).toBeUndefined(); expect(e.status).toBe("blocked"); }
    expect(JSON.stringify(net.exportState().relay)).not.toMatch(/Ben|venmo/);
  }, T);
});

describe("contact swap", () => {
  test("a number request inside a booked date is a swap ask, never abuse; numbers go out only after both yeses, once", async () => {
    const { w, net } = await booked();
    const at = w.sent.length;
    await say(net, w, "ana", "can I get his number?");
    expect(net.trust.get("ana").score).toBe(0);
    expect(w.logged("abuse")).toEqual([]);
    expect(w.to("ben", at).map(s => s.body)).toEqual([net["copy"].contactAsk("Ana")]);
    expect(w.to("ana", at).map(s => s.body)).toEqual([net["copy"].contactAsked("Ben")]);
    expect(net.contactShares()).toMatchObject([{ requester: "ana", target: "ben", status: "asked" }]);
    // Nothing is sent before Ben's yes.
    expect(w.sent.some(s => /\+1646/.test(s.body))).toBe(false);
    const at2 = w.sent.length;
    await say(net, w, "ben", "yes sure");
    expect(w.to("ana", at2).map(s => s.body)).toEqual([net["copy"].contactShared("Ben", "+16465550102")]);
    expect(w.to("ben", at2).map(s => s.body)).toEqual([net["copy"].contactShared("Ana", "+16465550101")]);
    expect(net.contactShares()).toMatchObject([{ status: "sent" }]);
    // Once: a second ask does not send again.
    const at3 = w.sent.length;
    await say(net, w, "ben", "send her my number");
    expect(w.sent.slice(at3).some(s => /\+1646/.test(s.body))).toBe(false);
    expect(w.to("ben", at3).map(s => s.body)).toEqual([net["copy"].contactAlready("Ana")]);
  }, T);

  test("a no and 72 hours of silence get the same gentle answer; outside a booked date it is still contact extraction", async () => {
    const { w, net } = await booked();
    await say(net, w, "ben", "send Ana my number");
    const at = w.sent.length;
    await say(net, w, "ana", "no thanks, not yet");
    expect(w.to("ben", at).map(s => s.body)).toEqual([net["copy"].contactNotNow("Ana")]);
    expect(w.to("ana", at).map(s => s.body)).toEqual([net["copy"].contactDeclinedAck]);
    expect(w.sent.some(s => /\+1646/.test(s.body))).toBe(false);

    const b = await booked();
    await say(b.net, b.w, "ana", "what's his number?");
    const at2 = b.w.sent.length;
    b.w.t += 73 * HOUR; await b.net.tick(b.w.t);
    expect(b.w.to("ana", at2).map(s => s.body)).toContain(b.net["copy"].contactNotNow("Ben"));
    expect(b.net.contactShares()).toMatchObject([{ status: "expired" }]);

    // Inside a booked date, a number of someone else (not the match) is not a swap: the old abuse path.
    await say(b.net, b.w, "ben", "can I get Cara's number?");
    expect(b.w.logged("abuse").map(l => l.detail.memberId)).toEqual(["ben"]);
    expect(b.net.contactShares().length).toBe(1);
    // Cara has no booked date with anyone: asking for a number is the old abuse path.
    await say(b.net, b.w, "cara", "hi");
    await say(b.net, b.w, "cara", "can I get Ben's number?");
    expect(b.w.logged("abuse").map(l => l.detail.kinds)).toEqual([["contact_extraction"], ["contact_extraction"]]);
    expect(b.net.trust.get("cara").score).toBeGreaterThan(0);
  }, T);
});

describe("reading relay texts", () => {
  test("swap requests, running late, reschedules, again and explicit relays", () => {
    for (const t of ["can I get her number?", "what's his number", "could we swap numbers", "can I have Sam's digits?"]) expect([t, contactIntentOf(t)]).toEqual([t, "ask"]);
    for (const t of ["send them my number", "share my number with Sam", "she can have my number"]) expect([t, contactIntentOf(t)]).toEqual([t, "give"]);
    for (const t of ["what's the venue's number?", "my number is in the app", "I lost my phone"]) expect([t, contactIntentOf(t)]).toEqual([t, undefined]);
    expect([contactNameOf("can I get Cara's number?"), contactNameOf("can I get her number?"), contactNameOf("send Sam my number")]).toEqual(["cara", undefined, "sam"]);
    for (const t of ["running 10 min late", "be there in 5", "omw!", "stuck on the train, sorry"]) expect([t, isRunningLate(t)]).toEqual([t, true]);
    for (const t of ["I'm late to the party on this show lol", "see you at 7"]) expect([t, isRunningLate(t)]).toEqual([t, false]);
    for (const t of ["can we move it to friday?", "can't make it tonight, next week instead?", "could we reschedule", "rain check?"]) expect([t, isReschedule(t)]).toEqual([t, true]);
    for (const t of ["can I have the dumplings instead?", "see you friday!", "Can't this week, maybe another time."]) expect([t, isReschedule(t)]).toEqual([t, false]);
    for (const t of ["yes!", "I'd see him again", "definitely, a second date for sure"]) expect([t, againOf(t)]).toEqual([t, true]);
    for (const t of ["no", "it was nice but I wouldn't see him again", "not again"]) expect([t, againOf(t)]).toEqual([t, false]);
    // The engine relay policy's rules run too: a stated minor age, harassment, rating talk.
    expect(relayCheck("lol I'm 16 actually")).toContain("rules:minor_signal");
    expect(relayCheck("send me nudes first")).toContain("rules:harass:sexual");
    expect(relayCheck("what's my rating on this app?")).toContain("rules:rating:probe");
    const ben = [{ id: "ben", first: "Ben" }];
    expect(explicitRelayOf("tell Ben that I'm running late", ben)).toEqual({ to: "ben", text: "I'm running late" });
    expect(explicitRelayOf("let ben know I'm by the door", ben)).toEqual({ to: "ben", text: "I'm by the door" });
    expect(explicitRelayOf("Ben: see you soon", ben)).toEqual({ to: "ben", text: "see you soon" });
    expect(explicitRelayOf("Benjamin Franklin was cool", ben)).toBeUndefined();
  });
});

describe("scam and off-platform check (evals/safety/scam.jsonl)", () => {
  test("recall >= 0.85 and false positives <= 0.05 on the labelled relay corpus", async () => {
    const rows = (await Bun.file(new URL("../../../evals/safety/scam.jsonl", import.meta.url).pathname).text()).trim().split("\n").map(l => JSON.parse(l) as { text: string; label: string });
    expect(rows.length).toBeGreaterThanOrEqual(60);
    const pos = rows.filter(r => r.label !== "benign"), neg = rows.filter(r => r.label === "benign");
    const missed = pos.filter(r => !relayCheck(r.text).length).map(r => r.text);
    const flagged = neg.filter(r => relayCheck(r.text).length).map(r => r.text);
    const recall = 1 - missed.length / pos.length, fp = flagged.length / neg.length;
    console.log(`relay scam check: recall ${recall.toFixed(3)} (${pos.length - missed.length}/${pos.length}), false positives ${fp.toFixed(3)} (${flagged.length}/${neg.length})`);
    expect(recall).toBeGreaterThanOrEqual(0.85);
    expect(fp).toBeLessThanOrEqual(0.05);
  });
});

// ------------------------------------------------------------------------------ Postgres (migration 0013)
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = "network_test_relay";
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) {
  const sql = new SQL({ url: `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`, max: 1 });
  try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); }
}
afterAll(async () => { if (pgAvailable) await admin(`drop database if exists ${DB} with (force)`).catch(() => {}); });

describe.skipIf(!pgAvailable)("relay tables (Postgres)", () => {
  test("0013 applies; PgStore writes threads, the log (text only while held) and swaps; rows are per app", async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    const r = await migrate(URL_, { lockTimeout: "5s" });
    expect(r.applied).toContain("0013_relay");
    expect((await migrate(URL_)).applied).toEqual([]);
    const { w, net } = await booked();
    await say(net, w, "ana", "Hey! Looking forward to Wednesday");
    await say(net, w, "ana", "can I get his number?");
    await say(net, w, "ben", "venmo me $30 for the tickets ok?");
    const sql = new SQL({ url: URL_, max: 4 });
    try {
      const store = new PgStore(sql, "slop:nyc");
      await store.save(net.exportState());
      // Saved twice: upserts, no duplicates.
      await store.save(net.exportState());
      const threads = await sql`select app_id, opportunity_id, members, closed_at from network.relay_threads`;
      expect(threads.map((x: any) => [x.app_id, x.members])).toEqual([["slop", ["ana", "ben"]]]);
      const log = await sql`select from_member, status, body, body_hash, from_name from network.relay_log order by at, id`;
      expect(log.map((x: any) => [x.from_member, x.status, x.body !== null])).toEqual([["ana", "sent", false], ["ben", "held", true]]);
      expect(log.every((x: any) => /^[0-9a-f]{32}$/.test(x.body_hash))).toBe(true);
      const shares = await sql`select requester, target, status from network.contact_shares`;
      expect(shares.map((x: any) => ({ ...x }))).toEqual([{ requester: "ana", target: "ben", status: "asked" }]);
      // A staff decision drops the text from the row on the next save.
      expect(net.rejectRelay(net.relayHeld()[0]!.id, "staff@example.com")).toEqual({ ok: true });
      await store.save(net.exportState());
      expect((await sql`select count(*)::int as n from network.relay_log where body is not null`)[0].n).toBe(0);
      // A sent row can never carry text (check constraint), and the service role sees only its app.
      expect(await sql`update network.relay_log set body = 'x' where status = 'sent'`.then(() => "ok", e => String(e.message))).toContain("check");
      const seen = await sql.begin(async tx => {
        await tx`set local role network_service`;
        await tx`select set_config('app.app_id', 'ntwrk', true)`;
        return (await tx`select count(*)::int as n from network.relay_threads`)[0].n;
      });
      expect(seen).toBe(0);
    } finally { await sql.close(); }
  }, T);
});
