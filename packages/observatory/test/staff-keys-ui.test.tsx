// The staff panels on the normal store against controlled localhost HTTP, driven by DOM events.
// Happy-dom sends key events by hand: real key repeat and browser activation are outside this file.
import {afterAll,beforeAll,beforeEach,expect,test} from "bun:test";
import {Window} from "happy-dom";
import {createElement,act,type ReactNode} from "react";

const T=1_800_000_000_000,H=3_600_000,A_ID="aaaaaaaa-0000-0000-0000-000000000001",B_ID="bbbbbbbb-0000-0000-0000-000000000001";
type Call={path:string;app:string|null;body?:any};
let calls:Call[]=[],answer:(path:string,app:string|null,body:any)=>Promise<Response>|Response=()=>Response.json({ok:true});
const api=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async req=>{
  const u=new URL(req.url),body=req.method==="POST"?await req.json():undefined;
  calls.push({path:u.pathname,app:u.searchParams.get("app"),body});
  return answer(u.pathname,u.searchParams.get("app"),body);
}});
const window=new Window({url:api.url.href}),nativeFetch=globalThis.fetch,prior=new Map<string,PropertyDescriptor|undefined>();
let store:any,root:any,box:any,ui:any,createRoot:any,nativeConnect:any;
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const settle=async(ms=30)=>{await act(async()=>{await sleep(ms);});};
const member=(id:string)=>({id,name:`Name ${id}`,joined:true,minor:false,state:"active",trust:"ok"});
const opp=(id:string,deadline:number,extra:object={})=>({id,kind:id,state:"IN_REVIEW",source:"engine",origin:"engine",participants:["m1","m2"],alternates:["m3"],objective:`Plan ${id}`,score:.5,explanations:{m1:`told m1 about ${id}`,m2:`told m2 about ${id}`},createdAt:T-H,updatedAt:T-H,review:{queuedAt:T-H,deadline},...extra});
const decisions=()=>calls.filter(c=>c.path==="/api/control").map(c=>c.body);
const key=async(k:string,repeat=false,target:any=window.document.body)=>{
  const e=new window.KeyboardEvent("keydown",{key:k,bubbles:true,cancelable:true,repeat});
  await act(async()=>{target.dispatchEvent(e);await sleep(5);});return e;
};
const type=async(el:any,v:string)=>{
  const proto=el.tagName==="TEXTAREA"?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;
  await act(async()=>{Object.getOwnPropertyDescriptor(proto,"value")!.set!.call(el,v);el.dispatchEvent(new window.Event("input",{bubbles:true}));await sleep(5);});
};
const button=(label:string|RegExp)=>[...box.querySelectorAll("button")].find((b:any)=>typeof label==="string"?b.textContent===label:label.test(b.textContent)) as any;
const selected=()=>(box.querySelector(".review-card.selected .review-head .muted.small")?.textContent as string|undefined)?.split(" ")[0]?.toUpperCase();
const planInput=()=>[...box.querySelectorAll(".review-edit input")][0] as any;
async function reset(opps:any[],roles=["reviewer"]){
  await act(async()=>{root?.unmount();});
  box.innerHTML="";root=createRoot(box);calls=[];answer=()=>Response.json({ok:true});
  store.mode="real";store.app="ntwrk";store.page={kind:"app"};
  store.env={capabilities:{staffActions:true,canIntervene:false,readOnly:true}};
  store.me={id:"rev",roles,grants:roles.map(role=>({role,app:"*"})),via:"token",apps:["ntwrk","friends"],crossApp:true};
  store.network={kind:"consent",matchingEnabled:true,review:{mode:"human",queued:opps.length,approved:0,rejected:0,expired:0},trust:{hold:0,watch:0}};
  store.clock={now:T};
  store.members=new Map(["m1","m2","m3"].map(id=>[id,member(id)]));
  store.opps=new Map(opps.map(o=>[o.id,o]));
  store.requests=[];
  store.ui={...store.ui,focus:null,reviewView:"pending",toast:undefined,popover:null};
  await notified();
}
const queue=async(opps:any[])=>{await reset(opps);await act(async()=>{root.render(createElement(ui.ReviewQueue));});await settle(5);};
const render=async(el:ReactNode,wait=30)=>{await act(async()=>{root.render(el);});await settle(wait);};
// store.notify() coalesces: wait past its timer.
const notified=async()=>{await act(async()=>{store.notify();await sleep(40);});};
const leave=async(id:string)=>{store.opps.set(id,{...store.opps.get(id),state:"EXPIRED"});await notified();};
const arrive=async(o:any)=>{store.opps.set(o.id,o);await notified();};

