// spec/staffSafetyService.md, "An agent signal goes to the decision that owns it"
// spec/staffSafetyService.md, "Safety staff decide a waiting agent signal once"
// Real signed HTTP -> NetworkService -> PostgreSQL, then the staff API on the same service.
import {afterAll,beforeAll,expect,test} from "vitest";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {serveHttp,type HttpServer} from "../../core/src/runtime/http.ts";
import {SQL} from "../../core/src/runtime/postgres.ts";
import {SimClock,MINUTE,HOUR} from "@thenetwork/core";
import {applySchema} from "../../observatory/db/dev-pg.ts";
import {MIGRATIONS_DIR} from "../../observatory/db/migrate.ts";
import {svcSign} from "../../core/src/svc/svc-auth.ts";
import {TURN_PATH,SIGNALS_PATH,type TurnRequest} from "../../core/src/svc/contract.ts";
import {DryRunAdapter} from "../service/channel.ts";
import {NetworkService} from "../service/service.ts";

const db=`network_agent_signals_${randomUUID().replaceAll("-","")}`;
const admin=new SQL({url:`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/postgres`,max:1});
const url=`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/${db}`;
const secret="synthetic-agent-signals-fixture-20261117",clock=new SimClock(Date.UTC(2026,10,17,16));
const phone="+12125550187",CANARY="AGENT_SIGNAL_EVIDENCE_CANARY";
let sql:SQL,service:NetworkService,server:HttpServer,memberId:string;
const logs:string[]=[];

const signed=async(path:string,body:object,id:string)=>{
  const raw=JSON.stringify(body);
  return fetch(new URL(path,server.url),{method:"POST",headers:{"content-type":"application/json",...await svcSign(secret,{method:"POST",path,id,body:raw,nowS:Math.floor(clock.now()/1000)})},body:raw});
};
const turn=(messageId:string,text:string,from=phone):TurnRequest=>({messageId,channel:"blooio",from,to:null,text,transport:"imessage",receivedAt:clock.now(),app:"friends"});
const sendTurn=async(messageId:string,text:string,from=phone)=>{clock.advance(MINUTE);const res=await signed(TURN_PATH,turn(messageId,text,from),messageId);if(res.status!==200)throw new Error(`turn ${messageId}: ${res.status} ${await res.text()}`);return res.json() as Promise<any>;};
const signal=(messageId:string,kind:string,member=memberId)=>{
  const body={channel:"blooio",messageId,app:"friends",memberId:member,signals:[{kind,evidence:CANARY}]};
  return signed(SIGNALS_PATH,body,`${messageId}:signals`);
};
const staff=(token:string,method:string,path:string,body?:unknown)=>service.fetch(new Request(`http://127.0.0.1/apps/friends${path}`,
  {method,headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})}));

beforeAll(async()=>{
  await admin.unsafe(`create database ${db}`);await applySchema(url,{lockTimeout:"5s"});sql=new SQL({url,max:4});
  service=new NetworkService({url,clock,photoStorage:null,instance:"agent-signals-integration",env:{PLATFORM_ENV:"dev",CLEF_RATINGS:"off",SERVICE_TURN_SECRET:secret},
    networks:[{id:"friends:nyc",matchingEnabled:false}],network:{seed:1},log:(line:string)=>{logs.push(line);},tokens:"safety@friends:saf-tok,reviewer@friends:rev-tok",
    adapter:()=>new DryRunAdapter(()=>{})});
  await service.start();server=await serveHttp({hostname:"127.0.0.1",port:0,fetch:req=>service.fetch(req)});
  for(const [index,text] of ["friends.help","Ari, 29","I enjoy hiking and cooking","Saturday afternoons work for me","Small groups are good"].entries()) await sendTurn(`setup-${index}`,text);
  const opened=await sendTurn("concern-open","Tell me something about the weather");expect(opened.outcome).toBe("open");memberId=opened.memberId;
},120_000);
afterAll(async()=>{await server?.stop(true);await service?.close();await sql?.close();await admin.unsafe(`drop database if exists ${db} with (force)`);await admin.close();});

