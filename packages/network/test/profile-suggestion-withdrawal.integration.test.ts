/** V2 intake withdrawal: actual SQL/service route with only the external Cloud event proof faked. */
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { SQL } from "bun";
import { createHash, randomUUID } from "node:crypto";
import { applySchema, devPgUp, DEV_PG_PORT } from "../../observatory/db/dev-pg.ts";
import { SimClock } from "@thenetwork/core";
import { svcSign, svcVerify } from "../../core/src/svc/svc-auth.ts";
import { PROFILE_REVIEW_WITHDRAWAL_PATH, PROFILE_REVIEW_WITHDRAWAL_PROOF_PATH,
  parseProfileReviewWithdrawalProofRequest, type ProfileReviewWithdrawalRequest } from "../../core/src/svc/profile-review-withdrawal.ts";
import { ProfileSuggestions, type SuggestionOwner, type SourceSuggestion } from "../service/profile-suggestions.ts";
import { profileReviewFactory } from "../service/profile-review-factory.ts";
import { NetworkService } from "../service/service.ts";
const now = Date.UTC(2026, 9, 20, 12), cutoffAt = now - 1000, secret = "synthetic-withdrawal-secret-".repeat(3);
const base = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}`, db = `profile_withdrawal_${process.pid}`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
let sql: SQL, owner: SuggestionOwner, connectionId: string;
beforeAll(async () => { await devPgUp(); const admin = new SQL(`${base}/postgres`); await admin.unsafe(`create database ${db}`); await admin.close(); sql = new SQL(`${base}/${db}`); });
beforeEach(async () => {
  await applySchema(`${base}/${db}`, { reset: true });
  owner = { personId: randomUUID(), app: "friends", userId: randomUUID(), organizationId: randomUUID(), chatId: `personal:${randomUUID()}` }; connectionId = randomUUID();
  await sql`insert into platform.people(id,lowest_age,phone_hash) values(${owner.personId},30,'withdrawal-fixture-phone')`;
  await sql`insert into platform.memberships(person_id,app_id,member_id,state,first_name,profile) values(${owner.personId},'friends','member-one','active','Alex','{}')`;
  await sql`insert into network.members(id,app_id,person_id,name,age,home_city,account_status) values('member-one','friends',${owner.personId},'Alex',30,'nyc','active')`;
});
afterAll(async () => { await sql.close(); const admin = new SQL(`${base}/postgres`); await admin.unsafe(`drop database ${db}`); await admin.close(); });
async function seed(retain: boolean, accepted: boolean, createdAt = now - 2000) {
  const store = new ProfileSuggestions(sql, async () => true);
  const suggestion: SourceSuggestion = { connectionId, source: "gmail", observedAt: createdAt - 1000, kind: "interest", value: "I enjoy climbing", tags: ["climbing"], confidence: .8, scope: "agent_private" };
  const b = (await store.propose(owner, { windowStart: createdAt - 5000, windowEnd: createdAt, timezone: "America/Los_Angeles", expiresAt: now + 60_000,
    retainOnDisconnect: retain, allowedKinds: ["interest"], suggestions: [suggestion] }, createdAt))!;
  if (accepted) expect((await store.decide(owner, { batchId: b.id, revision: b.revision, decisions: [{ suggestionId: b.suggestions[0]!.id, action: "accept" }] }, createdAt)).kind).toBe("saved");
  return b;
}
async function fixture() {
  const clock = new SimClock(now), policy = { authority: { version: 1 as const, routeId: "withdrawal-fixture", generation: "one", audience: "withdrawal-fixture", realmId: "fixture-realm" }, admitUntil: now + 120_000, drainUntil: now + 180_000 };
  let calls = 0, activeSourceCalls = 0, signed = true;
  let alter: (proof: Record<string, unknown>, call: number) => void = () => {};
  const contexts = new Map<string, { channel: "blooio"; messageId: string; commandSha256: string }>();
  const cloud = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    calls++; expect(new URL(req.url).pathname).toBe(PROFILE_REVIEW_WITHDRAWAL_PROOF_PATH);
    const raw = await req.text(), wrapper = parseProfileReviewWithdrawalProofRequest(JSON.parse(raw));
    const auth = await svcVerify(secret, { method: "POST", path: PROFILE_REVIEW_WITHDRAWAL_PROOF_PATH, headers: req.headers, body: raw, nowS: Math.floor(clock.now()/1000) });
    if (!wrapper || !auth.ok || auth.id !== `learning-withdrawal:${wrapper.request.requestNonce}`) return new Response(null, { status: 403 });
    const proof: Record<string, unknown> = { ...wrapper.request, purpose: "network-profile-review-withdrawal-v2", requestSha256: wrapper.requestSha256,
      userId: owner.userId, organizationId: owner.organizationId, chatId: owner.chatId, cutoffAt, issuedAt: clock.now(), expiresAt: clock.now()+10_000,
      ...contexts.get(wrapper.request.requestNonce) };
    alter(proof, calls); const body = JSON.stringify(proof);
    return new Response(body, { headers: signed ? await svcSign(secret, { method: "POST", path: PROFILE_REVIEW_WITHDRAWAL_PROOF_PATH, id: `${auth.id}:proof`, body, nowS: Math.floor(clock.now()/1000) }) : {} });
  } });
  const callbacks = profileReviewFactory({ origin: cloud.url.origin, secret, development: true, routePolicy: policy, now: () => clock.now() });
  const service = new NetworkService({ url: `${base}/${db}`, clock, notify: false, log: () => {}, networks: [{ id: "friends:nyc" }],
    env: { PLATFORM_ENV: "staging", PLATFORM_HASH_KEY: "synthetic-withdrawal-hash-".repeat(2), SERVICE_TURN_SECRET: secret, NETWORK_ROUTE_AUTHORITY_POLICY: JSON.stringify(policy) },
    profileSuggestionWithdrawalOwner: callbacks.profileSuggestionWithdrawalOwner,
    profileSuggestionAuthorization: async () => { activeSourceCalls++; return false; } });
  const http = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: service.fetch });
  const request = (operation: ProfileReviewWithdrawalRequest["operation"] = "withdraw"): ProfileReviewWithdrawalRequest => ({ version: 2, operation,
    app: owner.app, personId: owner.personId, memberId: "member-one", connectionId, withdrawalId: randomUUID(), requestNonce: randomUUID() });
  return { clock, request, get calls() { return calls; }, get activeSourceCalls() { return activeSourceCalls; }, setAlter(fn: typeof alter) { alter=fn; }, setSigned(value: boolean) { signed=value; },
    async prepare(input: ProfileReviewWithdrawalRequest) {
      if (contexts.has(input.requestNonce)) return contexts.get(input.requestNonce)!;
      // These are recorded natural-language commands, not an invented Network withdrawal grammar.
      const text = input.operation === "withdraw" ? "Stop using Gmail to learn about me" : input.operation === "delete" ? "Delete what you learned from Gmail" : "Show what learning remains";
      const context = { channel: "blooio" as const, messageId: `withdrawal-${input.requestNonce}`, commandSha256: sha(text) }; contexts.set(input.requestNonce, context);
      await sql`insert into platform.inbound(id,received_at,arrived_at,status,sender_hash,response,request_hash,network_authority)
        values(${`msg:blooio:${context.messageId}`},${new Date(cutoffAt)},${new Date(cutoffAt)},'done','withdrawal-fixture-phone',${{ outcome: 'open', app: owner.app, memberId: 'member-one' }}::jsonb,${sha('signed-'+context.messageId)},${policy.authority}::jsonb)`;
      await sql`insert into network.messages(id,app_id,member_id,direction,body,ts) values(${`in:blooio:${context.messageId}`},${owner.app},'member-one','inbound',${text},${new Date(cutoffAt)})`;
      return context;
    }, async post(input = request(), unsigned = false) {
      await this.prepare(input); const body = JSON.stringify(input);
      const response = await fetch(http.url.origin+PROFILE_REVIEW_WITHDRAWAL_PATH, { method:'POST',body,headers:unsigned?{}:await svcSign(secret,{method:'POST',path:PROFILE_REVIEW_WITHDRAWAL_PATH,id:`learning-withdrawal:${input.requestNonce}`,body,nowS:Math.floor(clock.now()/1000)}) });
      return { status:response.status,body:await response.json(),hash:sha(body) };
    }, async close() { http.stop(true); cloud.stop(true); await service.close(); } };
}

test("V2 withdrawal removes pending intake only and keeps accepted facts regardless of OAuth retention", async () => {
  await seed(true,true);await seed(false,true);await seed(false,false);const newer=await seed(false,false,now);
  const f=await fixture();try {
    const request=f.request();expect((await f.post(request)).body).toEqual({kind:'owner_withdrawal',operation:'withdraw',counts:{pending:0,retainedAccepted:2,linkedFacts:2}});
    expect(f.activeSourceCalls).toBe(0);expect(await sql`select id from network.facets`).toHaveLength(2);
    expect((await sql`select status from platform.profile_suggestions where batch_id=${newer.id}`)[0].status).toBe('proposed');
    expect((await f.post(request)).body).toEqual({kind:'owner_withdrawal',operation:'withdraw',counts:{pending:0,retainedAccepted:2,linkedFacts:2}});
    expect((await f.post({...request,requestNonce:randomUUID()})).status).toBe(403);
    const before=await sql`select id,action_receipts from platform.inbound order by id`;
    const read=f.request('readback');await f.prepare(read);const beforeRead=await sql`select id,action_receipts from platform.inbound order by id`;
    expect((await f.post(read)).body.counts).toEqual({pending:0,retainedAccepted:2,linkedFacts:2});
    expect(await sql`select id,action_receipts from platform.inbound order by id`).toEqual(beforeRead);
    const del=await f.post(f.request('delete'));expect(del.body.counts).toEqual({pending:0,retainedAccepted:0,linkedFacts:0});
    expect(await sql`select id from network.facets`).toHaveLength(0);
    expect((await sql`select status from platform.profile_suggestions where batch_id=${newer.id}`)[0].status).toBe('proposed');
    expect(before.length).toBeGreaterThan(0);
  }finally{await f.close();}
});

test("V2 canonical turn, route, event, hash and immutable cutoff guards deny or roll back real SQL",async()=>{
  await seed(false,true);await seed(false,false);const f=await fixture();try {
    const request=f.request();const context=await f.prepare(request);
    f.setAlter((proof,call)=>{if(call===3)proof.cutoffAt=now;});expect((await f.post(request)).status).toBe(403);
    expect(await sql`select id from network.facets`).toHaveLength(1);
    expect((await sql`select action_receipts from platform.inbound where id=${`msg:blooio:${context.messageId}`}`)[0].action_receipts).toEqual({});
    f.setAlter(()=>{});
    await sql`update network.messages set body='different stored command' where id=${`in:blooio:${context.messageId}`}`;
    expect((await f.post(request)).status).toBe(403);
    expect(await sql`select id from network.facets`).toHaveLength(1);
    for(const patch of [{withdrawalId:randomUUID()},{requestSha256:'0'.repeat(64)},{personId:randomUUID()},{operation:'delete'},{cutoffAt:now+1},{expiresAt:now}]) {
      f.setAlter(proof=>Object.assign(proof,patch));expect((await f.post()).status).toBe(403);
    }
    const ownerRead = f.calls + 1;
    f.setAlter((proof,call)=>{if(call>ownerRead)proof.userId=randomUUID();});expect((await f.post()).status).toBe(403);
    f.setAlter(()=>{});
    const foreign=f.request();const foreignContext=await f.prepare(foreign);
    await sql`update platform.inbound set network_authority=${{version:1,routeId:"foreign",generation:"other",audience:"other",realmId:"other"}}::jsonb where id=${`msg:blooio:${foreignContext.messageId}`}`;
    expect((await f.post(foreign)).status).toBe(403);
    f.setSigned(false);expect((await f.post()).status).toBe(403);expect(f.activeSourceCalls).toBe(0);
  }finally{await f.close();}
});

test("V2 post-write expiry rolls back while OAuth-V1 proofs cannot authorize withdrawal",async()=>{
  await seed(false,false);const f=await fixture();try {
    f.setAlter((_proof,call)=>{if(call===3)f.clock.advance(20_000);});const request=f.request();const context=await f.prepare(request);
    expect((await f.post(request)).status).toBe(403);
    expect((await sql`select status from platform.profile_suggestions`)[0].status).toBe('proposed');
    expect((await sql`select action_receipts from platform.inbound where id=${`msg:blooio:${context.messageId}`}`)[0].action_receipts).toEqual({});
    f.setAlter(proof=>{proof.version=1;proof.purpose='network-profile-review-revoked-owner-v1';});expect((await f.post()).status).toBe(403);
  }finally{await f.close();}
});


test("V2 withdrawal service route is unavailable by default and does not alias OAuth V1",async()=>{
  const service=new NetworkService({url:`${base}/${db}`,clock:new SimClock(now),notify:false,log:()=>{},networks:[{id:"friends:nyc"}],env:{PLATFORM_ENV:"dev",SERVICE_TURN_SECRET:secret}});
  try{expect((await service.fetch(new Request("http://fixture.invalid"+PROFILE_REVIEW_WITHDRAWAL_PATH,{method:"POST",body:"{}"}))).status).toBe(503);}
  finally{await service.close();}
});

test("V2 withdrawal refuses arrays where strings are expected, in the request and in the Cloud proof",async()=>{
  await seed(false,true);const f=await fixture();try {
    // String(["friends"]) is "friends": the parsers must test the type, not the text form.
    for(const patch of [{app:[owner.app]},{operation:["readback"]}]) {
      expect((await f.post({...f.request(),...patch} as unknown as ProfileReviewWithdrawalRequest)).status).toBe(400);
    }
    expect(f.calls).toBe(0);
    f.setAlter(proof=>{proof.channel=[proof.channel];});expect((await f.post()).status).toBe(403);
    expect(await sql`select id from network.facets`).toHaveLength(1);
  }finally{await f.close();}
});
