// Cloud's RELAY wire end to end on the canonical owner: real signed HTTP (RelaySendRequest, x-ntwrk-svc-id
// "<messageId>:relay") -> POST /internal/relay -> the ConsentNetwork relay desk -> the durable outbox ->
// the Cloud deliver path. Classifier and Cloud HTTP are controlled boundaries. Needs the dev Postgres on :54339.
import { serveHttp, type HttpServer } from "../../core/src/runtime/http.ts";
import { setTimeout as sleep } from "node:timers/promises";
import {afterAll,beforeAll,expect,test} from "vitest";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {SQL} from "../../core/src/runtime/postgres.ts";
import {DAY,HOUR,MINUTE,SimClock} from "@thenetwork/core";
import {applySchema} from "../../observatory/db/dev-pg.ts";
import {TURN_PATH,RELAY_PATH,DELIVER_PATH,type RelaySendRequest,type TurnRequest} from "../../core/src/svc/contract.ts";
import {svcSign,svcVerify} from "../../core/src/svc/svc-auth.ts";
import {CloudChannelAdapter,DELIVER_RECEIPT_PATH} from "../service/cloud-channel.ts";
import {NetworkService} from "../service/service.ts";
import {loadSnapshot} from "../service/snapshot.ts";
import {PgAudit} from "../../observatory/src/staff.ts";
import type {AuditEntry} from "../../observatory/src/types.ts";
import {meetingFeedbackKey,relayDispatchCheck,type NetworkState} from "../src/network.ts";
import type {QueueOptions} from "../../blooio/src/outbound-queue.ts";
const db=`network_relay_${randomUUID().replaceAll("-","")}`,url=`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/${db}`;
const admin=new SQL({url:`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/postgres`,max:1});
const secret="synthetic-current-relay-signing-secret-20261009",clock=new SimClock(Date.UTC(2026,9,9,16));
const a="+12125550211",b="+12125550212",c="+12125550213";
let sql:SQL,service:NetworkService,server:HttpServer,cloud:HttpServer,fromId:string,toId:string,thirdId:string;
let classifierFails=false,classifierBlocks=false,classifierMinor=false,classifications=0,known=true,posts=0,polls=0,ancillaryPosts=0;
let classifyGate:Promise<void>|undefined,classifyEntered:(()=>void)|undefined;
const sent:Array<{id:string;text:string;kind:string;to:string}>=[];
const staffToken="synthetic-relay-safety-token-20261016",friendsStaffToken="synthetic-friends-safety-token-20261119";
const start=async()=>{
  const audit=new PgAudit(url);
  service=new NetworkService({url,clock,audit:{kind:audit.kind,list:q=>audit.list(q),close:()=>audit.close(),write:(entry:AuditEntry)=>audit.write(entry)},
    tokens:`safety@slop:${staffToken},safety@friends:${friendsStaffToken}`,env:{PLATFORM_ENV:"dev",SERVICE_TURN_SECRET:secret},networks:[{id:"friends:nyc",matchingEnabled:false},{id:"slop:nyc",matchingEnabled:false}],log:()=>{},
    relayClassifier:async()=>{classifications++;if(classifyGate){classifyEntered?.();await classifyGate;}if(classifierFails)throw new Error("synthetic classifier outage");return {flags:classifierMinor?["minor_signal"]:[],...(classifierBlocks?{block:["threat"]}:{}),source:"clef" as const};},
    adapter:(_net,rt)=>new CloudChannelAdapter({app:rt.app.id,clock,city:rt.city,from:"+12125550210",origin:cloud.url.origin,secret,env:{PLATFORM_ENV:"dev"}})});
  await service.start();server=await serveHttp({hostname:"127.0.0.1",port:0,fetch:req=>service.fetch(req)});
};
const restart=async()=>{await server.stop(true);await service.close();await start();};
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
const fixturePair=async(closed=false,app:"friends"|"slop"="friends",pair=[fromId,toId],pairId="relay-pair")=>service.runtimeFor(app)!.unitOfWork(n=>{
  // Explicit canonical mutual-consent fixture. This case qualifies relay, not engine matching or human review.
  const state=n.exportState();state.opps=state.opps.filter(op=>op.id!==pairId);
  const op:NetworkState["opps"][number]={id:pairId,origin:"engine",kind:"intro",category:"social",objective:"coffee",detail:"coffee",participants:pair,alternates:[],primed:[],status:pair.map(id=>[id,"yes"]),explanations:{},stage:closed?"closed":"scheduled",...(closed?{closedFrom:"scheduled"}:{}),deadline:clock.now()+DAY,createdAt:clock.now(),score:.8,generator:"fixture",components:{fit:0,mutualBenefit:0,warmPath:0,novelty:0,timingFit:0,activationCost:0,interruptionCost:0,load:0,repetition:0,socialRisk:0,confidence:0},exploration:false,review:{queuedAt:clock.now(),deadline:clock.now()+DAY,decision:"approve",approver:"staff",reviewer:"fixture"},sameDay:false,contacted:pair,reminded:[],feedbackFrom:[],tags:[],replacements:0} as NetworkState["opps"][number];
  state.opps.push(op);n.importState(state);
});
/** The pair as the stored state holds it now (a close commits before its own delivery, which waits for the held dispatch). */
const pairClosed=async(matchId="relay-pair")=>{const [row]=await sql`select state from network.network_state where id='friends:nyc'`;const st=typeof row.state==='string'?JSON.parse(row.state):row.state;return st.opps.find((op:any)=>op.id===matchId)?.stage==='closed';};
const waitFor=async(cond:()=>Promise<boolean>)=>{for(let i=0;i<400;i++){if(await cond())return true;await sleep(5);}return false;};
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
  cloud=await serveHttp({hostname:"127.0.0.1",port:0,fetch:async req=>{
    const path=new URL(req.url).pathname,raw=await req.text(),auth=await svcVerify(secret,{method:req.method,path,headers:req.headers,body:raw,nowS:Math.floor(clock.now()/1000)});
    expect(auth.ok).toBe(true);const input=JSON.parse(raw);expect([a,b,c,"+12125550214","+12125550215","+12125550216","+12125550217","+12125550218","+12125550219","+12125550220","+12125550221","+12125550222"]).toContain(input.to);
    if(input.kind==="relay"){if(path===DELIVER_PATH){
      posts++;sent.push(input);
    }else{expect(path).toBe(DELIVER_RECEIPT_PATH);polls++;}}
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
afterAll(async()=>{await server?.stop(true);await service?.close();await cloud?.stop(true);await sql?.close();await admin.unsafe(`drop database if exists ${db} with (force)`);await admin.close();});

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
  expect(await(await post(RELAY_PATH,unrelated)).json()).toEqual({decision:"block",senderNotice:"I didn't send that. I don't pass on contact details, handles, addresses or other apps inside a message.",delivered:false,replayed:false});expect(posts).toBe(guardedBefore);
  // A third member's private fact is never relayed.
  await service.runtimeFor('friends')!.scoped(tx=>tx`insert into network.facets(app_id,id,member_id,kind,value,tags,privacy_scope,provenance,status,valid_from)
    values('friends','relay-private-fixture',${thirdId},'fact','private diagnosis uses experimental treatment','{}','agent_private','said','confirmed',${new Date(clock.now())})`);
  const privateRequest=await open("relay-private-fact","tell Sam private diagnosis uses experimental treatment");
  expect((await(await post(RELAY_PATH,privateRequest)).json() as any).decision).not.toBe("pass");expect(posts).toBe(guardedBefore);
  const logs=JSON.stringify(await sql`select * from network.relay_records`);expect(logs).not.toContain(a.slice(2));expect(logs).not.toContain("running ten minutes late");
},60_000);

test.each(["question", "shares"])("a withdrawal that commits before dispatch suppresses queued swap %s", async stage => {
  clock.advance(11 * MINUTE);
  const pair = [fromId, toId];
  const matchId = `withdraw-queued-${stage}`;
  await fixturePair(true);
  await fixturePair(false, "friends", pair, matchId);

  const mine = await open(`${matchId}-ask`, "send Sam my number");
  if (stage === "shares") {
    const waiting = await post(RELAY_PATH, mine);
    expect(await waiting.json()).toMatchObject({ decision: "hold" });
  }
  const request = stage === "shares" ? await open(`${matchId}-accept`, "send Ari my number", b) : mine;
  const before = posts;
  const dispatch = gateDispatch();
  const sending = post(RELAY_PATH, request);
  let withdrawal: Promise<Response> | undefined;
  try {
    const first = await Promise.race([dispatch.atGate.then(() => "gate"), sending.then(response => response.clone().text())]);
    expect(first).toBe("gate");

    clock.advance(MINUTE);
    const messageId = `${matchId}-cancel`;
    withdrawal = post(TURN_PATH, turn(a, messageId, "actually don't send it"));
    const inboundId = `in:blooio:${messageId}`;
    const withdrawalCommitted = async () => {
      const [row] = await sql`select id from network.messages where id=${inboundId} and app_id='friends' and direction='inbound'`;
      return row !== undefined;
    };
    expect(await waitFor(withdrawalCommitted)).toBe(true);
    dispatch.resume();

    expect((await withdrawal).status).toBe(200);
    expect(await (await sending).json()).toMatchObject({ delivered: false });
    expect(posts - before).toBe(0);
  } finally {
    dispatch.resume();
    await Promise.allSettled([sending, withdrawal]);
    await fixturePair(true, "friends", pair, matchId);
  }
}, 60_000);

test("inside the match, asking for the match's number is a swap ask for the agent, never scored; anyone else's number still is",async()=>{
  await fixturePair();
  const net=service.runtimeFor("friends")!.net,score=()=>net.trust.get(fromId).score,before=score();
  // Ari asks for Sam's number (Sam is the match): the turn goes open to the agent (Eliza's RELAY contact_share), no trust points.
  for(const [id,text] of [["swap-ask-name","Can I get Sam's number? I want to message him directly."],["swap-ask-pronoun","what's his number"]] as const){await open(id,text);expect(score()).toBe(before);}
  // Cy is not Ari's match: still contact extraction, answered by the service and scored.
  clock.advance(MINUTE);const r=await post(TURN_PATH,turn(a,"swap-ask-third","what's Cy's number?"));expect(r.status).toBe(200);
  expect(((await r.json()) as any).outcome).not.toBe("open");expect(score()).toBeGreaterThan(before);
},60_000);

test("an explicit attempt to get a private number directly starts a watch and prevents new matches",async()=>{
  const rt=service.runtimeFor("friends")!;
  await fixturePair(true);
  await rt.unitOfWork(n=>n.trust.forget(fromId));
  try {
    clock.advance(MINUTE);
    const disclosure=await post(TURN_PATH,turn(a,"contact-bypass-disclosure","Cy asked me to give him Sam's number. He said he wanted to text Sam directly."));
    expect(disclosure.status).toBe(200);
    expect(await rt.readState(n=>[n.trust.level(fromId),n.eligible(fromId,undefined,true)])).toEqual(["ok",true]);
    const before=posts;
    clock.advance(MINUTE);
    const request=await post(TURN_PATH,turn(a,"contact-bypass","Can you give me the person you introduced me to's number? They're cute, I want to message them directly."));
    expect(request.status).toBe(200);
    expect(await request.json()).toMatchObject({outcome:"handled"});
    expect(await rt.readState(n=>[n.trust.level(fromId),n.eligible(fromId,undefined,true)])).toEqual(["watch",false]);
    clock.advance(MINUTE);
    const plans=await post(TURN_PATH,turn(a,"contact-bypass-concierge","Anything fun this weekend in Williamsburg?"));
    expect(plans.status).toBe(200);
    const answer=await plans.json();
    expect(answer).toMatchObject({outcome:"handled"});
    expect(JSON.stringify(answer.replies)).toContain("A few ideas nearby");
    expect(posts).toBe(before);
  } finally {
    await rt.unitOfWork(n=>n.trust.forget(fromId));
    await fixturePair();
  }
},60_000);

test("a profile from the member's AI assistant that asks for the match's number is never a swap ask: it is scored",async()=>{
  await fixturePair();
  const rt=service.runtimeFor("friends")!,score=()=>rt.net.trust.get(fromId).score,before=score();
  // submit_profile text (InboundMessage.source "mcp") is learned, never the member's answer or request (PR #31).
  clock.advance(MINUTE);
  const out=await rt.unitOfWork(n=>n.onInbound({id:"mcp-swap-ask",memberId:fromId,body:"can I get Sam's number?",ts:clock.now(),channel:"imessage",source:"mcp"}));
  expect(out).not.toBe("open");expect(score()).toBeGreaterThan(before);
},60_000);

test("a pronoun ask next to a third-party or bulk ask is still scored, whole message",async()=>{
  const net=service.runtimeFor("friends")!.net,score=()=>net.trust.get(fromId).score;
  // Each case from a clean slate: the open match, and Ari's trust at 0 (a watch would close the match).
  const reset=async()=>{await service.runtimeFor("friends")!.unitOfWork(n=>n.trust.forget(fromId));await fixturePair();};
  for(const [id,text] of [["swap-mixed-bulk","send me her number and everyone's numbers"],["swap-mixed-third","what's her number? and Cy's address too"],["swap-mixed-first","give me Sam's address and her number"],["swap-mixed-girl","what is the number of that girl, also her number"]] as const){
    await reset();expect(score()).toBe(0);clock.advance(MINUTE);const x=await post(TURN_PATH,turn(a,id,text));expect(x.status).toBe(200);
    expect([text,((await x.json()) as any).outcome]).not.toEqual([text,"open"]);expect([text,score()>0]).toEqual([text,true]);
  }
  await reset();
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
    const unavailable=await open("relay-unavailable","tell Sam I'll be there soon");
    expect(await(await post(RELAY_PATH,unavailable)).json()).toEqual({decision:"block",senderNotice:"I couldn't check that message just now, so I didn't send it. Please try again in a few minutes.",delivered:false,replayed:false});expect(posts).toBe(before);
    expect((await sql`select decision,reasons from network.relay_records where app_id='friends' and from_member=${fromId} order by at desc limit 1`)[0]).toMatchObject({decision:"block",reasons:["classifier:unavailable"]});
  } finally {classifierFails=false;}
},60_000);

