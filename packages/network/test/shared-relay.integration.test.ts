// Actual signed service, canonical state, relay engine and durable outbox. Classifier/Cloud HTTP are controlled boundaries.
import {afterAll,beforeAll,expect,test} from "bun:test";
import {randomUUID} from "node:crypto";
import {SQL} from "bun";
import {DAY,HOUR,MINUTE,SimClock} from "@thenetwork/core";
import {applySchema} from "../../observatory/db/dev-pg.ts";
import {TURN_PATH,RELAY_PATH,DELIVER_PATH,type TurnRequest} from "../../core/src/svc/contract.ts";
import {svcSign,svcVerify} from "../../core/src/svc/svc-auth.ts";
import {CloudChannelAdapter} from "../service/cloud-channel.ts";
import {NetworkService} from "../service/service.ts";
import type {NetworkState} from "../src/network.ts";
const db=`network_relay_${randomUUID().replaceAll("-","")}`,url=`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/${db}`;
const admin=new SQL({url:`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/postgres`,max:1});
const secret="synthetic-current-relay-signing-secret-20261009",clock=new SimClock(Date.UTC(2026,9,9,16));
const a="+12125550211",b="+12125550212";
let sql:SQL,service:NetworkService,server:ReturnType<typeof Bun.serve>,cloud:ReturnType<typeof Bun.serve>,fromId:string,toId:string;
let classifier=true,classifications=0,known=true,posts=0,polls=0,ancillaryPosts=0;
let classifyGate:Promise<void>|undefined,classifyEntered:(()=>void)|undefined;
const sent:Array<{id:string;text:string;kind:string;to:string}>=[];
const start=async()=>{
  service=new NetworkService({url,clock,photoStorage:null,env:{PLATFORM_ENV:"dev",CLEF_RATINGS:"off",SERVICE_TURN_SECRET:secret},networks:[{id:"friends:nyc",matchingEnabled:false}],log:()=>{},
    ...(classifier?{relayClassifier:async()=>{classifications++;if(classifyGate){classifyEntered?.();await classifyGate;}return {flags:[],source:"clef" as const};}}:{}),
    adapter:(_net,rt)=>new CloudChannelAdapter({app:rt.app.id,clock,city:rt.city,from:"+12125550210",origin:cloud.url.origin,secret,env:{PLATFORM_ENV:"dev",BLOOIO_ALLOW_SEND:"1",NTWRK_LIVE_APPROVED:"1",FRIENDS_LIVE_APPROVED:"1"}})});
  await service.start();server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:req=>service.fetch(req)});
};
const post=async(path:string,body:object)=>{
  const fields=body as Record<string,unknown>,raw=JSON.stringify(body),id=path===RELAY_PATH?`${fields.messageId}:relay`:String(fields.messageId);
  return fetch(new URL(path,server.url),{method:"POST",body:raw,headers:{"content-type":"application/json",...await svcSign(secret,{method:"POST",path,id,body:raw,nowS:Math.floor(clock.now()/1000)})}});
};
const turn=(from:string,messageId:string,text:string):TurnRequest=>({channel:"blooio",from,to:null,messageId,text,receivedAt:clock.now(),transport:"imessage",app:"friends"});
const open=async(messageId:string,text:string)=>{const request=turn(a,messageId,text),r=await post(TURN_PATH,request);expect(r.status).toBe(200);const body=await r.json() as any;expect(body.outcome).toBe("open");return {channel:"blooio",messageId,app:"friends",memberId:fromId,itemId:null,text:text.trim()};};
const fixturePair=async(closed=false)=>service.runtimeFor("friends")!.unitOfWork(n=>{
  // Explicit canonical mutual-consent fixture. This case qualifies relay, not engine matching or human review.
  const state=n.exportState();state.opps=state.opps.filter(op=>op.id!=="relay-pair");
  const op:NetworkState["opps"][number]={id:"relay-pair",origin:"engine",kind:"intro",category:"social",objective:"coffee",detail:"coffee",participants:[fromId,toId],alternates:[],primed:[],status:[[fromId,"yes"],[toId,"yes"]],explanations:{},stage:closed?"closed":"scheduled",deadline:clock.now()+DAY,createdAt:clock.now(),score:.8,generator:"fixture",components:{fit:0,mutualBenefit:0,warmPath:0,novelty:0,timingFit:0,activationCost:0,interruptionCost:0,load:0,repetition:0,socialRisk:0,confidence:0},exploration:false,review:{queuedAt:clock.now(),deadline:clock.now()+DAY,decision:"approve",reviewer:"fixture"},sameDay:false,contacted:[fromId,toId],reminded:[],feedbackFrom:[],tags:[],replacements:0};
  state.opps.push(op);n.importState(state);
});
beforeAll(async()=>{
  await admin.unsafe(`create database ${db}`);console.info(`[owned-db] ${db}`);await applySchema(url,{lockTimeout:"5s"});sql=new SQL({url,max:4});
  cloud=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async req=>{
    const path=new URL(req.url).pathname,raw=await req.text(),auth=await svcVerify(secret,{method:req.method,path,headers:req.headers,body:raw,nowS:Math.floor(clock.now()/1000)});
    expect(auth.ok).toBe(true);const input=JSON.parse(raw);
    if(input.kind==="relay"){expect(input.to).toBe(b);if(path===DELIVER_PATH){posts++;sent.push(input);}else{expect(path).toBe(`${DELIVER_PATH}/receipt`);polls++;}}
    else {expect([a,b]).toContain(input.to);ancillaryPosts++;}
    return known?Response.json({ok:true,replayed:path!==DELIVER_PATH,providerMessageIds:[`owned:${input.id}`],acceptedAt:new Date(clock.now()).toISOString(),history:true}):Response.json({ok:false,error:"unknown",retryable:true},{status:202});
  }});await start();
  for(const [phone,name] of [[a,"Ari"],[b,"Sam"]]) for(const [i,text] of ["friends.help",`${name}, 29`,"I enjoy hiking and cooking","Saturday afternoons work for me","Small groups are good"].entries()){
    clock.advance(MINUTE);expect((await post(TURN_PATH,turn(phone!,`setup:${name}:${i}`,text))).status).toBe(200);
  }
  fromId=(await service.people.getMembership((await service.accounts.personFor(a))!.id,"friends"))!.memberId;
  toId=(await service.people.getMembership((await service.accounts.personFor(b))!.id,"friends"))!.memberId;
  await fixturePair();
},120_000);
afterAll(async()=>{server?.stop(true);await service?.close();cloud?.stop(true);await sql?.close();await admin.close();});

