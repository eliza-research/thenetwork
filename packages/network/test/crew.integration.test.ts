import { expect, test } from "bun:test";
import { Mini, START } from "./mini.ts";
import { DAY, HOUR } from "@thenetwork/core";
export async function crewRows(){
 const rows=[];
 for(const seed of [1,2,3])for(const scenario of ["default-one","two-only-one","two-complete","two-insufficient-common","two-recurring"] as const){
  const minPlans=scenario==="default-one"?1:2;
  const rounds=scenario==="two-complete"||scenario==="two-insufficient-common"?2:1;
  const ids=["a","b","c","d","e","f"];
  const objective=scenario==="two-recurring"?"find a regular climbing partner":"find a climbing partner";
  const w=new Mini(ids.map((id,k)=>({id,name:`Person ${String.fromCharCode(65+k)}nton`,age:30,area:"Greenpoint",interests:["climbing","hiking"],skills:["belaying"],wants:[{objective,category:"hobby" as const}]})),{seed,review:"human",plans:true,matchingEnabled:true,maxNewPerDay:0,plansConfig:{crews:{minPlans}}});
  await w.onboard(...ids);
  const positives:string[][]=[];
  for(let round=0;round<rounds;round++){
   if(!await w.runUntil(()=>w.net.reviewQueue().some(q=>q.origin==="planner"),14*DAY))throw Error("No planner review");
   const q=w.net.reviewQueue().find(q=>q.origin==="planner")!;
   if(!w.net.review(q.oppId,"approve",{reviewer:"sim_staff"}))throw Error("Review refused");
   for(let k=0;k<12;k++){
    if(!await w.runUntil(()=>ids.some(id=>w.probed(id)),4*DAY))break;
    for(const id of ids)if(w.probed(id))await w.say(id,"yes");
    const o=w.net.exportState().opps.find(o=>o.id===q.oppId)!;
    if(o.stage==="scheduled"||o.stage==="closed")break;
   }
   const booked=w.net.exportState().opps.find(o=>o.id===q.oppId)!;
   if(booked.stage!=="scheduled")throw Error("Plan not booked");
   const going=booked.status.filter(([,s])=>s==="yes").map(([id])=>id);
   await w.run(booked.plan!.window.start+4*HOUR-w.clock.now());
   for(const id of going){
    const negative=scenario==="two-insufficient-common"&&round===1&&id===going[0];
    await w.say(id,negative?"I came, but it was not for me. No, I would not do it again.":"We all came, it was great. I'd do it again.");
   }
   w.restart();
   const finished=w.net.exportState().opps.find(o=>o.id===q.oppId)!;
   positives.push(Object.entries(finished.post??{}).filter(([,p])=>p.came&&p.again).map(([id])=>id));
  }
  const common=positives[0]!.filter(id=>positives.every(p=>p.includes(id))).length;
  const offers=w.logs.filter(l=>l.kind==="crew_offered").length;
  const expected=scenario==="default-one"||scenario==="two-complete"||scenario==="two-recurring"?1:0;
  rows.push({seed,scenario,minPlans,rounds,common,offers,correct:offers===expected});
 }
 return rows;
}

test("crew honors existing planner eligibility and history", async () => {
 const rows=await crewRows();
 expect(rows.filter(r=>!r.correct)).toEqual([]);
});
