// The cost ledger on Postgres (issue #11, ops monitoring): a relay Clef classifier call to Workers AI and
// an LLM attempt each write one network.cost_ledger row with the real app and purpose, codes and counts
// only. Needs the dev Postgres on :54339 (bun run packages/observatory/db/dev-pg.ts up). No live call:
// the classifier's telemetry events and the LLM response info are fed in directly.
import {afterAll,beforeAll,expect,test} from "bun:test";
import {randomUUID} from "node:crypto";
import {SQL} from "bun";
import {applySchema} from "../../observatory/db/dev-pg.ts";
import {CLEF_PRICE_PER_M_INPUT} from "../../engine/src/packs/slop/clef.ts";
import {CostLedger,costRatesFromEnv,PgCostSink,type CostRow} from "../service/cost.ts";
import {relayClassifierFromEnv} from "../service/relay-endpoint.ts";

const db=`network_cost_${randomUUID().replaceAll("-","")}`;
const admin=new SQL({url:`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/postgres`,max:1});
const url=`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/${db}`;
const clock={now:()=>Date.UTC(2026,9,9,15)};
let sql:SQL;

/** The Postgres sink, with the writes the ledger does not await (they never slow the call they measure). */
class Tracked extends PgCostSink {
  pending:Promise<void>[]=[];
  override write(rows:CostRow[]){const p=super.write(rows);this.pending.push(p);return p;}
  async flush(){await Promise.all(this.pending);this.pending=[];}
}

beforeAll(async()=>{await admin.unsafe(`create database ${db}`);await applySchema(url,{lockTimeout:"5s"});sql=new SQL({url,max:2});},120_000);
afterAll(async()=>{await sql?.close();await admin.unsafe(`drop database if exists ${db} with (force)`);await admin.close();});

test("each relay Clef call that reached Workers AI is a cost row for its app; a cached answer or a miss costs nothing",async()=>{
  await sql`delete from network.cost_ledger`;
  const sink=new Tracked(sql),ledger=new CostLedger({sink,clock,rates:costRatesFromEnv({})});
  const meter=ledger.relayClefEvent("slop");
  meter({model:"clef-flash",outcome:"ok",ms:120,inputTokens:1500,hold:["scam"],block:[],uncertain:false});
  meter({model:"clef-flash",outcome:"timeout",ms:2500,hold:[],block:[],uncertain:false,fallbackHold:true});
  meter({model:"clef-flash",outcome:"cached",ms:1,hold:[],block:[],uncertain:false});
  meter({model:"clef-flash",outcome:"miss",ms:1,hold:[],block:[],uncertain:false});
  await sink.flush();
  const rows=await sql`select app_id,kind,provider,cost_usd::float8 as usd,detail from network.cost_ledger order by detail->>'outcome'`;
  expect(rows).toHaveLength(2);
  expect(rows.map((r:any)=>[r.app_id,r.kind,r.provider,r.detail.purpose,r.detail.outcome])).toEqual([["slop","other","workers_ai","relay_classifier","ok"],["slop","other","workers_ai","relay_classifier","timeout"]]);
  expect(rows[0].usd).toBeCloseTo(1500*CLEF_PRICE_PER_M_INPUT["clef-flash"]/1e6,12);
  // Codes and counts only: no text, no category, no member.
  expect(Object.keys(rows[0].detail).sort()).toEqual(["inputTokens","model","outcome","purpose"]);

  // COST_CLEF_RELAY_USD is a flat price per call.
  await sql`delete from network.cost_ledger`;
  const flat=new CostLedger({sink,clock,rates:costRatesFromEnv({COST_CLEF_RELAY_USD:"0.0002"})});
  flat.relayClefEvent("friends")({model:"clef",outcome:"ok",ms:90,inputTokens:9000,hold:[],block:[],uncertain:false});
  await sink.flush();
  expect((await sql`select app_id,cost_usd::float8 as usd from network.cost_ledger`).map((r:any)=>[r.app_id,r.usd])).toEqual([["friends",0.0002]]);

  // Without a Workers AI token the relay is rules only: no hook, so no call and no row.
  expect(relayClassifierFromEnv({},()=>{},ledger)).toBeUndefined();
},60_000);

test("llmHooks writes one llm row per priced attempt with the real app and purpose",async()=>{
  await sql`delete from network.cost_ledger`;
  const sink=new Tracked(sql),ledger=new CostLedger({sink,clock});
  const {onResponse}=ledger.llmHooks("slop","slop_onboarding");
  const info={model:"gpt-6-luna",baseUrl:"https://api.surplus.example/v1",status:200,ok:true,latencyMs:800,attempt:0,regrows:0,request:{},
    usage:{promptTokens:900,completionTokens:120,reasoningTokens:0},costMicro:420,costKnown:true};
  onResponse!(info);
  onResponse!({...info,status:503,ok:false,attempt:1,costMicro:0,costKnown:false});
  await sink.flush();
  const rows=await sql`select app_id,kind,provider,cost_usd::float8 as usd,estimated,detail from network.cost_ledger`;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({app_id:"slop",kind:"llm",provider:"api.surplus.example",estimated:false});
  expect(rows[0].usd).toBeCloseTo(0.00042,12);
  expect(rows[0].detail).toEqual({purpose:"slop_onboarding",model:"gpt-6-luna",promptTokens:900,completionTokens:120,attempt:0});
},60_000);
