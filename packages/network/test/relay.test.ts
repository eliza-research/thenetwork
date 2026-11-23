import { serveHttp, type HttpServer } from "../../core/src/runtime/http.ts";
import {afterAll,beforeAll,expect,test} from "vitest";
import {randomUUID} from "node:crypto";
import {SQL} from "../../core/src/runtime/postgres.ts";
import {SimClock,MINUTE,DAY} from "@thenetwork/core";
import {applySchema} from "../../observatory/db/dev-pg.ts";
import {svcSign} from "../../core/src/svc/svc-auth.ts";
import {TURN_PATH,RELAY_PATH,type RelaySendRequest,type TurnRequest} from "../../core/src/svc/contract.ts";
import {DryRunAdapter} from "../service/channel.ts";
import {NetworkService} from "../service/service.ts";
import {simulatedRelayClassifier} from "../../engine/src/relay.ts";
import {ServiceClient} from "../../observatory/src/sources/service.ts";
import type {NetworkState} from "../src/network.ts";

const db=`network_relay_${randomUUID().replaceAll("-","")}`;
const admin=new SQL({url:`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/postgres`,max:1});
const url=`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/${db}`;
const secret="synthetic-relay-fixture-secret-20261009",clock=new SimClock(Date.UTC(2026,9,9,16));
const phones={ari:"+12125550181",bo:"+12125550182"};
const logs:string[]=[];
let sql:SQL,service:NetworkService,server:HttpServer,ari:string,bo:string;
const start=async()=>{
  service=new NetworkService({url,clock,photoStorage:null,instance:"relay-integration",tokens:"safety:saf-tok,reviewer:rev-tok",
    env:{PLATFORM_ENV:"dev",SERVICE_TURN_SECRET:secret},relayClassifier:simulatedRelayClassifier,
    networks:[{id:"friends:nyc",matchingEnabled:false}],network:{seed:1},log:line=>{logs.push(line);},adapter:()=>new DryRunAdapter(()=>{})});
  await service.start();server=await serveHttp({hostname:"127.0.0.1",port:0,fetch:req=>service.fetch(req)});
};
const signed=async(path:string,id:string,raw:string)=>fetch(new URL(path,server.url),{method:"POST",body:raw,
  headers:{"content-type":"application/json",...await svcSign(secret,{method:"POST",path,id,body:raw,nowS:Math.floor(clock.now()/1000)})}});
const turn=(from:string,messageId:string,text:string):TurnRequest=>({messageId,channel:"blooio",from,to:null,text,transport:"imessage",receivedAt:clock.now(),app:"friends"});
const open=async(from:string,messageId:string,text="Tell me something about the weather")=>{
  clock.advance(MINUTE);
  const r=await signed(TURN_PATH,messageId,JSON.stringify(turn(from,messageId,text)));expect(r.status).toBe(200);
  const body=await r.json() as any;expect(body.outcome).toBe("open");return body.memberId as string;
};
/** One open turn whose own message is the relay request, and Cloud's RelaySendRequest for it. */
const ask=async(who:"ari"|"bo",messageId:string,text:string):Promise<RelaySendRequest>=>{
  const memberId=await open(phones[who],messageId,text);return {channel:"blooio",messageId,app:"friends",memberId,itemId:null,text};
};
const post=async(body:RelaySendRequest)=>signed(RELAY_PATH,`${body.messageId}:relay`,JSON.stringify(body));
const staff=(path:string,token:string,method="GET",b?:object)=>service.fetch(new Request(`http://127.0.0.1${path}`,{method,headers:{authorization:`Bearer ${token}`,...(b?{"content-type":"application/json"}:{})},...(b?{body:JSON.stringify(b)}:{})}));