test("relay binds original text and pair, sends only rendered wording, and replays actual accepted receipts",async()=>{
  const request=await open("relay-text","  tell Sam I'm running ten minutes late  ");
  expect((await post(RELAY_PATH,{...request,text:"tell Sam something the model invented"})).status).toBe(403);
  expect((await post(RELAY_PATH,{...request,itemId:"someone-elses-item"})).status).toBe(403);
  const r=await post(RELAY_PATH,request);expect(r.status).toBe(200);const body=await r.json() as any;expect(body).toMatchObject({decision:"pass",delivered:true,replayed:false});
  expect(sent).toHaveLength(1);expect(sent[0].text).toBe('Ari says: "I\'m running ten minutes late"');
  const before=posts,calls=classifications;expect(await(await post(RELAY_PATH,request)).json()).toEqual({...body,replayed:true});expect(posts).toBe(before);expect(classifications).toBe(calls);
  const contact=await open("relay-contact","send Sam my number");const c=await post(RELAY_PATH,contact);expect(c.status).toBe(200);expect(await c.json()).toMatchObject({decision:"pass",delivered:true});
  expect(sent.at(-1)!.text).toContain(a);expect(sent.at(-1)!.kind).toBe("relay");
  expect((await post(RELAY_PATH,{...contact,allow:[b]})).status).toBe(400);
  const guardedBefore=posts;
  const unrelated=await open("relay-unrelated-contact","tell Sam text another person at +12125550999");
  expect(await(await post(RELAY_PATH,unrelated)).json()).toMatchObject({decision:"hold",delivered:false});expect(posts).toBe(guardedBefore);
  await service.runtimeFor('friends')!.scoped(tx=>tx`insert into network.facets(app_id,id,member_id,kind,value,tags,privacy_scope,provenance,status,valid_from)
    values('friends','relay-private-fixture',${toId},'fact','private diagnosis uses experimental treatment','{}','agent_private','said','confirmed',${new Date(clock.now())})`);
  const privateRequest=await open("relay-private-fact","tell Sam private diagnosis uses experimental treatment");
  expect(await(await post(RELAY_PATH,privateRequest)).json()).toMatchObject({decision:"hold",delivered:false});expect(posts).toBe(guardedBefore);
  const logs=JSON.stringify(await sql`select payload from network.events where type='relay_decision'`);expect(logs).not.toContain(a);expect(logs).not.toContain("running ten minutes late");expect(logs).not.toContain("private diagnosis uses experimental treatment");
},60_000);

