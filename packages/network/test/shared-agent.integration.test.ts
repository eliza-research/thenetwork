// Real service, HTTP and PostgreSQL. Only OTP/provider delivery boundaries are controlled.
import {afterAll, beforeAll, expect, spyOn, test} from "bun:test";
import {randomUUID} from "node:crypto";
import {SQL} from "bun";
import {SimClock, MINUTE, DAY} from "@thenetwork/core";
import {applySchema, DEV_PG_PORT} from "../../observatory/db/dev-pg.ts";
import {APPS} from "../../platform/src/apps.ts";
import {svcSign} from "../../core/src/svc/svc-auth.ts";
import {TURN_PATH, TURN_RECEIPT_PATH, type TurnRequest, type TurnReceiptRequest} from "../../core/src/svc/contract.ts";
import {DryRunAdapter} from "../service/channel.ts";
import {NetworkService} from "../service/service.ts";
import {networkRoutePolicy, routeEnvelopeAllowed} from "../service/route-authority.ts";

const db = `network_signed_turn_${randomUUID().replaceAll("-", "")}`;
const admin = new SQL({url:`postgres://${process.env.USER ?? "postgres"}@127.0.0.1:${DEV_PG_PORT}/postgres`, max:1});
const url = `postgres://${process.env.USER ?? "postgres"}@127.0.0.1:${DEV_PG_PORT}/${db}`;
const secret = "synthetic-shared-agent-test-secret-20261009";
const clock = new SimClock(Date.UTC(2026, 9, 9, 16));
let sql: SQL, service: NetworkService, server: ReturnType<typeof Bun.serve>;
let escaped = 0, code = "";
const start = async (routePolicy?: Record<string, unknown>) => {
  // Only this test's newly created database changes realm markers. The service's
  // normal staging/database mismatch guard stays intact.
  const [realm] = await sql`select current_database() as database,value from platform.settings where key='environment'`;
  if (realm?.database !== db || !["dev","staging"].includes(realm.value)) throw new Error("Owned test realm required");
  await sql`update platform.settings set value=${routePolicy ? "staging" : "dev"} where key='environment'`;
  service = new NetworkService({url, clock, photoStorage:null, instance:"signed-turn-integration",
    env:{PLATFORM_ENV:routePolicy ? "staging" : "dev", PLATFORM_HASH_KEY:"synthetic-route-test-hash-key", CLEF_RATINGS:"off", SERVICE_TURN_SECRET:secret, ...(routePolicy ? {NETWORK_ROUTE_AUTHORITY_POLICY:JSON.stringify(routePolicy)} : {})}, networks:[{id:"ntwrk:nyc",matchingEnabled:false},{id:"slop:nyc",matchingEnabled:false},{id:"friends:nyc",matchingEnabled:false}],
    network:{seed:1}, publicApi:{minStartMs:0,minVerifyMs:0,otp:{name:"fixture",send:async () => {code="314159";return {code};}}},
    adapter:() => {const a=new DryRunAdapter(()=>{});a.direct=async()=>{escaped++;return "dry_run";};a.deliver=async rows=>{escaped+=rows.length;return rows.map(r=>({id:r.id,status:"dry_run"}));};return a;},log:()=>{},
  });
  await service.start();
  server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:req=>new URL(req.url).pathname.startsWith("/api/")?service.publicFetch(req):service.fetch(req)});
};
const turn = (id:string, from:string, text:string, app?:TurnRequest["app"]):TurnRequest => ({messageId:id,from,text,channel:"blooio",to:null,transport:"imessage",receivedAt:clock.now(),...(app?{app}:{})});
const post = async (input:TurnRequest, signedPath=TURN_PATH) => {
  const body=JSON.stringify(input);
  return fetch(new URL(TURN_PATH,server.url),{method:"POST",headers:{"content-type":"application/json",...await svcSign(secret,{method:"POST",path:signedPath,id:input.messageId,body,nowS:Math.floor(clock.now()/1000)})},body});
};
const receipt = async (input:TurnReceiptRequest) => {
  const body=JSON.stringify(input);
  return fetch(new URL(TURN_RECEIPT_PATH,server.url),{method:"POST",headers:{"content-type":"application/json",...await svcSign(secret,{method:"POST",path:TURN_RECEIPT_PATH,id:`${input.messageId}:receipt`,body,nowS:Math.floor(clock.now()/1000)})},body});
};
beforeAll(async()=>{await admin.unsafe(`create database ${db}`);console.info(`[owned-db] ${db}`);await applySchema(url,{lockTimeout:"5s"});sql=new SQL({url,max:2});await start();},120_000);
afterAll(async()=>{server?.stop(true);await service?.close();await sql?.close();await admin.close();}); // Keep this owned database for the source receipt.

test("signed turns collect direct replies, replay immutable JSON and isolate concurrent users/channels",async()=>{
  const input=turn("help-one","+12125550111","HELP");
  const r=await post(input);expect(r.status).toBe(200);expect(r.headers.get("cache-control")).toContain("no-store");
  const initial=await r.json() as any;
  expect(initial.outcome).toBe("handled");expect(initial.delivery).toBe("collected");expect(initial.replyKind).toBe("compliance");expect(initial.replies.length).toBe(1);expect(initial.replyIds.length).toBe(1);
  expect(await (await post(input)).json()).toEqual(initial);
  expect((await post({...input,text:"STOP"})).status).toBe(409);
  expect((await post(turn("bad-path","+12125550112","HELP"),"/wrong/internal/turn")).status).toBe(401);
  const two=await Promise.all([post(turn("parallel","+12125550113","HELP")),post(turn("parallel-other","+12125550114","HELP"))]);
  expect(two.map(r=>r.status)).toEqual([200,200]);
  const cross={...input,channel:"twilio" as const};expect((await post(cross)).status).toBe(200);
  const [row]=await sql`select sender,event,jsonb_typeof(response) as type,replies from platform.inbound where id='msg:blooio:help-one'`;
  expect(row.sender).toBeNull();expect(row.event).toBeNull();expect(row.type).toBe("object");expect(row.replies.length).toBe(1);
  expect(escaped).toBe(0);
},60_000);

