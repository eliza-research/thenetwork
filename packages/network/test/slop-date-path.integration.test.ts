// The slop.date path end to end through NetworkService on Postgres (issue #9 gate): two adults join
// slop by text on the shared line, answer the onboarding asks, a person approves the match in the
// review queue, both say yes to the anonymous date probe, the date is booked, the check-in comes after
// the date, and one member's answer files a report. The report reaches the safety queue and the two
// people are kept apart afterwards. A profile from Rae's own AI assistant (MCP submit_profile) that
// reads like an answer is learned but never taken as one: no yes to the probe, no cancel, no report. Postgres in a database of its own per test process; dry-run sends
// (the text is read back from network.messages); fictional numbers (+1 212 555 01xx).
import { findExecutable } from "../../core/src/runtime/process.ts";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { DAY, HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { localEmbed, SLOP_ENGINE_DEFAULTS, slopPack, slopProfiles, World } from "@thenetwork/engine";
import { TURN_PATH, type TurnRequest, type TurnResponse } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { OutboundQueue, recipientWindowHasher } from "../../blooio/src/outbound-queue.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { APPS } from "../../platform/src/apps.ts";
import { BlooioAdapter, DryRunAdapter } from "../service/channel.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { loadSnapshot } from "../service/snapshot.ts";
import { copy } from "../src/copy.ts";
import { meetingFeedbackKey } from "../src/network.ts";
import { Mini, START } from "./mini.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!findExecutable("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_slop_date_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

const SECRET = "whsec_slop_date";
const ADMIN = "adm-tok", REVIEWER = "rev-tok", SAFETY = "saf-tok";
const RAE = "+12125550161", SAM = "+12125550162";
const debug = process.env.SLOP_PATH_DEBUG ? (s: string) => console.log(`  [slop-path] ${s}`) : () => {};

let sql: SQL;
let svc: NetworkService | undefined;
let evt = 0;

async function text(s: NetworkService, clock: SimClock, from: string, body: string) {
  const n = ++evt;
  const raw = JSON.stringify({ id: `evt_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test", data: { message_id: `msg_${n}`, sender: from, chat_id: from, text: body, protocol: "imessage" } });
  const res = await s.fetch(new Request(`http://127.0.0.1${WEBHOOK_PATH}`, { method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(SECRET, raw, Math.floor(clock.now() / 1000)) }, body: raw }));
  expect(res.status).toBe(200);
  clock.advance(MINUTE);
  const result = (await res.json()).result as string;
  debug(`${from} -> "${body}" (${result})`);
  return result;
}
async function signedText(s: NetworkService, clock: SimClock, secret: string, from: string, messageId: string, text: string) {
  const turn: TurnRequest = { app: "slop", channel: "blooio", from, messageId, text, transport: "imessage", receivedAt: clock.now(), to: null };
  const body = JSON.stringify(turn);
  const headers = await svcSign(secret, { id: messageId, path: TURN_PATH, method: "POST", body, nowS: Math.floor(clock.now() / 1000) });
  const res = await s.fetch(new Request(`http://127.0.0.1${TURN_PATH}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body }));
  expect(res.status).toBe(200);
  const response = await res.json() as TurnResponse;
  expect(response.outcome).toBe("handled");
  if (response.outcome !== "handled") throw new Error(`Expected direct advice, got ${response.outcome}`);
  return response.replies;
}
const staff = (s: NetworkService, token: string, method: string, path: string, b?: unknown) =>
  s.fetch(new Request(`http://127.0.0.1:4848${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(b ? { "content-type": "application/json" } : {}) }, ...(b ? { body: JSON.stringify(b) } : {}) }));
const memberId = async (e164: string) =>
  ((await sql`select m.id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = 'slop' and ph.e164 = ${e164}`)[0] as { id: string } | undefined)?.id;
/** Every outbound text to one slop member so far, oldest first (dry-run: the text is only in network.messages). */
const inbox = async (id: string) =>
  ((await sql`select body, type, opportunity_id from network.messages where app_id = 'slop' and member_id = ${id} and direction = 'outbound' order by ts, id`) as any[])
    .map(r => ({ body: r.body as string, type: r.type as string | null, opp: r.opportunity_id as string | null }));
const last = async (id: string) => (await inbox(id)).at(-1)?.body ?? "";

/** Tick the service in steps (the tick loop of serve.ts). */
async function run(s: NetworkService, clock: SimClock, ms: number, step = 30 * MINUTE) {
  for (let t = 0; t < ms; t += step) { clock.advance(Math.min(step, ms - t)); await s.tick(); }
}

test("Slop availability and pacing follow the booked time in the meeting's zone", async () => {
  const cases = [
    { meetingAt: Date.UTC(2026, 9, 13, 0), timeZone: undefined, slot: 0, lat: 40.7, lng: -74, liked: "rae" },
    { meetingAt: Date.UTC(2026, 9, 11, 22), timeZone: "America/Los_Angeles", slot: 7, lat: 34.05, lng: -118.25, liked: "sam" },
  ];
  const pacing = slopPack.eligibility.memberRules.find(rule => rule.id === "recently_matched")!;
  for (const { meetingAt, timeZone, slot, lat, lng, liked } of cases) {
    const ids = ["rae", "sam"];
    const world = new Mini([
      { id: "rae", name: "Rae", age: 29, romance: { is: "woman", seeks: ["man"] } },
      { id: "sam", name: "Sam", age: 31, romance: { is: "man", seeks: ["woman"] } },
    ], { app: "slop", plans: false, growth: false, hooks: {
      timeOptions: () => [{ start: meetingAt, end: meetingAt + HOUR }],
      venue: () => ({ id: "test-cafe", name: "Cafe", neighborhood: "Downtown", lat, lng, timeZone }),
    } });
    world.clock.set(Date.UTC(2026, 9, 9, 15));
    await world.onboard(...ids);
    const opportunityId = world.propose(ids, { category: "romance", objective: "a coffee date" });
    await world.answerProbes(ids, () => "Yes, the first time works.");
    expect(world.meetings).toMatchObject([{ at: meetingAt }]);

    const feedbackAt = Date.UTC(2026, 9, 13, 16);
    world.clock.set(feedbackAt);
    await world.net.tick(feedbackAt);
    const feedback = (id: string) => id === liked ? "We both came. It was great. I would meet again." : "We both came.";
    await world.say("rae", feedback("rae"));
    const state = world.net.exportState();
    const interaction = state.interactions.find(item => item.id === `${opportunityId}:fb:rae`)!;
    expect(interaction).toMatchObject({ at: feedbackAt, outcome: "completed" });
    const history = () => slopProfiles(world.net.engineInput(feedbackAt)).get("rae")?.history;
    expect(history()?.attendedSlots).toEqual([slot]);

    // Older snapshots can recover the booked time from the exact opportunity after a restart.
    delete interaction.bookedMeeting;
    delete interaction.opportunityId;
    world.net.importState(state);
    expect(history()?.attendedSlots).toEqual([slot]);

    world.clock.advance(HOUR);
    await world.say("sam", feedback("sam"));
    expect(world.net.exportState().feedback).toMatchObject([
      { from: "rae", at: feedbackAt, wouldMeetAgain: liked === "rae" },
      { from: "sam", at: feedbackAt + HOUR, wouldMeetAgain: liked === "sam" },
    ]);
    const afterBothReplies = slopProfiles(world.net.engineInput(world.clock.now()));
    for (const id of ids) expect(afterBothReplies.get(id)?.history).toMatchObject({ dates: 1, attendedSlots: [slot] });
    const gate = (id: string, at: number) => {
      const view = new World(world.net.engineInput(at), SLOP_ENGINE_DEFAULTS, localEmbed, slopPack);
      return pacing.check(view, id, view.get(id)!, { category: "romance", role: "peer", format: "one_to_one", timeSensitive: false });
    };
    const tenDaysAfterBooking = meetingAt + 10 * DAY;
    expect(gate(liked, tenDaysAfterBooking - 1)).toBe("recently_matched");
    expect(gate(ids.find(id => id !== liked)!, tenDaysAfterBooking - 1)).toBeNull();
    expect(gate(liked, tenDaysAfterBooking)).toBeNull();
  }
});

test("Slop pacing uses feedback about the latest completed date", async () => {
  const firstMeetingAt = Date.UTC(2026, 9, 11, 22);
  const latestMeetingAt = Date.UTC(2026, 9, 14, 23);
  const world = new Mini([
    { id: "rae", name: "Rae", age: 29, romance: { is: "woman", seeks: ["man"] } },
    { id: "sam", name: "Sam", age: 31, romance: { is: "man", seeks: ["woman"] } },
    { id: "cy", name: "Cy", age: 30, romance: { is: "man", seeks: ["woman"] } },
  ], { app: "slop", plans: false, growth: false, hooks: {
    timeOptions: opportunity => {
      const start = opportunity.participants.includes("cy") ? latestMeetingAt : firstMeetingAt;
      return [{ start, end: start + HOUR }];
    },
  } });
  world.clock.set(Date.UTC(2026, 9, 9, 15));
  await world.onboard("rae", "sam", "cy");
  const book = async (counterpart: string) => {
    const pair = ["rae", counterpart];
    const id = world.propose(pair, { category: "romance", objective: "a coffee date" });
    await world.answerProbes(pair, () => "Yes, the first time works.");
    return id;
  };
  const tickAt = async (at: number) => {
    world.clock.set(at);
    await world.net.tick(at);
  };
  const first = await book("sam");
  await tickAt(firstMeetingAt + 16 * HOUR);
  await world.say("sam", "We both came.");
  await world.say("rae", "Thanks.");
  const latest = await book("cy");
  expect(world.meetings).toMatchObject([{ at: firstMeetingAt }, { at: latestMeetingAt }]);

  // Rae answers the old prompt after the second date has started, before its check-in is due.
  await tickAt(latestMeetingAt + HOUR);
  await world.say("rae", "We both came. It was great. I would meet again.");
  await tickAt(latestMeetingAt + 15 * HOUR);
  await world.say("cy", "We both came.");
  const evidence = world.net.engineInput(world.clock.now());
  expect(evidence.feedback).toContainEqual(expect.objectContaining({ from: "rae", about: "sam", opportunityId: first, wouldMeetAgain: true }));
  expect(evidence.feedback).toContainEqual(expect.objectContaining({ from: "cy", about: "rae", opportunityId: latest }));
  expect(slopProfiles(evidence).get("rae")?.history).toMatchObject({ lastDateAt: latestMeetingAt, lastDateLiked: undefined });
  const earlyAnswer = evidence.feedback!.find(reply => reply.from === "rae")!;
  const likedDateWith = (reply: typeof earlyAnswer) => slopProfiles({ ...evidence, feedback: [reply] }).get("rae")?.history.lastDateLiked;
  expect(likedDateWith({ ...earlyAnswer, about: "cy" })).toBeUndefined();
  expect(likedDateWith({ ...earlyAnswer, opportunityId: undefined })).toBeUndefined();
  expect(likedDateWith({ ...earlyAnswer, opportunityId: undefined, about: "cy" })).toBe(true);

  world.clock.advance(HOUR);
  await world.say("rae", "We both came. I would meet again.");
  expect(slopProfiles(world.net.engineInput(world.clock.now())).get("rae")?.history.lastDateLiked).toBe(true);
});

describe.skipIf(!pgAvailable)("slop.date: join to report after the date (NetworkService, Postgres)", () => {
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    sql = new SQL({ url: URL_, max: 2 });
  }, T);
  afterAll(async () => {
    await svc?.close().catch(() => {});
    await sql?.close();
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
  });

  test("join, onboard, review approval, mutual yes, date booked, check-in, report to the safety queue, pair kept apart", async () => {
    const clock = new SimClock(START);
    const turnSecret = "synthetic-slop-safety-turn-signing-secret";
    // Only the explicitly requested arm may use the runner's real provider.
    // The service receives its normal opt-in settings, never a test LLM.
    const engineJudge = process.env.NETWORK_ENGINE_JUDGE === "1";
    const judgeEnv = engineJudge ? {
      NETWORK_ENGINE_JUDGE: "1",
      NETWORK_ENGINE_JUDGE_MAX_REQUESTS: process.env.NETWORK_ENGINE_JUDGE_MAX_REQUESTS,
      NETWORK_ENGINE_JUDGE_BUDGET_USD: process.env.NETWORK_ENGINE_JUDGE_BUDGET_USD,
    } : {};
    if (engineJudge) {
      expect(judgeEnv.NETWORK_ENGINE_JUDGE_MAX_REQUESTS).toBe("12");
      expect(Number(judgeEnv.NETWORK_ENGINE_JUDGE_BUDGET_USD)).toBe(0.25);
    }
    const s = svc = new NetworkService({
      url: URL_, clock, instance: "slop-date", log: () => {}, env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: turnSecret, ...judgeEnv }, networks: [{ id: "ntwrk:nyc" }, { id: "slop:nyc" }],
      tokens: `admin:${ADMIN},reviewer:${REVIEWER},safety:${SAFETY}`, webhookSecret: SECRET, network: { seed: 1 }, photoStorage: null, notify: false,
      adapter: () => new DryRunAdapter(() => {}),
    });
    await s.start();
    const judgeCost = async (phase: string) => {
      const rows = await sql`select provider, detail->>'model' as model, count(*)::int as requests,
        sum(cost_usd)::float8 as usd from network.cost_ledger
        where app_id = 'slop' and kind = 'llm' and detail->>'purpose' = 'engine_judge'
        group by provider, detail->>'model'` as { provider: string; model: string | null; requests: number; usd: number }[];
      const requests = rows.reduce((n, row) => n + row.requests, 0);
      const usd = rows.reduce((n, row) => n + row.usd, 0);
      if (engineJudge) {
        expect(requests).toBeGreaterThan(0);
        expect(requests).toBeLessThanOrEqual(12);
        expect(usd).toBeGreaterThan(0);
        expect(usd).toBeLessThanOrEqual(0.25);
        // A priced HTTP response is not proof of a valid parsed judge verdict.
        console.log(JSON.stringify({ scope: "synthetic-slop-service-engine-judge-http", phase, requests, usd, providers: rows }));
      } else {
        expect(requests).toBe(0);
      }
    };

    // ---- Join slop by keyword on the shared line, then the onboarding asks.
    const people = [
      { e164: RAE, name: "Rae, 29", about: "I'm a woman into men. Live in Greenpoint, love climbing and live music", seeking: "I'm a woman looking for men, 27 to 38, within 5 miles of 11222", goal: "Something serious, no smokers" },
      { e164: SAM, name: "Sam, 31", about: "I'm a man into women. Williamsburg, I climb and go to shows", seeking: "I'm a man looking for women, 25 to 35, within 5 miles of 11211", goal: "A relationship, no smokers" },
    ];
    for (const p of people) {
      expect(await text(s, clock, p.e164, "slop")).toEqual(expect.any(String));
      await text(s, clock, p.e164, p.name);
      await text(s, clock, p.e164, p.about);
      await text(s, clock, p.e164, p.seeking);
      await text(s, clock, p.e164, p.goal);
      await text(s, clock, p.e164, "Weekend evenings work best");
    }
    const rae = (await memberId(RAE))!, sam = (await memberId(SAM))!;
    expect(rae).toEqual(expect.any(String));
    expect(sam).toEqual(expect.any(String));
    for (const id of [rae, sam]) debug(`${id}: ${(await inbox(id)).map(m => m.body).join(" | ")}`);

    // ---- Matching on; the engine proposes; nobody hears of it before a person approves.
    expect((await staff(s, ADMIN, "POST", "/apps/slop/matching", { on: true })).status).toBe(200);
    let item: any;
    for (let i = 0; i < 12 && !item; i++) {
      await run(s, clock, 2 * HOUR);
      const q = await (await staff(s, REVIEWER, "GET", "/apps/slop/review")).json() as any;
      item = q.items?.find((x: any) => x.proposal.participants.includes(rae) && x.proposal.participants.includes(sam));
    }
    expect(item).toBeDefined();
    await judgeCost("before-review");
    if (engineJudge) {
      const runs = await sql`select r.summary->'matchingJudge' as judge from network.matching_runs r
        join network.opportunities o on o.run_id = r.id and o.app_id = r.app_id
        where o.app_id = 'slop' and o.id = ${item.oppId}` as {
          judge: { model?: string; calls: number; failures: number; verdicts: number; selected: number; judged: number };
        }[];
      expect(runs).toHaveLength(1);
      const judge = runs[0]!.judge;
      expect(judge.calls).toBeGreaterThan(0);
      expect(judge.verdicts).toBeGreaterThan(0);
      expect(judge.selected).toBeGreaterThan(0);
      expect(judge.failures).toBe(0);
      expect(judge.judged).toBe(judge.selected);
      console.log(JSON.stringify({ scope: "synthetic-slop-service-matching-judge", ...judge }));
    }
    // A reviewer's edit that talks about looks or a rating is refused on slop (photo ratings are never shown), and nothing is sent.
    for (const words of ["You're both really attractive, she's in the 73rd percentile.", "Similar looks level, good match.", "Top 10% photo rating."]) {
      const r = await (await staff(s, REVIEWER, "POST", `/apps/slop/review/${encodeURIComponent(item.oppId)}`, { decision: "edit", explanations: { [rae]: words }, secondsSpent: 5, revision: item.revision })).json() as any;
      expect([words, r.ok, r.code ?? r.error ?? r.reason]).toEqual([words, false, "edit_leak"]);
    }
    expect((await sql`select count(*)::int as n from network.messages where app_id = 'slop' and opportunity_id = ${item.oppId}`)[0].n).toBe(0);
    expect((await (await staff(s, REVIEWER, "POST", `/apps/slop/review/${encodeURIComponent(item.oppId)}`, { decision: "approve", secondsSpent: 20, revision: item.revision })).json() as any).ok).toBe(true);

    // A profile from Rae's own AI assistant (MCP submit_profile): learned, never the member's answer.
    const raePerson = ((await sql`select person_id from platform.phone_identities where e164 = ${RAE}`)[0] as { person_id: string }).person_id;
    const fromAssistant = async (about: string) => { expect(await s.submitProfile(raePerson, "slop", RAE, about)).toBe("accepted"); clock.advance(MINUTE); };
    const raeStatus = async () => ((await sql`select status, responded_at from network.participations where opportunity_id = ${item.oppId} and member_id = ${rae}`)[0] as any);
    let assistantTried = false;

    // ---- The anonymous probe, a yes from each side, the booked date.
    const answered = new Set<string>();
    for (let i = 0; i < 24; i++) {
      await run(s, clock, HOUR);
      for (const [id, e164] of [[rae, RAE], [sam, SAM]] as const) {
        const msgs = (await inbox(id)).filter(m => m.opp === item.oppId);
        const ask = msgs.at(-1);
        if (ask && !answered.has(ask.body) && /\?/.test(ask.body) && !/How did your date/.test(ask.body)) {
          answered.add(ask.body); debug(`${id} asked: ${ask.body}`);
          if (id === rae && !assistantTried) {
            // The assistant's profile says yes while the probe is open: Rae's answer is still open and nothing is sent.
            assistantTried = true;
            const before = (await inbox(rae)).length, st = await raeStatus();
            await fromAssistant("Yes, the first time works. I love climbing and live music.");
            expect(await raeStatus()).toEqual(st);
            expect((await raeStatus()).responded_at).toBeNull();
            expect((await inbox(rae)).length).toBe(before);
          }
          await text(s, clock, e164, "Yes, the first time works");
        }
      }
      const [o] = await sql`select state from network.opportunities where app_id = 'slop' and id = ${item.oppId}`;
      if (o?.state === "SCHEDULED") break;
    }
    const [booked] = await sql`select state, meeting_at from network.opportunities where app_id = 'slop' and id = ${item.oppId}`;
    expect(booked?.state).toBe("SCHEDULED");
    for (const id of [rae, sam]) expect((await inbox(id)).some(m => /You're both in: a first date with/.test(m.body))).toBe(true);
    expect(assistantTried).toBe(true);
    // The assistant's profile can't cancel the booked date or report anyone; only Rae's own texts do.
    await fromAssistant("Sorry, I can't make it anymore, cancel the date.");
    await fromAssistant("Report Sam, he was rude to me and I want to block him.");
    // Words that would be abuse from the sender ("he owes me money") describe Sam: Rae is not scored or dropped.
    await fromAssistant("Block Sam, he owes me money and keeps texting.");
    await fromAssistant("I am in immediate danger.");
    expect((await inbox(rae)).some(m => m.body.startsWith(copy.immediateDanger))).toBe(false);
    expect(s.runtimeFor("slop")!.net.trust.level(rae as never)).toBe("ok");
    expect((await sql`select state from network.opportunities where app_id = 'slop' and id = ${item.oppId}`)[0]?.state).toBe("SCHEDULED");
    expect(((await (await staff(s, SAFETY, "GET", "/apps/slop/safety/reports")).json()) as any).reports ?? []).toHaveLength(0);

    // ---- After the date: the check-in, and Rae's answer files a report.
    const meetingAt = booked.meeting_at ? new Date(booked.meeting_at).getTime() : clock.now() + 3 * DAY;
    // The booking and its two reminders use the thread allowance. Rae answers the day-of check-in herself.
    const checkInAt = meetingAt - 2 * HOUR;
    if (checkInAt > clock.now()) await run(s, clock, checkInAt - clock.now(), HOUR);
    expect(await last(rae)).toMatch(/^Still good for /);
    await text(s, clock, RAE, "Yes, I'm still coming.");
    if (meetingAt > clock.now()) await run(s, clock, meetingAt - clock.now() + 3 * HOUR, HOUR);
    for (let i = 0; i < 48 && !(await inbox(rae)).some(m => /How did your date with/.test(m.body)); i++) await run(s, clock, HOUR, HOUR);
    expect(await last(rae)).toMatch(/How did your date with/);
    // spec/meetingSettlement.md, "A feedback reply needs receipt of its exact prompt"
    const [prompt] = await sql<{ id: string; body: string }[]>`select id,body from network.messages
      where app_id='slop' and member_id=${rae} and opportunity_id=${item.oppId} and type='feedback_request' and direction='outbound'`;
    const syntheticHistory = new OutboundQueue({ recipientWindowKey: recipientWindowHasher("synthetic-recipient-window"), sql, clock, app: "slop", line: "+12125550160", checks: { live: () => false },
      provider: { kind: "sim", send: async () => { throw new Error("Fixture only records an accepted prompt"); } } });
    // The member gets guidance even before the exact feedback prompt is accepted. Until then, the
    // service cannot treat her statement as a report against the counterpart of that prompt.
    expect(await signedText(s, clock, turnSecret, RAE, "slop-help-before-feedback-receipt", "He is following me right now.")).toEqual([copy.immediateDanger]);
    expect(((await (await staff(s, SAFETY, "GET", "/apps/slop/safety/reports")).json()) as any).reports).toHaveLength(0);
    await sql.begin(async tx => {
      await syntheticHistory.recordCollected(tx, [{ id: prompt!.id, memberId: rae, to: RAE, kind: "transactional", text: prompt!.body }]);
      await syntheticHistory.collectedReceipt(tx, [prompt!.id], "accepted", clock.now());
    });
    // Move past the usual identical-reply window before the second distinct emergency statement.
    clock.advance(11 * MINUTE);
    expect(await signedText(s, clock, turnSecret, RAE, "slop-unattributed-present-danger", "I am in immediate danger.")).toEqual([copy.immediateDanger]);
    expect(((await (await staff(s, SAFETY, "GET", "/apps/slop/safety/reports")).json()) as any).reports).toHaveLength(0);
    expect(await signedText(s, clock, turnSecret, RAE, "slop-help-after-feedback-receipt", "He is following me right now.")).toEqual([
      `${copy.immediateDanger} ${copy.reported(true)}`,
    ]);
    expect(await signedText(s, clock, turnSecret, RAE, "slop-help-after-feedback-receipt", "He is following me right now.")).toEqual([
      `${copy.immediateDanger} ${copy.reported(true)}`,
    ]);

    const reports = await (await staff(s, SAFETY, "GET", "/apps/slop/safety/reports")).json() as any;
    debug(JSON.stringify(reports));
    expect(reports.ok).toBe(true);
    expect(reports.reports).toHaveLength(1);
    expect(reports.reports[0]).toMatchObject({ kind: "unsafe", source: "check_in", status: "open", reporterId: rae, subjectId: sam, opportunityId: item.oppId });
    expect((await s.runtimeFor("slop")!.pg.load())?.opps.find(o => o.id === item.oppId)?.post?.[rae]).toBeUndefined();

    // ---- The pair is kept apart: a blocked edge in the snapshot, and no new proposal between them.
    const snap = await loadSnapshot(sql, clock.now(), { app: "slop", city: "nyc" });
    expect(snap.edges.some(e => e.type === "blocked" && ((e.from === rae && e.to === sam) || (e.from === sam && e.to === rae)))).toBe(true);
    await run(s, clock, 3 * DAY, 6 * HOUR);
    const later = await (await staff(s, REVIEWER, "GET", "/apps/slop/review")).json() as any;
    expect((later.items ?? []).some((x: any) => x.oppId !== item.oppId && x.proposal.participants.includes(rae) && x.proposal.participants.includes(sam))).toBe(false);
    expect((await sql`select count(*)::int as n from network.opportunities o where o.app_id = 'slop' and o.id <> ${item.oppId}
      and exists (select 1 from network.participations p where p.app_id = o.app_id and p.opportunity_id = o.id and p.member_id = ${rae})
      and exists (select 1 from network.participations p where p.app_id = o.app_id and p.opportunity_id = o.id and p.member_id = ${sam})`)[0].n).toBe(0);

    // ---- An urgent "report X" text by someone who met them holds them, like the check-in answer did:
    // Rae is out of matching until staff decide (she is matchable before it).
    const net = s.runtimeFor("slop")!.net;
    await text(s, clock, RAE, "ok"); // nothing unanswered: she could be asked again
    expect(net.eligible(rae as never)).toBe(true);
    expect(await signedText(s, clock, turnSecret, SAM, "slop-report-present-danger", "Report Rae, she is threatening me right now.")).toEqual([
      `${copy.immediateDanger} ${copy.reported(true)}`,
    ]);
    const byText = ((await (await staff(s, SAFETY, "GET", "/apps/slop/safety/reports")).json()) as any).reports.find((r: any) => r.subjectId === rae);
    expect(byText).toMatchObject({ kind: "unsafe", source: "message", status: "open", reporterId: sam });
    expect(net.eligible(rae as never)).toBe(false);
    await judgeCost("after-complete-date-path");
  }, T);

  test("only two exact named booking receipts preserve a Slop introduction after cancellation and restart", async () => {
    await svc?.close();
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START);
    const secret = "synthetic-slop-introduction-history-turn";
    const makeService = () => new NetworkService({
      url: URL_, clock, log: () => {}, photoStorage: null, notify: false,
      env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off", SERVICE_TURN_SECRET: secret },
      networks: [{ id: "slop:nyc", matchingEnabled: false }], adapter: () => new DryRunAdapter(() => {}),
    });
    let s = svc = makeService();
    await s.start();
    const people = [];
    for (const [e164, firstName] of [[RAE, "Rae"], [SAM, "Sam"]] as const) {
      const result = await s.accounts.join(APPS.slop, { e164, personId: null }, {
        firstName, age: 30, consent: { sms: true, wording: APPS.slop.consent.text },
      });
      if (!result.ok) throw new Error("Fixture could not join");
      people.push({ id: result.membership.memberId, name: firstName, age: 30, e164 });
    }
    const ids = people.map(person => person.id);
    const world = new Mini(people, { app: "slop", plans: false, growth: false, review: "human" });
    await world.onboard(...ids);
    const oppId = world.propose(ids, { category: "romance", objective: "a coffee date" });
    expect(await world.runUntil(() => world.net.reviewQueue().some(item => item.oppId === oppId))).toBe(true);
    expect(world.net.decide(oppId, "approve", { reviewer: "staff" })).toEqual({ ok: true });
    await world.answerProbes(ids);
    const seed = world.net.exportState();
    const booked = seed.opps.find(opp => opp.id === oppId)!;
    expect(booked).toMatchObject({ stage: "scheduled", bookedTold: expect.arrayContaining(ids) });
    clock.set(world.clock.now());
    const rt = () => s.runtimeFor("slop")!;
    await rt().unitOfWork(net => net.importState({ ...net.exportState(), members: seed.members, opps: [booked] }));

    const queue = new OutboundQueue({ recipientWindowKey: s.outboundRecipientKey, sql, clock, app: "slop", line: "+12125550160", checks: { live: () => false },
      provider: { kind: "sim", send: async () => { throw new Error("Fixture only records receipts"); } } });
    const first = { id: "slop-introduction-first", to: people[0]!.e164, memberId: people[0]!.id, type: "proposal", text: "You're both in: a first date with Sam." };
    const second = { id: "slop-introduction-second", to: people[1]!.e164, memberId: people[1]!.id, type: "proposal", text: "You're both in: a first date with Rae." };
    const notices = [first, second,
      { ...second, id: "unrelated-schedule-notice", type: "scheduling" }];
    await sql.begin(async tx => {
      for (const item of notices) {
        await tx`insert into network.messages (app_id,id,member_id,direction,channel,body,type,status,opportunity_id,proactive,system,ts)
          values ('slop',${item.id},${item.memberId},'outbound','imessage',${item.text},${item.type},'collected',${oppId},false,false,${new Date(clock.now())})`;
        await queue.recordCollected(tx, [{ id: item.id, memberId: item.memberId, to: item.to, kind: "transactional", text: item.text }]);
      }
      await queue.collectedReceipt(tx, [notices[0]!.id, notices[2]!.id], "accepted", clock.now());
    });
    const introductionId = `${oppId}:introduced`;
    const history = () => rt().unitOfWork(net => net.engineInput(clock.now()).interactions?.filter(item => item.id === introductionId) ?? []);
    const pairGate = () => rt().unitOfWork(net => {
      const view = new World(net.packInput(clock.now()), SLOP_ENGINE_DEFAULTS, localEmbed, slopPack);
      const [first, second] = ids as [string, string];
      return slopPack.eligibility.pairRules.find(rule => rule.id === "already_introduced")!
        .check(view, first, second, "romance", view.get(first)!, view.get(second)!);
    });
    expect(await history()).toEqual([]);
    expect(await pairGate()).toBeNull();

    clock.advance(MINUTE);
    const acceptedAt = clock.now();
    await sql.begin(tx => queue.collectedReceipt(tx, [second.id], "accepted", acceptedAt));
    await signedText(s, clock, secret, RAE, "slop-first-date-cancel", "I can't make it anymore.");
    const retired = await rt().pg.load();
    expect(retired?.opps.find(opp => opp.id === oppId)?.stage).toBe("closed");
    expect(retired?.interactions.filter(item => item.id === introductionId)).toMatchObject([
      { at: acceptedAt, outcome: "accepted", participants: ids },
    ]);
    await s.close();
    await sql`delete from platform.outbound where app_id='slop' and id in ${sql([first.id, second.id])}`;
    clock.advance(32 * DAY);
    s = svc = makeService();
    await s.start();
    await expect(history()).resolves.toMatchObject([{ id: introductionId, at: acceptedAt, outcome: "accepted", participants: ids }]);
    expect(await pairGate()).toBe("already_introduced");
    expect((await rt().pg.load())?.feedback).toEqual([]);
    await s.close(); svc = undefined;
  }, T);

  test.each([
    { scenario: "while answering feedback", answer: "I came, but Rae couldn't make it.", missing: true, report: "no_show" },
    { scenario: "while a later booking awaits a reply", answer: "Rae bailed on me.", missing: true, report: undefined },
    { scenario: "with a direct counterpart absence", answer: "He flaked on me.", missing: true, report: undefined },
    { scenario: "with nobody at the date", answer: "Nobody showed up.", missing: true, report: undefined },
    { scenario: "with an unrelated driver absence", answer: "My driver bailed on me.", missing: false, report: undefined },
    { scenario: "with a quoted absence", answer: "'A message: Rae bailed on me.'", missing: false, report: undefined },
    { scenario: "with a denied absence", answer: "Rae didn't flake on me.", missing: false, report: undefined },
    { scenario: "with a casual contact idiom", answer: "He hit me up after dinner.", safety: true, missing: false, report: undefined },
    { scenario: "with direct disclosure of physical harm", answer: "My date choked me.", safety: true, missing: false, report: "unsafe" },
    { scenario: "with a denial of physical harm", answer: "My date never choked me.", safety: true, missing: false, report: undefined },
    { scenario: "with a spelled counterpart age", answer: "He said he's seventeen.", safety: true, missing: false, report: "minor" },
    { scenario: "with a compound counterpart age", answer: "My date was a 16-year-old.", safety: true, missing: false, report: "minor" },
    { scenario: "with a relative's unrelated age", answer: "We talked about how my son is a 12-year-old.", safety: true, missing: false, report: undefined },
    { scenario: "with a quoted age in a story", answer: "She said “he is 15” while reading a novel.", safety: true, missing: false, report: undefined },
    { scenario: "with positive sentiment about the finished date", answer: "We hit it off.", missing: false, report: undefined, sentiment: "positive" },
    { scenario: "with neutral sentiment about the finished date", answer: "It was okay.", missing: false, report: undefined, sentiment: "neutral" },
    { scenario: "with quoted sentiment about the finished date", answer: "'We hit it off.'", missing: false, report: undefined, sentiment: "neutral" },
    { scenario: "with negated sentiment about the finished date", answer: "We didn't hit it off.", missing: false, report: undefined, sentiment: "neutral" },
  ])("a signed check-in is feedback about the finished date $scenario", async ({ scenario, answer, missing, report, safety, sentiment }) => {
    // spec/meetingSettlement.md, "A feedback reply needs receipt of its exact prompt"
    // spec/meetingSettlement.md, "Classify each attendee from the available reports"
    // spec/safetyCase.md, "Report language distinguishes physical harm from casual contact"
    await svc?.close();
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START);
    const secret = "synthetic-slop-absence-turn-signing-secret";
    const service = svc = new NetworkService({
      url: URL_, clock, log: () => {}, photoStorage: null, notify: false,
      env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off", SERVICE_TURN_SECRET: secret },
      networks: [{ id: "slop:nyc", matchingEnabled: false }], adapter: () => new DryRunAdapter(() => {}),
    });
    await service.start();
    const app = APPS.slop;
    const people = [];
    for (const [phone, name] of [[RAE, "Rae"], [SAM, "Sam"]] as const) {
      const result = await service.accounts.join(app, { e164: phone, personId: null }, {
        firstName: name, age: 30, consent: { sms: true, wording: app.consent.text },
      });
      if (!result.ok) throw new Error("Fixture member could not join");
      people.push({ id: result.membership.memberId, name, age: 30, area: "Greenpoint", interests: ["climbing"], skills: ["belaying"] });
    }
    const ids = people.map(person => person.id);
    const [rae, sam] = ids as [string, string];
    const world = new Mini(people, { plans: false, growth: false });
    await world.onboard(...ids);
    const id = world.propose(ids);
    await world.answerProbes(ids);
    const seeded = world.net.exportState();
    const past = seeded.opps.find(opp => opp.id === id)!;
    expect(past.stage).toBe("scheduled");
    clock.set(past.meetingAt! + 4 * HOUR);
    const future = { ...past, id: "next-slop-booking", meetingAt: clock.now() + DAY };
    past.stage = "done";
    past.feedbackSent = true;
    for (const member of seeded.members) member.awaiting = { kind: "feedback", oppId: id, at: clock.now() };
    const rt = service.runtimeFor("slop")!;
    await rt.unitOfWork(net => net.importState({ ...net.exportState(), members: seeded.members, opps: [past, future] }));
    const state = async () => (await rt.pg.load())!;
    const history = () => rt.unitOfWork(net => slopProfiles(net.engineInput(clock.now())));
    const own = "I did not show up.";
    await signedText(service, clock, secret, RAE, "absence-unreceived", own);
    await signedText(service, clock, secret, SAM, "counterpart-absence-unreceived", answer);
    expect((await state()).opps.find(opp => opp.id === id)?.post).toBeUndefined();
    expect((await state()).reports).toEqual([]);

    const queue = new OutboundQueue({ recipientWindowKey: recipientWindowHasher("synthetic-recipient-window"), sql, clock, app: "slop", line: "+12125550160", checks: { live: () => false },
      provider: { kind: "sim", send: async () => { throw new Error("Fixture only records prompt receipts"); } } });
    const prompt = "How did your date go?";
    await sql.begin(async tx => {
      for (const [index, memberId] of ids.entries()) {
        const key = meetingFeedbackKey(id, memberId);
        await tx`insert into network.messages (app_id,id,member_id,direction,channel,body,type,status,opportunity_id,proactive,system,ts)
          values ('slop',${key},${memberId},'outbound','imessage',${prompt},'feedback_request','collected',${id},false,false,${new Date(clock.now())})`;
        await queue.recordCollected(tx, [{ id: key, memberId, to: [RAE, SAM][index]!, kind: "transactional", text: prompt }]);
        await queue.collectedReceipt(tx, [key], "accepted", clock.now());
      }
    });
    const laterBookingAwaits = scenario === "while a later booking awaits a reply";
    if (laterBookingAwaits) await rt.unitOfWork(net => {
      const saved = net.exportState();
      saved.members.find(member => member.id === rae)!.awaiting = { kind: "booked", oppId: future.id, at: clock.now() };
      net.importState(saved);
    });
    clock.advance(MINUTE);
    await signedText(service, clock, secret, RAE, "absence-exact-receipt", laterBookingAwaits ? "I couldn't make it. Something came up." : own);
    const afterSelf = await state();
    expect({
      upcoming: afterSelf.opps.find(opp => opp.id === future.id)?.stage,
      post: afterSelf.opps.find(opp => opp.id === id)?.post?.[rae],
      reports: afterSelf.reports,
      blocks: afterSelf.blocks,
    }).toMatchObject({ upcoming: "scheduled", post: { came: false, otherNoShow: false }, reports: [], blocks: [] });
    await signedText(service, clock, secret, RAE, "absence-next-cancellation", "I can't make it anymore.");
    expect((await state()).opps.find(opp => opp.id === future.id)?.stage).toBe("closed");

    await signedText(service, clock, secret, SAM, "absence-other-participant", answer);
    const afterOther = await state();
    expect(afterOther.opps.find(opp => opp.id === id)?.post?.[sam]).toMatchObject({ came: true, otherNoShow: missing });
    expect(afterOther.reports).toMatchObject(report
      ? [{ reporterId: sam, subjectId: rae, kind: report, opportunityId: id, source: "check_in" }]
      : []);
    expect(afterOther.blocks).toHaveLength(report ? 1 : 0);
    if (report === "minor") {
      expect(afterOther.members.find(member => member.id === rae)).toMatchObject({ minorReported: true });
      const [person] = await sql`select p.lowest_age from platform.people p
        join platform.phone_identities ph on ph.person_id=p.id where ph.e164=${RAE}`;
      expect(person?.lowest_age).toBe(30);
    }
    if (sentiment) {
      const feedback = afterOther.feedback.find(item => item.from === sam && item.opportunityId === id);
      expect(feedback).toMatchObject({ sentiment, wouldMeetAgain: false });
      expect(feedback?.repeatConsent).toBeUndefined();
      const ownExperience = afterOther.opps.find(opp => opp.id === id)?.post?.[sam];
      expect(ownExperience?.worthwhile === true).toBe(sentiment === "positive");
      expect(ownExperience?.confirmedRoster).toBeUndefined();
    }
    if (safety) {
      await service.close(); svc = undefined;
      return;
    }
    const afterBothReplies = await history();
    expect(afterBothReplies.get(sam)?.history).toMatchObject({ dates: 1, noShows: 0 });
    expect(afterBothReplies.get(rae)?.history).toMatchObject({ dates: 0, noShows: 1 });
    await rt.unitOfWork(net => {
      const saved = net.exportState();
      const absence = saved.interactions.find(item => item.opportunityId === id && item.outcome === "no_show")!;
      expect(absence.noShowBy).toEqual([rae]);
      delete absence.opportunityId;
      delete absence.noShowBy;
      // A similarly shaped old row cannot accuse its apparent author without the exact saved opportunity.
      saved.interactions.push({ ...absence, id: `lost-opportunity:fb:${sam}` });
      net.importState(saved);
    });
    const restored = await history();
    expect(restored.get(sam)?.history).toMatchObject({ dates: 1, noShows: 0 });
    expect(restored.get(rae)?.history).toMatchObject({ dates: 0, noShows: 1 });
    await service.close(); svc = undefined;
  }, T);

  // spec/meetingSettlement.md, "A feedback reply needs receipt of its exact prompt"
  test("unprompted signed feedback follows booked time with the exact prompt receipt", async () => {
    await svc?.close();
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START + 7 * DAY);
    const secret = "synthetic-feedback-order-turn-signing-secret";
    const service = svc = new NetworkService({
      url: URL_, clock, log: () => {}, photoStorage: null, notify: false,
      env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off", SERVICE_TURN_SECRET: secret },
      networks: [{ id: "slop:nyc", matchingEnabled: false }], adapter: () => new DryRunAdapter(() => {}),
    });
    await service.start();
    const names = ["Rae", "Sam", "Cy"];
    const phones = [RAE, SAM, "+12125550189"];
    const people = [];
    for (const [index, name] of names.entries()) {
      const result = await service.accounts.join(APPS.slop, { e164: phones[index]!, personId: null }, {
        firstName: name, age: 30, consent: { sms: true, wording: APPS.slop.consent.text },
      });
      if (!result.ok) throw new Error("Fixture member could not join");
      people.push({ id: result.membership.memberId, name, age: 30, area: "Greenpoint", interests: ["climbing"] });
    }
    const [rae, sam, cy] = people.map(person => person.id) as [string, string, string];
    const world = new Mini(people, { plans: false, growth: false });
    await world.onboard(rae, sam, cy);
    const id = world.propose([rae, sam]);
    await world.answerProbes([rae, sam]);
    const seeded = world.net.exportState();
    const booked = seeded.opps.find(opp => opp.id === id)!;
    expect(booked.stage).toBe("scheduled");
    const latest = {
      ...booked, id: "latest-booked-date", stage: "done" as const, feedbackSent: true,
      createdAt: clock.now() - 6 * DAY, meetingAt: clock.now() - DAY, scheduleRevision: 2,
    };
    const earlier = {
      ...latest, id: "earlier-booked-date", participants: [rae, cy], contacted: [rae, cy],
      createdAt: clock.now() - 5 * DAY, meetingAt: clock.now() - 3 * DAY,
      status: [[rae, "yes"], [cy, "yes"]] as typeof latest.status,
    };
    for (const person of seeded.members) person.awaiting = undefined;
    const rt = service.runtimeFor("slop")!;
    await rt.unitOfWork(net => net.importState({ ...net.exportState(), members: seeded.members, opps: [latest, earlier] }));

    const queue = new OutboundQueue({ recipientWindowKey: recipientWindowHasher("synthetic-recipient-window"), sql, clock, app: "slop", line: "+12125550160", checks: { live: () => false },
      provider: { kind: "sim", send: async () => { throw new Error("Fixture only records prompt receipts"); } } });
    const delivered = async (oppId: string, revision: number) => {
      const key = meetingFeedbackKey(oppId, rae, revision), prompt = "How did your date go?";
      await sql.begin(async tx => {
        await tx`insert into network.messages (app_id,id,member_id,direction,channel,body,type,status,opportunity_id,proactive,system,ts)
          values ('slop',${key},${rae},'outbound','imessage',${prompt},'feedback_request','collected',${oppId},false,false,${new Date(clock.now())})`;
        await queue.recordCollected(tx, [{ id: key, memberId: rae, to: RAE, kind: "transactional", text: prompt }]);
        await queue.collectedReceipt(tx, [key], "accepted", clock.now());
      });
    };
    const feedback = async () => (await rt.pg.load())!.feedback.map(f => [f.opportunityId, f.about]);
    await delivered(latest.id, 1);
    await signedText(service, clock, secret, RAE, "feedback-stale-revision", "We both came.");
    expect(await feedback()).toEqual([]);

    await delivered(earlier.id, earlier.scheduleRevision);
    await delivered(latest.id, latest.scheduleRevision);
    clock.advance(MINUTE);
    await signedText(service, clock, secret, RAE, "feedback-latest-booking", "We both came. It was great.");
    expect(await feedback()).toEqual([[latest.id, sam]]);

    clock.advance(MINUTE);
    await signedText(service, clock, secret, RAE, "feedback-earlier-booking", "It was great, we really clicked.");
    expect(await feedback()).toEqual([[latest.id, sam], [earlier.id, cy]]);
    await service.close(); svc = undefined;
  }, T);

  // Founder decision (2026-10-11, issue #22): a woman or a man who stays unclear about who they hope to
  // meet after the seeks question was asked its two times is read as straight. The read-back says so,
  // and the member can change it. Before this, seeks stayed empty and the member was never matchable.
  test("an unclear seeks answer after both asks defaults to straight, shown in the read-back", async () => {
    const clock = new SimClock(START);
    const s = svc = new NetworkService({
      url: URL_, clock, instance: "slop-seeks", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: [{ id: "slop:nyc" }],
      tokens: `admin:${ADMIN},reviewer:${REVIEWER},safety:${SAFETY}`, webhookSecret: SECRET, network: { seed: 2 }, photoStorage: null, notify: false,
      adapter: () => new DryRunAdapter(() => {}),
    });
    await s.start();
    const JO = "+12125550163";
    for (const body of ["slop", "Jo, 30", "I'm a woman, I'm bi. I live in Bushwick and love dancing", "not sure honestly", "idk, whatever works"]) await text(s, clock, JO, body);
    const jo = (await memberId(JO))!;
    expect(jo).toEqual(expect.any(String));
    await text(s, clock, JO, "25 to 35, within 5 miles of 11237");
    const all = (await inbox(jo)).map(m => m.body);
    debug(all.join(" | "));
    expect(all.filter(b => /Who are you hoping to meet/.test(b))).toHaveLength(2);
    expect(all.some(b => /looking for men/.test(b))).toBe(true);
    await s.close(); svc = undefined;
  }, T);

  // A clear answer with a negation is read as said, never replaced by the straight default:
  // "I don't date men, only women" from a woman is women (before, the parser read nothing, and after two
  // asks the default would have said men).
  test("a woman who says 'I don't date men, only women' is read as seeking women", async () => {
    const clock = new SimClock(START);
    const s = svc = new NetworkService({
      url: URL_, clock, instance: "slop-neg", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: [{ id: "slop:nyc" }],
      tokens: `admin:${ADMIN},reviewer:${REVIEWER},safety:${SAFETY}`, webhookSecret: SECRET, network: { seed: 3 }, photoStorage: null, notify: false,
      adapter: () => new DryRunAdapter(() => {}),
    });
    await s.start();
    const KIM = "+12125550164";
    for (const body of ["slop", "Kim, 27", "I'm a woman. I live in Astoria and love bouldering", "I don't date men, only women", "25 to 35, within 5 miles of 11105"]) await text(s, clock, KIM, body);
    const all = (await inbox((await memberId(KIM))!)).map(m => m.body);
    debug(all.join(" | "));
    expect(all.some(b => /looking for women/.test(b))).toBe(true);
    expect(all.some(b => /looking for men/.test(b))).toBe(false);
    await s.close(); svc = undefined;
  }, T);

  test.each(["before booking", "before queued reveal"] as const)("a current dating limit stops an approved match %s", async (phase) => {
    // spec/datingRadius.md, "Both members' current dating limits apply until reveal"
    const clock = new SimClock(START);
    const queued = phase === "before queued reveal";
    const attempted: string[] = [];
    const turnSecret = "synthetic-slop-probe-receipt-signing-secret";
    const adapter = new BlooioAdapter({ app: "slop", from: "+12125550169", clock, liveGate: () => true, log: () => {}, provider: {
      kind: "sim", send: async request => {
        attempted.push(request.idempotencyKey);
        return { providerMessageId: `sim:${request.idempotencyKey}`, status: "sent" };
      },
    } });
    const s = svc = new NetworkService({
      url: URL_, clock, instance: "slop-current-limits", log: () => {}, env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: turnSecret }, networks: [{ id: "slop:nyc" }],
      tokens: `admin:${ADMIN},reviewer:${REVIEWER}`, webhookSecret: SECRET, network: { seed: 4 }, photoStorage: null, notify: false,
      adapter: () => adapter,
    });
    await s.start();
    const phones = queued ? ["+12125550167", "+12125550168"] : ["+12125550165", "+12125550166"];
    const profiles = queued ? [
      ["Fern, 49", "I'm a woman into men. Live in Greenpoint, love climbing and live music", "I'm a woman looking for men, 47 to 58, within 5 miles of 11222"],
      ["Gabe, 51", "I'm a man into women. Williamsburg, I climb and go to shows", "I'm a man looking for women, 45 to 55, within 5 miles of 11211"],
    ] : [
      ["Della, 29", "I'm a woman into men. Live in Greenpoint, love climbing and live music", "I'm a woman looking for men, 27 to 38, within 5 miles of 11222"],
      ["Ezra, 31", "I'm a man into women. Williamsburg, I climb and go to shows", "I'm a man looking for women, 25 to 35, within 5 miles of 11211"],
    ];
    for (const [idx, phone] of phones.entries()) {
      for (const body of ["slop", ...profiles[idx]!, "Something serious, no smokers", "Weekend evenings work best"]) await text(s, clock, phone, body);
      await adapter.engaged(phone);
    }
    const ids = await Promise.all(phones.map(memberId));
    expect(ids).toEqual([expect.any(String), expect.any(String)]);
    expect((await staff(s, ADMIN, "POST", "/apps/slop/matching", { on: true })).status).toBe(200);
    type Review = { oppId: string; revision: number; proposal: { participants: string[] } };
    let item: Review | undefined;
    for (let i = 0; i < 12 && !item; i++) {
      await run(s, clock, 2 * HOUR);
      const queue = await (await staff(s, REVIEWER, "GET", "/apps/slop/review")).json() as { items: Review[] };
      item = queue.items.find(row => ids.every(id => row.proposal.participants.includes(id!)));
    }
    expect(item).toBeDefined();
    const { oppId, revision } = item!;
    if (!queued) await adapter.queue.setLineSafety("review");
    expect(await (await staff(s, REVIEWER, "POST", `/apps/slop/review/${encodeURIComponent(oppId)}`, { decision: "approve", revision })).json()).toEqual({ ok: true });
    const probes = () => sql<{ id: string; member_id: string }[]>`select id,member_id from network.messages where app_id='slop' and opportunity_id=${oppId} and type='probe' and direction='outbound' order by ts,id`;
    for (let hour = 0; hour < 24 && !(await probes()).length; hour++) await run(s, clock, HOUR);
    const [first] = await probes();
    expect(first).toBeDefined();
    const firstPhone = phones[ids.indexOf(first!.member_id)]!;
    const secondPhone = phones.find(phone => phone !== firstPhone)!;
    if (!queued) {
      // A queued probe is an open turn in memory, but its recipient has never seen it.
      expect(await adapter.queue.statusOf(first!.id)).toBe("retry_scheduled");
      expect(attempted).not.toContain(`tn:${first!.id}`);
      const earlyAt = clock.now();
      const rt = s.runtimeFor("slop")!;
      const firstStatus = async () => (await rt.pg.load())?.opps.find(o => o.id === oppId)?.status.find(([id]) => id === first!.member_id)?.[1];
      await text(s, clock, firstPhone, "Yes, the first time works");
      expect(await firstStatus()).toBe("probing");
      expect(await probes()).toHaveLength(1);
      await adapter.queue.setLineSafety(undefined);
      clock.advance(HOUR);
      await rt.deliver();
      expect(await adapter.queue.statusOf(first!.id)).toBe("sent");
      const late: TurnRequest = { app: "slop", channel: "blooio", from: firstPhone, messageId: "slop-early-answer-replayed-late",
        text: "Yes, the first time works", transport: "imessage", receivedAt: earlyAt, to: null };
      const body = JSON.stringify(late);
      const signed = await svcSign(turnSecret, { id: late.messageId, path: TURN_PATH, method: "POST", body, nowS: Math.floor(clock.now() / 1000) });
      expect((await s.fetch(new Request(`http://127.0.0.1${TURN_PATH}`, { method: "POST", headers: { "content-type": "application/json", ...signed }, body }))).status).toBe(200);
      expect(await firstStatus()).toBe("probing");
      // Older stored probe slots recover only this same recipient's unique message at the recorded time.
      await rt.unitOfWork(net => {
        const state = net.exportState();
        delete state.members.find(member => member.id === first!.member_id)?.awaiting?.probeReceiptId;
        net.importState(state);
      });
    }
    await text(s, clock, firstPhone, "Yes, the first time works");
    for (let hour = 0; hour < 24 && (await probes()).length < 2; hour++) await run(s, clock, HOUR);
    const deliveredProbes = await probes();
    expect(deliveredProbes).toHaveLength(2);
    expect(attempted).toEqual(expect.arrayContaining(deliveredProbes.map(probe => `tn:${probe.id}`)));

    const reveals = () => sql<{ id: string }[]>`select id from network.messages where app_id='slop' and opportunity_id=${oppId} and type='proposal' and direction='outbound'`;
    if (queued) {
      await adapter.queue.setLineSafety("review");
      await text(s, clock, secondPhone, "Yes, the first time works");
      const staged = await reveals();
      expect(staged).toHaveLength(2);
      for (const row of staged) expect(await adapter.queue.statusOf(row.id)).toBe("retry_scheduled");
    }

    // The verified member's assistant updates their dating age range after both anonymous probes.
    const [owner] = await sql<{ person_id: string }[]>`select person_id from platform.phone_identities where e164=${firstPhone}`;
    const preference = firstPhone === phones[0] ? "men" : "women";
    expect(await s.submitProfile(owner!.person_id, "slop", firstPhone, `I'm looking for ${preference}, ages 40 to 45, within 5 miles.`)).toBe("accepted");
    const rt = s.runtimeFor("slop")!;
    expect((await rt.pg.load())?.members.find(m => m.id === first!.member_id)?.appTags?.map(tag => tag.tag)).toContain("romance:age:40-45");
    if (queued) {
      await adapter.queue.setLineSafety(undefined);
      clock.advance(HOUR);
      await rt.deliver();
      for (const row of await reveals()) {
        expect(await adapter.queue.statusOf(row.id)).toBe("suppressed_ineligible");
        expect(attempted).not.toContain(`tn:${row.id}`);
      }
    } else {
      await text(s, clock, secondPhone, "Yes, the first time works");
      const [row] = await sql`select state from network.opportunities where app_id='slop' and id=${oppId}`;
      expect(row?.state).not.toBe("SCHEDULED");
      expect(await reveals()).toEqual([]);
    }
    await s.close(); svc = undefined;
  }, T);
});
