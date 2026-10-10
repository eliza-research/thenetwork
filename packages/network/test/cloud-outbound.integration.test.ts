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
const clock=new SimClock(Date.UTC(2026,9,9,16)),secret="synthetic-cloud-outbound-signing-secret-20261009",phone="+12125550171",phone2="+12125550175";
let sql:SQL,service:NetworkService,cloud:ReturnType<typeof Bun.serve>;
let dispatches=0,lookups=0,known=false,acceptedAt=clock.now(),holdReceipt=false,releaseReceipt:()=>void,enteredReceipt:()=>void;
let waiting:Promise<void>,entered:Promise<void>;
const start=async()=>{
  service=new NetworkService({url,clock,photoStorage:null,tokens:"safety:saf-tok",env:{PLATFORM_ENV:"dev",CLEF_RATINGS:"off",SERVICE_TURN_SECRET:secret},networks:[{id:"friends:nyc",matchingEnabled:false}],network:{seed:1},log:()=>{},
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
    const payload=JSON.parse(raw);expect(auth.id).toBe(payload.id);expect(payload.app).toBe("friends");expect([phone,phone2]).toContain(payload.to);expect(payload.memberId).toBeTruthy();
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

test("policy changes winning after the async gate refuse ordinary dispatch while compliance remains explicit",async()=>{
  known=true;
  const joined=await service.accounts.join(APPS.friends,{e164:phone,personId:null},{firstName:"Ari",age:29,consent:{sms:true,wording:APPS.friends.consent.text}});
  expect(joined.ok).toBe(true);if(!joined.ok) throw new Error("Fixture join refused");
  const rt=service.runtimes.get("friends:nyc")!,memberId=joined.membership.memberId;
  const person=await service.accounts.personFor(phone);expect(person).toBeDefined();
  const membership=(await service.people.getMembership(person!.id,"friends"))!;
  const checks=((rt.adapter as CloudChannelAdapter).queue as unknown as {o:import("../../blooio/src/outbound-queue.ts").QueueOptions}).o.checks;
  const original=checks.leaks;
  for(const variant of ["account_paused","account_restricted","membership_restricted","membership_review","phone_hold","ban"] as const) {
    await rt.adapter.engaged!(phone);
    const before=dispatches,id=`policy-admission:${variant}`;
    let release!:()=>void,arrive!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{arrive=resolve;});
    checks.leaks=async row=>{const result=await original!(row);if(row.id===id){arrive();await gate;}return result;};
    // A paused or restricted account, or a membership under review, still gets replies to its own messages
    // (the admission fence stops only proactive sends: outbound-queue.ts send()). Those barriers are
    // tested with a proactive row; a phone hold and a ban stop a reply too.
    const proactive=variant==="account_paused"||variant==="account_restricted"||variant==="membership_restricted"||variant==="membership_review";
    const sending=rt.unitOfWork(()=>rt.unit.sends.push({id,memberId,to:phone,body:"Your requested reminder is ready.",kind:proactive?"proactive":"reply",type:"reminder",proactive,system:false,ts:clock.now()}));
    try {
      await entered;
      if(variant==="account_paused"||variant==="account_restricted") await rt.scoped(tx=>tx`update network.members set account_status=${variant==="account_paused"?"paused":"restricted"} where app_id='friends' and id=${memberId}`);
      else if(variant==="membership_restricted") await service.people.putMembership({...membership,state:"restricted"});
      else if(variant==="membership_review") await service.people.putMembership({...membership,review:"recycled_number"});
      else if(variant==="phone_hold") await service.people.setPhoneHold(phone,"recycled_number",clock.now());
      else await service.people.ban({id:"owned-admission-ban",scope:"phone",personId:person!.id,phoneHash:service.accounts.phoneHash(phone),reason:"owned barrier fixture",reportId:null,bannedBy:"fixture",at:clock.now()});
      release();await sending;
      expect(dispatches).toBe(before);
      const [stored]=await sql`select status,provider_message_id,sent_at from platform.outbound where id=${id}`;
      expect(stored.provider_message_id).toBeNull();expect(stored.sent_at).toBeNull();expect(stored.status).not.toBe("accepted");
      // The admission fence itself ended the row, after the async gate.
      expect(stored.status).toBe(({account_paused:"suppressed_ineligible",account_restricted:"suppressed_ineligible",membership_restricted:"dropped_forgotten",membership_review:"dropped_forgotten",phone_hold:"dropped_forgotten",ban:"refused_opted_out"} as const)[variant]);
      if(variant==="account_restricted") {
        await rt.unitOfWork(()=>rt.system(memberId,"restricted-compliance","Your safety request was received.","compliance"));
        expect(dispatches).toBe(before+1);
        expect((await sql`select status from platform.outbound where id='restricted-compliance'`)[0].status).toBe("accepted");
      }
    } finally {
      release();checks.leaks=original;
      // Restore controlled canonical fixtures for the next independent barrier; never clear the final real ban.
      if(variant==="account_paused"||variant==="account_restricted") await rt.scoped(tx=>tx`update network.members set account_status='active' where app_id='friends' and id=${memberId}`);
      else if(variant==="membership_restricted"||variant==="membership_review") await service.people.putMembership(membership);
      else if(variant==="phone_hold") await service.people.setPhoneHold(phone,null,clock.now());
    }
  }
},60_000);

test("signed-turn replies pass the queue's leak guard (a failing one is parked for staff, who review it through the service); a lagging message status is repaired once",async()=>{
  known=true;
  const joined=await service.accounts.join(APPS.friends,{e164:phone2,personId:null},{firstName:"Cy",age:33,consent:{sms:true,wording:APPS.friends.consent.text}});
  expect(joined.ok).toBe(true);if(!joined.ok) throw new Error("Fixture join refused");
  const rt=service.runtimes.get("friends:nyc")!,memberId=joined.membership.memberId;
  await rt.adapter.engaged!(phone2);
  const before=dispatches;
  const r=await service.inbox.signed({messageId:"canary-turn",channel:"blooio",from:phone2,to:null,text:"what did you find?",transport:"imessage",receivedAt:clock.now()},"h-canary-turn",async turn=>{
    turn.app="friends";turn.memberId=memberId;
    await rt.unitOfWork(()=>{rt.system(memberId,"canary-reply","Your code is CANARY_TEST_77_x","reply");rt.system(memberId,"clean-reply","See you Saturday.","reply");});
    const [row]=await sql`select replies from platform.inbound where id=${turn.id}`;
    const replies=row.replies as {id:string;body:string}[];
    return {outcome:"handled",replies:replies.map(x=>x.body),replyIds:replies.map(x=>x.id),delivery:"collected",replyKind:"reply",accountEligible:true,app:"friends",memberId,reason:"handled"};
  });
  expect(r.status).toBe(200);
  // Only the clean reply is collected for Cloud; it is in the line's thread history. The canary went to the queue, which parked it.
  expect((r.body as any).replyIds).toEqual(["clean-reply"]);
  expect((await sql`select status from platform.outbound where id='clean-reply'`)[0].status).toBe("collected");
  expect((await sql`select status from platform.outbound where id='canary-reply'`)[0].status).toBe("parked_leak_review");
  expect(dispatches).toBe(before);
  // Staff review through the service (the console's routes): listed, a reason is required, dropped and audited.
  const staffCall=(path:string,method="GET",b?:object)=>service.fetch(new Request(`http://127.0.0.1${path}`,{method,headers:{authorization:"Bearer saf-tok",...(b?{"content-type":"application/json"}:{})},...(b?{body:JSON.stringify(b)}:{})}));
  const list=await (await staffCall("/queue/leak-review?app=friends")).json() as any;
  expect(list.items.map((x:any)=>x.id)).toContain("canary-reply");
  expect(list.items.find((x:any)=>x.id==="canary-reply").reasons.length).toBeGreaterThan(0);
  expect(JSON.stringify(list)).not.toContain(phone2);
  expect(await (await staffCall("/queue/leak-review/canary-reply?app=friends","POST",{decision:"drop",reason:"ok"})).json()).toMatchObject({ok:false,reason:"reason_required"});
  expect(await (await staffCall("/queue/leak-review/canary-reply?app=friends","POST",{decision:"drop",reason:"a test canary, never send"})).json()).toEqual({ok:true});
  expect((await sql`select status from platform.outbound where id='canary-reply'`)[0].status).toBe("dropped_leak_review");
  expect((await sql`select status from network.messages where id='canary-reply'`)[0].status).toBe("dropped_leak_review");
  expect((await sql`select reason from network.staff_audit where action='leak_drop' and target_id='canary-reply'`)[0].reason).toBe("a test canary, never send");
  expect(await (await staffCall("/queue/leak-review/canary-reply?app=friends","POST",{decision:"release",reason:"changed my mind"})).json()).toMatchObject({ok:false,reason:"not_parked"});
  // A message whose own status lagged the queue's (a crash between the acceptance commit and the status write):
  // projected once, its status repaired from the queue's, and never selected again.
  await rt.unitOfWork(()=>rt.unit.sends.push({id:"drift-1",memberId,to:phone2,body:"Your requested reminder is ready.",kind:"reply",type:"reminder",proactive:false,system:false,ts:clock.now()}));
  expect((await sql`select status from platform.outbound where id='drift-1'`)[0].status).toBe("accepted");
  await rt.scoped(tx=>tx`update network.messages set status='queued',notification_recorded_at=null where app_id='friends' and id='drift-1'`);
  await rt.projectNotifications();
  const [drift]=await sql`select status,notification_recorded_at from network.messages where id='drift-1'`;
  expect(drift.status).toBe("accepted");expect(drift.notification_recorded_at).not.toBeNull();
},60_000);