beforeAll(async()=>{
  await admin.unsafe(`create database ${db}`);await applySchema(url,{lockTimeout:"5s"});sql=new SQL({url,max:4});await start();
  for(const [who,name] of [["ari","Ari, 29"],["bo","Bo, 31"]] as const)for(const [index,text] of ["friends.help",name,"I enjoy hiking and cooking","Saturday afternoons work for me","Small groups are good"].entries()){
    clock.advance(MINUTE);expect((await signed(TURN_PATH,`${who}-setup-${index}`,JSON.stringify(turn(phones[who],`${who}-setup-${index}`,text)))).status).toBe(200);
  }
  ari=await open(phones.ari,"ari-open");bo=await open(phones.bo,"bo-open");
  // A plan both said yes to (the matching path itself is covered elsewhere): the relay opens on it.
  const now=clock.now();
  await service.runtimeFor("friends")!.unitOfWork(net=>{
    const st=net.exportState();
    st.opps.push({id:"relay-op",origin:"engine",kind:"intro",category:"hobby",objective:"a hike",detail:"",participants:[ari,bo],alternates:[],primed:[],
      status:[[ari,"yes"],[bo,"yes"]],explanations:{},stage:"scheduled",deadline:now+DAY,createdAt:now,score:0.5,
      components:{fit:0,mutualBenefit:0,warmPath:0,novelty:0,timingFit:0,activationCost:0,interruptionCost:0,load:0,repetition:0,socialRisk:0,confidence:0},
      generator:"fixture",exploration:false,sameDay:false,contacted:[ari,bo],reminded:[],tags:[],replacements:0,feedbackFrom:[],meetingAt:now+DAY} as any);
    net.importState(st);
  });
},120_000);
afterAll(async()=>{await server?.stop(true);await service?.close();await sql?.close();await admin.unsafe(`drop database if exists ${db} with (force)`);await admin.close();});

test("a relayed text is signed, size-checked, bound to the open turn, idempotent, and only the engine wording goes out",async()=>{
  expect(logs.filter(l=>l.startsWith("relay classifier:"))).toEqual([]);
  const ok=await ask("ari","relay-1","tell Bo running 10 min late, see you at the trailhead");
  expect((await post({...ok,memberId:bo})).status).toBe(403);
  expect((await signed(RELAY_PATH,"relay-1",JSON.stringify(ok))).status).toBe(400);
  expect((await signed(RELAY_PATH,"other-key",JSON.stringify(ok))).status).toBe(400);
  expect((await post({...ok,messageId:"ari-setup-0"})).status).toBe(403);
  expect((await post({...ok,text:"tell Bo something the model invented"})).status).toBe(403);
  const [offered]=await sql`select response from platform.inbound where id='msg:blooio:relay-1'`;
  expect(offered.response.context.activeItems).toEqual([{id:"relay-op",kind:"match",summary:"Match with Bo"}]);
  expect((await post({...ok,itemId:"relay-op-not-offered"})).status).toBe(403);
  const fixtureOpps=async(edit:(opps:any[])=>any[])=>service.runtimeFor("friends")!.unitOfWork(net=>{const st=net.exportState();st.opps=edit(st.opps as any[]) as any;net.importState(st);});
  await fixtureOpps(opps=>[...opps,{...opps.find(o=>o.id==="relay-op"),id:"relay-op-2",objective:"a picnic",createdAt:clock.now()}]);
  expect((await service.runtimeFor("friends")!.readState(n=>n.relayLiveMatches(ari as any).map(x=>x.match.id))).sort()).toEqual(["relay-op","relay-op-2"]);
  expect((await post({...ok,itemId:"relay-op-2"})).status).toBe(403);
  await fixtureOpps(opps=>opps.filter(o=>o.id!=="relay-op-2"));
  expect((await post({...ok,allow:["+12125550100"]} as RelaySendRequest)).status).toBe(400);
  expect((await post({...ok,text:"x".repeat(20_000)})).status).toBe(413);
  const unsigned=await fetch(new URL(RELAY_PATH,server.url),{method:"POST",body:JSON.stringify(ok),headers:{"content-type":"application/json"}});expect(unsigned.status).toBe(401);
  const first=await post(ok);expect(first.status).toBe(200);
  // A dry run accepts nothing at a provider: passed, never reported as delivered.
  const passed=await first.json() as any;
  expect(passed).toMatchObject({decision:"pass",delivered:false,replayed:false});expect(passed.senderNotice).not.toBe("Sent.");
  expect(await (await post(ok)).json()).toEqual({...passed,replayed:true});
  const rows=await sql`select id,member_id,body,type from network.messages where app_id='friends' and id like 'relay:%'`;
  expect(rows.map((r:any)=>[r.member_id,r.body,r.type])).toEqual([[bo,'Ari says: "running 10 min late, see you at the trailhead"',"relay"]]);
  const records=await sql`select * from network.relay_records where app_id='friends'`;
  expect(records).toHaveLength(1);expect(records[0]).toMatchObject({from_member:ari,to_member:bo,decision:"pass",kind:"text"});
  expect(JSON.stringify(records)).not.toContain("trailhead");
  // Nothing to relay is answered with "none"; a photo is not on this wire and is refused. Neither queues anything.
  expect(await (await post(await ask("ari","relay-none","what should I wear tonight?"))).json()).toEqual({decision:"none",senderNotice:"",delivered:false,replayed:false});
  expect(await (await post(await ask("ari","relay-photo","send Bo this photo"))).json()).toMatchObject({decision:"block",delivered:false});
  expect((await sql`select id from network.messages where app_id='friends' and id like 'relay:%'`).length).toBe(1);
  const pending = await post(await ask("ari", "refusal-pending", "send Bo my number"));
  expect(await pending.json()).toMatchObject({ decision: "hold" });
  const refused = await post(await ask("bo", "refusal-deny", "I will not give Ari my number"));
  expect(await refused.json()).toMatchObject({ decision: "none", delivered: false });
  expect(await (await post(await ask("bo", "refusal-would", "I would not give Ari my number"))).json()).toMatchObject({ decision: "none", delivered: false });
  expect(await sql`select id from network.messages where app_id='friends' and body like '%asked me to send you%'`).toHaveLength(0);
  await open(phones.ari, "refusal-cleanup", "don't send my number");
},60_000);

