// Real signed HTTP -> POST /internal/relay -> the ConsentNetwork relay desk (engine relay policy, rules only)
// -> network.messages / network.relay_records; the staff held queue; a restart. Needs the dev Postgres on
// :54339 (bun run packages/observatory/db/dev-pg.ts up). No live call: the adapter is a dry run and no
// Cloudflare token is set, so the classifier is rules only.
import {afterAll,beforeAll,expect,test} from "bun:test";
import {randomUUID} from "node:crypto";
import {SQL} from "bun";
import {SimClock,MINUTE,DAY} from "@thenetwork/core";
import {applySchema} from "../../observatory/db/dev-pg.ts";
import {svcSign} from "../../core/src/svc/svc-auth.ts";
import {TURN_PATH,type TurnRequest} from "../../core/src/svc/contract.ts";
import {DryRunAdapter} from "../service/channel.ts";
import {NetworkService} from "../service/service.ts";
import {RELAY_PATH,type RelayRequest} from "../service/relay-endpoint.ts";
import {ServiceClient} from "../../observatory/src/sources/service.ts";

const db=`network_relay_${randomUUID().replaceAll("-","")}`;
const admin=new SQL({url:`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/postgres`,max:1});
const url=`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/${db}`;
const secret="synthetic-relay-fixture-secret-20261009",clock=new SimClock(Date.UTC(2026,9,9,16));
const phones={ari:"+12125550181",bo:"+12125550182"};
const logs:string[]=[];
let sql:SQL,service:NetworkService,server:ReturnType<typeof Bun.serve>,ari:string,bo:string;
const start=async()=>{
  service=new NetworkService({url,clock,photoStorage:null,instance:"relay-integration",tokens:"safety:saf-tok,reviewer:rev-tok",
    env:{PLATFORM_ENV:"dev",CLEF_RATINGS:"off",SERVICE_TURN_SECRET:secret},
    networks:[{id:"friends:nyc",matchingEnabled:false}],network:{seed:1},log:line=>{logs.push(line);},adapter:()=>new DryRunAdapter(()=>{})});
  await service.start();server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:req=>service.fetch(req)});
};
const signed=async(path:string,id:string,raw:string)=>fetch(new URL(path,server.url),{method:"POST",body:raw,
  headers:{"content-type":"application/json",...await svcSign(secret,{method:"POST",path,id,body:raw,nowS:Math.floor(clock.now()/1000)})}});
const turn=(from:string,messageId:string,text:string):TurnRequest=>({messageId,channel:"blooio",from,to:null,text,transport:"imessage",receivedAt:clock.now(),app:"friends"});
const open=async(from:string,messageId:string)=>{
  const r=await signed(TURN_PATH,messageId,JSON.stringify(turn(from,messageId,"Tell me something about the weather")));expect(r.status).toBe(200);
  const body=await r.json() as any;expect(body.outcome).toBe("open");return body.memberId as string;
};
const relay=(over:Partial<RelayRequest>&{idempotencyKey:string}):RelayRequest=>({channel:"blooio",messageId:"ari-open",app:"friends",memberId:ari,kind:"text",text:null,photoIds:null,...over});
const post=async(body:RelayRequest)=>{const raw=JSON.stringify(body);return signed(RELAY_PATH,body.idempotencyKey,raw);};
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
afterAll(async()=>{server?.stop(true);await service?.close();await sql?.close();await admin.unsafe(`drop database if exists ${db} with (force)`);await admin.close();});

test("a relayed text is signed, size-checked, bound to the open turn, idempotent, and only the engine wording goes out",async()=>{
  expect(logs).toContain("relay classifier: rules only");
  const ok=relay({idempotencyKey:"relay-1",text:"running 10 min late, see you at the trailhead"});
  expect((await signed(RELAY_PATH,"relay-1",JSON.stringify({...ok,memberId:bo}))).status).toBe(403);
  expect((await signed(RELAY_PATH,"other-key",JSON.stringify(ok))).status).toBe(400);
  expect((await post({...ok,messageId:"ari-setup-0"})).status).toBe(403);
  expect((await post({...relay({idempotencyKey:"too-big"}),text:"x".repeat(20_000)})).status).toBe(413);
  const unsigned=await fetch(new URL(RELAY_PATH,server.url),{method:"POST",body:JSON.stringify(ok),headers:{"content-type":"application/json"}});expect(unsigned.status).toBe(401);
  const first=await post(ok);expect(first.status).toBe(200);
  expect(await first.json()).toEqual({decision:"sent",reason:"Sent.",replayed:false});
  expect(await (await post(ok)).json()).toEqual({decision:"sent",reason:"Sent.",replayed:true});
  expect((await post({...ok,text:"something else"})).status).toBe(409);
  const rows=await sql`select id,member_id,body,type from network.messages where app_id='friends' and id like 'relay:%'`;
  expect(rows.map((r:any)=>[r.member_id,r.body,r.type])).toEqual([[bo,'Ari says: "running 10 min late, see you at the trailhead"',"relay"]]);
  const records=await sql`select * from network.relay_records where app_id='friends'`;
  expect(records).toHaveLength(1);expect(records[0]).toMatchObject({from_member:ari,to_member:bo,decision:"pass",kind:"text"});
  expect(JSON.stringify(records)).not.toContain("trailhead");
},60_000);

