// Normal OAuth and phone-session HTTP flow. Only OTP delivery is controlled; no real person/provider.
import {expect, test} from "bun:test";
import {createPublicApi, APPS} from "@thenetwork/platform";
import {MemoryOAuthStore} from "../src/store.ts";
import {call, connect, PHONE_A, PHONE_B, setup} from "./harness.ts";

const claim = (e: ReturnType<typeof setup>, cookie: string, domain = "friends.help", origin = `https://${domain}`) =>
  e.fetch(new Request(`https://${domain}/oauth/signup-draft`, {method:"POST",headers:{cookie,origin,"content-type":"application/json"},body:"{}"}));
const browser = async (e: ReturnType<typeof setup>, phone: string) => {
  const s=await e.sessions.create("friends",phone,null);return `sid_friends=${s.token}`;
};

test("settled draft cannot Join a different signed-in account or record its age and consent", async () => {
  const e=setup(), c=await connect(e,"friends.help",PHONE_A);
  await call(e,"https://friends.help/mcp","prepare_signup",{firstName:"Ari",homeCity:"sf"},{token:c.token.access_token});
  const cookieA=await browser(e,PHONE_A),shown=await(await claim(e,cookieA)).json()as any;
  const api=createPublicApi({store:e.people,otp:e.provider,hashKey:"test-hash-key",sessionSecret:"test-session-secret",now:()=>e.clock.t,env:{PLATFORM_ENV:"dev"},minStartMs:0,minVerifyMs:0});
  const cookieB=await browser(e,PHONE_B);
  const submit=(signupView:unknown,age:number)=>api.fetch(new Request("https://friends.help/api/join",{method:"POST",headers:{host:"friends.help",origin:"https://friends.help",cookie:cookieB,"content-type":"application/json"},body:JSON.stringify({...shown.draft,signupView,age,consent:{sms:true,wording:APPS.friends.consent.text}})}));
  for(const stale of [shown.signupView,null,7]){
    const denied=(await submit(stale,12))!;
    expect(denied.status).toBe(409);expect(await denied.json()).toMatchObject({error:"account_changed"});
    expect(await e.people.ageFloor(e.accounts.phoneHash(PHONE_B))).toBeUndefined();
    expect(await e.accounts.personFor(PHONE_B)).toBeUndefined();
    expect(await e.people.consentEvents(PHONE_B,"friends")).toHaveLength(0);
  }
  expect(await e.accounts.personFor(PHONE_A)).toBeUndefined();
  const me=await(await api.fetch(new Request("https://friends.help/api/me",{headers:{host:"friends.help",cookie:cookieB}})))!.json()as any;
  expect((await submit(me.signupView,29))!.status).toBe(200);
  const person=await e.accounts.personFor(PHONE_B);
  expect((await e.people.getMembership(person!.id,"friends"))!.firstName).toBe("Ari");
  expect(await e.people.consentEvents(PHONE_B,"friends")).toHaveLength(1);
});

