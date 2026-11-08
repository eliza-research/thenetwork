// Integration: the outbound-queue-row machine (docs/research/2026-11-07-state-machines.md section 5,
// quint/outbound_queue.qnt). The real service, runtime, CloudChannelAdapter, OutboundQueue and PostgreSQL
// on the dev cluster (:54339). Cloud HTTP is the controlled transport boundary: a local server that
// verifies the signature and answers as the test says. Nothing leaves the machine.
import {afterAll,beforeAll,expect,test} from "bun:test";
import {randomUUID} from "node:crypto";
import {SQL} from "bun";
import {SimClock} from "@thenetwork/core";
import {applySchema} from "../../observatory/db/dev-pg.ts";
import {APPS} from "../../platform/src/apps.ts";
import {svcSign,svcVerify} from "../../core/src/svc/svc-auth.ts";
import {DELIVER_PATH,TURN_PATH,TURN_RECEIPT_PATH,type TurnReceiptRequest,type TurnRequest} from "../../core/src/svc/contract.ts";
import {CloudChannelAdapter} from "../service/cloud-channel.ts";
import {NetworkService} from "../service/service.ts";
import type {NetworkRuntime} from "../service/runtime.ts";

const db=`network_outbound_queue_${randomUUID().replaceAll("-","")}`;
const admin=new SQL({url:`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/postgres`,max:1});
const url=`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/${db}`;
// 12:00 in New York: outside quiet hours.
const clock=new SimClock(Date.UTC(2026,9,9,16)),secret="synthetic-outbound-queue-signing-secret-20261108",LINE="+12125550180";
const ENV={PLATFORM_ENV:"dev",BLOOIO_ALLOW_SEND:"1",NTWRK_LIVE_APPROVED:"1",FRIENDS_LIVE_APPROVED:"1"};
let sql:SQL,cloud:ReturnType<typeof Bun.serve>;
const services:NetworkService[]=[];
/** What Cloud answers. deliver: "accept" takes the text; "unknown" times out after it may have taken it. */
const cloudMode={deliver:"accept" as "accept"|"unknown",receipt:"unknown" as "accept"|"unknown"};
/** Every id Cloud took on the deliver path (one entry per call). */
const dispatched:string[]=[];

const replica=async(instance:string,networks=["friends:nyc"])=>{
  const s=new NetworkService({url,clock,instance,photoStorage:null,tokens:"safety:saf-tok",env:{PLATFORM_ENV:"dev",CLEF_RATINGS:"off",SERVICE_TURN_SECRET:secret},
    networks:networks.map(id=>({id,matchingEnabled:false})),network:{seed:1},log:()=>{},
    adapter:(_net,rt)=>new CloudChannelAdapter({clock,app:rt.app.id,city:rt.city,from:LINE,origin:cloud.url.origin,secret,env:ENV})});
  await s.start();services.push(s);
  return s;
};
const runtime=(s:NetworkService):NetworkRuntime=>s.runtimes.get("friends:nyc")!;
const queueOf=(rt:NetworkRuntime)=>(rt.adapter as CloudChannelAdapter).queue;
const join=async(s:NetworkService,phone:string,firstName:string)=>{
  const joined=await s.accounts.join(APPS.friends,{e164:phone,personId:null},{firstName,age:30,consent:{sms:true,wording:APPS.friends.consent.text}});
  if (!joined.ok) throw new Error("Fixture join refused");
  return joined.membership.memberId;
};
/** The first replica: the one every later test drains with (it loads the stored state first). */
const primary=async()=>{const rt=runtime(services[0] ?? await replica("replica-a"));await rt.unitOfWork(()=>undefined);return rt;};
/** Set the shared clock forward to the next time it is hh:mm in New York (EDT, UTC-4, in October 2026). */
const toNewYork=(hh:number,mm:number)=>{const d=new Date(clock.now()),t=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),hh+4,mm);
  clock.advance(((t-clock.now())%86_400_000+86_400_000)%86_400_000||86_400_000);};
