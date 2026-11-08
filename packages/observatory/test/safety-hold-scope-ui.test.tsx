// SD-070 (gap-console GC3): the normal SafetyCases panel and store against a controlled localhost HTTP
// server. The Network service holds (and clears a minor signal) on every app of the person only for staff
// with safety@* or admin@*; staff with safety on one app act on that app only (service.ts hold, clearMinor).
// The console's success text must state the scope that the service applied.
import {expect,test} from "bun:test";
import {Window} from "happy-dom";
import {createElement,act} from "react";

const REPORT={id:"s1:r1",kind:"minor",reporterId:"m_r",subjectId:"m_x",at:1,status:"open",urgent:true,dueAt:Date.now()+3_600_000,overdue:false,priorReports:0};

test("hold and clear-minor success text says this app for staff with safety on one app, every app for safety@*",async()=>{
  const actions:any[]=[];
  const api=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async req=>{
    const u=new URL(req.url);
    if(u.pathname==="/api/safety"&&req.method==="POST"){actions.push(await req.json());return Response.json({ok:true});}
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
  const button=(start:string)=>[...box.querySelectorAll("button")].find(b=>b.textContent?.startsWith(start));
  try{
    const {store}=await import("../web/store.ts"),{SafetyCases}=await import("../web/admin.tsx");
    const press=async(label:string)=>{
      const note=[...box.querySelectorAll("input")].find(i=>i.placeholder.startsWith("Decision note"))!;
      await act(async()=>{const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value")!.set!;set.call(note,"Report checked by staff");note.dispatchEvent(new window.Event("input",{bubbles:true}));});
      await wait(()=>!button(label)!.disabled);
      const title=button(label)!.title+" "+button(label)!.textContent;
      await act(async()=>{button(label)!.click();await Bun.sleep(35);});
      return {title,toast:store.ui.toast?.text??""};
    };
    store.mode="real";store.app="slop";store.ui={...store.ui,focus:null};store.me={id:"fixture",roles:["safety"],grants:[{role:"safety",app:"slop"}],via:"token"};
    await act(async()=>{root.render(createElement(SafetyCases));});await wait(()=>!!box.querySelector("button.case-head"));
    await act(async()=>{(box.querySelector("button.case-head") as any).click();});await wait(()=>!!button("Hold"));
    const oneHold=await press("Hold"),oneClear=await press("Clear minor signal");
    expect(actions.map(a=>a.action)).toEqual(["hold","clear_minor"]);
    for(const x of [oneHold,oneClear]){expect(x.toast).not.toContain("every app");expect(x.title).not.toContain("every app");expect(x.toast).toContain("this app");}
    store.me={id:"fixture",roles:["safety"],grants:[{role:"safety",app:"*"}],via:"token"};store.notify();
    const allHold=await press("Hold"),allClear=await press("Clear minor signal");
    for(const x of [allHold,allClear])expect(x.toast).toContain("every app");
  }finally{
    await act(async()=>{root.unmount();});globalThis.fetch=nativeFetch;api.stop(true);await window.happyDOM.close();
    for(const [name,descriptor]of prior){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete (globalThis as any)[name];}
  }
},30_000);
