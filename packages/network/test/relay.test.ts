// Real signed HTTP on Cloud's wire (RelaySendRequest, x-ntwrk-svc-id "<messageId>:relay") -> POST /internal/relay
// -> the ConsentNetwork relay desk (engine relay policy, rules only) -> network.messages / network.relay_records;
// the staff held queue; a restart. Needs the dev Postgres on
// :54339 (pnpm exec tsx packages/observatory/db/dev-pg.ts up). No live call: the adapter is a dry run and no
// Cloudflare token is set, so the classifier is rules only.
import { serveHttp, type HttpServer } from "../../core/src/runtime/http.ts";
import {afterAll,beforeAll,expect,test} from "vitest";
import {randomUUID} from "node:crypto";
import {SQL} from "../../core/src/runtime/postgres.ts";
import {SimClock,MINUTE,DAY,HOUR} from "@thenetwork/core";
import {applySchema} from "../../observatory/db/dev-pg.ts";
import {svcSign} from "../../core/src/svc/svc-auth.ts";
import {TURN_PATH,RELAY_PATH,type RelaySendRequest,type TurnRequest} from "../../core/src/svc/contract.ts";
import {DryRunAdapter} from "../service/channel.ts";
import {NetworkService} from "../service/service.ts";
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
    env:{PLATFORM_ENV:"dev",CLEF_RATINGS:"off",SERVICE_TURN_SECRET:secret},
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

async function enrollRelayMember(phone: string, nameAndAge: string, prefix: string) {
  for (const [index, text] of ["friends.help", nameAndAge, "I enjoy hiking and cooking",
    "Saturday afternoons work for me", "Small groups are good"].entries()) {
    clock.advance(MINUTE);
    const id = prefix + "-" + index;
    expect((await signed(TURN_PATH, id, JSON.stringify(turn(phone, id, text)))).status).toBe(200);
  }
}

