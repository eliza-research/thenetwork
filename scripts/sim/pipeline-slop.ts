// The slop world on the real message path (mvp-gaps section 4.1): 30 simulated days of slop.date
// through a signed /webhooks/blooio into NetworkService, the persisted outbound queue
// (platform.outbound) and the Blooio adapter out to a fake provider that records every request, on a
// throwaway Postgres database on the dev cluster (:54339). The clock is SimClock (the production
// RealClock swapped out); nothing leaves the machine.
//
// Daters join by texting "slop" and "Name, age", answer the onboarding questions in their own words,
// are matched behind a human review queue (the reviewer approves every item at the next tick), probe
// each other and book Saturday dates. Around the world: the person cap (across apps), quiet hours, a
// STOP in the middle of a probe, "leave slop" in the middle of a scheduled match, a ban in the middle
// of a relay thread (the signed /internal/turn + /internal/relay wire), a restart with a row waiting
// for the morning, and a minor who joins but is never matched.
//
// Blocking gates: 30 days ran; 0 lost or duplicated outbound messages; every outbound row ends in a
// terminal status; every probe had a review approval before it went; no proactive or transactional
// send outside quiet hours; no member above the person cap; 0 sends after STOP except compliance;
// 0 sends after leave except the leave confirmation; a banned member's in-flight relayed text never
// reaches them; no probe, proposal or participation for a minor; the restart's waiting row goes out
// once in the morning.
import { SQL } from "bun";
import { DAY, HOUR, MINUTE, SimClock } from "../../packages/core/src/index.ts";
import { RELAY_PATH, TURN_PATH } from "../../packages/core/src/svc/contract.ts";
import { svcSign } from "../../packages/core/src/svc/svc-auth.ts";
import { NOT_SENT, WAITING } from "../../packages/blooio/src/outbound-queue.ts";
import type { Outbound } from "../../packages/network/service/channel.ts";
import { PERSON_DAILY_CAP, type NetworkService } from "../../packages/network/service/service.ts";
import { Block, expect } from "./gate.ts";
import * as H from "./pipeline/harness.ts";
import { slopQuestion } from "./slop-live.ts";

const phone = (n: number) => `+1212555${String(100 + n).padStart(4, "0")}`;
const DELIVERED = new Set(["delivered", "read"]);

type Person = { p: string; name: string; age: number; gender: string; seeks: string; lo: number; hi: number; zip: string; interests: string };
const PEOPLE: Person[] = [
  { p: phone(1), name: "Ana", age: 29, gender: "woman", seeks: "men", lo: 28, hi: 38, zip: "11211", interests: "Climbing and cooking" },
  { p: phone(2), name: "Ben", age: 31, gender: "man", seeks: "women", lo: 27, hi: 36, zip: "11222", interests: "Running and films" },
  { p: phone(3), name: "Cy", age: 34, gender: "man", seeks: "women", lo: 28, hi: 40, zip: "11249", interests: "Guitar and cooking" },
  { p: phone(4), name: "Dee", age: 27, gender: "woman", seeks: "men", lo: 27, hi: 37, zip: "11211", interests: "Books and yoga" },
  { p: phone(5), name: "Eli", age: 30, gender: "man", seeks: "women", lo: 26, hi: 35, zip: "11215", interests: "Climbing and coffee" },
  { p: phone(6), name: "Fay", age: 33, gender: "woman", seeks: "men", lo: 30, hi: 40, zip: "11222", interests: "Hiking and baking" },
  { p: phone(7), name: "Hal", age: 35, gender: "man", seeks: "women", lo: 29, hi: 41, zip: "11201", interests: "Jazz and cycling" },
  { p: phone(8), name: "Ivy", age: 28, gender: "woman", seeks: "men", lo: 27, hi: 38, zip: "11215", interests: "Board games and climbing" },
  { p: phone(9), name: "Jo", age: 37, gender: "man", seeks: "women", lo: 30, hi: 45, zip: "11101", interests: "Cooking and running" },
  { p: phone(10), name: "Kim", age: 26, gender: "woman", seeks: "men", lo: 25, hi: 35, zip: "11249", interests: "Music and museums" },
  { p: phone(11), name: "Lee", age: 32, gender: "man", seeks: "women", lo: 28, hi: 40, zip: "11205", interests: "Football and films" },
  { p: phone(12), name: "Maxine", age: 39, gender: "woman", seeks: "men", lo: 32, hi: 45, zip: "11217", interests: "Theatre and wine" },
];
const MINOR = "Gus";
const MINOR_PHONE = phone(13);
const MINOR_AGE = 17;

