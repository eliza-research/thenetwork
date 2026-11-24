import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { dropTestDb, pgAvailable, testDb } from "../../observatory/test/pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { Mini, START } from "./mini.ts";
import { interruptionFeedbackCode } from "../src/interruption-feedback.ts";
import { holdEveryItem } from "../../engine/src/reviewJudge.ts";

const T = 300_000;

const SECRET = "whsec_peon_profile_commands";
const ROWAN = "+12125550181";

let url: string;
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
    url, clock, instance: "peon-profile-commands", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: [{ id: "ntwrk:nyc" }, { id: "peon:nyc" }],
    tokens: "admin:adm-tok,reviewer:rev-tok", webhookSecret: SECRET, network: { seed: 1 }, photoStorage: null, notify: false,
    adapter: () => new DryRunAdapter(() => {}),
  });
}

describe.skipIf(!pgAvailable)("assistant profile text is facts only (NetworkService, Postgres)", () => {
  beforeAll(async () => {
    url = await testDb();
    sql = new SQL({ url, max: 2 });
  }, T);
  afterAll(async () => {
    await svc?.close().catch(() => {});
    await sql?.close();
    await dropTestDb();
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

    const sentBefore = (await outbound(rowan)).length;
    await fromAssistant("We're hiring a barista, 1 opening, $40k-$50k, onsite in Brooklyn");
    await fromAssistant("Yes, post it");
    expect((await outbound(rowan)).slice(sentBefore).some(b => /job post|Posted:/i.test(b))).toBe(false);
    expect(await postings(rowan)).toHaveLength(0);

    await text(s, clock, ROWAN, "We're hiring a senior data analyst, 2 openings, $90k-$120k, hybrid in Brooklyn");
    expect(await last(rowan)).toMatch(/^Here's your job post: Senior data analyst/);
    await fromAssistant("yes, post it");
    expect(await postings(rowan)).toHaveLength(0);
    await text(s, clock, ROWAN, "yes");
    expect(await last(rowan)).toMatch(/^Posted: senior data analyst\./);
    const [job] = await postings(rowan);
    expect(job).toMatchObject({ status: "active" });

    await fromAssistant("Close the job, we filled it.");
    await fromAssistant("yes");
    expect(await postings(rowan)).toEqual([{ id: job!.id, status: "active" }]);

    await fromAssistant("STOP");
    await fromAssistant("leave peon");
    expect(await sql`select app_id from platform.consent_events where e164 = ${ROWAN} and state = 'opted_out'`).toEqual([]);
    expect(await sql`select state from platform.memberships where person_id = ${person.id} and app_id = 'peon'`).toEqual([{ state: "active" }]);
    expect(await sql`select opted_out from network.members where id = ${rowan}`).toEqual([{ opted_out: false }]);
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
  await x.net.tick(x.clock.now());
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