beforeAll(async()=>{
  await admin.unsafe(`create database ${db}`);await applySchema(url,{lockTimeout:"5s"});sql=new SQL({url,max:4});await start();
  for (const [who, name] of [["ari", "Ari, 29"], ["bo", "Bo, 31"]] as const)
    await enrollRelayMember(phones[who], name, who + "-setup");
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
  expect(logs).toContain("relay classifier: rules only");
  const ok=await ask("ari","relay-1","tell Bo running 10 min late, see you at the trailhead");
  expect((await post({...ok,memberId:bo})).status).toBe(403);
  expect((await signed(RELAY_PATH,"relay-1",JSON.stringify(ok))).status).toBe(400);
  expect((await signed(RELAY_PATH,"other-key",JSON.stringify(ok))).status).toBe(400);
  expect((await post({...ok,messageId:"ari-setup-0"})).status).toBe(403);
  // The text is the member's own message of that turn, never model wording; an item the turn did not offer is refused.
  expect((await post({...ok,text:"tell Bo something the model invented"})).status).toBe(403);
  expect((await post({...ok,itemId:"relay-op"})).status).toBe(403);
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

test("a scam is held for staff; staff list it (audited, app-scoped), reject it, and the text is gone; it all survives a restart",async()=>{
  const held=await post(await ask("ari","relay-scam","tell Bo can you venmo me 200 for the tickets? my card got frozen"));
  expect(await held.json()).toMatchObject({decision:"hold",delivered:false,replayed:false});
  expect((await staff("/staff/relay/held?app=friends","nobody")).status).toBe(401);
  const list=await (await staff("/staff/relay/held?app=friends","rev-tok")).json() as any;
  expect(list.items).toHaveLength(1);expect(list.items[0]).toMatchObject({app:"friends",from:ari,memberId:ari,kind:"text"});
  // The console's HeldText shape (packages/observatory/src/sources/service.ts): `id` is the item; no recipient id that the console would mask as a phone.
  expect(list.items[0].id).toBe(list.items[0].itemId);expect(list.items[0]).not.toHaveProperty("to");
  expect(JSON.stringify(list)).not.toMatch(/score|rating/i);
  const id=list.items[0].itemId as string;
  expect((await staff(`/staff/relay/${id}/reject?app=friends`,"rev-tok","POST",{})).status).toBe(403);
  await server.stop(true);await service.close();await start();
  expect((await (await staff("/staff/relay/held?app=friends","saf-tok")).json() as any).items.map((x:any)=>x.itemId)).toEqual([id]);
  // Contract: the console's own client reads this real route (it used to drop every item for want of `id`).
  const console_=new ServiceClient({url:server.url.href,token:"saf-tok",app:"friends"});
  const seen=await console_.held("safety@example.org","relay");
  expect(seen).toMatchObject({ok:true,items:[{id,queue:"relay",kind:"text",memberId:ari}]});
  expect((seen as any).items[0].text).toContain("venmo");
  // This network has no outbound queue (dry run): the leak review queue reads as not available, not as an error.
  expect(await console_.held("safety@example.org","leak")).toMatchObject({ok:false,code:"not_available"});
  // A decision needs a reason of 5 or more characters (it reaches the audit row); the console sends it as `note`.
  expect(await (await staff(`/staff/relay/${id}/reject?app=friends`,"saf-tok","POST",{})).json()).toMatchObject({ok:false,reason:"reason_required"});
  expect((await staff(`/staff/relay/${id}/reject?app=friends`,"saf-tok","POST",{note:"scam"})).status).toBe(409);
  expect((await staff(`/staff/relay/${id}/reject?app=friends`,"saf-tok","POST",{note:"asks for money: a scam"})).status).toBe(200);
  expect((await sql`select reason from network.staff_audit where action='relay_reject' and target_id=${id}`)[0].reason).toBe("asks for money: a scam");
  expect((await (await staff("/staff/relay/held?app=friends","saf-tok")).json() as any).items).toEqual([]);
  const [state]=await sql`select state from network.network_state where id='friends:nyc'`;
  expect(JSON.stringify(state)).not.toContain("venmo");
  expect((await sql`select review from network.relay_records where app_id='friends' and item_id=${id}`)[0].review).toBe("rejected");
  expect((await sql`select action from network.staff_audit where action in ('read_relay_held','relay_reject')`).length).toBeGreaterThanOrEqual(2);
  // Only the sender's own inbound message holds those words; nothing with them went out.
  expect((await sql`select id from network.messages where app_id='friends' and direction='outbound' and body like '%venmo%'`).length).toBe(0);
},60_000);

test("a swap request lasts only as long as the engine's consent (15 min, never backdated) and a member can take it back",async()=>{
  const numbers=async()=>(await sql`select id from network.messages where app_id='friends' and (body like ${"%"+phones.ari.slice(2)+"%"} or body like ${"%"+phones.bo.slice(2)+"%"})`).length;
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
  expect(await (await post(await ask("bo","ttl-bo-2","send Ari my number"))).json()).toMatchObject({decision:"hold"});
  expect(await (await post(await ask("bo","ttl-bo-refuse","don't delay, my number is off limits"))).json()).toEqual({decision:"none",senderNotice:"Okay, I won't share your number.",delivered:false,replayed:false});
  expect(await numbers()).toBe(0);
  // Clean slate for the next test: Bo's request is withdrawn too.
  expect(await (await post(await ask("bo","ttl-bo-cancel","never mind, don't send my number"))).json()).toMatchObject({decision:"none"});
},60_000);

test("a number goes out only after both members asked for the swap",async()=>{
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

test("a polite signed relay keeps the payload's negation and uses the named match", async () => {
  const modal = await post(await ask("ari", "relay-modal-text", "Could you tell Bo I don't eat dairy?"));
  expect(modal.status).toBe(200);
  expect(await modal.json()).toMatchObject({ decision: "pass", delivered: false });
  const delivered = await sql<{ member_id: string; body: string }[]>`select member_id, body from network.messages
    where app_id='friends' and direction='outbound' and body like '%dairy%'`;
  expect([...delivered]).toEqual([{ member_id: bo, body: 'Ari says: "I don\'t eat dairy"' }]);

  const wrong = await post(await ask("ari", "relay-named-other", "Could you tell Charlie I don't eat meat?"));
  expect(wrong.status).toBe(200);
  expect(await wrong.json()).toMatchObject({ decision: "block", delivered: false });
  expect(await sql`select id from network.messages where app_id='friends' and direction='outbound' and body like '%eat meat%'`).toHaveLength(0);
});

const namedRelayPhones = ["+12125550183", "+12125550184"] as const;
let namedRelayMembers: [string, string] | undefined;

async function namedRelaySams(): Promise<[string, string]> {
  if (namedRelayMembers) return namedRelayMembers;
  const members: string[] = [];
  for (const [index, phone] of namedRelayPhones.entries()) {
    const id = "named-relay-sam-" + index;
    await enrollRelayMember(phone, "Sam, 29", id);
    members.push(await open(phone, id + "-open"));
  }
  return namedRelayMembers = [members[0]!, members[1]!];
}

async function setNamedRelayMatches(matches: { id: string; other: string; dayOffset: number }[]) {
  await service.runtimeFor("friends")!.unitOfWork(net => {
    const state = net.exportState();
    swapMatchTemplate ??= state.opps.find(opp => opp.id === "relay-op")!;
    const nextDay = Math.floor(clock.now() / DAY) + 1;
    clock.set(nextDay * DAY + 16 * HOUR);
    const now = clock.now();
    state.opps = matches.map(({ id, other, dayOffset }) => ({
      ...swapMatchTemplate!, id, participants: [bo, other], status: [[bo, "yes"], [other, "yes"]],
      contacted: [bo, other], createdAt: now, meetingAt: now + dayOffset * DAY, deadline: now + dayOffset * DAY,
    }));
    if (state.relay) state.relay.swaps = [];
    net.importState(state);
  });
}

test("an unselected named relay refuses two different counterparts with the same name", async () => {
  const [older, newer] = await namedRelaySams();
  await setNamedRelayMatches([
    { id: "same-name-text-old", other: older, dayOffset: 1 },
    { id: "same-name-text-new", other: newer, dayOffset: 2 },
  ]);
  const outgoing = () => sql`select id from network.messages where app_id='friends' and direction='outbound' and type='relay' and body like '%shellfish%'`;
  const before = (await outgoing()).length;
  const request = await ask("bo", "same-name-text", "Could you tell Sam I don't eat shellfish?");
  expect((await post({ ...request, itemId: "same-name-text-old" })).status).toBe(403);
  const response = await post(request);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ decision: "block", delivered: false });
  expect(await outgoing()).toHaveLength(before);
}, 60_000);

test("an unselected named number refusal preserves the other member's existing match consent", async () => {
  const [older, newer] = await namedRelaySams();
  const newestMatch = "same-name-number-new";
  await setNamedRelayMatches([
    { id: "same-name-number-old", other: older, dayOffset: 1 },
    { id: newestMatch, other: newer, dayOffset: 2 },
  ]);
  const messageId = "same-name-sam-first", text = "Please send Bo my number.";
  expect(await open(namedRelayPhones[1], messageId, text)).toBe(newer);
  const first = await post({ channel: "blooio", messageId, app: "friends", itemId: null, memberId: newer, text });
  expect(await first.json()).toMatchObject({ decision: "hold", delivered: false });
  const original = await pendingNumberSwaps();
  expect(original).toEqual([expect.objectContaining({ from: newer, matchId: newestMatch })]);

  const before = await sharesQueued();
  const response = await post(await ask("bo", "same-name-number-reply", "Please send Sam my number."));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ decision: "block", delivered: false });
  expect(await pendingNumberSwaps()).toEqual(original);
  expect(await sharesQueued()).toBe(before);
}, 60_000);

