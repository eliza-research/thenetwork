// Cloud's RELAY wire end to end on the canonical owner: real signed HTTP (RelaySendRequest, x-ntwrk-svc-id
// "<messageId>:relay") -> POST /internal/relay -> the ConsentNetwork relay desk -> the durable outbox ->
// the Cloud deliver path. Classifier and Cloud HTTP are controlled boundaries. Needs the dev Postgres on :54339.
import {afterAll,beforeAll,expect,test} from "bun:test";
import {randomUUID} from "node:crypto";
import {SQL} from "bun";
import {DAY,HOUR,MINUTE,SimClock} from "@thenetwork/core";
import {applySchema} from "../../observatory/db/dev-pg.ts";
import {TURN_PATH,RELAY_PATH,DELIVER_PATH,type RelaySendRequest,type TurnRequest} from "../../core/src/svc/contract.ts";
import {svcSign,svcVerify} from "../../core/src/svc/svc-auth.ts";
import {CloudChannelAdapter,DELIVER_RECEIPT_PATH} from "../service/cloud-channel.ts";
import {NetworkService} from "../service/service.ts";
import type {NetworkState} from "../src/network.ts";
import type {QueueOptions} from "../../blooio/src/outbound-queue.ts";
const db=`network_relay_${randomUUID().replaceAll("-","")}`,url=`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/${db}`;
const admin=new SQL({url:`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/postgres`,max:1});
const secret="synthetic-current-relay-signing-secret-20261009",clock=new SimClock(Date.UTC(2026,9,9,16));
const a="+12125550211",b="+12125550212",c="+12125550213";
let sql:SQL,service:NetworkService,server:ReturnType<typeof Bun.serve>,cloud:ReturnType<typeof Bun.serve>,fromId:string,toId:string,thirdId:string;
let classifierFails=false,classifications=0,known=true,posts=0,polls=0,ancillaryPosts=0;
let classifyGate:Promise<void>|undefined,classifyEntered:(()=>void)|undefined;
const sent:Array<{id:string;text:string;kind:string;to:string}>=[];
const start=async()=>{
  service=new NetworkService({url,clock,photoStorage:null,env:{PLATFORM_ENV:"dev",CLEF_RATINGS:"off",SERVICE_TURN_SECRET:secret},networks:[{id:"friends:nyc",matchingEnabled:false}],log:()=>{},
    relayClassifier:async()=>{classifications++;if(classifyGate){classifyEntered?.();await classifyGate;}if(classifierFails)throw new Error("synthetic classifier outage");return {flags:[],source:"clef" as const};},
    adapter:(_net,rt)=>new CloudChannelAdapter({app:rt.app.id,clock,city:rt.city,from:"+12125550210",origin:cloud.url.origin,secret,env:{PLATFORM_ENV:"dev",BLOOIO_ALLOW_SEND:"1",NTWRK_LIVE_APPROVED:"1",FRIENDS_LIVE_APPROVED:"1"}})});
  await service.start();server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:req=>service.fetch(req)});
};
const restart=async()=>{server.stop(true);await service.close();await start();};
// Cloud's client signs every relay with id "<messageId>:relay" (plugin-network client.ts at b763).
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
const fixturePair=async(closed=false)=>service.runtimeFor("friends")!.unitOfWork(n=>{
  // Explicit canonical mutual-consent fixture. This case qualifies relay, not engine matching or human review.
  const state=n.exportState();state.opps=state.opps.filter(op=>op.id!=="relay-pair");
  const op:NetworkState["opps"][number]={id:"relay-pair",origin:"engine",kind:"intro",category:"social",objective:"coffee",detail:"coffee",participants:[fromId,toId],alternates:[],primed:[],status:[[fromId,"yes"],[toId,"yes"]],explanations:{},stage:closed?"closed":"scheduled",...(closed?{closedFrom:"scheduled"}:{}),deadline:clock.now()+DAY,createdAt:clock.now(),score:.8,generator:"fixture",components:{fit:0,mutualBenefit:0,warmPath:0,novelty:0,timingFit:0,activationCost:0,interruptionCost:0,load:0,repetition:0,socialRisk:0,confidence:0},exploration:false,review:{queuedAt:clock.now(),deadline:clock.now()+DAY,decision:"approve",reviewer:"fixture"},sameDay:false,contacted:[fromId,toId],reminded:[],feedbackFrom:[],tags:[],replacements:0} as NetworkState["opps"][number];
  state.opps.push(op);n.importState(state);
});
/** The pair as the stored state holds it now (a close commits before its own delivery, which waits for the held dispatch). */
const pairClosed=async()=>{const [row]=await sql`select state from network.network_state where id='friends:nyc'`;const st=typeof row.state==='string'?JSON.parse(row.state):row.state;return st.opps.find((op:any)=>op.id==='relay-pair')?.stage==='closed';};
const waitFor=async(cond:()=>Promise<boolean>)=>{for(let i=0;i<400;i++){if(await cond())return true;await Bun.sleep(5);}return false;};
/** Hold the dispatch of the next relayed row right after its asynchronous gates (the leak check), before admission. */
const gateDispatch=()=>{
  const rt=service.runtimeFor("friends")!,checks=((rt.adapter as CloudChannelAdapter).queue as unknown as {o:QueueOptions}).o.checks,original=checks.leaks!;
  let resume!:()=>void,arrive!:()=>void;
  const gate=new Promise<void>(resolve=>{resume=resolve;}),atGate=new Promise<void>(resolve=>{arrive=resolve;});
  checks.leaks=async row=>{const result=await original(row);if(row.id.startsWith("relay:")){arrive();await gate;}return result;};
  return {atGate,resume:()=>{resume();checks.leaks=original;}};
};
beforeAll(async()=>{
  await admin.unsafe(`create database ${db}`);await applySchema(url,{lockTimeout:"5s"});sql=new SQL({url,max:4});
  cloud=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async req=>{
    const path=new URL(req.url).pathname,raw=await req.text(),auth=await svcVerify(secret,{method:req.method,path,headers:req.headers,body:raw,nowS:Math.floor(clock.now()/1000)});
    expect(auth.ok).toBe(true);const input=JSON.parse(raw);expect([a,b,c]).toContain(input.to);
    if(input.kind==="relay"){if(path===DELIVER_PATH){posts++;sent.push(input);}else{expect(path).toBe(DELIVER_RECEIPT_PATH);polls++;}}
    else ancillaryPosts++;
    return known?Response.json({ok:true,replayed:path!==DELIVER_PATH,providerMessageIds:[`owned:${input.id}`],acceptedAt:new Date(clock.now()).toISOString(),history:true}):Response.json({ok:false,error:"unknown",retryable:true},{status:202});
  }});await start();
  for(const [phone,name] of [[a,"Ari"],[b,"Sam"],[c,"Cy"]]) for(const [i,text] of ["friends.help",`${name}, 29`,"I enjoy hiking and cooking","Saturday afternoons work for me","Small groups are good"].entries()){
    clock.advance(MINUTE);expect((await post(TURN_PATH,turn(phone!,`setup:${name}:${i}`,text))).status).toBe(200);
  }
  fromId=(await service.people.getMembership((await service.accounts.personFor(a))!.id,"friends"))!.memberId;
  toId=(await service.people.getMembership((await service.accounts.personFor(b))!.id,"friends"))!.memberId;
  thirdId=(await service.people.getMembership((await service.accounts.personFor(c))!.id,"friends"))!.memberId;
  await fixturePair();
},120_000);
afterAll(async()=>{server?.stop(true);await service?.close();cloud?.stop(true);await sql?.close();await admin.unsafe(`drop database if exists ${db} with (force)`);await admin.close();});