const statusOf=async(id:string)=>(await sql`select status from platform.outbound where id=${id}`)[0]?.status as string|undefined;

beforeAll(async()=>{
  await admin.unsafe(`create database ${db}`);await applySchema(url,{lockTimeout:"5s"});sql=new SQL({url,max:2});
  cloud=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async req=>{
    const path=new URL(req.url).pathname,raw=await req.text();
    const auth=await svcVerify(secret,{method:req.method,path,headers:req.headers,body:raw,nowS:Math.floor(clock.now()/1000)});
    if (!auth.ok) return Response.json({ok:false,error:"invalid"},{status:401});
    const payload=JSON.parse(raw);
    const accepted=()=>Response.json({ok:true,replayed:false,providerMessageIds:[`provider:${payload.id}`],history:true});
    if (path===DELIVER_PATH) {
      dispatched.push(payload.id);
      if (cloudMode.deliver==="unknown") return Response.json({ok:false,error:"unknown",retryable:true},{status:504});
      return accepted();
    }
    return cloudMode.receipt==="accept"?accepted():Response.json({ok:false,error:"unknown",retryable:true},{status:202});
  }});
},120_000);
afterAll(async()=>{for (const s of services) await s.close().catch(()=>{});cloud?.stop(true);await sql?.close();
  await admin.unsafe(`drop database if exists ${db} with (force)`).catch(()=>{});await admin.close();});

test("SD-020: a replica whose Network state is older than the stored one never claims a row; it leaves the row until it loads the new state",async()=>{
  const a=await replica("replica-a"),b=await replica("replica-b");
  const rtA=runtime(a),rtB=runtime(b);
  const phone="+12125550181";
  const memberId=await join(a,phone,"Ada");
  // Replica A loads the state with the member (a unit, as after any inbound message on A).
  await rtA.unitOfWork(()=>undefined);
  // Staff hold the member on replica B. A's in-memory Network does not know about the hold.
  const held=await rtB.unitOfWork(n=>n.holdMember(memberId as never,"staff:test","report review"));
  expect(held.ok).toBe(true);
  // A reminder is in the queue that B's drain has not seen yet (B's drain lost the line lock to A, or the row came after it).
  await queueOf(rtA).enqueue(sql,[{id:"sd020-reminder",memberId,to:phone,kind:"transactional",text:"Your plan reminder is ready.",city:"nyc"}]);
  expect(rtA.net.recipientPolicy(memberId as never,"info").ok).toBe(true);
  // A delivers (its tick was skipped because B held the tick lock, or a unit on A ended): the held member gets nothing.
  await rtA.deliver();
  expect(dispatched).not.toContain("sd020-reminder");
  expect(await statusOf("sd020-reminder")).toBe("pending");
  // When A loads the stored state, its own drain sees the hold and ends the row unsent.
  await rtA.unitOfWork(()=>undefined);
  expect(dispatched).not.toContain("sd020-reminder");
  expect(await statusOf("sd020-reminder")).toBe("suppressed_ineligible");
  // The same race inside one drain: another replica saves after A's checks read its memory, before A claims the row.
  const other="+12125550182",otherId=await join(a,other,"Bo");
  await rtA.unitOfWork(()=>undefined);
  await queueOf(rtA).enqueue(sql,[{id:"sd020-race",memberId:otherId,to:other,kind:"transactional",text:"Your plan reminder is ready.",city:"nyc"}]);
  const checks=(queueOf(rtA) as unknown as {o:{checks:{leaks:(row:unknown)=>unknown}}}).o.checks,leaks=checks.leaks;
  checks.leaks=async row=>{checks.leaks=leaks;await rtB.readState(()=>undefined);await sql.begin(async tx=>{await tx`select set_config('app.app_id','friends',true)`;
    await tx`update network.network_state set saved_at=saved_at where id='friends:nyc'`;});return leaks(row);};
  await rtA.deliver();
  expect(dispatched).not.toContain("sd020-race");
  expect(await statusOf("sd020-race")).toBe("pending");
  await rtA.unitOfWork(()=>undefined);
  expect(dispatched).toContain("sd020-race");
},60_000);

