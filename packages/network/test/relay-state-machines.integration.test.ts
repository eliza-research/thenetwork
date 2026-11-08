// The relay state machines (docs/research/quint-findings/relay.md) on the canonical owner: real signed HTTP
// (TurnRequest, RelaySendRequest) -> POST /internal/turn and /internal/relay -> the ConsentNetwork relay desk ->
// the durable outbox and its final dispatch admission -> the Cloud deliver path. The classifier and Cloud HTTP
// are controlled boundaries; no model and no provider is called. Needs the dev Postgres on :54339.
import {afterAll,beforeAll,expect,test} from "bun:test";
import {randomUUID} from "node:crypto";
import {SQL} from "bun";
import {DAY,HOUR,MINUTE,SimClock} from "@thenetwork/core";
import {applySchema} from "../../observatory/db/dev-pg.ts";
import {TURN_PATH,RELAY_PATH,DELIVER_PATH,type RelaySendRequest,type TurnRequest} from "../../core/src/svc/contract.ts";
import {svcSign,svcVerify} from "../../core/src/svc/svc-auth.ts";
import {CloudChannelAdapter} from "../service/cloud-channel.ts";
import {NetworkService} from "../service/service.ts";
import type {NetworkState} from "../src/network.ts";

const db=`network_relay_sm_${randomUUID().replaceAll("-","")}`,url=`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/${db}`;
const admin=new SQL({url:`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/postgres`,max:1});
const secret="synthetic-relay-state-machine-secret-20261108",clock=new SimClock(Date.UTC(2026,9,9,16));
const a="+12125550311",b="+12125550312";
let sql:SQL,service:NetworkService,server:ReturnType<typeof Bun.serve>,cloud:ReturnType<typeof Bun.serve>,ariId:string,samId:string;
const sent:Array<{id:string;text:string;kind:string;to:string}>=[];
const start=async()=>{
  service=new NetworkService({url,clock,photoStorage:null,env:{PLATFORM_ENV:"dev",CLEF_RATINGS:"off",SERVICE_TURN_SECRET:secret},
    networks:[{id:"friends:nyc",matchingEnabled:false}],log:()=>{},
    relayClassifier:async()=>({flags:[],source:"clef" as const}),
    adapter:(_net,rt)=>new CloudChannelAdapter({app:rt.app.id,clock,city:rt.city,from:"+12125550310",origin:cloud.url.origin,secret,
      env:{PLATFORM_ENV:"dev",BLOOIO_ALLOW_SEND:"1",NTWRK_LIVE_APPROVED:"1",FRIENDS_LIVE_APPROVED:"1"}})});
  await service.start();server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:req=>service.fetch(req)});
};
const post=async(path:string,body:object)=>{
  const fields=body as Record<string,unknown>,raw=JSON.stringify(body),id=path===RELAY_PATH?`${fields.messageId}:relay`:String(fields.messageId);
  return fetch(new URL(path,server.url),{method:"POST",body:raw,headers:{"content-type":"application/json",...await svcSign(secret,{method:"POST",path,id,body:raw,nowS:Math.floor(clock.now()/1000)})}});
};
const turn=(from:string,messageId:string,text:string):TurnRequest=>({channel:"blooio",from,to:null,messageId,text,receivedAt:clock.now(),transport:"imessage",app:"friends"});
/** One open turn whose own message is the relay request (Cloud sends that message, trimmed). */
const open=async(messageId:string,text:string,phone=a):Promise<RelaySendRequest>=>{
  clock.advance(MINUTE);const r=await post(TURN_PATH,turn(phone,messageId,text));expect(r.status).toBe(200);const body=await r.json() as any;expect(body.outcome).toBe("open");
  return {channel:"blooio",messageId,app:"friends",memberId:body.memberId,itemId:null,text:text.trim()};
};
const relay=async(messageId:string,text:string,phone=a)=>{const r=await post(RELAY_PATH,await open(messageId,text,phone));return {status:r.status,body:await r.json() as any};};
/** An explicit canonical mutual-consent fixture: these cases qualify the relay, not matching or human review. */
const fixturePair=async(id:string)=>service.runtimeFor("friends")!.unitOfWork(n=>{
  const pair=[ariId,samId],state=n.exportState();state.opps=state.opps.filter(op=>op.stage==="closed");
  for(const op of n.exportState().opps)if(op.stage!=="closed")state.opps.push({...op,stage:"closed",closedFrom:op.stage} as NetworkState["opps"][number]);
  state.opps.push({id,origin:"engine",kind:"intro",category:"social",objective:"coffee",detail:"coffee",participants:pair,alternates:[],primed:[],status:pair.map(p=>[p,"yes"]),explanations:{},stage:"scheduled",deadline:clock.now()+DAY,createdAt:clock.now(),score:.8,generator:"fixture",components:{fit:0,mutualBenefit:0,warmPath:0,novelty:0,timingFit:0,activationCost:0,interruptionCost:0,load:0,repetition:0,socialRisk:0,confidence:0},exploration:false,review:{queuedAt:clock.now(),deadline:clock.now()+DAY,decision:"approve",reviewer:"fixture"},sameDay:false,contacted:pair,reminded:[],feedbackFrom:[],tags:[],replacements:0} as NetworkState["opps"][number]);
  n.importState(state);
});
/** Advance the clock to the next New York hour `h` (the members' quiet hours are evening and night there). */
const toNyHour=(h:number)=>{for(let i=0;i<48;i++){const hour=Number(new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hour:"numeric",hourCycle:"h23"}).format(clock.now()));if(hour===h)return;clock.advance(HOUR);}};

