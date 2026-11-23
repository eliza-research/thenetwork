// Cloud's RELAY wire end to end on the canonical owner: real signed HTTP (RelaySendRequest, x-ntwrk-svc-id
// "<messageId>:relay") -> POST /internal/relay -> the ConsentNetwork relay desk -> the durable outbox ->
// the Cloud deliver path. Classifier and Cloud HTTP are controlled boundaries. Needs the dev Postgres on :54339.
import { serveHttp, type HttpServer } from "../../core/src/runtime/http.ts";
import { setTimeout as sleep } from "node:timers/promises";
import {afterAll,beforeAll,expect,test} from "vitest";
import {randomUUID,createHash} from "node:crypto";
import {SQL} from "../../core/src/runtime/postgres.ts";
import {DAY,HOUR,MINUTE,SimClock} from "@thenetwork/core";
import {applySchema} from "../../observatory/db/dev-pg.ts";
import {TURN_PATH,RELAY_PATH,DELIVER_PATH,RELAY_PHOTO_RESOLVE_PATH,type RelaySendRequest,type TurnRequest} from "../../core/src/svc/contract.ts";
import {svcSign,svcVerify} from "../../core/src/svc/svc-auth.ts";
import {CloudChannelAdapter,DELIVER_RECEIPT_PATH} from "../service/cloud-channel.ts";
import {NetworkService} from "../service/service.ts";
import {loadSnapshot} from "../service/snapshot.ts";
import {PgAudit} from "../../observatory/src/staff.ts";
import type {AuditEntry} from "../../observatory/src/types.ts";
import type {NetworkState} from "../src/network.ts";
import {PHOTO_CONSENT,type PhotoStorage} from "../../platform/src/photos.ts";
import type {QueueOptions} from "../../blooio/src/outbound-queue.ts";
const db=`network_relay_${randomUUID().replaceAll("-","")}`,url=`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/${db}`;
const admin=new SQL({url:`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/postgres`,max:1});
const secret="synthetic-current-relay-signing-secret-20261009",clock=new SimClock(Date.UTC(2026,9,9,16));
const a="+12125550211",b="+12125550212",c="+12125550213";
let sql:SQL,service:NetworkService,server:HttpServer,cloud:HttpServer,fromId:string,toId:string,thirdId:string;
let classifierFails=false,classifications=0,known=true,posts=0,polls=0,ancillaryPosts=0;
let classifyGate:Promise<void>|undefined,classifyEntered:(()=>void)|undefined;
const sent:Array<{id:string;text:string;kind:string;to:string;approvedPhotos?:import("../../core/src/svc/contract.ts").ApprovedRelayPhoto[]}>=[];
const staffToken="synthetic-photo-safety-token-20261016",staffId=`token:safety#${createHash("sha256").update(staffToken).digest("hex").slice(0,8)}`;
let photoPolicyEnabled=false,photoResolves=0,reviewerEnabled=true,failPreviewAudit=false,storageReads=0;
const capabilityUrls:string[]=[];
const photoBytes=new Map<string,Uint8Array>();
const photoStorage:PhotoStorage={kind:"local",put:async(k,bytes)=>{photoBytes.set(k,bytes.slice());},get:async k=>{storageReads++;return photoBytes.get(k); },delete:async k=>{photoBytes.delete(k);}};
const start=async()=>{
  const audit=new PgAudit(url);
  service=new NetworkService({url,clock,photoStorage,audit:{kind:audit.kind,list:q=>audit.list(q),close:()=>audit.close(),write:async(entry:AuditEntry)=>{
      if(failPreviewAudit&&entry.action==="read_relay_photo"&&entry.detail?.phase==="requested")throw Error("synthetic preview audit write failure");
      await audit.write(entry);
    }},photoDeliveryOrigin:"https://backend.photo-fixture.invalid",tokens:`safety@slop:${staffToken}`,
    ...(photoPolicyEnabled?{photoRelayPolicy:{version:"relay-fixture-v1",notice:"Share this selected photo with {{recipient}} only after its designated safety review. Test fixture policy.",authorizeReviewer:async(id:string)=>id===staffId&&reviewerEnabled}}:{}),env:{PLATFORM_ENV:"dev",CLEF_RATINGS:"off",SERVICE_TURN_SECRET:secret},networks:[{id:"friends:nyc",matchingEnabled:false},{id:"slop:nyc",matchingEnabled:false}],log:()=>{},
    relayClassifier:async()=>{classifications++;if(classifyGate){classifyEntered?.();await classifyGate;}if(classifierFails)throw new Error("synthetic classifier outage");return {flags:[],source:"clef" as const};},
    adapter:(_net,rt)=>new CloudChannelAdapter({app:rt.app.id,clock,city:rt.city,from:"+12125550210",origin:cloud.url.origin,secret,env:{PLATFORM_ENV:"dev",BLOOIO_ALLOW_SEND:"1",NTWRK_LIVE_APPROVED:"1",FRIENDS_LIVE_APPROVED:"1",SLOP_LIVE_APPROVED:"1"}})});
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
const fixturePair=async(closed=false,app:"friends"|"slop"="friends",pair=[fromId,toId],matchId="relay-pair")=>service.runtimeFor(app)!.unitOfWork(n=>{
  // Explicit canonical mutual-consent fixture. This case qualifies relay, not engine matching or human review.
  const state=n.exportState();state.opps=state.opps.filter(op=>op.id!==matchId);
  const op:NetworkState["opps"][number]={id:matchId,origin:"engine",kind:"intro",category:"social",objective:"coffee",detail:"coffee",participants:pair,alternates:[],primed:[],status:pair.map(id=>[id,"yes"]),explanations:{},stage:closed?"closed":"scheduled",...(closed?{closedFrom:"scheduled"}:{}),deadline:clock.now()+DAY,createdAt:clock.now(),score:.8,generator:"fixture",components:{fit:0,mutualBenefit:0,warmPath:0,novelty:0,timingFit:0,activationCost:0,interruptionCost:0,load:0,repetition:0,socialRisk:0,confidence:0},exploration:false,review:{queuedAt:clock.now(),deadline:clock.now()+DAY,decision:"approve",reviewer:"fixture"},sameDay:false,contacted:pair,reminded:[],feedbackFrom:[],tags:[],replacements:0} as NetworkState["opps"][number];
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
    expect(auth.ok).toBe(true);const input=JSON.parse(raw);expect([a,b,c,"+12125550214","+12125550215","+12125550216","+12125550217","+12125550218","+12125550229","+12125550230"]).toContain(input.to);
    if(input.kind==="relay"){if(path===DELIVER_PATH){
      posts++;sent.push(input);
      if(input.approvedPhotos){
        const providerKey=`network:personal:fixture:${createHash("sha256").update(input.id).digest("hex")}`;
        const body=JSON.stringify({id:providerKey,deliveryId:input.id,to:input.to,approvedPhotos:input.approvedPhotos});
        const resolved=await service.fetch(new Request(`https://backend.photo-fixture.invalid${RELAY_PHOTO_RESOLVE_PATH}`,{method:"POST",body,
          headers:{"content-type":"application/json",...await svcSign(secret,{method:"POST",path:RELAY_PHOTO_RESOLVE_PATH,id:providerKey,body,nowS:Math.floor(clock.now()/1000)})}}));
        expect(resolved.status).toBe(200);const payload=await resolved.json() as any;expect(payload.photos).toHaveLength(1);
        photoResolves++;capabilityUrls.push(payload.photos[0].url);
        const media=await service.publicFetch(new Request(payload.photos[0].url));expect(media.status).toBe(200);expect(media.headers.get("content-type")).toBe("image/jpeg");
        expect(createHash("sha256").update(new Uint8Array(await media.arrayBuffer())).digest("hex")).toBe(input.approvedPhotos[0].sha256);
      }
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
  expect(await(await post(RELAY_PATH,unrelated)).json()).toMatchObject({decision:"hold",delivered:false});expect(posts).toBe(guardedBefore);
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
  expect(JSON.stringify(state.relay.held)).not.toContain("text another person");
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

test("selected photos survive queued uncertainty/restart with native JSONB refs, and revocation wins final admission",async()=>{
  const sender="+12125550215",recipient="+12125550216";
  for(const [phone,name] of [[sender,"Dena"],[recipient,"Elle"]])for(const [i,text]of [
    "slop.date", `${name}, 29`, "I'm a woman into women. I live in Greenpoint and love climbing and live music",
    "I'm a woman looking for women, 25 to 35, within 5 miles of 11222", "A long-term relationship, no smokers",
    "Coffee or a walk for a first date. Weekend evenings work best.", "Yes, that's right.",
  ].entries()){
    clock.advance(MINUTE);expect((await post(TURN_PATH,{...turn(phone!,`photo-setup:${name}:${i}`,text),app:"slop"})).status).toBe(200);
  }
  const person=(await service.accounts.personFor(sender))!,other=(await service.accounts.personFor(recipient))!;
  const from=(await service.people.getMembership(person.id,"slop"))!.memberId,to=(await service.people.getMembership(other.id,"slop"))!.memberId;
  const matchId="slop.relay-photo-pair";
  await fixturePair(false,"slop",[from,to],matchId);
  // Synthetic JPEG storage boundary; all ownership, consent, reviews, queue and replay state use real Postgres.
  const upload=await service.photos.upload(person.id,"slop",Uint8Array.from([255,216,255,218,0,2,1,255,217]),PHOTO_CONSENT.version);
  expect(upload.ok).toBe(true);if(!upload.ok)throw Error(JSON.stringify(upload));
  expect(await service.photoRelay.select("slop",person.id,matchId,upload.value.id,"relay-fixture-v1",true,"fixture-select-primary-20261016")).toBeUndefined();
  photoPolicyEnabled=true;await restart();
  const selected=await service.photoRelay.select("slop",person.id,matchId,upload.value.id,"relay-fixture-v1",true,"fixture-select-primary-20261016");
  expect(selected?.state).toBe("pending");if(!selected)throw Error("normal selected item refused");
  const beforeAuditRead=storageReads;
  failPreviewAudit=true;
  try{
    const refused=await fetch(new URL(`/relay/${selected.itemId}/photo?app=slop`,server.url),{headers:{authorization:`Bearer ${staffToken}`}});
    expect(refused.status).toBe(503);expect(refused.headers.get("x-network-photo-review-token")).toBeNull();expect(storageReads).toBe(beforeAuditRead);
  }finally{failPreviewAudit=false;}
  expect((await service.audit.list({targetId:selected.itemId,actions:["read_relay_photo"]})).length).toBe(0);
  const reviewTokens=new Map<string,string>();
  const release=async(id:string)=>{
    if(!reviewTokens.has(id)){
      const preview=await fetch(new URL(`/relay/${id}/photo?app=slop`,server.url),{headers:{authorization:`Bearer ${staffToken}`}});
      expect(preview.status).toBe(200);await preview.arrayBuffer();
      reviewTokens.set(id,preview.headers.get("x-network-photo-review-token")!);
    }
    return fetch(new URL(`/relay/${id}/release?app=slop`,server.url),{method:"POST",headers:{authorization:`Bearer ${staffToken}`,"content-type":"application/json"},body:JSON.stringify({note:"Selected item checked for fixture consent and safety",photoReviewToken:reviewTokens.get(id)})});
  };
  const before=posts;
  // Fail the real queue insert after per-item human approval; the claim/state/queue transaction must roll back together.
  await sql.unsafe("create function fail_selected_photo_enqueue() returns trigger language plpgsql as $$ begin if NEW.id like 'relay:pri_%' then raise exception 'synthetic selected photo queue failure'; end if; return NEW; end $$");
  await sql.unsafe("create trigger selected_photo_enqueue_fault before insert on platform.outbound for each row execute function fail_selected_photo_enqueue()");
  try {expect((await release(selected.itemId)).status).toBe(503);}finally{await sql.unsafe("drop trigger selected_photo_enqueue_fault on platform.outbound");await sql.unsafe("drop function fail_selected_photo_enqueue()");}
  const audited=await service.audit.list({limit:100,targetId:selected.itemId});
  expect(audited.some(row=>row.actor===staffId&&row.reason==="Selected item checked for fixture consent and safety"&&row.detail?.phase==="reviewed")).toBe(true);
  expect(audited.some(row=>row.actor===staffId&&!row.ok&&row.detail?.phase==="result"&&row.detail?.delivered===false)).toBe(true);
  const reviewed=await service.photoRelay.item(selected.itemId);expect(reviewed).toMatchObject({state:"approved",actionId:null});
  expect((await sql`select id from platform.outbound where id=${`relay:${selected.itemId}`}`).length).toBe(0);expect(posts).toBe(before);
  for (const [index, text] of [
    "Tell Ana to send him my photo.",
    "Could you let Ana show him this photo?",
    "I have Ana assigned to, show him this photo.",
  ].entries()) {
    const messageId = "delegated-selected-photo-" + index;
    clock.advance(MINUTE);
    const opened = await post(TURN_PATH, { ...turn(sender, messageId, text), app: "slop" });
    expect(opened.status).toBe(200);
    const openResult = await opened.json();
    expect(openResult, JSON.stringify(openResult)).toMatchObject({ outcome: "open", memberId: from });
    const response = await post(RELAY_PATH, { channel: "blooio", messageId, app: "slop", memberId: from, itemId: null, text });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ decision: "none", delivered: false });
    expect(await service.photoRelay.item(selected.itemId)).toMatchObject({ state: "approved", actionId: null });
    expect(await sql`select id from platform.outbound where id=${`relay:${selected.itemId}`}`).toHaveLength(0);
    expect(posts).toBe(before);
  }
  reviewerEnabled=false;expect((await release(selected.itemId)).status).toBe(403);expect(posts).toBe(before);
  expect((await sql`select id from platform.outbound where id=${`relay:${selected.itemId}`}`).length).toBe(0);reviewerEnabled=true;
  await restart();expect((await service.photoRelay.item(selected.itemId))!.reviewId).toBe(reviewed!.reviewId);
  known=false;
  const decision=await release(selected.itemId);expect(decision.status).toBe(200);expect(await decision.json()).toMatchObject({ok:true,delivered:false});
  const [saved]=await sql`select approved_photos,jsonb_typeof(approved_photos) as shape,jsonb_typeof(approved_photos->0) as element,status,fingerprint from platform.outbound where id=${`relay:${selected.itemId}`}`;
  expect(saved.shape).toBe("array");expect(saved.element).toBe("object");expect(saved.approved_photos).toHaveLength(1);expect(saved.status).toBe("unknown_acceptance");
  expect(posts).toBe(before+1);const delivered=sent.at(-1)!;expect(delivered.approvedPhotos).toEqual(saved.approved_photos);
  expect(delivered.approvedPhotos![0]).toMatchObject({itemId:selected.itemId,photoId:upload.value.id,senderMemberId:from,recipientMemberId:to});
  expect(JSON.stringify(saved.approved_photos)).not.toContain("https:");
  await expect(sql.begin(tx=>(service.runtimeFor("slop")!.adapter as CloudChannelAdapter).queue.enqueue(tx as unknown as SQL,[{id:`relay:${selected.itemId}`,memberId:to,to:recipient,kind:"transactional",text:delivered.text,oppId:matchId,city:"nyc",approvedPhotos:[{...saved.approved_photos[0],sha256:"a".repeat(64)}]}]))).rejects.toThrow("outbound id reused");
  expect((await sql`select approved_photos from platform.outbound where id=${`relay:${selected.itemId}`}`)[0]!.approved_photos).toEqual(saved.approved_photos);
  const review=(await service.photoRelay.item(selected.itemId))!.reviewId;
  await restart();expect((await service.photoRelay.item(selected.itemId))!.reviewId).toBe(review);
  known=true;await service.runtimeFor("slop")!.deliver();expect(posts).toBe(before+1);expect(photoResolves).toBe(1);
  expect((await sql`select status,approved_photos,fingerprint from platform.outbound where id=${`relay:${selected.itemId}`}`)[0]).toMatchObject({status:"accepted",approved_photos:saved.approved_photos,fingerprint:saved.fingerprint});
  // A second release reuses the original desk/queue id and does not approve or send again.
  expect((await release(selected.itemId)).status).toBe(200);expect(posts).toBe(before+1);expect(photoResolves).toBe(1);expect((await service.photoRelay.item(selected.itemId))!.reviewId).toBe(review);
  expect(await service.photoRelay.revoke("slop",person.id,selected.itemId)).toBe(true);
  expect((await service.publicFetch(new Request(capabilityUrls[0]!))).status).toBe(404);
  for(const refusal of ["reject","revoke"] as const){
  clock.advance(MINUTE);
  // Normal recipient engagement resets the real unanswered-send guard; the relay policy stays unchanged.
  expect((await post(TURN_PATH,{...turn(recipient,`photo-recipient-engaged-${refusal}`,"Sounds good, thanks"),app:"slop"})).status).toBe(200);
  const next=await service.photoRelay.select("slop",person.id,matchId,upload.value.id,"relay-fixture-v1",true,`fixture-select-next-${refusal}-20261016`);expect(next).toBeDefined();if(!next)throw Error("second selection refused");
  const rt=service.runtimeFor("slop")!,checks=((rt.adapter as CloudChannelAdapter).queue as unknown as {o:QueueOptions}).o.checks,original=checks.leaks!;
  let resume!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>{resume=r;}),atGate=new Promise<void>(r=>{entered=r;});
  checks.leaks=async row=>{const result=await original(row);if(row.id===`relay:${next.itemId}`){entered();await gate;}return result;};
  let pending:Promise<Response>|undefined;
  try{
    pending=release(next.itemId);await Promise.race([atGate,pending.then(async r=>{const failures=await sql`select type,payload from network.events where app_id='slop' and type in ('send_refused','send_skipped','guard_blocked') order by at desc limit 5`;throw Error(`Photo never reached final dispatch: ${await r.text()}; normal send diagnostics=${JSON.stringify(failures)}`);})]);
    if(refusal==="revoke")expect(await service.photoRelay.revoke("slop",person.id,next.itemId)).toBe(true);
    else expect((await fetch(new URL(`/relay/${next.itemId}/reject?app=slop`,server.url),{method:"POST",headers:{authorization:`Bearer ${staffToken}`,"content-type":"application/json"},body:JSON.stringify({note:"Reject this selected item before dispatch"})})).status).toBe(200);
    resume();expect((await pending).status).toBe(200);
    expect(posts).toBe(before+1);expect((await sql`select status from platform.outbound where id=${`relay:${next.itemId}`}`)[0]!.status).toMatch(/^suppressed/);
  }finally{resume?.();checks.leaks=original;if(pending)await pending;known=true;}
  }
},120_000);

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
    ["quote", "tell them I heard her say, \"I'm 16\""],
    ["school", "tell them homeroom starts soon"],
    ["eta", "tell them 15m from the bar"],
  ] satisfies [string, string][];
  for (const [suffix, phrase] of controls) {
    clock.advance(11 * MINUTE);
    const request = await open("relay-age-" + suffix, phrase, sender);
    expect((await post(RELAY_PATH, request)).status).toBe(200);
    expect((await service.accounts.personFor(sender))?.lowestAge).toBe(29);
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

test("a signed photo request respects the intended item and separately preserves approval", async () => {
  const sender = "+12125550229", recipient = "+12125550230";
  for (const [phone, name] of [[sender, "Nia"], [recipient, "Pat"]] as const) {
    for (const [index, text] of [
      "slop.date", name + ", 29", "I'm a woman into women. I live in Greenpoint and love climbing and live music",
      "I'm a woman looking for women, 25 to 35, within 5 miles of 11222", "A long-term relationship, no smokers",
      "Coffee or a walk for a first date. Weekend evenings work best.", "Yes, that's right.",
    ].entries()) {
      clock.advance(MINUTE);
      expect((await post(TURN_PATH, { ...turn(phone, `scoped-photo:${name}:${index}`, text), app: "slop" })).status).toBe(200);
    }
  }
  if (!photoPolicyEnabled) {
    photoPolicyEnabled = true;
    await restart();
  }
  const person = (await service.accounts.personFor(sender))!;
  const other = (await service.accounts.personFor(recipient))!;
  const from = (await service.people.getMembership(person.id, "slop"))!.memberId;
  const to = (await service.people.getMembership(other.id, "slop"))!.memberId;
  const match = "slop.scoped-relay-photo-pair";
  await fixturePair(false, "slop", [from, to], match);
  const jpeg = Uint8Array.from([255, 216, 255, 218, 0, 2, 1, 255, 217]);
  const upload = await service.photos.upload(person.id, "slop", jpeg, PHOTO_CONSENT.version);
  if (!upload.ok) throw new Error("Photo fixture upload failed");
  const selected = await service.photoRelay.select("slop", person.id, match, upload.value.id, "relay-fixture-v1", true, "fixture-scope-photo-selection");
  if (!selected) throw new Error("Photo fixture selection failed");
  expect(await service.photoRelay.review(selected.itemId, staffId, "safe")).toBe(true);
  expect(await service.photoRelay.item(selected.itemId)).toMatchObject({ state: "approved", actionId: null });

  const before = posts;
  const send = async (messageId: string, text: string) => {
    clock.advance(MINUTE / 6);
    const opened = await post(TURN_PATH, { ...turn(sender, messageId, text), app: "slop" });
    expect(opened.status).toBe(200);
    expect(await opened.json()).toMatchObject({ outcome: "open", memberId: from });
    const response = await post(RELAY_PATH, { channel: "blooio", messageId, app: "slop", memberId: from, itemId: null, text });
    expect(response.status).toBe(200);
    return response.json();
  };
  for (const [index, text] of [
    "Send him my photo. Don't send my number. Or this photo.",
    "Send him my photo. Actually, no.",
    "Send him my photo, hold on.",
    "Send him my photo. Hang on.",
    "Send him my photo. 🚫",
    "Send him my photo. Don't send my number. 🚫📸",
    "Send him my photo. On second thought.",
    "Send him my photo. Scratch that, I'll show him in person.",
    "Send him my photo. Scratch that, I'll show it to him in person.",
    "Send him my photo. Hold on, send him my number.",
    "Send him my photo. Hold on, send my photo to her.",
    "Send him my photo. Wait, send it, she said.",
    "Send him my photo. 🚫📸 I'll show him myself.",
    "Send him my photo, Ana said.",
    "Don't send it while my number is wrong. Send him my photo.",
    "Never send anything except my number. Send him my photo.",
    "Don't send any picture with my number in it. Send him my photo.",
    "Ana said, don't send it while my number is wrong. Send him my photo.",
    "Don't send him my photo. Send him my photo.",
    "Don't send him my number or my photo. Send him my photo.",
    "Don't send him my number, or this photo. Send him my photo.",
    "Don't send it. Send him my photo.",
    "I won't. Send him my photo.",
    "Don't send him my number. Send him my photo tomorrow.",
    "Don't send him my number. If you want to, send him my photo.",
    "Don't send him my number. Envíale mi foto.",
    "Don't send him my number. I'm not sure about showing the photo. Send him my photo.",
    "Don't send him my number. I am unsure whether to share my photo. Send him my photo.",
    "Don't send him my number. I have second thoughts about sharing it. Send him my photo.",
    "Don't send him my number. I'm not sure. Send him my photo.",
    "Don't send him my number. I'm not comfortable showing my photo. Send him my photo.",
    "Don't send him my number. I'm not certain. Send him my photo.",
  ].entries()) {
    expect(await send("scoped-photo-control-" + index, text), text).toMatchObject({ decision: "none", delivered: false });
    expect(await service.photoRelay.item(selected.itemId)).toMatchObject({ state: "approved", actionId: null });
    expect(await sql`select id from platform.outbound where id=${`relay:${selected.itemId}`}`).toHaveLength(0);
    expect(posts).toBe(before);
  }
  const pendingSwap = () => service.runtimeFor("slop")!.readState(net => net.exportState().relay?.swaps
    .find(swap => swap.matchId === match && swap.from === from));
  expect(await send("scoped-photo-number-pending", "Send him my number.")).toMatchObject({ decision: "hold", delivered: false });
  expect(await pendingSwap()).toBeDefined();
  clock.advance(MINUTE);
  expect((await post(TURN_PATH, { ...turn(recipient, "scoped-photo-recipient-ack", "I read the note. Thanks."), app: "slop" })).status).toBe(200);
  const beforeShare = posts;
  const text = "Don't send him my number. I am unsure what time it is. Please send him my photo. Hold on, send my photo.";
  const messageId = "scoped-photo-share";
  clock.advance(MINUTE / 6);
  const opened = await post(TURN_PATH, { ...turn(sender, messageId, text), app: "slop" });
  expect(opened.status).toBe(200);
  expect(await opened.json()).toMatchObject({ outcome: "open", memberId: from });
  expect(await pendingSwap()).toBeUndefined();
  const shared = await post(RELAY_PATH, { channel: "blooio", messageId, app: "slop", memberId: from, itemId: null, text });
  expect(shared.status).toBe(200);
  expect(await shared.json()).toMatchObject({ decision: "pass", delivered: true });
  expect(await service.photoRelay.item(selected.itemId)).toMatchObject({ state: "approved", actionId: "photo-selection:" + selected.itemId });
  expect(await sql`select status from platform.outbound where id=${`relay:${selected.itemId}`}`).toEqual([{ status: "accepted" }]);
  expect(posts).toBe(beforeShare + 1);
}, 120_000);
