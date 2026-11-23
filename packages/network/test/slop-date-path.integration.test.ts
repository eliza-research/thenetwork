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
import { DAY, DEFAULT_MODEL, endpointsFor, HOUR, judgeLLM, LLMBudget, MINUTE, recommenderLLM, SimClock } from "@thenetwork/core";
import { TURN_PATH, type TurnRequest, type TurnResponse } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { OutboundQueue } from "../../blooio/src/outbound-queue.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { BlooioAdapter, DryRunAdapter } from "../service/channel.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { loadSnapshot } from "../service/snapshot.ts";
import { copy } from "../src/copy.ts";
import { REVEAL_PLACE_PLACEHOLDER, REVEAL_TIME_PLACEHOLDER } from "../src/network.ts";
import { START } from "./mini.ts";
import { CostLedger, PgCostSink } from "../service/cost.ts";
import { modelReviewJudge } from "../../engine/src/reviewJudge.ts";

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
const LIVE_JUDGE = endpointsFor(process.env.JUDGE_PROVIDER || "surplus").length > 0
  && process.env.NETWORK_REVIEW_JUDGE_MAX_REQUESTS === "20" && Number(process.env.NETWORK_REVIEW_JUDGE_BUDGET_USD) === 0.5;
if (!LIVE_JUDGE) console.log(JSON.stringify({ scope: "slop-review-judge-live", skipped: "needs a provider key, NETWORK_REVIEW_JUDGE_BUDGET_USD=0.5 and NETWORK_REVIEW_JUDGE_MAX_REQUESTS=20" }));
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
    const s = svc = new NetworkService({
      url: URL_, clock, instance: "slop-date", log: () => {}, env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: turnSecret }, networks: [{ id: "ntwrk:nyc" }, { id: "slop:nyc" }],
      tokens: `admin:${ADMIN},reviewer:${REVIEWER},safety:${SAFETY}`, webhookSecret: SECRET, network: { seed: 1 }, photoStorage: null, notify: false,
      adapter: () => new DryRunAdapter(() => {}),
    });
    await s.start();
    const noModelCalls = async () => {
      expect((await sql`select count(*)::int as n from network.cost_ledger where app_id = 'slop' and kind = 'llm'`)[0].n).toBe(0);
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
    expect(item.exception).toMatchObject({ verdict: "cannot_run", reason: "no_provider" });
    await noModelCalls();
    // A reviewer's edit that talks about looks or a rating is refused on slop (photo ratings are never shown), and nothing is sent.
    for (const words of ["You're both really attractive, she's in the 73rd percentile.", "Similar looks level, good match.", "Top 10% photo rating."]) {
      const r = await (await staff(s, REVIEWER, "POST", `/apps/slop/review/${encodeURIComponent(item.oppId)}`, { decision: "edit", explanations: { [rae]: words }, secondsSpent: 5, revision: item.revision })).json() as any;
      expect([words, r.ok, r.code ?? r.error ?? r.reason]).toEqual([words, false, "edit_leak"]);
    }
    expect((await sql`select count(*)::int as n from network.messages where app_id = 'slop' and opportunity_id = ${item.oppId}`)[0].n).toBe(0);
    // spec/probeDispatch.md, "A reviewer can read each first probe of the open revision" (audit OPP20, CRI13):
    // the reviewer reads the words of the slop date probe, with its age and distance bands, before approving.
    const probesPath = (revision: number) => `/apps/slop/review/${encodeURIComponent(item.oppId)}/probes?revision=${revision}`;
    expect(await (await staff(s, REVIEWER, "GET", probesPath(item.revision + 1))).json()).toEqual({ ok: false, error: "preview_unavailable" });
    const previewed = await (await staff(s, REVIEWER, "GET", probesPath(item.revision))).json() as
      { ok: boolean; preview: { app: string; revision: number; probes: { memberId: string; text: string | null; fallback?: string; reveal: { text: string } }[] } };
    expect(previewed).toMatchObject({ ok: true, preview: { app: "slop", revision: item.revision } });
    expect(previewed.preview.probes.map(p => p.memberId).sort()).toEqual([rae, sam].sort());
    for (const p of previewed.preview.probes) expect(p.text).toMatch(/^(?![\s\S]*\b(Rae|Sam)\b)[\s\S]*\?/);
    for (const p of previewed.preview.probes) {
      expect(p.reveal.text).toContain(REVEAL_PLACE_PLACEHOLDER);
      expect(p.reveal.text).toContain(REVEAL_TIME_PLACEHOLDER);
      expect(p.reveal.text).toContain(p.memberId === rae ? "Sam" : "Rae");
    }
    expect((await sql`select count(*)::int as n from network.staff_audit where action = 'read_review_probes' and target_id = ${item.oppId}`)[0].n).toBe(2);
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
    const literal = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const p of previewed.preview.probes) {
      const template = p.reveal.text.split(REVEAL_PLACE_PLACEHOLDER).map(part => part.split(REVEAL_TIME_PLACEHOLDER).map(literal).join(".+?")).join(".+?");
      const reveal = (await inbox(p.memberId)).find(m => m.opp === item.oppId && /You're both in/.test(m.body))!.body;
      expect(reveal).toMatch(new RegExp(`(^|\\. )${template}(\\n\\S+)?$`));
    }
    // The first probe each member got is the text the reviewer read. The member asked first gets it word
    // for word; the second member is offered only the times the first one picked.
    const firstProbe = async (id: string) => (await inbox(id)).find(m => m.opp === item.oppId)?.body ?? "";
    const withoutTimes = (t: string | null) => t?.replace(/: coffee, [^.]+\./, ": coffee, <times>.");
    const delivered = await Promise.all(previewed.preview.probes.map(async p => ({ p, got: await firstProbe(p.memberId) })));
    for (const { p, got } of delivered) expect(withoutTimes(got)).toBe(withoutTimes(p.text));
    expect(delivered.filter(({ p, got }) => got === p.text).length).toBeGreaterThanOrEqual(1);
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
    const syntheticHistory = new OutboundQueue({ sql, clock, app: "slop", line: "+12125550160", checks: { live: () => false },
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
    await noModelCalls();
    await s.close(); svc = undefined;
  }, T);

  test.skipIf(!LIVE_JUDGE)("join, onboard, live review judge: one decided judgment per packet, then a recorded approval or a staff exception", async () => {
    const clock = new SimClock(START);
    const ledger = new CostLedger({ sink: new PgCostSink(sql), clock });
    const s = svc = new NetworkService({
      url: URL_, clock, instance: "slop-date-live-judge", log: () => {},
      env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: "synthetic-slop-live-judge-turn-signing-secret",
        NETWORK_REVIEW_JUDGE_BUDGET_USD: process.env.NETWORK_REVIEW_JUDGE_BUDGET_USD, NETWORK_REVIEW_JUDGE_MAX_REQUESTS: process.env.NETWORK_REVIEW_JUDGE_MAX_REQUESTS },
      networks: [{ id: "slop:nyc" }], tokens: `admin:${ADMIN},reviewer:${REVIEWER},safety:${SAFETY}`, webhookSecret: SECRET, network: { seed: 4 }, photoStorage: null, notify: false,
      adapter: () => new DryRunAdapter(() => {}),
      reviewJudge: modelReviewJudge(judgeLLM(ledger.llmHooks("slop", "review_judge")), process.env.JUDGE_MODEL ?? DEFAULT_MODEL),
      engineJudge: recommenderLLM({ ...ledger.llmHooks("slop", "engine_judge"), budget: new LLMBudget({ maxCostMicro: 250_000, maxRequests: 12 }) }),
    });
    await s.start();
    const LEE = "+12125550165", MAX = "+12125550166";
    for (const [e164, answers] of [
      [LEE, ["slop", "Lee, 30", "I'm a woman into men. Live in Fort Greene, love running and jazz", "I'm a woman looking for men, 27 to 38, within 5 miles of 11205", "Something serious", "Weekday evenings work best"]],
      [MAX, ["slop", "Max, 32", "I'm a man into women. Clinton Hill, I run and go to jazz bars", "I'm a man looking for women, 25 to 35, within 5 miles of 11238", "A relationship", "Weekday evenings work best"]],
    ] as const) for (const body of answers) await text(s, clock, e164, body);
    const lee = (await memberId(LEE))!, max = (await memberId(MAX))!;
    expect([lee, max]).toEqual([expect.any(String), expect.any(String)]);
    expect((await staff(s, ADMIN, "POST", "/apps/slop/matching", { on: true })).status).toBe(200);
    type JudgmentRow = { opportunity_id: string; revision: number; packet_hash: string; status: string; claims: number; verdict: string | null; reason: string | null; model: string | null; rubric: string };
    const pairRows = async () => await sql`select j.opportunity_id, j.revision, j.packet_hash, j.status, j.claims, j.verdict, j.reason, j.model, j.rubric
      from network.review_judgments j where j.app_id = 'slop' and ${lee} = any(j.member_ids) and ${max} = any(j.member_ids)
      order by j.claimed_at` as JudgmentRow[];
    let rows: JudgmentRow[] = [];
    for (let i = 0; i < 12 && !rows.some(r => r.status === "decided"); i++) {
      await run(s, clock, 2 * HOUR);
      rows = await pairRows();
    }
    const decided = rows.filter(r => r.status === "decided");
    expect(decided.length).toBeGreaterThan(0);
    expect(new Set(rows.map(r => `${r.opportunity_id}:${r.revision}:${r.packet_hash}`)).size).toBe(rows.length);
    for (const r of decided) {
      expect(["approve", "flag", "undecided", "cannot_run"]).toContain(r.verdict);
      expect(r.rubric).toBe("adult");
      expect(r.claims).toBeLessThanOrEqual(1);
    }
    const first = decided[0]!;
    await run(s, clock, HOUR);
    const contacted = (await sql`select count(*)::int as n from network.messages where app_id = 'slop' and opportunity_id = ${first.opportunity_id} and direction = 'outbound'`)[0].n as number;
    const queue = await (await staff(s, REVIEWER, "GET", "/apps/slop/review")).json() as { items?: { oppId: string; exception?: { verdict: string; reason: string } }[] };
    const held = (queue.items ?? []).find(x => x.oppId === first.opportunity_id);
    expect(first.verdict === "approve" ? contacted > 0 && !held : contacted === 0 && held?.exception?.reason === first.reason).toBe(true);
    const audited = (await sql`select count(*)::int as n from network.staff_audit where actor = 'review_judge' and action = 'review_judgment' and target_id = ${first.opportunity_id}`)[0].n as number;
    expect(audited).toBe(decided.filter(r => r.opportunity_id === first.opportunity_id).length);
    const [requests] = await sql`select coalesce(sum(n), 0)::int as n from network.review_judge_requests where app_id = 'slop'` as { n: number }[];
    expect(requests!.n).toBeLessThanOrEqual(Number(process.env.NETWORK_REVIEW_JUDGE_MAX_REQUESTS));
    const spend = await sql`select detail->>'purpose' as purpose, count(*)::int as attempts, sum(cost_usd)::float8 as usd from network.cost_ledger
      where app_id = 'slop' and kind = 'llm' group by detail->>'purpose' order by 1` as { purpose: string; attempts: number; usd: number }[];
    const spendOf = (purpose: string) => spend.find(row => row.purpose === purpose) ?? { purpose, attempts: 0, usd: 0 };
    expect(spendOf("engine_judge").attempts).toBeGreaterThan(0);
    expect(spendOf("engine_judge").attempts).toBeLessThanOrEqual(12);
    expect(spendOf("engine_judge").usd).toBeGreaterThan(0);
    expect(spendOf("engine_judge").usd).toBeLessThanOrEqual(0.25);
    expect(spendOf("review_judge").attempts).toBeGreaterThan(0);
    expect(spendOf("review_judge").usd).toBeGreaterThan(0);
    expect(spendOf("review_judge").usd).toBeLessThanOrEqual(Number(process.env.NETWORK_REVIEW_JUDGE_BUDGET_USD));
    const runs = await sql`select r.summary->'matchingJudge' as judge from network.matching_runs r
      join network.opportunities o on o.run_id = r.id and o.app_id = r.app_id
      where o.app_id = 'slop' and o.id = ${first.opportunity_id}` as {
        judge: { model?: string; calls: number; failures: number; verdicts: number; selected: number; judged: number };
      }[];
    expect(runs).toHaveLength(1);
    const matchingJudge = runs[0]!.judge;
    expect(matchingJudge.calls).toBeGreaterThan(0);
    expect(matchingJudge.verdicts).toBeGreaterThan(0);
    expect(matchingJudge.selected).toBeGreaterThan(0);
    expect(matchingJudge.failures).toBe(0);
    expect(matchingJudge.judged).toBe(matchingJudge.selected);
    console.log(JSON.stringify({ scope: "slop-review-judge-live-matching-judge", ...matchingJudge }));
    console.log(JSON.stringify({ scope: "slop-review-judge-live", model: process.env.JUDGE_MODEL ?? DEFAULT_MODEL, judgments: decided.map(r => ({ verdict: r.verdict, reason: r.reason, model: r.model })), contacted, held: !!held, requests: requests!.n, spend }));
    await s.close(); svc = undefined;
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
    const adapter = new BlooioAdapter({ app: "slop", from: "+12125550169", clock, log: () => {}, provider: {
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