test("relay binds the original text and pair, sends only rendered wording, swaps numbers only after both ask, and replays accepted receipts",async()=>{
  const request=await open("relay-text","  tell Sam I'm running ten minutes late  ");
  expect((await post(RELAY_PATH,{...request,text:"tell Sam something the model invented"})).status).toBe(403);
  expect((await post(RELAY_PATH,{...request,itemId:"someone-elses-item"})).status).toBe(403);
  const r=await post(RELAY_PATH,request);expect(r.status).toBe(200);const body=await r.json() as any;expect(body).toEqual({decision:"pass",senderNotice:"Sent.",delivered:true,replayed:false});
  expect(sent).toHaveLength(1);expect(sent[0]!.text).toBe('Ari says: "I\'m running ten minutes late"');expect(sent[0]!.to).toBe(b);
  const before=posts,calls=classifications;expect(await(await post(RELAY_PATH,request)).json()).toEqual({...body,replayed:true});expect(posts).toBe(before);expect(classifications).toBe(calls);
  // A number goes only after both members asked; each share is the sender's own verified number.
  const mine=await open("relay-contact","send Sam my number");expect(await(await post(RELAY_PATH,mine)).json()).toMatchObject({decision:"hold",delivered:false});
  expect(sent.some(x=>x.text.includes(a))).toBe(false);
  // Sam is asked once (the swap question passes the same final dispatch checks).
  expect(sent.filter(x=>x.to===b&&/would like to swap numbers/.test(x.text))).toHaveLength(1);
  expect((await post(RELAY_PATH,{...mine,allow:[b]})).status).toBe(400);
  const theirs=await open("relay-contact-back","send Ari my number",b);expect(await(await post(RELAY_PATH,theirs)).json()).toMatchObject({decision:"pass",delivered:true});
  expect(sent.find(x=>x.to===b&&x.text.includes(a))?.kind).toBe("relay");expect(sent.find(x=>x.to===a&&x.text.includes(b))?.kind).toBe("relay");
  const guardedBefore=posts;
  const unrelated=await open("relay-unrelated-contact","tell Sam text another person at +12125550999");
  expect(await(await post(RELAY_PATH,unrelated)).json()).toMatchObject({decision:"hold",delivered:false});expect(posts).toBe(guardedBefore);
  // A third member's private fact is never relayed.
  await service.runtimeFor('friends')!.scoped(tx=>tx`insert into network.facets(app_id,id,member_id,kind,value,tags,privacy_scope,provenance,status,valid_from)
    values('friends','relay-private-fixture',${thirdId},'fact','private diagnosis uses experimental treatment','{}','agent_private','said','confirmed',${new Date(clock.now())})`);
  const privateRequest=await open("relay-private-fact","tell Sam private diagnosis uses experimental treatment");
  expect((await(await post(RELAY_PATH,privateRequest)).json() as any).decision).not.toBe("pass");expect(posts).toBe(guardedBefore);
  const logs=JSON.stringify(await sql`select * from network.relay_records`);expect(logs).not.toContain(a.slice(2));expect(logs).not.toContain("running ten minutes late");
},60_000);

