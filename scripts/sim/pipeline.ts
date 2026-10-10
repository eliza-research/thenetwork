// The pipeline block: the real message path end to end (mvp-plan "Still missing in sim"; critical path
// 3 and 9). A signed Blooio webhook goes into NetworkService.fetch, the service runs the four networks
// (ntwrk, slop, peon, friends) on a throwaway Postgres database on the dev cluster (:54339), every send
// goes into the persisted queue (platform.outbound) in the unit's transaction, and the Blooio adapter
// delivers it to a fake provider that records every request (harness.ts). The clock is simulated.
// Scripted members join by keyword, onboard, ask for a climbing partner, are reviewed by a person
// through the staff API, probed and booked. Around that: duplicate webhooks, two messages of one
// sender handled in order, a provider outage with retries, STOP in the middle of a probe, a crash during
// a provider call and a restart (a second service instance), quiet hours across the restart, the
// unanswered streak, line safety, "leave <app>", STOP on the shared line, and the one STOP/HELP
// owner. No model is called; nothing leaves the machine.
//
// Without Postgres the block records one tracked gate saying it was skipped (CI fails on that skip).
// Blocking gates: 0 lost or duplicated outbound messages; 0 sends after STOP; 0 sends to minors about
// other members (and nothing stored for an under-13); every outbound row ends delivered or failed;
// keyword routing; restart, crash, outage, dedupe, ordering, Apple line safety and the STOP/HELP owner.
import { SQL } from "bun";
import { DAY, HOUR, MINUTE, SimClock } from "../../packages/core/src/index.ts";
import { NOT_SENT, OutboundQueue, WAITING } from "../../packages/blooio/src/outbound-queue.ts";
import { BlooioAdapter, liveSendAllowed } from "../../packages/network/service/channel.ts";
import type { NetworkService } from "../../packages/network/service/service.ts";
import { Block, expect } from "./gate.ts";
import * as H from "./pipeline/harness.ts";

const phone = (n: number) => `+1212555${String(100 + n).padStart(4, "0")}`;
const P = { ana: phone(1), ben: phone(2), cy: phone(3), dee: phone(4), eli: phone(5), fay: phone(6), gus: phone(7), hal: phone(8), ivy: phone(9), jo: phone(10) };
const DELIVERED = new Set(["delivered", "read"]);
/** 13:00 New York plus `h` hours on the first day (EDT is UTC-4). */
const nyAt = (day: number, h: number, m = 0) => H.START + day * DAY + (h - 13) * HOUR + m * MINUTE;

interface World {
  url: string; sql: SQL; clock: SimClock; fake: H.FakeBlooio; svc: NetworkService; log: string[];
  /** STOP and START times per phone, from what the scripted members did. */
  stops: { phone: string; at: number; until?: number }[];
  notes: Record<string, unknown>;
}

export async function pipelineBlock(b: Block): Promise<void> {
  await b.run("pipeline: dry run stays the default: no live flag in this process, a real provider never gets a bypass of the flags", () => {
    const clock = new SimClock(H.START);
    const real = { kind: "blooio" as const, send: async () => { throw new Error("must not be called"); } };
    expect(liveSendAllowed(process.env, "slop")).toBe(false);
    expect(new BlooioAdapter({ provider: real, clock, from: H.LINE, app: "slop" }).live).toBe(false);
    expect(() => new BlooioAdapter({ provider: real, clock, from: H.LINE, app: "slop", liveGate: () => true })).toThrow();
    expect(new BlooioAdapter({ provider: new H.FakeBlooio(clock), clock, from: H.LINE, app: "slop" }).live).toBe(false);
  });
  if (!H.pgInstalled()) {
    b.track("pipeline: skipped, no Postgres installed (the dev cluster on :54339 is needed)", false, "install postgresql@16 and run bun run sim --only pipeline");
    return;
  }
  let url: string;
  try { url = await H.throwawayDb(); } catch (e) {
    b.track("pipeline: skipped, the dev Postgres on :54339 did not start", false, (e as Error).message);
    return;
  }
  const sql = new SQL({ url, max: 4 });
  const clock = new SimClock(H.START);
  const fake = new H.FakeBlooio(clock);
  const log: string[] = [];
  const w: World = { url, sql, clock, fake, svc: H.pipelineService(url, clock, fake, "sim-a", {}, s => log.push(s)), log, stops: [], notes: {} };
  try {
    await script(w);
    await gates(b, w);
    await lineCaps(b, w);
  } finally {
    await w.svc.close().catch(() => {});
    await sql.close();
    await H.dropDb(url);
  }
}