test("canonical membership STOP is collected atomically and cannot drain to a provider on restart",async()=>{
  const phone="+12125550121";
  const call=async(path:string,body:unknown,cookie?:string)=>fetch(new URL(path,server.url),{method:"POST",headers:{host:"localhost:5102","content-type":"application/json",...(cookie?{cookie}:{})},body:JSON.stringify(body)});
  expect((await call("/api/auth/otp/start",{phone})).status).toBe(200);
  const login=await call("/api/auth/otp/verify",{phone,code});expect(login.status).toBe(200);
  const cookie=login.headers.get("set-cookie")!.split(";")[0]!;
  expect((await call("/api/join",{firstName:"Ari",age:29,consent:{sms:true,wording:APPS.slop.consent.text}},cookie)).status).toBe(200);
  const [member]=await sql`select m.id from network.members m join platform.phone_identities ph on ph.person_id=m.person_id where m.app_id='slop' and ph.e164=${phone}`;
  expect(member?.id).toBeDefined();
  const other=turn("other-app-help",phone,"HELP","friends");
  expect((await post(other)).status).toBe(200);
  const before=escaped;
  const input=turn("member-stop",phone,"STOP","slop"), response=await post(input);expect(response.status).toBe(200);
  const body=await response.json() as any;expect(body.replies.length).toBe(1);expect(body.accountEligible).toBe(false);expect(body.consent.scope).toBe("all");expect(body.consent.app).toBeNull();
  expect(await service.accounts.optedIn("slop",phone)).toBe(false);
  const rows=await sql`select status,inbound_id from network.messages where app_id='slop' and inbound_id='msg:blooio:member-stop'`;
  expect(rows.length).toBe(1);expect(rows[0].status).toBe("collected");
  expect((await sql`select id from platform.outbound where id=${body.replyIds[0]}`).length).toBe(0);
  const ack:TurnReceiptRequest={channel:input.channel,messageId:input.messageId,replyIds:body.replyIds,outcome:"unknown",providerMessageIds:[],historyRecorded:false};
  expect((await receipt({...ack,replyIds:["unrelated-output"]})).status).toBe(409);
  const unknown=await receipt(ack);expect(unknown.status).toBe(200);expect(await unknown.json()).toEqual({ok:true,replayed:false});
  expect((await sql`select status from network.messages where inbound_id='msg:blooio:member-stop'`)[0].status).toBe("send_unknown");
  const accepted={...ack,outcome:"accepted" as const,providerMessageIds:["synthetic-provider-receipt"]};
  expect((await receipt(accepted)).status).toBe(200);
  expect((await sql`select status from network.messages where inbound_id='msg:blooio:member-stop'`)[0].status).toBe("sent");
  expect(await (await receipt(accepted)).json()).toEqual({ok:true,replayed:true});
  expect((await receipt({...accepted,providerMessageIds:["altered-receipt"]})).status).toBe(409);
  expect(escaped).toBe(before);
  server.stop(true);await service.close();await start();expect(await (await post(input)).json()).toEqual(body);expect(escaped).toBe(before);
  // The canonical public leave path seals prior personal reply payloads, while STOP remains in force.
  expect((await call("/api/me/delete",{scope:"app"},cookie)).status).toBe(200);
  expect((await post(input)).status).toBe(409);
  const [erased]=await sql`select response,replies,receipt,sender_hash,member_id,app_id from platform.inbound where id='msg:blooio:member-stop'`;
  expect(erased.response).toBeNull();expect(erased.replies).toEqual([]);expect(erased.receipt).toBeNull();expect(erased.sender_hash).toBeNull();expect(erased.member_id).toBeNull();expect(erased.app_id).toBeNull();
  const [retained]=await sql`select response,replies,app_id from platform.inbound where id='msg:blooio:other-app-help'`;
  expect(retained.app_id).toBe("friends");expect(retained.response.outcome).toBe("handled");expect(retained.replies.length).toBe(1);
  expect(await service.accounts.optedIn("slop",phone)).toBe(false);
  server.stop(true);await service.close();await start();expect((await post(input)).status).toBe(409);expect(escaped).toBe(before);
},60_000);

test("a normal signed join reaches open context, and STOP revokes replay without rerunning the turn",async()=>{
  const phone="+12125550141", before=escaped;
  const first=await post(turn("friends-join-start",phone,"friends.help","friends"));expect(first.status).toBe(200);
  expect((await first.json() as any).reason).toBe("onboarding_asked");
  const joined=await post(turn("friends-join-profile",phone,"Noa, 29","friends"));expect(joined.status).toBe(200);
  const j=await joined.json() as any;expect(j.reason).toBe("joined");expect(j.replies.length).toBeGreaterThan(0);
  let n=0;
  for (const text of ["I enjoy hiking and cooking", "Saturday afternoons work for me", "Small groups are good"]) {
    clock.advance(MINUTE);expect((await post(turn(`friends-onboard-${++n}`,phone,text,"friends"))).status).toBe(200);
  }
  const input=turn("friends-open",phone,"Tell me something about the weather","friends");
  const r=await post(input);expect(r.status).toBe(200);const body=await r.json() as any;
  expect(body.outcome).toBe("open");expect(body.app).toBe("friends");expect(body.context.singlePlayer).toBe(false);expect(body.context.activeItems).toBeNull();
  expect(await (await post(input)).json()).toEqual(body);
  // Canonical receiving is a valid recipient role; the wire's open state must not disable its chat.
  await service.runtimes.get("friends:nyc")!.scoped(tx=>tx`update network.members set participation_state='receiving' where app_id='friends' and id=${body.memberId}`);
  const receiving=await post(turn("friends-receiving-open",phone,"Tell me something about the weather","friends"));expect(receiving.status).toBe(200);
  const receivingBody=await receiving.json() as any;expect(receivingBody.outcome).toBe("open");expect(receivingBody.context.state).toBe("open");
  expect((await post(turn("friends-stop",phone,"STOP","friends"))).status).toBe(200);
  expect((await post(input)).status).toBe(409);
  expect(escaped).toBe(before);
},60_000);