test("SD-090: an unknown acceptance gets its receipt lookups for the whole TTL, counted from when it became unknown; failed_unknown keeps the person-cap slot",async()=>{
  const rt=await primary();
  const phone="+12125550183",memberId=await join(services[0]!,phone,"Cal");
  await rt.unitOfWork(()=>undefined);
  const slots=async(id:string)=>(await sql`select count(*)::int as n from platform.person_sends where msg_id=${id}`)[0].n as number;
  // A proactive text is written at 21:30 in New York: quiet hours hold it until 09:00.
  toNewYork(21,30);
  await queueOf(rt).enqueue(sql,[{id:"sd090-intro",memberId,to:phone,kind:"proactive",text:"Someone near you also runs on Sundays.",city:"nyc"}]);
  await rt.deliver();
  expect(await statusOf("sd090-intro")).toBe("deferred_quiet_hours");
  // 09:01: the deliver call times out after Cloud may have taken the text. The row takes its cap slot.
  toNewYork(9,1);cloudMode.deliver="unknown";cloudMode.receipt="accept";
  await rt.deliver();
  expect(dispatched.filter(id=>id==="sd090-intro").length).toBe(1);
  expect(await statusOf("sd090-intro")).toBe("unknown_acceptance");
  expect(await slots("sd090-intro")).toBe(1);
  // The next drain, a minute later: the row is 11.5 hours old, but its acceptance has been unknown for one minute.
  // The receipt lookup finds that Cloud took it; the slot stays counted.
  clock.advance(60_000);
  await rt.deliver();
  expect(await statusOf("sd090-intro")).toBe("accepted");
  expect(await slots("sd090-intro")).toBe(1);
  // A text whose acceptance stays unknown for the whole TTL ends failed_unknown. Cloud may have sent it, so its slot stays counted.
  cloudMode.receipt="unknown";
  await queueOf(rt).enqueue(sql,[{id:"sd090-second",memberId,to:phone,kind:"proactive",text:"A second runner near you is free on Sunday.",city:"nyc"}]);
  await rt.deliver();
  expect(await statusOf("sd090-second")).toBe("unknown_acceptance");
  clock.advance(6*3_600_000-60_000);
  await rt.deliver();
  expect(await statusOf("sd090-second")).toBe("unknown_acceptance");
  clock.advance(2*60_000);
  await rt.deliver();
  expect(await statusOf("sd090-second")).toBe("failed_unknown");
  expect(await slots("sd090-second")).toBe(1);
  expect(dispatched.filter(id=>id==="sd090-second").length).toBe(1);
  cloudMode.deliver="accept";
},60_000);

test("SD-091: under Cloud a text to a non-member ends at acceptance and keeps no address and no text",async()=>{
  const rt=await primary();
  const stranger="+12125550184";
  // A staff invite to someone who is not a member: a direct text. Cloud takes it; no delivery receipt ever reaches this service.
  expect(await rt.adapter.direct(stranger,"You're invited to friends.help. Reply JOIN to start.","sd091-invite","transactional")).toBe("accepted");
  expect(dispatched).toContain("sd091-invite");
  const [row]=await sql`select status,member_id,to_address,body,ended_at,sent_at from platform.outbound where id='sd091-invite'`;
  expect(row.status).toBe("accepted");expect(row.member_id).toBeNull();expect(row.sent_at).not.toBeNull();
  expect({to:row.to_address,body:row.body}).toEqual({to:null,body:null});
  expect(row.ended_at).not.toBeNull();
},60_000);