test("an unselected named relay uses the newest opportunity with the same person", async () => {
  const [sam] = await namedRelaySams();
  await setNamedRelayMatches([
    { id: "same-person-old", other: sam, dayOffset: 1 },
    { id: "same-person-new", other: sam, dayOffset: 2 },
  ]);
  const response = await post(await ask("bo", "same-person-text", "Could you tell Sam I don't drink milk?"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ decision: "pass", delivered: false });
  const sent = await sql`select member_id, opportunity_id from network.messages
    where app_id='friends' and direction='outbound' and type='relay' and body like '%drink milk%'`;
  expect([...sent]).toEqual([{ member_id: sam, opportunity_id: "same-person-new" }]);
  const number = await post(await ask("bo", "same-person-number", "Please send Sam my number."));
  expect(await number.json()).toMatchObject({ decision: "hold", delivered: false });
  expect(await pendingNumberSwaps()).toEqual([expect.objectContaining({ to: sam, matchId: "same-person-new" })]);
}, 60_000);

test("an unselected named relay does not switch from the newest match to an older person", async () => {
  const [sam] = await namedRelaySams();
  await setNamedRelayMatches([
    { id: "other-person-old", other: sam, dayOffset: 1 },
    { id: "other-person-new", other: ari, dayOffset: 2 },
  ]);
  const response = await post(await ask("bo", "other-person-text", "Could you tell Sam I am nearby?"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ decision: "block", delivered: false });
  const number = await post(await ask("bo", "other-person-number", "Please send Sam my number."));
  expect(await number.json()).toMatchObject({ decision: "block", delivered: false });
  expect(await pendingNumberSwaps()).toEqual([]);
}, 60_000);

const sharesQueued = async () => (await sql`select id from network.messages where app_id='friends'
  and direction='outbound' and body like '%asked me to send you%'`).length;
const pendingNumberSwaps = () => service.runtimeFor("friends")!.unitOfWork(net => net.exportState().relay?.swaps ?? []);
let swapMatchTemplate: NetworkState["opps"][number] | undefined;

async function resetSwapMatch(id: string) {
  await service.runtimeFor("friends")!.unitOfWork(net => {
    const state = net.exportState();
    swapMatchTemplate ??= state.opps.find(opp => opp.id === "relay-op")!;
    // Keep at least one day between cases and start each one during New York daytime.
    const earliest = clock.now() + DAY;
    const daytime = Math.floor(earliest / DAY) * DAY + 16 * HOUR;
    clock.set(daytime < earliest ? daytime + DAY : daytime);
    const now = clock.now();
    state.opps = [{ ...swapMatchTemplate, id, createdAt: now, meetingAt: now + DAY, deadline: now + DAY }];
    if (state.relay) state.relay.swaps = [];
    net.importState(state);
  });
}

async function startNumberSwap(id: string, who: "ari" | "bo") {
  await resetSwapMatch(id);
  const recipient = who === "ari" ? "Bo" : "Ari";
  expect(await (await post(await ask(who, id + "-first", "send " + recipient + " my number"))).json())
    .toMatchObject({ decision: "hold", delivered: false });
}

test.each([
  ["Please send Sam my number.", "block"],
  ["Please send my number to Sam.", "block"],
  ["Yes, send it to Sam.", "block"],
  ["Yes, send it, to Sam.", "block"],
  ["Yes, send it - to Sam.", "block"],
  ["Yes, send it over to Sam.", "block"],
  ["Yes, send it? To Sam.", "none"],
  ["Yes, send it “to Sam”.", "none"],
  ["Please send him my number. Directly to Sam.", "none"],
  ["Please send Ari my number. To be clear, I'll be there at seven. To Sam.", "none"],
  ["Please send Ari my number. To be clear, tell them I'll be there at seven. To Sam.", "none"],
  ["Yes, send it to Herman.", "block"],
  ["Yes, send it to Ari9.", "none"],
  ["Yes, send it (to Sam).", "none"],
  ["Yes, send it. To Sam.", "none"],
  ["Yes, send it to Ari Smith.", "none"],
  ["Please send my number to her and Sam.", "none"],
  ["Please send her my number, to Sam.", "none"],
  ["Please send my number to Sam when you can.", "block"],
  ["Please send my number to Ari Smith.", "none"],
  ["Please send my number to Ari Smith when you can.", "none"],
  ["Please send my number to Ari if he asks.", "none"],
])("a named private request keeps the selected swap pending: %s", async (text, decision) => {
  const id = "named-number-" + randomUUID();
  const before = await sharesQueued();
  await startNumberSwap(id, "ari");
  const original = (await pendingNumberSwaps()).find(swap => swap.matchId === id);
  expect(original).toBeDefined();
  const response = await post(await ask("bo", id + "-reply", text));
  expect(response.status).toBe(200);
  expect({
    response: await response.json(),
    newShares: await sharesQueued() - before,
    pending: (await pendingNumberSwaps()).find(swap => swap.matchId === id),
  }).toMatchObject({ response: { decision, delivered: false }, newShares: 0, pending: original });
}, 60_000);

test.each([
  "Please send my number to Ari, thanks.",
  "Please send my number to Ari when you can.",
  "Yes, send it to Ari.",
  "Yes, send it: to Ari, thanks.",
  "Yes, send it - to Ari.",
  "Yes, send it over to Ari.",
  "Please send Ari my number with thanks.",
  "Please send Ari my number. To be clear, I'll be there at seven.",
  "Please send Ari my number. With that settled, I'll be there at seven.",
  "Yes, send it to my match.",
])("a complete recipient can finish the selected swap: %s", async text => {
  const id = "named-number-match-" + randomUUID();
  const before = await sharesQueued();
  await startNumberSwap(id, "ari");
  expect(await (await post(await ask("bo", id + "-reply", text))).json()).toMatchObject({ decision: "pass", delivered: false });
  expect(await sharesQueued()).toBe(before + 2);
}, 60_000);