test("a committed collection followed by a fault stays unresolved and is never automatically rerun",async()=>{
  const original=service.inbound.bind(service);let handled=0;
  service.inbound=async(...args)=>{handled++;await original(...args);throw new Error("synthetic after-effect fault");};
  const input=turn("fault-after-effects","+12125550131","hello there");
  try {
    expect((await post(input)).status).toBe(409);expect((await post(input)).status).toBe(409);expect(handled).toBe(1);
    // A compliance turn (STOP, START, HELP, leave) whose reply committed before the fault is never sealed:
    // it answers with what committed (inbox.ts rescueCompliance), once, and is never rerun.
    const help=turn("fault-after-help","+12125550132","HELP");
    const rescued=await post(help);expect(rescued.status).toBe(200);
    const rescuedBody=await rescued.json() as any;expect(rescuedBody).toMatchObject({outcome:"handled",reason:"compliance_partial"});expect(rescuedBody.replies.length).toBe(1);
    expect(await (await post(help)).json()).toEqual(rescuedBody);expect(handled).toBe(2);
  } finally { service.inbound=original; }
  await service.tick();expect(handled).toBe(2);
  const [row]=await sql`select status,replies,response,sender,event from platform.inbound where id='msg:blooio:fault-after-effects'`;
  expect(row.status).toBe("unresolved");expect(row.replies.length).toBeGreaterThan(0);expect(row.response).toBeNull();expect(row.sender).toBeNull();expect(row.event).toBeNull();
  // The unresolved turn holds this sender's ordinary messages back (at most 10 minutes); STOP, START and
  // HELP are never held back (inbox.ts), so the person can always get help or stop.
  clock.advance(MINUTE);expect((await post(turn("after-fault",input.from,"hello again"))).status).toBe(409);
  expect((await post(turn("after-fault-help",input.from,"HELP"))).status).toBe(200);
},60_000);


test("accepted handled replies repair the single Notify projection after faults, replay and restart, then erase on leave",async()=>{
  const phone="+12125550181",before=escaped;
  expect((await post(turn("handled-join-start",phone,"friends.help","friends"))).status).toBe(200);
  expect((await post(turn("handled-join-profile",phone,"Mira, 29","friends"))).status).toBe(200);
  const originalInbound=service.inbound.bind(service);
  service.inbound=async(...args)=>{
    const out=await originalInbound(...args),event=args[0];
    if (event.kind==="message" && event.messageId.startsWith("handled-notify")) {
      const current=service.inboundTurn()!,rt=service.runtimes.get("friends:nyc")!;
      // Controlled deterministic producer fixture; actual signed collection and Notify owners run unchanged.
      await rt.unitOfWork(()=>{rt.system(current.memberId!,`scheduling:${event.messageId}`,"Your requested schedule is ready.","reply","scheduling");rt.unit.sends.at(-1)!.system=false;});
    }
    return out;
  };
  const actual=service.delivered.bind(service);let fail=true;
  service.delivered=async(...args)=>{await actual(...args);if(fail){fail=false;throw new Error("synthetic after handled Notify SQL commit");}};
  const input=turn("handled-notify",phone,"HELP","friends");
  const response=await post(input);expect(response.status).toBe(200);const body=await response.json() as any;
  expect(body.replies.length).toBe(2);expect(body.delivery).toBe("collected");expect(escaped).toBe(before);
  const ack:TurnReceiptRequest={channel:input.channel,messageId:input.messageId,replyIds:body.replyIds,outcome:"unknown",providerMessageIds:[],historyRecorded:false};
  expect((await receipt(ack)).status).toBe(200);
  expect((await sql`select delivery_id from notify.deliveries where delivery_id='net:scheduling:handled-notify'`).length).toBe(0);
  const accepted={...ack,outcome:"accepted" as const,providerMessageIds:["handled-proof-1","handled-proof-2"],historyRecorded:true};
  expect((await receipt(accepted)).status).toBe(200);
  const [message]=await sql`select ts,notification_recorded_at from network.messages where id='scheduling:handled-notify'`;
  expect(message.notification_recorded_at).toBeNull();
  const [notification]=await sql`select sent_at from notify.deliveries where delivery_id='net:scheduling:handled-notify'`;
  // The signed ACK has no provider timestamp; preserve original message chronology, without claiming provider acceptance time.
  expect(new Date(notification.sent_at).getTime()).toBe(new Date(message.ts).getTime());
  expect(await (await post(input)).json()).toEqual(body);
  expect((await sql`select delivery_id from notify.deliveries where delivery_id='net:scheduling:handled-notify'`).length).toBe(1);
  expect((await sql`select notification_recorded_at from network.messages where id='scheduling:handled-notify'`)[0].notification_recorded_at).not.toBeNull();
  expect(await (await receipt(accepted)).json()).toEqual({ok:true,replayed:true});
  fail=true;
  const restartInput=turn("handled-notify-restart",phone,"HELP","friends"),restartResponse=await post(restartInput);
  expect(restartResponse.status).toBe(200);const restartBody=await restartResponse.json() as any;
  const restartAck:TurnReceiptRequest={channel:restartInput.channel,messageId:restartInput.messageId,replyIds:restartBody.replyIds,outcome:"accepted",providerMessageIds:["handled-restart-1","handled-restart-2"],historyRecorded:true};
  expect((await receipt(restartAck)).status).toBe(200);
  expect((await sql`select notification_recorded_at from network.messages where id='scheduling:handled-notify-restart'`)[0].notification_recorded_at).toBeNull();
  service.inbound=originalInbound;
  server.stop(true);await service.close();await start();
  expect((await sql`select delivery_id from notify.deliveries where delivery_id='net:scheduling:handled-notify-restart'`).length).toBe(1);
  expect((await sql`select notification_recorded_at from network.messages where id='scheduling:handled-notify-restart'`)[0].notification_recorded_at).not.toBeNull();
  const person=await service.accounts.personFor(phone);expect(person).toBeDefined();
  await service.accounts.leave(APPS.friends,{e164:phone,personId:person!.id});
  expect((await post(input)).status).toBe(409);expect((await receipt(accepted)).status).toBe(409);
  expect((await sql`select id from network.messages where id in ('scheduling:handled-notify','scheduling:handled-notify-restart')`).length).toBe(0);
  expect((await sql`select delivery_id from notify.deliveries where delivery_id in ('net:scheduling:handled-notify','net:scheduling:handled-notify-restart')`).length).toBe(0);
  await service.runtimes.get("friends:nyc")!.start();expect(escaped).toBe(before);
},60_000);

