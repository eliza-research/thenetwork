// SD-468 (gap-console GC11): the normal SafetyCases panel and store against a controlled localhost HTTP
// server. The Network service bans (by phone or by person) only for staff with safety@* or admin@*
// (service.ts ban: needs_safety_everywhere). Staff with safety on one app must not see Ban buttons that
// the service always refuses; staff with safety everywhere still see them.
import {expect,test} from "bun:test";
import {Window} from "happy-dom";
import {createElement,act} from "react";

const REPORT={id:"s1:r1",kind:"harassment",reporterId:"m_r",subjectId:"m_x",at:1,status:"open",urgent:true,dueAt:Date.now()+3_600_000,overdue:false,priorReports:0};

test("Ban buttons show only for staff whose role the service accepts for a ban",async()=>{
  const api=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async req=>{
    const u=new URL(req.url);
    if(u.pathname==="/api/safety")return Response.json({cases:[],reports:[REPORT],watch:[],hold:[],canAct:true,canBan:true,minors:{members:[],unknownAge:[],inOpportunities:[]}});
    if(u.pathname==="/api/held")return Response.json({ok:true,items:[]});
    return Response.json({error:"unexpected"},{status:404});
  }});
  const window=new Window({url:api.url.href}),prior=new Map<string,PropertyDescriptor|undefined>();
  for(const [name,value]of Object.entries({window,document:window.document,navigator:window.navigator,location:window.location,history:window.history,localStorage:window.localStorage,sessionStorage:window.sessionStorage,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){
    prior.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
  }
  window.sessionStorage.setItem("obs.token","fixture-safety-token");
  const nativeFetch=globalThis.fetch;
  globalThis.fetch=((input:any,init?:RequestInit)=>nativeFetch(typeof input==="string"?new URL(input,api.url):input,init)) as typeof fetch;
  const {createRoot}=await import("react-dom/client");
  const box=window.document.createElement("div");window.document.body.append(box);const root=createRoot(box as unknown as HTMLElement);
  const wait=async(check:()=>boolean)=>{for(let i=0;i<100;i++){if(check())return;await act(async()=>{await Bun.sleep(5);});}throw Error(box.textContent??"render timed out");};
  const labels=()=>[...box.querySelectorAll("button")].map(b=>b.textContent??"");
  try{
    const {store}=await import("../web/store.ts"),{SafetyCases}=await import("../web/admin.tsx");
    store.mode="real";store.app="slop";store.ui={...store.ui,focus:null};store.me={id:"fixture",roles:["safety"],grants:[{role:"safety",app:"slop"}],via:"token"};
    await act(async()=>{root.render(createElement(SafetyCases));});await wait(()=>!!box.querySelector("button.case-head"));
    await act(async()=>{(box.querySelector("button.case-head") as any).click();});await wait(()=>labels().includes("Hold"));
    expect(labels().filter(l=>l.startsWith("Ban"))).toEqual([]);
    expect(labels()).toContain("Dismiss");
    store.me={id:"fixture",roles:["safety"],grants:[{role:"safety",app:"*"}],via:"token"};await act(async()=>{store.notify();});
    await wait(()=>labels().includes("Ban phone"));
    expect(labels().filter(l=>l.startsWith("Ban"))).toEqual(["Ban phone","Ban person"]);
  }finally{
    await act(async()=>{root.unmount();});globalThis.fetch=nativeFetch;api.stop(true);await window.happyDOM.close();
    for(const [name,descriptor]of prior){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete (globalThis as any)[name];}
  }
},30_000);
