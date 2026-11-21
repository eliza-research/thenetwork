// spec/peonHireDispatch.md and spec/peonCandidateSearch.md through the real service on Postgres: the
// shared line's signed turns (/internal/turn), the staff API under /apps/peon and the Blooio queue with a
// simulated provider. An employer posts a job on the line, staff verify the employer, a candidate saves a
// search, the proposal waits for human review, the candidate hears first, then the employer, and the
// introduction goes out only after both yeses. The refusals: an unverified employer, a minor, an unknown
// age, a banned number, a posting closed during review, and STOP from either side. Fictional numbers.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { TURN_PATH, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { pgAvailable } from "../../observatory/test/pg.ts";
import { BlooioAdapter, DryRunAdapter, type Delivery, type Outbound } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";

const database = `network_peon_hire_${randomUUID().replaceAll("-", "")}`;
const local = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}`;
const url = `${local}/${database}`;
const secret = "peon-hire-journey-signed-fixture";
const clock = new SimClock(Date.UTC(2026, 10, 12, 17));
let admin: SQL, db: SQL, service: NetworkService;
const accepted = new Set<string>();
let turnId = 0;
let holdQueue = false;

class HoldingCarrier extends BlooioAdapter {
  override async deliver(messages: Outbound[]): Promise<Delivery[]> { return holdQueue ? [] : super.deliver(messages); }
}


function start() {
  service = new NetworkService({ url, clock, instance: "peon-hire-journey", log: () => {}, photoStorage: null, notify: false,
    tokens: "admin:adm-tok,safety:saf-tok", env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: secret },
    networks: [{ id: "ntwrk:nyc", matchingEnabled: false }, { id: "peon:nyc" }],
    adapter: (_net, rt) => rt.app.id === "peon" ? new HoldingCarrier({ from: "+12125550100", clock, app: "peon", liveGate: () => true,
      log: () => {}, provider: { kind: "sim", send: async request => {
        accepted.add(request.idempotencyKey);
        return { providerMessageId: request.idempotencyKey, status: "sent" };
      } },
    }) : new DryRunAdapter(() => {}),
  });
  return service.start();
}

async function turn(from: string, text: string) {
  const messageId = `hire-${++turnId}`;
  const payload: TurnRequest = { messageId, from, text, receivedAt: clock.now(), channel: "blooio", to: null, transport: "sms" };
  const body = JSON.stringify(payload);
  const res = await service.fetch(new Request(`http://127.0.0.1${TURN_PATH}`, { method: "POST", body, headers: {
    "content-type": "application/json",
    ...await svcSign(secret, { method: "POST", path: TURN_PATH, id: messageId, body, nowS: Math.floor(clock.now() / 1000) }),
  } }));
  const out = { status: res.status, body: await res.json() };
  clock.advance(MINUTE);
  return out;
}

const staff = (path: string, body?: object, token = "adm-tok") => service.fetch(new Request(`http://127.0.0.1/apps/peon${path}`, {
  method: body ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
}));

beforeAll(async () => {
  if (!pgAvailable) return;
  await devPgUp();
  admin = new SQL({ url: `${local}/postgres`, max: 1 });
  await admin.unsafe(`create database ${database}`);
  await applySchema(url, { lockTimeout: "60s" });
  db = new SQL({ url, max: 2 });
  await start();
}, 120_000);

afterAll(async () => {
  await service?.close();
  await db?.close();
  await admin?.unsafe(`drop database if exists ${database} with (force)`);
  await admin?.close();
});