test("a relay item blocked for the sender's severe words writes a relay_block event in the sender's safety case at once, and a block because the classifier could not run writes none (audit SD-254; owner decision 2026-11-22, D18)",async()=>{
  clock.advance(11*MINUTE);await fixturePair();
  const rt=service.runtimeFor("friends")!,before=posts;
  const blockEvents=async()=>(await rt.readState(n=>n.exportState())).cases.filter(c=>c.memberId===fromId).flatMap(c=>c.events.filter(e=>e.kind==="relay_block"));
  const earlier=(await blockEvents()).length;
  classifierFails=true;
  try {expect(await(await post(RELAY_PATH,await open("relay-severe-hold","tell Sam I'll see you at noon"))).json()).toMatchObject({decision:"block",delivered:false});}
  finally {classifierFails=false;}
  expect(await blockEvents()).toHaveLength(earlier);
  classifierBlocks=true;
  try {expect(await(await post(RELAY_PATH,await open("relay-severe-block","tell Sam I'll be at the cafe at noon"))).json()).toMatchObject({decision:"block",delivered:false});}
  finally {classifierBlocks=false;}
  expect(posts).toBe(before);
  const after=await blockEvents();
  expect(after).toHaveLength(earlier+1);
  expect(after.at(-1)).toEqual({at:clock.now(),kind:"relay_block",points:0});
  expect((await sql`select decision,reasons from network.relay_records where from_member=${fromId} order by at desc limit 1`)[0]).toMatchObject({decision:"block",reasons:["clef_severe:threat"]});
  expect(JSON.stringify((await rt.readState(n=>n.exportState())).cases)).not.toContain("cafe");
},60_000);

