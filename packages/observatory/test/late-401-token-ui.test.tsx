// SD-470 (gap-console GC13): the console store against a controlled localhost HTTP server. A request sent
// with the old token can answer 401 after the staff member enters a good new token. That late 401 must not
// open the token prompt again: only a 401 for the token in use says that the console needs a new one.
import {expect,test} from "bun:test";
import {Window} from "happy-dom";

test("a late 401 for the old token does not open the prompt after a good token swap",async()=>{
  let releaseOld:()=>void=()=>{};
  const oldAnswered=new Promise<void>(r=>{releaseOld=r;});
  const api=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async req=>{
    const u=new URL(req.url),token=req.headers.get("authorization")??"";
    if(u.pathname==="/api/slow"){
      // The poll sent with the old token is still in flight when the new token is set.
      if(token==="Bearer old-token"){await oldAnswered;return Response.json({error:"token required"},{status:401});}
      if(token==="Bearer new-token")return Response.json({ok:true});
      return Response.json({error:"token required"},{status:401});
    }
    return Response.json({error:"not in this fixture"},{status:404});
  }});
  const window=new Window({url:api.url.href}),prior=new Map<string,PropertyDescriptor|undefined>();
  for(const [name,value]of Object.entries({window,document:window.document,navigator:window.navigator,location:window.location,history:window.history,localStorage:window.localStorage,sessionStorage:window.sessionStorage,HTMLElement:window.HTMLElement})){
    prior.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
  }
  const nativeFetch=globalThis.fetch;
  globalThis.fetch=((input:any,init?:RequestInit)=>nativeFetch(typeof input==="string"?new URL(input,api.url):input,init)) as typeof fetch;
  let s:any,before="";
  try{
    const {store}=await import("../web/store.ts");
    // The socket and the full reload are not part of this check: only the request path and the prompt.
    s=store;before=s.token;s.connect=()=>{};s.load=async()=>{};
    store.setToken("old-token");
    const late=store.fetch("/api/slow");
    await Bun.sleep(30);
    store.setToken("new-token");
    expect(store.authNeeded).toBe(false);
    releaseOld();
    expect((await late).status).toBe(401);
    expect(store.authNeeded).toBe(false);
    expect((await store.fetch("/api/slow")).status).toBe(200);
    // A 401 for the token in use still opens the prompt.
    store.setToken("revoked-token");
    expect((await store.fetch("/api/slow")).status).toBe(401);
    expect(store.authNeeded).toBe(true);
  }finally{
    if(s){s.setToken(before);delete s.connect;delete s.load;}globalThis.fetch=nativeFetch;api.stop(true);await window.happyDOM.close();
    for(const [name,descriptor]of prior){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete (globalThis as any)[name];}
  }
},30_000);
