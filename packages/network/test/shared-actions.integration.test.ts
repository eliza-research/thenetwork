// Real signed HTTP -> NetworkService -> original inbound/action receipts -> canonical PostgreSQL owners.
import {afterAll,beforeAll,expect,test} from "bun:test";
import {randomUUID} from "node:crypto";
import {SQL} from "bun";
import {SimClock,MINUTE} from "@thenetwork/core";
import {applySchema} from "../../observatory/db/dev-pg.ts";
import {svcSign} from "../../core/src/svc/svc-auth.ts";
import {TURN_PATH,SET_STATE_PATH,SIGNALS_PATH,UPDATES_PATH,type TurnRequest} from "../../core/src/svc/contract.ts";
import {DryRunAdapter} from "../service/channel.ts";
import {NetworkService} from "../service/service.ts";

const db=`network_signed_actions_${randomUUID().replaceAll("-","")}`;
const admin=new SQL({url:`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/postgres`,max:1});
const url=`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/${db}`;
const secret="synthetic-signed-actions-fixture-20261009",clock=new SimClock(Date.UTC(2026,9,9,16));
const phone="+12125550181";
let sql:SQL,service:NetworkService,server:ReturnType<typeof Bun.serve>,memberId:string,personId:string;
let escaped=0;
const start=async()=>{
  service=new NetworkService({url,clock,photoStorage:null,instance:"signed-actions-integration",env:{PLATFORM_ENV:"dev",CLEF_RATINGS:"off",SERVICE_TURN_SECRET:secret},
    networks:[{id:"friends:nyc",matchingEnabled:false},{id:"slop:nyc",matchingEnabled:false}],network:{seed:1},log:()=>{},
    adapter:()=>{const a=new DryRunAdapter(()=>{});a.deliver=async rows=>{escaped+=rows.length;return rows.map(row=>({id:row.id,status:"dry_run"}));};a.direct=async()=>{escaped++;return "dry_run";};return a;}});
  await service.start();server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:req=>service.fetch(req)});
};
const post=async(path:string,body:object,signedPath=path)=>{
  const fields=body as Record<string,unknown>;
  const raw=JSON.stringify(body),id=path===SET_STATE_PATH?String(fields.idempotencyKey):path===SIGNALS_PATH?`${fields.messageId}:signals`:path===UPDATES_PATH?`${fields.messageId}:updates`:String(fields.messageId);
  return fetch(new URL(path,server.url),{method:"POST",headers:{"content-type":"application/json",...await svcSign(secret,{method:"POST",path:signedPath,id,body:raw,nowS:Math.floor(clock.now()/1000)})},body:raw});
};
const turn=(messageId:string,text:string):TurnRequest=>({messageId,channel:"blooio",from:phone,to:null,text,transport:"imessage",receivedAt:clock.now(),app:"friends"});
const action=(messageId="action-open")=>({channel:"blooio",messageId,app:"friends",memberId});
const state=(key:string,extra:Record<string,unknown>={})=>({...action(),idempotencyKey:key,state:"busy",from:null,until:null,note:null,...extra});
beforeAll(async()=>{
  await admin.unsafe(`create database ${db}`);await applySchema(url,{lockTimeout:"5s"});sql=new SQL({url,max:4});await start();
  for(const [index,text] of ["friends.help","Ari, 29","I enjoy hiking and cooking","Saturday afternoons work for me","Small groups are good"].entries()){
    clock.advance(MINUTE);expect((await post(TURN_PATH,turn(`setup-${index}`,text))).status).toBe(200);
  }
  const opened=await post(TURN_PATH,turn("action-open","Tell me something about the weather"));expect(opened.status).toBe(200);
  const body=await opened.json() as any;expect(body.outcome).toBe("open");memberId=body.memberId;personId=(await service.accounts.personFor(phone))!.id;
},120_000);
afterAll(async()=>{server?.stop(true);await service?.close();await sql?.close();await admin.unsafe(`drop database if exists ${db} with (force)`);await admin.close();});

test("state and private signals are bound to the original open turn and commit once with receipts",async()=>{
  const before=escaped;
  expect((await post(SET_STATE_PATH,state("wrong-path"),"/wrong/internal/set-state")).status).toBe(401);
  expect((await post(SET_STATE_PATH,state("bad-turn",{messageId:"setup-0"}))).status).toBe(403);
  expect((await post(SET_STATE_PATH,state("bad-member",{memberId:"someone_else"}))).status).toBe(403);
  expect((await post(SET_STATE_PATH,state("bad-app",{app:"slop"}))).status).toBe(403);
  expect((await post(SET_STATE_PATH,state("bad-window",{from:"tomorrow"}))).status).toBe(400);
  const first=await post(SET_STATE_PATH,state("state-once"));expect(first.status).toBe(200);const receipt=await first.json() as any;
  expect(receipt).toMatchObject({previous:"open",current:"busy",unchanged:false,replayed:false});expect(receipt.eventId).not.toBeNull();
  expect(await (await post(SET_STATE_PATH,state("state-once"))).json()).toEqual({...receipt,replayed:true});
  expect((await post(SET_STATE_PATH,state("state-once",{state:"paused"}))).status).toBe(409);
  const same=await post(SET_STATE_PATH,state("state-no-change"));expect(same.status).toBe(200);expect(await same.json()).toMatchObject({unchanged:true,eventId:null});
  expect((await sql`select participation_state from network.members where app_id='friends' and id=${memberId}`)[0].participation_state).toBe("quiet");
  expect((await sql`select id from network.events where app_id='friends' and type='member_state_requested' and actor_id=${memberId}`).length).toBe(1);
  const signals={...action(),signals:[{kind:"safety_concern",evidence:"PRIVATE_SIGNAL_CANARY"}]};
  const recorded=await post(SIGNALS_PATH,signals);expect(recorded.status).toBe(200);expect(await recorded.json()).toEqual({recorded:1});
  expect(await (await post(SIGNALS_PATH,signals)).json()).toEqual({recorded:1});
  expect((await post(SIGNALS_PATH,{...signals,signals:[{kind:"travel",evidence:"different"}]})).status).toBe(409);
  const facets=await sql`select value,privacy_scope,status from network.facets where app_id='friends' and member_id=${memberId} and value='PRIVATE_SIGNAL_CANARY'`;
  expect(facets).toHaveLength(1);expect(facets[0]).toMatchObject({privacy_scope:"agent_private",status:"proposed"});
  expect(JSON.stringify((await sql`select payload from network.events where app_id='friends' and type='network_signals_proposed'`))).not.toContain("PRIVATE_SIGNAL_CANARY");
  expect(JSON.stringify(await service.runtimeFor("friends")!.sharedContext(memberId))).not.toContain("PRIVATE_SIGNAL_CANARY");
  expect(escaped).toBe(before);
},60_000);

