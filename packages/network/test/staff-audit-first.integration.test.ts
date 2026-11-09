// SD-135 (outbound D18): a staff decision on a held relay text and on a parked leak-review text writes its
// audit row before it acts (service.ts staffAction rule: no row, no action). The test makes every insert of
// that action into network.staff_audit fail, on the real service and Postgres, and checks that the item
// stays held. Needs the dev Postgres on :54339. No live call: the relay classifier is rules only and the
// queue's provider is a recording fake ("sim" kind).
import {afterAll,beforeAll,expect,test} from "bun:test";
import {randomUUID} from "node:crypto";
import {SQL} from "bun";
import {SimClock,MINUTE,DAY} from "@thenetwork/core";
import {applySchema} from "../../observatory/db/dev-pg.ts";
import {APPS} from "../../platform/src/apps.ts";
import {svcSign} from "../../core/src/svc/svc-auth.ts";
import {TURN_PATH,RELAY_PATH,type TurnRequest} from "../../core/src/svc/contract.ts";
import {BlooioAdapter} from "../service/channel.ts";
import {NetworkService} from "../service/service.ts";

const db=`network_audit_first_${randomUUID().replaceAll("-","")}`;
const admin=new SQL({url:`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/postgres`,max:1});
const url=`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/${db}`;
const secret="synthetic-audit-first-fixture-secret-20261108",clock=new SimClock(Date.UTC(2026,9,9,16));
const phones={ari:"+12125550191",bo:"+12125550192",cy:"+12125550193"};
let sql:SQL,service:NetworkService,server:ReturnType<typeof Bun.serve>;
const sent:string[]=[];
const provider={kind:"sim" as const,send:async(r:any)=>{sent.push(r.id??"");return {providerMessageId:`p${sent.length}`,status:"queued" as const};}};

const signed=async(path:string,id:string,raw:string)=>fetch(new URL(path,server.url),{method:"POST",body:raw,
  headers:{"content-type":"application/json",...await svcSign(secret,{method:"POST",path,id,body:raw,nowS:Math.floor(clock.now()/1000)})}});
const turn=(from:string,messageId:string,text:string):TurnRequest=>({messageId,channel:"blooio",from,to:null,text,transport:"imessage",receivedAt:clock.now(),app:"friends"});
const open=async(from:string,messageId:string,text:string)=>{
  clock.advance(MINUTE);
  const body=await (await signed(TURN_PATH,messageId,JSON.stringify(turn(from,messageId,text)))).json() as any;
  expect(body.outcome).toBe("open");return body.memberId as string;
};
const staff=(path:string,b:object)=>service.fetch(new Request(`http://127.0.0.1${path}`,{method:"POST",headers:{authorization:"Bearer saf-tok","content-type":"application/json"},body:JSON.stringify(b)}));
/** Every insert of this audit action fails (an audit store that is down for that write). */
const failAudit=async(action:string)=>{
  await sql.unsafe(`create or replace function pg_temp_audit_down() returns trigger language plpgsql as $$ begin raise exception 'audit store down'; end $$`);
  await sql.unsafe(`create trigger audit_down before insert on network.staff_audit for each row when (new.action = '${action}') execute function pg_temp_audit_down()`);
};
const restoreAudit=()=>sql.unsafe(`drop trigger if exists audit_down on network.staff_audit`);

beforeAll(async()=>{
  await admin.unsafe(`create database ${db}`);await applySchema(url,{lockTimeout:"5s"});sql=new SQL({url,max:4});
  service=new NetworkService({url,clock,photoStorage:null,instance:"audit-first",tokens:"safety:saf-tok",
    env:{PLATFORM_ENV:"dev",CLEF_RATINGS:"off",SERVICE_TURN_SECRET:secret},
    networks:[{id:"friends:nyc",matchingEnabled:false}],network:{seed:1},log:()=>{},
    adapter:(net,rt)=>new BlooioAdapter({from:"+12125550190",app:rt.app.id,net,provider,clock,memberOf:rt.memberOf,liveGate:()=>true,log:()=>{}})});
  await service.start();server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:req=>service.fetch(req)});
},120_000);
afterAll(async()=>{server?.stop(true);await service?.close();await sql?.close();await admin.unsafe(`drop database if exists ${db} with (force)`);await admin.close();});