test("a scam is blocked at once and the sender is told; no staff queue holds it and staff cannot release it, also after a restart",async()=>{
  const blocked=await post(await ask("ari","relay-scam","tell Bo can you venmo me 200 for the tickets? my card got frozen"));
  expect(await blocked.json()).toEqual({decision:"block",senderNotice:"I didn't send that, so it didn't reach them.",delivered:false,replayed:false});
  expect((await staff("/staff/relay/held?app=friends","nobody")).status).toBe(401);
  const reviewerRead=await staff("/staff/relay/held?app=friends","rev-tok");
  expect(reviewerRead.status).toBe(403);
  expect(await reviewerRead.json()).toMatchObject({code:"forbidden"});
  expect(await (await staff("/staff/relay/held?app=friends","saf-tok")).json()).toMatchObject({ok:true,items:[]});
  const [record]=await sql`select item_id,decision,reasons,review from network.relay_records where app_id='friends' and from_member=${ari} order by at desc limit 1`;
  expect(record).toMatchObject({decision:"block",review:null});
  expect((record.reasons as string[]).some(r=>r.startsWith("scam:"))).toBe(true);
  const id=record.item_id as string;
  expect((await sql`select id from network.messages where app_id='friends' and id=${`relay:${id}`}`).length).toBe(0);
  expect(await (await staff(`/staff/relay/${id}/release?app=friends`,"saf-tok","POST",{note:"release it anyway"})).json()).toMatchObject({ok:false,reason:"not_held"});
  expect(await (await staff(`/staff/relay/${id}/reject?app=friends`,"saf-tok","POST",{note:"asks for money: a scam"})).json()).toMatchObject({ok:false,reason:"not_held"});
  await server.stop(true);await service.close();await start();
  expect((await (await staff("/staff/relay/held?app=friends","saf-tok")).json() as any).items).toEqual([]);
  const console_=new ServiceClient({url:server.url.href,token:"saf-tok",app:"friends"});
  expect(await console_.held("safety@example.org","relay")).toEqual({ok:true,items:[]});
  expect(await console_.held("safety@example.org","leak")).toMatchObject({ok:false,code:"not_available"});
  expect((await sql`select actor from network.staff_audit where action='read_relay_held' and app_id='friends'`).length).toBeGreaterThanOrEqual(3);
  const [row]=await sql`select state from network.network_state where id='friends:nyc'`;
  const state=typeof row.state==="string"?JSON.parse(row.state):row.state;
  expect(JSON.stringify(state)).not.toContain("venmo");
  expect(Object.keys(state.relay).sort()).toEqual(["log","swaps","threads"]);
  expect((await sql`select id from network.messages where app_id='friends' and direction='outbound' and body like '%venmo%'`).length).toBe(0);
},60_000);

