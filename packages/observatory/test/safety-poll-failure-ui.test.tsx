// SD-466 (gap-console GC7): the normal SafetyCases panel and store against a controlled localhost HTTP
// server. The panel reads GET /api/safety again every 10 s. One failed read (a 502 from a service hiccup)
// must not unmount the case rows and the held rows: a typed decision note and a typed held-text reason stay.
import {expect,test} from "bun:test";
import {Window} from "happy-dom";
import {createElement,act} from "react";

const CASE={id:"sc1",memberId:"m_x",memberName:"Pat",level:"hold",status:"held",opened:1,events:[],urgent:true,dueAt:Date.now()+3_600_000,overdue:false};
const HELD={id:"h1",queue:"leak",memberId:"m_y",reasons:["phone_number"],text:"call me"};

test("a failed safety poll keeps the typed case note and held-text reason",async()=>{
  let fail=false,failedReads=0;
  const api=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async req=>{
    const u=new URL(req.url);
    if(u.pathname==="/api/safety"){
      if(fail){failedReads++;return Response.json({error:"service unavailable"},{status:502});}
      return Response.json({cases:[CASE],watch:[],hold:[],canAct:true,canBan:false,minors:{members:[],unknownAge:[],inOpportunities:[]}});
    }
    if(u.pathname==="/api/held")return Response.json({ok:true,items:[HELD]});
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
  const wait=async(check:()=>boolean,ticks=100)=>{for(let i=0;i<ticks;i++){if(check())return;await act(async()=>{await Bun.sleep(5);});}throw Error(box.textContent??"render timed out");};
  const input=(start:string)=>[...box.querySelectorAll("input")].find(i=>i.placeholder.startsWith(start));
  const type=async(el:any,text:string)=>{await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value")!.set!.call(el,text);el.dispatchEvent(new window.Event("input",{bubbles:true}));});};
  try{
    const {store}=await import("../web/store.ts"),{SafetyCases}=await import("../web/admin.tsx");
    store.mode="real";store.app="slop";store.ui={...store.ui,focus:null};store.me={id:"fixture",roles:["safety"],grants:[{role:"safety",app:"slop"}],via:"token"};
    await act(async()=>{root.render(createElement(SafetyCases));});
    await wait(()=>!!box.querySelector("button.case-head")&&!!input("Reason"));
    await act(async()=>{(box.querySelector("button.case-head") as any).click();});await wait(()=>!!input("Decision note"));
    await type(input("Decision note"),"Checked the chat history");
    await type(input("Reason"),"Number shared on purpose");
    fail=true;
    // The next poll is 10 s after the first read.
    await wait(()=>failedReads>0,2_400);
    await act(async()=>{await Bun.sleep(50);});
    expect(input("Decision note")?.value).toBe("Checked the chat history");
    expect(input("Reason")?.value).toBe("Number shared on purpose");
  }finally{
    await act(async()=>{root.unmount();});globalThis.fetch=nativeFetch;api.stop(true);await window.happyDOM.close();
    for(const [name,descriptor]of prior){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete (globalThis as any)[name];}
  }
},30_000);