test("unknown acceptance stays false until receipt-only recovery; photos and a classifier outage stay unsent",async()=>{
  known=false;const request=await open("relay-unknown","tell Sam I'm heading over");const r=await post(RELAY_PATH,request);expect(r.status).toBe(200);
  const first=await r.json() as any;expect(first).toMatchObject({decision:"pass",delivered:false});expect(first.senderNotice).not.toBe("Sent.");
  const before=posts;expect(await(await post(RELAY_PATH,request)).json()).toMatchObject({delivered:false,replayed:true});expect(posts).toBe(before);
  known=true;clock.advance(MINUTE);await service.runtimeFor("friends")!.unitOfWork(()=>undefined);expect(polls).toBeGreaterThan(0);
  expect(await(await post(RELAY_PATH,request)).json()).toMatchObject({decision:"pass",delivered:true,replayed:true});expect(posts).toBe(before);
  // A restart never resends it either.
  await restart();expect(await(await post(RELAY_PATH,request)).json()).toMatchObject({delivered:true,replayed:true});expect(posts).toBe(before);
  const photo=await open("relay-photo","send Sam this photo");expect(await(await post(RELAY_PATH,photo)).json()).toMatchObject({decision:"block",delivered:false});expect(posts).toBe(before);
  classifierFails=true;
  try {
    const unavailable=await open("relay-unavailable","tell Sam I'll be there soon");expect(await(await post(RELAY_PATH,unavailable)).json()).toMatchObject({decision:"hold",delivered:false});expect(posts).toBe(before);
  } finally {classifierFails=false;}
},60_000);