test("a safety concern opens the member's case and waits until safety staff decide it once, with audits and no evidence outside the signal",async()=>{
  expect(await (await staff("rev-tok","GET","/signals")).json()).toEqual({ok:true,signals:[]});
  const recorded=await signal("concern-open","safety_concern");
  expect(recorded.status).toBe(200);expect(await recorded.json()).toEqual({recorded:1});
  expect(await (await signal("concern-open","safety_concern")).json()).toEqual({recorded:1});
  const cases=await service.runtimeFor("friends")!.readState(n=>n.safetyCases().filter(c=>c.memberId===memberId));
  expect(cases).toHaveLength(1);expect(cases[0]).toMatchObject({status:"open"});
  expect(cases[0]!.events.filter(e=>e.kind==="agent_safety_concern")).toHaveLength(1);
  expect(JSON.stringify(cases)).not.toContain(CANARY);
  const listed=await (await staff("rev-tok","GET","/signals")).json() as any;
  expect(listed.signals).toEqual([{id:expect.any(String),memberId,kind:"safety_concern",evidence:CANARY,at:clock.now(),caseId:cases[0]!.id}]);
  const id=encodeURIComponent(listed.signals[0].id);
  expect((await staff("rev-tok","POST",`/signals/${id}`,{decision:"reviewed",reason:"Checked the case notes"})).status).toBe(403);
  expect((await staff("saf-tok","POST",`/signals/${id}`,{decision:"reviewed",reason:"ok"})).status).toBe(400);
  expect((await staff("saf-tok","POST","/signals/service-signal%3Aunknown%3A0",{decision:"dismissed",reason:"No such signal here"})).status).toBe(404);
  const decided=await staff("saf-tok","POST",`/signals/${id}`,{decision:"reviewed",reason:"Checked the case notes"});
  expect(decided.status).toBe(200);expect(await decided.json()).toEqual({ok:true});
  expect((await staff("saf-tok","POST",`/signals/${id}`,{decision:"dismissed",reason:"A second decision"})).status).toBe(409);
  expect(await (await staff("rev-tok","GET","/signals")).json()).toEqual({ok:true,signals:[]});
  expect((await sql`select status from network.facets where app_id='friends' and member_id=${memberId} and value=${CANARY}`).map(r=>r.status)).toEqual(["confirmed"]);
  const audits=await sql`select action,ok,target_id,detail from network.staff_audit where app_id='friends' and action='decide_agent_signal' order by id`;
  expect(audits.map(a=>[a.ok,a.detail.phase,a.detail.refused??null])).toEqual([
    [true,"requested",null],[false,"refused","unknown_signal"],[true,"requested",null],[true,"requested",null],[false,"refused","already_decided"]]);
  expect(audits[2]!.target_id).toBe(memberId);
  expect(JSON.stringify(await sql`select detail,reason from network.staff_audit`)).not.toContain(CANARY);
  expect(JSON.stringify(await sql`select payload from network.events where app_id='friends'`)).not.toContain(CANARY);
  expect((await service.runtimeFor("friends")!.readState(n=>n.safetyCases().filter(c=>c.memberId===memberId)))[0]).toMatchObject({status:"open"});
},60_000);

test("an opt-out pauses matching in that app only, once, and leaves carrier consent to STOP",async()=>{
  const opened=await sendTurn("opt-out-open","Tell me something about the weather");expect(opened.outcome).toBe("open");
  const before=await sql`select participation_state from network.members where app_id='friends' and id=${memberId}`;
  expect(before[0]!.participation_state).not.toBe("paused");
  const recorded=await signal("opt-out-open","opt_out");expect(recorded.status).toBe(200);expect(await recorded.json()).toEqual({recorded:1});
  expect(await (await signal("opt-out-open","opt_out")).json()).toEqual({recorded:1});
  expect((await sql`select participation_state,participation_window from network.members where app_id='friends' and id=${memberId}`)[0])
    .toEqual({participation_state:"paused",participation_window:null});
  const events=await sql`select actor_type,payload from network.events where app_id='friends' and type='member_state_requested' and object_id=${memberId}`;
  expect(events.map(e=>[e.actor_type,e.payload.state,e.payload.source])).toEqual([["agent","paused","agent_signal"]]);
  expect(await (await staff("rev-tok","GET","/signals")).json()).toEqual({ok:true,signals:[]});
  const after=await sendTurn("after-opt-out","Tell me something about the weather");
  expect(after.outcome).toBe("open");
},60_000);

