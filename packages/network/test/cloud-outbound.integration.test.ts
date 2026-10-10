// Real service/runtime, queue, Notify and PostgreSQL. Cloud HTTP is the controlled transport boundary.
import {afterAll,beforeAll,expect,test} from "bun:test";
import {randomUUID} from "node:crypto";
import {SQL} from "bun";
import {SimClock,MINUTE} from "@thenetwork/core";
import {applySchema} from "../../observatory/db/dev-pg.ts";
import {APPS} from "../../platform/src/apps.ts";
import {svcSign,svcVerify} from "../../core/src/svc/svc-auth.ts";
import {DELIVER_PATH,TURN_PATH} from "../../core/src/svc/contract.ts";
import {CloudChannelAdapter} from "../service/cloud-channel.ts";
import {NetworkService} from "../service/service.ts";

const db=`network_cloud_outbound_${randomUUID().replaceAll("-","")}`;
const admin=new SQL({url:`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/postgres`,max:1});
const url=`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/${db}`;
const clock=new SimClock(Date.UTC(2026,9,9,16)),secret="synthetic-cloud-outbound-signing-secret-20261009",phone="+12125550171";
let sql:SQL,service:NetworkService,cloud:ReturnType<typeof Bun.serve>;
let dispatches=0,lookups=0,known=false,acceptedAt=clock.now(),holdReceipt=false,releaseReceipt:()=>void,enteredReceipt:()=>void;
let waiting:Promise<void>,entered:Promise<void>;
const start=async()=>{
  service=new NetworkService({url,clock,photoStorage:null,env:{PLATFORM_ENV:"dev",CLEF_RATINGS:"off",SERVICE_TURN_SECRET:secret},networks:[{id:"friends:nyc",matchingEnabled:false}],network:{seed:1},log:()=>{},
    adapter:(_net,rt)=>new CloudChannelAdapter({clock,app:rt.app.id,city:rt.city,from:"+12125550170",origin:cloud.url.origin,secret,
      env:{PLATFORM_ENV:"dev",BLOOIO_ALLOW_SEND:"1",NTWRK_LIVE_APPROVED:"1",FRIENDS_LIVE_APPROVED:"1"}})});
  await service.start();
};
beforeAll(async()=>{
  await admin.unsafe(`create database ${db}`);console.info(`[owned-db] ${db}`);await applySchema(url,{lockTimeout:"5s"});sql=new SQL({url,max:2});
  cloud=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async req=>{
    const path=new URL(req.url).pathname,raw=await req.text();
    const auth=await svcVerify(secret,{method:req.method,path,headers:req.headers,body:raw,nowS:Math.floor(clock.now()/1000)});
    if (!auth.ok) return Response.json({ok:false,error:"invalid"},{status:401});
    const payload=JSON.parse(raw);expect(auth.id).toBe(payload.id);expect(payload.app).toBe("friends");expect(payload.to).toBe(phone);expect(payload.memberId).toBeTruthy();
    if (path===DELIVER_PATH) dispatches++;
    else {expect(path).toBe(`${DELIVER_PATH}/receipt`);lookups++;if (holdReceipt) {enteredReceipt();await waiting;}}
    return known?Response.json({ok:true,replayed:true,providerMessageIds:[`provider:${payload.id}`],history:true,acceptedAt:new Date(acceptedAt).toISOString()})
      :Response.json({ok:false,error:"unknown",retryable:true},{status:202});
  }});
  await start();
},120_000);
afterAll(async()=>{await service?.close();cloud?.stop(true);await sql?.close();await admin.close();}); // Preserve only this owned database.