beforeAll(async()=>{
  await admin.unsafe(`create database ${db}`);await applySchema(url,{lockTimeout:"5s"});sql=new SQL({url,max:4});
  cloud=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async req=>{
    const path=new URL(req.url).pathname,raw=await req.text(),auth=await svcVerify(secret,{method:req.method,path,headers:req.headers,body:raw,nowS:Math.floor(clock.now()/1000)});
    expect(auth.ok).toBe(true);const input=JSON.parse(raw);
    if(path===DELIVER_PATH)sent.push(input);
    return Response.json({ok:true,replayed:path!==DELIVER_PATH,providerMessageIds:[`owned:${input.id}`],acceptedAt:new Date(clock.now()).toISOString(),history:true});
  }});await start();
  for(const [phone,name] of [[a,"Ari"],[b,"Sam"]]) for(const [i,text] of ["friends.help",`${name}, 29`,"I enjoy hiking and cooking","Saturday afternoons work for me","Small groups are good"].entries()){
    clock.advance(MINUTE);expect((await post(TURN_PATH,turn(phone!,`setup:${name}:${i}`,text))).status).toBe(200);
  }
  ariId=(await service.people.getMembership((await service.accounts.personFor(a))!.id,"friends"))!.memberId;
  samId=(await service.people.getMembership((await service.accounts.personFor(b))!.id,"friends"))!.memberId;
},120_000);
afterAll(async()=>{server?.stop(true);await service?.close();cloud?.stop(true);await sql?.close();await admin.unsafe(`drop database if exists ${db} with (force)`);await admin.close();});

test("relay-swap: a withdrawal stops a number share that waits for quiet hours to end (SD-039)",async()=>{
  await fixturePair("swap-withdraw");toNyHour(22);
  expect((await relay("withdraw-ask-ari","send Sam my number")).body).toMatchObject({decision:"hold"});
  expect((await relay("withdraw-ask-sam","send Ari my number",b)).body).toMatchObject({decision:"pass",delivered:false});
  // Both shares passed and wait in Network.deferred for the morning. Ari takes the number back.
  expect((await relay("withdraw-ari","actually don't send my number")).body).toMatchObject({decision:"none"});
  toNyHour(10);await service.runtimeFor("friends")!.tick();await service.runtimeFor("friends")!.deliver();
  expect(sent.filter(x=>x.text.includes(a))).toEqual([]);
  // The share reached final dispatch and was refused there, not merely left waiting.
  const [share]=await sql`select o.status from platform.outbound o join network.relay_records r on o.id='relay:'||r.item_id
    where r.kind='contact_share' and r.from_member=${ariId}`;
  expect(share?.status).toMatch(/^suppressed/);
},60_000);
