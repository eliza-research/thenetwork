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
import {svcVerify} from "../../core/src/svc/svc-auth.ts";
import {DELIVER_PATH} from "../../core/src/svc/contract.ts";
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

const replica=async(instance:string)=>{
  const s=new NetworkService({url,clock,instance,photoStorage:null,tokens:"safety:saf-tok",env:{PLATFORM_ENV:"dev",CLEF_RATINGS:"off",SERVICE_TURN_SECRET:secret},
    networks:[{id:"friends:nyc",matchingEnabled:false}],network:{seed:1},log:()=>{},
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