test("unknown acceptance recovers by receipt only, repairs Notify exactly once, and cannot resurrect after canonical leave",async()=>{
  // Accounts is the canonical verified-profile owner; the fixture supplies only the prior phone proof.
  known=true;
  const joined=await service.accounts.join(APPS.friends,{e164:phone,personId:null},{firstName:"Ari",age:29,consent:{sms:true,wording:APPS.friends.consent.text}});
  expect(joined.ok).toBe(true);if (!joined.ok) throw new Error("Fixture join refused");
  const memberId=joined.membership.memberId,rt=service.runtimes.get("friends:nyc")!;
  await rt.adapter.engaged!(phone);
  known=false;const dispatchBefore=dispatches;
  const emit=async(id:string)=>rt.unitOfWork(()=>{
    // Explicit producer fixture; the production unit/queue/consent/leak/receipt/Notify owners run unchanged.
    rt.unit.sends.push({id,memberId,to:phone,body:"Your requested reminder is ready.",kind:"reply",type:"reminder",proactive:false,system:false,ts:clock.now()});
  });
  await emit("receipt-first");expect(dispatches).toBe(dispatchBefore+1);
  const [initial]=await sql`select o.status,o.sent_at,m.notification_recorded_at from platform.outbound o join network.messages m on m.id=o.id and m.app_id=o.app_id where o.id='receipt-first'`;
  expect(initial.status).toBe("unknown_acceptance");expect(initial.sent_at).toBeNull();expect(initial.notification_recorded_at).toBeNull();
  expect((await sql`select delivery_id from notify.deliveries where delivery_id='net:receipt-first'`).length).toBe(0);
  await service.close();await start();expect(dispatches).toBe(dispatchBefore+1);expect(lookups).toBeGreaterThan(0);
  const actual=service.delivered.bind(service);let fault=true;
  service.delivered=async(...args)=>{await actual(...args);if (fault) {fault=false;throw new Error("synthetic after Notify SQL commit");}};
  known=true;acceptedAt=clock.now()-MINUTE;clock.advance(MINUTE);
  await service.runtimes.get("friends:nyc")!.unitOfWork(()=>undefined);
  const [accepted]=await sql`select o.status,o.sent_at,o.provider_message_ids,o.history_recorded,m.notification_recorded_at from platform.outbound o join network.messages m on m.id=o.id and m.app_id=o.app_id where o.id='receipt-first'`;
  expect(accepted.status).toBe("accepted");expect(new Date(accepted.sent_at).getTime()).toBe(acceptedAt);expect(accepted.history_recorded).toBe(true);
  expect(accepted.provider_message_ids).toEqual(["provider:receipt-first"]);expect(accepted.notification_recorded_at).toBeNull();
  const [notification]=await sql`select sent_at from notify.deliveries where delivery_id='net:receipt-first'`;
  expect(new Date(notification.sent_at).getTime()).toBe(acceptedAt);
  const pollBefore=lookups;await service.runtimes.get("friends:nyc")!.start();
  expect(lookups).toBe(pollBefore);expect(dispatches).toBe(dispatchBefore+1);
  expect((await sql`select delivery_id from notify.deliveries where delivery_id='net:receipt-first'`).length).toBe(1);
  expect((await sql`select notification_recorded_at from network.messages where id='receipt-first'`)[0].notification_recorded_at).not.toBeNull();
  // Reconstruct a worker stop after dispatch but before it persisted the response: the real lease recovery must not resend.
  known=false;
  const crashRt=service.runtimes.get("friends:nyc")!;await crashRt.adapter.engaged!(phone);
  await crashRt.unitOfWork(()=>crashRt.unit.sends.push({id:"receipt-crashed",memberId,to:phone,body:"Your next requested reminder is ready.",kind:"reply",type:"reminder",proactive:false,system:false,ts:clock.now()}));
  expect(dispatches).toBe(dispatchBefore+2);
  await sql`update platform.outbound set status='sending',lease_owner='stopped-fixture-worker',lease_until=${new Date(clock.now()-1)} where id='receipt-crashed'`;
  await service.close();await start();expect(dispatches).toBe(dispatchBefore+2);
  const [recovered]=await sql`select status,lease_owner,attempts,provider_message_id from platform.outbound where id='receipt-crashed'`;
  expect(recovered).toEqual({status:"unknown_acceptance",lease_owner:null,attempts:1,provider_message_id:null});
  expect((await sql`select status from network.messages where id='receipt-crashed'`)[0].status).toBe("unknown_acceptance");
  known=true;clock.advance(MINUTE);await service.runtimes.get("friends:nyc")!.unitOfWork(()=>undefined);
  expect(dispatches).toBe(dispatchBefore+2);expect((await sql`select status from platform.outbound where id='receipt-crashed'`)[0].status).toBe("accepted");
  const liveRt=service.runtimes.get("friends:nyc")!;
  known=false;await liveRt.adapter.engaged!(phone);
  await liveRt.unitOfWork(()=>liveRt.unit.sends.push({id:"receipt-forgotten",memberId,to:phone,body:"A second requested reminder is ready.",kind:"reply",type:"reminder",proactive:false,system:false,ts:clock.now()}));
  expect(dispatches).toBe(dispatchBefore+3);
  known=true;holdReceipt=true;waiting=new Promise(resolve=>{releaseReceipt=resolve;});entered=new Promise(resolve=>{enteredReceipt=resolve;});
  const pending=liveRt.unitOfWork(()=>undefined);await entered;
  const person=await service.accounts.personFor(phone);expect(person).toBeDefined();
  let deadline:ReturnType<typeof setTimeout>;
  try {
    await Promise.race([service.accounts.leave(APPS.friends,{e164:phone,personId:person!.id}),
      new Promise<never>((_resolve,reject)=>{deadline=setTimeout(()=>reject(new Error("Canonical erasure waited on remote receipt I/O")),1500);})]);
  } finally {clearTimeout(deadline!);}
  releaseReceipt();await pending;holdReceipt=false;
  const [erased]=await sql`select o.body,o.to_address,o.provider_message_id,m.notification_recorded_at from platform.outbound o left join network.messages m on m.id=o.id and m.app_id=o.app_id where o.id='receipt-forgotten'`;
  expect(erased).toEqual({body:null,to_address:null,provider_message_id:null,notification_recorded_at:null});
  expect((await sql`select id from network.messages where id='receipt-forgotten'`).length).toBe(0);
  expect((await sql`select delivery_id from notify.deliveries where delivery_id='net:receipt-forgotten'`).length).toBe(0);
  const lookupsAfter=lookups;await liveRt.start();expect(lookups).toBe(lookupsAfter);expect(dispatches).toBe(dispatchBefore+3);
},60_000);

