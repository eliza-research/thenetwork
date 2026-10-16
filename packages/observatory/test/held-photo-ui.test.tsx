// Render the normal safety panel/store against controlled localhost HTTP. Image load/error events
// are the DOM boundary here; this case does not claim real-photo, browser-pixel or provider acceptance.
import {expect,test} from "bun:test";
import {Window} from "happy-dom";
import {createElement,act} from "react";

test("photo review waits for successful image load and acknowledgment, keeps Reject on errors, and clears preview across app changes",async()=>{
  const id="pri_"+"a".repeat(32),requests:{path:string;body?:any}[]=[];
  let fail=true;
  const api=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async req=>{
    const u=new URL(req.url);expect(["slop","friends"]).toContain(u.searchParams.get("app")??"");const credential=req.headers.get("authorization");expect(["Bearer fixture-safety-token","Bearer replacement-safety-token",null]).toContain(credential);
    if(!credential)return Response.json({error:"unauthorized"},{status:401});
    if(u.pathname==="/api/mode")return Response.json({mode:"real"});
    if(u.pathname==="/api/me")return Response.json({id:credential==="Bearer replacement-safety-token"?"replacement":"fixture",roles:["safety"],grants:[{role:"safety",app:"*"}],via:"token"});
    if(u.pathname==="/api/ws-ticket")return Response.json({error:"No live socket in this fixture"},{status:403});
    if(u.pathname==="/api/state")return Response.json({error:"Controlled refresh failure"},{status:503});
    const body=req.method==="POST"?await req.json():undefined;requests.push({path:u.pathname,body});
    if(u.pathname==="/api/safety")return Response.json({cases:[],reports:[],canAct:true,minors:{members:[],unknownAge:[],inOpportunities:[]}});
    if(u.pathname==="/api/held"&&req.method==="GET")return Response.json({ok:true,items:u.searchParams.get("app")==="slop"&&u.searchParams.get("queue")==="relay"?[{id,queue:"relay",kind:"photo",reasons:["photo:review"],createdAt:1}]:[]});
    if(u.pathname===`/api/held/${id}/photo`)return fail?Response.json({error:"unavailable"},{status:403}):new Response(Uint8Array.from([255,216,255,217]),{headers:{"content-type":"image/jpeg"}});
    if(u.pathname==="/api/held"&&req.method==="POST")return Response.json({ok:true});
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
  const button=(label:string)=>[...box.querySelectorAll("button")].find(b=>b.textContent===label)!;
  try{
    const {store}=await import("../web/store.ts"),{SafetyCases}=await import("../web/admin.tsx");
    store.mode="real";store.app="slop";store.me={id:"fixture",roles:["safety"],grants:[{role:"safety",app:"*"}],via:"token"};
    await act(async()=>{root.render(createElement(SafetyCases));});await wait(()=>!!button("Held relay"));
    await act(async()=>{button("Held relay").click();});await wait(()=>!!button("Load selected photo"));
    const reason=[...box.querySelectorAll("input")].find(input=>input.placeholder.startsWith("Reason"))!;
    await act(async()=>{const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value")!.set!;set.call(reason,"Selected item consent and safety checked");reason.dispatchEvent(new window.Event("input",{bubbles:true}));});
    await wait(()=>!button("Reject").disabled);expect(button("Release").disabled).toBe(true);
    await act(async()=>{button("Load selected photo").click();});await wait(()=>!!box.querySelector('[role="alert"]'));
    expect(button("Release").disabled).toBe(true);expect(button("Reject").disabled).toBe(false);expect(requests.some(r=>r.body?.decision==="release")).toBe(false);
    fail=false;await act(async()=>{button("Load selected photo").click();});await wait(()=>!!box.querySelector("img"));
    expect(button("Release").disabled).toBe(true);const image=box.querySelector("img")!;
    await act(async()=>{image.dispatchEvent(new window.Event("load"));});const acknowledged=[...box.querySelectorAll("input")].find(input=>input.type==="checkbox")!;
    expect(button("Release").disabled).toBe(true);await act(async()=>{acknowledged.click();});expect(button("Release").disabled).toBe(false);
    // AuthPrompt can overlay this still-mounted panel. A real credential change must clear private bytes and consent immediately.
    const epoch=store.authEpoch;
    await act(async()=>{store.setToken("replacement-safety-token");await Bun.sleep(35);});
    expect(store.authEpoch).toBeGreaterThan(epoch);expect(box.querySelector("img")).toBeNull();expect(button("Release").disabled).toBe(true);
    await wait(()=>store.me?.id==="replacement");
    await act(async()=>{button("Load selected photo").click();});await wait(()=>!!box.querySelector("img"));
    await act(async()=>{box.querySelector("img")!.dispatchEvent(new window.Event("load"));});
    const nextAck=[...box.querySelectorAll("input")].find(input=>input.type==="checkbox")!;
    await act(async()=>{nextAck.click();});expect(button("Release").disabled).toBe(false);
    await act(async()=>{store.setToken("");await Bun.sleep(35);});
    expect(box.querySelector("img")).toBeNull();expect(button("Release").disabled).toBe(true);expect(store.authNeeded).toBe(true);
    // The loaded object URL and acknowledgment also cannot survive a changed app scope.
    await act(async()=>{store.app="friends";store.notify();await Bun.sleep(35);});expect(box.querySelector("img")).toBeNull();
    expect(requests.some(r=>r.body?.decision==="release")).toBe(false);
  }finally{
    await act(async()=>{root.unmount();});globalThis.fetch=nativeFetch;api.stop(true);await window.happyDOM.close();
    for(const [name,descriptor]of prior){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete (globalThis as any)[name];}
  }
},30_000);