async function join(phone: string, line: string) {
  const r = await turn(phone, `join peon\n${line}`);
  return { body: r.body, id: (await service.memberApps(phone))[0]?.memberId as string | undefined };
}
async function postOnLine(phone: string, role: string) {
  const readBack = await turn(phone, `We're hiring a ${role}, level 2, 3 openings, $90k-$125k, remote. Must have SQL level 2`);
  expect(readBack.body.replies[0]).toMatch(/^Here's your job post: .*Reply yes to post it/);
  const saved = await turn(phone, "yes");
  expect(saved.body.replies[0]).toMatch(new RegExp(`^Posted: ${role}\\.`));
}
const verify = async (memberId: string, company: string) =>
  expect(await (await staff(`/employers/${memberId}/verify`, { company, note: "Verified by a staff reviewer." })).json()).toEqual({ ok: true });
async function saveSearch(phone: string, role: string) {
  const draft = await turn(phone, `PEON JOB SEARCH ${role}; level 2; minimum $85,000; mode remote; skills sql=4`);
  const proof = /CONFIRM PEON JOB SEARCH search_[a-p]{16}/.exec(draft.body.replies?.[0] ?? "")?.[0];
  return proof ? (await turn(phone, proof)).body.replies : draft.body.replies;
}
type ReviewItem = { oppId: string; revision: number; proposal: { participants: string[] } };
const reviewItems = async () => (await (await staff("/review")).json()).items as ReviewItem[];
const decide = async (item: ReviewItem) =>
  (await staff(`/review/${encodeURIComponent(item.oppId)}`, { decision: "approve", revision: item.revision })).json();
const messagesOf = (oppId: string) => db`select m.member_id as "to", m.type, m.body, o.status from network.messages m
  left join platform.outbound o on o.app_id=m.app_id and o.id=m.id where m.app_id='peon' and m.opportunity_id=${oppId} order by m.ts, m.id`;
const stateOf = async (oppId: string) => (await db`select state from network.opportunities where app_id='peon' and id=${oppId}`)[0]?.state;
const searches = (memberId: string) => db`select status from network.intents where app_id='peon' and member_id=${memberId} and details='peon:search'`;
const runtime = () => service.runtimeFor("peon")!;
async function matchingDay(phones: readonly string[]) {
  const queue = (runtime().adapter as BlooioAdapter).queue;
  for (const phone of phones) await queue.inbound(phone);
  // The next matching day at 14:00 in New York, inside the members' send window, so an approved probe leaves at once.
  const day = Math.floor((clock.now() + 24 * HOUR) / (24 * HOUR)) * 24 * HOUR + 19 * HOUR;
  clock.advance((day >= clock.now() + 24 * HOUR ? day : day + 24 * HOUR) - clock.now());
  await runtime().tick();
  return reviewItems();
}
const pairOf = (items: ReviewItem[], candidate: string, employer: string) =>
  items.find(item => item.proposal.participants.includes(candidate) && item.proposal.participants.includes(employer));

test.skipIf(!pgAvailable)("a posting confirmed on the line reaches an introduction only after review and both yeses", async () => {
  const employerPhone = "+12125550191", candidatePhone = "+12125550192", minorPhone = "+12125550193", unknownAgePhone = "+12125550194";
  expect((await staff("/matching", { on: true })).status).toBe(200);
  const employer = (await join(employerPhone, "My name is Sam. I am 36 years old.")).id!;
  await postOnLine(employerPhone, "data analyst");
  await verify(employer, "Acme");
  const candidate = (await join(candidatePhone, "My name is Rae. I am 29 years old.")).id!;
  expect(await saveSearch(candidatePhone, "data analyst")).toEqual(["I saved your Peon job search. I'll ask you before any introduction."]);

  // A minor joins Peon but cannot save a search; a person who gives no age is not a member and saves nothing.
  const minor = (await join(minorPhone, "My name is Kim. I am 16 years old.")).id!;
  expect(await saveSearch(minorPhone, "data analyst")).toEqual([]);
  expect(await searches(minor)).toEqual([]);
  const unknownAge = await join(unknownAgePhone, "My name is Uma.");
  expect(unknownAge.body).toMatchObject({ reason: "onboarding_asked", memberId: null });
  expect(unknownAge.id).toBeUndefined();
  expect(await saveSearch(unknownAgePhone, "data analyst")).toEqual([]);
  expect(await db`select 1 from network.intents where app_id='peon' and details='peon:search' and member_id<>${candidate}`).toEqual([]);

  const items = await matchingDay([employerPhone, candidatePhone, minorPhone, unknownAgePhone]);
  const item = pairOf(items, candidate, employer)!;
  expect(item).toBeDefined();
  expect(items.flatMap(i => i.proposal.participants)).not.toContain(minor);
  // The proposal waits for a person on the team: nothing is queued for either side before the decision.
  await runtime().deliver();
  expect(await messagesOf(item.oppId)).toEqual([]);

  expect(await decide(item)).toEqual({ ok: true });
  await runtime().deliver();
  const first = await messagesOf(item.oppId);
  expect(first).toEqual([expect.objectContaining({ to: candidate, type: "probe", status: "sent" })]);
  expect(first[0]!.body).not.toContain("Sam");

  await turn(candidatePhone, "Yes");
  await runtime().deliver();
  const employerProbe = (await messagesOf(item.oppId)).find(m => m.to === employer);
  expect(employerProbe).toMatchObject({ type: "probe", status: "sent" });
  expect(employerProbe!.body).not.toContain("Rae");

  const intro = await turn(employerPhone, "Yes");
  expect(intro.body.replies[0]).toContain("Rae");
  await runtime().deliver();
  const introductions = (await messagesOf(item.oppId)).filter(m => m.type === "proposal");
  expect(introductions).toHaveLength(2);
  expect(introductions).toEqual(expect.arrayContaining([
    expect.objectContaining({ to: candidate, body: expect.stringContaining("Sam"), status: "sent" }),
    expect.objectContaining({ to: employer, body: expect.stringContaining("Rae") }),
  ]));
  expect(await stateOf(item.oppId)).toBe("SCHEDULED");
}, 300_000);

test.skipIf(!pgAvailable)("an unverified employer, a ban, a posting closed during review and STOP from either side stop the introduction", async () => {
  const roles = ["software engineer", "accountant", "registered nurse", "customer support", "sales rep"] as const;
  const [unverified, banned, closed, candidateStop, employerStop] = roles.map((role, n) => ({
    role, employerPhone: `+121255502${String(n * 2).padStart(2, "0")}`, candidatePhone: `+121255502${String(n * 2 + 1).padStart(2, "0")}`,
    employer: "", candidate: "",
  }));
  const cases = [unverified!, banned!, closed!, candidateStop!, employerStop!];
  for (const [n, c] of cases.entries()) {
    c.employer = (await join(c.employerPhone, `My name is Em${"abcde"[n]}. I am 40 years old.`)).id!;
    await postOnLine(c.employerPhone, c.role);
    if (c !== unverified) await verify(c.employer, `Company ${n}`);
    c.candidate = (await join(c.candidatePhone, `My name is Ca${"abcde"[n]}. I am 30 years old.`)).id!;
    expect(await saveSearch(c.candidatePhone, c.role)).toEqual(["I saved your Peon job search. I'll ask you before any introduction."]);
  }
  const items = await matchingDay(cases.flatMap(c => [c.employerPhone, c.candidatePhone]));
  // An unverified employer's posting gets no proposal.
  expect(items.some(i => i.proposal.participants.includes(unverified!.candidate) || i.proposal.participants.includes(unverified!.employer))).toBe(false);
  const item = (c: typeof banned) => pairOf(items, c!.candidate, c!.employer)!;
  for (const c of [banned, closed, candidateStop, employerStop]) expect(item(c)).toBeDefined();

  // A number banned during review: the item leaves the queue, nobody hears, and the number cannot join again.
  expect(await (await staff("/safety/ban", { memberId: banned!.candidate, by: "phone", note: "Confirmed by staff." }, "saf-tok")).json()).toEqual({ ok: true });
  expect(await decide(item(banned))).toEqual({ ok: false, reason: "not_in_review" });
  await runtime().deliver();
  expect(await messagesOf(item(banned).oppId)).toEqual([]);
  expect((await turn(banned!.candidatePhone, "join peon\nMy name is Cab. I am 30 years old.")).body).toMatchObject({ reason: "held", replies: [], accountEligible: false });

  // The employer closes the posting on the line while the item waits: the approval finds nothing to send.
  expect((await turn(closed!.employerPhone, "We filled it.")).body.replies[0]).toMatch(/^Close your registered nurse post\?/);
  expect((await turn(closed!.employerPhone, "yes")).body.replies[0]).toMatch(/^Closed: registered nurse\./);
  expect(await decide(item(closed))).toEqual({ ok: false, reason: "not_in_review" });
  await runtime().deliver();
  expect(await messagesOf(item(closed).oppId)).toEqual([]);

  // The candidate says STOP after the role is offered: the employer never hears.
  expect(await decide(item(candidateStop))).toEqual({ ok: true });
  await runtime().deliver();
  expect((await turn(candidateStop!.candidatePhone, "STOP")).body).toMatchObject({ consent: { state: "opted_out", scope: "all" } });
  expect((await turn(candidateStop!.candidatePhone, "Yes")).body.replies).toEqual(["You're unsubscribed from peon, so I can't reply. Reply START to resume."]);
  await runtime().deliver();
  expect(await messagesOf(item(candidateStop).oppId)).toEqual([expect.objectContaining({ to: candidateStop!.candidate, type: "probe", status: "sent" })]);
  expect(await stateOf(item(candidateStop).oppId)).toBe("SKIPPED");

  // The employer says STOP after the blind summary: no name goes either way, and the candidate hears it did not come together.
  expect(await decide(item(employerStop))).toEqual({ ok: true });
  await runtime().deliver();
  await turn(employerStop!.candidatePhone, "Yes");
  await runtime().deliver();
  expect((await turn(employerStop!.employerPhone, "STOP")).body).toMatchObject({ consent: { state: "opted_out", scope: "all" } });
  expect((await turn(employerStop!.employerPhone, "Yes")).body.replies).toEqual(["You're unsubscribed from peon, so I can't reply. Reply START to resume."]);
  await runtime().deliver();
  const after = await messagesOf(item(employerStop).oppId);
  expect(after.map(m => [m.to, m.type])).toEqual(expect.arrayContaining([[employerStop!.employer, "probe"], [employerStop!.candidate, "probe"], [employerStop!.candidate, "cancellation"]]));
  expect(after.filter(m => m.type === "proposal")).toEqual([]);
  expect(after.some(m => /Cae|Eme/.test(m.body))).toBe(false);
  expect(await stateOf(item(employerStop).oppId)).toBe("SKIPPED");

  // spec/peonHireDispatch.md, "A review covers this candidate search and these posting terms": the employer
  // changes the pay after the approval and before the queued offer leaves; the offer is suppressed.
  const changed = { role: "warehouse logistics", employerPhone: "+12125550210", candidatePhone: "+12125550211" };
  const changedEmployer = (await join(changed.employerPhone, "My name is Emf. I am 40 years old.")).id!;
  await postOnLine(changed.employerPhone, changed.role);
  await verify(changedEmployer, "Company 5");
  const changedCandidate = (await join(changed.candidatePhone, "My name is Caf. I am 30 years old.")).id!;
  await saveSearch(changed.candidatePhone, changed.role);
  const changedItem = pairOf(await matchingDay([changed.employerPhone, changed.candidatePhone]), changedCandidate, changedEmployer)!;
  expect(changedItem).toBeDefined();
  holdQueue = true;
  expect(await decide(changedItem)).toEqual({ ok: true });
  expect(await messagesOf(changedItem.oppId)).toEqual([expect.objectContaining({ to: changedCandidate, type: "probe", status: "pending" })]);
  expect((await turn(changed.employerPhone, "Update my job post: $95k-$130k")).body.replies[0]).toMatch(/\$95k-\$130k/);
  expect((await turn(changed.employerPhone, "yes")).body.replies[0]).not.toBe("");
  holdQueue = false;
  await runtime().deliver();
  expect(await messagesOf(changedItem.oppId)).toEqual([expect.objectContaining({ to: changedCandidate, type: "probe", status: "suppressed_ineligible" })]);

  // Verification is what held the first pair back: once staff verify the employer, the pair goes to review.
  await verify(unverified!.employer, "Company 0");
  expect(pairOf(await matchingDay([unverified!.employerPhone, unverified!.candidatePhone]), unverified!.candidate, unverified!.employer)).toBeDefined();
}, 300_000);

test.skipIf(!pgAvailable)("a Peon member whose age the platform does not know is never proposed for a fitting verified posting", async () => {
  expect((await staff("/matching", { on: true })).status).toBe(200);
  const role = "data analyst";
  const employerPhone = "+12125550220", adultPhone = "+12125550221", unknownPhone = "+12125550222";
  const employer = (await join(employerPhone, "My name is Emg. I am 41 years old.")).id!;
  await postOnLine(employerPhone, role);
  await verify(employer, "Company 6");
  const adult = (await join(adultPhone, "My name is Cag. I am 31 years old.")).id!;
  expect(await saveSearch(adultPhone, role)).toEqual(["I saved your Peon job search. I'll ask you before any introduction."]);
  const unknown = (await join(unknownPhone, "My name is Cah. I am 32 years old.")).id!;
  expect(await saveSearch(unknownPhone, role)).toEqual(["I saved your Peon job search. I'll ask you before any introduction."]);
  await db`update network.members set age = null where id = ${unknown}`;
  await db`update platform.people set lowest_age = null where id = (select person_id from network.members where id = ${unknown})`;
  await db`delete from platform.age_floor where phone_hash = (select p.phone_hash from network.members m join platform.people p on p.id = m.person_id where m.id = ${unknown})`;
  expect(await db`select age from platform.matching_ages where app_id = 'peon' and member_id = ${unknown}`).toEqual([{ age: null }]);
  await runtime().unitOfWork(net => {
    const saved = net.exportState();
    const member = saved.members.find(m => m.id === unknown)!;
    delete member.statedAge;
    member.ageUnknown = true;
    net.importState(saved);
  });

  const items = await matchingDay([employerPhone, adultPhone, unknownPhone]);
  const participants = items.flatMap(i => i.proposal.participants);
  expect(participants).toContain(adult);
  expect(participants).not.toContain(unknown);
  await runtime().deliver();
  expect(await db`select id from network.messages where app_id = 'peon' and member_id = ${unknown} and opportunity_id is not null`).toEqual([]);
}, 300_000);
