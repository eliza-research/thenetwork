// SD-471 (gap-console GC14): the normal console page (main.tsx, its top bar search) and store against a
// controlled localhost HTTP server. Each conversation search is an audited read. Enter while a search is in
// flight must not send another one, and a late answer for an old query must not replace the newer query.
import {expect,test} from "bun:test";
import {Window} from "happy-dom";
import {act} from "react";

test("Enter during a conversation search sends no second search, and a late answer does not pin the old query",async()=>{
  const searched:string[]=[];
  const pending:(()=>void)[]=[];
  const release=()=>{for(const r of pending.splice(0))r();};
  const api=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async req=>{
    const u=new URL(req.url);
    if(u.pathname==="/api/search"){
      const q=u.searchParams.get("q")!;searched.push(q);
      await new Promise<void>(r=>{pending.push(r);});
      return Response.json([{memberId:"m_x",memberName:"Xena",t:1,kind:"message",type:"intro",snippet:`hit for ${q}`}]);
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
  const pop=()=>root.querySelector(".search-pop")?.textContent??"";
  const wait=async(check:()=>boolean)=>{for(let i=0;i<100;i++){if(check())return;await act(async()=>{await Bun.sleep(10);});}throw Error(pop()||"render timed out");};
  const enter=async(shiftKey:boolean)=>{await act(async()=>{root.querySelector("#obs-search")!.dispatchEvent(new window.KeyboardEvent("keydown",{key:"Enter",shiftKey,bubbles:true}) as any);await Bun.sleep(40);});};
  let s:any,saved:any;
  try{
    const {store}=await import("../web/store.ts");
    // The socket and the full reload are not part of this view: only the search box and its requests.
    s=store;s.connect=()=>{};s.load=async()=>{};saved=Object.fromEntries(["mode","app","me","ui","stage"].map(k=>[k,s[k]]));
    store.mode="real";store.app="slop";store.me={id:"fixture",roles:["safety"],grants:[{role:"safety",app:"slop"}],via:"token"};
    // main.tsx renders into #root when it loads: each test file loads its own copy (the query).
    await act(async()=>{await import(`../web/main.tsx?${import.meta.file}`);await Bun.sleep(40);});
    await act(async()=>{store.setUI({query:"alice"});await Bun.sleep(40);});
    await enter(true);
    await wait(()=>searched.length===1&&pop().includes("Searching"));
    // More Enter presses while the audited search is in flight.
    await enter(false);await enter(true);
    await act(async()=>{await Bun.sleep(60);});
    expect(searched).toEqual(["alice"]);
    // The staff member types a new query; then the answer for the old one arrives.
    await act(async()=>{store.setUI({query:"bobby"});await Bun.sleep(40);});
    await act(async()=>{release();await Bun.sleep(80);});
    expect(pop()).not.toContain("alice");
    expect(pop()).toContain("bobby");
    // Enter now runs a search for the query on screen.
    await enter(true);
    await wait(()=>searched.length===2);
    expect(searched).toEqual(["alice","bobby"]);
    await act(async()=>{release();await Bun.sleep(80);});
    expect(pop()).toContain("hit for bobby");
  }finally{
    // Let every answer reach the page while it still has a window.
    await act(async()=>{release();await Bun.sleep(80);});
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
