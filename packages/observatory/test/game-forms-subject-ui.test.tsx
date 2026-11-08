// SD-472 (gap-console GC15): the normal console page (main.tsx, the play tray and the prompt card) and store
// against a controlled localhost HTTP server, in game mode (a simulated world). An oracle peek belongs to the
// picks it was asked for, and text typed for one member's prompt belongs to that prompt: neither may stay on
// screen when the picks or the prompt change.
import {expect,test} from "bun:test";
import {Window} from "happy-dom";
import {act} from "react";

const member=(id:string,name:string)=>({id,name,city:"nyc",state:"active",joined:true,minor:false,counters:{msgsIn:0,msgsOut:0,proactive:0,proposals:0,accepted:0,meetings:0,enjoymentSum:0,enjoymentN:0},trust:"ok"});
const prompt=(id:string,memberId:string)=>({id,memberId,messageId:`msg_${id}`,body:`Question for ${memberId}`,type:"proposal",at:1});

test("a peek and a typed reply leave the screen when the picks or the prompt change",async()=>{
  const controls:any[]=[];
  const api=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async req=>{
    const u=new URL(req.url);
    if(u.pathname==="/api/control"){
      const cmd=await req.json() as any;controls.push(cmd);
      if(cmd.type==="peek")return Response.json({ok:true,data:{unsafe:false,compatible:true,flags:[],quality:0.8,participants:Object.fromEntries(cmd.participants.map((id:string)=>[id,{acceptProb:0.4}]))}});
      return Response.json({ok:true});
    }
    return Response.json({error:"not in this fixture"},{status:404});
  }});
  const window=new Window({url:api.url.href}),prior=new Map<string,PropertyDescriptor|undefined>();
  for(const [name,value]of Object.entries({window,document:window.document,navigator:window.navigator,location:window.location,history:window.history,localStorage:window.localStorage,sessionStorage:window.sessionStorage,HTMLElement:window.HTMLElement,HTMLCanvasElement:window.HTMLCanvasElement,requestAnimationFrame:(f:FrameRequestCallback)=>setTimeout(()=>f(0),16),cancelAnimationFrame:(h:any)=>clearTimeout(h),IS_REACT_ACT_ENVIRONMENT:true})){
    prior.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
  }
  // happy-dom has no 2D canvas: the map and graph stages draw into a context that does nothing.
  const noop:any=new Proxy(function(){},{get:(_t,k)=>k==="measureText"?()=>({width:0}):noop,apply:()=>undefined,set:()=>true});
  (window.HTMLCanvasElement.prototype as any).getContext=()=>noop;
  window.sessionStorage.setItem("obs.token","fixture-safety-token");
  const nativeFetch=globalThis.fetch;
  globalThis.fetch=((input:any,init?:RequestInit)=>nativeFetch(typeof input==="string"?new URL(input,api.url):input,init)) as typeof fetch;
  const root=window.document.createElement("div");root.id="root";window.document.body.append(root);
  const text=()=>root.textContent??"";
  const button=(label:string)=>[...root.querySelectorAll("button")].find(b=>b.textContent?.startsWith(label));
  const replyBox=()=>root.querySelector(".prompt-card input") as any;
  const settle=async()=>{await act(async()=>{await Bun.sleep(80);});};
  let s:any,saved:any;
  try{
    const {store}=await import("../web/store.ts");
    // The socket and the full reload are not part of this view: only the play forms and their commands.
    s=store;s.connect=()=>{};s.load=async()=>{};saved=Object.fromEntries(["mode","app","me","env","members","game","ui","stage"].map(k=>[k,s[k]]));
    store.mode="game";store.app="slop";store.me={id:"fixture",roles:["admin"],grants:[{role:"admin",app:"*"}],via:"token"};
    store.env={mode:"game",label:"SIMULATION seed 1",dataset:"synthetic",app:"slop",capabilities:{canStep:true,canIntervene:true,hiddenTruth:true,readOnly:false}} as any;
    store.members=new Map([["m_a",member("m_a","Ann Lee")],["m_b",member("m_b","Bea Cruz")],["m_c",member("m_c","Cal Diaz")]] as any);
    store.game={sparksLeft:3,sparksPerDay:3,strikes:0,maxStrikes:3,over:false,lensUsed:false,peeks:0,engine:"engine-v1",scores:[],missions:[],prompts:[prompt("p_a","m_a")],controlled:[]} as any;
    store.ui={...store.ui,picks:["m_a","m_b"]};
    // main.tsx renders into #root when it loads: each test file loads its own copy (the query).
    await act(async()=>{await import(`../web/main.tsx?${import.meta.file}`);await Bun.sleep(80);});
    // The oracle answers for Ann and Bea.
    await act(async()=>{button("Peek")!.click();await Bun.sleep(80);});
    expect(text()).toContain("Oracle:");
    // The picks change to Bea and Cal: the answer for Ann and Bea must go.
    await act(async()=>{store.togglePick("m_a");store.togglePick("m_c");await Bun.sleep(80);});
    expect(store.ui.picks).toEqual(["m_b","m_c"]);
    expect(text()).not.toContain("Oracle:");
    // Text typed as Ann; then the world resolves Ann's prompt and shows Bea's.
    const setValue=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value")!.set!;
    await act(async()=>{setValue.call(replyBox(),"Yes, Ann is in");replyBox().dispatchEvent(new window.Event("input",{bubbles:true}));await Bun.sleep(40);});
    expect(replyBox().value).toBe("Yes, Ann is in");
    await act(async()=>{store.game={...store.game!,prompts:[prompt("p_b","m_b")]};store.notify();await Bun.sleep(80);});
    expect(text()).toContain("As Bea");
    expect(replyBox().value).toBe("");
    await act(async()=>{button("Send")!.click();await Bun.sleep(80);});
    await settle();
    expect(controls.filter(c=>c.type==="reply")).toEqual([]);
  }finally{
    await settle();
    // main.tsx keeps its React root to itself: unmount it through the root that React stored on #root.
    const {createRoot}=await import("react-dom/client"),scratch=window.document.createElement("div");
    const Root=Object.getPrototypeOf(createRoot(scratch as unknown as HTMLElement)).constructor;
    const key=Object.keys(root).find(k=>k.startsWith("__reactContainer$"));
    const page=key&&(root as any)[key]?.stateNode;
    if(page)await act(async()=>{new Root(page).unmount();});
    // The store is one module instance per test process: give the next file the fields this test set.
    if(s){Object.assign(s,saved);delete s.connect;delete s.load;}globalThis.fetch=nativeFetch;api.stop(true);await window.happyDOM.close();
    for(const [name,descriptor]of prior){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete (globalThis as any)[name];}
  }
},30_000);