async function say(w: World, from: string, text: string, svc = w.svc) {
  const r = await H.post(svc, H.signedRequest(w.clock, H.messageBody(w.clock, from, text)));
  w.clock.advance(MINUTE);
  await H.receipts(svc, w.clock, w.fake);
  return r.result;
}
const memberOf = async (w: World, app: string, p: string) => { const rt = w.svc.runtimeFor(app as never)!; await rt.identities(); return rt.memberOf(p); };
/** A Network text the member did not ask for (an info message), through the runtime's own unit and send path. */
async function info(w: World, app: string, p: string, id: string, text: string, media?: string[]) {
  const rt = w.svc.runtimeFor(app as never)!;
  const m = await memberOf(w, app, p);
  if (!m) throw new Error(`no ${app} member for ${p}`);
  await rt.unitOfWork(() => rt.system(m, id, text, "transactional", "info", media));
  await H.receipts(w.svc, w.clock, w.fake);
}
const outRow = async (w: World, id: string) => (await w.sql`select * from platform.outbound where id = ${id}`)[0] as any;

const debug = process.env.PIPELINE_DEBUG ? (s: string) => console.log(`    [pipeline ${new Date().toISOString().slice(11, 19)}] ${s}`) : () => {};

async function script(w: World) {
  const { clock, fake } = w;
  await w.svc.start();
  const results: Record<string, string[]> = {};
  const join = async (key: string, p: string, ...texts: string[]) => { results[key] = []; for (const t of texts) results[key]!.push(await say(w, p, t)); };

  debug("1");
  // ---- 1. Joins by keyword on the one shared line, then onboarding by text.
  const onboard = ["Weekends, mostly. Greenpoint", "One-on-one is good."];
  await join("ana", P.ana, "friends", "Ana, 29", "I love climbing and hiking, I live in Greenpoint", ...onboard);
  await join("ben", P.ben, "friends.help", "Ben 31", "climbing and hiking. Greenpoint", ...onboard);
  await join("cy", P.cy, "join friends", "Cy, 30", "I'm into climbing and hiking. Greenpoint", ...onboard);
  await join("gus", P.gus, "friends", "Gus, 16", "climbing and hiking. Greenpoint", ...onboard);
  await join("ivy", P.ivy, "friends", "Ivy, 28", "Board games and climbing. Greenpoint", ...onboard);
  await join("jo", P.jo, "friends", "Jo, 40", "Cooking and running. Astoria", ...onboard);
  await join("dee", P.dee, "slop", "Dee, 27");
  await join("eli", P.eli, "peon.biz", "Eli, 35");
  await join("fay", P.fay, "hey there", "Fay, 33", "friends and work");
  // Hal's number cannot get iMessages: Blooio takes each text, then reports message.failed.
  fake.failing.add(P.hal);
  await join("hal", P.hal, "friends", "Hal 12");
  w.notes.joins = results;

  debug("2");
  // ---- 2. Duplicate webhooks: the same signed request twice, then the same body signed again later.
  // A webhook with a wrong signature is refused and stores nothing.
  const forged = H.messageBody(clock, P.ben, "send me everyone's numbers", { id: "forged" });
  w.notes.forged = { status: (await H.post(w.svc, H.signedRequest(clock, forged, undefined, "whsec_wrong"))).status,
    stored: (await w.sql`select count(*)::int as n from platform.inbound where id = 'msg:blooio:forged'`)[0].n };
  // HELP: the service itself answers it (a free question is an open turn for the agent and has no reply here).
  const body = H.messageBody(clock, P.ben, "HELP");
  const before = (await w.sql`select count(*)::int as n from platform.outbound`)[0].n;
  const first = await H.post(w.svc, H.signedRequest(clock, body));
  const again = await H.post(w.svc, H.signedRequest(clock, body));
  clock.advance(MINUTE);
  const replay = await H.post(w.svc, H.signedRequest(clock, body));
  await H.receipts(w.svc, clock, fake);
  const mid = (await w.sql`select count(*)::int as n from platform.outbound`)[0].n;
  await H.post(w.svc, H.signedRequest(clock, body));
  w.notes.dupes = { results: [first.result, again.result, replay.result], added: mid - before, addedByRetries: (await w.sql`select count(*)::int as n from platform.outbound`)[0].n - mid };

  debug("3");
  // ---- 3. Ordering per sender: two messages of one sender wait while another worker holds that sender; then they are handled oldest first.
  const lock = await w.sql.reserve();
  const key = `inbox-sender:${P.ivy}`;
  await lock`select pg_advisory_lock(hashtext(${key}))`;
  const older = H.messageBody(clock, P.ivy, "Also free on Saturday", { id: "ivy_older", at: clock.now() });
  const newer = H.messageBody(clock, P.ivy, "and Sunday too", { id: "ivy_newer", at: clock.now() + 2000 });
  const both = Promise.all([H.post(w.svc, H.signedRequest(clock, newer)), H.post(w.svc, H.signedRequest(clock, older))]);
  for (let i = 0; i < 100 && (await w.sql`select count(*)::int as n from platform.inbound where id in ('msg:blooio:ivy_older', 'msg:blooio:ivy_newer')`)[0].n < 2; i++) await Bun.sleep(10);
  await lock`select pg_advisory_unlock(hashtext(${key}))`;
  lock.release();
  await both;
  clock.advance(MINUTE);
  await H.receipts(w.svc, clock, fake);
  w.notes.order = (await w.sql`select id from platform.inbound where id in ('msg:blooio:ivy_older', 'msg:blooio:ivy_newer') order by handled_order`).map((r: any) => r.id);

  debug("4");
  // ---- 4. A request, a person reviews it through the staff API, the probe, the yes, the booked plan.
  w.notes.matching = (await H.staff(w.svc, H.ADMIN, "POST", "/apps/friends/matching", { on: true })).status;
  await say(w, P.ana, "Anyone around who'd want to find a regular climbing partner? I'm near Greenpoint.");
  const queue = await (await H.staff(w.svc, H.REVIEWER, "GET", "/apps/friends/review")).json();
  const item = queue.items?.[0];
  w.notes.reviewItem = !!item;
  w.notes.reviewedBeforeContact = item ? (await w.sql`select count(*)::int as n from network.messages where opportunity_id = ${item.oppId}`)[0].n : -1;
  if (item) {
    w.notes.approve = (await (await H.staff(w.svc, H.REVIEWER, "POST", `/apps/friends/review/${item.oppId}`, { decision: "approve", secondsSpent: 30 })).json()).ok;
    await H.run(w.svc, clock, fake, 30 * MINUTE);
    await say(w, P.ana, "Either works");
    await H.run(w.svc, clock, fake, 30 * MINUTE);
    const probed = Object.entries(P).find(([, p]) => fake.to(p).some(d => /Would you be up for it\?/.test(d.text)))?.[1];
    w.notes.probed = probed;
    if (probed) await say(w, probed, "Yes");
    await H.run(w.svc, clock, fake, 60 * MINUTE);
    w.notes.booked = (await w.sql`select count(*)::int as n from network.opportunities where app_id = 'friends' and id = ${item.oppId} and state = 'SCHEDULED'`)[0].n;
  }

  debug("5");
  // ---- 5. A provider outage: Blooio answers 503 for 20 minutes; the Network's text waits and goes once after it.
  fake.downUntil = clock.now() + 20 * MINUTE;
  await info(w, "friends", P.cy, "sim:outage", "Climbing gyms rent shoes; bring water and comfortable clothes.");
  await H.run(w.svc, clock, fake, 40 * MINUTE);
  w.notes.outage = { ...(await outRow(w, "sim:outage")) };

  debug("6");
  // ---- 6. Line safety: Blooio puts the line on reply_only; an agent-started message waits; a reply still goes; then it clears.
  await H.post(w.svc, H.signedRequest(clock, H.safetyBody(clock, "reply_only")));
  await info(w, "friends", P.ana, "sim:safety:info", "Climbing gyms in Greenpoint run free intro nights on Thursdays.");
  const held = (await outRow(w, "sim:safety:info")).status;
  await say(w, P.ana, "cool, thanks");
  await H.post(w.svc, H.signedRequest(clock, H.safetyBody(clock, "none")));
  await H.run(w.svc, clock, fake, 70 * MINUTE, 10 * MINUTE);
  w.notes.lineSafety = { held, after: (await outRow(w, "sim:safety:info")).status };

  debug("7");
  // An attachment (a photo link) goes to the provider with the text.
  await info(w, "slop", P.dee, "sim:photo", "Here is the venue for Friday.", ["https://media.blooio.com/sim/venue.jpg"]);

  // ---- 7. Apple line safety: Eli never answers; the 4th message in a row waits until he writes.
  for (let i = 1; i <= 4; i++) { await info(w, "peon", P.eli, `sim:streak:${i}`, `peon.biz update ${i}: a new list of NYC hiring events is up.`); clock.advance(MINUTE); }
  const streak = await Promise.all([1, 2, 3, 4].map(async i => (await outRow(w, `sim:streak:${i}`)).status));
  await say(w, P.eli, "ok thanks");
  await H.run(w.svc, clock, fake, 10 * MINUTE);
  w.notes.streak = { before: streak, after: (await outRow(w, "sim:streak:4")).status };

  debug("8");
  // ---- 8. Night. Quiet hours hold two Network texts (Dee on slop, and the person who will stop) across a restart.
  clock.set(nyAt(0, 21, 30));
  await info(w, "slop", P.dee, "sim:night:dee", "Tomorrow: three slop.date events in Brooklyn this week.");
  const stopper = (w.notes.probed as string | undefined) ?? P.ben;
  const stopApp = "friends";
  await info(w, stopApp, stopper, "sim:night:stopper", "Tomorrow: a climbing meetup in Greenpoint.");
  w.notes.night = { dee: (await outRow(w, "sim:night:dee")).status, stopper: (await outRow(w, "sim:night:stopper")).status };

  debug("9");
  // ---- 9. STOP in the middle of a thread (the probed member, booked or not): every app stops; the confirmation goes.
  await say(w, stopper, "STOP");
  w.stops.push({ phone: stopper, at: clock.now() - MINUTE });

  debug("10");
  // ---- 10. A crash during a provider call: Blooio takes the answer to Ivy's HELP, the worker dies before it records it.
  let crashed!: () => void;
  const died = new Promise<void>(r => (crashed = r));
  fake.crashOnNext(() => crashed());
  const inFlight = H.post(w.svc, H.signedRequest(clock, H.messageBody(clock, P.ivy, "HELP")));
  await Promise.race([died, inFlight]);
  fake.crashOnNext(undefined);
  await w.sql`select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'network-service:sim-a' and datname = current_database()`;
  w.notes.crashRow = (await w.sql`select id, status, in_doubt from platform.outbound where status = 'sending'`).map((r: any) => ({ ...r }));
  // The restart: a new process (instance sim-b) on the same database, the next morning, when the
  // quiet-hours rows are due: the state must load before they are checked (audit network-service-2).
  clock.set(nyAt(1, 9, 5));
  w.svc = H.pipelineService(w.url, clock, fake, "sim-b", {}, s => w.log.push(s));
  await w.svc.start();
  await H.run(w.svc, clock, fake, 30 * MINUTE);

  debug("11");
  // ---- 11. "leave friends.help" leaves one app; then STOP on the shared line stops every app.
  results.fayLeave = [await say(w, P.fay, "leave friends.help")];
  await info(w, "ntwrk", P.fay, "sim:fay:before", "The Network: two new members near you this week.");
  await say(w, P.fay, "STOP");
  w.stops.push({ phone: P.fay, at: clock.now() - MINUTE });
  await info(w, "peon", P.fay, "sim:fay:peon2", "peon.biz: one more hiring event.");
  await info(w, "ntwrk", P.fay, "sim:fay:ntwrk", "The Network: a new member near you.");
  await H.run(w.svc, clock, fake, 20 * MINUTE);

  debug("12");
  // ---- 12. One STOP/HELP owner: this service answers HELP and STOP on the line, and STOP stops every app.
  // (The Eliza gateway path is the signed turn: packages/network/test/eliza-takeover.integration.test.ts.)
  const help = await say(w, P.jo, "HELP");
  const stop = await say(w, P.jo, "STOP");
  w.stops.push({ phone: P.jo, at: clock.now() - MINUTE });
  await info(w, "friends", P.jo, "sim:jo:stopped", "friends.help: a running group in Astoria.");
  await H.receipts(w.svc, clock, fake);
  w.notes.keywords = { help, stop, stopped: (await outRow(w, "sim:jo:stopped")).status };

  debug("13");
  // ---- 13. Four quiet days: every held, deferred or waiting row ends (sent, or expired past its time).
  await H.run(w.svc, clock, fake, 4 * DAY, HOUR);
  await H.receipts(w.svc, clock, fake);
  void inFlight;
}