beforeAll(async()=>{
  for(const [name,value]of Object.entries({window,document:window.document,navigator:window.navigator,location:window.location,history:window.history,localStorage:window.localStorage,sessionStorage:window.sessionStorage,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){
    prior.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
  }
  // The store is one object per process and held-photo-ui.test.tsx shares it: same token, and connect goes back after.
  window.sessionStorage.setItem("obs.token","fixture-safety-token");
  globalThis.fetch=((input:any,init?:RequestInit)=>nativeFetch(typeof input==="string"?new URL(input,api.url):input,init)) as typeof fetch;
  ({createRoot}=await import("react-dom/client"));
  ({store}=await import("../web/store.ts"));nativeConnect=store.connect;store.connect=()=>{};
  ui={...await import("../web/review.tsx"),...await import("../web/admin.tsx"),...await import("../web/apps.tsx")};
  box=window.document.createElement("div");window.document.body.append(box);
});
beforeEach(()=>{window.document.body.focus?.();});
afterAll(async()=>{
  await act(async()=>{root?.unmount();});store.connect=nativeConnect;globalThis.fetch=nativeFetch;api.stop(true);await window.happyDOM.close();
  for(const [name,d]of prior){if(d)Object.defineProperty(globalThis,name,d);else delete (globalThis as any)[name];}
});

test("edits, reject mode and notes stay on their item when the selection moves",async()=>{
  await queue([opp("A",T+H),opp("B",T+2*H)]);
  await key("e");await type(planInput(),"Plan A says private thing about A");
  await leave("A");
  expect(selected()).toBe("B");expect(!!box.querySelector(".review-edit")).toBe(false);
  await key("a");expect(decisions()).toEqual([]);
  await key("a");await settle();
  expect(decisions().map(d=>[d.oppId,d.decision,d.objective])).toEqual([["B","approve",undefined]]);
  // A focus link is a choice: the key decides, but nothing typed for A goes with it.
  await queue([opp("A",T+H),opp("B",T+2*H)]);
  await key("r");await type(box.querySelector("input.note"),"note about A");
  await act(async()=>{store.focus({kind:"opportunity",id:"B"});await sleep(40);});
  expect((box.querySelector("input.note") as any).value).toBe("");
  await key("1");expect(decisions()).toEqual([]);
  await key("a");await settle();
  expect(decisions().map(d=>[d.oppId,d.decision,d.reason,d.note])).toEqual([["B","approve",undefined,undefined]]);
  // The re-roll mode does not follow either.
  await queue([opp("A",T+H),opp("B",T+2*H,{alternates:["m3"]})]);
  await key("s");await leave("A");await key("1");await key("1");await settle();
  expect(decisions()).toEqual([]);
});

test("a new item never takes a key: the card on view keeps it, and a card nobody chose takes one press to choose",async()=>{
  await queue([opp("F",T+2*H),opp("G",T+3*H)]);
  await arrive(opp("N",T+H));
  expect(selected()).toBe("F");
  await key("a");await settle();
  expect(decisions().map(d=>d.oppId)).toEqual(["F"]);
  await queue([opp("F",T+2*H),opp("G",T+3*H)]);
  await leave("F");await arrive(opp("N",T+H));
  await key("a");expect(decisions()).toEqual([]);
  await key("a");await settle();expect(decisions().length).toBe(1);
});

test("a held key decides once",async()=>{
  await queue(["A","B","C","D"].map((id,i)=>opp(id,T+(i+1)*H)));
  answer=async()=>{await sleep(20);return Response.json({ok:true});};
  await key("a");
  for(let i=0;i<6;i++){await key("a",true);await settle(15);}
  await settle(40);
  expect(decisions().map(d=>d.oppId)).toEqual(["A"]);
  expect(selected()).toBe("B");
});

test("a late answer leaves the card and the mode the reviewer has moved to",async()=>{
  await queue([opp("A",T+H),opp("B",T+2*H),opp("C",T+3*H)]);
  let release:(r:Response)=>void=()=>{};
  answer=(_p,_a,body)=>body?.oppId==="A"?new Promise(r=>{release=r;}):Response.json({ok:true});
  await key("a");await key("j");await key("j");await key("r");
  expect(selected()).toBe("C");
  await act(async()=>{release(Response.json({ok:true}));await sleep(20);});
  expect(selected()).toBe("C");
  expect(!!box.querySelector(".review-actions.rejecting")).toBe(true);
  await key("1");await settle();
  expect(decisions().map(d=>d.oppId)).toEqual(["A","C"]);
});

test("the page refuses an approve at the deadline, and for a participant it does not know",async()=>{
  await queue([opp("A",T)]);
  await key("a");await settle();
  expect(decisions()).toEqual([]);expect(button("Approve").disabled).toBe(true);
  await queue([opp("B",T+H,{participants:["m1","ghost"]})]);
  await key("a");await settle();
  expect(decisions()).toEqual([]);expect(button("Approve").disabled).toBe(true);
});

test("edits survive another mode, a second e keeps them, and Esc in the editor discards them",async()=>{
  await queue([opp("A",T+H)]);
  await key("e");await type(planInput(),"Rewritten plan");
  await key("e");expect(planInput().value).toBe("Rewritten plan");
  await key("r");await key("a");await settle();
  expect(decisions().map(d=>[d.decision,d.objective])).toEqual([["edit","Rewritten plan"]]);
  await queue([opp("B",T+H)]);
  await key("e");await type(planInput(),"Dropped plan");await key("Escape");
  expect(!!button("Approve")).toBe(true);
  await key("a");await settle();
  expect(decisions().map(d=>[d.decision,d.objective])).toEqual([["approve",undefined]]);
});

test("a refused approve is never silent when the item closes",async()=>{
  await queue([opp("A",T+H)]);
  answer=()=>{store.opps.set("A",{...store.opps.get("A"),state:"CANCELLED"});store.notify();return Response.json({ok:false,code:"busy_elsewhere",error:"busy elsewhere"});};
  await key("a");await settle();
  expect(store.ui.toast?.text).toBe("busy elsewhere");
  // The close comes after the answer: the alert shows, and the toast takes over when the card goes.
  await queue([opp("B",T+H)]);
  answer=()=>Response.json({ok:false,code:"blocked_pair",error:"blocked pair"});
  await key("a");await settle();
  expect(box.querySelector('[role="alert"]')?.textContent).toContain("blocked pair");
  expect(store.ui.toast).toBeUndefined();
  await leave("B");
  expect(store.ui.toast?.text).toBe("blocked pair");
});

test("a focused button keeps Enter, and an open popover keeps the keyboard",async()=>{
  await queue([opp("A",T+H)]);
  const e=await key("Enter",false,button("Edit"));
  expect(e.defaultPrevented).toBe(false);
  await act(async()=>{store.setUI({popover:"help"});await sleep(40);});
  await key("a");await settle();
  expect(decisions()).toEqual([]);
});

test("a closed item with no decision shows no countdown",async()=>{
  await reset([]);
  const closed=opp("A",T+11*H,{state:"SKIPPED",review:{queuedAt:T-H,deadline:T+11*H,rerolls:1}});
  await render(createElement("div",{className:"line"},ui.reviewLine(closed)),1);
  expect(!!box.querySelector(".countdown")).toBe(false);
  expect(box.textContent).toContain("re-rolled 1×");
  await render(createElement("div",{className:"line"},ui.reviewLine(opp("B",T+11*H))),1);
  expect(!!box.querySelector(".countdown")).toBe(true);
});

test("a held report still offers the ban, and a final one offers nothing",async()=>{
  await reset([],["safety"]);
  const report=(id:string,status:string,kind="harassment")=>({id,kind,status,subjectId:"m1",reporterId:"m2",at:T,dueAt:T+H,urgent:false,overdue:false});
  answer=p=>p==="/api/safety"?Response.json({cases:[],canAct:true,canBan:true,minors:{members:[],unknownAge:[],inOpportunities:[]},reports:[report("r1","held","minor"),report("r2","banned")]}):Response.json({ok:true,items:[]});
  await render(createElement(ui.SafetyCases));
  await act(async()=>{button("All").click();await sleep(5);});
  await act(async()=>{[...box.querySelectorAll(".case-head")].forEach((h:any)=>h.click());await sleep(5);});
  expect(!!button("Ban phone")).toBe(true);expect(!!button("Ban person")).toBe(true);expect(!!button(/Clear minor signal/)).toBe(true);
  expect(!!button("Hold")).toBe(false);expect(!!button("Dismiss")).toBe(false);
  expect([...box.querySelectorAll("button")].filter((b:any)=>b.textContent==="Ban phone").length).toBe(1);
});

test("the header and the age belong to one person when an older read lands last",async()=>{
  await reset([]);
  const person=(id:string,age:number)=>({personId:id,lowestAge:age,createdAt:T,holds:[],blocks:{made:[],received:[]},memberships:[],privateApps:[]});
  answer=async p=>{if(p.endsWith(A_ID)){await sleep(40);return Response.json(person(A_ID,15));}return Response.json(person(B_ID,30));};
  store.page={kind:"person",id:A_ID};
  await render(createElement(ui.AppPage),5);
  await act(async()=>{store.page={kind:"person",id:B_ID};store.notify();await sleep(70);});
  expect(box.querySelector(".section-head h3")?.textContent).toBe("Person bbbbbbbb");
  expect(box.textContent).toContain("Lowest age 30");expect(box.textContent).not.toContain("Lowest age 15");
});

test("the confirm press sends what the first press asked for",async()=>{
  await reset([],["admin"]);
  let on=true;
  answer=p=>p==="/api/config"?Response.json({matchingEnabled:on,canChange:true,reviewMode:"human",history:[],network:{},outreach:{}}):p==="/api/audit"?Response.json({sink:"file",entries:[]}):Response.json({ok:true});
  await render(createElement(ui.Config));
  await act(async()=>{button("Turn off").click();await sleep(5);});
  await act(async()=>{button(/^Confirm/).click();await sleep(20);});
  expect(decisions()).toEqual([{type:"matching",on:false}]);calls=[];
  await settle();
  await act(async()=>{button("Turn off").click();await sleep(5);});
  on=false;
  await act(async()=>{store.network={...store.network,matchingEnabled:false};store.notify();await sleep(60);});
  const confirm=button(/^Confirm/);expect(confirm.textContent).toBe("Confirm: turn off");
  await act(async()=>{confirm.click();await sleep(20);});
  expect(decisions()).toEqual([]);
});

test("a booked request counts as fulfilled",async()=>{
  await reset([]);
  store.requests=[{id:"q1",memberId:"m1",category:"social",kind:"people",label:"Someone",outcome:"booked",tries:1,ageHours:1,openedAt:T}];
  await render(createElement(ui.Requests),5);
  expect(box.textContent).toContain("social 0 open / 1 fulfilled");
  await act(async()=>{button("Fulfilled").click();await sleep(5);});
  expect(box.querySelectorAll("tbody tr").length).toBe(1);
});

test("each staff read follows the app switch",async()=>{
  await reset([],["admin"]);
  answer=p=>p==="/api/config"?Response.json({matchingEnabled:true,canChange:true,reviewMode:"human",history:[],network:{},outreach:{}}):
    p==="/api/safety"?Response.json({cases:[],canAct:true,reports:[],minors:{members:[],unknownAge:[],inOpportunities:[]}}):
    p==="/api/audit"?Response.json({sink:"file",entries:[]}):p==="/api/bias"?Response.json({ok:true,reports:[]}):Response.json({ok:true,items:[]});
  await render(createElement("div",null,createElement(ui.Config),createElement(ui.SafetyCases),createElement(ui.BiasMonitor)));
  calls=[];
  await act(async()=>{store.app="friends";store.notify();await sleep(40);});
  const read=calls.filter(c=>c.app==="friends").map(c=>c.path);
  for(const path of ["/api/config","/api/safety","/api/bias","/api/audit"])expect(read).toContain(path);
});