test("a swap request lasts only as long as the engine's consent (15 min, never backdated) and a member can take it back",async()=>{
  const numbers=async()=>(await sql`select id from network.messages where app_id='friends' and (body like ${"%"+phones.ari.slice(2)+"%"} or body like ${"%"+phones.bo.slice(2)+"%"})`).length;
  clock.advance(10*MINUTE);
  expect(await (await post(await ask("ari","ttl-ari","send Bo my number"))).json()).toMatchObject({decision:"hold"});
  // 16 minutes later Bo asks: Ari's consent is stale, so nothing is shared; Bo's request now waits for Ari instead.
  clock.advance(16*MINUTE);
  expect(await (await post(await ask("bo","ttl-bo","send Ari my number"))).json()).toMatchObject({decision:"hold"});
  expect(await numbers()).toBe(0);
  clock.advance(MINUTE);
  expect((await signed(TURN_PATH,"bo-withdraw",JSON.stringify(turn(phones.bo,"bo-withdraw","actually please don't send it")))).status).toBe(200);
  expect(await (await post(await ask("ari","ttl-ari-2","send Bo my number"))).json()).toMatchObject({decision:"hold"});
  expect(await numbers()).toBe(0);
  // Ari takes theirs back through the relay action ("don't send my number" is nothing to relay, and confirmed).
  expect(await (await post(await ask("ari","ttl-ari-cancel","actually don't send my number"))).json()).toEqual({decision:"none",senderNotice:"Okay, I won't share your number.",delivered:false,replayed:false});
  clock.advance(10*MINUTE);
  expect(await (await post(await ask("bo","ttl-bo-2","send Ari my number"))).json()).toMatchObject({decision:"hold"});
  expect(await (await post(await ask("bo","ttl-bo-refuse","don't delay, my number is off limits"))).json()).toEqual({decision:"none",senderNotice:"Okay, I won't share your number.",delivered:false,replayed:false});
  expect(await numbers()).toBe(0);
  // Clean slate for the next test: Bo's request is withdrawn too.
  expect(await (await post(await ask("bo","ttl-bo-cancel","never mind, don't send my number"))).json()).toMatchObject({decision:"none"});
},60_000);

test("a number goes out only after both members asked for the swap",async()=>{
  clock.advance(10*MINUTE);
  const first=await post(await ask("ari","swap-ari","send Bo my number"));
  expect(await first.json()).toMatchObject({decision:"hold",delivered:false});
  expect((await sql`select id from network.messages where app_id='friends' and body like ${"%"+phones.ari.slice(2)+"%"}`).length).toBe(0);
  await open(phones.ari, "swap-go-ahead", "Don't hesitate, send my number");
  const second=await post(await ask("bo","swap-bo","send Ari my number"));
  expect(await second.json()).toMatchObject({decision:"pass",delivered:false});
  const shares=await sql<{ member_id: string; body: string }[]>`select member_id,body from network.messages where app_id='friends' and id like 'relay:%' and body like '%asked me to send you%' order by member_id`;
  expect(shares.map(r=>r.member_id).sort()).toEqual([ari,bo].sort());
  expect(shares.find(r=>r.member_id===bo)?.body).toContain(phones.ari);
  expect(shares.find(r=>r.member_id===ari)?.body).toContain(phones.bo);
  expect(JSON.stringify(await sql`select * from network.relay_records where app_id='friends'`)).not.toContain(phones.ari.slice(2));
  // The relay thread (stored state, and the classifier's context) keeps that a number was shared, never the number.
  const [{state}]=await sql`select state from network.network_state where id='friends:nyc'`;
  const threads=JSON.stringify((typeof state==="string"?JSON.parse(state):state).relay.threads);
  expect(threads).toContain("shared their number.");
  for(const p of Object.values(phones))expect(threads).not.toContain(p.slice(2));
  // Relay rows carry their network (migration 0031).
  expect((await sql`select distinct network_id from network.relay_records where app_id='friends'`).map((r:any)=>r.network_id)).toEqual(["friends:nyc"]);
},60_000);