test("a relayed text that only the classifier flags as a minor's words is blocked without keeping its text and gives the sender's person the minor signal at once (spec/relayDecision.md)",async()=>{
  const dee="+12125550219",eve="+12125550220";
  for(const [phone,name] of [[dee,"Dee"],[eve,"Eve"]]) for(const [i,text] of ["friends.help",`${name}, 29`,"I enjoy hiking and cooking","Saturday afternoons work for me","Small groups are good"].entries()){
    clock.advance(MINUTE);expect((await post(TURN_PATH,turn(phone!,`setup:${name}:${i}`,text))).status).toBe(200);
  }
  const person=(await service.accounts.personFor(dee))!;
  const from=(await service.people.getMembership(person.id,"friends"))!.memberId,to=(await service.people.getMembership((await service.accounts.personFor(eve))!.id,"friends"))!.memberId;
  await fixturePair(false,"friends",[from,to],"relay-minor-pair");
  const rt=service.runtimeFor("friends")!,before=posts,text="tell Eve I'll see you at the park on saturday";
  const prior=(await rt.readState(n=>n.exportState())).members.find(m=>m.id===from)!;
  expect([!!prior.minor,!!prior.minorSignal]).toEqual([false,false]);
  expect((await sql`select person_id from platform.person_minor_signals where person_id=${person.id}::uuid`)).toHaveLength(0);
  const request=await open("relay-minor-clef",text,dee);
  classifierMinor=true;
  try {expect(await(await post(RELAY_PATH,request)).json()).toEqual({decision:"block",senderNotice:"I didn't send that, so it didn't reach them.",delivered:false,replayed:false});}
  finally {classifierMinor=false;}
  expect(posts).toBe(before);
  expect((await sql`select age_signal,decision,reasons from network.relay_records where app_id='friends' and from_member=${from} order by at desc limit 1`)[0]).toMatchObject({age_signal:true,decision:"block",reasons:["clef:minor_signal"]});
  const st=await rt.readState(n=>n.exportState());
  expect(st.members.find(m=>m.id===from)).toMatchObject({minor:true,minorSignal:true});
  const kinds=st.cases.filter(c=>c.memberId===from).flatMap(c=>c.events.map(e=>e.kind));
  expect(kinds).toContain("relay_age_signal");
  expect(kinds).not.toContain("age_review");
  expect(st.opps.find(o=>o.id==="relay-minor-pair")!.stage).toBe("closed");
  expect(Object.keys(st.relay!).sort()).toEqual(["log","swaps","threads"]);
  expect(JSON.stringify(st)).not.toContain("park on saturday");
  expect((await sql`select person_id::text from platform.person_minor_signals where person_id=${person.id}::uuid`).map((x:any)=>x.person_id)).toEqual([person.id]);
},60_000);

