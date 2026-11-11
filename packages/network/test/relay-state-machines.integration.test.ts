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
import type {QueueOptions} from "../../blooio/src/outbound-queue.ts";

const db=`network_relay_sm_${randomUUID().replaceAll("-","")}`,url=`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/${db}`;
const admin=new SQL({url:`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/postgres`,max:1});
const secret="synthetic-relay-state-machine-secret-20261108",clock=new SimClock(Date.UTC(2026,9,9,16));
const a="+12125550311",b="+12125550312";
let sql:SQL,service:NetworkService,server:ReturnType<typeof Bun.serve>,cloud:ReturnType<typeof Bun.serve>,ariId:string,samId:string;
const sent:Array<{id:string;text:string;kind:string;to:string}>=[];
/** What the classifier boundary answers next: hold flags (Clef categories). */
let clefFlags:string[]=[];
const logs:string[]=[];
/** Cloud refuses delivery (422 invalid, final) of the deliveries this predicate names. */
let cloudRefuses:(input:{id:string;text:string;to:string})=>boolean=()=>false;
const start=async()=>{
  service=new NetworkService({url,clock,photoStorage:null,env:{PLATFORM_ENV:"dev",CLEF_RATINGS:"off",SERVICE_TURN_SECRET:secret},
    networks:[{id:"friends:nyc",matchingEnabled:false}],log:line=>{logs.push(line);},
    relayClassifier:async()=>({flags:clefFlags,source:"clef" as const}),
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
/** Advance the clock to the next New York time h:m (minute steps). */
const toNyTime=(h:number,m:number)=>{for(let i=0;i<48*60;i++){const [hour,minute]=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hour:"numeric",minute:"numeric",hourCycle:"h23"}).format(clock.now()).split(":").map(Number);if(hour===h&&minute===m)return;clock.advance(MINUTE);}};

beforeAll(async()=>{
  await admin.unsafe(`create database ${db}`);await applySchema(url,{lockTimeout:"5s"});sql=new SQL({url,max:4});
  cloud=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async req=>{
    const path=new URL(req.url).pathname,raw=await req.text(),auth=await svcVerify(secret,{method:req.method,path,headers:req.headers,body:raw,nowS:Math.floor(clock.now()/1000)});
    expect(auth.ok).toBe(true);const input=JSON.parse(raw);
    if(path===DELIVER_PATH&&cloudRefuses(input))return Response.json({ok:false,error:"invalid",retryable:false},{status:422});
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
  // Ari asks at 20:58 (Sam is asked at once); Sam answers at 21:02, inside both members' quiet hours (21-9).
  await fixturePair("swap-withdraw");toNyTime(20,57);
  expect((await relay("withdraw-ask-ari","send Sam my number")).body).toMatchObject({decision:"hold"});
  toNyTime(21,1);
  expect((await relay("withdraw-ask-sam","send Ari my number",b)).body).toMatchObject({decision:"pass",delivered:false});
  // Both shares passed and wait in Network.deferred for the morning. Ari takes the number back.
  expect((await relay("withdraw-ari","actually don't send my number")).body).toMatchObject({decision:"none"});
  toNyHour(10);await service.runtimeFor("friends")!.tick();await service.runtimeFor("friends")!.deliver();
  expect(sent.filter(x=>x.text.includes(a))).toEqual([]);
  // The swap goes both ways or not at all: Sam's number does not go to Ari, who took the swap back.
  expect(sent.filter(x=>x.to===a&&x.text.includes(b))).toEqual([]);
  // The share reached final dispatch and was refused there, not merely left waiting.
  const [share]=await sql`select o.status from platform.outbound o join network.relay_records r on o.id='relay:'||r.item_id
    where r.kind='contact_share' and r.from_member=${ariId}`;
  expect(share?.status).toMatch(/^suppressed/);
},60_000);

test("relay-item: a text that Clef reads as a minor's is not kept for staff (SD-064)",async()=>{
  await fixturePair("clef-minor");toNyHour(12);
  clefFlags=["minor_signal"];
  try { expect((await relay("clef-minor-text","tell Sam my mom drives me to the park after class")).body).toMatchObject({decision:"hold"}); }
  finally { clefFlags=[]; }
  const held=await service.runtimeFor("friends")!.readState(n=>n.relayHeld());
  const item=held.find(h=>h.matchId==="clef-minor");
  expect(item?.reasons).toContain("clef:minor_signal");
  expect(item?.text).toBeUndefined();
  const [saved]=await sql`select state from network.network_state where id='friends:nyc'`;
  expect(JSON.stringify(saved.state)).not.toContain("drives me to the park");
},60_000);

test("relay-item: a held item that staff do not decide raises the review SLA alert (SD-133)",async()=>{
  await fixturePair("held-sla");toNyHour(12);
  clefFlags=["scam"];
  try { expect((await relay("held-sla-text","tell Sam I can send the tickets if they pay me first")).body).toMatchObject({decision:"hold"}); }
  finally { clefFlags=[]; }
  const held=(await service.runtimeFor("friends")!.readState(n=>n.relayHeld())).find(h=>h.matchId==="held-sla")!;
  expect(held.status).toBe("held");
  // The friends review SLA is 12 hours (observatory apps.ts DEFAULT_SLA_HOURS). Nobody decides the item.
  for(let i=0;i<13;i++){clock.advance(HOUR);await service.runtimeFor("friends")!.tick();}
  expect(logs.filter(l=>l.startsWith("[alert] review SLA friends:nyc")&&l.includes(held.itemId))).toHaveLength(1);
},60_000);

test("action-receipt: a delivery error after the unit committed does not answer a failure (SD-137)",async()=>{
  await fixturePair("post-commit");toNyHour(12);
  for(const [phone,id] of [[a,"post-commit-ari-reply"],[b,"post-commit-sam-reply"]] as const){clock.advance(MINUTE);expect((await post(TURN_PATH,turn(phone,id,"Sounds good, thanks"))).status).toBe(200);}
  const request=await open("post-commit-text","tell Sam I'm at the north gate");
  // The status write after delivery (runtime.ts storeStatuses) fails once the unit has committed.
  await sql.unsafe(`create function network.fail_status_fixture() returns trigger language plpgsql as $$ begin raise exception 'synthetic status write fault'; end $$`);
  await sql.unsafe(`create trigger fail_status_fixture before update of status on network.messages for each row when (NEW.id like 'relay:%') execute function network.fail_status_fixture()`);
  let r:Response;
  try { r=await post(RELAY_PATH,request); }
  finally { await sql.unsafe(`drop trigger fail_status_fixture on network.messages; drop function network.fail_status_fixture()`); }
  // The row, the relay log and the receipt committed, and the text went: the answer says so.
  expect(sent.some(x=>x.to===b&&x.text.includes("north gate"))).toBe(true);
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({decision:"pass",delivered:true,replayed:false});
},60_000);

test("relay-swap: a refused swap question does not leave the swap waiting (SD-138)",async()=>{
  await fixturePair("ask-refused");toNyHour(12);
  for(const [phone,id] of [[a,"ask-refused-ari-reply"],[b,"ask-refused-sam-reply"]] as const){clock.advance(MINUTE);expect((await post(TURN_PATH,turn(phone,id,"Sounds good, thanks"))).status).toBe(200);}
  // Three unanswered texts to Sam: the send path refuses a fourth logistics message (the conversation streak).
  for(const [i,text] of ["tell Sam I'm leaving now","tell Sam I'll be there in ten","tell Sam I found parking"].entries()){clock.advance(3*MINUTE);expect((await relay(`ask-refused-text-${i}`,text)).body).toMatchObject({decision:"pass"});}
  const before=sent.length;clock.advance(3*MINUTE);
  const out=(await relay("ask-refused-share","send Sam my number")).body;
  expect(sent.slice(before).filter(x=>/would like to swap numbers/.test(x.text))).toHaveLength(0);
  // Sam was never asked: Ari is not told that the number goes when Sam says so, and no swap waits.
  expect(out.decision).not.toBe("hold");
  const swaps=await service.runtimeFor("friends")!.readState(n=>n.exportState().relay?.swaps??[]);
  expect(swaps.filter(x=>x.matchId==="ask-refused")).toHaveLength(0);
},60_000);

test("relay-swap: a swap question that waits past the swap window is never sent (SD-138)",async()=>{
  await fixturePair("ask-late");toNyHour(22);
  for(const [phone,id] of [[a,"ask-late-ari-reply"],[b,"ask-late-sam-reply"]] as const){clock.advance(MINUTE);expect((await post(TURN_PATH,turn(phone,id,"Sounds good, thanks"))).status).toBe(200);}
  const before=sent.length;
  await relay("ask-late-share","send Sam my number");
  // Sam's quiet hours: the question waits. In the morning the 15-minute swap window has long closed.
  toNyHour(10);await service.runtimeFor("friends")!.tick();await service.runtimeFor("friends")!.deliver();
  expect(sent.slice(before).filter(x=>/would like to swap numbers/.test(x.text))).toHaveLength(0);
},60_000);

test("relay-swap: a swap question held in the outbound queue past the swap window is never sent (SD-138)",async()=>{
  await fixturePair("ask-queued");toNyHour(12);
  for(const [phone,id] of [[a,"ask-queued-ari-reply"],[b,"ask-queued-sam-reply"]] as const){clock.advance(MINUTE);expect((await post(TURN_PATH,turn(phone,id,"Sounds good, thanks"))).status).toBe(200);}
  // Hold the question's dispatch after its asynchronous checks, before the final admission.
  const checks=((service.runtimeFor("friends")!.adapter as CloudChannelAdapter).queue as unknown as {o:QueueOptions}).o.checks,original=checks.leaks!;
  let resume!:()=>void,arrive!:()=>void;
  const gate=new Promise<void>(r=>{resume=r;}),atGate=new Promise<void>(r=>{arrive=r;});
  checks.leaks=async row=>{const result=await original(row);if(row.id.endsWith(":ask")){arrive();await gate;}return result;};
  const before=sent.length;
  try {
    const pending=post(RELAY_PATH,await open("ask-queued-share","send Sam my number"));
    await atGate;clock.advance(20*MINUTE);resume();
    expect((await (await pending).json() as any).decision).toBe("hold");
  } finally { resume();checks.leaks=original; }
  expect(sent.slice(before).filter(x=>/would like to swap numbers/.test(x.text))).toHaveLength(0);
},60_000);

test("relay-swap: a number share that the provider refused does not count as shared (SD-252)",async()=>{
  await fixturePair("share-refused");toNyHour(12);
  for(const [phone,id] of [[a,"share-refused-ari-reply"],[b,"share-refused-sam-reply"]] as const){clock.advance(MINUTE);expect((await post(TURN_PATH,turn(phone,id,"Sounds good, thanks"))).status).toBe(200);}
  expect((await relay("share-refused-ari","send Sam my number")).body).toMatchObject({decision:"hold"});
  // Cloud refuses the row that carries Ari's number to Sam: the row ends failed, and Sam never gets the number.
  cloudRefuses=x=>x.to===b&&x.text.includes(a);
  try { await relay("share-refused-sam","send Ari my number",b); }
  finally { cloudRefuses=()=>false; }
  expect(sent.some(x=>x.to===b&&x.text.includes(a))).toBe(false);
  const [row]=await sql`select o.status from platform.outbound o join network.relay_records r on o.id='relay:'||r.item_id
    where r.opportunity_id='share-refused' and r.from_member=${ariId} and r.kind='contact_share'`;
  expect(row?.status).toMatch(/^failed/);
  // Ari asks again (after the 10-minute duplicate window): the failed share does not block a new swap.
  clock.advance(11*MINUTE);
  expect((await relay("share-refused-ari-again","send Sam my number")).body).toMatchObject({decision:"hold"});
  const log=await service.runtimeFor("friends")!.readState(n=>n.relayLog());
  expect(log.filter(r=>r.opportunityId==="share-refused"&&r.from===ariId&&r.contactShared)).toEqual([]);
},60_000);

test("relay-item: the relay thread keeps only wording that went to the other member (Q-relay-1)",async()=>{
  await fixturePair("thread-unsent");toNyHour(12);
  for(const [phone,id] of [[a,"thread-unsent-ari-reply"],[b,"thread-unsent-sam-reply"]] as const){clock.advance(MINUTE);expect((await post(TURN_PATH,turn(phone,id,"Sounds good, thanks"))).status).toBe(200);}
  cloudRefuses=x=>x.to===b&&x.text.includes("blue umbrella");
  try { await relay("thread-unsent-1","tell Sam I have a blue umbrella"); }
  finally { cloudRefuses=()=>false; }
  expect(sent.some(x=>x.text.includes("blue umbrella"))).toBe(false);
  clock.advance(3*MINUTE);
  expect((await relay("thread-unsent-2","tell Sam I am by the fountain")).body).toMatchObject({decision:"pass"});
  const threads=await service.runtimeFor("friends")!.readState(n=>n.exportState().relay?.threads??[]);
  const words=JSON.stringify(threads.find(t=>t.id==="thread-unsent")?.messages??[]);
  expect(words).toContain("fountain");
  expect(words).not.toContain("blue umbrella");
},60_000);

test("relay-swap: a deferred number share that the morning send refuses does not count as shared (SD-252)",async()=>{
  // Ari asks at 20:57; Sam answers at 21:01, inside both members' quiet hours (21-9): both shares wait.
  await fixturePair("share-deferred");toNyTime(20,57);
  expect((await relay("share-deferred-ari","send Sam my number")).body).toMatchObject({decision:"hold"});
  toNyTime(21,1);
  expect((await relay("share-deferred-sam","send Ari my number",b)).body).toMatchObject({decision:"pass",delivered:false});
  // Ari sends STOP before the morning: the morning send of Sam's number to Ari is refused. Ari then texts START.
  clock.advance(MINUTE);expect((await post(TURN_PATH,turn(a,"share-deferred-stop","STOP"))).status).toBe(200);
  const before=sent.length;
  toNyHour(10);await service.runtimeFor("friends")!.tick();await service.runtimeFor("friends")!.deliver();
  expect(sent.slice(before).some(x=>x.to===a&&x.text.includes(b))).toBe(false);
  // The waiting pair goes or stops together (swapFlush): Ari's number does not go to Sam one way.
  expect(sent.slice(before).some(x=>x.to===b&&x.text.includes(a))).toBe(false);
  clock.advance(MINUTE);expect((await post(TURN_PATH,turn(a,"share-deferred-start","START"))).status).toBe(200);
  const log=await service.runtimeFor("friends")!.readState(n=>n.relayLog());
  expect(log.filter(r=>r.opportunityId==="share-deferred"&&r.from===samId&&r.contactShared)).toEqual([]);
},60_000);

test("relay-item: staff reject a held item after the relay log reached its cap (SD-387)",async()=>{
  await fixturePair("log-cap");toNyHour(12);
  clefFlags=["scam"];
  try { expect((await relay("log-cap-held","tell Sam I can sell the tickets if they pay me first")).body).toMatchObject({decision:"hold"}); }
  finally { clefFlags=[]; }
  const rt=service.runtimeFor("friends")!;
  const held=(await rt.readState(n=>n.relayHeld())).find(h=>h.matchId==="log-cap")!;
  // 5000 newer log rows of another match (a busy app), then one more relayed text: the log reaches its cap.
  await rt.unitOfWork(n=>{const state=n.exportState(),relay=state.relay!;
    for(let i=0;i<5000;i++)relay.log.push({itemId:`log-cap-filler-${i}`,opportunityId:"log-cap-filler",app:"friends",kind:"text",from:samId,to:ariId,at:clock.now(),decision:"pass",reasons:[],photoCount:0,contactShared:false,ageSignal:false,policy:"relay-1.0.0"});
    n.importState(state);});
  for(const [phone,id] of [[a,"log-cap-ari-reply"],[b,"log-cap-sam-reply"]] as const){clock.advance(MINUTE);expect((await post(TURN_PATH,turn(phone,id,"Sounds good, thanks"))).status).toBe(200);}
  expect((await relay("log-cap-next","tell Sam I am at the gate")).body).toMatchObject({decision:"pass"});
  expect(await rt.unitOfWork(n=>n.rejectRelay(held.itemId,"staff:fixture"))).toMatchObject({ok:true});
  const [row]=await sql`select review,reasons from network.relay_records where app_id='friends' and item_id=${held.itemId}`;
  expect(row?.review).toBe("rejected");
},120_000);

// Keep this case last: Ari deletes everything.
test("relay-item: erasure removes the member's number and words from the rows of the other member (SD-040)",async()=>{
  await fixturePair("swap-erase");toNyHour(12);
  for(const [phone,id] of [[a,"erase-ari-reply"],[b,"erase-sam-reply"]] as const){clock.advance(MINUTE);expect((await post(TURN_PATH,turn(phone,id,"Sounds good, thanks"))).status).toBe(200);}
  expect((await relay("erase-ask-ari","send Sam my number")).body).toMatchObject({decision:"hold"});
  expect((await relay("erase-ask-sam","send Ari my number",b)).body).toMatchObject({decision:"pass",delivered:true});
  expect(sent.some(x=>x.to===b&&x.text.includes(a))).toBe(true);
  expect((await relay("erase-text-ari","tell Sam I will bring the trail map")).body).toMatchObject({decision:"pass"});
  const who=(await service.accounts.personFor(a))!;
  await service.accounts.leave(service.apps.friends,{e164:a,personId:who.id});
  expect((await sql`select id,body from network.messages where app_id='friends' and member_id=${samId} and position(${a} in body)>0`).length).toBe(0);
  expect((await sql`select id from platform.outbound where app_id='friends' and member_id=${samId} and position(${a} in coalesce(body,''))>0`).length).toBe(0);
  expect((await sql`select id from network.messages where app_id='friends' and member_id=${samId} and position('trail map' in body)>0`).length).toBe(0);
  expect((await sql`select id from platform.outbound where app_id='friends' and member_id=${samId} and position('trail map' in coalesce(body,''))>0`).length).toBe(0);
},60_000);