async function gates(b: Block, w: World) {
  const { sql, fake, notes } = w;
  const rows = (await sql`select * from platform.outbound order by created_at, id`) as any[];
  const byId = new Map(rows.map(r => [r.id, r]));
  const deliveries = [...fake.delivered.values()];
  const rowOf = (key: string) => byId.get(key.replace(/^tn:/, ""));
  const memberships = async (p: string) => (await sql`select m.app_id from platform.memberships m join platform.phone_identities pi on pi.person_id = m.person_id
    where pi.e164 = ${p} and m.state not in ('removed', 'invited') order by m.app_id`).map((r: any) => r.app_id as string);

  b.track("pipeline: messages", true, `${rows.length} outbound rows, ${deliveries.length} delivered by the fake provider, ${fake.calls.length} provider calls, ${(await sql`select count(*)::int as n from platform.inbound`)[0].n} inbound rows`);

  await b.run("pipeline: keyword routing on the shared line (slop, peon.biz, friends, no keyword -> The Network and the apps asked for, leave one app)", async () => {
    expect(await memberships(P.ana)).toEqual(["friends"]);
    expect(await memberships(P.ben)).toEqual(["friends"]);
    expect(await memberships(P.cy)).toEqual(["friends"]);
    expect(await memberships(P.dee)).toEqual(["slop"]);
    expect(await memberships(P.eli)).toEqual(["peon"]);
    // Fay: no keyword joined The Network; "friends and work" enrolled friends and peon; "leave friends.help" left friends only.
    expect((notes.joins as any).fay).toEqual(["join_asked", "joined", "handled"]);
    expect(await memberships(P.fay)).toEqual(["ntwrk", "peon"]);
    expect((notes.joins as any).ana.slice(0, 2)).toEqual(["join_asked", "joined"]);
    // A forged webhook (wrong secret) is refused before anything is stored.
    expect(notes.forged).toEqual({ status: 401, stored: 0 });
  });

  await b.run("pipeline: 0 lost outbound messages (every row the provider took is one delivered row, every delivered row was taken once, network.messages agrees)", async () => {
    for (const d of deliveries) {
      const r = rowOf(d.key);
      expect([d.key, !!r]).toEqual([d.key, true]);
      expect([d.key, DELIVERED.has(r.status) || r.status === "failed"]).toEqual([d.key, true]);
    }
    for (const r of rows.filter(r => DELIVERED.has(r.status))) expect([r.id, fake.delivered.has(`tn:${r.id}`)]).toEqual([r.id, true]);
    const stale = await sql`select m.id, m.status, o.status as queue from network.messages m join platform.outbound o on o.id = m.id
      where m.direction = 'outbound' and m.status <> o.status`;
    expect(stale.map((r: any) => `${r.id}:${r.status}/${r.queue}`)).toEqual([]);
    expect((await sql`select count(*)::int as n from network.messages where direction = 'outbound' and status = 'queued'`)[0].n).toBe(0);
  });

  await b.run("pipeline: 0 duplicated outbound messages (one provider message per key; no text twice to a phone within a minute; webhook retries add nothing)", async () => {
    const seen = new Map<string, number>();
    const dupes: string[] = [];
    for (const d of deliveries.sort((a, b) => a.at - b.at)) {
      const k = `${d.to}|${d.text}`;
      const last = seen.get(k);
      if (last !== undefined && d.at - last < MINUTE) dupes.push(d.key);
      seen.set(k, d.at);
    }
    expect(dupes).toEqual([]);
    expect(fake.calls.filter(c => c.outcome === "delivered").length).toBe(fake.delivered.size);
    expect(notes.dupes).toMatchObject({ results: ["handled", "duplicate", "duplicate"], added: 1, addedByRetries: 0 });
  });

  await b.run("pipeline: every outbound row ends delivered or failed (no row waits, sends or sits accepted without a receipt)", () => {
    const open = rows.filter(r => WAITING.includes(r.status) || r.status === "accepted" || r.status === "sent");
    expect(open.map(r => `${r.id}:${r.status}`)).toEqual([]);
    const other = rows.filter(r => !DELIVERED.has(r.status) && !NOT_SENT.test(r.status));
    expect(other.map(r => `${r.id}:${r.status}`)).toEqual([]);
    expect(rows.filter(r => DELIVERED.has(r.status)).length).toBeGreaterThan(40);
    // No member text here carries a private fact: nothing is parked (the Network's own copy names the app domains, which the guard allows).
    expect(rows.filter(r => r.status.startsWith("parked")).map(r => `${r.id}:${r.status}`)).toEqual([]);
    // Blooio's failure receipts end rows as failed, with the error recorded (Hal's number takes no iMessage).
    const failed = fake.to(P.hal).map(d => rowOf(d.key));
    expect(failed.map(r => [r?.status, !!r?.last_error])).toEqual([["failed", true], ["failed", true]]);
    // The attachment reached the provider with its text.
    expect(fake.delivered.get("tn:sim:photo")?.media).toEqual(["https://media.blooio.com/sim/venue.jpg"]);
    // A row to someone who is not a member keeps no address and no text once it ends.
    expect(rows.filter(r => r.member_id === null && (r.to_address !== null || r.body !== null)).map(r => r.id)).toEqual([]);
  });

  await b.run("pipeline: 0 sends after STOP (only the STOP confirmation, until START)", () => {
    const bad: string[] = [];
    for (const s of w.stops) for (const d of fake.to(s.phone)) {
      if (d.at <= s.at || (s.until !== undefined && d.at >= s.until)) continue;
      if (rowOf(d.key)?.kind !== "compliance") bad.push(`${s.phone}:${d.key}`);
    }
    expect(bad).toEqual([]);
    expect(w.stops.length).toBe(3);
    // The text that waited for the morning was refused after the STOP; the stopped app sends were refused.
    expect(byId.get("sim:night:stopper")?.status).toBe("refused_opted_out");
    expect(byId.get("sim:fay:before")?.status).toBe("delivered");
    expect([byId.get("sim:fay:peon2")?.status, byId.get("sim:fay:ntwrk")?.status]).toEqual(["refused_opted_out", "refused_opted_out"]);
  });

  await b.run("pipeline: 0 sends to minors about other members; nothing stored for an under-13 (only the join question and the decline)", async () => {
    const gus = await sql`select id from network.members where app_id = 'friends' and age < 18`;
    expect(gus.length).toBe(1);
    const gusId = (gus[0] as any).id;
    expect(fake.to(P.gus).filter(d => rowOf(d.key)?.opportunity_id).map(d => d.key)).toEqual([]);
    expect((await sql`select count(*)::int as n from network.participations where member_id = ${gusId}`)[0].n).toBe(0);
    expect((await sql`select count(*)::int as n from network.messages where member_id = ${gusId} and type in ('probe', 'proposal', 'scheduling', 'plan_probe')`)[0].n).toBe(0);
    expect((await sql`select count(*)::int as n from platform.phone_identities where e164 = ${P.hal}`)[0].n).toBe(0);
    expect(fake.to(P.hal).length).toBe(2);
    expect((notes.joins as any).hal).toEqual(["join_asked", "under_age"]);
  });

  await b.run("pipeline: a person reviews the request before anyone hears of it; then the probe, the yes and the booked plan", () => {
    expect(notes.matching).toBe(200);
    expect(notes.reviewItem).toBe(true);
    expect(notes.reviewedBeforeContact).toBe(0);
    expect(notes.approve).toBe(true);
    expect(typeof notes.probed).toBe("string");
    expect(notes.booked).toBe(1);
  });

  await b.run("pipeline: crash during a provider call: the restart sends the row again with the same key; the person gets it once", () => {
    const sending = notes.crashRow as { id: string; status: string }[];
    expect(sending.length).toBe(1);
    const r = byId.get(sending[0]!.id);
    expect([r.status, r.in_doubt]).toEqual(["delivered", true]);
    const calls = fake.calls.filter(c => c.req.idempotencyKey === `tn:${r.id}`).map(c => c.outcome);
    expect(calls).toEqual(["delivered", "replayed"]);
  });

  await b.run("pipeline: restart keeps waiting rows: a quiet-hours row from before the restart goes in the morning (audit network-service-2)", () => {
    expect(notes.night).toEqual({ dee: "deferred_quiet_hours", stopper: "deferred_quiet_hours" });
    const r = byId.get("sim:night:dee");
    expect(r.status).toBe("delivered");
    expect(new Date(r.sent_at).getTime()).toBeGreaterThanOrEqual(nyAt(1, 9));
  });

  await b.run("pipeline: provider outage: the text backs off, retries and goes once after Blooio is back", () => {
    const o = notes.outage as { id: string; status: string; attempts: number };
    expect(o.status).toBe("delivered");
    expect(o.attempts).toBeGreaterThanOrEqual(3);
    expect(fake.calls.filter(c => c.req.idempotencyKey === `tn:${o.id}`).map(c => c.outcome).filter(x => x === "delivered").length).toBe(1);
  });

  await b.run("pipeline: inbound order per sender: two waiting messages are handled oldest first", () => {
    expect(notes.order).toEqual(["msg:blooio:ivy_older", "msg:blooio:ivy_newer"]);
  });

  await b.run("pipeline: Apple line safety: the 4th unanswered message waits for the person; Blooio's reply_only holds agent-started texts", () => {
    const { before, after } = notes.streak as { before: string[]; after: string };
    // Eli's welcome (a reply) already counts as one unanswered message: two of the four go, the others wait for him.
    expect(before).toEqual(["delivered", "delivered", "held_awaiting_reply", "held_awaiting_reply"]);
    expect(after).toBe("delivered");
    expect(notes.lineSafety).toEqual({ held: "retry_scheduled", after: "delivered" });
  });

  await b.run("pipeline: one STOP/HELP owner: the service answers HELP and STOP on the line, and nothing goes out after STOP", () => {
    expect(notes.keywords).toMatchObject({ help: "handled", stop: "handled", stopped: "refused_opted_out" });
  });
}

