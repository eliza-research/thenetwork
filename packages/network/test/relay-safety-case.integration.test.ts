// A relay text that the relay policy blocks for what the sender wrote (a threat, a slur, a severe
// classifier label) reaches the staff safety console: the sender gets a safety case event with the
// reason family, never the words (PRD 32.11, F23, safety console "repeat-offender views"). Before,
// the desk logged the block and returned, so a threat left no staff surface but the relay log
// (SD-254). Real signed HTTP on Cloud's wire -> POST /internal/relay -> the ConsentNetwork relay desk.
// Needs the dev Postgres on :54339. No live call: the adapter is a dry run, rules only.
import {afterAll,beforeAll,expect,test} from "bun:test";
import {randomUUID} from "node:crypto";
import {SQL} from "bun";
import {SimClock,MINUTE,DAY} from "@thenetwork/core";
import {applySchema} from "../../observatory/db/dev-pg.ts";
import {svcSign} from "../../core/src/svc/svc-auth.ts";
import {TURN_PATH,RELAY_PATH,type RelaySendRequest,type TurnRequest} from "../../core/src/svc/contract.ts";
import {DryRunAdapter} from "../service/channel.ts";
import {NetworkService} from "../service/service.ts";
import {ServiceClient} from "../../observatory/src/sources/service.ts";

const db=`network_relay_case_${randomUUID().replaceAll("-","")}`;
const admin=new SQL({url:`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/postgres`,max:1});
const url=`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/${db}`;
const secret="synthetic-relay-fixture-secret-20261009",clock=new SimClock(Date.UTC(2026,9,9,16));
const phones={ari:"+12125550191",bo:"+12125550192"};
const logs:string[]=[];
let sql:SQL,service:NetworkService,server:ReturnType<typeof Bun.serve>,ari:string,bo:string;
const start=async()=>{
  service=new NetworkService({url,clock,photoStorage:null,instance:"relay-case-integration",tokens:"safety:saf-tok,reviewer:rev-tok",
    env:{PLATFORM_ENV:"dev",CLEF_RATINGS:"off",SERVICE_TURN_SECRET:secret},
    networks:[{id:"friends:nyc",matchingEnabled:false}],network:{seed:1},log:line=>{logs.push(line);},adapter:()=>new DryRunAdapter(()=>{})});
  await service.start();server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:req=>service.fetch(req)});
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
afterAll(async()=>{server?.stop(true);await service?.close();await sql?.close();await admin.unsafe(`drop database if exists ${db} with (force)`);await admin.close();});

test("SD-254: a threat that the relay blocks opens a staff case for the sender",async()=>{
  const cases=()=>service.runtimeFor("friends")!.readState(n=>n.exportState().cases);
  expect((await cases()).filter((c:any)=>c.memberId===ari)).toEqual([]);
  const res=await post(await ask("ari","relay-threat","tell Bo watch your back"));
  expect(await res.json()).toMatchObject({decision:"block",delivered:false});
  const mine=(await cases()).filter((c:any)=>c.memberId===ari);
  expect(mine.map((c:any)=>[c.status,c.events.map((e:any)=>e.kind)])).toEqual([["open",["relay_block:harass_severe"]]]);
  expect(JSON.stringify(mine)).not.toContain("back");
  // A block that is not about the words (nothing to send a photo with) opens nothing for the other member.
  expect(await (await post(await ask("bo","relay-photo","send Ari this photo"))).json()).toMatchObject({decision:"block"});
  expect((await cases()).filter((c:any)=>c.memberId===bo)).toEqual([]);
},60_000);