test("SD-094: under a Blooio line safety action compliance texts still go; other texts wait",async()=>{
  const rt=await primary();
  const phone="+12125550185",memberId=await join(services[0]!,phone,"Dee");
  await rt.unitOfWork(()=>undefined);
  await rt.adapter.engaged!(phone);
  try {
    // safety.number_banned: the line is under review.
    await rt.adapter.lineSafety!("review","safety.number_banned");
    await rt.unitOfWork(()=>{
      rt.system(memberId as never,"sd094-stop","You're unsubscribed from friends.help. Text START to come back.","compliance");
      rt.system(memberId as never,"sd094-reminder","Your plan reminder is ready.","transactional");
    });
    expect(await statusOf("sd094-reminder")).toBe("retry_scheduled");
    expect(await statusOf("sd094-stop")).toBe("accepted");
    // pause_new: a STOP confirmation to an address the line has no conversation with yet still goes.
    await rt.adapter.lineSafety!("pause_new","safety.state_changed");
    expect(await rt.adapter.direct("+12125550186","You're unsubscribed. Text START to come back.","sd094-stranger-stop","compliance")).toBe("accepted");
  } finally {await rt.adapter.lineSafety!(undefined);}
},60_000);

/** One signed turn of `memberId` whose Network unit sends `replies` (collected for the gateway). Returns the collected reply ids. */
const signedTurn=async(s:NetworkService,rt:NetworkRuntime,messageId:string,phone:string,memberId:string,replies:[string,string][],engagedFirst=true)=>{
  const r=await s.inbox.signed({messageId,channel:"blooio",from:phone,to:null,text:"what did you find?",transport:"imessage",receivedAt:clock.now()},`h-${messageId}`,async turn=>{
    turn.app="friends";turn.memberId=memberId;
    if (engagedFirst) await rt.adapter.engaged!(phone);
    await rt.unitOfWork(()=>{for (const [id,body] of replies) rt.system(memberId as never,id,body,"reply");});
    const [row]=await sql`select replies from platform.inbound where id=${turn.id}`;
    const collected=row.replies as {id:string;body:string}[];
    return {outcome:"handled",replies:collected.map(x=>x.body),replyIds:collected.map(x=>x.id),delivery:"collected",replyKind:"reply",accountEligible:true,app:"friends",memberId,reason:"handled"};
  });
  expect(r.status).toBe(200);
  return (r.body as {replyIds:string[]}).replyIds;
};
const turnReceipt=async(s:NetworkService,input:TurnReceiptRequest)=>{
  const body=JSON.stringify(input);
  return s.fetch(new Request(`http://127.0.0.1${TURN_RECEIPT_PATH}`,{method:"POST",body,
    headers:{"content-type":"application/json",...await svcSign(secret,{method:"POST",path:TURN_RECEIPT_PATH,id:`${input.messageId}:receipt`,body,nowS:Math.floor(clock.now()/1000)})}}));
};
const both=async(id:string)=>{
  const [o]=await sql`select status,ended_at from platform.outbound where id=${id}`,[m]=await sql`select status from network.messages where id=${id}`;
  return {outbound:o?.status,ended:o?.ended_at!=null,message:m?.status};
};

test("SD-100: a collected reply whose gateway receipt never comes, or comes as unknown, ends failed_unknown after the TTL",async()=>{
  const s=services[0]!,rt=await primary();
  const phone="+12125550187",memberId=await join(s,phone,"Eve");
  await rt.unitOfWork(()=>undefined);
  // Turn 1: the gateway dies before it sends a receipt.
  expect(await signedTurn(s,rt,"sd100-lost",phone,memberId,[["sd100-lost-reply","See you Saturday."]])).toEqual(["sd100-lost-reply"]);
  // Turn 2: the gateway answers "unknown".
  clock.advance(60_000);
  expect(await signedTurn(s,rt,"sd100-unknown",phone,memberId,[["sd100-unknown-reply","The class starts at 7."]])).toEqual(["sd100-unknown-reply"]);
  expect((await turnReceipt(s,{channel:"blooio",messageId:"sd100-unknown",replyIds:["sd100-unknown-reply"],providerMessageIds:[],historyRecorded:false,outcome:"unknown"})).status).toBe(200);
  expect(await both("sd100-lost-reply")).toEqual({outbound:"collected",ended:false,message:"collected"});
  expect(await both("sd100-unknown-reply")).toEqual({outbound:"send_unknown",ended:false,message:"send_unknown"});
  // Inside the TTL a drain leaves them: a late receipt can still settle them.
  clock.advance(5*3_600_000);await rt.unitOfWork(()=>undefined);
  expect((await both("sd100-lost-reply")).outbound).toBe("collected");
  // After the TTL the queue ends both, and the message status follows.
  clock.advance(3_600_000+2*60_000);await rt.unitOfWork(()=>undefined);
  expect(await both("sd100-lost-reply")).toEqual({outbound:"failed_unknown",ended:true,message:"failed_unknown"});
  expect(await both("sd100-unknown-reply")).toEqual({outbound:"failed_unknown",ended:true,message:"failed_unknown"});
},60_000);

