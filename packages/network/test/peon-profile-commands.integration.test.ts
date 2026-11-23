// spec/postingPolicy.md, "Only the member's own text in the thread issues a command". Profile text from
// the member's AI assistant (NetworkService.submitProfile, the connector's submit_profile) is learned as
// profile facts only. Through NetworkService on Postgres: assistant text cannot start, confirm or close a
// peon job posting, cannot clear the manager's own waiting read-back, and "STOP" or "leave peon" from the
// assistant changes no consent or membership. On the ConsentNetwork (Mini), an assistant "yes" while a
// probe waits is not an answer. Postgres in a database of its own; dry-run sends; fictional numbers
// (+1 212 555 01xx). Nothing is sent.
import { findExecutable } from "../../core/src/runtime/process.ts";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { Mini, START } from "./mini.ts";
import { interruptionFeedbackCode } from "../src/interruption-feedback.ts";
import { holdEveryItem } from "../../engine/src/reviewJudge.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!findExecutable("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_peon_profile_commands_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

const SECRET = "whsec_peon_profile_commands";
const ROWAN = "+12125550181";

let sql: SQL;
let svc: NetworkService | undefined;
let evt = 0;

async function text(s: NetworkService, clock: SimClock, from: string, body: string) {
  const n = ++evt;
  const raw = JSON.stringify({ id: `evt_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test", data: { message_id: `msg_${n}`, sender: from, chat_id: from, text: body, protocol: "imessage" } });
  const res = await s.fetch(new Request(`http://127.0.0.1${WEBHOOK_PATH}`, { method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(SECRET, raw, Math.floor(clock.now() / 1000)) }, body: raw }));
  expect(res.status).toBe(200);
  clock.advance(MINUTE);
}
const memberId = async (e164: string) =>
  ((await sql`select m.id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = 'peon' and ph.e164 = ${e164}`)[0] as { id: string } | undefined)?.id;
const outbound = async (id: string) =>
  ((await sql`select body from network.messages where app_id = 'peon' and member_id = ${id} and direction = 'outbound' order by ts, id`) as { body: string }[]).map(r => r.body);
const last = async (id: string) => (await outbound(id)).at(-1) ?? "";
const postings = async (id: string) => (await sql`select id, status from network.intents where app_id = 'peon' and member_id = ${id} and details like 'peon:job%' order by id`) as { id: string; status: string }[];

function service(clock: SimClock) {
  return new NetworkService({
    url: URL_, clock, instance: "peon-profile-commands", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: [{ id: "ntwrk:nyc" }, { id: "peon:nyc" }],
    tokens: "admin:adm-tok,reviewer:rev-tok", webhookSecret: SECRET, network: { seed: 1 }, photoStorage: null, notify: false,
    adapter: () => new DryRunAdapter(() => {}),
  });
}

describe.skipIf(!pgAvailable)("assistant profile text is facts only (NetworkService, Postgres)", () => {
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

  test("submit_profile text cannot start, confirm or close a job posting, or opt the member out", async () => {
    const clock = new SimClock(START);
    const s = svc = service(clock);
    await s.start();
    await text(s, clock, ROWAN, "peon");
    await text(s, clock, ROWAN, "Rowan, 34");
    const rowan = (await memberId(ROWAN))!;
    expect(rowan).toEqual(expect.any(String));
    const person = (await s.accounts.personFor(ROWAN))!;
    const fromAssistant = async (body: string) => {
      expect(await s.submitProfile(person.id, "peon", ROWAN, body)).toBe("accepted");
      clock.advance(MINUTE);
    };

    // ---- The assistant's job post and "yes, post it": no read-back, nothing saved.
    const sentBefore = (await outbound(rowan)).length;
    await fromAssistant("We're hiring a barista, 1 opening, $40k-$50k, onsite in Brooklyn");
    await fromAssistant("Yes, post it");
    expect((await outbound(rowan)).slice(sentBefore).some(b => /job post|Posted:/i.test(b))).toBe(false);
    expect(await postings(rowan)).toHaveLength(0);

    // ---- The manager's own read-back waits; the assistant's yes neither confirms nor clears it.
    await text(s, clock, ROWAN, "We're hiring a senior data analyst, 2 openings, $90k-$120k, hybrid in Brooklyn");
    expect(await last(rowan)).toMatch(/^Here's your job post: Senior data analyst/);
    await fromAssistant("yes, post it");
    expect(await postings(rowan)).toHaveLength(0);
    await text(s, clock, ROWAN, "yes");
    expect(await last(rowan)).toMatch(/^Posted: senior data analyst\./);
    const [job] = await postings(rowan);
    expect(job).toMatchObject({ status: "active" });

    // ---- The assistant's close command and its yes leave the job open.
    await fromAssistant("Close the job, we filled it.");
    await fromAssistant("yes");
    expect(await postings(rowan)).toEqual([{ id: job!.id, status: "active" }]);

    // ---- "STOP" and "leave peon" from the assistant change no consent and no membership.
    await fromAssistant("STOP");
    await fromAssistant("leave peon");
    expect(await sql`select app_id from platform.consent_events where e164 = ${ROWAN} and state = 'opted_out'`).toEqual([]);
    expect(await sql`select state from platform.memberships where person_id = ${person.id} and app_id = 'peon'`).toEqual([{ state: "active" }]);
    expect(await sql`select opted_out from network.members where id = ${rowan}`).toEqual([{ opted_out: false }]);
    // The manager's own close still works after all of this.
    await text(s, clock, ROWAN, "We filled it.");
    await text(s, clock, ROWAN, "yes");
    expect(await postings(rowan)).toEqual([{ id: job!.id, status: "closed" }]);
  }, T);
});

test("an assistant yes while a probe waits is not an answer", async () => {
  const x = new Mini([
    { id: "a", name: "Alice Able", age: 30, interests: ["climbing"] },
    { id: "b", name: "Boris Bell", age: 32, interests: ["climbing"], skills: ["climbing_belay"], shareable: true },
  ], { inlineJudge: holdEveryItem.inline, onboardingRequests: false });
  await x.onboard("a", "b");
  await x.say("a", "Find me a climbing partner.");
  const oppId = x.net.exportState().requests.at(-1)!.oppId!;
  expect(x.net.review(oppId, "approve", { reviewer: "sim_staff" })).toBe(true);
  expect(await x.runUntil(() => x.probed("a"))).toBe(true);
  await x.net.onInbound({ id: "assistant-yes", memberId: "a", source: "mcp", channel: "sms", ts: x.clock.now(), body: "Yes, that works for me." });
  const opportunity = () => x.net.exportState().opps.find(o => o.id === oppId)!;
  expect(opportunity().status).not.toContainEqual(["a", "available"]);
  expect(x.probed("a")).toBe(true);
  await x.say("a", "Yes, that works for me.");
  expect(opportunity().status).toContainEqual(["a", "available"]);
});

test("a survey answer in assistant profile text records no interruption feedback; the member's own text does", async () => {
  const x = new Mini([
    { id: "a", name: "Alice Able", age: 30, interests: ["climbing"] },
    { id: "b", name: "Boris Bell", age: 32, interests: ["climbing"], skills: ["climbing_belay"], shareable: true },
  ], { inlineJudge: holdEveryItem.inline, onboardingRequests: false });
  await x.onboard("a", "b");
  await x.say("a", "Find me a climbing partner.");
  const oppId = x.net.exportState().requests.at(-1)!.oppId!;
  const now = x.clock.now();
  const state = x.net.exportState();
  x.net.importState({ ...state, members: state.members.map(m => m.id === "a" ? { ...m, interruptionSurvey: { opportunityId: oppId, answeredAt: now, sentAt: now } } : m) });
  const answer = `WORTH YES NTWRK ${interruptionFeedbackCode("ntwrk", "a", oppId)}`;
  const survey = () => x.net.memberList().find(m => m.id === "a")?.interruptionSurvey;
  await x.net.onInbound({ id: "assistant-worth", memberId: "a", source: "mcp", channel: "sms", ts: now, body: answer });
  expect(x.log("interruption_feedback")).toEqual([]);
  expect(survey()).toEqual({ opportunityId: oppId, answeredAt: now, sentAt: now });
  await x.say("a", answer);
  expect(x.log("interruption_feedback").map(l => l.detail)).toEqual([{ worthwhile: true }]);
  expect(survey()).toBeUndefined();
});