test("canonical leave winning after the final async gate prevents dispatch admission",async()=>{
  known=true;
  const joined=await service.accounts.join(APPS.friends,{e164:phone,personId:null},{firstName:"Ari",age:29,consent:{sms:true,wording:APPS.friends.consent.text}});
  expect(joined.ok).toBe(true);if (!joined.ok) throw new Error("Fixture rejoin refused");
  const rt=service.runtimes.get("friends:nyc")!,memberId=joined.membership.memberId;
  await rt.adapter.engaged!(phone);
  const before=dispatches;
  const adapter=rt.adapter as CloudChannelAdapter;
  const checks=(adapter.queue as unknown as {o:import("../../blooio/src/outbound-queue.ts").QueueOptions}).o.checks;
  const original=checks.leaks;
  let release!:()=>void,arrive!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{arrive=resolve;});
  checks.leaks=async row=>{const result=await original!(row);if(row.id==="leave-before-admission"){arrive();await gate;}return result;};
  const sending=rt.unitOfWork(()=>rt.unit.sends.push({id:"leave-before-admission",memberId,to:phone,body:"Your requested reminder is ready.",kind:"reply",type:"reminder",proactive:false,system:false,ts:clock.now()}));
  try {
    await entered;
    const person=await service.accounts.personFor(phone);expect(person).toBeDefined();
    const leaving=service.accounts.leave(APPS.friends,{e164:phone,personId:person!.id});
    // Observe the canonical erase commit while dispatch remains at the existing asynchronous leak gate.
    let erased=false;
    for(let i=0;i<200;i++) {
      const [row]=await sql`select body,to_address from platform.outbound where id='leave-before-admission'`;
      if(row.body===null && row.to_address===null){erased=true;break;}
      await Bun.sleep(5);
    }
    expect(erased).toBe(true);
    release();await sending;await leaving;
    expect(dispatches).toBe(before);
    expect((await sql`select status,provider_message_id from platform.outbound where id='leave-before-admission'`)[0]).toEqual({status:"dropped_forgotten",provider_message_id:null});
    expect((await sql`select id from network.messages where id='leave-before-admission'`).length).toBe(0);
    expect((await sql`select delivery_id from notify.deliveries where delivery_id='net:leave-before-admission'`).length).toBe(0);
  } finally {release();checks.leaks=original;}
},60_000);


test("signed first contact and under-age decline retain no raw service counter; canonical teens can engage",async()=>{
  const before=dispatches;
  const signed=async(from:string,id:string,text:string)=>{
    const body=JSON.stringify({messageId:id,channel:"blooio",from,to:null,text,transport:"imessage",receivedAt:clock.now(),app:"friends"});
    return service.fetch(new Request(`http://127.0.0.1${TURN_PATH}`,{method:"POST",body,headers:{"content-type":"application/json",...await svcSign(secret,{method:"POST",path:TURN_PATH,id,body,nowS:Math.floor(clock.now()/1000)})}}));
  };
  const declined="+12125550191";
  expect((await signed(declined,"declined-first-contact","friends.help")).status).toBe(200);
  expect((await sql`select address from platform.line_conversations where address=${declined}`).length).toBe(0);
  const denied=await signed(declined,"declined-profile","Twelve, 12");expect(denied.status).toBe(200);
  const body=await denied.json() as any;expect(body.accountEligible).toBe(false);expect(body.memberId).toBeNull();expect(body.replyKind).toBe("compliance");
  expect((await sql`select address from platform.line_conversations where address=${declined}`).length).toBe(0);
  expect((await sql`select e164 from platform.phone_identities where e164=${declined}`).length).toBe(0);
  const teen="+12125550192";
  expect((await signed(teen,"teen-first-contact","friends.help")).status).toBe(200);
  expect((await sql`select address from platform.line_conversations where address=${teen}`).length).toBe(0);
  const joined=await signed(teen,"teen-profile","River, 15");expect(joined.status).toBe(200);
  expect((await joined.json() as any).accountEligible).toBe(true);
  expect((await sql`select address from platform.line_conversations where address=${teen}`).length).toBe(1);
  expect(dispatches).toBe(before);
},60_000);
