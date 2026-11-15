import { expect, test } from "bun:test";
import { runEngine } from '../../engine/src/engine.ts';
import { DAY, HOUR } from '@thenetwork/core';
import type { EngineInput } from '../../engine/src/types.ts';
export function fixture(confidence = 0.5): EngineInput {
 const now=Date.UTC(2026,9,12,16);
 const input: EngineInput={now,members:[],facets:[],intents:[],presence:[],edges:[],recentProposals:[]};
 for(const id of ['a','b']) {
  input.members.push({id,name:`Synthetic ${id}`,age:30,homeCity:'nyc',state:'normal',joinedAt:now-40*DAY,unansweredProactive:0,prefs:{categoriesOptIn:['hobby','social','events'],quietHours:[22,8],romanceOptIn:false,formats:['one_to_one','small_group','event'],maxTravelMinutes:45,onlyWhenAsked:false}});
  input.presence.push({memberId:id,city:'nyc',type:'home',areas:['manhattan']});
  input.facets.push({id:id+'interest',memberId:id,kind:'interest',value:'sailing',tags:['sailing'],scope:'shareable',confidence,provenance:'said'});
 }
 input.facets.push({id:'bskill',memberId:'b',kind:'skill',value:'sailing',tags:['sailing'],scope:'shareable',confidence,provenance:'said'});
 input.intents.push({id:'aintent',memberId:'a',category:'hobby',objective:'Find a sailing partner',status:'active',createdAt:now-DAY,horizonDays:30});
 input.events=[{id:'ev',title:'sailing workshop',description:'workshop',tags:['sailing'],category:'hobby',city:'nyc',area:'manhattan',start:now+2*DAY,end:now+2*DAY+3*HOUR}];
 return input;
}
test("a below-threshold event cannot erase an eligible intro for the same participants", async () => {
 for (const seed of [1,2,3]) for (const confidence of [0.1,0.5,1]) for (const event of [false,true]) {
  const input=fixture(confidence); if(!event) input.events=[];
  const result=await runEngine(input,{seed});
  expect(result.proposals.length).toBe(confidence===0.1?0:1);
  if(confidence!==0.1) {
   expect(result.proposals[0]!.generator).toBe(event&&confidence===1?'event_anchor':'intent_to_capability');
   expect(result.runLog.scored.filter(s=>s.eligible).length).toBeGreaterThan(0);
  }
 }
});