test("with two live matches the open context offers both; an unnamed relay asks which one and sends nothing; a named one reaches only that match",async()=>{
  clock.advance(11*MINUTE);await fixturePair();clock.advance(MINUTE);
  await service.runtimeFor("friends")!.unitOfWork(n=>{const st=n.exportState(),base=st.opps.find(op=>op.id==="relay-pair")!;
    st.opps.push({...base,id:"relay-pair-cy",participants:[fromId,thirdId],status:[[fromId,"yes"],[thirdId,"yes"]],contacted:[fromId,thirdId],createdAt:clock.now()});n.importState(st);});
  try {
    clock.advance(MINUTE);expect((await post(TURN_PATH,turn(b,"two-matches-sam-reply","Sounds good, thanks"))).status).toBe(200);
    const unnamed=await open("two-matches-unnamed","tell Sam I'm on my way");
    const [row]=await sql`select response from platform.inbound where id='msg:blooio:two-matches-unnamed'`;
    expect(row.response.context.activeItems).toEqual([{id:"relay-pair-cy",kind:"match",summary:"Match with Cy"},{id:"relay-pair",kind:"match",summary:"Match with Sam"}]);
    const before=posts,calls=classifications;
    expect(await(await post(RELAY_PATH,unnamed)).json()).toEqual({decision:"none",senderNotice:"You have more than one match, so I didn't send that. Send it again and say who it's for.",delivered:false,replayed:false});
    expect(posts).toBe(before);expect(classifications).toBe(calls);
    expect((await sql`select item_id from network.relay_records where from_member=${fromId} and at>${new Date(clock.now()-MINUTE)}`).length).toBe(0);
    const answer=await open("two-matches-answer","Sam");
    expect(await(await post(RELAY_PATH,{...answer,itemId:"relay-pair"})).json()).toEqual({decision:"none",senderNotice:"",delivered:false,replayed:false});expect(posts).toBe(before);
    const net=service.runtimeFor("friends")!.net,trustBefore=net.trust.get(fromId).score;
    const ask=await open("two-matches-number","can I get her number?");expect(net.trust.get(fromId).score).toBe(trustBefore);
    expect(await(await post(RELAY_PATH,ask)).json()).toEqual({decision:"none",senderNotice:"",delivered:false,replayed:false});expect(posts).toBe(before);
    const named=await open("two-matches-named","tell Sam I'm on my way");
    expect(await(await post(RELAY_PATH,{...named,itemId:"relay-pair"})).json()).toMatchObject({decision:"pass",delivered:true});
    expect(posts).toBe(before+1);expect(sent.at(-1)).toMatchObject({to:b,text:'Ari says: "I\'m on my way"'});
    const late=await open("two-matches-closed","tell Cy I'm on my way");
    await service.runtimeFor("friends")!.unitOfWork(n=>{const st=n.exportState(),op=st.opps.find(x=>x.id==="relay-pair-cy")!;op.stage="closed";op.closedFrom="scheduled";n.importState(st);});
    expect(await(await post(RELAY_PATH,{...late,itemId:"relay-pair-cy"})).json()).toEqual({decision:"block",senderNotice:"That match is closed, so I can't pass anything on to them.",delivered:false,replayed:false});
    expect(posts).toBe(before+1);
  } finally {
    await service.runtimeFor("friends")!.unitOfWork(n=>{const st=n.exportState(),op=st.opps.find(x=>x.id==="relay-pair-cy");if(op){op.stage="closed";op.closedFrom="scheduled";n.importState(st);}});
  }
},60_000);

