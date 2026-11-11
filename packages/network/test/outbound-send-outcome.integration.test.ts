// Integration: the outbound-queue-row machine (quint/outbound_queue.qnt). A send holds no lock during the provider
// call, so erasure (a leave) can end the row while Cloud has it. When Cloud then answers "unknown" or "retry", the
// queue must not write its waiting status over the recorded end. Real service, runtime, CloudChannelAdapter,
// OutboundQueue, the real leave path and PostgreSQL on the dev cluster (:54339); Cloud is a local signed server.
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

const db=`network_send_outcome_${randomUUID().replaceAll("-","")}`;
const admin=new SQL({url:`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/postgres`,max:1});
const url=`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/${db}`;
// 12:00 in New York: outside quiet hours.
const clock=new SimClock(Date.UTC(2026,9,9,16)),secret="synthetic-send-outcome-signing-secret-20261108",LINE="+12125550210";
const ENV={PLATFORM_ENV:"dev",BLOOIO_ALLOW_SEND:"1",NTWRK_LIVE_APPROVED:"1",FRIENDS_LIVE_APPROVED:"1"};
let sql:SQL,cloud:ReturnType<typeof Bun.serve>,service:NetworkService;
/** While Cloud has the text: the person leaves (the real forget path), then Cloud answers with `answer`. */
const during:{id?:string,phone?:string,answer?:"unknown"|"retry"}={};
const leaves:Promise<void>[]=[];

const statusOf=async(id:string)=>(await sql`select status from platform.outbound where id=${id}`)[0]?.status as string|undefined;
const waitFor=async(id:string,status:string)=>{for (let i=0;i<200;i++){if (await statusOf(id)===status) return;await Bun.sleep(25);}throw new Error(`${id} never reached ${status}`);};

beforeAll(async()=>{
  await admin.unsafe(`create database ${db}`);await applySchema(url,{lockTimeout:"5s"});sql=new SQL({url,max:2});
  cloud=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async req=>{
    const path=new URL(req.url).pathname,raw=await req.text();
    const auth=await svcVerify(secret,{method:req.method,path,headers:req.headers,body:raw,nowS:Math.floor(clock.now()/1000)});
    if (!auth.ok) return Response.json({ok:false,error:"invalid"},{status:401});
    const payload=JSON.parse(raw);
    if (path===DELIVER_PATH && payload.id===during.id) {
      // The leave commits its erasure; its own delivery then waits for this drain's line lock.
      leaves.push(service.accounts.leave(APPS.friends,{e164:during.phone!,personId:null}));
      await waitFor(payload.id,"dropped_forgotten");
      return during.answer==="unknown"?Response.json({ok:false,error:"unknown",retryable:true},{status:504})
        :Response.json({ok:false,error:"rejected",retryable:true},{status:503});
    }
    return Response.json({ok:true,replayed:false,providerMessageIds:[`provider:${payload.id}`],history:true});
  }});
  service=new NetworkService({url,clock,instance:"replica-a",photoStorage:null,tokens:"safety:saf-tok",env:{PLATFORM_ENV:"dev",CLEF_RATINGS:"off",SERVICE_TURN_SECRET:secret},
    networks:[{id:"friends:nyc",matchingEnabled:false}],network:{seed:1},log:()=>{},
    adapter:(_net,rt)=>new CloudChannelAdapter({clock,app:rt.app.id,city:rt.city,from:LINE,origin:cloud.url.origin,secret,env:ENV})});
  await service.start();
},120_000);
afterAll(async()=>{await Promise.allSettled(leaves);await service?.close().catch(()=>{});cloud?.stop(true);await sql?.close();
  await admin.unsafe(`drop database if exists ${db} with (force)`).catch(()=>{});await admin.close();});

for (const answer of ["unknown","retry"] as const) test(`erasure during the provider call stays recorded when Cloud answers ${answer}`,async()=>{
  const rt:NetworkRuntime=service.runtimes.get("friends:nyc")!;
  const phone=answer==="unknown"?"+12125550211":"+12125550212",id=`outcome-${answer}`;
  const joined=await service.accounts.join(APPS.friends,{e164:phone,personId:null},{firstName:"Ada",age:30,consent:{sms:true,wording:APPS.friends.consent.text}});
  if (!joined.ok) throw new Error("Fixture join refused");
  await rt.unitOfWork(()=>undefined);
  await (rt.adapter as CloudChannelAdapter).queue.enqueue(sql,[{id,memberId:joined.membership.memberId,to:phone,kind:"transactional",text:"Your plan reminder is ready.",city:"nyc"}]);
  Object.assign(during,{id,phone,answer});
  await rt.deliver();
  await Promise.all(leaves);
  const [row]=await sql`select status, body, to_address from platform.outbound where id=${id}`;
  expect(row).toEqual({status:"dropped_forgotten",body:null,to_address:null});
},60_000);