test("completed signed payload expiry retains a tombstone and leaves unresolved effects held",async()=>{
  const input=turn("payload-expiry","+12125550151","HELP");expect((await post(input)).status).toBe(200);
  clock.advance(8*DAY);await service.purge();
  expect((await post(input)).status).toBe(409);
  const [expired]=await sql`select status,request_hash,response,replies,receipt,sender_hash from platform.inbound where id='msg:blooio:payload-expiry'`;
  expect(expired.status).toBe("unresolved");expect(expired.request_hash).toBeDefined();expect(expired.response).toBeNull();expect(expired.replies).toEqual([]);expect(expired.receipt).toBeNull();expect(expired.sender_hash).toBeNull();
  const [interrupted]=await sql`select status,replies from platform.inbound where id='msg:blooio:fault-after-effects'`;
  expect(interrupted.status).toBe("unresolved");expect(interrupted.replies.length).toBeGreaterThan(0);
},60_000);

test("full canonical deletion scrubs signed context, replies and receipts without crossing people",async()=>{
  const phone="+12125550161", otherPhone="+12125550162", before=escaped;
  for (const [from, name] of [[phone,"Deleteari"],[otherPhone,"Keepnoa"]]) {
    expect((await post(turn(`delete-join-${name}`,from,"friends.help","friends"))).status).toBe(200);
    expect((await post(turn(`delete-profile-${name}`,from,`${name}, 29`,"friends"))).status).toBe(200);
    for (const [i,text] of ["I enjoy hiking and cooking","Saturday afternoons work for me","Small groups are good"].entries()) {
      clock.advance(MINUTE);
      expect((await post(turn(`delete-onboard-${name}-${i}`,from,text,"friends"))).status).toBe(200);
    }
  }
  const open=turn("delete-open",phone,"Tell me something about the weather","friends");
  const opened=await post(open);expect(opened.status).toBe(200);
  const openBody=await opened.json() as any;expect(openBody.outcome).toBe("open");
  expect(JSON.stringify(openBody)).toContain("Deleteari");
  const help=turn("delete-help",phone,"HELP","friends");
  const handled=await post(help);expect(handled.status).toBe(200);
  const helpBody=await handled.json() as any;expect(helpBody.outcome).toBe("handled");expect(helpBody.replyIds.length).toBeGreaterThan(0);
  const ack:TurnReceiptRequest={channel:help.channel,messageId:help.messageId,replyIds:helpBody.replyIds,outcome:"accepted",providerMessageIds:["owned-delete-receipt"],historyRecorded:true};
  expect((await receipt(ack)).status).toBe(200);
  const control=turn("delete-other-person",otherPhone,"Tell me something about the weather","friends");
  const kept=await post(control);expect(kept.status).toBe(200);const keptBody=await kept.json();
  expect((await sql`select receipt from platform.inbound where id='msg:blooio:delete-help'`)[0].receipt).not.toBeNull();
  const call=async(path:string,body:unknown,cookie?:string)=>fetch(new URL(path,server.url),{method:"POST",headers:{host:"localhost:5104","content-type":"application/json",...(cookie?{cookie}:{})},body:JSON.stringify(body)});
  expect((await call("/api/auth/otp/start",{phone})).status).toBe(200);
  const login=await call("/api/auth/otp/verify",{phone,code});expect(login.status).toBe(200);
  const cookie=login.headers.get("set-cookie")!.split(";")[0]!;
  expect((await call("/api/me/delete",{scope:"all"},cookie)).status).toBe(200);
  for (const input of [open,help]) {
    const replay=await post(input);expect(replay.status).toBe(409);
    expect(await replay.text()).not.toContain("Deleteari");
    const [row]=await sql`select response,replies,receipt,receipt_hash,sender_hash,member_id,app_id,sender,event from platform.inbound where id=${`msg:${input.channel}:${input.messageId}`}`;
    expect(row).toEqual({response:null,replies:[],receipt:null,receipt_hash:null,sender_hash:null,member_id:null,app_id:null,sender:null,event:null});
  }
  expect((await receipt(ack)).status).toBe(409);
  expect((await sql`select person_id from platform.phone_identities where e164=${phone}`).length).toBe(0);
  expect((await sql`select person_id from platform.phone_identities where e164=${otherPhone}`).length).toBe(1);
  expect(await (await post(control)).json()).toEqual(keptBody);
  expect(escaped).toBe(before);
  server.stop(true);await service.close();await start();
  expect((await post(open)).status).toBe(409);expect((await receipt(ack)).status).toBe(409);
  expect(await (await post(control)).json()).toEqual(keptBody);expect(escaped).toBe(before);
},60_000);

test("the Cloud turn secret is never also a staff bearer token", () => {
  const make = (o: {tokens?: string; consoleToken?: string}) => new NetworkService({url, clock, photoStorage:null, instance:"turn-secret-separation",
    env:{PLATFORM_ENV:"dev", CLEF_RATINGS:"off", SERVICE_TURN_SECRET:secret}, networks:[{id:"ntwrk:nyc",matchingEnabled:false}], log:()=>{}, ...o});
  expect(() => make({tokens:`admin@*:${secret}`})).toThrow(/SERVICE_TURN_SECRET must differ/);
  expect(() => make({tokens:`reviewer@slop:other-staff-token-0001,admin@*:console-token-00000001`, consoleToken:secret})).toThrow(/SERVICE_TURN_SECRET must differ/);
  expect(() => make({tokens:"admin@*:console-token-00000001", consoleToken:"console-token-00000001"})).not.toThrow();
});


