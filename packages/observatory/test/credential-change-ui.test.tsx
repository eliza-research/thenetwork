// SD-245 (gap-console GC6): the normal Inspector (member panel) and store against a controlled localhost
// HTTP server. The server shapes a member view for the caller's role (staff access rows for safety and
// admin only). When another staff member enters a token in the same tab, the view of the first person
// must leave the screen and be read again with the new credential.
import {expect,test} from "bun:test";
import {Window} from "happy-dom";
import {createElement,act} from "react";

const MEMBER={id:"m_x",name:"Xena",city:"nyc",state:"active",joined:true,minor:false,counters:{msgsIn:1,msgsOut:1,proactive:0,proposals:0,accepted:0,meetings:0,enjoymentSum:0,enjoymentN:0},trust:"ok"};

test("a new staff token drops the member view of the previous staff member and reads it again",async()=>{
  const seen:string[]=[];
  const api=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async req=>{
    const u=new URL(req.url),token=req.headers.get("authorization")??"";
    if(u.pathname==="/api/member/m_x"){
      seen.push(token);
      return Response.json({member:MEMBER,facets:[],intents:[],presence:[],edges:[],opportunities:[],messages:[],
        ...(token==="Bearer safety-token"?{staffAccess:[{actor:"token:safety-alice",at:1,action:"read_member"}]}:{})});
    }
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
  const staffRows=()=>!!box.textContent?.includes("Staff who opened");
  let s:any,before="";
  try{
    const {store}=await import("../web/store.ts"),{Inspector}=await import("../web/panels.tsx");
    // The socket and the full reload are not part of this view: the panel must react to the credential alone.
    s=store;before=s.token;s.connect=()=>{};s.load=async()=>{};
    store.setToken("safety-token");
    store.mode="real";store.app="slop";store.me={id:"fixture",roles:["safety"],grants:[{role:"safety",app:"slop"}],via:"token"};
    store.members=new Map([["m_x",MEMBER as any]]);store.ui={...store.ui,focus:{kind:"member",id:"m_x"}};
    await act(async()=>{root.render(createElement(Inspector));});
    await wait(staffRows);
    // A reviewer enters a token in the same tab (after a 401 prompt, for example).
    await act(async()=>{store.setToken("reviewer-token");await Bun.sleep(120);});
    await wait(()=>seen.at(-1)==="Bearer reviewer-token");
    await act(async()=>{await Bun.sleep(60);});
    expect(staffRows()).toBe(false);
    expect(box.textContent).toContain("Xena");
  }finally{
    await act(async()=>{root.unmount();});
    // The store is one module instance per test process: give the next file the token and transport it had.
    if(s){s.setToken(before);delete s.connect;delete s.load;}globalThis.fetch=nativeFetch;api.stop(true);await window.happyDOM.close();
    for(const [name,descriptor]of prior){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete (globalThis as any)[name];}
  }
},30_000);