test("SD-101: a reply that fails the leak guard in a signed turn is parked for staff, also when the member's last message is hours old",async()=>{
  const s=services[0]!,rt=await primary();
  const phone="+12125550188",memberId=await join(s,phone,"Fay");
  await rt.unitOfWork(()=>undefined);
  // The real turn order: the unit (and its drain) runs inside inbound(); engaged runs after it returns.
  const before=dispatched.length;
  expect(await signedTurn(s,rt,"sd101-turn",phone,memberId,[["sd101-canary","Your code is CANARY_TEST_77_x"],["sd101-clean","See you Saturday."]],false)).toEqual(["sd101-clean"]);
  expect(dispatched.length).toBe(before);
  const [o]=await sql`select status,note from platform.outbound where id='sd101-canary'`;
  expect(o.status).toBe("parked_leak_review");expect(String(o.note)).toStartWith("leak: ");
  expect((await sql`select status from network.messages where id='sd101-canary'`)[0].status).toBe("parked_leak_review");
  expect((await queueOf(rt).parkedLeaks()).map(x=>x.id)).toContain("sd101-canary");
},60_000);

test("SD-117: a database error in the admission transaction does not end the row; it waits and goes on the next drain",async()=>{
  toNewYork(12,0);
  const rt=await primary();
  const phone="+12125550189",memberId=await join(services[0]!,phone,"Gus");
  await rt.unitOfWork(()=>undefined);
  await rt.adapter.engaged!(phone);
  const [{person_id:personId}]=await sql`select person_id from network.members where app_id='friends' and id=${memberId}`;
  await queueOf(rt).enqueue(sql,[{id:"sd117-reminder",memberId,to:phone,kind:"transactional",text:"Your plan reminder is ready.",city:"nyc"}]);
  // Another transaction holds the person row (an erasure, a ban); the admission transaction's lock wait times out.
  const checks=(queueOf(rt) as unknown as {o:{checks:{lockAdmission:(row:unknown,tx:SQL)=>Promise<boolean>}}}).o.checks,lock=checks.lockAdmission;
  checks.lockAdmission=async(row,tx)=>{checks.lockAdmission=lock;const ok=await lock(row,tx);await tx`set local lock_timeout='200ms'`;return ok;};
  const holder=await sql.reserve();
  try {
    await holder`begin`;
    await holder`select id from platform.people where id=${personId} for update`;
    await rt.deliver();
  } finally {await holder`rollback`;holder.release();}
  expect(dispatched).not.toContain("sd117-reminder");
  expect(await statusOf("sd117-reminder")).toBe("retry_scheduled");
  // The lock is free again: the next drain after the backoff sends the reminder.
  clock.advance(60_000);
  await rt.deliver();
  expect(dispatched).toContain("sd117-reminder");
  expect(await statusOf("sd117-reminder")).toBe("accepted");
},60_000);

const turnPost=async(s:NetworkService,input:TurnRequest)=>{
  const body=JSON.stringify(input);
  return s.fetch(new Request(`http://127.0.0.1${TURN_PATH}`,{method:"POST",body,
    headers:{"content-type":"application/json",...await svcSign(secret,{method:"POST",path:TURN_PATH,id:input.messageId,body,nowS:Math.floor(clock.now()/1000)})}}));
};