test("two live matches with the same first name get distinct summaries, or none when the day is shared too, so the agent never guesses",async()=>{
  const d="+12125550214";
  for(const [i,text] of ["friends.help","Sam, 31","I enjoy climbing and films","Sunday mornings work for me","Small groups are good"].entries()){
    clock.advance(MINUTE);expect((await post(TURN_PATH,turn(d,`setup:Sam2:${i}`,text))).status).toBe(200);
  }
  const otherSam=(await service.people.getMembership((await service.accounts.personFor(d))!.id,"friends"))!.memberId;
  clock.advance(11*MINUTE);await fixturePair();
  const pairs=async(first:number,second:number)=>service.runtimeFor("friends")!.unitOfWork(n=>{const st=n.exportState(),base=st.opps.find(op=>op.id==="relay-pair")!;
    st.opps=st.opps.filter(op=>op.id!=="relay-pair-sam2");base.createdAt=first;
    st.opps.push({...base,id:"relay-pair-sam2",participants:[fromId,otherSam],status:[[fromId,"yes"],[otherSam,"yes"]],contacted:[fromId,otherSam],createdAt:second});n.importState(st);});
  const items=async(id:string)=>{await open(id,"how is it going");const [row]=await sql`select response from platform.inbound where id=${`msg:blooio:${id}`}`;return row.response.context.activeItems;};
  try {
    await pairs(Date.UTC(2026,9,9,16),Date.UTC(2026,9,10,16));
    expect(await items("same-name-days")).toEqual([{id:"relay-pair-sam2",kind:"match",summary:"Match with Sam (introduced Oct 10)"},{id:"relay-pair",kind:"match",summary:"Match with Sam (introduced Oct 9)"}]);
    await pairs(Date.UTC(2026,9,9,15),Date.UTC(2026,9,9,17));
    expect(await items("same-name-same-day")).toBeNull();
    const before=posts,unnamed=await open("same-name-unnamed","tell Sam I'm on my way");
    expect(await(await post(RELAY_PATH,unnamed)).json()).toMatchObject({decision:"none",senderNotice:"You have more than one match, so I didn't send that. Send it again and say who it's for."});
    expect((await post(RELAY_PATH,{...(await open("same-name-guess","tell Sam I'm on my way")),itemId:"relay-pair"})).status).toBe(403);
    expect(posts).toBe(before);
  } finally {
    await service.runtimeFor("friends")!.unitOfWork(n=>{const st=n.exportState(),op=st.opps.find(x=>x.id==="relay-pair-sam2");if(op){op.stage="closed";op.closedFrom="scheduled";n.importState(st);}});
    await fixturePair();
  }
},60_000);