test("an opt-out that an older version stored as waiting is applied once by the migration and is never listed as waiting",async()=>{
  const signalled=new Date(clock.now()+HOUR),legacyId="service-signal:legacy-opt-out:0";
  await sql`update network.members set participation_state='normal',participation_window=null where app_id='friends' and id=${memberId}`;
  await sql`insert into network.facets(app_id,id,member_id,kind,value,tags,privacy_scope,provenance,source,status,valid_from)
    values('friends',${legacyId},${memberId},'fact',${CANARY},${sql.array(["signal:opt_out"],"TEXT")},'agent_private','inferred','chat','proposed',${signalled})`;
  expect(await (await staff("rev-tok","GET","/signals")).json()).toEqual({ok:true,signals:[]});
  expect((await staff("saf-tok","POST",`/signals/${encodeURIComponent(legacyId)}`,{decision:"reviewed",reason:"Checked the old opt-out"})).status).toBe(404);
  const migration=readFileSync(join(MIGRATIONS_DIR,"0080_agent_opt_out_signals_applied.sql"),"utf8");
  const agentPauses=async()=>(await sql`select actor_type,payload from network.events where app_id='friends' and type='member_state_requested' and object_id=${memberId} order by id`)
    .map(e=>[e.actor_type,e.payload.state,e.payload.source]);
  await sql.unsafe(migration);
  expect((await sql`select participation_state,participation_window from network.members where app_id='friends' and id=${memberId}`)[0])
    .toEqual({participation_state:"paused",participation_window:null});
  expect((await sql`select status from network.facets where app_id='friends' and id=${legacyId}`).map(r=>r.status)).toEqual(["confirmed"]);
  expect(await agentPauses()).toEqual([["agent","paused","agent_signal"],["agent","paused","agent_signal"]]);
  await sql.unsafe(migration);
  expect(await agentPauses()).toEqual([["agent","paused","agent_signal"],["agent","paused","agent_signal"]]);
  await sql`update network.members set participation_state='normal' where app_id='friends' and id=${memberId}`;
  await sql`delete from network.events where app_id='friends' and type='member_state_requested' and object_type='member' and object_id=${memberId} and at>=${signalled}`;
  expect((await sql`select count(*)::int as n from network.events where app_id='friends' and type='member_state_requested' and object_id=${memberId} and at>=${signalled}`)[0]!.n).toBe(0);
  await sql`insert into network.events(app_id,at,actor_type,actor_id,type,object_type,object_id,payload)
    values('friends',${new Date(signalled.getTime()+MINUTE)},'member',${memberId},'member_state_requested','member',${memberId},${{state:"normal",from:null,until:null}}::jsonb)`;
  await sql`update network.facets set status='proposed' where app_id='friends' and id=${legacyId}`;
  await sql.unsafe(migration);
  expect((await sql`select participation_state from network.members where app_id='friends' and id=${memberId}`)[0]!.participation_state).toBe("normal");
  expect((await sql`select status from network.facets where app_id='friends' and id=${legacyId}`).map(r=>r.status)).toEqual(["confirmed"]);
},60_000);

test("a waiting signal of a member under 18 is listed to reviewer staff without its evidence, and safety staff read it",async()=>{
  const teen="+12125550188";
  for(const [index,text] of ["friends.help","Sam, 16","I enjoy drawing and music","Saturday afternoons work for me","Small groups are good"].entries()) await sendTurn(`teen-setup-${index}`,text,teen);
  const opened=await sendTurn("teen-concern","Tell me something about the weather",teen);
  expect(opened.outcome).toBe("open");
  const teenId=opened.memberId as string;
  expect(teenId).not.toBe(memberId);
  expect((await signal("teen-concern","safety_concern",teenId)).status).toBe(200);
  const listed=async(token:string)=>((await (await staff(token,"GET","/signals")).json()) as any).signals.filter((s:any)=>s.memberId===teenId);
  expect(await listed("rev-tok")).toEqual([{id:expect.any(String),memberId:teenId,kind:"safety_concern",minor:true,at:clock.now(),caseId:expect.any(String)}]);
  expect(await listed("saf-tok")).toEqual([{id:expect.any(String),memberId:teenId,kind:"safety_concern",evidence:CANARY,at:clock.now(),caseId:expect.any(String)}]);
  expect(JSON.stringify(await (await staff("rev-tok","GET","/signals")).json())).not.toContain(CANARY);
},60_000);

test("a safety concern whose work fails stays unresolved and raises an alert that names the app and the member",async()=>{
  const opened=await sendTurn("concern-fault","Tell me something about the weather");expect(opened.outcome).toBe("open");
  const runtime=service.runtimeFor("friends")!,original=runtime.unitOfWork;
  runtime.unitOfWork=async()=>{throw new Error("synthetic safety unit fault");};
  const mark=logs.length;
  try {
    const failed=await signal("concern-fault","safety_concern");
    expect(failed.status).toBe(409);expect(await failed.json()).toEqual({error:"action_unresolved",retryable:false});
  } finally { runtime.unitOfWork=original; }
  expect(logs.slice(mark).filter(line=>line.startsWith("[alert] friends:")&&line.includes(memberId)&&line.includes("ended unresolved"))).toHaveLength(1);
  expect(await (await signal("concern-fault","safety_concern")).json()).toEqual({error:"action_unresolved",retryable:false});
  expect(logs.slice(mark).filter(line=>line.includes("ended unresolved"))).toHaveLength(1);
},60_000);
