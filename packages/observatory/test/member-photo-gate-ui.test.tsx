// SD-071 (gap-console GC5): the normal Inspector (member panel, slop app section) and store against a
// controlled localhost HTTP server. Photos are for verified adults only (founder decision 9). Photos that
// staff loaded lawfully must leave the screen when the service later says the member is under 18 or age
// unknown, or when the staff member loses the safety role.
import {expect,test} from "bun:test";
import {Window} from "happy-dom";
import {createElement,act} from "react";

const COUNTERS={msgsIn:1,msgsOut:1,proactive:0,proposals:0,accepted:0,meetings:0,enjoymentSum:0,enjoymentN:0};
const MEMBER=(msgsIn:number)=>({id:"m_x",name:"Xena",city:"nyc",state:"active",joined:true,minor:false,counters:{...COUNTERS,msgsIn},trust:"ok"});

test("loaded member photos leave the screen when the age gate closes and when the safety role goes",async()=>{
  let gate:"reason_required"|"never_minor"="reason_required";
  const api=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async req=>{
    const u=new URL(req.url);
    if(u.pathname==="/api/member/m_x")return Response.json({member:MEMBER(1),facets:[],intents:[],presence:[],edges:[],opportunities:[],messages:[]});
    if(u.pathname==="/api/member/m_x/timeline")return Response.json({error:"not in this fixture"},{status:404});
    if(u.pathname==="/api/member/m_x/app")return Response.json({app:"slop",adult:gate==="reason_required",ageVerified:true,prefs:{hidden:true,count:0},photos:gate});
    if(u.pathname==="/api/member/m_x/photos"&&req.method==="POST")return Response.json({ok:true,photos:[{id:"ph1",url:"data:image/gif;base64,R0lGODlhAQABAAAAACw=",expiresAt:Date.now()+300_000}]});
    return Response.json({error:"unexpected"},{status:404});
  }});
  const window=new Window({url:api.url.href}),prior=new Map<string,PropertyDescriptor|undefined>();
  for(const [name,value]of Object.entries({window,document:window.document,navigator:window.navigator,location:window.location,history:window.history,localStorage:window.localStorage,sessionStorage:window.sessionStorage,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){
    prior.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
  }
  window.sessionStorage.setItem("obs.token","fixture-safety-token");
  window.localStorage.setItem("obs.disclosure.app-slop","1");
  const nativeFetch=globalThis.fetch;
  globalThis.fetch=((input:any,init?:RequestInit)=>nativeFetch(typeof input==="string"?new URL(input,api.url):input,init)) as typeof fetch;
  const {createRoot}=await import("react-dom/client");
  const box=window.document.createElement("div");window.document.body.append(box);const root=createRoot(box as unknown as HTMLElement);
  const wait=async(check:()=>boolean,tries=100)=>{for(let i=0;i<tries;i++){if(check())return;await act(async()=>{await Bun.sleep(10);});}throw Error(box.textContent??"render timed out");};
  const button=(label:string)=>[...box.querySelectorAll("button")].find(b=>b.textContent===label);
  const img=()=>box.querySelector('img[alt="Member photo"]');
  try{
    const {store}=await import("../web/store.ts"),{Inspector}=await import("../web/panels.tsx");
    
    const loadPhotos=async()=>{
      await wait(()=>!!button("Show photos"));
      const reason=[...box.querySelectorAll("input")].find(i=>i.placeholder==="Reason (logged)")!;
      await act(async()=>{const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value")!.set!;set.call(reason,"Open report on this member");reason.dispatchEvent(new window.Event("input",{bubbles:true}));});
      await act(async()=>{button("Show photos")!.click();});await wait(()=>!!img());
    };
    store.mode="real";store.app="slop";store.me={id:"fixture",roles:["safety"],grants:[{role:"safety",app:"slop"}],via:"token"};
    store.members=new Map([["m_x",MEMBER(1) as any]]);store.ui={...store.ui,focus:{kind:"member",id:"m_x"}};
    await act(async()=>{root.render(createElement(Inspector));});
    await loadPhotos();
    // The member writes an under-18 age: the message counter moves, the panel reloads, the service says never_minor.
    gate="never_minor";
    await act(async()=>{store.members=new Map([["m_x",MEMBER(2) as any]]);store.notify();});
    await wait(()=>!!box.textContent?.includes("No photos: this member is under 18"),500);
    expect(img()).toBeNull();
    // The age gate opens again: the earlier photos do not come back without a new logged read.
    gate="reason_required";
    await act(async()=>{store.members=new Map([["m_x",MEMBER(3) as any]]);store.notify();});
    await wait(()=>!!button("Show photos"),500);
    expect(img()).toBeNull();
    await loadPhotos();
    // The staff member loses the safety role.
    await act(async()=>{store.me={id:"fixture",roles:["reviewer"],grants:[{role:"reviewer",app:"slop"}],via:"token"};store.notify();await Bun.sleep(60);});
    expect(img()).toBeNull();
  }finally{
    await act(async()=>{root.unmount();});globalThis.fetch=nativeFetch;api.stop(true);await window.happyDOM.close();
    for(const [name,descriptor]of prior){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete (globalThis as any)[name];}
  }
},60_000);