test("SD-131: Cloud's accepted receipt with no history is recorded for a reply to a number the service gave no account",async()=>{
  await primary();
  const s=services[0]!;
  const phone="+12125550190";
  // The person asked to delete everything: the number is suppressed. Later they text the line again to come back.
  await s.people.deleteAll(null,phone,s.accounts.phoneHash(phone),clock.now());
  const r=await turnPost(s,{messageId:"sd131-back",channel:"blooio",from:phone,to:null,text:"friends.help",transport:"imessage",receivedAt:clock.now(),app:"friends"});
  expect(r.status).toBe(200);
  const handled=await r.json() as {outcome:string;accountEligible:boolean;replyIds:string[];replyKind:string;reason:string};
  expect(handled.outcome).toBe("handled");
  expect(handled.accountEligible).toBe(false);
  expect(handled.replyIds.length).toBeGreaterThan(0);
  // Cloud sends the join question; with no Eliza account it has no history to record.
  const receipt=await turnReceipt(s,{channel:"blooio",messageId:"sd131-back",replyIds:handled.replyIds,providerMessageIds:["provider:sd131"],historyRecorded:false,outcome:"accepted"});
  expect(receipt.status).toBe(200);
  const [row]=await sql`select receipt->>'outcome' as outcome from platform.inbound where id='msg:blooio:sd131-back'`;
  expect(row.outcome).toBe("accepted");
},60_000);

test("SD-132: a second network of the same app on the same line never drains the first network's rows",async()=>{
  toNewYork(12,0);
  await primary();
  const s=await replica("replica-cities",["friends:nyc","friends:sf"]);
  const nyc=s.runtimes.get("friends:nyc")!,sf=s.runtimes.get("friends:sf")!;
  const phone="+12125550191",memberId=await join(s,phone,"Hal");
  await nyc.unitOfWork(()=>undefined);await sf.unitOfWork(()=>undefined);
  await nyc.adapter.engaged!(phone);
  await queueOf(nyc).enqueue(sql,[{id:"sd132-reminder",memberId,to:phone,kind:"transactional",text:"Your plan reminder is ready.",city:"nyc"}]);
  // The sf network drains first: the nyc member is not its member, and its checks must not decide the row.
  await sf.deliver();
  expect(await statusOf("sd132-reminder")).toBe("pending");
  await nyc.deliver();
  expect(dispatched).toContain("sd132-reminder");
  expect(await statusOf("sd132-reminder")).toBe("accepted");
},60_000);

test("SD-136: a direct text's drain writes the statuses it changed to network.messages",async()=>{
  const rt=await primary();
  const phone="+12125550192",memberId=await join(services[0]!,phone,"Ida");
  await rt.unitOfWork(()=>undefined);
  await rt.adapter.engaged!(phone);
  // A reminder at 22:00 in New York waits for quiet hours to end.
  toNewYork(22,0);
  await rt.unitOfWork(()=>{rt.system(memberId as never,"sd136-reminder","Your plan reminder is ready.","transactional");});
  expect(await both("sd136-reminder")).toEqual({outbound:"deferred_quiet_hours",ended:false,message:"deferred_quiet_hours"});
  // Three days later the first drain is the one a direct text (a staff invite) runs: the reminder is past its time.
  clock.advance(3*86_400_000);toNewYork(11,0);
  expect(await rt.adapter.direct("+12125550193","You're invited to friends.help. Reply JOIN to start.","sd136-invite","transactional")).toBe("accepted");
  expect(await both("sd136-reminder")).toEqual({outbound:"expired",ended:true,message:"expired"});
},60_000);

