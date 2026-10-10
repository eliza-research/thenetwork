// peon job seats from job postings (#9), on Postgres: the rows a hiring manager's postings leave in
// network.members, network.intents and network.facets -> loadSnapshot (app peon) -> the peon pack
// hook (packs.ts) -> the engine with peonPack. A posting is a seat with capacity = openings; a seat
// that is full or closed gets no new match; a minor's posting gets no seat; a minor is never matched.
// Synthetic data only, in a database of its own. Nothing is sent.
import {afterAll,beforeAll,expect,test} from "bun:test";
import {randomUUID} from "node:crypto";
import {SQL} from "bun";
import {DAY} from "@thenetwork/core";
import {peonPack,PEON_ENGINE_CONFIG,runEngine,type EngineInput} from "@thenetwork/engine";
import {applySchema} from "../../observatory/db/dev-pg.ts";
import {appWiring} from "../service/packs.ts";
import {loadSnapshot} from "../service/snapshot.ts";

const db=`network_peon_seats_${randomUUID().replaceAll("-","")}`;
const admin=new SQL({url:`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/postgres`,max:1});
const url=`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/${db}`;
const now=Date.UTC(2026,9,12,15);
let sql:SQL;

const prefs={categoriesOptIn:["professional"],quietHours:[22,8],romanceOptIn:false,formats:["one_to_one"],maxTravelMinutes:45,onlyWhenAsked:false};
const CANDIDATES=["c1","c2","c3","c4","c5","c6"] as const;

beforeAll(async()=>{
  await admin.unsafe(`create database ${db}`);await applySchema(url,{lockTimeout:"5s"});sql=new SQL({url,max:2});
  const at=new Date(now-10*DAY);
  await sql.begin(async tx=>{
    await tx`select set_config('app.app_id','peon',true)`;
    const member=(id:string,name:string,age:number)=>tx`insert into network.members(app_id,id,name,home_city,account_status,participation_state,age,prefs,joined_at)
      values('peon',${id},${name},'nyc','active','normal',${age},${prefs}::jsonb,${at})`;
    const facet=(member:string,id:string,kind:string,value:string,tags:string[],scope="matchable")=>tx`insert into network.facets(app_id,id,member_id,kind,value,tags,privacy_scope,provenance,source,confidence,status,valid_from)
      values('peon',${id},${member},${kind},${value},${tx.array(tags,"TEXT")},${scope},'said','chat',0.9,'confirmed',${at})`;
    const intent=(member:string,id:string,objective:string,details:string,status:string)=>tx`insert into network.intents(app_id,id,member_id,objective,category,details,horizon_days,status,created_at)
      values('peon',${id},${member},${objective},'professional',${details},90,${status},${at})`;
    const home=(member:string)=>tx`insert into network.presence(app_id,member_id,city,type,areas) values('peon',${member},'nyc','home',${tx.array(["brooklyn"],"TEXT")})`;
    // Two hiring managers: an adult with an open posting (2 openings) and a closed one, and a minor with one posting.
    await member("hm1","Rowan Abbott",34);await home("hm1");
    await member("hm2","Kai Lee",16);await home("hm2");
    await facet("hm1","hm1-co","fact","Company: Acme",["peon:company:acme"],"shareable");
    await facet("hm1","hm1-ver","fact","Employer verified",["peon:verified"]);
    await facet("hm2","hm2-co","fact","Company: Kidco",["peon:company:kidco"],"shareable");
    await facet("hm2","hm2-ver","fact","Employer verified",["peon:verified"]);
    const posting=async(owner:string,id:string,openings:number,status:string)=>{
      await intent(owner,id,"Hire: data analyst (level 2)","peon:job openings",status);
      await facet(owner,`${id}-role`,"fact","data analyst role",["peon:family:data_analyst","peon:seniority:2",`peon:posting:${id}`],"shareable");
      await facet(owner,`${id}-pay`,"fact","Pay $90k-$120k",["peon:pay:90-120",`peon:posting:${id}`],"shareable");
      await facet(owner,`${id}-mode`,"fact","hybrid in brooklyn",["peon:mode:hybrid","peon:market:nyc","peon:area:brooklyn",`peon:posting:${id}`],"shareable");
      await facet(owner,`${id}-must`,"skill","Must have sql",["peon:must:sql:2",`peon:posting:${id}`],"shareable");
      await facet(owner,`${id}-open`,"fact","Openings",[`peon:openings:${openings}`,"peon:urgency:2","peon:sponsors:no",`peon:posting:${id}`]);
    };
    await posting("hm1","p1",2,"active");
    await posting("hm1","p2",3,"closed");
    await posting("hm2","p3",1,"active");
    // Six candidates who fit every posting; c6 is 15.
    for(const id of CANDIDATES){
      await member(id,`Cand ${id}`,id==="c6"?15:29);await home(id);
      await facet(id,`${id}-e`,"fact","Looking for work",["peon:entity:candidate"]);
      await facet(id,`${id}-g`,"goal","Wants data analyst work",["peon:family:data_analyst","peon:seniority:2"]);
      await facet(id,`${id}-s`,"skill","sql level 3",["peon:skill:sql:3"]);
      await facet(id,`${id}-f`,"preference","Pay floor",["peon:pay_floor:85"]);
      await facet(id,`${id}-m`,"preference","Work models",["peon:mode:hybrid","peon:area:brooklyn"]);
      await facet(id,`${id}-a`,"fact","Work authorization",["peon:auth:yes","peon:sponsorship:no","peon:start_weeks:2"]);
      await intent(id,`${id}-i`,"Find a data analyst role","peon:search","active");
    }
  });
},120_000);
afterAll(async()=>{await sql?.close();await admin.unsafe(`drop database if exists ${db} with (force)`);await admin.close();});

