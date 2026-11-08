// SD-247 (gap-console GC10): the normal Inspector (member panel, reveal control) and store against a
// controlled localhost HTTP server. "End" on a PII reveal must not hide the reveal when the server did not
// end it (a 5xx answer or no answer): the grant stays on the server, so the badge must stay on screen.
import {expect,test} from "bun:test";
import {Window} from "happy-dom";
import {createElement,act} from "react";

const MEMBER={id:"m_x",name:"Xena",city:"nyc",state:"active",joined:true,minor:false,counters:{msgsIn:1,msgsOut:1,proactive:0,proposals:0,accepted:0,meetings:0,enjoymentSum:0,enjoymentN:0},trust:"ok"};

test("End keeps the reveal on screen when the server does not end it, and drops it when the server does",async()=>{
  let grant:any={memberId:"m_x",reason:"Open report on this member",until:Date.now()+600_000};
  let deleteStatus=503;
  const api=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async req=>{
    const u=new URL(req.url);
    if(u.pathname==="/api/reveal"&&req.method==="DELETE"){
      if(deleteStatus!==200)return Response.json({ok:false,error:"audit_unavailable"},{status:deleteStatus});
      grant=null;return Response.json({ok:true});
    }
    if(u.pathname==="/api/reveal")return Response.json(grant?[grant]:[]);
    if(u.pathname==="/api/member/m_x")return Response.json({member:MEMBER,facets:[],intents:[],presence:[],edges:[],opportunities:[],messages:[]});
    return Response.json({error:"not in this fixture"},{status:404});
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
  const wait=async(check:()=>boolean)=>{for(let i=0;i<100;i++){if(check())return;await act(async()=>{await Bun.sleep(10);});}throw Error(box.textContent??"render timed out");};
  const end=()=>[...box.querySelectorAll("button")].find(b=>b.textContent==="End");
  const revealed=()=>!!box.textContent?.includes("Revealed");
  try{
    const {store}=await import("../web/store.ts"),{Inspector}=await import("../web/panels.tsx");
    store.mode="real";store.app="slop";store.me={id:"fixture",roles:["safety"],grants:[{role:"safety",app:"slop"}],via:"token"};
    store.members=new Map([["m_x",MEMBER as any]]);store.ui={...store.ui,focus:{kind:"member",id:"m_x"}};
    await store.loadReveals();
    await act(async()=>{root.render(createElement(Inspector));});
    await wait(()=>!!end());
    // The server fails: the grant stays there, so the console must still show it.
    await act(async()=>{end()!.click();await Bun.sleep(60);});
    expect(grant).not.toBeNull();
    expect(store.revealFor("m_x")).toBeDefined();
    expect(revealed()).toBe(true);
    expect(store.ui.toast?.tone).toBe("bad");
    // The server ends it: the badge goes.
    deleteStatus=200;
    await act(async()=>{end()!.click();await Bun.sleep(60);});
    expect(grant).toBeNull();
    expect(store.revealFor("m_x")).toBeUndefined();
    await wait(()=>!revealed());
  }finally{
    await act(async()=>{root.unmount();});globalThis.fetch=nativeFetch;api.stop(true);await window.happyDOM.close();
    for(const [name,descriptor]of prior){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete (globalThis as any)[name];}
  }
},30_000);
