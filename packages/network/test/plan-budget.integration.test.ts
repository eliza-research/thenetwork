import { expect, test } from "bun:test";
import { World } from '../../engine/src/world.ts';
import { resolveConfig } from '../../engine/src/config.ts';
import { localEmbed } from '../../engine/src/embed.ts';
import { planProposals, planMemberReason, type PlanEvidence, type Venue } from '../../engine/src/plans.ts';
import { DAY } from '../../core/src/index.ts';
import type { EngineInput } from '../../engine/src/types.ts';
const now=Date.UTC(2026,9,12,13), ids=['a','b','c','d','e','f'];
export function planBudgetGate() {
 const rows=[];
 for(const seed of [1,2,3]) for(const blocked of ['none','reliability','quota','cooldown']) for(const full of [false,true]) {
const input:EngineInput={now,members:[],facets:[],intents:[],presence:[],edges:[],recentProposals:[],categoryQuotas:blocked==='quota'?{a:{social:0}}:{},reliability:blocked==='reliability'?{a:{noShows:2,completedSinceLastNoShow:0}}:{}};
for(const id of ids) {input.members.push({id,name:id,age:30,homeCity:'nyc',state:'normal',joinedAt:now-40*DAY,unansweredProactive:0,prefs:{categoriesOptIn:['social'],quietHours:[22,8],romanceOptIn:false,formats:['small_group'],maxTravelMinutes:45,onlyWhenAsked:false}}); input.presence.push({memberId:id,city:'nyc',type:'home',areas:['manhattan']}); input.facets.push({id:id+'interest',memberId:id,kind:'interest',value:'I enjoy playing board games',tags:['board_games'],scope:'shareable',confidence:1,provenance:'said'});}
const zero={fit:0,mutualBenefit:0,warmPath:0,novelty:0,timingFit:0,activationCost:0,interruptionCost:0,load:0,repetition:0,socialRisk:0,confidence:0};
if(full) input.recentProposals=Array.from({length:2},(_,i)=>({id:`old${i}`,kind:'intro',participants:['a',`former${i}`],alternates:[],objective:'Previous professional intro',city:'nyc',score:0.8,components:zero,exploration:false,explanations:{},generator:'intent_to_capability',createdAt:now-DAY}));
if(blocked==='cooldown') input.interactions=[{id:'declined',kind:'group',category:'social',participants:['a','former'],declinedBy:['a'],outcome:'declined',at:now-DAY}];
const world=new World(input,resolveConfig({seed}),localEmbed);
const evidence=new Map<string,PlanEvidence>(ids.map(id=>[id,{memberId:id,tz:'America/New_York',quietHours:[22,8],standing:[{byDay:[0,1,2,3,4,5,6],startHour:17,endHour:22,source:'conversation',statedAt:now}]}]));
const venues:Venue[]=[{id:'v',city:'nyc',area:'manhattan',name:'Synthetic public cafe',activities:['board_game_cafe'],priceTier:1,ageMin:18,hours:{weekday:[9,23],weekend:[9,23]},public:true,source:'curated'}];
const plans=planProposals(world,{now,city:'nyc',tz:'America/New_York',evidence,venues});
const expectedReason=blocked==='none'?null:blocked==='quota'?'category_quota':blocked==='cooldown'?'category_cooldown':'reliability_holdout';
const expected=blocked==='none'?ids:ids.filter(id=>id!=='a');
const actual=[...new Set(plans.flatMap(p=>[...p.invited,...p.alternates]))].sort();
const reason=planMemberReason(world,'a');
const pass=plans.length===1 && JSON.stringify(actual)===JSON.stringify(expected) && reason===expectedReason;
rows.push({seed,blocked,full,reason,plans:plans.map(p=>({invited:p.invited,alternates:p.alternates,score:p.score})),pass});
}

 return {pass:rows.every(r=>r.pass),rows};
}

// In a simulation block: const result=planBudgetGate();
// b.gate('plan allowance skips intro budgets but retains later eligibility rules',result.pass,JSON.stringify(result.rows));

test("plan-budget follows the real engine and planner contracts", async () => {
 const result = await planBudgetGate();
 expect(result.rows.filter(r => !r.pass)).toEqual([]);
 expect(result.pass).toBe(true);
});