test("SD-147: a row the unanswered cap holds while the person writes back is not left held",async()=>{
  toNewYork(12,0);
  const rt=await primary();
  const phone="+12125550194",memberId=await join(services[0]!,phone,"Jo");
  await rt.unitOfWork(()=>undefined);
  await rt.adapter.engaged!(phone);
  // Three texts with no answer: the conversation is at the unanswered cap.
  for (const n of [1,2,3]) await rt.unitOfWork(()=>{rt.system(memberId as never,`sd147-${n}`,`Plan note ${n} is ready.`,"transactional");});
  expect((await sql`select unanswered from platform.line_conversations where address=${phone}`)[0].unanswered).toBe(3);
  // The drain reads the conversation at the cap; the person's message commits before the drain writes the hold.
  clock.advance(60_000);
  const q=queueOf(rt) as unknown as {conversation:(address:string)=>Promise<unknown>},read=q.conversation;
  q.conversation=async address=>{const c=await read.call(q,address);if (address===phone) {q.conversation=read;await rt.adapter.engaged!(phone);}return c;};
  await rt.unitOfWork(()=>{rt.system(memberId as never,"sd147-fourth","Plan note 4 is ready.","transactional");});
  q.conversation=read;
  expect((await sql`select unanswered from platform.line_conversations where address=${phone}`)[0].unanswered).toBe(0);
  expect(await statusOf("sd147-fourth")).not.toBe("held_awaiting_reply");
  // The next drain sends it: nothing else would wake a held row.
  clock.advance(60_000);
  await rt.deliver();
  expect(dispatched).toContain("sd147-fourth");
  expect(await statusOf("sd147-fourth")).toBe("accepted");
},60_000);

test("SD-148: a collected reply that Cloud accepted counts in the line's unanswered streak and moves last_outbound_at",async()=>{
  toNewYork(12,0);
  const rt=await primary(),s=services[0]!;
  const phone="+12125550195",memberId=await join(s,phone,"Kit");
  await rt.unitOfWork(()=>undefined);
  // The member writes; the reply goes back through Cloud (a collected reply) and Cloud accepts it.
  expect(await signedTurn(s,rt,"sd148-turn",phone,memberId,[["sd148-reply","See you Saturday."]])).toEqual(["sd148-reply"]);
  clock.advance(1_000);
  expect((await turnReceipt(s,{channel:"blooio",messageId:"sd148-turn",replyIds:["sd148-reply"],providerMessageIds:["provider:sd148-reply"],historyRecorded:true,outcome:"accepted"})).status).toBe(200);
  const [c]=await sql`select unanswered,last_outbound_at from platform.line_conversations where address=${phone}`;
  expect(c.unanswered).toBe(1);
  expect(new Date(c.last_outbound_at).getTime()).toBe(clock.now());
  // Three agent texts follow with no answer: with the reply, the third is the fourth unanswered message. It waits.
  for (const n of [1,2,3]) {clock.advance(60_000);await rt.unitOfWork(()=>{rt.system(memberId as never,`sd148-${n}`,`Plan note ${n} is ready.`,"transactional");});}
  expect([await statusOf("sd148-1"),await statusOf("sd148-2"),await statusOf("sd148-3")]).toEqual(["accepted","accepted","held_awaiting_reply"]);
  expect(dispatched).not.toContain("sd148-3");
},60_000);

test("SD-299: when the stale check of a notification throws, the row is not sent; it waits and goes once the check reads it as current",async()=>{
  toNewYork(12,0);
  const rt=await primary();
  const phone="+12125550196",memberId=await join(services[0]!,phone,"Lev");
  await rt.unitOfWork(()=>undefined);
  await rt.adapter.engaged!(phone);
  await queueOf(rt).enqueue(sql,[{id:"ntf_sd299",memberId,to:phone,kind:"transactional",text:"Your weekly digest is ready.",city:"nyc"}]);
  // The notify store read fails (a lost connection): the drain cannot know whether the digest is still needed.
  const current=rt.notificationCurrent;
  rt.notificationCurrent=async()=>{throw new Error("Connection terminated unexpectedly");};
  try {await rt.deliver();} finally {rt.notificationCurrent=async()=>true;}
  expect(dispatched).not.toContain("ntf_sd299");
  expect(await statusOf("ntf_sd299")).toBe("retry_scheduled");
  // The store answers again and the digest is still needed: the next drain after the backoff sends it.
  clock.advance(60_000);
  try {await rt.deliver();} finally {rt.notificationCurrent=current;}
  expect(dispatched).toContain("ntf_sd299");
  expect(await statusOf("ntf_sd299")).toBe("accepted");
},60_000);