test("verified-phone OAuth draft is app-bound, recoverable until deliberate use, editable before normal Join and never opts in", async () => {
  const e=setup(), c=await connect(e,"friends.help",PHONE_A), token=c.token.access_token;
  const saved=await call(e,"https://friends.help/mcp","prepare_signup",{firstName:"Ari",homeCity:"sf"},{token});
  expect(saved.body!.result.structuredContent).toMatchObject({prepared:true,url:"https://friends.help/join?via=agent"});
  expect(saved.text).not.toContain(PHONE_A);
  expect(await e.accounts.personFor(PHONE_A)).toBeUndefined();
  expect((await call(e,"https://friends.help/mcp","prepare_signup",{firstName:"Overwrite"},{token})).body!.result.isError).toBe(true);
  expect(await (await claim(e,await browser(e,PHONE_B))).json()).toMatchObject({draft:null});
  const nt=await e.sessions.create("ntwrk",PHONE_A,null);
  expect(await (await claim(e,`sid_ntwrk=${nt.token}`,"ntwrk.party")).json()).toMatchObject({draft:null});
  const cookie=await browser(e,PHONE_A);
  expect((await claim(e,cookie,"friends.help","https://evil.example")).status).toBe(403);
  const taken=await claim(e,cookie);expect(taken.headers.get("cache-control")).toBe("no-store");
  const shown=await taken.json() as {draft:unknown;signupView:string};
  expect(shown.draft).toEqual({firstName:"Ari",homeCity:"sf"});
  // Same-account reload/retry, including a response the browser never used, remains recoverable.
  expect(await (await claim(e,cookie)).json()).toEqual(shown);
  const discard = await e.fetch(new Request("https://friends.help/oauth/signup-draft/discard",{method:"POST",headers:{cookie,origin:"https://friends.help","content-type":"application/json"},body:JSON.stringify({signupView:shown.signupView})}));
  expect(discard.status).toBe(200);
  expect(await(await claim(e,cookie)).json()).toMatchObject({draft:null});
  expect(await e.accounts.personFor(PHONE_A)).toBeUndefined();
  // Human corrects the name/city and supplies age + explicit app consent through the normal API.
  const api=createPublicApi({store:e.people,otp:e.provider,hashKey:"test-hash-key",sessionSecret:"test-session-secret",now:()=>e.clock.t,env:{PLATFORM_ENV:"dev"},minStartMs:0,minVerifyMs:0});
  const response=await api.fetch(new Request("https://friends.help/api/join",{method:"POST",headers:{host:"friends.help",origin:"https://friends.help",cookie,"content-type":"application/json"},body:JSON.stringify({firstName:"Rae",age:29,homeCity:"nyc",consent:{sms:true,wording:APPS.friends.consent.text}})}));
  expect(response!.status).toBe(200);
  const person=await e.accounts.personFor(PHONE_A);expect(person).toBeDefined();
  const member=await e.people.getMembership(person!.id,"friends");expect(member!.firstName).toBe("Rae");expect(member!.profile.homeCity).toBe("nyc");
  expect((await e.people.consentEvents(PHONE_A,"friends")).length).toBe(1);
  // A null-person grant cannot follow a newly created person.
  expect((await call(e,"https://friends.help/mcp","prepare_signup",{firstName:"Oldgrant"},{token})).res.status).toBe(401);
});

test("draft refuses private extra fields, lacks unauthenticated writes, expires and dies on grant revocation",async()=>{
  const limited=setup(), lc=await connect(limited,"friends.help",PHONE_A,{scope:"apps:read membership:read"});
  expect((await call(limited,"https://friends.help/mcp","prepare_signup",{firstName:"Ari"},{token:lc.token.access_token})).res.status).toBe(403);
  const e=setup(), c=await connect(e,"friends.help",PHONE_A), token=c.token.access_token;
  expect((await call(e,"https://friends.help/mcp","prepare_signup",{firstName:"Ari"})).res.status).toBe(401);
  for(const extra of [{phone:PHONE_A},{code:"314159"},{gender:"male"},{orientation:"straight"},{age:29},{consent:true},{app:"slop"}])
    expect((await call(e,"https://friends.help/mcp","prepare_signup",{firstName:"Ari",...extra},{token})).body!.result.isError).toBe(true);
  expect((await call(e,"https://friends.help/mcp","start_signup",{app:"friends",firstName:"Ari"})).body!.result.isError).toBe(true);
  await call(e,"https://friends.help/mcp","prepare_signup",{firstName:"Ari"},{token});e.clock.t+=10*60_000;
  expect(await(await claim(e,await browser(e,PHONE_A))).json()).toMatchObject({draft:null});
  const other=setup(), oc=await connect(other,"friends.help",PHONE_A);
  await call(other,"https://friends.help/mcp","prepare_signup",{firstName:"Ari"},{token:oc.token.access_token});
  const grants=await other.store.grantsFor(other.accounts.phoneHash(PHONE_A),"friends",other.clock.t);
  await other.store.revokeGrant(grants[0].id,other.clock.t);
  expect(await(await claim(other,await browser(other,PHONE_A))).json()).toMatchObject({draft:null});
});


test("revoked stale drafts do not hide a new approved draft; two genuinely live drafts stay ambiguous",async()=>{
  const e=setup(), first=await connect(e,"friends.help",PHONE_A);
  await call(e,"https://friends.help/mcp","prepare_signup",{firstName:"Ari"},{token:first.token.access_token});
  const old=(await e.store.grantsFor(e.accounts.phoneHash(PHONE_A),"friends",e.clock.t))[0];await e.store.revokeGrant(old.id,e.clock.t);
  const second=await connect(e,"friends.help",PHONE_A);
  await call(e,"https://friends.help/mcp","prepare_signup",{firstName:"Rae"},{token:second.token.access_token});
  const cookie=await browser(e,PHONE_A);expect(await(await claim(e,cookie)).json()).toMatchObject({draft:{firstName:"Rae"}});
  const third=await connect(e,"friends.help",PHONE_A);
  await call(e,"https://friends.help/mcp","prepare_signup",{firstName:"Tess"},{token:third.token.access_token});
  expect(await(await claim(e,cookie)).json()).toMatchObject({draft:null});
  const wrong=await browser(e,PHONE_B);
  const a=await(await claim(e,cookie)).json()as any,b=await(await claim(e,wrong)).json()as any;
  expect(a.signupView).not.toBe(b.signupView);expect(a.signupView).not.toContain(PHONE_A);
  const denied=await e.fetch(new Request("https://friends.help/oauth/signup-draft/discard",{method:"POST",headers:{cookie:wrong,origin:"https://friends.help","content-type":"application/json"},body:JSON.stringify({signupView:a.signupView})}));
  expect(denied.status).toBe(403);
});


