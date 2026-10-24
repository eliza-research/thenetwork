// Isolated UI + real OAuth/session/Join handlers; no personal browser, provider, model or real OTP.
// Root must admit execution separately. Use only an existing Playwright install, never download.
import {expect,test} from "bun:test";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createPublicApi} from "../../packages/platform/src/api.ts";
import {signupAccountView} from "../../packages/platform/src/sessions.ts";
import {call,connect,PHONE_A,setup} from "../../packages/mcp/test/harness.ts";
import {buildSite,site} from "../../sites/sites.ts";
const browserTest=process.env.PLAYWRIGHT_MODULE?test:test.skip;

browserTest("approved authenticated draft fills editable fields; corrected Join wins and delayed data never overwrites edits",async()=>{
  const e=setup(), c=await connect(e,"friends.help",PHONE_A);
  await call(e,"https://friends.help/mcp","prepare_signup",{firstName:"Ari",homeCity:"sf"},{token:c.token.access_token});
  const api=createPublicApi({store:e.people,otp:e.provider,hashKey:"test-hash-key",sessionSecret:"test-session-secret",now:()=>e.clock.t,env:{PLATFORM_ENV:"dev"},minStartMs:0,minVerifyMs:0});
  const session=await e.sessions.create("friends",PHONE_A,null);
  const out=mkdtempSync(join(tmpdir(),"signup-draft-ui-"));expect((await buildSite(site("friends"),out,{})).ok).toBe(true);
  const delayedDrafts:unknown[]=[];
  let release!:()=>void;let held=new Promise<void>(r=>{release=r;});let delay=false, rejectJoin=false;
  const server=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(req){
    const u=new URL(req.url);
    if(u.pathname.startsWith("/api/")||u.pathname.startsWith("/oauth/")){
      // The normal site's signed proxy selects this exact app; fixture supplies that host boundary.
      if(u.pathname==="/api/join"&&rejectJoin){rejectJoin=false;return Response.json({ok:false,error:"unauthorized"},{status:401});}
      const headers=new Headers(req.headers);headers.set("host","friends.help");if(req.method==="POST")headers.set("origin","https://friends.help");
      const delivery=u.pathname==="/oauth/signup-draft"&&delay?held:undefined;
      const proxied=new Request("https://friends.help"+u.pathname,{method:req.method,headers,...(req.method==="POST"?{body:await req.text()}:{})});
      const response=u.pathname.startsWith("/oauth/")?await e.fetch(proxied):(await api.fetch(proxied))!;
      // Delay delivery AFTER normal auth and draft generation. Delaying authentication itself
      // would merely produce 401 once normal reauthentication revokes the old session.
      if(delivery){delayedDrafts.push((await response.clone().json()).draft);await delivery;}
      return response;
    }
    const file=Bun.file(join(out,u.pathname==="/join"?"join.html":u.pathname.slice(1)));return await file.exists()?new Response(file):new Response("not found",{status:404});
  }});
  const {chromium}=await import(process.env.PLAYWRIGHT_MODULE!);const browser=await chromium.launch({headless:true});const context=await browser.newContext();
  try{
    await context.route("**/*",(r:any)=>new URL(r.request().url()).origin===server.url.origin?r.continue():r.abort());
    await context.addCookies([{name:"sid_friends",value:session.token,url:server.url.origin}]);
    const page=await context.newPage();await page.goto(server.url+"join?via=agent");
    await page.waitForFunction(()=>document.querySelector<HTMLInputElement>('[name="firstName"]')?.value==="Ari");

    expect(await page.locator('[name="homeCity"]').count()).toBe(0);
    await page.reload();await page.waitForFunction(()=>document.querySelector<HTMLInputElement>('[name="firstName"]')?.value==="Ari");

    expect(await page.locator('[name="age"]').inputValue()).toBe("");expect(await page.locator('[name="consent"]').isChecked()).toBe(false);
    await page.locator('[name="firstName"]').fill("Rae");await page.locator('[name="age"]').fill("29");await page.locator('[name="consent"]').check();await page.locator('form[data-form="profile"] button[type="submit"]').click();
    await page.locator('[data-step="done"]').waitFor({state:"visible"});
    const person=await e.accounts.personFor(PHONE_A),m=await e.people.getMembership(person!.id,"friends");expect(m!.firstName).toBe("Rae");expect(m!.profile.homeCity).toBeUndefined();
    expect((await e.people.consentEvents(PHONE_A,"friends")).length).toBe(1);
    // Separate fresh test environment would be needed after Join. On a second page with a
    // delayed claim, the dirty-input guarantee is exercised before any Join or account write.
    const phone="+12125550149",other=await connect(e,"friends.help",phone);await call(e,"https://friends.help/mcp","prepare_signup",{firstName:"Tess",homeCity:"sf"},{token:other.token.access_token});
    const s=await e.sessions.create("friends",phone,null);await context.addCookies([{name:"sid_friends",value:s.token,url:server.url.origin}]);delay=true;
    await page.goto(server.url+"join?via=agent");await page.locator('[data-step="profile"]').waitFor({state:"visible"});
    await page.locator('[name="firstName"]').fill("Inez");
    const responseDone=page.waitForResponse((r:any)=>r.url().endsWith("/oauth/signup-draft"));
    const ownerRechecked=page.waitForResponse((r:any)=>r.url().endsWith("/api/me"));release();
    // Wait for the actual delayed payload and its ownership recheck, not unrelated background fetches.
    expect((await(await responseDone).json()).draft).toEqual({firstName:"Tess",homeCity:"sf"});
    await ownerRechecked;
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    expect(await page.locator('[name="firstName"]').inputValue()).toBe("Inez");expect(await e.accounts.personFor(phone)).toBeUndefined();
    // A delayed response for the old account must not cross a normal reauthentication.
    held=new Promise<void>(r=>{release=r;});
    const oldRequest=page.waitForRequest((r:any)=>r.url().endsWith("/oauth/signup-draft"));
    await page.reload();
    const staleRequest=await oldRequest;
    let staleDelivered=false;
    const staleResponse=page.waitForResponse((r:any)=>r.request()===staleRequest).then((r:any)=>{staleDelivered=true;return r;});
    await page.locator('[data-step="profile"]').waitFor({state:"visible"});
    await page.locator('[name="firstName"]').fill("Oldedit");await page.locator('[name="age"]').fill("29");await page.locator('[name="consent"]').check();
    rejectJoin=true;await page.locator('form[data-form="profile"] button[type="submit"]').click();
    await page.locator('[data-step="phone"]').waitFor({state:"visible"});
    // A different phone with the same last four digits proves the marker isn't a display guess.
    const nextPhone="+13125550149",next=await connect(e,"friends.help",nextPhone);
    await call(e,"https://friends.help/mcp","prepare_signup",{firstName:"Luca",homeCity:"sf"},{token:next.token.access_token});
    e.clock.t+=31_000;delay=false;await page.locator('form[data-form="phone"] input[name="phone"]').fill(nextPhone);
    await page.locator('form[data-form="phone"] button[type="submit"]').click();
    await page.locator('[data-step="code"]').waitFor({state:"visible"});
    await page.locator('input[name="code"]').fill(e.provider.last(nextPhone)!);
    await page.locator('form[data-form="code"] button[type="submit"]').click();
    await page.waitForFunction(()=>document.querySelector<HTMLInputElement>('[name="firstName"]')?.value==="Luca");
    expect(staleDelivered).toBe(false);release();
    // The old account's real response must arrive before the final new-account assertions.
    expect((await staleResponse).status()).toBe(200);
    expect(delayedDrafts).toEqual([{firstName:"Tess",homeCity:"sf"},{firstName:"Tess",homeCity:"sf"}]);
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    expect(await page.locator('[name="firstName"]').inputValue()).toBe("Luca");
    expect(await page.locator('[name="age"]').inputValue()).toBe("");expect(await page.locator('[name="consent"]').isChecked()).toBe(false);
    expect(await e.accounts.personFor(nextPhone)).toBeUndefined();

    // A fully settled A form must not submit A's age, fields or checkbox under another tab's B session.
    await page.reload();await page.waitForFunction(()=>document.querySelector<HTMLInputElement>('[name="firstName"]')?.value==="Luca");
    await page.locator('[name="age"]').fill("12");await page.locator('[name="consent"]').check();
    const switchedPhone="+12125550148",switched=await connect(e,"friends.help",switchedPhone);
    expect((await call(e,"https://friends.help/mcp","prepare_signup",{firstName:"Mina",homeCity:"nyc"},{token:switched.token.access_token})).body!.result.structuredContent.prepared).toBe(true);
    const switchedSession=await e.sessions.create("friends",switchedPhone,null),sentBeforeSwitch=e.provider.sent.length;
    await context.addCookies([{name:"sid_friends",value:switchedSession.token,url:server.url.origin}]);
    const rejected=page.waitForResponse((r:any)=>r.url().endsWith("/api/join"));
    await page.locator('form[data-form="profile"] button[type="submit"]').click();
    const mismatch=await rejected;expect(mismatch.status()).toBe(409);
    expect(mismatch.request().postDataJSON().signupView).toBe(signupAccountView("friends",e.accounts.phoneHash(nextPhone)));
    expect(await mismatch.json()).toMatchObject({ok:false,error:"account_changed"});
    expect(await e.people.ageFloor(e.accounts.phoneHash(switchedPhone))).toBeUndefined();
    expect(await e.accounts.personFor(switchedPhone)).toBeUndefined();
    expect(await e.people.consentEvents(switchedPhone,"friends")).toHaveLength(0);
    await page.waitForFunction(()=>document.querySelector<HTMLInputElement>('[name="firstName"]')?.value==="Mina");
    expect(await page.locator('[data-step="profile"]').isVisible()).toBe(true);
    expect(await page.locator('[data-step="done"]').isVisible()).toBe(false);

    expect(await page.locator('[name="age"]').inputValue()).toBe("");expect(await page.locator('[name="consent"]').isChecked()).toBe(false);
    expect(await page.locator('[data-flow-error]').isVisible()).toBe(true);
    expect((await page.locator('[data-flow-error]').textContent())?.trim().length).toBeGreaterThan(0);
    expect(e.provider.sent.length).toBe(sentBeforeSwitch);
    // B now reviews/corrects the new form and explicitly supplies B's own age and consent.
    await page.locator('[name="firstName"]').fill("Rae");
    await page.locator('[name="age"]').fill("29");await page.locator('[name="consent"]').check();
    const accepted=page.waitForResponse((r:any)=>r.url().endsWith("/api/join"));
    await page.locator('form[data-form="profile"] button[type="submit"]').click();const joined=await accepted;expect(joined.status()).toBe(200);
    expect(joined.request().postDataJSON().signupView).toBe(signupAccountView("friends",e.accounts.phoneHash(switchedPhone)));
    await page.locator('[data-step="done"]').waitFor({state:"visible"});
    const switchedPerson=await e.accounts.personFor(switchedPhone),switchedMember=await e.people.getMembership(switchedPerson!.id,"friends");
    expect(switchedMember!.firstName).toBe("Rae");expect(switchedMember!.profile.homeCity).toBeUndefined();
    expect(joined.request().postDataJSON().homeCity).toBeUndefined();
    expect(await e.people.ageFloor(e.accounts.phoneHash(switchedPhone))).toBe(29);
    expect(await e.people.consentEvents(switchedPhone,"friends")).toHaveLength(1);
    expect(await e.accounts.personFor(nextPhone)).toBeUndefined();expect(e.provider.sent.length).toBe(sentBeforeSwitch);

  }finally{release();await context.close();await browser.close();server.stop(true);rmSync(out,{recursive:true,force:true});}
});