test("scheduled canonical state is projected only inside its window and survives restart",async()=>{
  const from=new Date(clock.now()+MINUTE).toISOString(),until=new Date(clock.now()+3*MINUTE).toISOString();
  const requested=await post(SET_STATE_PATH,state("future-travel",{state:"traveling",from,until}));expect(requested.status).toBe(200);
  expect((await service.runtimeFor("friends")!.sharedContext(memberId))!.state).toBe("busy");
  const same=await post(SET_STATE_PATH,state("future-travel-same",{state:"traveling",from,until}));expect(same.status).toBe(200);expect(await same.json()).toMatchObject({unchanged:true,eventId:null});
  clock.advance(2*MINUTE);expect(await service.runtimeFor("friends")!.sharedContext(memberId)).toMatchObject({state:"traveling",stateFrom:from,stateUntil:until});
  server.stop(true);await service.close();await start();
  expect(await service.runtimeFor("friends")!.sharedContext(memberId)).toMatchObject({state:"traveling",stateFrom:from,stateUntil:until});
  clock.advance(2*MINUTE);expect((await service.runtimeFor("friends")!.sharedContext(memberId))!.state).toBe("busy");
  expect((await post(SET_STATE_PATH,state("future-travel",{state:"traveling",from,until}))).status).toBe(200);
},60_000);

test("updates use the canonical app inbox and replay its original receipt; uncertain reads never repeat",async()=>{
  await service.notify!.add({personId,app:"friends",eventType:"fixture",subjectId:"own",urgency:"normal",summary:"Approved own update"},clock.now());
  await service.notify!.add({personId,app:"slop",eventType:"fixture",subjectId:"other-app",urgency:"normal",summary:"OTHER_APP_PRIVATE_CANARY"},clock.now());
  const first=await post(UPDATES_PATH,action());expect(first.status).toBe(200);const updates=await first.json();expect(updates).toEqual({items:[{summary:"Approved own update"}]});
  expect(await (await post(UPDATES_PATH,action())).json()).toEqual(updates);
  expect(await service.updatesFor(personId,"friends","web")).toEqual([]);
  const opened=await post(TURN_PATH,turn("unknown-updates-open","Tell me something about the weather"));expect((await opened.json() as any).outcome).toBe("open");
  const original=service.updatesFor.bind(service);let reads=0;
  service.updatesFor=async(...args)=>{reads++;await original(...args);throw new Error("synthetic after-read uncertainty");};
  expect((await post(UPDATES_PATH,action("unknown-updates-open"))).status).toBe(409);
  service.updatesFor=original;
  expect((await post(UPDATES_PATH,action("unknown-updates-open"))).status).toBe(409);expect(reads).toBe(1);
  const row=(await sql`select action_receipts from platform.inbound where id='msg:blooio:unknown-updates-open'`)[0];
  expect(Object.values(row.action_receipts).map((value:any)=>value.state)).toEqual(["unresolved"]);
},60_000);

test("an effect transaction fault rolls back canonical state and replay never repeats it; STOP revokes cached actions",async()=>{
  await sql.unsafe(`create function network.fail_action_fixture() returns trigger language plpgsql as $$ begin if new.type='member_state_requested' then raise exception 'synthetic action transaction fault'; end if; return new; end $$`);
  await sql.unsafe(`create trigger fail_action_fixture before insert on network.events for each row execute function network.fail_action_fixture()`);
  const fault=state("fault-state",{state:"open"});expect((await post(SET_STATE_PATH,fault)).status).toBe(409);
  await sql.unsafe(`drop trigger fail_action_fixture on network.events; drop function network.fail_action_fixture()`);
  expect((await sql`select participation_state from network.members where app_id='friends' and id=${memberId}`)[0].participation_state).toBe("quiet");
  expect((await post(SET_STATE_PATH,fault)).status).toBe(409);
  expect((await post(TURN_PATH,turn("actions-stop","STOP"))).status).toBe(200);
  expect((await post(SET_STATE_PATH,state("state-once"))).status).toBe(403);
  expect((await post(UPDATES_PATH,action())).status).toBe(403);
  expect((await sql`select id from platform.outbound where app_id='friends' and body like '%PRIVATE_SIGNAL_CANARY%'`).length).toBe(0);
  await service.accounts.deleteAll({e164:phone,personId});
  const erased=(await sql`select action_receipts,response from platform.inbound where id='msg:blooio:action-open'`)[0];
  expect(erased.action_receipts).toEqual({});expect(erased.response).toBeNull();
},60_000);