test("relay holds stored before the change are closed: their records say block, the stored state keeps no held item or text, staff cannot release them, and nothing reaches the other member",async()=>{
  clock.advance(11*MINUTE);await fixturePair();
  const before=posts,at=new Date(clock.now()),item="legacy-held-1",rate="legacy-rate-1";
  await server.stop(true);await service.close();
  await sql`alter table network.relay_records drop constraint if exists relay_records_decision_check`;
  await sql`alter table network.relay_records drop constraint if exists relay_records_review_check`;
  await sql`insert into network.relay_records (app_id,network_id,item_id,opportunity_id,kind,from_member,to_member,at,decision,reasons,photo_count,contact_shared,age_signal,policy,review)
    values ('friends','friends:nyc',${item},'relay-pair','text',${fromId},${toId},${at},'hold',${"{scam:money}"}::text[],0,false,false,'relay-1.0.0','held'),
           ('friends','friends:nyc',${rate},'relay-pair','text',${fromId},${toId},${at},'hold',${"{rate:burst}"}::text[],0,false,false,'relay-1.0.0',null)`;
  const legacyHeld=[{itemId:item,matchId:"relay-pair",app:"friends",kind:"text",from:fromId,to:toId,at:clock.now(),reasons:["scam:money"],text:"legacy held words",status:"held"}];
  const legacyLog=[item,rate].map(itemId=>({itemId,opportunityId:"relay-pair",app:"friends",kind:"text",from:fromId,to:toId,at:clock.now(),decision:"hold",reasons:[itemId===item?"scam:money":"rate:burst"],photoCount:0,contactShared:false,ageSignal:false,policy:"relay-1.0.0"}));
  await sql`update network.network_state set state=jsonb_set(jsonb_set(state,'{relay,held}',${sql.json(legacyHeld)}::jsonb),'{relay,log}',coalesce(state->'relay'->'log','[]'::jsonb)||${sql.json(legacyLog)}::jsonb) where id='friends:nyc'`;
  const migration=await readFile(new URL("../../observatory/db/migrations/0086_relay_holds_closed.sql",import.meta.url),"utf8");
  for(let i=0;i<2;i++)await sql.unsafe(migration);
  expect((await sql`select item_id,decision,reasons,review,reviewed_by from network.relay_records where app_id='friends' and item_id in (${item},${rate}) order by item_id`).map((r:any)=>[r.item_id,r.decision,r.reasons,r.review,r.reviewed_by]))
    .toEqual([[item,"block",["review:closed","scam:money"],"expired","system:relay_automated"],[rate,"block",["rate:burst","review:closed"],null,null]]);
  expect((await sql`select count(*)::int as n from network.relay_records where decision='hold' or review='held'`)[0].n).toBe(0);
  await expect(sql`insert into network.relay_records (app_id,network_id,item_id,opportunity_id,kind,from_member,to_member,at,decision,policy)
    values ('friends','friends:nyc','legacy-held-2','relay-pair','text',${fromId},${toId},${at},'hold','relay-1.0.0')`).rejects.toThrow();
  const [row]=await sql`select state from network.network_state where id='friends:nyc'`,st=typeof row.state==="string"?JSON.parse(row.state):row.state;
  expect(Object.keys(st.relay).sort()).toEqual(["log","swaps","threads"]);
  expect(st.relay.log.filter((r:any)=>r.itemId===item||r.itemId===rate).map((r:any)=>[r.itemId,r.decision,r.reasons])).toEqual([[item,"block",["review:closed","scam:money"]],[rate,"block",["rate:burst","review:closed"]]]);
  expect(st.relay.log.some((r:any)=>r.decision==="hold")).toBe(false);
  expect(JSON.stringify(st)).not.toContain("legacy held words");
  await start();
  const rt=service.runtimeFor("friends")!;
  expect((await rt.readState(n=>n.relayLog())).filter(r=>r.itemId===item||r.itemId===rate).map(r=>r.decision)).toEqual(["block","block"]);
  const listed=await(await fetch(new URL("/relay/held?app=friends",server.url),{headers:{authorization:`Bearer ${friendsStaffToken}`}})).json() as any;
  expect(listed.items.filter((x:any)=>x.kind!=="photo")).toEqual([]);
  const release=await fetch(new URL(`/relay/${item}/release?app=friends`,server.url),{method:"POST",headers:{authorization:`Bearer ${friendsStaffToken}`,"content-type":"application/json"},body:JSON.stringify({note:"checked: fine to pass on"})});
  expect(await release.json()).toMatchObject({ok:false,reason:"not_held"});
  await service.tick();
  expect(posts).toBe(before);
  expect((await sql`select id from network.messages where app_id='friends' and id in (${`relay:${item}`},${`relay:${rate}`})`).length).toBe(0);
},60_000);