test.each([
  "Give him my number if he asks.",
  "Send him my number. Scratch that. Send it. If he asks.",
  "Give Ari my number if Ari asks.",
  "Give him my number unless he objects.",
  "Give him my number if it's okay with him.",
  "Give him my number if you can, after he asks.",
  "Send him my number. If he asks.",
  "Send him my number, please — if he asks.",
  "Send him my number whenever he asks.",
  "Give him my number every time he asks.",
  "Send him my number each time he requests it.",
  "Send him my number anytime he asks for it.",
  "Send him my number. Let me think about it first",
  "Send him my number. Let me think it over first.",
  "Send him my number. Hmm idk.",
  "Send him my number. Lol nevermind he's weird.",
])("a trailing condition cannot arm or complete a signed number swap: %s", async text => {
  const id = "conditional-swap-" + randomUUID();
  await resetSwapMatch(id);
  const before = await sharesQueued();
  const conditional = await post(await ask("bo", id + "-conditional", text));
  expect(conditional.status).toBe(200);
  const requested = await conditional.json();
  const pending = (await pendingNumberSwaps()).filter(swap => swap.matchId === id).length;
  const counterpart = await post(await ask("ari", id + "-counterpart", "Send Bo my number."));
  expect(counterpart.status).toBe(200);
  expect({ requested, pending, counterpart: await counterpart.json(), newShares: await sharesQueued() - before })
    .toMatchObject({ requested: { decision: "none", delivered: false }, pending: 0,
      counterpart: { decision: "hold", delivered: false }, newShares: 0 });
}, 60_000);

test.each([
  "Send him my number. He can have it if he asks.",
  "Send him my number. Give it to him if he asks.",
  "Send him my number. Give it to him when dinner is ready.",
  "Send him my number. Send it to him after I finish work.",
  "Send him my number. He can have it once Ari approves.",
  "Send him my number. Only give it to him if he asks.",
  "Send him my number. Give it to him on Friday.",
  "Send him my number. Thanks. Give it to him once I confirm.",
  "Send him my number. She can have it when she asks.",
  "Send him my number. He can have it unless he says no.",
])("a condition in the next sentence cannot arm or complete a signed number swap: %s", async text => {
  const id = "conditional-next-sentence-" + randomUUID();
  await resetSwapMatch(id);
  const before = await sharesQueued();
  const conditional = await post(await ask("bo", id + "-conditional", text));
  expect(conditional.status).toBe(200);
  const requested = await conditional.json();
  const pending = (await pendingNumberSwaps()).filter(swap => swap.matchId === id).length;
  const counterpart = await post(await ask("ari", id + "-counterpart", "Send Bo my number."));
  expect(counterpart.status).toBe(200);
  expect({ requested, pending, counterpart: await counterpart.json(), newShares: await sharesQueued() - before })
    .toMatchObject({ requested: { decision: "none", delivered: false }, pending: 0,
      counterpart: { decision: "hold", delivered: false }, newShares: 0 });
}, 60_000);

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
  "Don't send it anymore",
  "Don't send it any more",
  "Don't send it now",
  "Don't send it after all",
  "Don't share it with them anymore",
  "I don't want you to send it anymore",
  "Never send it",
  "Don't send them it",
  "Don't send them anything",
  "Don't you dare send it",
  "Don't send my photo or number",
  "Please don't send Ari my photos or cell yet",
  "Ana says, send it now. Don't send it anymore.",
  "Ana says, send it now, but I don't want you to send it anymore.",
  "I say, don't send it now",
  "As I said, don't send it now",
  "Ana says, if you need to, send it now. Don't send it anymore.",
  "Ana says, if it's urgent, send it now; Don't send it anymore.",
  "Ana says, “don't send it now.” Don't send it anymore",
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

test.each([
  "Tell Ana to send him my number",
  "Tell Ari to send my number to Sam9.",
  "Tell Ari to send my photo to Sam9.",
  "Ask Ana to text him my number",
  "Could you tell Ana to please give him my number?",
  "Let Ana share my number with him",
  "Ana says to send him my number",
  "Ana tells me to send him my number",
  "Ask Mary Jane to send him my number",
  "Tell them you can send him my number",
  "Tell Ana to show him this photo and send him my number",
  "I want Ana to, send him my number",
  "I would not want Ana to, send him my number",
])("a signed delegated request cannot finish a number swap: %s", async text => {
  const id = "delegated-number-" + randomUUID();
  const before = await sharesQueued();
  await startNumberSwap(id, "ari");
  const original = (await pendingNumberSwaps()).find(swap => swap.matchId === id);
  expect(original).toBeDefined();

  const refused = await post(await ask("bo", id + "-delegated", text));
  expect(refused.status).toBe(200);
  expect({ decision: (await refused.json()).decision, shares: await sharesQueued() - before,
    pending: (await pendingNumberSwaps()).find(swap => swap.matchId === id) })
    .toEqual({ decision: "none", shares: 0, pending: original });

  const accepted = await post(await ask("bo", id + "-direct", "Please send Ari my number."));
  expect(await accepted.json()).toMatchObject({ decision: "pass" });
  expect(await sharesQueued()).toBe(before + 2);
}, 60_000);

test("an independent direct sentence can finish a signed number swap", async () => {
  const id = "independent-number-" + randomUUID();
  const before = await sharesQueued();
  await startNumberSwap(id, "ari");
  const text = "Tell Ana to send him my number. Please send Ari my number.";
  expect(await (await post(await ask("bo", id + "-direct", text))).json()).toMatchObject({ decision: "pass" });
  expect(await sharesQueued()).toBe(before + 2);
}, 60_000);