test("unknown acceptance stays false until receipt-only recovery; unsupported photos and unavailable classifier stay unsent",async()=>{
  known=false;const request=await open("relay-unknown","tell Sam I'm heading over");const r=await post(RELAY_PATH,request);expect(r.status).toBe(200);expect(await r.json()).toMatchObject({decision:"pass",delivered:false});
  const before=posts;expect(await(await post(RELAY_PATH,request)).json()).toMatchObject({delivered:false,replayed:true});expect(posts).toBe(before);
  known=true;clock.advance(MINUTE);await service.runtimeFor("friends")!.unitOfWork(()=>undefined);expect(polls).toBeGreaterThan(0);
  expect(await(await post(RELAY_PATH,request)).json()).toMatchObject({delivered:true,replayed:true});expect(posts).toBe(before);
  const photo=await open("relay-photo","send Sam this photo");expect(await(await post(RELAY_PATH,photo)).json()).toMatchObject({decision:"hold",delivered:false});expect(posts).toBe(before);
  server.stop(true);await service.close();classifier=false;await start();
  const unavailable=await open("relay-unavailable","tell Sam I'll be there soon");expect(await(await post(RELAY_PATH,unavailable)).json()).toMatchObject({decision:"hold",delivered:false});expect(posts).toBe(before);
},60_000);


test("closing a pair during classification or after async dispatch checks prevents relay",async()=>{
  server.stop(true);await service.close();classifier=true;await start();clock.advance(11*MINUTE);await fixturePair();
  let release!:()=>void,entered!:()=>void;
  classifyGate=new Promise<void>(resolve=>{release=resolve;});const reached=new Promise<void>(resolve=>{entered=resolve;});classifyEntered=entered;
  const request=await open("relay-close-classifier","tell Sam I'll meet them outside");const before=posts;
  const pending=post(RELAY_PATH,request);await reached;await fixturePair(true);release();
  expect(await(await pending).json()).toMatchObject({decision:"block",delivered:false});expect(posts).toBe(before);
  classifyGate=undefined;classifyEntered=undefined;
  const rt=service.runtimeFor("friends")!;
  for(const scenario of ['close','recipient-stop'] as const) {
    clock.advance(11*MINUTE);await fixturePair();
    const next=await open(`relay-admission-${scenario}`,"tell Sam I'm by the entrance");
    const checks=((rt.adapter as CloudChannelAdapter).queue as unknown as {o:import("../../blooio/src/outbound-queue.ts").QueueOptions}).o.checks,original=checks.leaks;
    let resume!:()=>void,arrive!:()=>void;
    const gate=new Promise<void>(resolve=>{resume=resolve;}),atGate=new Promise<void>(resolve=>{arrive=resolve;});
    checks.leaks=async row=>{const result=await original!(row);if(row.kind==='relay'){arrive();await gate;}return result;};
    const sending=post(RELAY_PATH,next);
    try {
      await atGate;const closing=scenario==='close'?fixturePair(true):post(TURN_PATH,turn(b,'recipient-stop-during-relay','STOP'));
      let closed=false;for(let i=0;i<200;i++){const [row]=await sql`select state from network.network_state where id='friends:nyc'`;const op=row.state.opps.find((op:any)=>op.id==='relay-pair');if(op?.stage==='closed'||op?.status.some(([id,status]:[string,string])=>id===toId&&status!=='yes')){closed=true;break;}await Bun.sleep(5);}
      expect(closed).toBe(true);resume();const result=await sending;expect(await result.json()).toMatchObject({decision:"pass",delivered:false});await closing;expect(posts).toBe(before);
      if(scenario==='recipient-stop') {expect(await service.accounts.optedIn('friends',b)).toBe(false);clock.advance(MINUTE);expect((await post(TURN_PATH,turn(b,'recipient-start-after-relay','START'))).status).toBe(200);expect(await service.accounts.optedIn('friends',b)).toBe(true);}
    } finally {resume();checks.leaks=original;}
  }
  // A queued row deferred by existing quiet hours also rechecks its current opportunity before dispatch.
  clock.advance(10*HOUR);await fixturePair();const quiet=await open("relay-quiet-close","tell Sam I'm looking forward to it");
  expect(await(await post(RELAY_PATH,quiet)).json()).toMatchObject({decision:"pass",delivered:false});expect(posts).toBe(before);
  await fixturePair(true);clock.advance(12*HOUR);await rt.unitOfWork(()=>undefined);expect(posts).toBe(before);
},60_000);