test("negative feedback in the check-in after the meeting ends the relay thread in both directions without a block (audit OPP58)",async()=>{
  clock.advance(11*MINUTE);await fixturePair();
  const rt=service.runtimeFor("friends")!,k=[fromId,toId].sort().join("|");
  const open1=await open("relay-feedback-before","tell Ari thanks for coffee",b);
  expect(await(await post(RELAY_PATH,open1)).json()).toMatchObject({decision:"pass",delivered:true});
  await rt.unitOfWork(n=>{const st=n.exportState(),op=st.opps.find(x=>x.id==="relay-pair")!;op.meetingAt=clock.now()-4*HOUR;n.importState(st);});
  const booked=[[fromId,a,"booking-notice-relay-pair-ari"],[toId,b,"booking-notice-relay-pair-sam"]] as const,bookedAt=new Date(clock.now()-DAY);
  for(const [member,phone,id] of booked){
    await sql`insert into network.messages (id,app_id,member_id,direction,channel,body,type,status,opportunity_id,proactive,ts)
      values (${id},'friends',${member},'outbound','imessage','Coffee is booked.','proposal','accepted','relay-pair',true,${bookedAt})`;
    await sql`insert into platform.outbound (id,app_id,member_id,line,to_address,kind,body,fingerprint,time_zone,status,next_attempt_at,created_at,updated_at,sent_at,opportunity_id)
      values (${id},'friends',${member},'+12125550210',${phone},'proactive','Coffee is booked.',${id},'America/New_York','accepted',${bookedAt},${bookedAt},${bookedAt},${bookedAt},'relay-pair')`;
  }
  try {
    await service.tick();
    const stage=async()=>{const [row]=await sql`select state from network.network_state where id='friends:nyc'`;const st=typeof row.state==="string"?JSON.parse(row.state):row.state;return st.opps.find((op:any)=>op.id==="relay-pair")?.stage;};
    expect(await stage()).toBe("done");
    for(const id of [fromId,toId])expect(await waitFor(async()=>(await sql`select id from platform.outbound where app_id='friends' and id=${meetingFeedbackKey("relay-pair",id)}
      and status in ('accepted','sent','delivered','read')`).length===1)).toBe(true);
    clock.advance(MINUTE);
    expect((await post(TURN_PATH,turn(b,"relay-feedback-negative","It wasn't great, we didn't really click."))).status).toBe(200);
    clock.advance(MINUTE);
    expect((await post(TURN_PATH,turn(a,"relay-feedback-neutral","It was fine, we talked for an hour."))).status).toBe(200);
    const [saved]=await sql`select state from network.network_state where id='friends:nyc'`,stored=typeof saved.state==="string"?JSON.parse(saved.state):saved.state;
    expect(stored.avoid).toContain(k);
    expect(stored.feedback.filter((f:any)=>f.opportunityId==="relay-pair").map((f:any)=>[f.from,f.about,f.sentiment])).toEqual([[toId,fromId,"negative"],[fromId,toId,"neutral"]]);
    const before=posts;
    const theirs=await open("relay-feedback-after","tell Ari I had fun, let's do it again",b);
    const [context]=await sql`select response from platform.inbound where id=${"msg:blooio:relay-feedback-after"}`;expect(context.response.context.activeItems).toBeNull();
    expect(await(await post(RELAY_PATH,theirs)).json()).toEqual({decision:"block",senderNotice:"I can only pass messages on to someone you've matched with, and you don't have an open match right now.",delivered:false,replayed:false});
    expect((await post(RELAY_PATH,{...(await open("relay-feedback-named","tell Ari I had fun",b)),itemId:"relay-pair"})).status).toBe(403);
    expect(await(await post(RELAY_PATH,await open("relay-feedback-mine","tell Sam goodbye"))).json()).toMatchObject({decision:"block",delivered:false});
    expect(posts).toBe(before);
    const [row]=await sql`select state from network.network_state where id='friends:nyc'`,st=typeof row.state==="string"?JSON.parse(row.state):row.state;
    expect(relayDispatchCheck(st,{matchId:"relay-pair",from:toId,to:fromId,now:clock.now()})).toBe("state:closed");
    expect(st.blocks).not.toContain(k);
  } finally {
    await rt.unitOfWork(n=>{const st=n.exportState();st.avoid=st.avoid.filter(x=>x!==k);st.feedback=st.feedback.filter(f=>f.opportunityId!=="relay-pair");
      for(const m of st.members)if(m.awaiting?.oppId==="relay-pair")delete m.awaiting;n.importState(st);});
    for(const [,,id] of booked){await sql`delete from platform.outbound where id=${id}`;await sql`delete from network.messages where id=${id}`;}
    await fixturePair();
  }
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
      await sleep(50);expect(closedEarly).toBe(false);
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
  expect(JSON.stringify(state.relay)).not.toContain("text another person");
  expect(posts).toBe(before);
},60_000);


test("relay admission and canonical leave use one lock order, retaining the fresh STOP check",async()=>{
  const recipient="+12125550214",rt=service.runtimeFor("friends")!;
  for(const [i,text] of ["friends.help","Dee, 29", "I enjoy hiking and cooking","Saturday afternoons work for me","Small groups are good"].entries()) {
    clock.advance(MINUTE);expect((await post(TURN_PATH,turn(recipient,`leave-race-join:${i}`,text))).status).toBe(200);
  }
  const who=await service.accounts.personFor(recipient);expect(who).toBeDefined();
  fromId=thirdId;toId=(await service.people.getMembership(who!.id,"friends"))!.memberId;
  clock.advance(11*MINUTE);await fixturePair();
  const checks=((rt.adapter as CloudChannelAdapter).queue as unknown as {o:QueueOptions}).o.checks,original=checks.admit!;
  let release!:()=>void,entered!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}),atGate=new Promise<void>(resolve=>{entered=resolve;});
  const sqlStates:string[]=[];
  checks.admit=async(row,tx)=>{
    if(row.id.startsWith("relay:")){entered();await gate;}
    try{return await original(row,tx);}catch(error){sqlStates.push((error as {errno?:string}).errno??"unknown");throw error;}
  };
  let sending:Promise<Response>|undefined,leaving:Promise<boolean>|undefined;
  try{
    const request=await open("relay-leave-lock-order","tell Dee I'll meet them outside",c),before=posts;
    sending=post(RELAY_PATH,request);
    await Promise.race([atGate,sending.then(async r=>{throw Error(`relay never reached admission: ${await r.clone().text()}`);})]);
    leaving=service.accounts.leave(service.apps.friends,{e164:recipient,personId:who!.id}).catch(error=>{sqlStates.push((error as {errno?:string}).errno??"unknown");throw error;});
    // Wait for the real erasure transaction to contend with dispatch, without
    // replacing either owner or assuming how long the database takes.
    expect(await waitFor(async()=>{
      const rows=await sql`select pid from pg_stat_activity where datname=${db} and wait_event_type='Lock'`;
      return rows.length>0;
    })).toBe(true);
    release();
    const [delivered,forgotten]=await Promise.allSettled([sending,leaving]);
    expect(sqlStates).toEqual([]);expect(forgotten.status).toBe("fulfilled");
    expect(delivered.status).toBe("fulfilled");
    if(delivered.status==="fulfilled")expect(await delivered.value.json()).toMatchObject({delivered:false});
    expect(posts).toBe(before);
    expect((await service.people.getMembership(who!.id,"friends"))?.state).toBe("removed");
    expect((await sql`select id from platform.outbound where app_id='friends' and member_id=${toId} and (body is not null or to_address is not null)`).length).toBe(0);
  }finally{release?.();checks.admit=original;await Promise.allSettled([sending,leaving]);}
},60_000);