/**
 * The per-line daily caps (Apple line safety; the limits come from prototype P3, BLOOIO_LINE_DAILY_CAP and
 * BLOOIO_LINE_NEW_CHATS_PER_DAY). A second line on the same database with small caps (3 agent-started texts
 * a day, 2 new conversations a day) and a provider fake of its own: the third new conversation and the
 * fourth agent-started text wait, a compliance text still goes, and the next day both waiting rows go once.
 */
async function lineCaps(b: Block, w: World) {
  const line = "+12125550199";
  const to = [phone(11), phone(12), phone(13), phone(14)];
  const fake = new H.FakeBlooio(w.clock, "sim_caps");
  w.clock.set(nyAt(7, 12));
  const q = new OutboundQueue({ sql: w.sql, clock: w.clock, provider: fake, line, app: "friends", instance: "sim-caps",
    checks: { live: () => true }, perLinePerDay: 3, newChatsPerLinePerDay: 2, baseBackoffMs: 30_000 });
  // Transactional texts (3-day lifetime): a proactive text that waits a full day for the cap expires instead (24 h).
  const put = (id: string, p: string, kind: "transactional" | "compliance" = "transactional") =>
    w.sql.begin(tx => q.enqueue(tx as never, [{ id, to: p, kind, text: `friends.help: note ${id}`, timeZone: "America/New_York" }]));
  const status = async (ids: string[]): Promise<string[]> => (await w.sql`select id, status, note from platform.outbound where id in ${w.sql(ids)} order by id`)
    .map((r: any) => `${r.id}:${r.status}${WAITING.includes(r.status) && r.note ? `(${r.note})` : ""}`);
  const ids = ["cap:new:1", "cap:new:2", "cap:new:3", "cap:old:1", "cap:old:2", "cap:stop:4"];
  for (const [i, id] of ids.slice(0, 3).entries()) await put(id, to[i]!);
  await q.drain();
  await put("cap:old:1", to[0]!);
  await put("cap:old:2", to[1]!);
  await q.drain();
  await put("cap:stop:4", to[3]!, "compliance");
  await q.drain();
  const day1 = await status(ids);
  w.clock.advance(DAY + HOUR);
  await q.drain();
  const day2 = await status(ids);
  const sent: [string, boolean][] = (await w.sql`select id, sent_at from platform.outbound where id in ${w.sql(ids)} order by id`).map((r: any) => [r.id, new Date(r.sent_at).getTime() >= nyAt(8, 12)]);
  await b.run("pipeline: per-line daily caps: the 3rd new conversation and the 4th agent-started text of the day wait; compliance goes; the next day each waiting text goes once", () => {
    expect(day1).toEqual(["cap:new:1:accepted", "cap:new:2:accepted", "cap:new:3:retry_scheduled(per-line new conversation cap)",
      "cap:old:1:accepted", "cap:old:2:retry_scheduled(per-line daily cap)", "cap:stop:4:accepted"]);
    expect(day2.filter(s => !s.endsWith(":accepted"))).toEqual([]);
    expect(sent.filter(([, late]) => late).map(([id]) => id)).toEqual(["cap:new:3", "cap:old:2"]);
    expect(fake.calls.filter(c => c.outcome === "delivered").length).toBe(6);
    expect(fake.delivered.size).toBe(6);
  });
}