test("relay reject: with the audit write down, the held text stays held",async()=>{
  for(const [who,name] of [["ari","Ari, 29"],["bo","Bo, 31"]] as const)for(const [index,text] of ["friends.help",name,"I enjoy hiking and cooking","Saturday afternoons work for me","Small groups are good"].entries()){
    clock.advance(MINUTE);expect((await signed(TURN_PATH,`${who}-setup-${index}`,JSON.stringify(turn(phones[who],`${who}-setup-${index}`,text)))).status).toBe(200);
  }
  const ari=await open(phones.ari,"ari-open","Tell me something about the weather"),bo=await open(phones.bo,"bo-open","Tell me something about the weather");
  const now=clock.now();
  await service.runtimeFor("friends")!.unitOfWork(net=>{
    const st=net.exportState();
    st.opps.push({id:"relay-op",origin:"engine",kind:"intro",category:"hobby",objective:"a hike",detail:"",participants:[ari,bo],alternates:[],primed:[],
      status:[[ari,"yes"],[bo,"yes"]],explanations:{},stage:"scheduled",deadline:now+DAY,createdAt:now,score:0.5,
      components:{fit:0,mutualBenefit:0,warmPath:0,novelty:0,timingFit:0,activationCost:0,interruptionCost:0,load:0,repetition:0,socialRisk:0,confidence:0},
      generator:"fixture",exploration:false,sameDay:false,contacted:[ari,bo],reminded:[],tags:[],replacements:0,feedbackFrom:[],meetingAt:now+DAY} as any);
    net.importState(st);
  });
  const text="tell Bo can you venmo me 200 for the tickets? my card got frozen";
  const memberId=await open(phones.ari,"relay-scam",text);
  const held=await signed(RELAY_PATH,"relay-scam:relay",JSON.stringify({channel:"blooio",messageId:"relay-scam",app:"friends",memberId,itemId:null,text}));
  expect(await held.json()).toMatchObject({decision:"hold"});
  const list=async()=>(await (await service.fetch(new Request("http://127.0.0.1/staff/relay/held?app=friends",{headers:{authorization:"Bearer saf-tok"}}))).json() as any).items.map((x:any)=>x.itemId);
  const [id]=await list();
  expect(id).toBeTruthy();
  await failAudit("relay_reject");
  try{
    expect((await staff(`/staff/relay/${id}/reject?app=friends`,{note:"asks for money: a scam"})).status).toBeGreaterThanOrEqual(500);
  }finally{await restoreAudit();}
  // No audit row, no action: the item is still held, and no review was recorded.
  expect(await list()).toEqual([id]);
  expect((await sql`select review from network.relay_records where app_id='friends' and item_id=${id}`)[0].review).not.toBe("rejected");
  // With the audit store back, the same decision runs and both rows are there.
  expect((await staff(`/staff/relay/${id}/reject?app=friends`,{note:"asks for money: a scam"})).status).toBe(200);
  expect(await list()).toEqual([]);
  expect((await sql`select detail->>'phase' as phase from network.staff_audit where action='relay_reject' and target_id=${id} order by id`).map((r:any)=>r.phase)).toEqual(["requested","result"]);
},60_000);

test("leak review drop: with the audit write down, the parked text stays parked",async()=>{
  const joined=await service.accounts.join(APPS.friends,{e164:phones.cy,personId:null},{firstName:"Cy",age:33,consent:{sms:true,wording:APPS.friends.consent.text}});
  expect(joined.ok).toBe(true);if(!joined.ok) throw new Error("Fixture join refused");
  const rt=service.runtimes.get("friends:nyc")!,memberId=joined.membership.memberId;
  await rt.adapter.engaged?.(phones.cy);
  await rt.unitOfWork(()=>rt.system(memberId,"canary-reply","Your code is CANARY_TEST_77_x","reply"));
  expect((await sql`select status from platform.outbound where id='canary-reply'`)[0].status).toBe("parked_leak_review");
  await failAudit("leak_drop");
  try{
    expect((await staff("/queue/leak-review/canary-reply?app=friends",{decision:"drop",reason:"a test canary, never send"})).status).toBeGreaterThanOrEqual(500);
  }finally{await restoreAudit();}
  // No audit row, no action: the text is still parked for staff.
  expect((await sql`select status from platform.outbound where id='canary-reply'`)[0].status).toBe("parked_leak_review");
  expect(await (await staff("/queue/leak-review/canary-reply?app=friends",{decision:"drop",reason:"a test canary, never send"})).json()).toEqual({ok:true});
  expect((await sql`select status from platform.outbound where id='canary-reply'`)[0].status).toBe("dropped_leak_review");
  expect((await sql`select detail->>'phase' as phase from network.staff_audit where action='leak_drop' and target_id='canary-reply' order by id`).map((r:any)=>r.phase)).toEqual(["requested","result"]);
},60_000);