/** What a dater texts back to one of slop's questions, from what they said at the door. */
const ANSWER: Record<string, (x: Person) => string> = {
  slop_age: x => String(x.age),
  slop_orientation: x => `I'm a ${x.gender} looking for ${x.seeks}.`,
  slop_seeks: x => `I'm a ${x.gender} looking for ${x.seeks}.`,
  slop_gender: x => `I'm a ${x.gender}.`,
  slop_age_range: x => `${x.lo}-${x.hi} feels right.`,
  slop_distance: x => `Within 10 miles of ${x.zip}.`,
  slop_location: x => `My zip is ${x.zip}.`,
  slop_zip: x => `My zip is ${x.zip}.`,
  slop_basics: () => "Something long-term, and no smokers.",
  slop_goal: () => "Something long-term.",
  slop_interests: x => x.interests,
  slop_activities: () => "Coffee or a walk.",
  slop_free: () => "Thursday evenings and Saturday afternoons.",
  slop_readback: () => "yep, that's right",
};

interface StopEvent { phone: string; at: number; probeId: string }
interface LeaveEvent { phone: string; memberId: string; oppId: string; at: number }
interface BanEvent { phone: string; memberId: string; oppId: string; at: number; relayId: string }
interface World {
  url: string; sql: SQL; clock: SimClock; fake: H.FakeBlooio; svc: NetworkService; log: string[];
  people: Map<string, Person>; seen: Set<string>; welcomed: Set<string>;
  notes: Record<string, any>;
  plan: { armStop: boolean; stop?: StopEvent; leave?: LeaveEvent; ban?: BanEvent; quiet?: any; cap?: any };
}

export async function pipelineSlopBlock(b: Block): Promise<void> {
  if (!H.pgInstalled()) {
    b.track("pipeline-slop: skipped, no Postgres installed (the dev cluster on :54339 is needed)", false, "install postgresql@16 and run bun run sim --only pipeline-slop");
    return;
  }
  let url: string;
  try { url = await H.throwawayDb(); } catch (e) {
    b.track("pipeline-slop: skipped, the dev Postgres on :54339 did not start", false, (e as Error).message);
    return;
  }
  const sql = new SQL({ url, max: 4 });
  const clock = new SimClock(H.START);
  const fake = new H.FakeBlooio(clock, "slop_sim");
  const log: string[] = [];
  const mk = (instance: string) => H.pipelineService(url, clock, fake, instance, { SERVICE_TURN_SECRET: H.TURN_SECRET }, s => log.push(s));
  const w: World = {
    url, sql, clock, fake, svc: mk("sim-slop-a"), log,
    people: new Map(PEOPLE.map(x => [x.p, x])), seen: new Set(), welcomed: new Set(), notes: {}, plan: { armStop: false },
  };
  try {
    await script(w);
    await gates(b, w);
  } finally {
    await w.svc.close().catch(() => {});
    await sql.close();
    await H.dropDb(url);
  }
}

async function say(w: World, from: string, text: string) {
  const r = await H.post(w.svc, H.signedRequest(w.clock, H.messageBody(w.clock, from, text)));
  w.clock.advance(5 * MINUTE);
  await H.receipts(w.svc, w.clock, w.fake);
  return r.result;
}

/** 09:00-21:00 in New York, whatever the date (EDT or EST). */
function nyHour(at: number): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(new Date(at)));
}

/** Reviewers approve every item at the next tick, as slop-live does (the worst case for the rules). */
async function approve(w: World) {
  const q = await (await H.staff(w.svc, H.REVIEWER, "GET", "/apps/slop/review")).json() as { items?: { kind: string; oppId: string }[] };
  const approved = (w.notes.approved ??= new Map<string, number>()) as Map<string, number>;
  for (const it of q.items ?? []) {
    if (it.kind === "fraud") continue;
    const r = await (await H.staff(w.svc, H.REVIEWER, "POST", `/apps/slop/review/${it.oppId}`, { decision: "approve", secondsSpent: 20 })).json() as { ok?: boolean };
    if (r.ok) approved.set(it.oppId, w.clock.now());
  }
}

