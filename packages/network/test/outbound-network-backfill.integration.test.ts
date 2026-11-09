// Integration: the outbound-queue-row machine (quint/outbound_queue.qnt) across a deploy. Migration 0045 gives
// each queue row a network; a replica that runs code from before 0045 still writes rows without one after the new
// replica migrated. Real service, runtime, CloudChannelAdapter, OutboundQueue and PostgreSQL on the dev cluster
// (:54339); Cloud is a local signed server. Nothing leaves the machine.
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

const db=`network_outbound_backfill_${randomUUID().replaceAll("-","")}`;
const admin=new SQL({url:`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/postgres`,max:1});
const url=`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/${db}`;
// 12:00 in New York: outside quiet hours.
const clock=new SimClock(Date.UTC(2026,9,9,16)),secret="synthetic-outbound-backfill-signing-secret-20261108",LINE="+12125550200";
const ENV={PLATFORM_ENV:"dev",BLOOIO_ALLOW_SEND:"1",NTWRK_LIVE_APPROVED:"1",FRIENDS_LIVE_APPROVED:"1"};
let sql:SQL,cloud:ReturnType<typeof Bun.serve>,service:NetworkService|undefined;
const dispatched:string[]=[];

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
afterAll(async()=>{await service?.close().catch(()=>{});cloud?.stop(true);await sql?.close();
  await admin.unsafe(`drop database if exists ${db} with (force)`).catch(()=>{});await admin.close();});

test("a row that a pre-0045 replica wrote without a network is drained by the app's first-city queue",async()=>{
  service=new NetworkService({url,clock,instance:"replica-new",photoStorage:null,tokens:"safety:saf-tok",env:{PLATFORM_ENV:"dev",CLEF_RATINGS:"off",SERVICE_TURN_SECRET:secret},
    networks:[{id:"friends:nyc",matchingEnabled:false}],network:{seed:1},log:()=>{},
    adapter:(_net,rt)=>new CloudChannelAdapter({clock,app:rt.app.id,city:rt.city,from:LINE,origin:cloud.url.origin,secret,env:ENV})});
  await service.start();
  const rt:NetworkRuntime=service.runtimes.get("friends:nyc")!;
  const phone="+12125550201";
  const joined=await service.accounts.join(APPS.friends,{e164:phone,personId:null},{firstName:"Ada",age:30,consent:{sms:true,wording:APPS.friends.consent.text}});
  if (!joined.ok) throw new Error("Fixture join refused");
  const memberId=joined.membership.memberId;
  await rt.unitOfWork(()=>undefined);
  // The old replica's insert has no network_id column value: the row is null after migration 0045 ran.
  await (rt.adapter as CloudChannelAdapter).queue.enqueue(sql,[{id:"old-replica-reminder",memberId,to:phone,kind:"transactional",text:"Your plan reminder is ready.",city:"nyc"}]);
  await sql`update platform.outbound set network_id = null where id = 'old-replica-reminder'`;
  await rt.deliver();
  expect(dispatched).toContain("old-replica-reminder");
  expect((await sql`select status, network_id from platform.outbound where id = 'old-replica-reminder'`)[0]).toEqual({status:"accepted",network_id:"friends:nyc"});
},60_000);