test("STOP and canonical erasure revoke relay and action receipts; transaction faults never leave a queued effect",async()=>{
  clock.advance(11*MINUTE);await fixturePair();
  const request=await open("relay-rollback","tell Sam I'll arrive after lunch"),before=posts;
  await sql.unsafe(`create function network.fail_relay_fixture() returns trigger language plpgsql as $$ begin if new.type='relay_decision' then raise exception 'synthetic relay transaction fault'; end if; return new; end $$`);
  await sql.unsafe(`create trigger fail_relay_fixture before insert on network.events for each row execute function network.fail_relay_fixture()`);
  expect((await post(RELAY_PATH,request)).status).toBe(409);
  await sql.unsafe(`drop trigger fail_relay_fixture on network.events; drop function network.fail_relay_fixture()`);
  expect((await post(RELAY_PATH,request)).status).toBe(409);expect(posts).toBe(before);
  const [turnRow]=await sql`select action_receipts from platform.inbound where id='msg:blooio:relay-rollback'`;
  expect(Object.values(turnRow.action_receipts).map((r:any)=>r.state)).toEqual(['unresolved']);
  const failedId=`relay:${Object.keys(turnRow.action_receipts)[0]}`;
  expect((await sql`select id from platform.outbound where id=${failedId}`).length).toBe(0);
  expect((await sql`select id from network.messages where id=${failedId}`).length).toBe(0);
  const recipient=await service.accounts.personFor(b);expect(recipient).toBeDefined();
  await service.accounts.recordAge(b,recipient,15);
  const minor=await open("relay-minor-recipient","tell Sam I'll be on time");
  expect(await(await post(RELAY_PATH,minor)).json()).toMatchObject({decision:"block",delivered:false});expect(posts).toBe(before);
  const original=await open("relay-stop-revoke","tell Sam I'll be on time");
  expect((await post(TURN_PATH,turn(a,"relay-stop","STOP"))).status).toBe(200);
  expect((await post(RELAY_PATH,original)).status).toBe(403);expect(posts).toBe(before);
  const who=await service.accounts.personFor(a);expect(who).toBeDefined();
  await service.accounts.leave(service.apps.friends,{e164:a,personId:who!.id});
  expect((await post(RELAY_PATH,original)).status).toBe(403);
  const [erased]=await sql`select response,replies,action_receipts from platform.inbound where id='msg:blooio:relay-text'`;
  expect(erased).toEqual({response:null,replies:[],action_receipts:{}});
  expect((await sql`select id from network.events where type='relay_decision' and actor_id=${fromId}`).length).toBe(0);
  expect(posts).toBe(before);
},60_000);