test("closing the pair or a recipient STOP after classification and the async dispatch checks prevents relay",async()=>{
  const rt=service.runtimeFor("friends")!;
  // Classification runs inside the unit: a close waits for it, and the dispatch admission then reads the close.
  clock.advance(11*MINUTE);await fixturePair();
  {
    let release!:()=>void,entered!:()=>void;
    classifyGate=new Promise<void>(resolve=>{release=resolve;});const reached=new Promise<void>(resolve=>{entered=resolve;});classifyEntered=entered;
    const dispatch=gateDispatch();
    try {
      const request=await open("relay-close-classifier","tell Sam I'll meet them outside");const before=posts;
      const pending=post(RELAY_PATH,request);await Promise.race([reached,pending.then(async r=>{throw new Error(`answered before classification: ${await r.clone().text()}`);})]);
      let closedEarly=false;const closing=fixturePair(true).then(()=>{closedEarly=true;});
      await Bun.sleep(50);expect(closedEarly).toBe(false);
      release();await dispatch.atGate;expect(await waitFor(pairClosed)).toBe(true);dispatch.resume();
      expect(await(await pending).json()).toMatchObject({decision:"pass",delivered:false});await closing;expect(posts).toBe(before);
    } finally {classifyGate=undefined;classifyEntered=undefined;release?.();dispatch.resume();}
  }
  for(const scenario of ['close','recipient-stop'] as const) {
    clock.advance(11*MINUTE);await fixturePair();
    // Sam answers in between (the send path's unanswered streak is the desk's own limit, not this case's).
    clock.advance(MINUTE);expect((await post(TURN_PATH,turn(b,`sam-reply-${scenario}`,"Sounds good, thanks"))).status).toBe(200);
    const next=await open(`relay-admission-${scenario}`,"tell Sam I'm by the entrance"),before=posts;
    const dispatch=gateDispatch();
    try {
      const sending=post(RELAY_PATH,next);
      // The relay must reach dispatch; an answer first means it never queued (fail rather than wait).
      const first=await Promise.race([dispatch.atGate.then(()=>"gate"),sending.then(async r=>JSON.stringify(await r.clone().json()))]);
      expect(first).toBe("gate");
      const closing=scenario==='close'?fixturePair(true):post(TURN_PATH,turn(b,'recipient-stop-during-relay','STOP'));
      expect(await waitFor(scenario==='close'?pairClosed:async()=>!(await service.accounts.optedIn('friends',b)))).toBe(true);
      dispatch.resume();expect(await(await sending).json()).toMatchObject({decision:"pass",delivered:false});await closing;expect(posts).toBe(before);
      const [row]=await sql`select status from platform.outbound where id like 'relay:%' order by created_at desc limit 1`;expect(row.status).not.toMatch(/accepted|sent|delivered|read/);
      if(scenario==='recipient-stop') {expect(await service.accounts.optedIn('friends',b)).toBe(false);clock.advance(MINUTE);expect((await post(TURN_PATH,turn(b,'recipient-start-after-relay','START'))).status).toBe(200);expect(await service.accounts.optedIn('friends',b)).toBe(true);}
    } finally {dispatch.resume();}
  }
  // A queued row deferred by quiet hours also rechecks its current match before dispatch.
  const before=posts;
  clock.advance(10*HOUR);await fixturePair();const quiet=await open("relay-quiet-close","tell Sam I'm looking forward to it");
  expect(await(await post(RELAY_PATH,quiet)).json()).toMatchObject({decision:"pass",delivered:false});expect(posts).toBe(before);
  await fixturePair(true);clock.advance(12*HOUR);await rt.unitOfWork(()=>undefined);expect(posts).toBe(before);
},60_000);