test.each([
  "Don't forget to send it",
  "Don't hesitate, send it now",
  "I can't wait anymore",
  "Don't send it to my old email anymore",
  "Never forget to send it",
  "Don't you dare forget to send it",
  "Don't send them anything else",
  "Never send them the invoice",
  "Ari said “don't send it anymore.”",
  "Ana says, don't send it now",
  "Mary Jane told me, don't send it any more",
  "Well, Ana says, don't send it yet",
  "Ana says, if it's not urgent, don't send it now",
  "Ana says, don't send my number",
  "Ana says, don't send my photo or number",
  "Don't send my photo or number, Ana said.",
  "Don't send my photo or my coworker's number",
  "Don't send my photo or email",
  "Don't send my photo. My number is in the confirmation.",
  "Wait.",
])("the signed turn keeps a pending swap after a go-ahead or unrelated wording: %s", async text => {
  const id = "unrelated-withdrawal-" + randomUUID();
  const before = await sharesQueued();
  await startNumberSwap(id, "bo");
  const original = (await pendingNumberSwaps()).find(swap => swap.matchId === id);
  expect(original).toBeDefined();

  clock.advance(MINUTE);
  const messageId = id + "-followup";
  expect((await signed(TURN_PATH, messageId, JSON.stringify(turn(phones.bo, messageId, text)))).status).toBe(200);
  expect((await pendingNumberSwaps()).find(swap => swap.matchId === id)).toEqual(original);
  expect(await (await post(await ask("ari", id + "-second", "send Bo my number"))).json())
    .toMatchObject({ decision: "pass", delivered: false });
  expect(await sharesQueued()).toBe(before + 2);
}, 60_000);