test("each open posting is a seat with capacity = openings; full and closed seats get no new match; minors never",async()=>{
  const snap=await loadSnapshot(sql,now,{app:"peon"});
  const ids=snap.members.map(m=>m.id);
  expect(ids).toContain("job:p1");expect(ids).toContain("job:p2");
  // A minor's posting gets no seat; the posting rows left the managers.
  expect(ids).not.toContain("job:p3");
  expect(snap.intents.some(i=>i.memberId==="hm1"&&i.details?.startsWith("peon:job"))).toBe(false);
  expect(snap.facets.some(f=>f.memberId==="hm1"&&f.tags.some(t=>t.startsWith("peon:posting:")))).toBe(false);
  const openings=(input:{facets:{memberId:string;tags:string[]}[]},seat:string)=>input.facets.filter(f=>f.memberId===seat).flatMap(f=>f.tags).filter(t=>t.startsWith("peon:openings:"));
  expect(openings(snap,"job:p1")).toEqual(["peon:openings:2"]);
  expect(openings(snap,"job:p2")).toEqual(["peon:openings:0"]);
  expect(snap.members.find(m=>m.id==="job:p1")?.age).toBe(18);

  const hook=appWiring("peon").hooks!.engineInput!;
  const base:EngineInput={...snap,interactions:[]};
  const run=async(input:EngineInput)=>(await runEngine(hook(input),{...PEON_ENGINE_CONFIG,cities:["nyc"],seed:1},{pack:peonPack})).proposals;

  // Empty seat: at most 2 candidates for p1 (one per opening), none for the closed p2, never c6.
  const first=await run(base);
  const toP1=first.filter(p=>p.participants.includes("job:p1"));
  expect(toP1.length).toBeGreaterThan(0);
  expect(toP1.length).toBeLessThanOrEqual(2);
  for(const p of first){
    expect(p.participants.includes("job:p2")||p.participants.includes("job:p3")).toBe(false);
    expect(p.participants.includes("c6")).toBe(false);
  }
  // One candidate accepted: one opening left. Two accepted: the seat is full and gets no new match.
  const accepted=(c:string)=>({id:`x-${c}`,kind:"intro" as const,category:"professional" as const,participants:[c,"job:p1"],at:now-DAY,outcome:"accepted" as const});
  const one=hook({...base,interactions:[accepted("c1")]});
  expect(openings(one,"job:p1")).toEqual(["peon:openings:1"]);
  expect((await run({...base,interactions:[accepted("c1")]})).filter(p=>p.participants.includes("job:p1")).length).toBeLessThanOrEqual(1);
  const full={...base,interactions:[accepted("c1"),accepted("c2")]};
  expect(openings(hook(full),"job:p1")).toEqual(["peon:openings:0"]);
  expect((await run(full)).some(p=>p.participants.includes("job:p1"))).toBe(false);
  // An intro still open in the Network holds an opening too.
  const inFlight=hook({...base,interactions:[accepted("c1")],openOpportunities:[{id:"o1",participants:["c3","job:p1"],stage:"inviting"}]});
  expect(openings(inFlight,"job:p1")).toEqual(["peon:openings:0"]);
},120_000);
