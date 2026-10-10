import { expect, test } from 'bun:test';
import { startStack, newPhone, webJoin, Browser, connectMcp, VERIFIER, rpc, toolData } from '../../../tests/e2e/harness.ts';
import { createServiceMcp } from '../service/serve.ts';
import { createPublicApi } from '../../platform/src/api.ts';
import { pkceS256 } from '../../mcp/src/util.ts';
import { SQL } from 'bun';
import { proxySignature } from '../../platform/src/proxy.ts';
import { loadConfig, normalizeEdge } from '../../../deploy/backend/backend.ts';

const origin='https://slop-qa.example.test', secret='stage-proxy-secret-'.repeat(3);
test('staging authority keeps signed HTTP API and OAuth on its configured app origin', async()=>{
 const originalFetch=globalThis.fetch; let verifiedHostname=new URL(origin).hostname; let mcpBotChecks=0;
 globalThis.fetch=(async(input:any,init?:RequestInit)=>{if(String(input)==='https://challenges.cloudflare.com/turnstile/v0/siteverify'){mcpBotChecks++;return Response.json({success:true,hostname:verifiedHostname})}return originalFetch(input,init)}) as typeof fetch;
 const st=await startStack(); let server:ReturnType<typeof Bun.serve>|undefined; let mcp:Awaited<ReturnType<typeof createServiceMcp>>;
 const env={PLATFORM_ENV:'staging', NODE_ENV:'production', STAGING_SITE_ORIGINS:JSON.stringify({slop:origin}),PLATFORM_HASH_KEY:'stage-hash-key-'.repeat(3),PLATFORM_SESSION_SECRET:'dev-only-platform-session-secret',PLATFORM_PROXY_SECRET:secret,TURNSTILE_SITE_KEY:'stage-key',TURNSTILE_SECRET_KEY:'fixture-secret',LEAK_LABEL_KEY:'labels'.repeat(8),DATABASE_URL:st.url,MIGRATE_ON_BOOT:'0',OTP_PROVIDER:'twilio',TWILIO_ACCOUNT_SID:'fixture',TWILIO_AUTH_TOKEN:'fixture',TWILIO_VERIFY_SERVICE_SID:'fixture'};
 const config=loadConfig(env);
 try{
  const phone=newPhone(); await webJoin(st,'slop',phone,{age:30});
  const person=(await st.svc.publicApi.accounts.personFor(phone))!;
  const allowedHosts:string[][]=[];
  const api=createPublicApi({store:st.svc.people,env,hashKey:'dev-only-platform-hash-key',now:()=>st.clock.now(),otp:st.otp,turnstile:{verify:async(_token,_ip,hosts)=>{allowedHosts.push([...(hosts??[])]);return hosts?.includes(new URL(origin).hostname)??false}},minStartMs:0,minVerifyMs:0});
  mcp=await createServiceMcp(st.svc,{env:{...env,MCP_CUSTOM_CHATGPT_SLOP:'on',MCP_CUSTOM_CHATGPT_SLOP_PERSON_IDS:person.id},databaseUrl:st.url,migrate:false,now:()=>st.clock.now(),log:()=>{}});
  server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
   const edge=await normalizeEdge(req,secret,config.hostMap,st.clock.now());
   if (!edge.edge) return new Response("edge_required", {status:421});
   return (await mcp?.fetch(edge.req))??(await api.fetch(edge.req))??new Response('not found',{status:404});
  }});
  const call=async(path:string,body?:unknown,browser?:Browser,form?:Record<string,string>,extraHeaders:Record<string,string>={},requestHost=new URL(origin).host)=>{
   const method=body===undefined&&!form?'GET':'POST';const headers=new Headers({'host':requestHost,'origin':origin});
   const facts={method,path,host:requestHost,ip:'203.0.113.42',ts:Math.floor(st.clock.now()/1000)};
   headers.set('x-network-proxy-host',facts.host);headers.set('x-network-proxy-ip',facts.ip);headers.set('x-network-proxy-ts',String(facts.ts));headers.set('x-network-proxy-sig',await proxySignature(secret,facts));
   for(const [key,value]of Object.entries(extraHeaders))headers.set(key,value);
   if(browser)headers.set('cookie',browser.header()); if(body!==undefined)headers.set('content-type','application/json'); if(form)headers.set('content-type','application/x-www-form-urlencoded');
   const res=await fetch(`http://127.0.0.1:${server!.port}${path}`,{method,headers,body:form?new URLSearchParams(form).toString():body===undefined?undefined:JSON.stringify(body),redirect:'manual'});browser?.take(res);return res;
  };
  const discovery=await call('/.well-known/oauth-authorization-server');expect(discovery.status).toBe(200);
  const metadata=await discovery.json() as any;expect(metadata.issuer).toBe(origin);expect(metadata.authorization_endpoint).toBe(`${origin}/oauth/authorize`);
  const resource=await(await call('/.well-known/oauth-protected-resource/mcp')).json() as any;expect(resource.resource).toBe(`${origin}/mcp`);
  const app=await(await call('/api/app')).json() as any;expect(app.id).toBe('slop');expect(app.domain).toBe(new URL(origin).host);
  const browser=new Browser();st.clock.advance(31_000);
  expect((await call('/api/auth/otp/start',{phone,turnstileToken:'fixture'},browser)).status).toBe(200);
  expect(allowedHosts.at(-1)).toEqual([new URL(origin).hostname]);
  const verify=await call('/api/auth/otp/verify',{phone,code:st.otp.last(phone)},browser);expect(verify.status).toBe(200);expect(verify.headers.get('set-cookie')).toContain('__Host-sid=');expect(verify.headers.get('set-cookie')).toContain('Secure');
  const info=await(await call('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'app_info',arguments:{app:'slop'}}})).json() as any;
  expect(info.result.structuredContent.site).toBe(origin);expect(info.result.structuredContent.join.url).toBe(`${origin}/join?via=agent`);
  expect((await call('/mcp/openai',{jsonrpc:'2.0',id:1,method:'tools/list'})).status).toBe(404);
  const stageStack={...st,sites:{...st.sites,slop:{...st.sites.slop,origin}},site:async(_app:string,path:string,init:any={})=>call(path,init.json,init.browser,init.form?{...init.form,...(path==='/oauth/authorize/phone'?{'cf-turnstile-response':'fixture'}:{})}:undefined)} as typeof st;
  const connection=await connectMcp(stageStack,'slop',phone,{browser:new Browser(),redirect:'https://chatgpt.com/connector_platform_oauth_redirect'});
  expect(connection.token?.access_token,connection.html).toBeString();
  expect(mcpBotChecks).toBe(1);
  expect(new URL(connection.location!).searchParams.get('iss')).toBe(origin);
  const protectedCall=(name:string,args:Record<string,unknown>={})=>call('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}},undefined,undefined,{authorization:`Bearer ${connection.token!.access_token}`});
  const status=await(await protectedCall('check_status'))!.json() as any;expect(status.result.structuredContent).toMatchObject({app:'slop',status:'active'});
  const about="I'm Rae,30, in Williamsburg, seeking a long-term relationship. I like climbing and live music.";
  expect(((await (await protectedCall('submit_profile',{about})).json()) as any).result.structuredContent.submitted).toBe(true);
  const db=new SQL({url:st.url,max:1});
  try{const rows=await db`select m.id from network.members m join network.messages msg on msg.member_id=m.id where m.app_id='slop' and m.person_id=${person.id} and msg.body=${about}`;expect(rows.length).toBe(1)}finally{await db.close()}
  expect(((await(await protectedCall('check_status')).json()) as any).result.structuredContent).toMatchObject({app:'slop',status:'active'});
  const wrongQuery=new URLSearchParams({response_type:'code',client_id:connection.client.client_id,redirect_uri:'https://chatgpt.com/connector_platform_oauth_redirect',code_challenge:pkceS256(VERIFIER),code_challenge_method:'S256',resource:'https://slop.date/mcp'});
  expect((await call(`/oauth/authorize?${wrongQuery}`,undefined,browser)).status).toBe(400);
  expect((await call('/.well-known/oauth-authorization-server',undefined,undefined,undefined,{},'slop.date')).status).toBe(421);
  expect((await call('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'check_status',arguments:{}}},undefined,undefined,{authorization:`Bearer ${connection.token!.access_token}`,origin:'https://peon.biz'},'peon.biz')).status).toBe(401);
  const wrong=new Request('https://slop.date/mcp',{method:'POST',headers:{authorization:`Bearer ${connection.token!.access_token}`,'content-type':'application/json'},body:'{}'});
  expect((await mcp!.fetch(wrong))!.status).toBe(404);
  const canonical=new Request('http://127.0.0.1/api/app',{headers:{host:'slop.date'}});
  expect((await api.fetch(canonical))!.status).toBe(404);
  expect((await call('/.well-known/oauth-authorization-server',undefined,undefined,undefined,{host:new URL(origin).host},'slop.date')).status).toBe(421);
  expect(config.hostMap['slop.date']).toBeUndefined();expect(config.hostMap['peon.biz']).toBe('peon');
  for(const [key,value] of Object.entries({badApp:JSON.stringify({other:origin}),path:JSON.stringify({slop:origin+'/join'}),credentials:JSON.stringify({slop:'https://user:pw@preview.example.test'}),canonical:JSON.stringify({slop:'https://slop.date'}),canonicalDot:JSON.stringify({slop:'https://slop.date.'}),duplicateDot:JSON.stringify({slop:origin,peon:'https://slop-qa.example.test.'}),encodedHost:JSON.stringify({slop:'https://%73lop.date'}),duplicate:JSON.stringify({slop:origin,peon:origin}),sharedHostnamePorts:JSON.stringify({slop:origin+':8443',peon:origin+':9443'})})){
   expect(()=>loadConfig({...env,STAGING_SITE_ORIGINS:value}),key).toThrow(/STAGING_SITE_ORIGINS/);
  }
  expect(()=>loadConfig({...env,PLATFORM_ENV:'production'})).toThrow(/STAGING_SITE_ORIGINS/);
  expect(()=>loadConfig({...env,DEPLOY_TARGET:'production'})).toThrow(/STAGING_SITE_ORIGINS/);
  expect(()=>loadConfig({...env,BACKEND_EXTRA_HOSTS:'slop-qa.example.test=peon'})).toThrow(/conflicts/);
  expect(()=>loadConfig({...env,BACKEND_EXTRA_HOSTS:'slop.date=slop'})).toThrow(/conflicts/);

 }finally{globalThis.fetch=originalFetch;server?.stop(true);await (mcp?.store as any)?.close?.();await st.close()}
},180000);