test.each([
  { text: "Don't send him my photo. Send him my number.", shares: true },
  { text: "I won't send my photo. Send him my number.", shares: true },
  { text: "Don't send my photo. Could you kindly send him my number?", shares: true },
  { text: "Scratch that. Send him my number.", shares: true },
  { text: "Send him my number. Ana says, scratch that.", shares: true },
  { text: "Send him my photo, Ana said. Please send him my number.", shares: true },
  { text: "Send them my number, she already asked.", shares: true },
  { text: "Send them my number if you can.", shares: true },
  { text: "Send him my number whenever you can, thanks.", shares: true },
  { text: "Send him my number every time you can, thanks.", shares: true },
  { text: "Give him my number if it's okay.", shares: true },
  { text: "Send him my number. If he asks where dinner is, the address is on the invite.", shares: true },
  { text: "Send him my number, and if he asks about parking, tell him it's free.", shares: true },
  { text: "Send him my number now. Whenever he replies, tell me.", shares: true },
  { text: "Send him my number now. Every time he replies, tell me.", shares: true },
  { text: "Send him my number now. Every time he reports a problem, tell me.", shares: true },
  { text: "Send him my number. Give it to him every single time Ari asks.", shares: false },
  { text: "Send him my number. Oh no, I'm late.", shares: true },
  { text: "Send him my number now. Lol nevermind dinner, let's make coffee.", shares: true },
  { text: "Send him my number whenever you can get approval.", shares: false },
  { text: "Send him my number. Whenever he asks, tell me before you send it.", shares: false },
  { text: "Send him my number. Every time he asks, tell me before you send it.", shares: false },
  { text: "Send him my number. Every time he asks, tell me.", shares: false },
  { text: "Send him my number. Every time he asks, he can have it.", shares: false },
  { text: "Send him my number. Every time he asks, he can have my photo.", shares: true },
  { text: "Send him my number. Every time he asks, he can have my photo and my number.", shares: false },
  { text: "Send him my number. Let me think it over first.", shares: false },
  { text: "Send him my number. Lemme think.", shares: false },
  { text: "Send him my number. Let me think for a sec.", shares: false },
  { text: "Send him my number. Let me think about it some more.", shares: false },
  { text: "Send him my number. Haha nevermind he's weird.", shares: false },
  { text: "Send him my number. Ok nevermind about the number.", shares: false },
  { text: "Send him my number. Ok nevermind about the photo.", shares: true },
  { text: "Send him my number. Ok nevermind about dinner.", shares: true },
  { text: "Send him my number. He can have it if he asks.", shares: false },
  { text: "Send him my number. Give it to him if he asks.", shares: false },
  { text: "Send him my number. Give it to him when dinner is ready.", shares: false },
  { text: "Send him my number. Give it to him after dinner.", shares: false },
  { text: "Send him my number. Send it to him after I finish work.", shares: false },
  { text: "Send him my number. He can have it once Ari approves.", shares: false },
  { text: "He has to consent first. Share my number with him.", shares: false },
  { text: "Wait until I confirm the number swap. Share my number with him.", shares: false },
  { text: "Wait for Ana to approve sharing my number with Ari. Share my number with Ari.", shares: false },
  { text: "Wait for Ana to approve sharing my number with Bo. Share my number with Ari.", shares: true },
  { text: "Ari has to approve my number first. Ari already approved my photo. Share my number with him.", shares: false },
  { text: "Ari has to approve my number first. Ari already approved my number. Share my number with him.", shares: true },
  { text: "Ari must approve this first. Ari already approved that. Share my number with him.", shares: false },
  { text: "Ari must approve sharing my number with him first. Ari already approved sharing my number with her. Share my number with him.", shares: false },
  { text: "Wait for Ana to agree to share my number with Ari. Share my number with Ari.", shares: false },
  { text: "Ana must approve sharing my number with Ari first. Ana already approved sharing my number with Ari. Share my number with Ari.", shares: true },
  { text: "Ana has to agree first. Share my number with him.", shares: false },
  { text: "Ana agrees first. Share my number with him.", shares: false },
  { text: "Ana needs to say yes first. Share my number with him.", shares: false },
  { text: "He has to ask first. Share my number with him.", shares: false },
  { text: "He asks first. Share my number with him.", shares: false },
  { text: "Wait for Ana to agree. Share my number with him.", shares: false },
  { text: "Only after Ana agrees. Share my number with him.", shares: false },
  { text: "Ana has to agree first; share my number with him.", shares: false },
  { text: "Unless he asks first. Share my number with him.", shares: false },
  { text: "Ana agrees. Share my number with him.", shares: true },
  { text: "He asked already. Share my number with him.", shares: true },
  { text: "No need to wait for Ana to agree. Please send Ari my number.", shares: true },
  { text: "I heard Ana has to ask first about the venue. Please send Ari my number.", shares: true },
  { text: "He has to ask the venue about opening hours. Please send Ari my number.", shares: true },
  { text: "Ari said “Wait for Ana to agree.” Please send Ari my number.", shares: true },
  { text: "He has to ask for my photo first. Share my number with him.", shares: false },
  { text: "Wait for Ari to agree. Ari has already agreed. Share my number with him.", shares: true },
  { text: "Wait for Ari to agree. Bo has already agreed. Share my number with him.", shares: false },
  { text: "Wait for Ari to approve. Ari has already agreed. Share my number with him.", shares: false },
  { text: "Wait for him to agree. He has already agreed. Share my number with him.", shares: false },
  { text: "Wait until Ari asks again. Ari asked. Share my number with him.", shares: false },
  { text: "Wait until Ari asks again. Ari asked again. Share my number with him.", shares: true },
  { text: "Only if he requests my number explicitly. Send him my number.", shares: false },
  { text: "Wait until he asks why, tell him we can talk Friday. Send him my number.", shares: true },
  { text: "Send him my number. It is for him when he asks.", shares: false },
  { text: "Send him my number. It is for work on Friday.", shares: true },
  { text: "Wait for Ari to agree, please. Share my number with him.", shares: false },
  { text: "Ana has to agree first, but I can send you the schedule. Share my number with him.", shares: false },
  { text: "Wait for Ana to agree, but Ari said “I am at work.” Share my number with him.", shares: false },
  { text: "Wait for Ari to agree. Ari has already agreed!? Share my number with him.", shares: false },
  { text: "Wait for Ari to agree. Ari has already agreed. ? Share my number with him.", shares: false },
  { text: "He has to ask me first. Share my number with him.", shares: false },
  { text: "Ana must approve it first. Share my number with him.", shares: false },
  { text: "Wait for Ana to agree to it. Share my number with him.", shares: false },
  { text: "Send him my number. Give it to him, and tell me if he asks.", shares: true },
  { text: "Send him my number. Give it to him, and tell me when dinner is ready.", shares: true },
  { text: "Send him my number. Dinner will be ready after I finish work.", shares: true },
  { text: "Send him my number. Let me know if he asks.", shares: true },
  { text: "Send him my number. He asked if he can have it.", shares: true },
  { text: "Send him my number. Don't send my photo. Or my number.", shares: false },
  { text: "Don't send my photo. My number neither. Send him my number.", shares: false },
  { text: "Send him my number. Don't send my photo. Same goes for my cell.", shares: false },
  { text: "Send him my number. Scratch that.", shares: false },
  { text: "Send him my number. Scratch that, I'll tell him myself.", shares: false },
  { text: "Send him my number. Hold on, let me ask him first.", shares: false },
  { text: "Send him my number. Hold on, send it.", shares: true },
  { text: "Send him my number. Hold on, SEND IT!", shares: true },
  { text: "Send him my number. Hold on, send it, no rush.", shares: true },
  { text: "Send him my number. Hold on, please send him my number now.", shares: true },
  { text: "Send him my number. No worries.", shares: true },
  { text: "Send him my number. No rush at all.", shares: true },
  { text: "Send him my number. Hold on, I'll send it myself.", shares: false },
  { text: "Send him my number. Hold on, Ana said send it.", shares: false },
  { text: "Send him my number. Hold on, \"send it\".", shares: false },
  { text: "Send him my number. Hold on, maybe send it.", shares: false },
  { text: "Send him my number. Hold on, send it if he asks.", shares: false },
  { text: "Send him my number. Hold on, send it 'to me instead'.", shares: false },
  { text: "Send him my number. Hold on, send him my photo.", shares: false },
  { text: "Send him my number. Hold on, send her my number.", shares: false },
  { text: "Send him my number. Scratch that. Send it.", shares: true },
  { text: "Send him my number. Scratch that. Send it. I'm running late.", shares: true },
  { text: "Send him my number. Scratch that. Send it. I'm at work.", shares: true },
  { text: "Send him my number. Scratch that. Send it. Ok nevermind about the photo.", shares: true },
  { text: "Send him my number. Scratch that. Send it. Don't send my photo.", shares: true },
  { text: "Send him my number. Scratch that. Send it, please.", shares: true },
  { text: "Send him my number. Hold on. Send it.", shares: true },
  { text: "Send him my number. Scratch that. Send him my number now.", shares: true },
  { text: "Send him my number. Scratch that. Send him my number now. Tell him I'm running late.", shares: true },
  { text: "Send him my number. Wait. Actually, send it.", shares: true },
  { text: "Send him my number. Scratch that. Please send it.", shares: true },
  { text: "Send him my number. No. Send it.", shares: true },
  { text: "Send him my number. Scratch that. Hold on, send it.", shares: true },
  { text: "Send him my number. Scratch that. Send it. Scratch that.", shares: false },
  { text: "Send him my number. Scratch that. Send it. The photo.", shares: false },
  { text: "Send him my number. Scratch that. Send it. To me instead.", shares: false },
  { text: "Send him my number. Scratch that. Ok nevermind about the photo. Send it.", shares: false },
  { text: "Send him my number. Scratch that. Send it. Ok nevermind about my number.", shares: false },
  { text: "Send him my number. Scratch that. Send it. Ok nevermind about the photo. Or my number.", shares: false },
  { text: "Send him my number. Scratch that. Send it. Don't send my photo. Or my number.", shares: false },
  { text: "Send him my number. Scratch that. Send it. I will delay.", shares: false },
  { text: "Send him my number. Scratch that. Send it. I will get back to you.", shares: false },
  { text: "Send him my number. Scratch that. Send it. I will do the transfer myself.", shares: false },
  { text: "Send him my number. Scratch that. Send it if he asks.", shares: false },
  { text: "Send him my number. Scratch that. Send it?", shares: false },
  { text: "Send him my number. Scratch that. Send it \"to me instead\".", shares: false },
  { text: "Send him my number. Scratch that. Send it. Whenever he asks.", shares: false },
  { text: "Send him my number. Scratch that. I have a photo for him. Send it.", shares: false },
  { text: "Send him my number. Scratch that. Send it. Maybe later.", shares: false },
  { text: "Send him my number. Scratch that. Send it. Let me think it over first.", shares: false },
  { text: "Send him my number. Scratch that. Send him my photo.", shares: false },
  { text: "Send him my number. Never mind. Send it.", shares: false },
  { text: "Send him my number. Haha nevermind. Send him my number now.", shares: false },
  { text: "Send him my number. Wait.", shares: false },
  { text: "Send him my number. Let me think.", shares: false },
  { text: "Send him my number. Keep it private.", shares: false },
  { text: "Send him my number. ??", shares: false },
  { text: "Send him my number. Don't send my photo. ❌", shares: false },
  { text: "Send him my number. ❌", shares: false },
  { text: "Send him my number. Don't send my photo. 🚫📞", shares: false },
  { text: "Send him my number. Don't send my photo. Instead, send her my email.", shares: false },
  { text: "Send him my number, Ana said.", shares: false },
  { text: "Don't send him my photo. I'm not sure what time it is. Send him my number.", shares: true },
  { text: "Don't send him my photo. I'm not sure whether to send it. Send him my number.", shares: false },
  { text: "Don't send my photo. I'm not sure about sending it while Dad is here. Send him my number.", shares: false },
  { text: "Don't send my photo. I have second thoughts. Send him my number.", shares: false },
  { text: "Don't send my photo. I'm not comfortable sharing my number. Send him my number.", shares: false },
  { text: "Don't send my photo. I'm not comfortable. Send him my number.", shares: false },
  { text: "Don't send my photo. I'm not sure about sending him this calendar invite. Send him my number.", shares: true },
  { text: "Don't send him my number. Send him my number.", shares: false },
  { text: "Don't send it while the photo is blurry. Send him my number.", shares: false },
  { text: "Don't send him my photo, or the number. Send him my number.", shares: false },
  { text: "Don't send anything except my photo. Send him my number.", shares: false },
  { text: "Don't send the phone number on my photo. Send him my number.", shares: false },
  { text: "Ana said, don't send it while the photo is blurry. Send him my number.", shares: false },
  { text: "Don't send him my photo or the number. Send him my number.", shares: false },
  { text: "Don't send it. Send him my number.", shares: false },
  { text: "I won't. Send him my number.", shares: false },
  { text: "Don't send him my photo. Send him my number tomorrow.", shares: false },
  { text: "Don't send him my photo. If you want to, send him my number.", shares: false },
  { text: "Don't send him my photo. Envíale mi número.", shares: false },
])("a signed number request respects the intended item: $text", async ({ text, shares }) => {
  const id = "scoped-number-" + randomUUID();
  const before = await sharesQueued();
  await startNumberSwap(id, "ari");
  const original = (await pendingNumberSwaps()).find(swap => swap.matchId === id);
  expect(original).toBeDefined();

  const response = await post(await ask("bo", id + "-action", text));
  expect(response.status).toBe(200);
  expect({ decision: (await response.json()).decision, newShares: await sharesQueued() - before,
    pending: (await pendingNumberSwaps()).find(swap => swap.matchId === id) })
    .toEqual({ decision: shares ? "pass" : "none", newShares: shares ? 2 : 0, pending: shares ? undefined : original });
}, 60_000);