test("isolated route authority fences cross-realm writes and only drains exact durable turns", async () => {
  server.stop(true); await service.close();
  const authority = {version:1 as const,routeId:"owned-route",generation:"generation-1",audience:"network-owned-qa",realmId:"owned-qa"};
  const begin = clock.now(), policy = {authority,admitUntil:begin+10*MINUTE,drainUntil:begin+20*MINUTE};
  await start(policy);
  const input = {...turn("isolated-help", "+12125550991", "HELP"), networkAuthority:authority};
  const [before] = await sql`select count(*)::int as count from platform.inbound`;
  for (const networkAuthority of [undefined,{...authority,realmId:"production"},{...authority,generation:"old"},{...authority,audience:"wrong"},{...authority,routeId:"other"},{...authority,extra:true}]) {
    expect((await post({...input,networkAuthority})).status).toBe(403);
  }
  const [untouched] = await sql`select count(*)::int as count from platform.inbound`;
  expect(untouched.count).toBe(before.count);
  const accepted = await post(input); expect(accepted.status).toBe(200); const response = await accepted.json() as any;
  const [stored] = await sql`select network_authority,request_hash from platform.inbound where id='msg:blooio:isolated-help'`;
  expect(stored.network_authority).toEqual(authority);
  expect(stored.request_hash).toBe(new Bun.CryptoHasher("sha256").update(JSON.stringify(input)).digest("hex"));
  // Use a distinct fixture name: the separate sharedContext duplicate-first-name
  // defect is tracked explicitly and must not obscure route-authority assertions.
  const phone = "+12125550993";
  let step = 0;
  const qa = (text:string) => ({...turn(`isolated-open-${++step}`,phone,text,"friends"),networkAuthority:authority});
  for (const [index,text] of ["friends.help","Inez, 29","I enjoy hiking and cooking","Saturday afternoons work for me","Small groups are good"].entries()) {
    // Match the proven normal onboarding sequence: later answers arrive after the prior ask.
    if (index >= 2) clock.advance(MINUTE);
    const response=await post(qa(text)), body=await response.json() as any;
    expect({step:index+1,status:response.status,body}).toMatchObject({status:200,body:{outcome:"handled",reason:expect.any(String)}});
  }
  const open = qa("Tell me about the weather"), opened = await (await post(open)).json() as any;
  expect({stage:"after timed onboarding",body:opened}).toMatchObject({body:{outcome:"open"}});
  const action = {channel:open.channel,messageId:open.messageId,app:opened.app,memberId:opened.memberId,networkAuthority:authority};
  const updates = async (body:Record<string,unknown>) => {
    const raw = JSON.stringify(body);
    return fetch(new URL("/internal/updates",server.url),{method:"POST",headers:{"content-type":"application/json",...await svcSign(secret,{method:"POST",path:"/internal/updates",id:`${open.messageId}:updates`,body:raw,nowS:Math.floor(clock.now()/1000)})},body:raw});
  };
  expect((await updates(action)).status).toBe(200);
  expect((await updates({...action,memberId:"different-member"})).status).toBe(403);
  expect((await updates({...action,networkAuthority:{...authority,generation:"old"}})).status).toBe(403);
  clock.advance(policy.admitUntil-clock.now());
  expect((await updates(action)).status).toBe(200);
  expect(await (await post(input)).json()).toEqual(response);
  expect((await post({...input,text:"STOP"})).status).toBe(409);
  expect((await post({...input,messageId:"isolated-new-after-close"})).status).toBe(403);
  const ack = {channel:input.channel,messageId:input.messageId,replyIds:response.replyIds,outcome:"accepted" as const,providerMessageIds:["synthetic-isolated-receipt"],historyRecorded:false,networkAuthority:authority};
  const escapedBeforeReceipt = escaped;
  expect((await receipt(ack)).status).toBe(200);
  const [savedReceipt] = await sql`select receipt_hash,receipt from platform.inbound where id='msg:blooio:isolated-help'`;
  // Cloud appends the bound authority; Gateway places it after channel. Both
  // sign their own raw bytes, while the previously accepted receipt stays put.
  const gatewayAck = {channel:ack.channel,networkAuthority:{realmId:authority.realmId,audience:authority.audience,generation:authority.generation,routeId:authority.routeId,version:authority.version},messageId:ack.messageId,replyIds:ack.replyIds,outcome:ack.outcome,providerMessageIds:ack.providerMessageIds,historyRecorded:ack.historyRecorded};
  expect(JSON.stringify(gatewayAck)).not.toBe(JSON.stringify(ack));
  expect(await (await receipt(gatewayAck)).json()).toEqual({ok:true,replayed:true});
  expect((await sql`select receipt_hash,receipt from platform.inbound where id='msg:blooio:isolated-help'`)[0]).toEqual(savedReceipt);
  expect(savedReceipt.receipt_hash).toBe(new Bun.CryptoHasher("sha256").update(JSON.stringify(ack)).digest("hex"));
  for (const changed of [
    {...gatewayAck,providerMessageIds:["different-provider-receipt"]},
    {...gatewayAck,historyRecorded:true},
    {...gatewayAck,replyIds:[...gatewayAck.replyIds].reverse().concat("different-reply")},
  ]) expect((await receipt(changed)).status).toBe(409);
  expect((await receipt({...gatewayAck,extra:true} as TurnReceiptRequest)).status).toBe(400);
  const signedBody = JSON.stringify(ack), reorderedBody = JSON.stringify(gatewayAck);
  const wrongSignature = await svcSign(secret,{method:"POST",path:TURN_RECEIPT_PATH,id:`${input.messageId}:receipt`,body:signedBody,nowS:Math.floor(clock.now()/1000)});
  expect((await fetch(new URL(TURN_RECEIPT_PATH,server.url),{method:"POST",headers:{"content-type":"application/json",...wrongSignature},body:reorderedBody})).status).toBe(401);
  expect(escaped).toBe(escapedBeforeReceipt);
  expect((await receipt({...ack,networkAuthority:{...authority,realmId:"wrong"}})).status).toBe(403);
  const raw = JSON.stringify({channel:input.channel,messageId:input.messageId,app:"friends",memberId:"none",itemId:null,text:"tell them hi",networkAuthority:authority});
  const relay = await fetch(new URL("/internal/relay",server.url),{method:"POST",headers:{"content-type":"application/json",...await svcSign(secret,{method:"POST",path:"/internal/relay",id:`${input.messageId}:relay`,body:raw,nowS:Math.floor(clock.now()/1000)})},body:raw});
  expect(relay.status).toBe(403);
  clock.advance(policy.drainUntil-clock.now());
  expect((await post(input)).status).toBe(403);
  expect((await receipt(ack)).status).toBe(403);
  expect((await updates(action)).status).toBe(403);
  server.stop(true); await service.close(); await start();
  expect((await post(input)).status).toBe(403);
  expect((await post(turn("legacy-after-isolation", "+12125550992", "HELP"))).status).toBe(200);
}, 60_000);


