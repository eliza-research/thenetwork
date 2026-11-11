// SD-246 (gap-console GC9): the normal Config panel and store against a controlled localhost HTTP server.
// The matching switch is two-step (arm, then confirm within 4 s). After an app switch, the panel must show
// the new app's configuration, and a switch armed for one app must not turn matching on or off for another.
// The bias monitor must show the new app's reports too.
import {expect,test} from "bun:test";
import {Window} from "happy-dom";
import {createElement,act} from "react";

const CONFIG=(on:boolean)=>({matchingEnabled:on,reviewMode:"human",network:{},outreach:{},history:[],canChange:true});

test("an armed matching switch, the config data and the bias reports of one app do not carry over to another app",async()=>{
  const actions:{app:string;body:any}[]=[];
  const matching:Record<string,boolean>={slop:true,friends:false};
  const api=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async req=>{
    const u=new URL(req.url),app=u.searchParams.get("app")??"";
    if(u.pathname==="/api/control"&&req.method==="POST"){const body=await req.json() as any;actions.push({app,body});matching[app]=body.on;return Response.json({ok:true});}
    if(u.pathname==="/api/config")return Response.json(CONFIG(matching[app]!));
    if(u.pathname==="/api/bias")return app==="slop"?Response.json({ok:true,reports:[]}):Response.json({ok:false,error:"no reports for this app"},{status:404});
    if(u.pathname==="/api/audit")return Response.json({sink:"postgres",entries:[]});
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
    const {store}=await import("../web/store.ts"),{Config,BiasMonitor}=await import("../web/admin.tsx");
    store.mode="real";store.app="slop";store.network=undefined;store.env=undefined;store.me={id:"fixture",roles:["admin"],grants:[{role:"admin",app:"*"}],via:"token"};
    await act(async()=>{root.render(createElement("div",null,createElement(Config),createElement(BiasMonitor)));});await wait(()=>!!button("Turn off"));
    await wait(()=>!!box.textContent?.includes("No report yet"));
    // Armed for slop.
    await act(async()=>{button("Turn off")!.click();});await wait(()=>!!button("Confirm: turn off"));
    // The same state change as store.setApp (members emptied, app changed), without its socket and full load.
    await act(async()=>{store.app="friends";store.members=new Map();store.notify();await Bun.sleep(35);});
    // A confirm that still shows goes out now.
    const armed=button("Confirm:");
    if(armed)await act(async()=>{armed.click();await Bun.sleep(35);});
    expect(actions).toEqual([]);
    // The panel shows friends' own switch (off), not armed: one press arms it and sends nothing.
    await wait(()=>!!button("Turn on"));
    await act(async()=>{button("Turn on")!.click();await Bun.sleep(35);});
    expect(actions).toEqual([]);
    await act(async()=>{button("Confirm: turn on")!.click();await Bun.sleep(35);});
    expect(actions).toEqual([{app:"friends",body:{type:"matching",on:true}}]);
    // The bias monitor read friends' reports (none: 404), not slop's.
    expect(box.textContent).not.toContain("No report yet");
    expect(box.textContent).toContain("The bias monitor runs on real data only");
  }finally{
    await act(async()=>{root.unmount();});globalThis.fetch=nativeFetch;api.stop(true);await window.happyDOM.close();
    for(const [name,descriptor]of prior){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete (globalThis as any)[name];}
  }
},30_000);