test("the thread persists after the date: a text 9 days after the meeting is still relayed (founder decision P7, #22)",async()=>{
  // The fixture's meeting was one day after setup; the numbers were already swapped above, and the thread keeps working.
  clock.advance(10*DAY);
  const late=await post(await ask("ari","relay-late","tell Bo thanks again for the hike, want to go again next weekend?"));
  expect(late.status).toBe(200);
  expect(await late.json()).toMatchObject({decision:"pass",delivered:false});
  const rows=await sql`select body from network.messages where app_id='friends' and id like 'relay:%' and member_id=${bo} order by ts desc limit 1`;
  expect(rows[0]?.body).toContain("want to go again next weekend");
},60_000);

const sharesQueued = async () => (await sql`select id from network.messages where app_id='friends'
  and direction='outbound' and body like '%asked me to send you%'`).length;
const pendingNumberSwaps = () => service.runtimeFor("friends")!.unitOfWork(net => net.exportState().relay?.swaps ?? []);
let swapMatchTemplate: NetworkState["opps"][number] | undefined;

async function startNumberSwap(id: string, who: "ari" | "bo") {
  await service.runtimeFor("friends")!.unitOfWork(net => {
    const state = net.exportState();
    swapMatchTemplate ??= state.opps.find(opp => opp.id === "relay-op")!;
    clock.advance(DAY);
    const now = clock.now();
    state.opps = [{ ...swapMatchTemplate, id, createdAt: now, meetingAt: now + DAY, deadline: now + DAY }];
    if (state.relay) state.relay.swaps = [];
    net.importState(state);
  });
  const recipient = who === "ari" ? "Bo" : "Ari";
  expect(await (await post(await ask(who, id + "-first", "send " + recipient + " my number"))).json())
    .toMatchObject({ decision: "hold", delivered: false });
}

test.each([
  "I would not give Ari my number",
  "I could not give Ari my number",
  "I did not give Ari my number",
  "I mustn't give Ari my number",
  "I'll not give Ari my number",
  "My number is off limits, send Ari my number",
  "I can't believe it, “send Ari my number”",
  "I would not send Ari my number. I can still make Saturday.",
])("the relay does not send a private item after %s", async (text) => {
  const id = "refused-share-" + randomUUID();
  const before = await sharesQueued();
  await startNumberSwap(id, "ari");
  const action = await (await post(await ask("bo", id + "-refusal", text))).json();
  expect({ action, newShares: await sharesQueued() - before })
    .toMatchObject({ action: { decision: "none", delivered: false }, newShares: 0 });
}, 60_000);

test.each([
  "No need to hesitate, I refuse to share my number",
  "Don't hesitate, I decline the number swap",
  "Don't delay, my number stays private",
  "Don't delay, my number is off limits",
  "Don't delay, tell them they can't have my number",
  "No need to wait for my number, I won't share it",
  "Don't send it to them",
  "Don't send it please",
  "Please don't send it to them yet",
])("the signed turn withdraws a pending swap after %s", async (text) => {
  const id = "withdrawn-swap-" + randomUUID();
  const before = await sharesQueued();
  await startNumberSwap(id, "bo");
  await open(phones.bo, id + "-refusal", text);
  const pending = (await pendingNumberSwaps()).filter(swap => swap.matchId === id).length;
  const action = await (await post(await ask("ari", id + "-second", "send Bo my number"))).json();
  expect({ pending, action, newShares: await sharesQueued() - before })
    .toMatchObject({ pending: 0, action: { decision: "hold", delivered: false }, newShares: 0 });
}, 60_000);

