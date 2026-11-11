// Actual MCP + public API HTTP flow and qualified Cloud producer; fictional existing account only.
// No OTP path, direct session creation, user account, provider network or live key.
import {test,expect} from 'bun:test';
import {createPublicApi} from '../../platform/src/api.ts';
import {MemoryPeopleStore} from '../../platform/src/store.ts';
import {APPS} from '../../platform/src/apps.ts';
import {NETWORK_FRESH_PERSON_SITES,networkTarget} from '../../core/src/svc/network-delegation.ts';
import {createMcpHandler} from '../src/handler.ts';
import {platformHooks} from '../src/hooks.ts';
import {MemoryOAuthStore} from '../src/store.ts';
import {defaultApps} from '../src/apps.ts';
import {pkceS256} from '../src/util.ts';
import {networkDelegationService,networkDelegationServiceRequest} from './fixtures/cloud-authorization-producer.ts';

async function fixture(){
 let now=Date.UTC(2026,9,19,12),live=true,otp=0;
 let validationFailure:'none'|'timeout'|'5xx'|'malformed'|'malformed-identity'|'identity-mismatch'='none';
 const phone='+12125550162',secret='synthetic-existing-network-authority-'.repeat(2),rows=new Map<string,any>();
 const producer=networkDelegationService({secret,now:()=>now,verifyBearer:async v=>v==='verified-fixture'?{userId:'fixture-steward',issuedAt:Math.floor(now/1000)-10,expiration:Math.floor(now/1000)+3600}:null,
 primaryOwner:async()=>live?{userId:'11111111-1111-4111-8111-111111111111',organizationId:'22222222-2222-4222-8222-222222222222',stewardUserId:'fixture-steward',e164:phone,agentId:'personal:33333333-3333-4333-8333-333333333333',expiresAt:now+3600000}:undefined,
 blockedByLogout:async()=>false,insert:async r=>{rows.set(r.code_hash,r)},claim:async k=>{const r=rows.get(k);rows.delete(k);return r}});
 const transport=Object.assign(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const req=input instanceof Request?input:new Request(input,init),raw=await req.text(),b=JSON.parse(raw);
  expect(await networkDelegationServiceRequest(req,secret,raw,now)).toBe(true);
  expect(req.headers.get('origin')).toBe(b.target.origin);
  if(req.url.endsWith('/validate')){
   if(validationFailure==='timeout')throw new DOMException('Synthetic Cloud transport deadline','TimeoutError');
   if(validationFailure==='5xx')return Response.json({ok:false},{status:503});
   if(validationFailure==='malformed')return new Response('{malformed',{status:200});
   if(validationFailure==='malformed-identity')return Response.json({ok:true,identity:{}});
  }
  const result=req.url.endsWith('/exchange')?await producer.exchange(b.target,b.code,b.codeVerifier):await producer.validate(b.target,b.proof);
  if(req.url.endsWith('/validate')&&validationFailure==='identity-mismatch'&&result)return Response.json({ok:true,identity:{...result,userId:'44444444-4444-4444-8444-444444444444'}});
  return req.url.endsWith('/exchange')?Response.json(result??{ok:false},{status:result?200:403}):Response.json(result?{ok:true,identity:result}:{ok:false},{status:result?200:403});
 },{preconnect(){}}) as typeof fetch;
 const people=new MemoryPeopleStore();const env={PLATFORM_ENV:'staging',STAGING_SITE_ORIGINS:JSON.stringify(NETWORK_FRESH_PERSON_SITES),NETWORK_CLOUD_AUTH_ENABLED:'true',NETWORK_CLOUD_AUTH_MODE:'own-pages-fresh-person-v1',NETWORK_CLOUD_AUTH_LOGIN_ORIGIN:'https://cloud.eliza.app',NETWORK_CLOUD_AUTH_API_ORIGIN:'https://api.eliza.app',SERVICE_TURN_SECRET:secret};
 const api=createPublicApi({store:people,now:()=>now,hashKey:'synthetic-hash-key',sessionSecret:'synthetic-session-key',env,cloudAuthFetch:transport,cloudValidationTtlMs:0,otp:{name:'must-not-be-called',send:async()=>{otp++;throw Error('OTP forbidden in this continuation')}},turnstile:{verify:async()=>true}});
 // One pre-existing fictional account fixture, not a signup or authenticated-session shortcut.
 const person=await api.accounts.createPerson(phone,'inbound_message',30);
 const membership={app:'ntwrk' as const,personId:person.id,memberId:'ntwrk_existing_fixture',state:'active' as const,review:null,firstName:'Existing fixture',profile:{about:'unchanged'},joinedAt:now,leftAt:null};await people.putMembership(membership);
 const hooks=platformHooks({store:people,otp:api.otp,accounts:api.accounts,sessions:api.sessions,app:id=>APPS[id],authenticatedSiteSession:(id,req)=>api.authenticatedSiteSession(id,req),cloudAuthorityRequired:id=>api.cloudAuthorityRequired(id),cloudGrantAuthority:(id,req,r)=>api.cloudGrantAuthority(id,req,r),validateCloudGrant:g=>api.validateCloudGrant(g),beginCloudOAuth:(id,rid)=>api.beginCloudOAuth?.(id,rid)} );
 const store=new MemoryOAuthStore(),apps=defaultApps(),mcp=createMcpHandler({platform:hooks,store,apps,env,now:()=>now,issuer:a=>NETWORK_FRESH_PERSON_SITES[a.id],hostMap:Object.fromEntries(Object.entries(NETWORK_FRESH_PERSON_SITES).map(([id,url])=>[new URL(url).host,id])) as any,minOtpStartMs:0});
 const origin=NETWORK_FRESH_PERSON_SITES.ntwrk,jar=new Map<string,string>();
 const request=async(path:string,init:RequestInit={},opts:{cookies?:boolean;origin?:string}={})=>{
  const base=opts.origin??origin,headers=new Headers(init.headers);if(opts.cookies!==false&&jar.size)headers.set('cookie',[...jar].map(([k,v])=>k+'='+v).join('; '));
  const req=new Request(base+path,{...init,headers});const res=path.startsWith('/api/')?(await api.fetch(req))!:(await mcp.fetch(req))!;
  if(opts.cookies!==false)for(const c of res.headers.getSetCookie()){const pair=c.split(';')[0]!,i=pair.indexOf('=');if(pair.slice(i+1))jar.set(pair.slice(0,i),pair.slice(i+1));else jar.delete(pair.slice(0,i));}
  return res;
 };
 const reg=await request('/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_name:'Existing agent fixture',redirect_uris:['https://chatgpt.com/connector_platform/oauth_redirect'],token_endpoint_auth_method:'none'})});expect(reg.status).toBe(201);const client=await reg.json() as any;
 const verifier='v'.repeat(64),resource=origin+'/mcp/openai',query=new URLSearchParams({response_type:'code',client_id:client.client_id,redirect_uri:client.redirect_uris[0],state:'original-agent-state',code_challenge:pkceS256(verifier),code_challenge_method:'S256',scope:'apps:read membership:read profile:write',resource});
 const start=await request('/oauth/authorize?'+query);
 return {api,people,store,person,membership,producer,request,start,jar,origin,client,verifier,resource,setValidationFailure:(v:typeof validationFailure)=>{validationFailure=v},getOtp:()=>otp,setLive:(v:boolean)=>{live=v},advance:(ms:number)=>{now+=ms},expire:()=>{now+=16*60*1000}};
}

