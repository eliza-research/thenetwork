// SD-068 (gap-console GC1): the normal SafetyCases panel and store against a controlled localhost HTTP
// server. Case ids have no app prefix, so `sc3` exists in two apps for two different people. After an app
// switch, a case row of the earlier app must not stay on screen and send its action to the new app.
import {expect,test} from "bun:test";
import {Window} from "happy-dom";
import {createElement,act} from "react";

const CASE=(memberId:string,memberName:string)=>({id:"sc3",memberId,memberName,level:"watch",status:"open",opened:1,events:[],urgent:false,dueAt:Date.now()+3_600_000,overdue:false});

test("a case row loaded for one app never closes the case with the same id in another app",async()=>{
  const actions:{app:string;body:any}[]=[];
  const api=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async req=>{
    const u=new URL(req.url),app=u.searchParams.get("app")??"";
    if(u.pathname==="/api/safety"&&req.method==="POST"){actions.push({app,body:await req.json()});return Response.json({ok:true});}
    if(u.pathname==="/api/safety")return Response.json({cases:[app==="slop"?CASE("m_x","Xena"):CASE("m_y","Yuri")],watch:[],hold:[],canAct:true,minors:{members:[],unknownAge:[],inOpportunities:[]}});
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
  const head=(name:string)=>[...box.querySelectorAll("button.case-head")].find(b=>b.textContent?.includes(name));
  const button=(label:string)=>[...box.querySelectorAll("button")].find(b=>b.textContent===label);
  try{
    const {store}=await import("../web/store.ts"),{SafetyCases}=await import("../web/admin.tsx");
    store.mode="real";store.app="slop";store.me={id:"fixture",roles:["safety"],grants:[{role:"safety",app:"*"}],via:"token"};
    await act(async()=>{root.render(createElement(SafetyCases));});await wait(()=>!!head("Xena"));
    await act(async()=>{(head("Xena") as any).click();});await wait(()=>!!button("Close case"));
    // The same state change as store.setApp (members emptied, app changed), without its socket and full load.
    await act(async()=>{store.app="peon";store.members=new Map();store.notify();await Bun.sleep(35);});
    // A close pressed on a row that still names Xena goes out now.
    if(head("Xena")&&button("Close case"))await act(async()=>{button("Close case")!.click();await Bun.sleep(35);});
    expect(actions.filter(a=>a.app==="peon")).toEqual([]);
    // The panel shows the new app's own case, and its close goes to that app.
    await wait(()=>!!head("Yuri"));expect(head("Xena")).toBeUndefined();
    await act(async()=>{(head("Yuri") as any).click();});await wait(()=>!!button("Close case"));
    await act(async()=>{button("Close case")!.click();await Bun.sleep(35);});
    expect(actions).toEqual([{app:"peon",body:{action:"close",caseId:"sc3"}}]);
  }finally{
    await act(async()=>{root.unmount();});globalThis.fetch=nativeFetch;api.stop(true);await window.happyDOM.close();
    for(const [name,descriptor]of prior){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete (globalThis as any)[name];}
  }
},30_000);