test("normal account view distinguishes same-last-four phone sessions and never authorizes a request",async()=>{
  const e=setup(), sameLastFour="+13125550142";
  const cookieA=await browser(e,PHONE_A),cookieB=await browser(e,sameLastFour);
  const api=createPublicApi({store:e.people,otp:e.provider,hashKey:"test-hash-key",sessionSecret:"test-session-secret",now:()=>e.clock.t,env:{PLATFORM_ENV:"dev"}});
  const me=async(cookie:string)=>(await api.fetch(new Request("https://friends.help/api/me",{headers:{host:"friends.help",cookie}})))!;
  const a=await(await me(cookieA)).json()as any,b=await(await me(cookieB)).json()as any;
  expect(a.phoneMasked).toBe(b.phoneMasked);expect(a.signupView).toMatch(/^[a-f0-9]{64}$/);expect(a.signupView).not.toBe(b.signupView);
  expect((await(await claim(e,cookieA)).json()as any).signupView).toBe(a.signupView);
  expect((await me(`sid_friends=${a.signupView}`)).status).toBe(401);
  // A phone awaiting recycled-number review has no Join view to prefill.
  await e.accounts.createPerson(PHONE_A,"otp_sms",29);
  await e.people.setPhoneHold(PHONE_A,"recycled_number");
  expect(await(await me(cookieA)).json()).toMatchObject({canJoin:false,reason:"review"});
  expect(await(await me(cookieA)).json()).not.toHaveProperty("signupView");
});

const join = async(e:ReturnType<typeof setup>,cookie:string,age:number)=>{
  // Separate Accounts instances share the canonical PeopleStore lifecycle (as web/text entrypoints do).
  const api=createPublicApi({store:e.people,otp:e.provider,hashKey:"test-hash-key",sessionSecret:"test-session-secret",now:()=>e.clock.t,env:{PLATFORM_ENV:"dev"},minStartMs:0,minVerifyMs:0});
  return (await api.fetch(new Request("https://friends.help/api/join",{method:"POST",headers:{host:"friends.help",origin:"https://friends.help",cookie,"content-type":"application/json"},body:JSON.stringify({firstName:"Ari",age,homeCity:"sf",consent:{sms:true,wording:APPS.friends.consent.text}})})))!;
};

test("normal under13 refusal immediately scrubs drafts across apps without a browser read; prior lower age survives an older retry",async()=>{
  const e=setup(),f=await connect(e,"friends.help",PHONE_A),n=await connect(e,"ntwrk.party",PHONE_A),other=await connect(e,"friends.help",PHONE_B);
  for(const [domain,token] of [["friends.help",f.token.access_token],["ntwrk.party",n.token.access_token],["friends.help",other.token.access_token]])
    expect((await call(e,`https://${domain}/mcp`,"prepare_signup",{firstName:"Ari",homeCity:"sf"},{token})).body!.result.structuredContent.prepared).toBe(true);
  const cookie=await browser(e,PHONE_A),denied=await join(e,cookie,12);
  expect(denied.status).toBe(400);expect(await denied.json()).toMatchObject({error:"under_age"});
  // Inspect storage BEFORE another read: hiding the response alone is not cleanup.
  const key=e.accounts.phoneHash(PHONE_A);
  expect([...(e.store as MemoryOAuthStore).signupDrafts.values()].filter(d=>d.phoneKey===key).map(d=>d.fields)).toEqual([{firstName:""},{firstName:""}]);
  expect([...(e.store as MemoryOAuthStore).signupDrafts.values()].find(d=>d.phoneKey!==key)!.fields).toEqual({firstName:"Ari",homeCity:"sf"});
  expect(await e.accounts.personFor(PHONE_A)).toBeUndefined();expect(await e.people.consentEvents(PHONE_A,"friends")).toHaveLength(0);
  // The refusal ends the web session (SD-491): nothing with the number stays.
  expect(await(await claim(e,cookie)).json()).toMatchObject({error:"sign_in_required"});
  expect(await(await claim(e,await browser(e,PHONE_A))).json()).toMatchObject({draft:null});
  // Another app and a fresh grant cannot forget the canonical lower age.
  const retry=await connect(e,"ntwrk.party",PHONE_A);
  expect((await call(e,"https://ntwrk.party/mcp","prepare_signup",{firstName:"Rae"},{token:retry.token.access_token})).body!.result.isError).toBe(true);
  expect(await(await join(e,await browser(e,PHONE_A),29)).json()).toMatchObject({error:"under_age"});
  expect(await e.people.ageFloor(key)).toBe(12);expect(await e.accounts.personFor(PHONE_A)).toBeUndefined();
});

