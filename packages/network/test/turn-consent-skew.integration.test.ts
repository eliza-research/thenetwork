// Integration: the consent machine on a signed /internal/turn (docs/design/eliza-conversation-layer.md). A STOP
// carries the gateway's receivedAt; a web join has the backend's time. When the gateway clock is behind, the STOP
// must still stop the member, as the gateway's fence is told. Real service, HTTP and PostgreSQL on the dev
// cluster (:54339). Sends are dry-run; nothing leaves the machine.
import {afterAll,beforeAll,expect,test} from "bun:test";
import {randomUUID} from "node:crypto";
import {SQL} from "bun";
import {SimClock} from "@thenetwork/core";
import {applySchema,DEV_PG_PORT} from "../../observatory/db/dev-pg.ts";
import {APPS} from "../../platform/src/apps.ts";
import {svcSign} from "../../core/src/svc/svc-auth.ts";
import {TURN_PATH,type TurnRequest} from "../../core/src/svc/contract.ts";
import {DryRunAdapter} from "../service/channel.ts";
import {NetworkService} from "../service/service.ts";

const db=`network_turn_consent_skew_${randomUUID().replaceAll("-","")}`;
const admin=new SQL({url:`postgres://${process.env.USER??"postgres"}@127.0.0.1:${DEV_PG_PORT}/postgres`,max:1});
const url=`postgres://${process.env.USER??"postgres"}@127.0.0.1:${DEV_PG_PORT}/${db}`;
const secret="synthetic-turn-consent-skew-secret-20261108";
const clock=new SimClock(Date.UTC(2026,9,9,16));
let sql:SQL,service:NetworkService,server:ReturnType<typeof Bun.serve>;

const post=async(input:TurnRequest)=>{
  const body=JSON.stringify(input);
  return fetch(new URL(TURN_PATH,server.url),{method:"POST",headers:{"content-type":"application/json",...await svcSign(secret,{method:"POST",path:TURN_PATH,id:input.messageId,body,nowS:Math.floor(clock.now()/1000)})},body});
};
beforeAll(async()=>{
  await admin.unsafe(`create database ${db}`);await applySchema(url,{lockTimeout:"5s"});sql=new SQL({url,max:2});
  service=new NetworkService({url,clock,photoStorage:null,instance:"turn-consent-skew",
    env:{PLATFORM_ENV:"dev",PLATFORM_HASH_KEY:"synthetic-turn-consent-skew-hash-key",CLEF_RATINGS:"off",SERVICE_TURN_SECRET:secret},
    networks:[{id:"slop:nyc",matchingEnabled:false},{id:"friends:nyc",matchingEnabled:false}],network:{seed:1},
    adapter:()=>new DryRunAdapter(()=>{}),log:()=>{}});
  await service.start();
  server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:req=>service.fetch(req)});
},120_000);
afterAll(async()=>{server?.stop(true);await service?.close();await sql?.close();
  await admin.unsafe(`drop database if exists ${db} with (force)`).catch(()=>{});await admin.close();});

for (const app of ["slop","friends"] as const) test(`a STOP whose gateway time is 1 s before a ${app} web join still stops the member`,async()=>{
  const phone=app==="slop"?"+12125550221":"+12125550222";
  // The web join is written at the backend's time T.
  const joined=await service.accounts.join(APPS[app],{e164:phone,personId:null},{firstName:"Ana",age:30,consent:{sms:true,wording:APPS[app].consent.text}});
  if (!joined.ok) throw new Error("Fixture join refused");
  clock.advance(2_000);
  // The person texts STOP. The gateway's clock is 3 s behind the backend's: its receivedAt is T - 1 s.
  const stop:TurnRequest={messageId:`skew-stop-${app}`,from:phone,text:"STOP",channel:"blooio",to:null,transport:"imessage",receivedAt:clock.now()-3_000,app};
  const response=await post(stop);
  expect(response.status).toBe(200);
  const body=await response.json() as {outcome:string;consent?:{state:string}};
  expect(body.outcome).toBe("handled");
  expect(body.consent?.state).toBe("opted_out");
  // The backend agrees with the gateway's fence: the ledger, the membership and the network member are stopped.
  expect(await service.accounts.optedIn(app,phone)).toBe(false);
  const [m]=await sql`select ms.state, mem.opted_out from platform.memberships ms join network.members mem on mem.app_id=ms.app_id and mem.id=ms.member_id
    where ms.app_id=${app} and ms.member_id=${joined.membership.memberId}`;
  expect(m).toEqual({state:"paused",opted_out:true});
},60_000);