test.each([
  "I won't lie, send Ari my number",
  "I can't believe it, send Ari my number",
  "I can't find my phone, but send Ari my number",
  "I can't get my phone, but send Ari my number",
  "I would not miss it, send Ari my number",
  "I could not find parking, send Ari my number",
  "I did not miss your message, send Ari my number",
  "I mustn't be late, send Ari my number",
  "I'll not lie, send Ari my number",
  "Ari said “I would not send them my number.” Send Ari my number.",
  "Ari said 'I won't send them my number.' Send Ari my number.",
  "I would not send that calendar invite, but send Ari my number.",
])("the signed action preserves the same pending request after %s", async (text) => {
  const id = "affirmed-swap-" + randomUUID();
  const before = await sharesQueued();
  await startNumberSwap(id, "bo");
  const original = (await pendingNumberSwaps()).find(swap => swap.matchId === id);
  expect(original).toBeDefined();
  const affirmation = await ask("bo", id + "-go-ahead", text);
  expect((await pendingNumberSwaps()).find(swap => swap.matchId === id)).toEqual(original);
  expect(await (await post(affirmation)).json()).toMatchObject({ decision: "hold", delivered: false });
  expect((await pendingNumberSwaps()).find(swap => swap.matchId === id)).toEqual(original);
  expect(await (await post(await ask("ari", id + "-second", "send Bo my number"))).json())
    .toMatchObject({ decision: "pass", delivered: false });
  expect(await sharesQueued()).toBe(before + 2);
}, 60_000);