test("backend refusal also scrubs when the canonical lower age belongs to an existing person",async()=>{
  const e=setup(),c=await connect(e,"friends.help",PHONE_A);
  await call(e,"https://friends.help/mcp","prepare_signup",{firstName:"Ari",homeCity:"sf"},{token:c.token.access_token});
  await e.accounts.createPerson(PHONE_A,"otp_sms",12);
  expect(await(await join(e,await browser(e,PHONE_A),29)).json()).toMatchObject({error:"under_age"});
  expect([...(e.store as MemoryOAuthStore).signupDrafts.values()][0].fields).toEqual({firstName:""});
  expect(await e.people.ageFloor(e.accounts.phoneHash(PHONE_A))).toBe(12);
});

const gate=()=>{let open!:()=>void;const promise=new Promise<void>(resolve=>{open=resolve;});return{promise,open};};
test("an age lowering waits for an in-flight approved draft write, then scrubs before returning",async()=>{
  const e=setup(),c=await connect(e,"friends.help",PHONE_A),entered=gate(),release=gate();
  const put=e.store.putSignupDraft.bind(e.store);
  e.store.putSignupDraft=async(d,at)=>{entered.open();await release.promise;return put(d,at);};
  const pending=call(e,"https://friends.help/mcp","prepare_signup",{firstName:"Ari",homeCity:"sf"},{token:c.token.access_token});
  await entered.promise;
  const lower=e.accounts.recordAge(PHONE_A,undefined,12);
  expect(await e.people.ageFloor(e.accounts.phoneHash(PHONE_A))).toBeUndefined();
  release.open();expect((await pending).body!.result.structuredContent.prepared).toBe(true);await lower;
  expect([...(e.store as MemoryOAuthStore).signupDrafts.values()][0].fields).toEqual({firstName:""});
  expect(await(await claim(e,await browser(e,PHONE_A))).json()).toMatchObject({draft:null});
});

test("a draft write queued behind canonical lowering cannot reintroduce scrubbed facts",async()=>{
  const e=setup(),c=await connect(e,"friends.help",PHONE_A),entered=gate(),release=gate();
  const discard=e.store.discardSignupDrafts.bind(e.store);
  e.store.discardSignupDrafts=async(...args)=>{entered.open();await release.promise;return discard(...args);};
  const lower=e.accounts.recordAge(PHONE_A,undefined,12);await entered.promise;
  const pending=call(e,"https://friends.help/mcp","prepare_signup",{firstName:"Ari",homeCity:"sf"},{token:c.token.access_token});
  release.open();await lower;
  expect((await pending).body!.result.isError).toBe(true);expect((e.store as MemoryOAuthStore).signupDrafts.size).toBe(0);
  expect(await e.accounts.personFor(PHONE_A)).toBeUndefined();expect(await e.people.consentEvents(PHONE_A,"friends")).toHaveLength(0);
});


test("draft cleanup failure never skips the canonical person-age safety hook",async()=>{
  const e=setup(),person=await e.accounts.createPerson(PHONE_A,"otp_sms",29),lowered:number[]=[];
  const api=createPublicApi({store:e.people,otp:e.provider,hashKey:"test-hash-key",sessionSecret:"test-session-secret",now:()=>e.clock.t,env:{PLATFORM_ENV:"dev"},onAgeLowered:({age})=>{lowered.push(age);}});
  e.people.setAgeFloorCleanup(async()=>{throw new Error("controlled storage failure");});
  await expect(api.accounts.recordAge(PHONE_A,person,12)).rejects.toThrow("controlled storage failure");
  expect(await e.people.ageFloor(e.accounts.phoneHash(PHONE_A))).toBe(12);
  expect((await e.people.getPerson(person.id))!.lowestAge).toBe(12);expect(lowered).toEqual([12]);
});