/** The world's tick: the service inbox, every runtime, the queue, the fake provider's receipts, review. */
async function pump(w: World, ms: number, step = 30 * MINUTE) {
  for (let t = 0; t < ms; t += step) {
    w.clock.advance(Math.min(step, ms - t));
    await w.svc.inboxTick();
    for (const rt of w.svc.runtimes.values()) await rt.tick();
    await w.svc.purge();
    await H.receipts(w.svc, w.clock, w.fake);
    await approve(w);
    // A stable order across runs: the service's message ids carry random UUIDs, so ordering by id
    // would let a different reply order (and so a different simulated clock) change the world.
    const rows = await w.sql`select m.id, m.body, m.type, m.proactive, pi.e164 from network.messages m
      join network.members mem on mem.id = m.member_id join platform.phone_identities pi on pi.person_id = mem.person_id
      where m.direction = 'outbound' order by pi.e164, m.ts, m.type, m.id` as any[];
    for (const r of rows) {
      if (w.seen.has(r.id)) continue;
      w.seen.add(r.id);
      await respond(w, r);
    }
  }
}

async function respond(w: World, row: { id: string; body: string; type: string; proactive: boolean; e164: string }) {
  const who = w.people.get(row.e164);
  if (!who) return;
  const at = w.clock.now();
  // STOP in the middle of a probe: the probe is already on their phone, and they answer it with STOP.
  if (row.type === "probe" && w.plan.armStop && !w.plan.stop) {
    w.plan.stop = { phone: who.p, at, probeId: row.id };
    await say(w, who.p, "STOP");
    return;
  }
  if (row.type === "onboarding" && !w.welcomed.has(who.p)) {
    w.welcomed.add(who.p);
    await say(w, who.p, `I'm a ${who.gender} looking for ${who.seeks}.`);
    return;
  }
  const reason = slopQuestion(row.body);
  if (reason && ANSWER[reason]) { await say(w, who.p, ANSWER[reason]!(who)); return; }
  if (row.type === "probe") { await say(w, who.p, "Yes, Saturday 2pm works."); return; }
  if (row.type === "feedback_request") { await say(w, who.p, "It went really well, I'd meet them again."); return; }
  if (row.type === "question" && /people up to \d+ miles|not many people match/i.test(row.body)) { await say(w, who.p, "Sure, that's fine."); return; }
  if (row.type === "question" && /what's your week like/i.test(row.body)) { await say(w, who.p, "Thursday evenings and Saturday afternoons."); return; }
  if (row.type === "question") { await say(w, who.p, "Yes, Saturday 2pm works."); return; }
  if (row.type === "scheduling" || row.type === "plan_probe") { await say(w, who.p, "Saturday 2pm"); return; }
}

/** The stored slop state (the engine's own document). */
async function slopState(w: World): Promise<any> {
  const [r] = await w.sql`select state from network.network_state where id = 'slop:nyc'` as any[];
  return typeof r?.state === "string" ? JSON.parse(r.state) : r?.state;
}
async function booked(w: World): Promise<{ id: string; stage: string; participants: string[]; at?: number }[]> {
  const st = await slopState(w);
  return (st?.opps ?? [])
    .filter((o: any) => (o.stage === "scheduled" || o.stage === "done") && o.participants?.length === 2)
    .map((o: any) => ({ id: o.id, stage: o.stage, participants: o.participants, at: o.meetingAt ?? o.createdAt }));
}
async function memberIdOf(w: World, p: string): Promise<string | undefined> {
  const rt = w.svc.runtimeFor("slop")!;
  await rt.identities();
  return rt.memberOf(p);
}
async function phoneOfMember(w: World, id: string): Promise<string | undefined> {
  const rows = await w.sql`select pi.e164 from network.members m join platform.phone_identities pi on pi.person_id = m.person_id where m.app_id = 'slop' and m.id = ${id}` as any[];
  return rows[0]?.e164;
}
async function pumpUntil(w: World, cond: () => Promise<boolean> | boolean, maxMs: number, step = 30 * MINUTE) {
  const until = w.clock.now() + maxMs;
  while (!(await cond()) && w.clock.now() < until) await pump(w, step, step);
}
async function pumpToHour(w: World, hour: number, maxMs = 28 * HOUR) {
  const until = w.clock.now() + maxMs;
  while (nyHour(w.clock.now()) !== hour && w.clock.now() < until) await pump(w, HOUR, HOUR);
}

/** A signed Shared turn (the canonical inbound wire) and the relay request that follows it. */
async function signedPost(w: World, path: string, id: string, body: object) {
  const raw = JSON.stringify(body);
  return w.svc.fetch(new Request(`http://127.0.0.1${path}`, {
    method: "POST", headers: { "content-type": "application/json", ...await svcSign(H.TURN_SECRET, { method: "POST", path, id, body: raw, nowS: Math.floor(w.clock.now() / 1000) }) }, body: raw,
  }));
}
async function relay(w: World, from: string, text: string, n: number) {
  const messageId = `slop_relay_${n}`;
  const memberId = await memberIdOf(w, from);
  const turn = await signedPost(w, TURN_PATH, messageId, { channel: "blooio", from, to: null, messageId, text, receivedAt: w.clock.now(), transport: "imessage", app: "slop" });
  const tb = await turn.json() as any;
  w.clock.advance(MINUTE);
  const res = await signedPost(w, RELAY_PATH, `${messageId}:relay`, { channel: "blooio", messageId, app: "slop", memberId, itemId: null, text });
  const rb = await res.json() as any;
  w.clock.advance(MINUTE);
  await H.receipts(w.svc, w.clock, w.fake);
  return { turn: tb.outcome, status: res.status, decision: rb.decision, notice: rb.senderNotice };
}

async function script(w: World) {
  const { clock, fake } = w;
  await w.svc.start();
  // The operator's console switch: a new stored state starts with matching off (production turns it on
  // in the console; the person cap, quiet hours and review still apply).
  w.notes.matching = (await H.staff(w.svc, H.ADMIN, "POST", "/apps/slop/matching", { on: true })).status;

  // ---- 1. Joins by keyword on the shared line; the onboarding loop answers through the webhook.
  for (const x of PEOPLE) { await say(w, x.p, "slop"); await say(w, x.p, `${x.name}, ${x.age}`); }
  await say(w, MINOR_PHONE, "slop");
  await say(w, MINOR_PHONE, `${MINOR}, ${MINOR_AGE}`);
  await pump(w, 3 * DAY, 30 * MINUTE);
  w.notes.onboarded = (await w.sql`select count(*)::int as n from network.members where app_id = 'slop' and account_status = 'active'`)[0].n;
  await pumpUntil(w, async () => (await booked(w)).length >= 1, 5 * DAY);
  w.notes.firstBooking = (await booked(w)).length;

  // ---- 2. STOP in the middle of a probe: the probe is on the phone; STOP is the answer.
  w.plan.armStop = true;
  await pumpUntil(w, () => !!w.plan.stop, 4 * DAY);
  await pump(w, DAY);

  // ---- 3. "leave slop" in the middle of a scheduled match (before the date). The next booking can be
  // a week away (matches are made in weekly rounds), so wait up to a week for a date that is still ahead.
  const stopId = w.plan.stop ? await memberIdOf(w, w.plan.stop.phone) : undefined;
  let leaving: { phone: string; memberId: string; opp: { id: string } } | undefined;
  await pumpUntil(w, async () => {
    for (const o of await booked(w)) {
      if (o.stage !== "scheduled" || (o.at ?? 0) <= clock.now() || o.participants.includes(stopId ?? "")) continue;
      const phone = await phoneOfMember(w, o.participants[0]!);
      if (phone && w.people.has(phone)) { leaving = { phone, memberId: o.participants[0]!, opp: o }; return true; }
    }
    return false;
  }, 7 * DAY);
  if (leaving) {
    w.plan.leave = { phone: leaving.phone, memberId: leaving.memberId, oppId: leaving.opp.id, at: clock.now() };
    await say(w, leaving.phone, "leave slop");
  }
  await pump(w, DAY);

  // ---- 4. Quiet hours: a transactional text queued at 22:00 waits for the morning (real clock, NY zone).
  await pumpToHour(w, 22);
  const quietPhone = await quietTarget(w);
  const quietId = "slop:quiet:night";
  if (quietPhone) await enqueueSystem(w, quietPhone, quietId, "slop: a quiet-hours check.", "transactional");
  await pump(w, 10 * MINUTE, 5 * MINUTE);
  const quietRow = (await w.sql`select status, sent_at from platform.outbound where id = ${quietId}`)[0] as any;
  await pumpToHour(w, 9);
  await pump(w, 10 * MINUTE, 5 * MINUTE);
  const quietAfter = (await w.sql`select status, sent_at from platform.outbound where id = ${quietId}`)[0] as any;
  w.plan.quiet = { queued: quietRow?.status, after: quietAfter?.status, sentAt: quietAfter?.sent_at, phone: quietPhone };

  // ---- 5. The person cap (across apps, at send time): a batch past the cap loses exactly the excess.
  await pumpToHour(w, 14);
  w.plan.cap = await capProbe(w);

  // ---- 6. A restart with a row waiting for the morning: the row goes out once after the restart.
  await pumpToHour(w, 22);
  const restartPhone = await quietTarget(w);
  const restartId = "slop:restart:night";
  if (restartPhone) await enqueueSystem(w, restartPhone, restartId, "slop: a restart check.", "transactional");
  await pump(w, 10 * MINUTE, 5 * MINUTE);
  const before = (await w.sql`select status from platform.outbound where id = ${restartId}`)[0] as any;
  await w.svc.close();
  w.svc = H.pipelineService(w.url, clock, fake, "sim-slop-b", { SERVICE_TURN_SECRET: H.TURN_SECRET }, s => w.log.push(s));
  await w.svc.start();
  await pumpToHour(w, 9);
  await pump(w, 30 * MINUTE, 10 * MINUTE);
  const after = (await w.sql`select status, sent_at from platform.outbound where id = ${restartId}`)[0] as any;
  w.notes.restart = { phone: restartPhone, before: before?.status, after: after?.status, sentAt: after?.sent_at };

  // ---- 7. A ban in the middle of a relay thread: the queued text never reaches the banned match.
  await pumpUntil(w, async () => (await booked(w)).some(o => o.stage === "scheduled" || o.stage === "done"), 7 * DAY);
  await banRace(w);

  // ---- 8. Run out the rest of the 30 days (dates, feedback, reminders, quiet hours).
  const end = H.START + 30 * DAY;
  if (clock.now() < end) await pump(w, end - clock.now(), 30 * MINUTE);
  w.notes.days = Math.floor((clock.now() - H.START) / DAY);
}

/** A member with a recent inbound (so the unanswered streak is not what holds the row) and not stopped or left. */
async function quietTarget(w: World): Promise<string | undefined> {
  const rows = await w.sql`select pi.e164, max(m.ts) as last_in from network.messages m
    join network.members mem on mem.id = m.member_id join platform.phone_identities pi on pi.person_id = mem.person_id
    where m.direction = 'inbound' and mem.account_status = 'active' group by pi.e164 order by last_in desc limit 8` as any[];
  for (const r of rows) {
    if (r.e164 === w.plan.stop?.phone || r.e164 === w.plan.leave?.phone || r.e164 === MINOR_PHONE) continue;
    return r.e164;
  }
  return undefined;
}

async function enqueueSystem(w: World, p: string, id: string, text: string, kind: Outbound["kind"]) {
  const rt = w.svc.runtimeFor("slop")!;
  const memberId = await memberIdOf(w, p);
  if (!memberId) return;
  await rt.unitOfWork(() => rt.system(memberId, id, text, kind, "info"));
  await H.receipts(w.svc, w.clock, w.fake);
}

/** The production cap entry point (service.capRefused): a batch of proactive sends for one person loses the excess. */
async function capProbe(w: World) {
  const rt = w.svc.runtimeFor("slop")!;
  await rt.identities();
  const candidates: { p: string; id: string; used: number }[] = [];
  for (const x of PEOPLE) {
    if (x.p === w.plan.stop?.phone || x.p === w.plan.leave?.phone) continue;
    const id = rt.memberOf(x.p);
    if (!id) continue;
    const [r] = await w.sql`select count(*)::int as n from platform.outbound where member_id = ${id} and kind = 'proactive' and sent_at > ${new Date(w.clock.now() - DAY)} and sent_at <= ${new Date(w.clock.now())}` as any[];
    candidates.push({ p: x.p, id, used: r?.n ?? 0 });
  }
  candidates.sort((a, b) => a.used - b.used);
  const pick = candidates[0];
  if (!pick) return { ran: false };
  const room = Math.max(0, PERSON_DAILY_CAP - pick.used);
  const n = room + 1;
  const batch: Outbound[] = Array.from({ length: n }, (_, i) => ({
    id: `slop:cap:${i}`, memberId: pick.id as never, to: pick.p, body: `slop: a person-cap check ${i}.`,
    kind: "proactive", proactive: true, system: true, ts: w.clock.now(),
  }));
  const refused = await w.svc.capRefused(rt, batch);
  const accepted = batch.filter(x => !refused.has(x.id)).map(x => x.id);
  await w.svc.capRelease(accepted);
  return { ran: true, member: pick.id, used: pick.used, batch: n, refused: [...refused], accepted: accepted.length };
}

/** The relay + ban race: pass one relayed text, queue the next during a provider outage, ban the match, let the queue retry. */
async function banRace(w: World) {
  const candidates = (await booked(w)).filter(o => o.stage === "scheduled" || o.stage === "done");
  for (const o of candidates) {
    for (const senderId of o.participants) {
      const partnerId = o.participants.find(x => x !== senderId)!;
      const sender = await phoneOfMember(w, senderId);
      const partner = await phoneOfMember(w, partnerId);
      if (!sender || !partner || !w.people.has(sender) || !w.people.has(partner)) continue;
      if (sender === w.plan.stop?.phone || partner === w.plan.stop?.phone || partner === w.plan.leave?.phone) continue;
      const first = await relay(w, sender, "Tell them I'm running ten minutes late.", 1);
      if (first.decision !== "pass") continue;
      await pump(w, 10 * MINUTE, 5 * MINUTE);
      // The partner answers the first text, so the recipient's unanswered streak is not what refuses
      // the second one: the outage, then the ban, must be what decides it.
      await say(w, partner, "Got it, see you soon.");
      await pump(w, 5 * MINUTE, 5 * MINUTE);
      const before = new Set(((await w.sql`select id from platform.outbound where id like 'relay:%'`) as any[]).map(r => r.id));
      w.fake.downUntil = w.clock.now() + HOUR;
      const second = await relay(w, sender, "Tell them I'm outside.", 2);
      const at = w.clock.now();
      const relay2Id = ((await w.sql`select id from platform.outbound where id like 'relay:%'`) as any[]).map(r => r.id).find(id => !before.has(id));
      const ban = await (await H.staff(w.svc, H.SAFETY, "POST", "/apps/slop/safety/ban", { memberId: partnerId, by: "phone", note: "sim: harm after a date" })).json() as any;
      w.fake.downUntil = 0;
      await pump(w, 2 * HOUR, 5 * MINUTE);
      const rows = await w.sql`select id, status, note, created_at from platform.outbound where id like 'relay:%' order by created_at` as any[];
      const relay2 = rows.find(r => r.id === relay2Id);
      w.plan.ban = { phone: partner, memberId: partnerId, oppId: o.id, at, relayId: relay2Id ?? "" };
      w.notes.ban = { first, second, ban: ban.ok, rows: rows.map(r => ({ id: r.id, status: r.status, note: r.note, at: r.created_at })), relay2: relay2?.status };
      return;
    }
  }
}

async function gates(b: Block, w: World) {
  const { sql, fake, notes, plan } = w;
  const rows = (await sql`select * from platform.outbound order by created_at, id`) as any[];
  const byId = new Map(rows.map(r => [r.id, r]));
  const deliveries = [...fake.delivered.values()];
  const deliveredRows = rows.filter(r => DELIVERED.has(r.status));
  const sentTo = (p: string) => deliveries.filter(d => d.to === p);
  const rowOf = (key: string) => byId.get(key.replace(/^tn:/, ""));

  b.track("pipeline-slop: messages", true, `${rows.length} outbound rows, ${deliveries.length} delivered by the fake provider, ${fake.calls.length} provider calls, ${(await sql`select count(*)::int as n from platform.inbound`)[0].n} inbound rows, ${notes.days} simulated days`);

  await b.run("pipeline-slop: 30 simulated days, signed webhooks in, the fake provider out (no live flag)", () => {
    expect(notes.days).toBeGreaterThanOrEqual(30);
    expect(notes.matching).toBe(200);
    expect(notes.onboarded).toBeGreaterThanOrEqual(PEOPLE.length);
    expect(notes.firstBooking).toBeGreaterThanOrEqual(1);
  });

  await b.run("pipeline-slop: 0 lost outbound messages (every row the provider took is one delivered row, every delivered row was taken once)", async () => {
    for (const d of deliveries) {
      const r = rowOf(d.key);
      expect([d.key, !!r]).toEqual([d.key, true]);
      expect([d.key, DELIVERED.has(r.status) || r.status === "failed"]).toEqual([d.key, true]);
    }
    for (const r of deliveredRows) expect([r.id, fake.delivered.has(`tn:${r.id}`)]).toEqual([r.id, true]);
    const stale = await sql`select m.id, m.status, o.status as queue from network.messages m join platform.outbound o on o.id = m.id where m.direction = 'outbound' and m.status <> o.status`;
    expect(stale.length).toBe(0);
  });

  await b.run("pipeline-slop: 0 duplicated outbound messages (one provider message per key; no text twice to a phone within a minute)", () => {
    const seen = new Map<string, number>();
    const dupes: string[] = [];
    for (const d of [...deliveries].sort((a, b) => a.at - b.at)) {
      const k = `${d.to}|${d.text}`;
      const last = seen.get(k);
      if (last !== undefined && d.at - last < MINUTE) dupes.push(d.key);
      seen.set(k, d.at);
    }
    expect(dupes).toEqual([]);
    expect(fake.calls.filter(c => c.outcome === "delivered").length).toBe(fake.delivered.size);
  });

  await b.run("pipeline-slop: every outbound row ends in a terminal status (nothing waits, sends or sits accepted)", () => {
    const open = rows.filter(r => WAITING.includes(r.status) || r.status === "accepted" || r.status === "sent");
    expect(open.map(r => `${r.id}:${r.status}`)).toEqual([]);
    const other = rows.filter(r => !DELIVERED.has(r.status) && !NOT_SENT.test(r.status));
    expect(other.map(r => `${r.id}:${r.status}`)).toEqual([]);
    expect(deliveredRows.length).toBeGreaterThan(100);
  });

  await b.run("pipeline-slop: every probe had a review approval before it went (no probe without a person's decision)", async () => {
    const probes = await sql`select m.opportunity_id, min(m.ts) as probe_at from network.messages m
      where m.direction = 'outbound' and m.type = 'probe' and m.opportunity_id is not null group by m.opportunity_id` as any[];
    expect(probes.length).toBeGreaterThan(0);
    const approved = notes.approved as Map<string, number>;
    for (const p of probes) {
      // The staff API took the decision before the probe: recorded when it happened (an opportunity a
      // member later left is deleted from the console rows, so the run's own record is the evidence).
      expect({ opp: p.opportunity_id, approved: approved.has(p.opportunity_id) }).toEqual({ opp: p.opportunity_id, approved: true });
      expect(approved.get(p.opportunity_id)!).toBeLessThanOrEqual(new Date(p.probe_at).getTime());
      const [r] = await sql`select decision, decided_at from network.review_items where opportunity_id = ${p.opportunity_id}` as any[];
      if (r) {
        expect({ opp: p.opportunity_id, decision: r.decision }).toEqual({ opp: p.opportunity_id, decision: "approve" });
        expect(new Date(r.decided_at).getTime()).toBeLessThanOrEqual(new Date(p.probe_at).getTime());
      }
    }
  });

  await b.run("pipeline-slop: quiet hours hold every proactive and transactional send to 09:00-21:00 New York", () => {
    const bad = deliveredRows.filter(r => (r.kind === "proactive" || r.kind === "transactional") && r.sent_at && (nyHour(new Date(r.sent_at).getTime()) < 9 || nyHour(new Date(r.sent_at).getTime()) >= 21));
    expect(bad.map(r => `${r.id}:${r.kind}@${new Date(r.sent_at).toISOString()}`)).toEqual([]);
  });

  await b.run("pipeline-slop: a transactional text queued at 22:00 waits and goes in the morning", () => {
    expect(plan.quiet).toMatchObject({ queued: "deferred_quiet_hours", after: "delivered" });
    expect(nyHour(new Date(plan.quiet.sentAt).getTime())).toBeGreaterThanOrEqual(9);
  });

  await b.run("pipeline-slop: no member receives more proactive texts than the person cap in any 24 hours", () => {
    const by = new Map<string, number[]>();
    for (const r of deliveredRows.filter(r => r.kind === "proactive" && r.sent_at)) by.set(r.member_id, [...(by.get(r.member_id) ?? []), new Date(r.sent_at).getTime()]);
    const over: string[] = [];
    for (const [id, ts] of by) {
      ts.sort((a, b) => a - b);
      for (let i = 0; i + PERSON_DAILY_CAP < ts.length; i++) if (ts[i + PERSON_DAILY_CAP]! - ts[i]! < DAY) over.push(`${id}:${new Date(ts[i]!).toISOString()}`);
    }
    expect(over).toEqual([]);
  });

  await b.run("pipeline-slop: the person cap at send time refuses exactly the excess of a proactive batch", () => {
    expect(plan.cap.ran).toBe(true);
    expect(plan.cap.batch).toBe(plan.cap.used < PERSON_DAILY_CAP ? PERSON_DAILY_CAP - plan.cap.used + 1 : 1);
    expect(plan.cap.refused.length).toBe(1);
    expect(plan.cap.accepted).toBe(plan.cap.batch - 1);
  });

  await b.run("pipeline-slop: a STOP during a probe: the probe was already sent, and nothing but compliance follows", () => {
    expect(plan.stop).toBeTruthy();
    const stop = plan.stop!;
    expect(sentTo(stop.phone).some(d => d.key === `tn:${stop.probeId}`)).toBe(true);
    const after = deliveredRows.filter(r => r.to_address === stop.phone && new Date(r.sent_at).getTime() > stop.at && r.kind !== "compliance");
    expect(after.map(r => `${r.id}:${r.kind}`)).toEqual([]);
    const probes = deliveredRows.filter(r => r.to_address === stop.phone && r.kind === "proactive" && new Date(r.sent_at).getTime() > stop.at);
    expect(probes.map(r => r.id)).toEqual([]);
  });

  await b.run("pipeline-slop: 'leave slop' in the middle of a scheduled match: the member is gone and nothing follows but the confirmation", async () => {
    expect(plan.leave).toBeTruthy();
    const leave = plan.leave!;
    const st = await slopState(w);
    expect((st.members ?? []).some((m: any) => m.id === leave.memberId)).toBe(false);
    expect((st.opps ?? []).some((o: any) => o.id === leave.oppId || o.participants?.includes(leave.memberId))).toBe(false);
    const after = deliveredRows.filter(r => r.to_address === leave.phone && new Date(r.sent_at).getTime() > leave.at && r.kind !== "compliance");
    expect(after.map(r => `${r.id}:${r.kind}`)).toEqual([]);
  });

  await b.run("pipeline-slop: a minor joins, is welcomed, and is never probed, proposed to or made a participant", async () => {
    const minor = await sql`select id from network.members where app_id = 'slop' and age < 18` as any[];
    expect(minor.length).toBe(1);
    const id = minor[0].id as string;
    const contact = await sql`select type from network.messages where member_id = ${id} and direction = 'outbound' and type in ('probe', 'proposal', 'scheduling', 'plan_probe')` as any[];
    expect(contact.length).toBe(0);
    expect((await sql`select count(*)::int as n from network.participations where member_id = ${id}`)[0].n).toBe(0);
    expect(sentTo(MINOR_PHONE).length).toBeGreaterThanOrEqual(1);
  });

  await b.run("pipeline-slop: a restart with a row waiting for the morning sends it once after the restart, same key", () => {
    expect(notes.restart).toMatchObject({ before: "deferred_quiet_hours", after: "delivered" });
    const key = `tn:slop:restart:night`;
    expect(fake.calls.filter(c => c.req.idempotencyKey === key).map(c => c.outcome)).toEqual(["delivered"]);
    expect(nyHour(new Date(notes.restart.sentAt).getTime())).toBeGreaterThanOrEqual(9);
  });

  await b.run("pipeline-slop: a ban in the middle of a relay thread: the queued text ends without reaching the banned match", () => {
    expect(notes.ban).toBeTruthy();
    expect(notes.ban.first).toMatchObject({ turn: "open", status: 200, decision: "pass" });
    expect(notes.ban.second).toMatchObject({ turn: "open", status: 200, decision: "pass" });
    expect(notes.ban.ban).toBe(true);
    expect(notes.ban.relay2).not.toBe("delivered");
    const ban = plan.ban!;
    const after = sentTo(ban.phone).filter(d => d.at >= ban.at);
    expect(after.map(d => d.key)).toEqual([]);
    const passedRelay = fake.calls.filter(c => c.req.idempotencyKey.startsWith("tn:relay:") && c.outcome === "delivered");
    expect(passedRelay.length).toBeGreaterThanOrEqual(1);
  });
}