let ageEstimatePair = 0;
test.each([
  { label: "first-person near adult birthday on TURN", body: "I'm turning 18 next month", minor: true, incomingAge: 17 },
  { label: "first-person mid-teen birthday on TURN", body: "I'm turning 16 next month", minor: true, incomingAge: 15 },
  { label: "first-person school year on TURN", body: "I'm in seventh grade", minor: true, incomingAge: 13 },
  { label: "adult teacher role", body: "I'm in 12th grade, as a teacher.", minor: false },
  { label: "decimal measurement", body: "I'm turning 16.5 degrees", minor: false },
  { label: "grouped measurement", body: "I'm almost 15,000 feet away", minor: false },
  { label: "measurement beside genuine youth estimate", body: "I'm turning 16.5 degrees, but I'm almost 18.", minor: true, incomingAge: 17 },
  { label: "grade followed by teacher attribution", body: "I'm in seventh grade, as a teacher told me.", minor: true, incomingAge: 13 },
  { label: "short birthday today", body: "turning 18 today", minor: true },
  { label: "short birthday this month", body: "turning 18 this month", minor: true },
  { label: "measurement in miles", body: "I'm almost 150 miles away.", minor: false },
  { label: "turn in degrees", body: "I'm turning 165 degrees clockwise.", minor: false },
  { label: "quoted birthday", body: 'She said "I\'m turning 16 next month".', minor: false },
  { label: "unfinished reported birthday", body: "She said “I'm turning 16 next month", minor: false },
  { label: "indirect grade", body: "My cousin said I am in seventh grade.", minor: false },
  { label: "quoted grade", body: "She said ‘I'm in seventh grade’.", minor: false },
  { label: "adult school role", body: "I'm in 12th grade as a teacher.", minor: false },
  { label: "distant birthday", body: "I'm turning 16 in two years.", minor: false },
  { label: "hypothetical birthday", body: "What if I'm turning 16 next month?", minor: false },
  { label: "short almost age", body: "almost 16", minor: true },
  { label: "short turning age", body: "turning 16 next month", minor: true },
  { label: "short birthday", body: "16 next month", minor: true },
  { label: "own birthday quotation", body: "I said “I'm turning 16 next month”", minor: true },
  { label: "own grade quotation", body: "I said ‘I'm in seventh grade’", minor: true },
  { label: "own grade quotation with teacher attribution", body: "I said ‘I'm in seventh grade, as a teacher told me.’", minor: true },
  { label: "own grade quotation with qualified teacher role", body: "I said ‘I'm in 12th grade, as a teacher at the school.’", minor: false },
  { label: "another speaker quotes a grade with teacher attribution", body: "She said ‘I'm in seventh grade, as a teacher told me.’", minor: false },
  { label: "unfinished casual birthday", body: "“I'm turning 16 next month", minor: true },
])("signed TURN and relay classify age at their own boundary: $label", async ({ label, body, minor, incomingAge }) => {
  const id = "relay-age-estimate-" + randomUUID();
  const pair = ++ageEstimatePair;
  const senderPhone = "+12125550" + (100 + 2 * pair);
  const recipientPhone = "+12125550" + (101 + 2 * pair);
  await enrollRelayMember(senderPhone, "Ari, 29", id + "-ari");
  await enrollRelayMember(recipientPhone, "Bo, 29", id + "-bo");
  const sender = await open(senderPhone, id + "-ari-open"), recipient = await open(recipientPhone, id + "-bo-open");
  await service.runtimeFor("friends")!.unitOfWork(net => {
    const state = net.exportState();
    swapMatchTemplate ??= state.opps.find(opp => opp.id === "relay-op")!;
    const now = clock.now();
    state.opps.push({ ...swapMatchTemplate!, id, createdAt: now, meetingAt: now + DAY, deadline: now + DAY,
      participants: [sender, recipient], status: [[sender, "yes"], [recipient, "yes"]], contacted: [sender, recipient] });
    net.importState(state);
  });
  const before = (await service.accounts.personFor(senderPhone))?.lowestAge;
  expect(before).toBe(29);

  const text = "tell Bo " + body, messageId = id + "-text";
  if (incomingAge !== undefined) {
    clock.advance(MINUTE);
    const response = await signed(TURN_PATH, messageId, JSON.stringify(turn(senderPhone, messageId, text)));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outcome: "handled" });
    expect((await service.accounts.personFor(senderPhone))?.lowestAge).toBe(incomingAge);
    expect(await service.runtimeFor("friends")!.unitOfWork(net =>
      net.exportState().opps.find(opp => opp.id === id)?.stage)).toBe("closed");
    expect((await post({ channel: "blooio", messageId, app: "friends", memberId: sender, itemId: null, text })).status).toBe(403);
    clock.advance(MINUTE);
    const followupId = id + "-minor-followup";
    const followup = await signed(TURN_PATH, followupId, JSON.stringify(turn(senderPhone, followupId, "tell Bo the coffee shop is open.")));
    expect(await followup.json()).toMatchObject({ outcome: "open", context: { singlePlayer: true } });
    const followupRelay = await post({ channel: "blooio", messageId: followupId, app: "friends", memberId: sender, itemId: null, text: "tell Bo the coffee shop is open." });
    expect(followupRelay.status).toBe(200);
    expect(await followupRelay.json()).toMatchObject({ decision: "block", delivered: false });
    expect(await sql`select id from network.messages
      where app_id='friends' and direction='outbound' and member_id=${recipient} and opportunity_id=${id} and type='relay'`).toHaveLength(0);
    return;
  }
  expect(await open(senderPhone, messageId, text)).toBe(sender);
  expect((await service.accounts.personFor(senderPhone))?.lowestAge).toBe(before);
  const response = await post({ channel: "blooio", messageId, app: "friends", memberId: sender, itemId: null, text });
  expect(response.status).toBe(200);
  const decision = minor ? "block" : "pass";
  expect(await response.json()).toMatchObject({ decision, delivered: false });
  const records = await sql`select decision, age_signal from network.relay_records
    where app_id='friends' and opportunity_id=${id} and from_member=${sender}`;
  expect([...records]).toEqual([{ decision, age_signal: minor }]);
  const sent = await sql`select body from network.messages
    where app_id='friends' and direction='outbound' and member_id=${recipient} and opportunity_id=${id} and type='relay'`;
  expect(sent).toHaveLength(minor ? 0 : 1);
  expect((await service.accounts.personFor(senderPhone))?.lowestAge).toBe(before);
  expect(await service.runtimeFor("friends")!.unitOfWork(net =>
    net.exportState().opps.find(opp => opp.id === id)?.stage)).toBe("scheduled");
  if (label === "short turning age") {
    const messageId = id + "-followup", text = "tell Bo the coffee shop is open.";
    expect(await open(senderPhone, messageId, text)).toBe(sender);
    const followup = await post({ channel: "blooio", messageId, app: "friends", memberId: sender, itemId: null, text });
    expect(await followup.json()).toMatchObject({ decision: "pass", delivered: false });
  }
}, 60_000);