test("STOP and canonical erasure revoke relay and action receipts; transaction faults never leave a queued effect",async()=>{
  clock.advance(11*MINUTE);await fixturePair();
  const request=await open("relay-rollback","tell Sam I'll arrive after lunch"),before=posts;
  // A fault in the unit's save (the relay log) rolls back the receipt, the messages and the queued rows together.
  await sql.unsafe(`create function network.fail_relay_fixture() returns trigger language plpgsql as $$ begin raise exception 'synthetic relay transaction fault'; end $$`);
  await sql.unsafe(`create trigger fail_relay_fixture before insert or update on network.relay_records for each row execute function network.fail_relay_fixture()`);
  try { expect((await post(RELAY_PATH,request)).status).toBe(409); }
  finally { await sql.unsafe(`drop trigger fail_relay_fixture on network.relay_records; drop function network.fail_relay_fixture()`); }
  expect((await post(RELAY_PATH,request)).status).toBe(409);expect(posts).toBe(before);
  const [turnRow]=await sql`select action_receipts from platform.inbound where id='msg:blooio:relay-rollback'`;
  expect(Object.values(turnRow.action_receipts).map((r:any)=>r.state)).toEqual(['unresolved']);
  const failedId=`relay:r_${Object.keys(turnRow.action_receipts)[0]!.slice(0,32)}`;
  expect((await sql`select id from platform.outbound where id=${failedId}`).length).toBe(0);
  expect((await sql`select id from network.messages where id=${failedId}`).length).toBe(0);
  expect((await sql`select item_id from network.relay_records where item_id=${failedId.slice(6)}`).length).toBe(0);
  // A minor recipient (the canonical lowest age) is never relayed to.
  const recipient=await service.accounts.personFor(b);expect(recipient).toBeDefined();
  await service.accounts.recordAge(b,recipient,15);
  const minor=await open("relay-minor-recipient","tell Sam I'll be on time");
  expect(await(await post(RELAY_PATH,minor)).json()).toMatchObject({decision:"block",delivered:false});expect(posts).toBe(before);
  // The sender's STOP revokes the open turn's authority to relay.
  const original=await open("relay-stop-revoke","tell Sam I'll be on time");
  expect((await post(TURN_PATH,turn(a,"relay-stop","STOP"))).status).toBe(200);
  expect((await post(RELAY_PATH,original)).status).toBe(403);expect(posts).toBe(before);
  // Canonical erasure seals the sender's signed turns and their action receipts; nothing can be replayed or sent.
  const who=await service.accounts.personFor(a);expect(who).toBeDefined();
  await service.accounts.leave(service.apps.friends,{e164:a,personId:who!.id});
  expect((await post(RELAY_PATH,original)).status).toBe(403);
  const [erased]=await sql`select response,replies,action_receipts from platform.inbound where id='msg:blooio:relay-text'`;
  expect(erased).toEqual({response:null,replies:[],action_receipts:{}});
  expect((await sql`select id from network.messages where member_id=${fromId}`).length).toBe(0);
  const [saved]=await sql`select state from network.network_state where id='friends:nyc'`;
  const state=typeof saved.state==="string"?JSON.parse(saved.state):saved.state;
  expect(JSON.stringify(state.relay.threads)).not.toContain("running ten minutes late");
  expect(JSON.stringify(state.relay.held)).not.toContain("text another person");
  expect(posts).toBe(before);
},60_000);