test("a scam is held for staff; staff list it (audited, app-scoped), reject it, and the text is gone; it all survives a restart",async()=>{
  const held=await post(relay({idempotencyKey:"relay-scam",text:"can you venmo me 200 for the tickets? my card got frozen"}));
  expect(await held.json()).toMatchObject({decision:"held",replayed:false});
  expect((await staff("/staff/relay/held?app=friends","nobody")).status).toBe(401);
  const list=await (await staff("/staff/relay/held?app=friends","rev-tok")).json() as any;
  expect(list.items).toHaveLength(1);expect(list.items[0]).toMatchObject({app:"friends",from:ari,memberId:ari,kind:"text"});
  // The console's HeldText shape (packages/observatory/src/sources/service.ts): `id` is the item; no recipient id that the console would mask as a phone.
  expect(list.items[0].id).toBe(list.items[0].itemId);expect(list.items[0]).not.toHaveProperty("to");
  expect(JSON.stringify(list)).not.toMatch(/score|rating/i);
  const id=list.items[0].itemId as string;
  expect((await staff(`/staff/relay/${id}/reject?app=friends`,"rev-tok","POST",{})).status).toBe(403);
  server.stop(true);await service.close();await start();
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
  expect((await sql`select id from network.messages where app_id='friends' and body like '%venmo%'`).length).toBe(0);
},60_000);

test("a swap request lasts only as long as the engine's consent (15 min, never backdated) and a member can take it back",async()=>{
  const numbers=async()=>(await sql`select id from network.messages where app_id='friends' and (body like ${"%"+phones.ari.slice(2)+"%"} or body like ${"%"+phones.bo.slice(2)+"%"})`).length;
  expect(await (await post(relay({idempotencyKey:"ttl-ari",kind:"contact_share"}))).json()).toMatchObject({decision:"held"});
  // 16 minutes later Bo asks: Ari's consent is stale, so nothing is shared; Bo's request now waits for Ari instead.
  clock.advance(16*MINUTE);
  expect(await (await post(relay({idempotencyKey:"ttl-bo",kind:"contact_share",messageId:"bo-open",memberId:bo}))).json()).toMatchObject({decision:"held"});
  expect(await numbers()).toBe(0);
  // Bo changes their mind in a plain message ("don't send my number"): the pending request is gone.
  clock.advance(MINUTE);
  expect((await signed(TURN_PATH,"bo-withdraw",JSON.stringify(turn(phones.bo,"bo-withdraw","actually please don't send my number")))).status).toBe(200);
  expect(await (await post(relay({idempotencyKey:"ttl-ari-2",kind:"contact_share"}))).json()).toMatchObject({decision:"held"});
  expect(await numbers()).toBe(0);
  // Ari takes theirs back through the relay action (kind contact_share_cancel); Bo asking now shares nothing either.
  expect(await (await post(relay({idempotencyKey:"ttl-ari-cancel",kind:"contact_share_cancel"}))).json()).toMatchObject({decision:"refused",reason:"Okay, I won't share your number."});
  expect(await (await post(relay({idempotencyKey:"ttl-bo-2",kind:"contact_share",messageId:"bo-open",memberId:bo}))).json()).toMatchObject({decision:"held"});
  expect(await numbers()).toBe(0);
  // Clean slate for the next test: Bo's request is withdrawn too.
  expect(await (await post(relay({idempotencyKey:"ttl-bo-cancel",kind:"contact_share_cancel",messageId:"bo-open",memberId:bo}))).json()).toMatchObject({decision:"refused"});
},60_000);

test("a number goes out only after both members asked for the swap",async()=>{
  const first=await post(relay({idempotencyKey:"swap-ari",kind:"contact_share"}));
  expect(await first.json()).toMatchObject({decision:"held"});
  expect((await sql`select id from network.messages where app_id='friends' and body like ${"%"+phones.ari.slice(2)+"%"}`).length).toBe(0);
  const second=await post(relay({idempotencyKey:"swap-bo",kind:"contact_share",messageId:"bo-open",memberId:bo}));
  expect(await second.json()).toMatchObject({decision:"sent"});
  const shares=await sql`select member_id,body from network.messages where app_id='friends' and id like 'relay:%' and body like '%asked me to send you%' order by member_id`;
  expect(shares.map((r:any)=>r.member_id).sort()).toEqual([ari,bo].sort());
  expect(shares.find((r:any)=>r.member_id===bo).body).toContain(phones.ari);
  expect(shares.find((r:any)=>r.member_id===ari).body).toContain(phones.bo);
  expect(JSON.stringify(await sql`select * from network.relay_records where app_id='friends'`)).not.toContain(phones.ari.slice(2));
  // The relay thread (stored state, and the classifier's context) keeps that a number was shared, never the number.
  const [{state}]=await sql`select state from network.network_state where id='friends:nyc'`;
  const threads=JSON.stringify((typeof state==="string"?JSON.parse(state):state).relay.threads);
  expect(threads).toContain("shared their number.");
  for(const p of Object.values(phones))expect(threads).not.toContain(p.slice(2));
  // Relay rows carry their network (migration 0031).
  expect((await sql`select distinct network_id from network.relay_records where app_id='friends'`).map((r:any)=>r.network_id)).toEqual(["friends:nyc"]);
},60_000);