test("a member with no open match who asks for 'her number' is scored",async()=>{
  const net=service.runtimeFor("friends")!.net,before=net.trust.get(thirdId).score;
  clock.advance(MINUTE);const r=await post(TURN_PATH,turn(c,"swap-no-match","what's her number"));expect(r.status).toBe(200);
  expect(((await r.json()) as any).outcome).not.toBe("open");expect(net.trust.get(thirdId).score).toBeGreaterThan(before);
},60_000);

test("a signed relay self-age closes the match and lowers the person's age across apps", async () => {
  const sender = "+12125550217", recipient = "+12125550218";
  async function join(app: "friends" | "slop", phone: string, name: string) {
    const messages = [app === "friends" ? "friends.help" : "slop.date", name + ", 29",
      "I enjoy hiking and cooking", "Saturday afternoons work for me", "Small groups are good"];
    for (const [index, text] of messages.entries()) {
      clock.advance(MINUTE);
      const id = "relay-age-join:" + app + ":" + name + ":" + index;
      expect((await post(TURN_PATH, { ...turn(phone, id, text), app })).status).toBe(200);
    }
    const person = await service.accounts.personFor(phone);
    if (!person) throw new Error("Missing relay fixture person");
    const membership = await service.people.getMembership(person.id, app);
    if (!membership) throw new Error("Missing relay fixture membership");
    return membership.memberId;
  }
  const senderFriends = await join("friends", sender, "Bo");
  const recipientFriends = await join("friends", recipient, "Jae");
  const senderSlop = await join("slop", sender, "Bo");
  const matchId = "friends.relay-age-pair";
  await fixturePair(false, "friends", [senderFriends, recipientFriends], matchId);
  const controls = [
    ["other", "tell them my 15 year old will be with me"],
    ["eta", "tell them 15m from the bar"],
  ] satisfies [string, string][];
  for (const [suffix, phrase] of controls) {
    clock.advance(11 * MINUTE);
    const request = await open("relay-age-" + suffix, phrase, sender);
    expect((await post(RELAY_PATH, request)).status).toBe(200);
    expect((await service.accounts.personFor(sender))?.lowestAge).toBe(29);
  }
  expect(await pairClosed(matchId)).toBe(false);
  const estimates = [
    ["quote", "+12125550221", "Kit", "tell them I heard her say, \"I'm 16\""],
    ["school", "+12125550222", "Lu", "tell them homeroom starts soon"],
  ] satisfies [string, string, string, string][];
  for (const [suffix, phone, name, phrase] of estimates) {
    const estimator = await join("friends", phone, name), estimateId = "friends.relay-age-estimate-" + suffix;
    await fixturePair(false, "friends", [estimator, recipientFriends], estimateId);
    clock.advance(11 * MINUTE);
    const request = await open("relay-age-estimate-" + suffix, phrase, phone);
    expect(await (await post(RELAY_PATH, request)).json()).toMatchObject({ decision: "block", delivered: false });
    expect((await service.accounts.personFor(phone))?.lowestAge).toBe(29);
    expect(await pairClosed(estimateId)).toBe(true);
  }
  clock.advance(11 * MINUTE);
  const request = await open("relay-age-self", "tell them 16f here", sender);
  const before = posts;
  const response = await post(RELAY_PATH, request);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ decision: "block", delivered: false, replayed: false });
  const replay = await post(RELAY_PATH, request);
  expect(await replay.json()).toMatchObject({ decision: "block", delivered: false, replayed: true });
  expect(posts).toBe(before);
  expect(await pairClosed(matchId)).toBe(true);
  expect((await service.accounts.personFor(sender))?.lowestAge).toBe(16);
  const snapshot = await loadSnapshot(sql, clock.now(), { app: "slop", city: "nyc" });
  expect(snapshot.members.find(member => member.id === senderSlop)?.age).toBe(16);
  expect(await sql`select age from network.members where app_id='slop' and id=${senderSlop}`).toEqual([{ age: 16 }]);
}, 60_000);