async function cloudCallback(f:Awaited<ReturnType<typeof fixture>>){
 expect(f.start.status).toBe(302);const login=new URL(f.start.headers.get('location')!);expect(login.origin).toBe('https://cloud.eliza.app');expect(login.searchParams.get('realm')).toBe('fresh-person-20261015');
 const minted=await f.producer.mint('verified-fixture',networkTarget('ntwrk','fresh-person-20261015'),login.searchParams.get('challenge')!,login.searchParams.get('state')!);expect(minted).toBeDefined();
 const u=new URL(minted!.url);return f.request(u.pathname+u.search);
}

test('agent-originated Cloud OAuth returns to the same pending request and explicit consent without OTP or a portal',async()=>{
 const f=await fixture();expect(f.start.status).toBe(302);const before=structuredClone([...f.store.requests.values()][0]!);expect(f.getOtp()).toBe(0);
 const cb=await cloudCallback(f);expect(cb.status).toBe(303);const next=cb.headers.get('location')!;expect(next).toBe('/oauth/cloud-return?rid='+before.id);expect(next).not.toContain('/settings');
 expect((await f.request(next,{}, {cookies:false})).status).toBe(400);
 expect((await f.request(next+'&next=https://evil.example')).status).toBe(400);
 expect((await f.request(next,{}, {origin:NETWORK_FRESH_PERSON_SITES.friends})).status).toBe(400);
 const resume=await f.request(next);expect(resume.status).toBe(200);expect(await resume.text()).toContain('Allow this assistant?');expect(f.store.grants.size).toBe(0);
 const after=await f.store.getAuthRequest(before.id);expect(after).toMatchObject({clientId:before.clientId,redirectUri:before.redirectUri,state:before.state,codeChallenge:before.codeChallenge,scopes:before.scopes,resource:before.resource,personId:f.person.id,step:'consent'});
 expect((await f.request(next)).status).toBe(400);
 const approved=await f.request('/oauth/authorize/consent',{method:'POST',headers:{origin:f.origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({rid:before.id,decision:'approve'})});expect(approved.status).toBe(303);
 const u=new URL(approved.headers.get('location')!);expect(u.origin+u.pathname).toBe(f.client.redirect_uris[0]);expect(u.searchParams.get('state')).toBe('original-agent-state');
 const tok=await f.request('/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code:u.searchParams.get('code')!,client_id:f.client.client_id,redirect_uri:f.client.redirect_uris[0],code_verifier:f.verifier,resource:f.resource})});expect(tok.status).toBe(200);
 const grant=[...f.store.grants.values()][0]!;expect(grant.id.startsWith('grant_cloud_')).toBe(true);expect(grant.personId).toBe(f.person.id);expect(grant.resource).toBe(f.resource);expect(grant.cloudAuthority).toBeDefined();expect(f.getOtp()).toBe(0);expect(await f.people.getMembership(f.person.id,'ntwrk')).toEqual(f.membership);
 const issued=await tok.json() as any;f.setLive(false);const revoked=await f.request('/mcp/openai',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',authorization:'Bearer '+issued.access_token},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'check_status',arguments:{}}})});expect(revoked.status).toBe(401);
});

test('Cloud OAuth continuation rejects expired or revoked authority and public caller return destinations',async()=>{
 const f=await fixture();const request=[...f.store.requests.values()][0]!;const cb=await cloudCallback(f);expect(cb.status).toBe(303);
 const publicStart=await f.request('/api/auth/cloud/start',{method:'POST',headers:{origin:f.origin,'content-type':'application/json'},body:JSON.stringify({returnPath:'/oauth/cloud-return?rid='+request.id})});expect(publicStart.status).toBe(400);
 f.setLive(false);expect((await f.request(cb.headers.get('location')!)).status).toBe(403);expect(f.store.grants.size).toBe(0);expect(f.getOtp()).toBe(0);
 const expired=await fixture();const done=await cloudCallback(expired);expired.expire();expect((await expired.request(done.headers.get('location')!)).status).toBe(400);expect(expired.store.grants.size).toBe(0);
});

// Real owner handlers and Cloud wire parser see each transient failure, not a stubbed status hook.
for(const failure of ['timeout','5xx','malformed','malformed-identity'] as const)test(`Cloud ${failure} denies temporarily and recovers with unchanged access/refresh credentials`,async()=>{
 const f=await fixture();const cb=await cloudCallback(f);expect(cb.status).toBe(303);
 expect((await f.request(cb.headers.get('location')!)).status).toBe(200);
 const pending=[...f.store.requests.values()][0]!;
 const consent=await f.request('/oauth/authorize/consent',{method:'POST',headers:{origin:f.origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({rid:pending.id,decision:'approve'})});expect(consent.status).toBe(303);
 const code=new URL(consent.headers.get('location')!).searchParams.get('code')!;
 const beforeCode=structuredClone({grants:[...f.store.grants],codes:[...f.store.codes]});f.setValidationFailure(failure);
 const exchange=()=>f.request('/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,client_id:f.client.client_id,redirect_uri:f.client.redirect_uris[0],code_verifier:f.verifier,resource:f.resource})});
 const blockedCode=await exchange();expect(blockedCode.status).toBe(503);expect((await blockedCode.json() as any).error).toBe('temporarily_unavailable');expect({grants:[...f.store.grants],codes:[...f.store.codes]}).toEqual(beforeCode);
 f.setValidationFailure('none');const issuedResponse=await exchange();expect(issuedResponse.status).toBe(200);
 const issued=await issuedResponse.json() as {access_token:string;refresh_token:string};
 const mcp=()=>f.request('/mcp/openai',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',authorization:'Bearer '+issued.access_token},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'check_status',arguments:{}}})});
 const refresh=()=>f.request('/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:issued.refresh_token,client_id:f.client.client_id,resource:f.resource})});
 const before=structuredClone({grants:[...f.store.grants],tokens:[...f.store.tokens]});f.setValidationFailure(failure);
 const unavailable=await mcp();expect(unavailable.status).toBe(503);expect(unavailable.headers.get('retry-after')).toBe('5');expect(unavailable.headers.get('www-authenticate')).toBeNull();
 const pausedRefresh=await refresh();expect(pausedRefresh.status).toBe(503);expect((await pausedRefresh.json() as any).error).toBe('temporarily_unavailable');expect(pausedRefresh.headers.get('retry-after')).toBe('5');
 expect({grants:[...f.store.grants],tokens:[...f.store.tokens]}).toEqual(before);expect(f.getOtp()).toBe(0);
 f.setValidationFailure('none');expect((await mcp()).status).toBe(200);
 const recovered=await refresh();expect(recovered.status).toBe(200);expect((await recovered.json() as any).access_token).toBeDefined();expect([...f.store.grants]).toEqual(before.grants);expect(f.getOtp()).toBe(0);
 f.setValidationFailure('identity-mismatch');const wrongIdentity=await mcp();expect(wrongIdentity.status).toBe(401);expect(wrongIdentity.headers.get('www-authenticate')).toContain('invalid_token');
 f.setValidationFailure('none');expect((await mcp()).status).toBe(200);
 f.setLive(false);expect((await mcp()).status).toBe(401);
 // Even an outage cannot keep authority or its refresh token alive after the sealed expiry.
 f.setLive(true);f.setValidationFailure(failure);f.advance(3600000);const expired=await refresh();expect(expired.status).toBe(400);expect((await expired.json() as any).error).toBe('invalid_grant');expect([...f.store.grants]).toEqual(before.grants);
});

for(const failure of ['timeout','5xx','malformed','malformed-identity'] as const)test(`Cloud ${failure} before return and consent retries the same pending browser request`,async()=>{
 const f=await fixture(),cb=await cloudCallback(f);expect(cb.status).toBe(303);const path=cb.headers.get('location')!;
 const beforeReturn=structuredClone({requests:[...f.store.requests],cookies:[...f.jar]});f.setValidationFailure(failure);
 const pausedReturn=await f.request(path);expect(pausedReturn.status).toBe(503);expect(pausedReturn.headers.get('retry-after')).toBe('5');const pausedPage=await pausedReturn.text();expect(pausedPage).toContain('agent or text conversation');expect(pausedPage).not.toContain('Sign in again');
 expect({requests:[...f.store.requests],cookies:[...f.jar]}).toEqual(beforeReturn);expect(f.store.grants.size).toBe(0);expect(f.getOtp()).toBe(0);
 f.setValidationFailure('none');expect((await f.request(path)).status).toBe(200);
 const pending=[...f.store.requests.values()][0]!,beforeConsent=structuredClone({requests:[...f.store.requests],cookies:[...f.jar]});
 const allow=()=>f.request('/oauth/authorize/consent',{method:'POST',headers:{origin:f.origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({rid:pending.id,decision:'approve'})});
 f.setValidationFailure(failure);const pausedConsent=await allow();expect(pausedConsent.status).toBe(503);expect(pausedConsent.headers.get('retry-after')).toBe('5');expect(pausedConsent.headers.get('content-security-policy')).toContain("form-action 'self' https://chatgpt.com");const consentPage=await pausedConsent.text();expect(consentPage).toContain('agent or text conversation');expect(consentPage).toContain('name="rid" value="'+pending.id+'"');expect(consentPage).not.toContain('Sign in again');
 expect({requests:[...f.store.requests],cookies:[...f.jar]}).toEqual(beforeConsent);expect(f.store.grants.size).toBe(0);expect(f.store.codes.size).toBe(0);expect(f.getOtp()).toBe(0);
 f.setValidationFailure('none');const recovered=await allow();expect(recovered.status).toBe(303);expect(new URL(recovered.headers.get('location')!).searchParams.get('state')).toBe('original-agent-state');expect(f.store.grants.size).toBe(1);expect(f.getOtp()).toBe(0);
});

for(const expires of ['code','grant'] as const)test(`expiry during awaited code take denies minting for expired ${expires}`,async()=>{
 const f=await fixture(),cb=await cloudCallback(f);expect(cb.status).toBe(303);expect((await f.request(cb.headers.get('location')!)).status).toBe(200);const pending=[...f.store.requests.values()][0]!;
 const consent=await f.request('/oauth/authorize/consent',{method:'POST',headers:{origin:f.origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({rid:pending.id,decision:'approve'})});expect(consent.status).toBe(303);const code=new URL(consent.headers.get('location')!).searchParams.get('code')!;
 const redeem=f.store.redeemCode.bind(f.store);f.store.redeemCode=(hash,at,mint)=>redeem(hash,at,consumed=>{f.advance(expires==='code'?6*60000:3600000);return mint(consumed)});
 const response=await f.request('/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,client_id:f.client.client_id,redirect_uri:f.client.redirect_uris[0],code_verifier:f.verifier,resource:f.resource})});
 expect(response.status).toBe(400);expect((await response.json() as any).error).toBe('invalid_grant');expect(f.store.tokens.size).toBe(0);expect([...f.store.codes.values()][0]?.usedAt).not.toBeNull();expect([...f.store.grants.values()][0]?.revokedAt).toBeNull();expect(f.getOtp()).toBe(0);
});


test('Cloud consent stays single-use across concurrent validated approvals', async () => {
 const f = await fixture();
 const callback = await cloudCallback(f);
 expect(callback.status).toBe(303);
 expect((await f.request(callback.headers.get('location')!)).status).toBe(200);
 const pending = [...f.store.requests.values()][0]!;
 const allow = () => f.request('/oauth/authorize/consent', {
  method: 'POST', headers: { origin: f.origin, 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ rid: pending.id, decision: 'approve' }),
 });
 const results = await Promise.all([allow(), allow()]);
 expect(results.map(r => r.status).sort()).toEqual([303, 400]);
 expect(f.store.grants.size).toBe(1);
 expect(f.store.codes.size).toBe(1);
 expect(f.store.rows.filter(r => r.kind === 'consent_granted')).toHaveLength(1);
 expect([...f.store.grants.values()][0]!.cloudAuthority).toBeDefined();
 expect(await f.store.getAuthRequest(pending.id)).toBeUndefined();
 expect(f.getOtp()).toBe(0);
});
