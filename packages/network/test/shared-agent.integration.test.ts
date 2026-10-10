// Real service, HTTP and PostgreSQL. Only OTP/provider delivery boundaries are controlled.
import {afterAll, beforeAll, expect, test} from "bun:test";
import {randomUUID} from "node:crypto";
import {SQL} from "bun";
import {SimClock, MINUTE, DAY} from "@thenetwork/core";
import {applySchema} from "../../observatory/db/dev-pg.ts";
import {APPS} from "../../platform/src/apps.ts";
import {svcSign} from "../../core/src/svc/svc-auth.ts";
import {TURN_PATH, TURN_RECEIPT_PATH, type TurnRequest, type TurnReceiptRequest} from "../../core/src/svc/contract.ts";
import {DryRunAdapter} from "../service/channel.ts";
import {NetworkService} from "../service/service.ts";

const db = `network_signed_turn_${randomUUID().replaceAll("-", "")}`;
const admin = new SQL({url:`postgres://${process.env.USER ?? "postgres"}@127.0.0.1:54339/postgres`, max:1});
const url = `postgres://${process.env.USER ?? "postgres"}@127.0.0.1:54339/${db}`;
const secret = "synthetic-shared-agent-test-secret-20261009";
const clock = new SimClock(Date.UTC(2026, 9, 9, 16));
let sql: SQL, service: NetworkService, server: ReturnType<typeof Bun.serve>;
let escaped = 0, code = "";
const start = async () => {
  service = new NetworkService({url, clock, photoStorage:null, instance:"signed-turn-integration",
    env:{PLATFORM_ENV:"dev", CLEF_RATINGS:"off", SERVICE_TURN_SECRET:secret}, networks:[{id:"ntwrk:nyc",matchingEnabled:false},{id:"slop:nyc",matchingEnabled:false},{id:"friends:nyc",matchingEnabled:false}],
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
  expect((await first.json() as any).reason).toBe("join_asked");
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
  expect((await post(turn("friends-stop",phone,"STOP","friends"))).status).toBe(200);
  expect((await post(input)).status).toBe(409);
  expect(escaped).toBe(before);
},60_000);

test("a committed collection followed by a fault stays unresolved and is never automatically rerun",async()=>{
  const original=service.inbound.bind(service);let handled=0;
  service.inbound=async(...args)=>{handled++;await original(...args);throw new Error("synthetic after-effect fault");};
  const input=turn("fault-after-effects","+12125550131","HELP");
  expect((await post(input)).status).toBe(409);expect((await post(input)).status).toBe(409);expect(handled).toBe(1);
  service.inbound=original;
  await service.tick();expect(handled).toBe(1);
  const [row]=await sql`select status,replies,response,sender,event from platform.inbound where id='msg:blooio:fault-after-effects'`;
  expect(row.status).toBe("unresolved");expect(row.replies.length).toBe(1);expect(row.response).toBeNull();expect(row.sender).toBeNull();expect(row.event).toBeNull();
  clock.advance(MINUTE);expect((await post(turn("after-fault",input.from,"HELP"))).status).toBe(409);
},60_000);


test("completed signed payload expiry retains a tombstone and leaves unresolved effects held",async()=>{
  const input=turn("payload-expiry","+12125550151","HELP");expect((await post(input)).status).toBe(200);
  clock.advance(8*DAY);await service.purge();
  expect((await post(input)).status).toBe(409);
  const [expired]=await sql`select status,request_hash,response,replies,receipt,sender_hash from platform.inbound where id='msg:blooio:payload-expiry'`;
  expect(expired.status).toBe("unresolved");expect(expired.request_hash).toBeDefined();expect(expired.response).toBeNull();expect(expired.replies).toEqual([]);expect(expired.receipt).toBeNull();expect(expired.sender_hash).toBeNull();
  const [interrupted]=await sql`select status,replies from platform.inbound where id='msg:blooio:fault-after-effects'`;
  expect(interrupted.status).toBe("unresolved");expect(interrupted.replies.length).toBe(1);
},60_000);