test("route policy boot validation rejects malformed or non-staging authority", () => {
  const authority = {version:1 as const,routeId:"owned-route",generation:"generation-1",audience:"network-owned-qa",realmId:"owned-qa"};
  const value = {authority,admitUntil:1000,drainUntil:2000};
  const env = {PLATFORM_ENV:"staging",NETWORK_ROUTE_AUTHORITY_POLICY:JSON.stringify(value)};
  const valid = networkRoutePolicy(env);
  expect(valid?.authority).toEqual(authority);
  expect(networkRoutePolicy({})).toBeUndefined();
  expect(routeEnvelopeAllowed(undefined, authority, 0)).toBe(false);
  expect(routeEnvelopeAllowed(valid, authority, 1999)).toBe(true);
  expect(routeEnvelopeAllowed(valid, authority, 2000)).toBe(false);
  for (const bad of [null, [], {...value,extra:true}, {...value,admitUntil:0}, {...value,drainUntil:999}, {...value,drainUntil:Infinity}, {...value,authority:{...authority,url:"https://elsewhere.invalid"}}, {...value,authority:{...authority,version:2}}]) {
    expect(() => networkRoutePolicy({...env,NETWORK_ROUTE_AUTHORITY_POLICY:JSON.stringify(bad)})).toThrow();
  }
  expect(() => networkRoutePolicy({...env,PLATFORM_ENV:"production"})).toThrow();
  expect(() => networkRoutePolicy({...env,PLATFORM_ENV:"dev"})).toThrow();
});

// A real row lock holds both signed requests across the server's drain deadline.
test("isolated actions and receipts recheck the drain window after database lock waits", async () => {
  server.stop(true); await service.close();
  const authority = {version:1 as const,routeId:"locked-route",generation:"g1",audience:"locked-qa",realmId:"locked-qa"};
  const begin = clock.now(), policy={authority,admitUntil:begin+10*MINUTE,drainUntil:begin+20*MINUTE}; await start(policy);
  const help = {...turn("locked-help", "+12125550994", "HELP"),networkAuthority:authority};
  const handled = await (await post(help)).json() as any;
  let step=0;
  const qa = (text:string) => ({...turn(`locked-open-${++step}`,"+12125550995",text,"friends"),networkAuthority:authority});
  for (const [index,text] of ["friends.help","Luca, 29","I enjoy hiking and cooking","Saturday afternoons work for me","Small groups are good"].entries()) {
    // Match the proven normal onboarding sequence: later answers arrive after the prior ask.
    if (index >= 2) clock.advance(MINUTE);
    const response=await post(qa(text)), body=await response.json() as any;
    expect({step:index+1,status:response.status,body}).toMatchObject({status:200,body:{outcome:"handled",reason:expect.any(String)}});
  }
  const open=qa("Tell me about the weather"), opened=await (await post(open)).json() as any;
  expect({stage:"after timed onboarding",body:opened}).toMatchObject({body:{outcome:"open"}});
  const[memberBefore]=await sql`select participation_state,participation_window from network.members where app_id='friends'and id=${opened.memberId}`;
  const locker=new SQL({url,max:1}); let release!:()=>void, locked!:()=>void;
  const released=new Promise<void>(resolve=>{release=resolve;}), acquired=new Promise<void>(resolve=>{locked=resolve;});
  const transaction=locker.begin(async tx=>{
    await tx`select id from platform.inbound where id in ('msg:blooio:locked-help',${`msg:blooio:${open.messageId}`}) order by id for update`;
    locked(); await released;
  });
  await acquired;
  try {
    const ack={channel:help.channel,messageId:help.messageId,replyIds:handled.replyIds,outcome:"accepted" as const,providerMessageIds:["synthetic-locked-receipt"],historyRecorded:false,networkAuthority:authority};
    const action={channel:open.channel,messageId:open.messageId,app:opened.app,memberId:opened.memberId,idempotencyKey:"locked-state-action",state:"busy",from:null,until:null,note:null,networkAuthority:authority};
    const raw=JSON.stringify(action);
    const pendingReceipt=receipt(ack);
    const pendingAction=fetch(new URL("/internal/set-state",server.url),{method:"POST",headers:{"content-type":"application/json",...await svcSign(secret,{method:"POST",path:"/internal/set-state",id:action.idempotencyKey,body:raw,nowS:Math.floor(clock.now()/1000)})},body:raw});
    const deadline=Date.now()+5000; let waiters=0;
    while(Date.now()<deadline){
      const[row]=await admin`select count(*)::int as count from pg_stat_activity where datname=${db} and wait_event_type='Lock' and lower(query) like '%platform.inbound%'`;
      waiters=row.count;if(waiters>=2)break;await Bun.sleep(10);
    }
    expect(waiters).toBeGreaterThanOrEqual(2);
    clock.advance(policy.drainUntil-clock.now()); release(); await transaction;
    const [receiptResponse, actionResponse] = await Promise.all([pendingReceipt, pendingAction]);
    expect(receiptResponse.status).toBe(403);
    expect(actionResponse.status).toBe(403);
    const rows=await sql`select id,receipt_hash,action_receipts from platform.inbound where id in ('msg:blooio:locked-help',${`msg:blooio:${open.messageId}`})`;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.receipt_hash).toBeNull();
      expect(Object.keys(row.action_receipts)).toHaveLength(0);
    }
    const[memberAfter]=await sql`select participation_state,participation_window from network.members where app_id='friends'and id=${opened.memberId}`;
    expect(memberAfter).toEqual(memberBefore);
    // Expired exact replays remain denied; an accepted receipt is not an extension of the window.
    expect((await receipt(ack)).status).toBe(403);
  } finally {release();await transaction;await locker.close();server.stop(true);await service.close();await start();}
},60_000);


