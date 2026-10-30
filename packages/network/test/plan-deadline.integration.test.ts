import { expect, test } from "bun:test";
import { Mini, START } from "./mini.ts";
import { DAY, HOUR } from "@thenetwork/core";
async function deadlineRows() {
  const rows=[];
  for(const seed of [1,2,3]) for(const mode of ["before","at","after","booked-join"] as const) {
    const ids=["a","b","c","d","e","f"];
    const w=new Mini(ids.map((id,k)=>({id,name:`Person ${String.fromCharCode(65+k)}nton`,age:30,area:"Greenpoint",interests:["climbing","hiking"],skills:["belaying"],wants:[{objective:"find a regular climbing partner",category:"hobby" as const}]})),{seed,review:"human",plans:true,matchingEnabled:true,maxNewPerDay:0});
    w.clock.set(START+3*DAY); await w.onboard(...ids); await w.run(HOUR);
    const q=w.net.reviewQueue()[0]!;
    if(!q || q.origin!=="planner")throw Error("No real planner item");
    if(w.sent.some(s=>s.meta.type==="plan_probe"))throw Error("Contact before review");
    await w.run(11*HOUR);
    if(!w.net.review(q.oppId,"approve",{reviewer:"sim_staff"}))throw Error("Review refused");
    if(!await w.runUntil(()=>ids.every(id=>w.probed(id)),DAY))throw Error("Missing probes");
    await w.say("a","yes"); await w.say("b","yes");
    if(mode==="booked-join") await w.say("c","yes");
    w.restart();
    const original=w.net.exportState().opps.find(o=>o.id===q.oppId)!;
    const deadline=original.plan!.probeDeadline;
    await w.run(deadline-w.clock.now()-60_000);
    await w.net.tick(w.clock.now());
    w.clock.set(deadline+(mode==="before"?-1:mode==="at"?0:1));
    const before=w.meetings.length;
    await w.say(mode==="booked-join"?"d":"c","yes");
    const o=w.net.exportState().opps.find(o=>o.id===q.oppId)!;
    const expected=mode==="before" || mode==="booked-join";
    const booked=o.stage==="scheduled";
    const joined=o.planRun!.answers.d==="yes";
    const correct=mode==="booked-join" ? booked&&joined&&w.meetings.length===before+1
      : expected ? booked&&w.meetings.length===1 : o.stage==="closed"&&w.meetings.length===0;
    rows.push({seed,mode,stage:o.stage,meetings:w.meetings.length,answers:o.planRun!.answers,correct});
  }
  return rows;
}
test("plan replies enforce the probe deadline between ticks and retain booked late joins", async () => {
  const rows = await deadlineRows();
  expect(rows).toHaveLength(12);
  expect(rows.filter(r => !r.correct)).toEqual([]);
});