test.each(["Ari said “Don't send my number.”", "Ari said ‘don't send it please’."])(
  "a quoted refusal keeps the pending number swap after %s", async (text) => {
    const id = "quoted-swap-" + randomUUID();
    const before = await sharesQueued();
    await startNumberSwap(id, "bo");
    const original = (await pendingNumberSwaps()).find(swap => swap.matchId === id);
    expect(original).toBeDefined();
    const report = await ask("bo", id + "-quotation", text);
    expect(await (await post(report)).json()).toMatchObject({ decision: "none", senderNotice: "" });
    expect((await pendingNumberSwaps()).find(swap => swap.matchId === id)).toEqual(original);
    expect(await (await post(await ask("ari", id + "-second", "send Bo my number"))).json())
      .toMatchObject({ decision: "pass", delivered: false });
    expect(await sharesQueued()).toBe(before + 2);
  }, 60_000,
);
test("a swap question that cannot go to the other person now is not recorded, and the asker is told it did not go (SD-138)", async () => {
  const id = "quiet-swap-" + randomUUID();
  const swapQuestions = async () => (await sql`select id from network.messages where app_id='friends' and member_id=${bo} and body like '%would like to swap numbers%'`).length;
  await service.runtimeFor("friends")!.unitOfWork(net => {
    const state = net.exportState();
    clock.advance(DAY - ((clock.now() - Date.UTC(2026, 0, 1, 7)) % DAY));
    const now = clock.now();
    state.opps = [{ ...swapMatchTemplate!, id, createdAt: now, meetingAt: now + DAY, deadline: now + DAY }];
    if (state.relay) state.relay.swaps = [];
    net.importState(state);
  });
  const before = await swapQuestions();
  expect(await (await post(await ask("ari", id + "-night", "send Bo my number"))).json())
    .toMatchObject({ decision: "block", senderNotice: "I can't swap numbers right now.", delivered: false });
  expect((await pendingNumberSwaps()).filter(swap => swap.matchId === id)).toEqual([]);
  expect(await swapQuestions()).toBe(before);
  clock.advance(9 * 60 * MINUTE);
  expect(await (await post(await ask("ari", id + "-day", "send Bo my number"))).json())
    .toMatchObject({ decision: "hold", senderNotice: "I'll share your number as soon as they say they want to swap numbers too.", delivered: false });
  expect((await pendingNumberSwaps()).filter(swap => swap.matchId === id)).toHaveLength(1);
  expect(await swapQuestions()).toBe(before + 1);
}, 60_000);
test("a swap asked again less than 10 minutes after the same question went to the other person does not wait, and one asked 10 minutes after it does", async () => {
  const id = "reask-swap-" + randomUUID();
  const swapQuestions = async () => (await sql`select id from network.messages where app_id='friends' and member_id=${bo} and body like '%would like to swap numbers%'`).length;
  await service.runtimeFor("friends")!.unitOfWork(net => {
    const state = net.exportState();
    clock.advance(DAY - ((clock.now() - Date.UTC(2026, 0, 1, 7)) % DAY) + 9 * 60 * MINUTE);
    const now = clock.now();
    state.opps = [{ ...swapMatchTemplate!, id, createdAt: now, meetingAt: now + DAY, deadline: now + DAY }];
    state.members = state.members.map(member => member.id === bo ? { ...member, outbound: 0, unsol: {}, unsolStreak: 0, lastOutUnsol: false } : member);
    if (state.relay) state.relay.swaps = [];
    net.importState(state);
  });
  const before = await swapQuestions();
  expect(await (await post(await ask("ari", id + "-1", "send Bo my number"))).json()).toMatchObject({ decision: "hold" });
  const askedAt = clock.now();
  expect(await swapQuestions()).toBe(before + 1);
  expect(await (await post(await ask("ari", id + "-cancel", "actually don't send my number"))).json()).toMatchObject({ decision: "none" });
  clock.advance(askedAt + 9 * MINUTE - MINUTE - clock.now());
  expect(await (await post(await ask("ari", id + "-2", "send Bo my number"))).json())
    .toMatchObject({ decision: "block", senderNotice: "I can't swap numbers right now.", delivered: false });
  expect(clock.now() - askedAt).toBe(9 * MINUTE);
  expect((await pendingNumberSwaps()).filter(swap => swap.matchId === id)).toEqual([]);
  expect(await swapQuestions()).toBe(before + 1);
  expect(await (await post(await ask("ari", id + "-3", "send Bo my number"))).json()).toMatchObject({ decision: "hold" });
  expect(clock.now() - askedAt).toBe(10 * MINUTE);
  expect((await pendingNumberSwaps()).filter(swap => swap.matchId === id)).toHaveLength(1);
  expect(await swapQuestions()).toBe(before + 2);
  expect(await (await post(await ask("ari", id + "-end", "never mind, don't send my number"))).json()).toMatchObject({ decision: "none" });
}, 60_000);
test("a relayed text that says the sender is under 18 is blocked and starts the minors policy: the minor signal on the person, a safety case, and the match closed (audit ST-D2)",async()=>{
  await service.runtimeFor("friends")!.unitOfWork(net=>{
    const st=net.exportState();
    if(st.opps.some(o=>o.id==="relay-op"))return;
    const now=clock.now();
    st.opps=[{...swapMatchTemplate!,id:"relay-op",createdAt:now,meetingAt:now+DAY,deadline:now+DAY}];
    if(st.relay)st.relay.swaps=[];
    net.importState(st);
  });
  const relayed=async()=>(await sql`select id from network.messages where app_id='friends' and id like 'relay:%'`).length,before=await relayed();
  const state=async()=>{const [{state:s}]=await sql`select state from network.network_state where id='friends:nyc'`;return typeof s==="string"?JSON.parse(s):s;};
  const req=await ask("ari","relay-minor","tell Bo I have homeroom on weekday mornings so only weekends work for me");
  const prior=(await state()).members.find((m:any)=>m.id===ari);
  expect([!!prior.minor,!!prior.minorSignal]).toEqual([false,false]);
  expect((await state()).opps.find((o:any)=>o.id==="relay-op").stage).not.toBe("closed");
  const r=await post(req);
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({decision:"block",delivered:false,replayed:false});
  expect(await relayed()).toBe(before);
  expect((await sql`select age_signal,decision from network.relay_records where app_id='friends' and from_member=${ari} order by at desc limit 1`)[0]).toMatchObject({age_signal:true,decision:"block"});
  const st=await state();
  expect(st.members.find((m:any)=>m.id===ari)).toMatchObject({minor:true,minorSignal:true});
  const kinds=(id:string)=>st.cases.filter((c:any)=>c.memberId===id).flatMap((c:any)=>c.events.map((e:any)=>e.kind));
  expect(kinds(ari)).toEqual(expect.arrayContaining(["relay_age_signal","minor_after_contact"]));
  expect(kinds(ari)).not.toContain("age_review");
  expect(kinds(bo)).toContain("contact_with_minor");
  expect(st.opps.find((o:any)=>o.id==="relay-op").stage).toBe("closed");
  expect(JSON.stringify(st.cases)).not.toContain("homeroom");
  const [{person_id:person}]=await sql`select person_id::text from network.members where app_id='friends' and id=${ari}`;
  expect(person).toBeTruthy();
  expect((await sql`select person_id::text from platform.person_minor_signals where person_id=${person}::uuid`).map((x:any)=>x.person_id)).toEqual([person]);
},60_000);
