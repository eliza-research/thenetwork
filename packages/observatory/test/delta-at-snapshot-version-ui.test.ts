// SD-505 (observatory D27; Quint deltaTwiceTest): the console store against a controlled localhost HTTP and
// WebSocket server. A delta that arrives while the full state loads is held, then applied after the state.
// A state at version V already holds everything up to delta V, so delta V must not be applied again: its
// feed lines would show twice.
import {expect,test} from "bun:test";
import {Window} from "happy-dom";

test("a delta at the version of the loaded state does not add its feed lines again",async()=>{
  const line={seq:1,t:1,kind:"message",text:"Ada joined"};
  const delta={version:1,clock:{now:1,speed:1,running:false},feed:[line]};
  const sockets=new Set<any>();
  let stateAsked=0;
  const api=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async(req,srv)=>{
    const u=new URL(req.url);
    if(u.pathname==="/ws")return srv.upgrade(req)?undefined:new Response("no upgrade",{status:400});
    if(u.pathname==="/api/ws-ticket")return Response.json({ticket:"t1"});
    if(u.pathname==="/api/mode")return Response.json({mode:"real"});
    if(u.pathname==="/api/me")return Response.json({id:"fixture",roles:["admin"],grants:[{role:"admin",app:"*"}],via:"token"});
    if(u.pathname==="/api/state"){
      stateAsked++;
      // The server takes delta 1 and broadcasts it, then the snapshot (version 1, with that feed line) is read.
      for(const ws of sockets)ws.send(JSON.stringify({type:"delta",mode:"real",delta}));
      await Bun.sleep(80);
      return Response.json({env:{},clock:delta.clock,stats:{},engineRuns:[],network:undefined,requests:[],members:[],edges:[],opportunities:[],feed:[line],version:1});
    }
    return Response.json({error:"not in this fixture"},{status:404});
  },websocket:{open:ws=>{sockets.add(ws);},close:ws=>{sockets.delete(ws);},message:()=>{}}});
  const window=new Window({url:api.url.href}),prior=new Map<string,PropertyDescriptor|undefined>();
  for(const [name,value]of Object.entries({window,document:window.document,navigator:window.navigator,location:window.location,history:window.history,localStorage:window.localStorage,sessionStorage:window.sessionStorage,HTMLElement:window.HTMLElement})){
    prior.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
  }
  // The token the other console test files expect when this file loads the store first.
  window.sessionStorage.setItem("obs.token","fixture-safety-token");
  const nativeFetch=globalThis.fetch;
  globalThis.fetch=((input:any,init?:RequestInit)=>nativeFetch(typeof input==="string"?new URL(input,api.url):input,init)) as typeof fetch;
  let s:any,saved:any;
  try{
    const {store}=await import("../web/store.ts");
    s=store;saved=Object.fromEntries(["mode","app","me","feed","version"].map(k=>[k,s[k]]));
    await store.connect();
    for(let i=0;i<100&&!store.connected;i++)await Bun.sleep(10);
    expect(store.connected).toBe(true);
    await store.load();
    expect(stateAsked).toBe(1);
    expect(store.version).toBe(1);
    expect(store.feed.filter(f=>f.seq===1).length).toBe(1);
  }finally{
    if(s){s.wsGen++;s.ws?.close();Object.assign(s,saved);}globalThis.fetch=nativeFetch;api.stop(true);await window.happyDOM.close();
    for(const [name,descriptor]of prior){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete (globalThis as any)[name];}
  }
},30_000);