test("members sharing a first name receive their own context without another person's private details", async () => {
  const phones = ["+12125550891", "+12125550892", "+12125550893"];
  const memberIds: string[] = [];
  for (const [index, phone] of phones.entries()) {
    for (const [step, text] of ["friends.help", `${index === 2 ? "Mira" : "Noa"}, 29`, "I enjoy hiking and cooking",
      "Saturday afternoons work for me", "Small groups are good"].entries()) {
      clock.advance(MINUTE);
      expect((await post(turn(`same-name-${index}-${step}`, phone, text, "friends"))).status).toBe(200);
    }
    const person = await service.accounts.personFor(phone);
    expect(person).toBeDefined();
    const [member] = await sql`select member_id from platform.memberships where person_id=${person!.id}::uuid and app_id='friends'`;
    memberIds.push(member.member_id);
  }
  // Controlled stored-data fixtures challenge the actual model-visible projection, not a mock filter.
  await sql`update network.members set name='Noa Riverstone' where app_id='friends' and id=${memberIds[2]}`;
  await sql`insert into network.facets(app_id,id,member_id,kind,value,privacy_scope,provenance,status)
    values('friends','same-name-private',${memberIds[1]},'fact','PRIVATE_SAME_NAME_CANARY','agent_private','said','confirmed')`;
  for (const [index, memberId] of memberIds.slice(0, 2).entries()) {
    const values = ["Enjoys board games", "Noa Riverstone", memberIds[2]!, "PRIVATE_SAME_NAME_CANARY"];
    for (const [item, value] of values.entries()) await sql`insert into network.facets(app_id,id,member_id,kind,value,privacy_scope,provenance,status)
      values('friends',${`same-name-${index}-facet-${item}`},${memberId},'fact',${value},'shareable','said','confirmed')`;
  }
  const before = escaped;
  for (const [index, phone] of phones.slice(0, 2).entries()) {
    const response = await post(turn(`same-name-open-${index}`, phone, "Tell me about the weather", "friends"));
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.outcome).toBe("open");
    expect(body.context.firstName).toBe("Noa");
    expect(body.context.facets).toContain("Enjoys board games");
    const visible = JSON.stringify(body.context);
    for (const forbidden of ["Noa Riverstone", "PRIVATE_SAME_NAME_CANARY", ...memberIds, ...phones]) expect(visible).not.toContain(forbidden);
  }
  expect(escaped).toBe(before);
}, 60_000);

// This regression must fail on the old UPDATES path: markSeen committed before
// the later route check rejected completion, silently consuming the unread item.
test("expired isolated updates roll back unread and surface changes after a notify row wait", async () => {
  server.stop(true); await service.close();
  const authority={version:1 as const,routeId:"updates-route",generation:"g1",audience:"updates-qa",realmId:"updates-qa"};
  const policy={authority,admitUntil:clock.now()+10*MINUTE,drainUntil:clock.now()+20*MINUTE};await start(policy);
  const phone="+12125550781";let step=0;
  const qa=(text:string)=>({...turn(`updates-drain-${++step}`,phone,text,"friends"),networkAuthority:authority});
  for(const[index,text]of["friends.help","Talia, 29","I enjoy hiking and cooking","Saturday afternoons work for me","Small groups are good"].entries()){
    if(index>=2)clock.advance(MINUTE);
    const response=await post(qa(text));expect(response.status).toBe(200);
  }
  const open=qa("Tell me about the weather"),opened=await(await post(open)).json()as any;
  expect({stage:"updates regression open parent",body:opened}).toMatchObject({body:{outcome:"open"}});
  const person=await service.accounts.personFor(phone);expect(person).toBeDefined();
  const[item]=await sql`insert into notify.inbox_items(dedupe_key,person_id,app_id,event_type,subject_id,urgency,summary,created_at)
    values('updates-drain-unread',${person!.id},'friends','test','updates-drain-unread','requested','Your requested update is ready.',${new Date(clock.now())})returning id`;
  const surfaceBefore=await sql`select surface,active,last_used_at,acted,ignored,ignored_streak from notify.surface_signals where person_id=${person!.id}order by surface`;
  const locker=new SQL({url,max:1});let release!:()=>void,locked!:()=>void;
  const gate=new Promise<void>(r=>{release=r;}),acquired=new Promise<void>(r=>{locked=r;});
  const held=locker.begin(async tx=>{await tx`select id from notify.inbox_items where id=${item.id}for update`;locked();await gate;});await acquired;
  let pending:Promise<Response>|undefined;
  try{
    const body=JSON.stringify({channel:open.channel,messageId:open.messageId,app:opened.app,memberId:opened.memberId,networkAuthority:authority});
    pending=fetch(new URL("/internal/updates",server.url),{method:"POST",headers:{"content-type":"application/json",...await svcSign(secret,{method:"POST",path:"/internal/updates",id:`${open.messageId}:updates`,body,nowS:Math.floor(clock.now()/1000)})},body});
    const deadline=Date.now()+5000;let waiters=0;
    while(Date.now()<deadline){const[row]=await admin`select count(*)::int as count from pg_stat_activity where datname=${db}and wait_event_type='Lock'and lower(query)like'%notify.inbox_items%'`;waiters=row.count;if(waiters)break;await Bun.sleep(10);}
    expect(waiters).toBeGreaterThan(0);clock.advance(policy.drainUntil-clock.now());release();await held;
    expect((await pending).status).toBe(403);
    const[after]=await sql`select seen_at,seen_on from notify.inbox_items where id=${item.id}`;
    expect(after).toEqual({seen_at:null,seen_on:null});
    expect(await sql`select surface,active,last_used_at,acted,ignored,ignored_streak from notify.surface_signals where person_id=${person!.id}order by surface`).toEqual(surfaceBefore);
  }finally{release();await held;if(pending)await pending.catch(()=>undefined);await locker.close();server.stop(true);await service.close();await start();}
},60_000);

