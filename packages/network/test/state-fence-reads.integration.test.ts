// Integration: the queue's stale-state fence (SD-020, quint/outbound_queue.qnt) against read-only loads of the
// stored Network state. health() and sharedContext() read the stored state but do not import it into the
// runtime's memory, so they must not move the fence. Real service, runtime, CloudChannelAdapter, OutboundQueue
// and PostgreSQL on the dev cluster (:54339); Cloud is a local signed server. Nothing leaves the machine.
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

const db=`network_state_fence_${randomUUID().replaceAll("-","")}`;
const admin=new SQL({url:`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/postgres`,max:1});
const url=`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/${db}`;
// 12:00 in New York: outside quiet hours.
const clock=new SimClock(Date.UTC(2026,9,9,16)),secret="synthetic-state-fence-signing-secret-20261108",LINE="+12125550190";
const ENV={PLATFORM_ENV:"dev",BLOOIO_ALLOW_SEND:"1",NTWRK_LIVE_APPROVED:"1",FRIENDS_LIVE_APPROVED:"1"};
let sql:SQL,cloud:ReturnType<typeof Bun.serve>;
const services:NetworkService[]=[];
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
const statusOf=async(id:string)=>(await sql`select status from platform.outbound where id=${id}`)[0]?.status as string|undefined;

beforeAll(async()=>{
  await admin.unsafe(`create database ${db}`);await applySchema(url,{lockTimeout:"5s"});sql=new SQL({url,max:2});
  cloud=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async req=>{
    const path=new URL(req.url).pathname,raw=await req.text();
    const auth=await svcVerify(secret,{method:req.method,path,headers:req.headers,body:raw,nowS:Math.floor(clock.now()/1000)});
    if (!auth.ok) return Response.json({ok:false,error:"invalid"},{status:401});
    const payload=JSON.parse(raw);
    if (path===DELIVER_PATH) dispatched.push(payload.id);
    return Response.json({ok:true,replayed:false,providerMessageIds:[`provider:${payload.id}`],history:true});
  }});
},120_000);
afterAll(async()=>{for (const s of services) await s.close().catch(()=>{});cloud?.stop(true);await sql?.close();
  await admin.unsafe(`drop database if exists ${db} with (force)`).catch(()=>{});await admin.close();});

test("SD-020: health() and sharedContext() on a stale replica do not move the fence: the held member gets no reminder",async()=>{
  const a=await replica("replica-a"),b=await replica("replica-b");
  const rtA=runtime(a),rtB=runtime(b);
  const heldPhone="+12125550191",readerPhone="+12125550192";
  const heldId=await join(a,heldPhone,"Ada"),readerId=await join(a,readerPhone,"Bo");
  await rtA.unitOfWork(()=>undefined);
  // Replica B holds Ada and saves. Replica A's memory does not know about the hold.
  const held=await rtB.unitOfWork(n=>n.holdMember(heldId as never,"staff:test","report review"));
  expect(held.ok).toBe(true);
  expect(rtA.net.recipientPolicy(heldId as never,"info").ok).toBe(true);
  // A answers the monitor and an open turn of another member: both read the stored state only.
  expect((await rtA.health()).ok).toBe(true);
  expect(await rtA.sharedContext(readerId)).not.toBeNull();
  expect(rtA.net.recipientPolicy(heldId as never,"info").ok).toBe(true);
  // A reminder for Ada waits in the queue. A delivers without a unit (its tick lost the tick lock to B).
  await queueOf(rtA).enqueue(sql,[{id:"fence-read-reminder",memberId:heldId,to:heldPhone,kind:"transactional",text:"Your plan reminder is ready.",city:"nyc"}]);
  await rtA.deliver();
  expect(dispatched).not.toContain("fence-read-reminder");
  expect(await statusOf("fence-read-reminder")).toBe("pending");
  // When A imports the stored state, its drain sees the hold and ends the row unsent.
  await rtA.unitOfWork(()=>undefined);
  expect(dispatched).not.toContain("fence-read-reminder");
  expect(await statusOf("fence-read-reminder")).toBe("suppressed_ineligible");
},60_000);
