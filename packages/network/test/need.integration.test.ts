import { expect, test } from "bun:test";
import { runEngine } from '../../engine/src/engine.ts';
import { resolveConfig } from '../../engine/src/config.ts';
import { localEmbed } from '../../engine/src/embed.ts';
import { World } from '../../engine/src/world.ts';
import { intentSatisfaction, complementarity } from '../../engine/src/complementarity.ts';
import { DAY } from '../../core/src/index.ts';
import type { EngineInput } from '../../engine/src/types.ts';
export function needFixture():EngineInput {
 const now=Date.UTC(2026,9,12,16);
const input:EngineInput={now,members:['a','b'].map(id=>({id,name:id,age:30,homeCity:'nyc',state:'normal',joinedAt:now-40*DAY,unansweredProactive:0,prefs:{categoriesOptIn:['hobby'],quietHours:[22,8],romanceOptIn:false,formats:['one_to_one'],maxTravelMinutes:45,onlyWhenAsked:false}})),facets:[],intents:[],presence:['a','b'].map(memberId=>({memberId,city:'nyc',type:'home',areas:['manhattan']})),edges:[],recentProposals:[]};
for(const id of ['a','b']) input.facets.push({id:id+'interest',memberId:id,kind:'interest',value:'Enjoys jazz music',tags:['jazz'],scope:'shareable',confidence:1,provenance:'said'});
input.facets.push({id:'askill',memberId:'a',kind:'skill',value:'Experienced sculptor who teaches clay wheel workshops',tags:['pottery_wheel'],scope:'shareable',confidence:1,provenance:'said'});
input.facets.push({id:'bskill',memberId:'b',kind:'skill',value:'Certified yacht handling coach with twenty years of coastal experience',tags:['sailing_instructor'],scope:'shareable',confidence:1,provenance:'said'});
input.intents.push({id:'aintent',memberId:'a',category:'hobby',objective:'Learn to sail',status:'active',createdAt:now-DAY,horizonDays:30});
input.intents.push({id:'bintent',memberId:'b',category:'hobby',objective:'Try ceramics',status:'active',createdAt:now-DAY,horizonDays:30});

 return input;
}

// Call from a simulation block: const result = await needGate();
// b.gate("structured needs retain complementary members below semantic retrieval", result.pass, JSON.stringify(result.rows));
export async function needGate() {
 const rows=[];
 const zero={fit:0,mutualBenefit:0,warmPath:0,novelty:0,timingFit:0,activationCost:0,interruptionCost:0,load:0,repetition:0,socialRisk:0,confidence:0};
 for(const seed of [1,2,3]) for(const control of ['reciprocal','disabled','unrelated','far-away','budget'] as const) {
  const input=needFixture();
  if(control==='unrelated') input.facets=input.facets.map(f=>f.kind==='skill'?{...f,tags:['woodworking']}:f);
  if(control==='far-away') { input.members[1]!.homeCity='sf'; input.presence=input.presence.map(p=>p.memberId==='b'?{...p,city:'sf'}:p); }
  if(control==='budget') input.recentProposals=Array.from({length:2},(_,i)=>({id:`used-${i}`,kind:'intro',participants:['a',`former-${i}`],alternates:[],objective:'A previous introduction',city:'nyc',score:0.8,components:zero,exploration:false,explanations:{},generator:'intent_to_capability',createdAt:input.now-DAY}));
  const w=new World(input,resolveConfig({seed}),localEmbed);
  const ab=w.intentFit(input.intents[0]!,w.get('b')!,'caps').sim, ba=w.intentFit(input.intents[1]!,w.get('a')!,'caps').sim;
  const result=await runEngine(input,control==='disabled'?{seed,complementarity:{weight:0}}:{seed});
  const selected=result.proposals[0];
  const expected=control==='reciprocal'?1:0;
  const pass=result.proposals.length===expected && ab<0.2 && ba<0.2
   && (control!=='reciprocal' || (intentSatisfaction(w,input.intents[0]!,'b')===1 && intentSatisfaction(w,input.intents[1]!,'a')===1
    && selected?.generator==='intent_to_capability' && selected.channels.includes('need') && selected.score>=selected.threshold));
  rows.push({seed,control,ab,ba,proposals:result.proposals.length,generator:selected?.generator,channels:selected?.channels,score:selected?.score,pass});
 }
 return {pass:rows.every(r=>r.pass),rows};
}

test("need follows the real engine and planner contracts", async () => {
 const result = await needGate();
 expect(result.rows.filter(r => !r.pass)).toEqual([]);
 expect(result.pass).toBe(true);
});