test("SD-300: two delivery receipts for one row that read the same status never move the status back",async()=>{
  toNewYork(12,0);
  const rt=await primary();
  const phone="+12125550197",memberId=await join(services[0]!,phone,"Max");
  await rt.unitOfWork(()=>undefined);
  await rt.adapter.engaged!(phone);
  await rt.unitOfWork(()=>{rt.system(memberId as never,"sd300-reminder","Your plan reminder is ready.","transactional");});
  expect(await statusOf("sd300-reminder")).toBe("accepted");
  const receipt=(status:"sent"|"delivered")=>rt.adapter.status!({kind:"status",channel:"blooio",providerMessageId:"provider:sd300-reminder",status,at:clock.now()});
  const waiting=async(n:number)=>{for (let i=0;i<200;i++) {
    const [w]=await admin`select count(*)::int as n from pg_stat_activity where datname=${db} and wait_event_type='Lock'`;if (w.n>=n) return;await Bun.sleep(10);}
    throw new Error("the receipts did not reach the row lock");};
  // Two webhooks in parallel: both read "accepted"; "delivered" writes first, then "sent" from its older read.
  const holder=await sql.reserve();
  let delivered:Promise<unknown>,sent:Promise<unknown>;
  try {
    await holder`begin`;
    await holder`select id from platform.outbound where id='sd300-reminder' for update`;
    delivered=receipt("delivered");await waiting(1);
    sent=receipt("sent");await waiting(2);
  } finally {await holder`rollback`;holder.release();}
  await delivered!;await sent!;
  expect(await statusOf("sd300-reminder")).toBe("delivered");
},60_000);

test("SD-316: a signed turn that ends unresolved keeps no collected reply text",async()=>{
  toNewYork(12,0);
  const rt=await primary(),s=services[0]!;
  const phone="+12125550198",memberId=await join(s,phone,"Ned");
  await rt.unitOfWork(()=>undefined);
  const repliesOf=async(id:string)=>(await sql`select status,replies from platform.inbound where id=${id}`)[0] as {status:string;replies:unknown[]};
  const input=(messageId:string):TurnRequest=>({messageId,channel:"blooio",from:phone,to:null,text:"what did you find?",transport:"imessage",receivedAt:clock.now()});
  // 1. The turn's unit collects a reply, then a later step of the turn throws.
  const failed=await s.inbox.signed(input("sd316-fault"),"h-sd316-fault",async turn=>{
    turn.app="friends";turn.memberId=memberId;
    await rt.unitOfWork(()=>{rt.system(memberId as never,"sd316-fault-reply","Ana is free on Saturday at 3.","reply");});
    expect((await repliesOf(turn.id)).replies.length).toBe(1);
    throw new Error("synthetic fault after the collection");
  });
  expect(failed.status).toBe(409);
  expect(await repliesOf("msg:blooio:sd316-fault")).toEqual({status:"unresolved",replies:[]});
  // 2. The worker of a turn stops after its collection: the next turn of the sender reads it as unresolved.
  clock.advance(11*60_000);
  let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
  const stuck=s.inbox.signed(input("sd316-stuck"),"h-sd316-stuck",async turn=>{
    turn.app="friends";turn.memberId=memberId;
    await rt.unitOfWork(()=>{rt.system(memberId as never,"sd316-stuck-reply","Bo can meet you on Sunday.","reply");});
    await gate;throw new Error("the worker stopped");
  });
  while (!(await repliesOf("msg:blooio:sd316-stuck"))?.replies?.length) await Bun.sleep(10);
  clock.advance(3*60_000);
  expect((await s.inbox.signed(input("sd316-next"),"h-sd316-next",async()=>{throw new Error("not reached");})).status).toBe(409);
  expect(await repliesOf("msg:blooio:sd316-stuck")).toEqual({status:"unresolved",replies:[]});
  release();await stuck;
},60_000);