// Real service + real owned fixture PostgreSQL: provider receipts remain controlled.
test("explicit saved-profile reads select the app without consuming onboarding or changing profiles", async () => {
  server.stop(true);
  await service.close();
  await start();
  const phone = "+12125550991";
  for (const app of [APPS.friends, APPS.slop]) {
    await service.accounts.invite(app, phone);
    const person = await service.accounts.personFor(phone);
    expect(person).toBeDefined();
    const joined = await service.accounts.join(
      app,
      { e164: phone, personId: person!.id },
      {
        firstName: "Ari",
        age: 29,
        homeCity: "nyc",
        about: app.id === "friends" ? "FRIENDS_ONLY programming and camping." : "SLOP_ONLY private dating details.",
        interests: ["climbing"],
        consent: { sms: true, wording: app.consent.text },
      },
    );
    expect(joined.ok).toBe(true);
  }
  const person = (await service.accounts.personFor(phone))!;
  const saved = await Promise.all(
    ["friends", "slop"].map((app) => service.accounts.store.getMembership(person.id, app as "friends" | "slop")),
  );
  clock.advance(MINUTE);
  expect((await post(turn("profile-prime-slop", phone, "Slop"))).status).toBe(200);
  const pending = async () => {
    const rows =
      await sql`select id,state from network.network_state where id in ('friends:nyc','slop:nyc') order by id`;
    return rows.map((row: { id: string; state: string | { asks: unknown; members: unknown[] } }) => {
      const state = typeof row.state === "string" ? JSON.parse(row.state) : row.state;
      return {
        id: row.id,
        asks: state.asks,
        members: state.members.map((m: any) => ({
          id: m.id,
          stage: m.stage,
          onboarding: m.onboarding,
          pendingAsks: m.pendingAsks,
          awaiting: m.awaiting,
          learned: m.learned,
          asked: m.asked,
          answered: m.answered,
        })),
      };
    });
  };
  const texts = [
    "Please show me the Friends profile I saved; leave it unchanged.",
    "What does my Friends profile say? Please do not change anything.",
    "Show my saved profile. Do not edit it or suggest matches.",
    "Can you show me my Friends profile?",
    "Could you please show my saved profile?",
    "What is my saved profile?",
    "Show me my Friends profile please.",
    "Read my saved Friends profile, thanks.",
    "Could you read my Friends profile? Thanks.",
  ];
  for (const [index, text] of texts.entries()) {
    if (index === 2) {
      clock.advance(MINUTE);
      expect((await post(turn("profile-select-friends", phone, "Friends"))).status).toBe(200);
    }
    const before = await pending();
    const spies = [...service.runtimes.values()].map((rt) => spyOn(rt.net, "onInbound"));
    const input = turn(`profile-read-${index}`, phone, text);
    try {
      const response = await post(input);
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.outcome).toBe("handled");
      expect(body.app).toBe("friends");
      expect(body.replyKind).toBe("reply");
      expect(body.replies.join("\n")).toContain("FRIENDS_ONLY programming and camping.");
      expect(body.replies.join("\n")).not.toContain("SLOP_ONLY");
      expect(body.replies.join("\n")).toContain("I left it unchanged.");
      expect(spies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
      expect(await pending()).toEqual(before);
      expect(
        await Promise.all(
          ["friends", "slop"].map((app) => service.accounts.store.getMembership(person.id, app as "friends" | "slop")),
        ),
      ).toEqual(saved);
      expect(await (await post(input)).json()).toEqual(body);
      expect(
        (
          await receipt({
            channel: input.channel,
            messageId: input.messageId,
            replyIds: body.replyIds,
            outcome: "accepted",
            providerMessageIds: [`fixture-profile-receipt-${index}`],
            historyRecorded: true,
          })
        ).status,
      ).toBe(200);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  }
  const before = await pending();
  const foreign = (await (
    await post(turn("profile-foreign", phone, "Show Maya's Friends profile", "friends"))
  ).json()) as any;
  expect(foreign.replies.join("\n")).toContain("own number");
  expect(foreign.replies.join("\n")).not.toContain("FRIENDS_ONLY");
  const ambiguous = (await (
    await post(turn("profile-ambiguous", phone, "Show my Friends and Slop profiles", "friends"))
  ).json()) as any;
  expect(ambiguous.replies.join("\n")).toContain("Which profile");
  expect(ambiguous.replies.join("\n")).not.toContain("FRIENDS_ONLY");
  const line = (await (
    await post(turn("profile-forced-line", phone, "Show my Friends profile", "slop"))
  ).json()) as any;
  expect(line.app).toBe("slop");
  expect(line.replies.join("\n")).not.toContain("FRIENDS_ONLY");
  expect(await pending()).toEqual(before);
  const unsigned = turn("profile-no-auth", phone, texts[0]!);
  expect(
    (
      await fetch(new URL(TURN_PATH, server.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(unsigned),
      })
    ).status,
  ).toBe(401);
  const [countsBefore] =
    await sql`select (select count(*) from platform.people) people,(select count(*) from platform.memberships) memberships,(select count(*) from platform.consent_events) consents,(select count(*) from platform.pending_texts) pending`;
  const absent = (await (await post(turn("profile-nonmember", "+12125550992", texts[0]!))).json()) as any;
  expect(absent.replies).toEqual([]);
  const [countsAfter] =
    await sql`select (select count(*) from platform.people) people,(select count(*) from platform.memberships) memberships,(select count(*) from platform.consent_events) consents,(select count(*) from platform.pending_texts) pending`;
  expect(countsAfter).toEqual(countsBefore);
  // An edit is ordinary inbound, never swallowed as a saved-profile read.
  const editSpies = [...service.runtimes.values()].map((rt) => spyOn(rt.net, "onInbound"));
  try {
    const edited = await post(
      turn("profile-edit-intent", phone, "Change my Friends profile to say I like kayaking", "friends"),
    );
    expect(edited.status).toBe(200);
    expect(editSpies.some((spy) => spy.mock.calls.length > 0)).toBe(true);
  } finally {
    for (const spy of editSpies) spy.mockRestore();
  }
  const membershipBeforeGuards = await Promise.all(
    ["friends", "slop"].map((app) => service.accounts.store.getMembership(person.id, app as "friends" | "slop")),
  );
  await service.accounts.store.setPhoneHold(phone, "recycled_number", clock.now());
  const held = (await (await post(turn("profile-held", phone, texts[0]!))).json()) as any;
  expect(held.replies).toEqual([]);
  await service.accounts.store.setPhoneHold(phone, null, clock.now());
  await service.accounts.store.suppress(service.accounts.phoneHash(phone), "synthetic fixture", clock.now());
  const suppressed = (await (await post(turn("profile-suppressed", phone, texts[0]!))).json()) as any;
  expect(suppressed.replies).toEqual([]);
  await service.accounts.store.unsuppress(service.accounts.phoneHash(phone));
  await service.accounts.recordConsent({
    e164: phone,
    app: "friends",
    state: "opted_out",
    source: "keyword:stop",
    wording: "STOP",
    at: clock.now(),
  });
  const pendingBeforeStop = await pending();
  const stopped = (await (await post(turn("profile-opted-out", phone, texts[0]!))).json()) as any;
  // Existing stopHint may send its ordinary compliance reminder; it must never disclose saved data.
  expect(stopped.replies.join("\n")).not.toContain("FRIENDS_ONLY");
  expect(stopped.replies.join("\n")).not.toContain("SLOP_ONLY");
  expect(stopped.replies.join("\n")).not.toContain("Here is your saved");
  expect(await pending()).toEqual(pendingBeforeStop);
  expect(await service.accounts.optedIn("friends", phone)).toBe(false);
  expect(
    await Promise.all(
      ["friends", "slop"].map((app) => service.accounts.store.getMembership(person.id, app as "friends" | "slop")),
    ),
  ).toEqual(membershipBeforeGuards);
}, 60_000);
