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
  const input=turn("fault-after-effects","+12125550131","HELP");
  expect((await post(input)).status).toBe(409);expect((await post(input)).status).toBe(409);expect(handled).toBe(1);
  service.inbound=original;
  await service.tick();expect(handled).toBe(1);
  const [row]=await sql`select status,replies,response,sender,event from platform.inbound where id='msg:blooio:fault-after-effects'`;
  expect(row.status).toBe("unresolved");expect(row.replies.length).toBe(1);expect(row.response).toBeNull();expect(row.sender).toBeNull();expect(row.event).toBeNull();
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
  expect(interrupted.status).toBe("unresolved");expect(interrupted.replies.length).toBe(1);
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
