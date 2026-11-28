// End to end: the four sites through the production router code, the shared backend, the platform
// API, the MCP server and Postgres, in one process (harness.ts). Needs the dev Postgres (:54339); it
// skips with a message without one, and CI (REQUIRE_PG=1) fails instead of skipping.
//   pnpm test:e2e
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SQL } from "../../packages/core/src/runtime/postgres.ts";
import { DAY, HOUR } from "../../packages/core/src/clock.ts";
import { lastEvents, resolveConsent } from "../../packages/platform/src/consent.ts";
import { APP_IDS, type AppId } from "../../packages/platform/src/apps.ts";
import { proxySignature } from "../../packages/platform/src/proxy.ts";
import { PHOTO_CONSENT } from "../../packages/platform/src/photos.ts";
import { SESSION_GRACE_MS, SESSION_ROTATE_MS } from "../../packages/platform/src/sessions.ts";
import { pkceS256, sha256hex } from "../../packages/mcp/src/util.ts";
import { NetworkService } from "../../packages/network/service/service.ts";
import { DryRunAdapter } from "../../packages/network/service/channel.ts";
import { createServiceMcp } from "../../packages/network/service/serve.ts";
import { svcSign } from "../../packages/core/src/svc/svc-auth.ts";
import { SET_STATE_PATH, TURN_PATH, type TurnRequest } from "../../packages/core/src/svc/contract.ts";
import { Browser, connectMcp, REDIRECT, VERIFIER, newPhone, pgAvailable, rpc, signIn, startStack, toolData, TURN_SECRET, webJoin, type Stack } from "./harness.ts";

import { slopProfiles, type SlopProfile } from "../../packages/engine/src/packs/slop/profile.ts";
import { mutualMarkets, makeSlopPack, SLOP_ENGINE_DEFAULTS } from "../../packages/engine/src/packs/slop/index.ts";
import { cellMiles, cellOfZip, zipForArea } from "../../packages/engine/src/packs/slop/zips.ts";
import { World } from "../../packages/engine/src/world.ts";
import { extractSlopProfile, slopOnboardTags, validateSlopReading } from "../../packages/engine/src/packs/slop/extract.ts";
import { readBack, applyCorrection } from "../../packages/engine/src/packs/slop/onboard.ts";
import { appWiring } from "../../packages/network/service/packs.ts";

const T = 180_000;
if (!pgAvailable) {
  console.warn("tests/e2e skipped: no Postgres. Install postgresql@16 (the dev cluster runs on :54339) or run in CI.");
}

let st: Stack;
let sql: SQL;

describe.skipIf(!pgAvailable)("the platform end to end (sites -> router -> backend -> Postgres)", () => {
  beforeAll(async () => {
    st = await startStack();
    sql = new SQL({ url: st.url, max: 2 });
  }, T);
  afterAll(async () => {
    await sql?.close();
    await st?.close();
  }, T);

  const memberRow = async (app: AppId, e164: string) =>
    (await sql`select m.id, m.age, m.account_status, m.opted_out from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = ${app} and ph.e164 = ${e164}`)[0] as
      { id: string; age: number | null; account_status: string; opted_out: boolean } | undefined;
  const me = async (app: AppId, b: Browser) => {
    const res = await st.site(app, "/api/me", { browser: b });
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };

  describe.each(APP_IDS.map(a => [a]))("%s site", (app: AppId) => {
    test("landing page, /SKILL.md and the agent-skills index are served by the site", async () => {
      const s = st.sites[app].site;
      const home = await st.site(app, "/");
      expect(home.status).toBe(200);
      expect(home.headers.get("content-type")).toContain("text/html");
      expect(await home.text()).toContain("<html");
      const md = await st.site(app, "/SKILL.md");
      expect(md.status).toBe(200);
      expect(md.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      const text = await md.text();
      expect(text).toContain(`name: ${s.skill}`);
      expect(text).toContain(`https://${st.sites.ntwrk.site.domain}${app === "ntwrk" ? "/mcp" : `/mcp/${app}`}`);
      if (app !== "ntwrk") expect(text).not.toContain(`https://${s.domain}/mcp`);
      if (app !== "peon") {
        expect(text).toContain("native connector authorization");
        expect(text).toContain("Call `submit_profile` once");
        expect(text).not.toMatch(/\/api\/auth\/otp\/|\/api\/me\/export|session\.cookies/);
      }
      expect(text).not.toContain("https://api.ntwrk.party/mcp");
      const idx = await st.site(app, "/.well-known/agent-skills/index.json");
      expect(idx.status).toBe(200);
      const names = ((await idx.json()) as { skills: { name: string }[] }).skills.map(x => x.name);
      expect(names).toEqual(app === "ntwrk" ? ["ntwrk-party", "slop-date", "peon-biz", "friends-help"] : [s.skill]);
    });

    test("/api/app through the router names this site's app (the signed host picks it)", async () => {
      const res = await st.site(app, "/api/app");
      expect(res.status).toBe(200);
      expect(((await res.json()) as { id: string }).id).toBe(app);
    });

    test("join with a texted code; /api/me shows this app only", async () => {
      const phone = newPhone();
      const j = await webJoin(st, app, phone, { age: 29 });
      if (app === "ntwrk") {
        // The Network's web join is invite-only (platform.apps join_mode).
        expect(j.res.status).toBe(400);
        expect(j.body.error).toBe("invite_only");
        return;
      }
      expect(j.res.status, JSON.stringify(j.body)).toBe(200);
      expect(j.body.membership.state).toBe("active");
      const m = await me(app, j.b);
      expect(m.status).toBe(200);
      expect(m.body.app).toBe(app);
      expect(m.body.membership.state).toBe("active");
      expect(JSON.stringify(m.body)).not.toContain(phone.slice(2));
      expect((await memberRow(app, phone))?.account_status).toBe("active");
    }, T);
  });

  test("a signed-in member corrects a legacy home atomically without changing identity, consent or history", async () => {
    const local = await startStack();
    const db = new SQL({ url: local.url, max: 2 });
    try {
      const phone = newPhone(), browser = new Browser();
      await local.staff("/apps/ntwrk/invite", { phone });
      await signIn(local, "ntwrk", phone, browser);
      const info = await (await local.site("ntwrk", "/api/app")).json() as any;
      expect((await local.site("ntwrk", "/api/join", { browser, json: { firstName: "Theo", age: 32, homeCity: "nyc", neighborhood: "Astoria", consent: { sms: true, version: info.consent.version } } })).status).toBe(200);
      const [member] = await db`select * from network.members where app_id='ntwrk'`;
      // Reproduce the actual pre-fix join shape: explicit region retained, runtime city used as home.
      await db`update network.members set home_area='Bay Area' where id=${member.id}`;
      await db`update network.presence set areas=ARRAY['Bay Area'] where member_id=${member.id} and type='home'`;
      await db`update platform.memberships set profile='{"neighborhood":"Bay Area","about":"I enjoy climbing."}'::jsonb where member_id=${member.id}`;
      const client = await connectMcp(local, "ntwrk", phone, { browser });
      expect(toolData(await rpc(local, "ntwrk", "/mcp", "tools/call", { name: "submit_profile", arguments: { about: "I enjoy climbing and coffee." } }, client.token!.access_token)).submitted).toBe(true);
      const before = await (await local.site("ntwrk", "/api/me/export", { browser })).json() as any;
      const [trip] = await db`insert into network.presence(app_id,member_id,city,type,areas,from_at,to_at) values ('ntwrk',${member.id},'sf','temporary','{}',${new Date(local.clock.now()-DAY)},${new Date(local.clock.now()+DAY)}) returning *`;
      const correction = { homeCity: "Bay Area", neighborhood: "Bay Area" };
      const changed = await local.site("ntwrk", "/api/me/home", { browser, json: correction });
      expect(changed.status).toBe(200);
      expect((await changed.json() as any).home).toEqual({ homeCity: "sf", neighborhood: "Bay Area" });
      expect((await (await local.site("ntwrk", "/api/me", { browser })).json() as any).home).toEqual({ homeCity: "sf", neighborhood: "Bay Area" });
      const after = await (await local.site("ntwrk", "/api/me/export", { browser })).json() as any;
      expect(after.network.member).toEqual({ ...before.network.member, home_city: "sf" });
      expect(after.membership).toEqual({ ...before.membership, profile: { ...before.membership.profile, homeCity: "sf" } });
      expect(after.consent).toEqual(before.consent);
      expect(after.network.messages).toEqual(before.network.messages);
      const homes = await db`select * from network.presence where member_id=${member.id} and type='home'`;
      expect(homes.length).toBe(1);
      expect(homes[0]!.city).toBe("sf");
      expect(homes[0]!.areas).toEqual(["Bay Area"]);
      expect((await db`select * from network.presence where id=${trip.id}`)[0]).toEqual(trip);
      expect((await local.site("ntwrk", "/api/me/home", { browser, json: correction })).status).toBe(200);
      expect(await db`select * from network.presence where member_id=${member.id} and type='home'`).toEqual(homes);
      const otherPhone = newPhone(), otherBrowser = new Browser();
      await local.staff("/apps/ntwrk/invite", { phone: otherPhone });
      await signIn(local, "ntwrk", otherPhone, otherBrowser);
      expect((await local.site("ntwrk", "/api/join", { browser: otherBrowser, json: { firstName: "Mira", age: 31, homeCity: "nyc", consent: { sms: true, version: info.consent.version } } })).status).toBe(200);
      const [other] = await db`select * from network.members where app_id='ntwrk' and id<>${member.id}`;
      expect((await local.site("ntwrk", "/api/me/home", { browser, json: { ...correction, memberId: other.id } })).status).toBe(400);
      expect((await db`select * from network.members where id=${other.id}`)[0]).toEqual(other);
      const rt = await local.svc.runtimeOfMember("ntwrk", member.id);
      expect(await rt!.sharedContext(member.id)).toMatchObject({ city: "sf", singlePlayer: true });
      expect((await rt!.unitOfWork(n => n.engineInput(local.clock.now()))).members.some(m => m.id === member.id)).toBe(false);
      expect(toolData(await rpc(local, "ntwrk", "/mcp", "tools/call", { name: "check_status", arguments: {} }, client.token!.access_token)).status).toBe("active");
      expect((await local.site("ntwrk", "/api/me/home", { json: correction })).status).toBe(401);
      expect((await local.site("friends", "/api/me/home", { browser, json: correction })).status).toBe(401);
      for (const extra of [{ memberId: member.id }, { personId: member.person_id }, { age: 40 }, { app: "friends" }]) {
        expect((await local.site("ntwrk", "/api/me/home", { browser, json: { ...correction, ...extra } })).status).toBe(400);
      }
      expect((await local.site("ntwrk", "/api/me/home", { browser, json: { homeCity: "nyc", neighborhood: "Bay Area" } })).status).toBe(400);
      expect((await local.site("ntwrk", "/api/me/home", { browser, json: { homeCity: "unknown" } })).status).toBe(400);
      expect((await local.site("ntwrk", "/api/me/home", { browser, headers: { origin: local.sites.friends.origin }, json: correction })).status).toBe(403);

      // Failure after profile/member updates must roll the entire correction back.
      await db`create function public.reject_home_fixture() returns trigger language plpgsql as $$ begin if NEW.type='home' then raise exception 'synthetic home failure'; end if; return NEW; end $$`;
      await db`create trigger reject_home_fixture before insert on network.presence for each row execute function public.reject_home_fixture()`;
      expect((await local.site("ntwrk", "/api/me/home", { browser, json: { homeCity: "nyc", neighborhood: "Astoria" } })).status).toBe(500);
      expect((await db`select home_city from network.members where id=${member.id}`)[0]!.home_city).toBe("sf");
      expect((await db`select profile from platform.memberships where member_id=${member.id}`)[0]!.profile.homeCity).toBe("sf");
      expect((await db`select city from network.presence where member_id=${member.id} and type='home'`).map((x:any)=>x.city)).toEqual(["sf"]);
      await db`drop trigger reject_home_fixture on network.presence`;
      await db`drop function public.reject_home_fixture()`;

      // Current phone ownership is checked again, not inferred from a still-valid cookie.
      await db`update platform.phone_identities set hold='recycled_number' where e164=${phone}`;
      expect((await local.site("ntwrk", "/api/me/home", { browser, json: { homeCity: "nyc" } })).status).toBe(403);
      expect((await db`select home_city from network.members where id=${member.id}`)[0]!.home_city).toBe("sf");
    } finally { await db.close(); await local.close(); }
  }, T);

  test("home correction refuses a move between existing conversation stores without changing the member", async () => {
    const local = await startStack({ extraNetwork: "ntwrk:sf" });
    const db = new SQL({ url: local.url, max: 2 });
    try {
      const phone = newPhone(), browser = new Browser();
      await local.staff("/apps/ntwrk/invite", { phone });
      await signIn(local, "ntwrk", phone, browser);
      const info = await (await local.site("ntwrk", "/api/app")).json() as any;
      expect((await local.site("ntwrk", "/api/join", { browser, json: { firstName: "Mira", age: 31, homeCity: "nyc", neighborhood: "Astoria", consent: { sms: true, version: info.consent.version } } })).status).toBe(200);
      const before = await (await local.site("ntwrk", "/api/me/export", { browser })).json();
      const states = await db`select id,state from network.network_state order by id`;
      const response = await local.site("ntwrk", "/api/me/home", { browser, json: { homeCity: "sf", neighborhood: "Bay Area" } });
      expect(response.status).toBe(409);
      expect((await response.json() as any).error).toBe("home_runtime_conflict");
      expect(await (await local.site("ntwrk", "/api/me/export", { browser })).json()).toEqual(before);
      expect(await db`select id,state from network.network_state order by id`).toEqual(states);
    } finally { await db.close(); await local.close(); }
  }, T);

  test("explicit home survives invited join and out-of-market profile intake without NYC presence", async () => {
    const local = await startStack();
    const db = new SQL({ url: local.url, max: 2 });
    try {
      const phone = newPhone(), browser = new Browser();
      expect((await local.staff("/apps/ntwrk/invite", { phone })).status).toBe(200);
      await signIn(local, "ntwrk", phone, browser);
      const info = await (await local.site("ntwrk", "/api/app")).json() as any;
      const joined = await local.site("ntwrk", "/api/join", { browser, json: {
        firstName: "Theo", age: 32, neighborhood: "Bay Area",
        consent: { sms: true, version: info.consent.version },
      }});
      expect(joined.status).toBe(200);
      const [member] = await db`select * from network.members where app_id='ntwrk'`;
      expect(member.home_city).toBe("sf");
      expect(member.home_area).toBe("Bay Area");
      expect((await db`select city from network.presence where member_id=${member.id} and type='home'`).map((r:any) => r.city)).toEqual(["sf"]);
      const client = await connectMcp(local, "ntwrk", phone, { browser });
      expect(toolData(await rpc(local, "ntwrk", "/mcp", "tools/call", {name:"submit_profile",arguments:{about:"I like climbing and coffee, and I am 32."}}, client.token!.access_token)).submitted).toBe(true);
      const rt = await local.svc.runtimeOfMember("ntwrk", member.id);
      expect(rt?.id).toBe("ntwrk:nyc");
      expect(await rt!.sharedContext(member.id)).toMatchObject({city:"sf",singlePlayer:true});
      const observed = await rt!.unitOfWork(n => ({age:n.member(member.id).age, minor:n.member(member.id).minor, input:n.engineInput(local.clock.now()), eligible:n.eligible(member.id)}));
      expect(observed.age).toBe(32);
      expect(observed.minor).toBe(false);
      expect(observed.input.members.some(m => m.id === member.id)).toBe(false);
      expect(observed.eligible).toBe(false);
      expect(await rt!.unitOfWork(n=>n.eligible("missing" as any,undefined,true))).toBe(false);
      const [saved] = await db`select state from network.network_state where id='ntwrk:nyc'`;
      expect(saved.state.members.find((m: any) => m.id === member.id).learned.interests.length).toBeGreaterThan(0);
      expect((await local.site("ntwrk", "/api/me", {browser})).status).toBe(200);
      expect(await rt!.unitOfWork(n => n.inNyc(member.id, local.clock.now(), local.clock.now()+DAY))).toBe(false);
      expect(await rt!.unitOfWork(n => n.eligible(member.id, undefined, true))).toBe(false);
      expect(await rt!.unitOfWork(n => n.inNyc("missing" as any, local.clock.now(), local.clock.now()+DAY))).toBe(false);
      const fresh = await NetworkService.fromDatabase({url:local.url,clock:local.clock,env:{PLATFORM_ENV:"dev"},instance:"home-restart",adapter:()=>new DryRunAdapter(()=>{}),log:()=>{}});
      try {
        await fresh.start();
        const restored = await fresh.runtimeOfMember("ntwrk", member.id);
        const state = await restored!.unitOfWork(n => n.member(member.id));
        expect(state.age).toBe(32);
        expect(state.minor).toBe(false);
        expect(state.learned.interests.size).toBeGreaterThan(0);
        expect(await restored!.unitOfWork(n => n.eligible(member.id, undefined, true))).toBe(false);
      } finally { await fresh.close(); }
      // Genuine NYC travel qualifies only for its complete window; preference or conversation ownership does not.
      const from = local.clock.now(), to = from + 6 * DAY;
      const [visit] = await db`insert into network.presence (app_id,member_id,city,type,areas,from_at,to_at) values ('ntwrk',${member.id},'nyc','temporary','{}',${new Date(from-DAY)},${new Date(to+DAY)}) returning id`;
      expect(await rt!.unitOfWork(n=>n.inNyc(member.id,from,to))).toBe(true);
      expect(await rt!.sharedContext(member.id)).toMatchObject({city:"sf",singlePlayer:false});
      expect((await rt!.unitOfWork(n=>n.engineInput(local.clock.now()))).members.some(m=>m.id===member.id)).toBe(false);
      await db`update network.presence set to_at=${new Date(from+DAY)} where id=${visit.id}`;
      expect(await rt!.unitOfWork(n=>n.inNyc(member.id,from,to))).toBe(false);
      expect(await rt!.sharedContext(member.id)).toMatchObject({singlePlayer:true});
      await db`update network.presence set from_at=${new Date(from-3*DAY)},to_at=${new Date(from-DAY)} where id=${visit.id}`;
      expect(await rt!.unitOfWork(n=>n.inNyc(member.id,from,to))).toBe(false);
      await db`update network.presence set from_at=${new Date(from-DAY)},to_at=${new Date(to+DAY)} where id=${visit.id}`;
      await db`insert into network.presence (app_id,member_id,city,type,areas,from_at,to_at) values ('ntwrk',${member.id},'sf','temporary','{}',${new Date(from+DAY)},${new Date(from+2*DAY)})`;
      expect(await rt!.unitOfWork(n=>n.inNyc(member.id,from,to))).toBe(false);
      await db`delete from network.presence where member_id=${member.id} and type='temporary'`;
      expect(await rt!.unitOfWork(n=>n.inNyc(member.id,from,to))).toBe(false);
      const conflictPhone = newPhone(), conflictBrowser = new Browser();
      await local.staff("/apps/ntwrk/invite", {phone:conflictPhone});
      await signIn(local,"ntwrk",conflictPhone,conflictBrowser);
      for (const homeCity of ["nyc", "unknown"]) {
        expect((await local.site("ntwrk", "/api/join", {browser:conflictBrowser,json:{firstName:"Mira",age:31,homeCity,neighborhood:"Bay Area",consent:{sms:true,version:info.consent.version}}})).status).toBe(400);
      }
      expect((await db`select * from network.members where app_id='ntwrk'`).length).toBe(1);
      const nycPhone = newPhone(), nycBrowser = new Browser();
      await local.staff("/apps/ntwrk/invite", {phone:nycPhone});
      await signIn(local,"ntwrk",nycPhone,nycBrowser);
      expect((await local.site("ntwrk", "/api/join", {browser:nycBrowser,json:{firstName:"Mira",age:31,homeCity:"NYC",neighborhood:"Astoria",consent:{sms:true,version:info.consent.version}}})).status).toBe(200);
      const [nyc] = await db`select * from network.members where app_id='ntwrk' and name='Mira'`;
      expect(nyc.home_city).toBe("nyc");
      expect(await local.svc.runtimeFor("ntwrk")!.unitOfWork(n => n.inNyc(nyc.id,local.clock.now(),local.clock.now()+DAY))).toBe(true);
      expect((await local.svc.runtimeFor("ntwrk")!.unitOfWork(n => n.engineInput(local.clock.now()))).members.map(m=>m.id)).toContain(nyc.id);

    } finally { await db.close(); await local.close(); }
  }, T);

  test("registry owns served homes once and retains native home across join turns", async () => {
    const local = await startStack({extraNetwork:"ntwrk:sf"});
    const db = new SQL({url:local.url,max:2});
    try {
      const phone = newPhone(), browser = new Browser();
      await local.staff("/apps/ntwrk/invite",{phone});
      await signIn(local,"ntwrk",phone,browser);
      const info = await (await local.site("ntwrk","/api/app")).json() as any;
      expect((await local.site("ntwrk","/api/join",{browser,json:{firstName:"Theo",age:32,homeCity:"sf",consent:{sms:true,version:info.consent.version}}})).status).toBe(200);
      const [sf] = await db`select * from network.members where app_id='ntwrk'`;
      expect((await local.svc.runtimeOfMember("ntwrk",sf.id))?.id).toBe("ntwrk:sf");
      expect(await local.svc.runtimeFor("ntwrk","sf")!.sharedContext(sf.id)).toMatchObject({city:"sf",singlePlayer:true});
      const client = await connectMcp(local,"ntwrk",phone,{browser});
      expect(toolData(await rpc(local,"ntwrk","/mcp","tools/call",{name:"submit_profile",arguments:{about:"I like climbing and coffee, and I am 32."}},client.token!.access_token)).submitted).toBe(true);
      await local.text(phone,"I enjoy hiking and climbing.");
      await local.text(phone,"I enjoy museums on weekends.");
      await local.text(phone,"I work in software and enjoy cooking.");
      const messageId = `home-turn-${sf.id}`;
      const turnBody = JSON.stringify({messageId,channel:"blooio",from:phone,to:null,text:"What is the weather like?",transport:"imessage",receivedAt:local.clock.now(),app:"ntwrk"});
      const turn = await local.svc.fetch(new Request(`http://127.0.0.1${TURN_PATH}`,{method:"POST",headers:{"content-type":"application/json",...await svcSign(TURN_SECRET,{method:"POST",path:TURN_PATH,id:messageId,body:turnBody,nowS:Math.floor(local.clock.now()/1000)})},body:turnBody}));
      expect(turn.status).toBe(200);
      expect(await turn.json()).toMatchObject({outcome:"open",app:"ntwrk",memberId:sf.id,context:{city:"sf",singlePlayer:true}});
      const nativePhone = newPhone();
      expect(await local.text(nativePhone,"My home is Bay Area.")).toBe("join_asked");
      const pending = await local.svc.people.getPending(local.svc.accounts.phoneHash(nativePhone),"join");
      expect(pending?.homeCity).toBe("sf");
      expect(await local.text(nativePhone,"Mira, 31")).toBe("joined");
      const [native] = await db`select * from network.members where app_id='ntwrk' and name='Mira'`;
      expect(native.home_city).toBe("sf");
      expect((await local.svc.runtimeOfMember("ntwrk",native.id))?.id).toBe("ntwrk:sf");
      expect((await db`select city from network.presence where member_id=${native.id}`).some((r:any)=>r.city==='nyc')).toBe(false);
      for (const rt of local.svc.runtimes.values()) {
        if (rt.app.id !== "ntwrk") continue;
        await rt.identities();
        expect(rt.memberOf(phone)).toBe(rt.id==='ntwrk:sf'?sf.id:undefined);
        const ids = await rt.unitOfWork(n=>n.memberList().map(m=>m.id));
        expect(ids.includes(sf.id)).toBe(rt.id==='ntwrk:sf');
        expect(ids.includes(native.id)).toBe(rt.id==='ntwrk:sf');
      }
      expect(await local.text(nativePhone,"I am looking for dating and friends.")).toBe("handled");
      const children = await db`select app_id,home_city from network.members where person_id=${native.person_id} and app_id<>'ntwrk' order by app_id`;
      expect(children.map((r:any)=>r.app_id)).toEqual(["friends","slop"]);
      expect(children.every((r:any)=>r.home_city==='sf')).toBe(true);
      const memberships = await local.svc.people.memberships(native.person_id);
      expect(memberships.filter(m=>m.app!=='ntwrk').every(m=>JSON.stringify(m.profile)===JSON.stringify({homeCity:"sf"}))).toBe(true);
      const completePhone = newPhone();
      expect(await local.text(completePhone,"Nora, 33, based in the Bay Area.")).toBe("joined");
      expect((await db`select home_city from network.members where app_id='ntwrk' and name='Nora'`)[0].home_city).toBe("sf");
      const minorPhone = newPhone();
      expect(await local.text(minorPhone,"Nora, 12. My home is unknown.")).toBe("under_age");
      expect(await local.text(minorPhone,"Nora, 33. My home is Bay Area.")).toBe("under_age");
      const states = await db`select id,state from network.network_state where app_id='ntwrk' order by id`;
      expect(states.flatMap((r:any)=>r.state.members.filter((m:any)=>m.id===sf.id)).length).toBe(1);
      expect((await db`select count(*)::int as n from network.messages where member_id=${sf.id} and body='I enjoy hiking and climbing.'`)[0].n).toBe(1);
    } finally {await db.close();await local.close();}
  }, T);

  test("a session is per app: /api/me on another site never shows this app, and the cookie does not cross", async () => {
    const phone = newPhone();
    const b = new Browser();
    expect((await webJoin(st, "slop", phone, { age: 31, browser: b })).res.status).toBe(200);
    // The same browser, not signed in on peon: 401, and slop's cookie sent as peon's is refused.
    expect((await me("peon", b)).status).toBe(401);
    const forged = new Browser();
    forged.jar.set("sid_peon", b.jar.get("sid_slop")!);
    expect((await me("peon", forged)).status).toBe(401);
    // Signed in on peon (not a member there): peon's /api/me knows nothing about slop.
    await signIn(st, "peon", phone, b);
    const m = await me("peon", b);
    expect(m.status).toBe(200);
    expect(m.body.app).toBe("peon");
    expect(m.body.membership).toBeNull();
    expect(JSON.stringify(m.body)).not.toMatch(/slop/);
  }, T);

  test("leave one app keeps the other", async () => {
    const phone = newPhone();
    const b = new Browser();
    expect((await webJoin(st, "slop", phone, { age: 33, browser: b })).res.status).toBe(200);
    expect((await webJoin(st, "peon", phone, { age: 33, browser: b })).res.status).toBe(200);
    const leave = await st.site("slop", "/api/me/delete", { browser: b, json: { scope: "app" } });
    expect(leave.status).toBe(200);
    expect(await memberRow("slop", phone)).toBeUndefined();
    expect((await memberRow("peon", phone))?.account_status).toBe("active");
    expect((await me("peon", b)).body.membership.state).toBe("active");
    const slop = await me("slop", b);
    expect(slop.body.membership === null || slop.body.membership.state === "removed").toBe(true);
  }, T);

  test("STOP on the shared line stops every app", async () => {
    const phone = newPhone();
    const b = new Browser();
    expect((await webJoin(st, "peon", phone, { age: 35, browser: b })).res.status).toBe(200);
    expect((await webJoin(st, "friends", phone, { age: 35, browser: b })).res.status).toBe(200);
    await st.text(phone, "STOP");
    const events = (await sql`select e164, app_id as app, state, source, extract(epoch from at) * 1000 as at from platform.consent_events where e164 = ${phone} order by id`).map((r: any) => ({ ...r, at: Number(r.at) }));
    for (const app of ["peon", "friends"] as const) {
      expect(resolveConsent(lastEvents(events, phone, app))).toBe("opted_out");
      expect((await me(app, b)).body.membership.state).toBe("paused");
      expect((await memberRow(app, phone))?.opted_out).toBe(true);
    }
  }, T);

  test("a pause set by text is readable through the API; resume preserves messaging consent (#11)", async () => {
    // As the Eliza gateway does: a signed /internal/turn for each text, then the agent's signed
    // /internal/set-state on the member's open turn ("pause me until next Friday").
    const phone = newPhone();
    const signed = async (path: string, body: object, id: string) => {
      const raw = JSON.stringify(body);
      return st.svc.fetch(new Request(`http://127.0.0.1${path}`, { method: "POST", headers: { "content-type": "application/json", ...await svcSign(TURN_SECRET, { method: "POST", path, id, body: raw, nowS: Math.floor(st.clock.now() / 1000) }) }, body: raw }));
    };
    const turn = async (messageId: string, text: string) => {
      const body: TurnRequest = { messageId, channel: "blooio", from: phone, to: null, text, transport: "imessage", receivedAt: st.clock.now(), app: "friends" };
      const res = await signed(TURN_PATH, body, messageId);
      expect(res.status).toBe(200);
      st.clock.advance(60_000);
      return (await res.json()) as Record<string, any>;
    };
    for (const [i, text] of ["friends.help", "Ari, 29", "I enjoy hiking and cooking", "Saturday afternoons work for me", "Small groups are good"].entries()) await turn(`pause-${phone}-${i}`, text);
    const open = await turn(`pause-${phone}-open`, "Pause me until next Friday, I'm slammed at work");
    expect(open.outcome).toBe("open");
    const until = new Date(st.clock.now() + 7 * DAY).toISOString();
    const key = `pause-${phone}-state`;
    const set = await signed(SET_STATE_PATH, { channel: "blooio", messageId: `pause-${phone}-open`, app: "friends", memberId: open.memberId, idempotencyKey: key, state: "paused", from: null, until, note: null }, key);
    expect(set.status, await set.clone().text()).toBe(200);

    const b = new Browser();
    await signIn(st, "friends", phone, b);
    const m = await me("friends", b);
    expect(m.status).toBe(200);
    expect(m.body.membership.state).toBe("active");
    expect(m.body.participation).toMatchObject({ state: "paused", until });
    // A pause is not a stop: messaging consent is unchanged.
    expect(m.body.smsOptedIn).toBe(true);
    // The value is read from the member record the Network uses, not a copy.
    const [row] = await sql`select participation_window from network.members where app_id = 'friends' and id = ${open.memberId}`;
    expect(row.participation_window.until).toBe(until);
    // Removed account routes must not expose a standalone sign-in form.
    for (const app of APP_IDS) {
      const page = await st.site(app, "/settings");
      expect(page.status).toBe(404);
    }

    const resume = await st.site("friends", "/api/me/resume", { browser: b, json: {} });
    expect(resume.status).toBe(200);
    const after = await me("friends", b);
    expect(after.body.participation).toMatchObject({ state: "open", until: null });
    expect(after.body.smsOptedIn).toBe(true);
    // Not a member: nothing to resume.
    const stranger = new Browser();
    await signIn(st, "peon", newPhone(), stranger);
    expect((await st.site("peon", "/api/me/resume", { browser: stranger, json: {} })).status).toBe(400);
  }, T);

  describe("MCP through the site router", () => {
    test("multi-market radius survives profile intake, correction and geo matching without changing home or presence", async () => {
      const pilot = await startStack();
      const db = new SQL({ url: pilot.url, max: 2 });
      try {
        const phone = newPhone(), browser = new Browser();
        expect((await webJoin(pilot, "slop", phone, { age: 32, browser })).res.status).toBe(200);
        const member = (await db`select id from network.members m join platform.phone_identities p on p.person_id=m.person_id where p.e164=${phone} and m.app_id='slop'`)[0]!;
        const c = await connectMcp(pilot, "slop", phone, { browser });
        const submit = async (about: string) => toolData(await rpc(pilot, "slop", "/mcp", "tools/call", { name: "submit_profile", arguments: { about } }, c.token!.access_token));
        expect((await submit("Hello, I am ready to finish my profile.")).submitted).toBe(true);
        expect((await submit("I'm Theo, a man, 32, home in NYC, zip 11211. Looking for women 28-38. I date in SF and NYC within 100 miles. I like climbing.")).submitted).toBe(true);
        expect((await submit("Change only my distance to 50 miles, not 100 miles.")).submitted).toBe(true);
        const snapshot = await pilot.svc.runtimeFor("slop")!.unitOfWork(n => n.packInput(pilot.clock.now()));
        const saved = (await db`select state from network.network_state where id='slop:nyc'`)[0].state;
        const stored = saved.members.find((m: any) => m.id === member.id);
        expect(stored.onboarding.distance.value).toEqual({mode:"multi", markets:["nyc","sf"], miles:50});
        expect(stored.appTags.filter((t: any) => /^slop:(scope|max_miles):/.test(t.tag)).map((t: any) => t.tag).sort()).toEqual(["slop:max_miles:50", "slop:scope:multi:nyc,sf"]);
        const profile = slopProfiles(snapshot).get(member.id as any)!;
        expect(snapshot.members.some(m => m.id === member.id)).toBe(true);
        expect(profile.scope).toEqual({ mode: "multi", markets: ["nyc", "sf"] });
        expect(profile.maxMiles).toBe(50);
        expect(profile.homeMarket).toBe("nyc");
        expect((await db`select home_city from network.members where id=${member.id}`)[0].home_city).toBe("nyc");
        const facets = snapshot.facets.filter(f => f.memberId === member.id && f.tags.some(t => /^slop:(scope|max_miles):/.test(t)));
        expect(facets.flatMap(f => f.tags).sort()).toEqual(["slop:max_miles:50", "slop:scope:multi:nyc,sf"]);
        expect(facets.every(f => f.scope === "agent_private")).toBe(true);
        const parsed = extractSlopProfile(["I'm a man, 32, zip 94103. I date in SF and NYC within 100 miles."]);
        const corrected = applyCorrection(parsed, "50 miles, not 100 miles");
        expect(corrected.distance?.value).toEqual({ mode: "multi", markets: ["nyc", "sf"], miles: 50 });
        expect(readBack(corrected)).toContain("50 mi");
        expect(readBack(corrected)).toContain("SF");
        expect(readBack(corrected)).toContain("NYC");
        expect(slopOnboardTags(extractSlopProfile(["I date in SF and NYC"])).tags.map(t => t.tag)).toContain("slop:max_miles:25");
        const reading = { distance: { value: { mode: "multi", markets: ["sf", "nyc"], miles: 50 }, quote: "SF and NYC within 50 miles" } };
        expect(validateSlopReading(reading, "SF and NYC within 50 miles").distance?.value).toEqual(reading.distance.value);
        const pack = makeSlopPack({ verification: { required: false } });
        const origin = profile.cell!;
        const peer: SlopProfile = { ...profile, scope: { mode: "multi" as const, markets: ["nyc"] }, maxMiles: 50, cell: { id: "synthetic-35mi", lat: origin.lat + 0.5, lon: origin.lon } };
        expect(cellMiles(origin, peer.cell)).toBeGreaterThan(25);
        expect(cellMiles(origin, peer.cell)).toBeLessThan(50 - pack.options.radiusMargin);
        expect(mutualMarkets(profile, peer, pack.options, ["sf", "nyc"]).map(m => m.market)).toEqual(["nyc"]);
        expect(mutualMarkets({ ...profile, maxMiles: 25 }, peer, pack.options, ["nyc"])).toEqual([]);
        expect(mutualMarkets(peer, { ...profile, maxMiles: 25 }, pack.options, ["nyc"])).toEqual([]);
        expect(mutualMarkets(profile, { ...peer, cell: { id: "synthetic-70mi", lat: origin.lat + 1, lon: origin.lon } }, pack.options, ["nyc"])).toEqual([]);
        const world = new World(snapshot, SLOP_ENGINE_DEFAULTS, () => [1, 0], pack);
        expect(world.pack.geo.location(world, member.id as any, snapshot.now, snapshot.now + DAY).has("sf")).toBe(false);
        expect(appWiring("slop").engine?.cities).toEqual(["nyc"]);
        expect((await submit("Change only my distance to 25 miles.")).submitted).toBe(true);
        const narrowed = await pilot.svc.runtimeFor("slop")!.unitOfWork(n => n.packInput(pilot.clock.now()));
        expect(slopProfiles(narrowed).get(member.id as any)?.scope).toEqual({mode:"multi",markets:["nyc","sf"]});
        expect(slopProfiles(narrowed).get(member.id as any)?.maxMiles).toBe(25);
        expect(narrowed.facets.some(f => f.memberId === member.id && f.tags.includes("slop:max_miles:50"))).toBe(false);
        expect((await pilot.svc.runtimeFor("peon")!.unitOfWork(n => n.packInput(pilot.clock.now()))).facets.some(f => f.memberId === member.id)).toBe(false);
        // A separate SF slop runtime admits storage and includes the SF member in its pack input.
        const sf = await startStack({ slopCity: "sf" });
        const sfDb = new SQL({ url: sf.url, max: 1 });
        try {
          const sfPhone = newPhone(), sfBrowser = new Browser();
          expect((await webJoin(sf, "slop", sfPhone, { age: 32, browser: sfBrowser })).res.status).toBe(200);
          const sfClient = await connectMcp(sf, "slop", sfPhone, { browser: sfBrowser });
          for (const about of ["Hello, I am ready to finish my profile.", "I'm a man, 32, home in the Bay Area, zip 94505. Looking for women 28-38. I date in SF and NYC within 50 miles."]) {
            expect(toolData(await rpc(sf, "slop", "/mcp", "tools/call", { name: "submit_profile", arguments: { about } }, sfClient.token!.access_token)).submitted).toBe(true);
          }
          const sfSaved = (await sfDb`select state from network.network_state where id='slop:sf'`)[0].state.members[0];
          expect(sfSaved.onboarding.location.value.zip).toBe("94505");
          expect(sfSaved.onboarding.location.value.known).toBe(true);
          expect(zipForArea("Bay Area")).toBeUndefined();
          expect(sfSaved.onboarding.distance.value).toEqual({mode:"multi",markets:["nyc","sf"],miles:50});
          expect(sfSaved.onboarding.gender.value).toBe("man");
          expect(sfSaved.onboarding.seeks.value).toEqual(["woman"]);
          expect(sfSaved.onboarding.ageRange.value).toEqual([28,38]);
          const locationTags = sfSaved.appTags.filter((t:any) => /^(slop:(zip|max_miles|scope):|romance:)/.test(t.tag));
          expect(locationTags.some((t:any) => t.tag === "slop:zip:94505")).toBe(true);
          expect(locationTags.some((t:any) => t.tag === "slop:max_miles:50")).toBe(true);
          expect(locationTags.every((t:any) => t.scope === "agent_private")).toBe(true);
          const cell = cellOfZip(sfSaved.onboarding.location.value.zip);
          expect(cell).toBeDefined();
          expect(cell!.lat).toBeCloseTo(37.875, 6);
          expect(cell!.lon).toBeCloseTo(-121.595, 6);
          expect(cell!.lat).not.toBe(37.8713);
          expect(cell!.lon).not.toBe(-121.5970);
          expect((await sfDb`select home_city from network.members where app_id='slop'`)[0].home_city).toBe("sf");
          expect((await sf.svc.runtimeFor("slop")!.unitOfWork(n => n.packInput(sf.clock.now()))).members.map(m => m.homeCity)).toEqual(["sf"]);
        } finally { await sfDb.close(); await sf.close(); }

      } finally { await db.close(); await pilot.close(); }
    }, T);

    test("public signup instructions match the invite-only Network page and keep open apps usable", async () => {
      const page = await (await st.site("ntwrk", "/join?via=agent")).text();
      expect(page).not.toContain('data-form="phone"');
      expect(page).not.toContain('data-form="profile"');
      const app = await (await st.site("ntwrk", "/api/app")).json() as { joinMode: string };
      expect(app.joinMode).toBe("invite");
      const skill = await (await st.site("ntwrk", "/SKILL.md")).text();
      expect(skill).toContain("The Network is invitation-only.");
      expect(skill).toContain("enter the invitation in the app's browser");
      expect(skill).toContain("native connector authorization");
      expect(skill).not.toContain("https://ntwrk.party/settings");
      expect(skill).not.toMatch(/\/api\/auth\/otp\/|\/api\/me\/export|session\.cookies/);
      const info = toolData(await rpc(st, "ntwrk", "/mcp/openai", "tools/call", { name: "app_info", arguments: { app: "ntwrk" } }));
      expect(info.join.mode).toBe("invite");
      expect(info.join.how).toContain("Use a forwarded invitation in the app's browser");
      expect(info.join.how).toContain("connector authorization");
      expect(info.join.how).not.toContain("The agent asks what they are looking for");
      const signupPath = (app: AppId) => app === "slop" ? "/mcp/slop" : app === "ntwrk" ? "/mcp/openai" : `/mcp/${app}/openai`;
      const signup = (app: AppId) => rpc(st, "ntwrk", signupPath(app), "tools/call", { name: "start_signup", arguments: { app } });
      const invite = toolData(await signup("ntwrk"));
      expect(invite).toMatchObject({ app: "ntwrk", join_mode: "invite", url: "https://ntwrk.party/SKILL.md" });
      expect(invite.instructions_for_person).toContain("Use a forwarded invitation in the app's browser");
      expect(invite.instructions_for_person).toContain("connector authorization");
      expect(invite.instructions_for_person).not.toMatch(/enter your own phone|code arrives|type it on that page/i);
      for (const app of ["slop", "peon", "friends"] as const) {
        const info = toolData(await rpc(st, "ntwrk", signupPath(app), "tools/call", { name: "app_info", arguments: { app } }));
        expect(info.join.how).toContain(`texts "${app}" as their first message`);
        const open = toolData(await signup(app));
        expect(open).toMatchObject({ app, join_mode: "open" });
        const path = new URL(open.url).pathname;
        expect(path).toBe(app === "peon" ? "/join" : "/SKILL.md");
        expect((await st.site(app, path)).status).toBe(200);
        expect(open.instructions_for_person).toContain(app === "peon" ? "Enter it on that page" : "Keep the verification code on that page");
      }
      expect((await rpc(st, "ntwrk", "/mcp/openai", "tools/call", { name: "start_signup", arguments: { app: "slop" } })).body!.result.isError).toBe(true);
      expect((await sql`select count(*)::int as n from oauth.grants`)[0]!.n).toBe(0);
    }, T);

    test("authenticated nonmembers get invitation guidance for Network and signup guidance for open apps", async () => {
      const phone = newPhone(), browser = new Browser();
      expect((await webJoin(st, "peon", phone, { age: 30, browser })).res.status).toBe(200);
      const person = (await st.svc.publicApi.accounts.personFor(phone))!;
      const about = "I like climbing and live music, and hope to meet local friends.";
      const before = Number((await sql`select count(*) as n from network.messages`)[0]!.n);
      for (const app of ["ntwrk", "friends"] as const) {
        await signIn(st, app, phone, browser);
        const connection = await connectMcp(st, app, phone, { browser, path: "/mcp/openai", redirect: "https://chatgpt.com/connector_platform_oauth_redirect" });
        expect(connection.token?.access_token, connection.html).toEqual(expect.any(String));
        for (const name of ["check_status", "submit_profile"] as const) {
          const data = toolData(await rpc(st, app, "/mcp/openai", "tools/call", { name, arguments: name === "submit_profile" ? { about } : {} }, connection.token!.access_token));
          expect(data).toMatchObject({ app, status: "not_joined" });
          if (name === "submit_profile") expect(data.submitted).toBe(false);
          if (app === "ntwrk") {
            expect(data.next_step).toContain("invite-only");
            if (name === "check_status") {
              expect(data.next_step).toContain("/oauth/finish-signup?t=");
              expect(data.next_step).toContain("Finish signup");
              expect(data.next_step).toContain("enter the invitation there");
            } else {
              expect(data.next_step).toContain("disconnect The Network in your agent's connector settings, then connect it again");
              expect(data.next_step).toContain("choose Finish signup");
              expect(data.next_step).toContain("Enter the invitation on that page");
            }
            expect(data.next_step).not.toContain("sign up there");
          } else {
            if (name === "check_status") {
              expect(data.next_step).toContain("/oauth/finish-signup?t=");
              expect(data.next_step).toContain("Finish signup");
            } else {
              expect(data.next_step).toContain("disconnect friends.help in your agent's connector settings, then connect it again");
              expect(data.next_step).toContain("choose Finish signup");
            }
            expect(data.next_step).toContain('Or text "friends" as your first message to The Network\'s line.');
          }
        }
        expect(await st.svc.people.getMembership(person.id, app)).toBeUndefined();
      }
      expect(Number((await sql`select count(*) as n from network.messages`)[0]!.n)).toBe(before);
    }, T);

    test("the slop.date ChatGPT connector keeps ZIP profiles but refuses split phone numbers and codes before storage, with no allowlist", async () => {
      const pilot = await startStack();
      const db = new SQL({ url: pilot.url, max: 2 });
      try {
        const phone = newPhone(), browser = new Browser();
        expect((await webJoin(pilot, "slop", phone, { age: 30, browser })).res.status).toBe(200);
        const person = (await pilot.svc.publicApi.accounts.personFor(phone))!;
        const member = (await db`select id from network.members where person_id=${person.id} and app_id='slop'`)[0]!;
        const c = await connectMcp(pilot, "ntwrk", phone, { browser, path: "/mcp/slop/openai", redirect: "https://chatgpt.com/connector_platform_oauth_redirect" });
        expect(c.token?.access_token, c.html).toEqual(expect.any(String));
        const submit = (about: string) => rpc(pilot, "ntwrk", "/mcp/slop/openai", "tools/call", { name: "submit_profile", arguments: { app: "slop", about } }, c.token!.access_token);
        for (const about of ["My phone number is 11211 12345.", "My phone is 41555 50102.", "My verification code is 12 34 56.", "Please keep this private: 41555 50102.", "Please keep this private: 12 34 56.", "Please keep this private: 12-34 56.", "Reach me at cell2125550142."]) {
          expect(toolData(await submit(about)).error).toMatch(/phone numbers, codes and email/);
          expect((await db`select id from network.messages where body=${about}`).length).toBe(0);
        }
        const agentProfiles = async () => (await db`select id from network.messages where member_id=${member.id} and direction='inbound' and type='agent_profile'`).length;
        for (const about of [
          "I'm Rae, 30, in 11211. Seeking men 28-35 within 5 miles for a long-term relationship. I like climbing and live music.",
          "I'm Rae, 30, near (11237), seeking men 28-35 within 5 miles. I like climbing and live music.",
          "I'm Rae, 30, in 11211. I like 1990s music, climbing and live shows.",
        ]) {
          const profilesBefore = await agentProfiles();
          expect(toolData(await submit(about))).toMatchObject({ app: "slop", submitted: true });
          expect(await agentProfiles()).toBe(profilesBefore + 1);
          expect((await db`select id from network.messages where member_id=${member.id} and body=${about}`).length).toBe(0);
        }
        expect((await db`select id from network.members where person_id=${person.id} and app_id='slop'`)[0]!.id).toBe(member.id);
        expect((await pilot.svc.publicApi.accounts.personFor(phone))?.id).toBe(person.id);
        expect(toolData(await rpc(pilot, "ntwrk", "/mcp/slop/openai", "tools/call", { name: "check_status", arguments: { app: "slop" } }, c.token!.access_token))).toMatchObject({ app: "slop", status: "active" });
      } finally { await db.close(); await pilot.close(); }
    }, T);

    test("the slop.date ChatGPT connector is open to every person at ntwrk.party/mcp/slop/openai; slop.date refuses ChatGPT registration", async () => {
      const redirect = "https://chatgpt.com/connector_platform_oauth_redirect";
      const registered = await st.site("ntwrk", "/oauth/register", { json: { redirect_uris: [redirect], token_endpoint_auth_method: "none" } });
      expect(registered.status).toBe(201);
      expect(((await registered.json()) as { redirect_uris: string[] }).redirect_uris).toEqual([redirect]);
      expect((await st.site("slop", "/oauth/register", { json: { redirect_uris: [redirect], token_endpoint_auth_method: "none" } })).status).toBe(201);
      for (const uris of [["https://platform.openai.com/callback"], [redirect, "https://client.example/callback"]]) {
        expect((await st.site("slop", "/oauth/register", { json: { redirect_uris: uris, token_endpoint_auth_method: "none" } })).status).toBe(400);
      }
    }, T);

    test("the slop.date ChatGPT connector refuses held and banned phones at connection and gives nonmembers and members in review no slop.date access", async () => {
      const pilot = await startStack();
      const db = new SQL({ url: pilot.url, max: 2 });
      try {
        const redirect = "https://chatgpt.com/connector_platform_oauth_redirect";
        for (const kind of ["nonmember", "review", "phone-hold", "phone-ban", "person-ban"]) {
          const phone = newPhone(), browser = new Browser();
          expect((await webJoin(pilot, kind === "nonmember" ? "peon" : "slop", phone, { age: 30, browser })).res.status).toBe(200);
          const person = (await pilot.svc.publicApi.accounts.personFor(phone))!;
          if (kind === "review") await db`update platform.memberships set review='recycled_number' where person_id=${person.id} and app_id='slop'`;
          if (kind === "phone-hold") await pilot.svc.people.setPhoneHold(phone, "recycled_number", pilot.clock.now());
          if (kind.endsWith("ban")) await pilot.svc.people.ban({ id: crypto.randomUUID(), scope: kind === "phone-ban" ? "phone" : "person", personId: kind === "person-ban" ? person.id : null, phoneHash: kind === "phone-ban" ? pilot.svc.publicApi.accounts.phoneHash(phone) : null, reason: "owned fixture", reportId: null, bannedBy: "fixture", at: pilot.clock.now() });
          const connection = await connectMcp(pilot, "ntwrk", phone, { browser, path: "/mcp/slop/openai", redirect });
          if (kind === "phone-hold" || kind.endsWith("ban")) { expect(connection.token?.access_token, kind).toBeUndefined(); continue; }
          let accessToken = connection.token?.access_token as string | undefined;
          if (kind === "nonmember" && !accessToken && connection.html.includes('action="/oauth/authorize/signup"')) {
            const rid = /name="rid" value="([^"]+)"/.exec(connection.html)![1]!;
            const opened = await pilot.site("ntwrk", "/oauth/authorize/signup", { browser, form: { rid, decision: "open" } });
            expect(opened.status).toBe(200);
            const approved = await pilot.site("ntwrk", "/oauth/authorize/consent", { browser, form: { rid, decision: "approve" } });
            const code = new URL(approved.headers.get("location")!).searchParams.get("code")!;
            const tok = await pilot.site("ntwrk", "/oauth/token", { form: { grant_type: "authorization_code", code, redirect_uri: redirect, client_id: connection.client.client_id, code_verifier: VERIFIER, resource: `${pilot.sites.ntwrk.origin}/mcp/slop/openai` } });
            accessToken = ((await tok.json()) as { access_token?: string }).access_token;
          }
          expect(accessToken, `${kind} ${connection.html}`).toEqual(expect.any(String));
          const expected = kind === "nonmember" ? "not_joined" : "on_hold";
          expect(toolData(await rpc(pilot, "ntwrk", "/mcp/slop/openai", "tools/call", { name: "check_status", arguments: {} }, accessToken)), kind).toMatchObject({ app: "slop", status: expected });
          const about = `A profile from a person whose slop.date status is ${expected}.`;
          expect(toolData(await rpc(pilot, "ntwrk", "/mcp/slop/openai", "tools/call", { name: "submit_profile", arguments: { about } }, accessToken)), kind).toMatchObject({ app: "slop", submitted: false, status: expected });
          expect((await db`select id from network.messages where body=${about}`).length, kind).toBe(0);
          if (kind === "nonmember") expect(await pilot.svc.people.getMembership(person.id, "slop")).toBeUndefined();
        }
      } finally { await db.close(); await pilot.close(); }
    }, T);

    test("the slop.date ChatGPT connector serves /mcp/slop/openai with revocable grants; photo tools stay on the full surface and the public OpenAI surface still never names slop.date", async () => {
      const pilot = await startStack();
      const db = new SQL({ url: pilot.url, max: 2 });
      try {
        const phone = newPhone(), browser = new Browser();
        expect((await webJoin(pilot, "slop", phone, { age: 30, browser })).res.status).toBe(200);
        const person = (await pilot.svc.publicApi.accounts.personFor(phone))!;
        const redirect = "https://chatgpt.com/connector_platform_oauth_redirect";
        const c = await connectMcp(pilot, "ntwrk", phone, { browser, path: "/mcp/slop/openai", redirect });
        expect(c.token?.access_token, c.html).toEqual(expect.any(String));
        const token = c.token!.access_token as string;
        const other = await connectMcp(pilot, "slop", phone, { browser });
        expect(other.token?.access_token, other.html).toEqual(expect.any(String));
        expect(new URL(c.location!).searchParams.get("iss")).toBe(pilot.sites.ntwrk.origin);
        const status = () => rpc(pilot, "ntwrk", "/mcp/slop/openai", "tools/call", { name: "check_status", arguments: {} }, token);
        expect(toolData(await status())).toMatchObject({ app: "slop", status: "active" });
        const about = "I'm Rae, 30, in Williamsburg. I like climbing and live music and seek a long-term relationship.";
        const member = (await db`select id from network.members where person_id=${person.id} and app_id='slop'`)[0]!;
        const agentProfiles = async () => (await db`select id from network.messages where member_id=${member.id} and direction='inbound' and type='agent_profile'`).length;
        const profilesBefore = await agentProfiles();
        expect(toolData(await rpc(pilot, "ntwrk", "/mcp/slop/openai", "tools/call", { name: "submit_profile", arguments: { about } }, token)).submitted).toBe(true);
        expect(await agentProfiles()).toBe(profilesBefore + 1);
        expect((await db`select id from network.messages where member_id=${member.id} and body=${about}`).length).toBe(0);
        const names = async (app: AppId, path: string, bearer?: string) => ((await rpc(pilot, app, path, "tools/list", {}, bearer)).body!.result.tools as { name: string }[]).map(t => t.name);
        const fullTools = await names("slop", "/mcp", other.token!.access_token as string);
        expect(fullTools).toEqual(expect.arrayContaining(["app_info", "start_signup", "check_status", "submit_profile", "get_updates", "read_profile", "list_looking_for", "my_photos", "photo_request"]));
        const openAiTools = await names("ntwrk", "/mcp/slop/openai", token);
        expect(openAiTools).toEqual(expect.arrayContaining(["app_info", "start_signup", "check_status", "submit_profile", "get_updates", "read_profile", "list_looking_for"]));
        expect(openAiTools).not.toContain("my_photos");
        expect(openAiTools).not.toContain("photo_request");
        expect(await names("ntwrk", "/mcp/slop/openai")).toEqual(openAiTools);
        const discover = (app: AppId, path: string) => rpc(pilot, app, path, "server/discover");
        const initialize = async (app: AppId, path: string) => {
          const res = await pilot.site(app, path, { json: {
            jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} },
          } });
          return { res, body: await res.json() as { result: { instructions: string } } };
        };
        for (const ask of [discover, initialize]) {
          const full = await ask("slop", "/mcp");
          expect(full.res.status).toBe(200);
          expect(full.body!.result.instructions).toMatch(/my_photos.*photo_request/);
          const slopOpenAi = await ask("ntwrk", "/mcp/slop/openai");
          expect(slopOpenAi.res.status).toBe(200);
          expect(slopOpenAi.body!.result.instructions).not.toMatch(/my_photos|photo_request/);
          const publicSurface = await ask("ntwrk", "/mcp/openai");
          expect(publicSurface.res.status).toBe(200);
          expect(publicSurface.body!.result.instructions).not.toMatch(/slop|my_photos|photo_request/i);
          const otherHost = await ask("friends", "/mcp");
          expect(otherHost.res.status).toBe(200);
          expect(otherHost.body!.result.instructions).not.toMatch(/my_photos|photo_request/);
        }
        expect((await rpc(pilot, "ntwrk", "/mcp/slop/openai", "tools/call", { name: "get_updates", arguments: {} }, token)).body!.result.isError).not.toBe(true);
        for (const [app, path] of [["ntwrk", "/mcp"], ["ntwrk", "/mcp/slop"], ["friends", "/mcp"], ["slop", "/mcp"]] as const) {
          expect((await rpc(pilot, app, path, "tools/call", { name: "check_status", arguments: {} }, token)).res.status, `${app}${path}`).toBe(401);
        }
        expect((await rpc(pilot, "slop", "/mcp/openai", "tools/list", {}, token)).res.status).toBe(404);
        expect((await pilot.site("slop", "/.well-known/oauth-protected-resource/mcp/openai")).status).toBe(404);
        expect(JSON.stringify(toolData(await rpc(pilot, "ntwrk", "/mcp/openai", "tools/call", { name: "app_info", arguments: {} })))).not.toMatch(/slop|dating/i);
        expect(toolData(await rpc(pilot, "ntwrk", "/mcp/slop/openai", "tools/call", { name: "app_info", arguments: { app: "slop" } })).id).toBe("slop");
        const slopOpenAiMeta = await pilot.site("ntwrk", "/.well-known/oauth-protected-resource/mcp/slop/openai");
        expect(slopOpenAiMeta.status).toBe(200);
        expect(((await slopOpenAiMeta.json()) as { resource: string }).resource).toBe(`${pilot.sites.ntwrk.origin}/mcp/slop/openai`);
        expect((await rpc(pilot, "ntwrk", "/mcp/slop/openai", "tools/call", { name: "check_status", arguments: {} }, other.token!.access_token)).res.status).toBe(401);
        const client = (await pilot.mcp.store.getClient(c.client.client_id))!;
        const cimd = { ...client, app: "slop" as const, id: "https://chatgpt.com/oauth/client.json", kind: "cimd" as const, surface: "full" as const, redirectUris: ["https://client.example/callback"] };
        await pilot.mcp.store.putClient(cimd);
        const query = (clientId = c.client.client_id, uri = redirect, resource = `${pilot.sites.ntwrk.origin}/mcp/slop/openai`) => new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: uri, code_challenge: pkceS256(VERIFIER), code_challenge_method: "S256", resource });
        expect((await pilot.site("ntwrk", `/oauth/authorize?${query(c.client.client_id, redirect, `${pilot.sites.ntwrk.origin}/mcp/slop`)}`, { browser })).status).toBe(400);
        expect((await pilot.site("slop", `/oauth/authorize?${query(cimd.id, cimd.redirectUris[0]!, `${pilot.sites.slop.origin}/mcp`)}`, { browser })).status).toBe(403);
        const approvalPage = await pilot.site("ntwrk", `/oauth/authorize?${query()}`, { browser });
        expect(approvalPage.status).toBe(200);
        expect(approvalPage.headers.get("location")).toBeNull();
        expect(await approvalPage.text()).toContain('action="/oauth/authorize/consent"');
        expect((await pilot.site("ntwrk", "/oauth/revoke", { form: { token: c.token!.refresh_token, client_id: c.client.client_id } })).status).toBe(200);
        expect((await status()).res.status).toBe(401);
        expect((await pilot.site("ntwrk", "/oauth/token", { form: { grant_type: "refresh_token", refresh_token: c.token!.refresh_token, client_id: c.client.client_id } })).status).toBe(400);
        expect((await rpc(pilot, "slop", "/mcp", "tools/call", { name: "check_status", arguments: {} }, other.token!.access_token)).res.status).toBe(200);
      } finally { await db.close(); await pilot.close(); }
    }, T);

    test("the slop.date ChatGPT connector binds access to the verified account", async () => {
      const pilot = await startStack();
      try {
        const redirect = "https://chatgpt.com/connector_platform_oauth_redirect";
        const resource = `${pilot.sites.ntwrk.origin}/mcp/slop/openai`;
        const phone = newPhone(), browser = new Browser();
        expect((await webJoin(pilot, "slop", phone, { age: 30, browser })).res.status).toBe(200);
        const first = (await pilot.svc.publicApi.accounts.personFor(phone))!;
        const secondPhone = newPhone(), secondBrowser = new Browser();
        expect((await webJoin(pilot, "slop", secondPhone, { age: 31, browser: secondBrowser })).res.status).toBe(200);
        const c = await connectMcp(pilot, "ntwrk", phone, { browser, path: "/mcp/slop/openai", redirect });
        expect(c.token?.access_token, c.html).toEqual(expect.any(String));
        const q = new URLSearchParams({ response_type: "code", client_id: c.client.client_id, redirect_uri: redirect, code_challenge: pkceS256(VERIFIER), code_challenge_method: "S256", resource });
        const approvalPage = await pilot.site("ntwrk", `/oauth/authorize?${q}`, { browser });
        expect(approvalPage.status).toBe(200);
        expect(approvalPage.headers.get("location")).toBeNull();
        const approvalHtml = await approvalPage.text();
        expect(approvalHtml).toContain('action="/oauth/authorize/consent"');
        const rid = /name="rid" value="([^"]+)"/.exec(approvalHtml)![1]!;
        const authorized = await pilot.site("ntwrk", "/oauth/authorize/consent", { browser, form: { rid, decision: "approve" } });
        expect(authorized.status).toBe(303);
        const code = new URL(authorized.headers.get("location")!).searchParams.get("code")!;
        await signIn(pilot, "ntwrk", secondPhone, browser);
        const tokenResponse = await pilot.site("ntwrk", "/oauth/token", { form: { grant_type: "authorization_code", code, client_id: c.client.client_id, redirect_uri: redirect, code_verifier: VERIFIER, resource } });
        expect(tokenResponse.status).toBe(200);
        const token = (await tokenResponse.json() as {access_token: string}).access_token;
        const savedToken = await pilot.mcp.store.getToken(sha256hex(token));
        expect((await pilot.mcp.store.getGrant(savedToken!.grantId))!.personId).toBe(first.id);
      } finally { await pilot.close(); }
    }, T);

    test("the slop.date ChatGPT connector gets the same answers as any other connector after age, hold, ban and phone-owner changes", async () => {
      const pilot = await startStack();
      const db = new SQL({ url: pilot.url, max: 2 });
      try {
        for (const kind of ["age", "hold", "phone-ban", "person-ban", "ownership"]) {
          const phone = newPhone(), browser = new Browser();
          expect((await webJoin(pilot, "slop", phone, { age: 30, browser })).res.status).toBe(200);
          const person = (await pilot.svc.publicApi.accounts.personFor(phone))!;
          const redirect = "https://chatgpt.com/connector_platform_oauth_redirect";
          const resource = `${pilot.sites.ntwrk.origin}/mcp/slop/openai`;
          const chatGpt = await connectMcp(pilot, "ntwrk", phone, { browser, path: "/mcp/slop/openai", redirect });
          const other = await connectMcp(pilot, "slop", phone, { browser });
          expect(chatGpt.token?.access_token, kind).toEqual(expect.any(String));
          expect(other.token?.access_token, kind).toEqual(expect.any(String));
          const pendingQuery = new URLSearchParams({ response_type: "code", client_id: chatGpt.client.client_id, redirect_uri: redirect, code_challenge: pkceS256(VERIFIER), code_challenge_method: "S256", resource });
          const pending = await pilot.site("ntwrk", `/oauth/authorize?${pendingQuery}`, { browser });
          expect(pending.status, kind).toBe(200);
          const pendingHtml = await pending.text();
          expect(pendingHtml).toContain('action="/oauth/authorize/consent"');
          const pendingRid = /name="rid" value="([^"]+)"/.exec(pendingHtml)![1]!;
          const approved = await pilot.site("ntwrk", "/oauth/authorize/consent", { browser, form: { rid: pendingRid, decision: "approve" } });
          expect(approved.status, kind).toBe(303);
          const pendingCode = new URL(approved.headers.get("location")!).searchParams.get("code")!;
          if (kind === "age") await pilot.svc.people.recordAgeReading(null, pilot.svc.publicApi.accounts.phoneHash(phone), { kind: "age", age: 17 }, pilot.clock.now());
          if (kind === "hold") await pilot.svc.people.setPhoneHold(phone, "recycled_number", pilot.clock.now());
          if (kind.endsWith("ban")) await pilot.svc.people.ban({ id: crypto.randomUUID(), scope: kind === "phone-ban" ? "phone" : "person", personId: kind === "person-ban" ? person.id : null, phoneHash: kind === "phone-ban" ? pilot.svc.publicApi.accounts.phoneHash(phone) : null, reason: "owned fixture", reportId: null, bannedBy: "fixture", at: pilot.clock.now() });
          if (kind === "ownership") {
            const owner = newPhone();
            expect((await webJoin(pilot, "slop", owner, { age: 31 })).res.status).toBe(200);
            await db`update platform.phone_identities set person_id=${(await pilot.svc.publicApi.accounts.personFor(owner))!.id} where e164=${phone}`;
          }
          const refused = kind !== "age";
          for (const name of ["check_status", "submit_profile"]) {
            const about = (client: string) => `A ${client} profile after the ${kind} change.`;
            const answer = async (client: string, app: AppId, path: string, access: string) => {
              const r = await rpc(pilot, app, path, "tools/call", { name, arguments: name === "submit_profile" ? { about: about(client) } : {} }, access);
              return { status: r.res.status, stored: (await db`select id from network.messages where body=${about(client)}`).length, data: r.res.status === 200 ? toolData(r) : null };
            };
            const chatGptAnswer = await answer("chatgpt", "ntwrk", "/mcp/slop/openai", chatGpt.token!.access_token);
            const otherAnswer = await answer("other", "slop", "/mcp", other.token!.access_token);
            expect(chatGptAnswer.status, `${kind} ${name}`).toBe(refused ? 401 : 200);
            if (refused) expect(chatGptAnswer.stored, `${kind} ${name}`).toBe(0);
            if (!refused && name === "check_status") {
              expect(chatGptAnswer.data, kind).toMatchObject({ app: "slop", status: "active" });
              expect(chatGptAnswer.data.next_step, kind).toContain("doesn't match anyone under 18");
            }
            expect(otherAnswer, `${kind} ${name}`).toEqual(chatGptAnswer);
          }
          const refresh = async (app: AppId, connection: typeof chatGpt) => (await pilot.site(app, "/oauth/token", { form: { grant_type: "refresh_token", client_id: connection.client.client_id, refresh_token: connection.token!.refresh_token } })).status;
          const chatGptRefresh = await refresh("ntwrk", chatGpt);
          expect(chatGptRefresh, kind).toBe(refused ? 400 : 200);
          expect(await refresh("slop", other), kind).toBe(chatGptRefresh);
          const exchange = await pilot.site("ntwrk", "/oauth/token", { form: { grant_type: "authorization_code", code: pendingCode, client_id: chatGpt.client.client_id, redirect_uri: redirect, code_verifier: VERIFIER, resource } });
          expect(exchange.status, kind).toBe(refused ? 400 : 200);
        }
      } finally { await db.close(); await pilot.close(); }
    }, T);

    test("MCP_PRIVATE_OPENAI_APPS is dev-only, the slop.date ChatGPT connector does not depend on it, and the public plugin stays closed", async () => {
      const redirect = "https://chatgpt.com/connector_platform_oauth_redirect";
      expect((await st.site("slop", "/oauth/register", { json: { redirect_uris: [redirect], token_endpoint_auth_method: "none" } })).status).toBe(201);
      expect((await st.site("slop", "/oauth/register", { json: { redirect_uris: ["https://platform.openai.com/callback"], token_endpoint_auth_method: "none" } })).status).toBe(400);
      expect((await st.site("ntwrk", "/oauth/register", { json: { redirect_uris: [redirect], token_endpoint_auth_method: "none" } })).status).toBe(201);
      for (const env of [
        { PLATFORM_ENV: "production" }, { PLATFORM_ENV: "staging" }, { PLATFORM_ENV: "unknown" },
        { PLATFORM_ENV: "dev", NODE_ENV: "production" },
      ]) {
        await expect(createServiceMcp(st.svc, { env: { ...env, MCP_PRIVATE_OPENAI_APPS: "slop" } })).rejects.toThrow("owned dev runtime only");
      }
      const beforeOuter = Number((await sql`select count(*) as n from network.members`)[0]!.n);
      const pilot = await startStack({ privateOpenAiApps: ["slop"] });
      const db = new SQL({ url: pilot.url, max: 2 });
      try {
        expect(pilot.url).not.toBe(st.url);
        expect((await rpc(pilot, "slop", "/mcp/openai", "tools/list")).res.status).toBe(404);
        expect((await pilot.site("slop", "/.well-known/oauth-protected-resource/mcp/openai")).status).toBe(404);
        const publicApps = toolData(await rpc(pilot, "ntwrk", "/mcp/openai", "tools/call", { name: "app_info", arguments: {} }));
        expect(JSON.stringify(publicApps)).not.toMatch(/slop|dating/i);
        const phone = newPhone();
        const browser = new Browser();
        expect((await webJoin(pilot, "slop", phone, { age: 30, browser })).res.status).toBe(200);
        const resource = `${pilot.sites.ntwrk.origin}/mcp/slop/openai`;
        const connection = await connectMcp(pilot, "ntwrk", phone, { browser, path: "/mcp/slop/openai", redirect });
        expect(connection.token?.access_token, connection.html).toEqual(expect.any(String));
        expect(new URL(connection.location!).searchParams.get("iss")).toBe(pilot.sites.ntwrk.origin);
        const member = (await db`select m.id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = 'slop' and ph.e164 = ${phone}`)[0]!;
        const about = "I'm Rae, 30, in Williamsburg, looking for a long-term relationship. I like climbing and live music. Free weekend afternoons.";
        expect(toolData(await rpc(pilot, "ntwrk", "/mcp/slop/openai", "tools/call", { name: "submit_profile", arguments: { about } }, connection.token!.access_token)).submitted).toBe(true);
        expect((await db`select member_id from network.messages where member_id = ${member.id} and direction = 'inbound' and type = 'agent_profile' and body = 'Private profile from the member''s agent.'`).length).toBe(1);
        expect((await db`select member_id from network.messages where body = ${about}`).length).toBe(0);
        expect(toolData(await rpc(pilot, "ntwrk", "/mcp/slop/openai", "tools/call", { name: "check_status", arguments: {} }, connection.token!.access_token))).toMatchObject({ app: "slop", status: "active" });
        // A handler restart uses the SAME Postgres clients, grants and tokens; off suspends, not revokes.
        const authorizeQuery = new URLSearchParams({ response_type: "code", client_id: connection.client.client_id, redirect_uri: redirect, code_challenge: pkceS256(VERIFIER), code_challenge_method: "S256", resource });
        // A pre-existing CIMD client cannot inherit the slop.date host, even with a non-OpenAI redirect.
        const dcrClient = (await pilot.mcp.store.getClient(connection.client.client_id))!;
        const cimdId = "https://chatgpt.com/oauth/client.json";
        await pilot.mcp.store.putClient({ ...dcrClient, app: "slop", id: cimdId, kind: "cimd", surface: "full", redirectUris: ["https://client.example/callback"] });
        const cimdQuery = new URLSearchParams({ response_type: "code", client_id: cimdId, redirect_uri: "https://client.example/callback", code_challenge: pkceS256(VERIFIER), code_challenge_method: "S256", resource: `${pilot.sites.slop.origin}/mcp` });
        expect((await pilot.site("slop", `/oauth/authorize?${cimdQuery}`, { browser })).status).toBe(403);
        expect((await pilot.site("ntwrk", "/oauth/token", { form: { grant_type: "refresh_token", refresh_token: connection.token!.refresh_token, client_id: cimdId } })).status).toBe(401);
        const pending = await pilot.site("ntwrk", `/oauth/authorize?${authorizeQuery}`, { browser });
        expect(pending.status).toBe(200);
        expect(pending.headers.get("location")).toBeNull();
        const approvalHtml = await pending.text();
        expect(approvalHtml).toContain('action="/oauth/authorize/consent"');
        const rid = /name="rid" value="([^"]+)"/.exec(approvalHtml)![1]!;
        const approved = await pilot.site("ntwrk", "/oauth/authorize/consent", { browser, form: { rid, decision: "approve" } });
        expect(approved.status).toBe(303);
        const pendingCode = new URL(approved.headers.get("location")!).searchParams.get("code")!;
        expect(pendingCode).toEqual(expect.any(String));
        const refresh = () => pilot.site("ntwrk", "/oauth/token", { form: { grant_type: "refresh_token", refresh_token: connection.token!.refresh_token, client_id: connection.client.client_id } });
        await pilot.setPrivateOpenAiApps([]);
        expect((await rpc(pilot, "ntwrk", "/mcp/slop/openai", "tools/call", { name: "check_status", arguments: {} }, connection.token!.access_token)).res.status).toBe(200);
        expect((await pilot.site("ntwrk", `/oauth/authorize?${authorizeQuery}`, { browser })).status).toBe(200);
        expect((await pilot.site("slop", `/oauth/authorize?${cimdQuery}`, { browser })).status).toBe(403);
        expect((await pilot.site("ntwrk", "/oauth/revoke", { form: { token: connection.token!.refresh_token, client_id: connection.client.client_id } })).status).toBe(200);
        expect((await rpc(pilot, "ntwrk", "/mcp/slop/openai", "tools/call", { name: "check_status", arguments: {} }, connection.token!.access_token)).res.status).toBe(401);
        expect((await refresh()).status).toBe(400);
        expect(Number((await sql`select count(*) as n from network.members`)[0]!.n)).toBe(beforeOuter);
      } finally {
        await db.close();
        await pilot.close();
      }
      expect(Number((await sql`select count(*) as n from network.members`)[0]!.n)).toBe(beforeOuter);
    }, T);

    test("Slop: two assistants share one phone owner, a different account stays isolated, and one disconnect preserves the other", async () => {
      const phone = newPhone();
      const browser = new Browser();
      expect((await webJoin(st, "slop", phone, { age: 30, firstName: "Rae", browser })).res.status).toBe(200);
      const before = await memberRow("slop", phone);
      const sent = st.otp.sent.length;
      const a = await connectMcp(st, "slop", phone, { browser, redirect: "https://assistant-a.example/callback" });
      const b = await connectMcp(st, "slop", phone, { browser, redirect: "http://127.0.0.1:55103/callback" });
      expect(a.token?.access_token, a.html).toEqual(expect.any(String));
      expect(b.token?.access_token, b.html).toEqual(expect.any(String));
      expect(st.otp.sent.length).toBe(sent);
      expect(new URL(b.location!).origin).toBe("http://127.0.0.1:55103");
      expect(new URL(b.location!).searchParams.get("iss")).toBe(st.sites.slop.origin);
      const about = "I'm Rae, a woman, 30, in Williamsburg, seeking men 28-38 within 5 miles for a long-term relationship. I like climbing and live music. Free weekend afternoons.";
      const agentProfiles = async () => (await sql`select body from network.messages where member_id = ${before!.id} and direction = 'inbound' and type = 'agent_profile'`).length;
      const agentProfilesBefore = await agentProfiles();
      expect(toolData(await rpc(st, "slop", "/mcp", "tools/call", { name: "submit_profile", arguments: { about } }, a.token!.access_token))).toMatchObject({ app: "slop", submitted: true });
      expect((await memberRow("slop", phone))?.id).toBe(before?.id);
      expect(await agentProfiles()).toBe(agentProfilesBefore + 1);
      expect((await sql`select body from network.messages where member_id = ${before!.id} and direction = 'inbound'`).some((r: any) => r.body === about)).toBe(false);
      expect(toolData(await rpc(st, "slop", "/mcp", "tools/call", { name: "check_status", arguments: {} }, b.token!.access_token))).toMatchObject({ app: "slop", status: "active" });
      const otherPhone = newPhone();
      const otherBrowser = new Browser();
      expect((await webJoin(st, "slop", otherPhone, { age: 31, firstName: "Kai", browser: otherBrowser })).res.status).toBe(200);
      const other = await connectMcp(st, "slop", otherPhone, { browser: otherBrowser });
      const otherMember = (await memberRow("slop", otherPhone))!;
      expect(otherMember.id).not.toBe(before!.id);
      expect((await sql`select body from network.messages where member_id = ${otherMember.id} and body = ${about}`).length).toBe(0);
      expect((await rpc(st, "friends", "/mcp", "tools/call", { name: "check_status", arguments: {} }, a.token!.access_token)).res.status).toBe(401);
      expect((await st.site("slop", "/oauth/revoke", { form: { token: a.token!.access_token, client_id: a.client.client_id } })).status).toBe(200);
      expect((await rpc(st, "slop", "/mcp", "tools/call", { name: "check_status", arguments: {} }, a.token!.access_token)).res.status).toBe(401);
      expect((await rpc(st, "slop", "/mcp", "tools/call", { name: "check_status", arguments: {} }, b.token!.access_token)).res.status).toBe(200);
      expect((await rpc(st, "slop", "/mcp", "tools/call", { name: "check_status", arguments: {} }, other.token!.access_token)).res.status).toBe(200);
      expect((await me("slop", browser)).status).toBe(200);
    }, T);

    test("pending OAuth requests stay independent across app sites on one loopback hostname", async () => {
      const browser = new Browser();
      const pending: { app: AppId; rid: string }[] = [];
      for (const app of ["peon", "friends"] as const) {
        const registration = await st.site(app, "/oauth/register", { json: {
          client_name: "E2E Assistant", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none",
        } });
        expect(registration.status).toBe(201);
        const { client_id } = await registration.json() as { client_id: string };
        const query = new URLSearchParams({ response_type: "code", client_id, redirect_uri: REDIRECT,
          code_challenge: pkceS256(VERIFIER), code_challenge_method: "S256", resource: `${st.sites[app].origin}/mcp` });
        const page = await st.site(app, `/oauth/authorize?${query}`, { browser });
        const rid = /name="rid" value="([^"]+)"/.exec(await page.text())?.[1];
        if (!rid) throw new Error(`Missing pending request for ${app}`);
        pending.push({ app, rid });
      }
      const first = pending[0]!, second = pending[1]!;
      const pendingCookie = browser.jar.get(`mcp_auth_${first.app}`);
      if (!pendingCookie) throw new Error("Missing loopback authorization cookie");
      const legacyBrowser = new Browser();
      legacyBrowser.jar.set("mcp_auth", pendingCookie);
      const legacyRetry = await st.site(first.app, `/oauth/retry?rid=${first.rid}`, { browser: legacyBrowser });
      expect((await legacyRetry.text()).includes('action="/oauth/authorize/phone"')).toBe(true);
      expect((await st.site(second.app, `/oauth/retry?rid=${first.rid}`, { browser: legacyBrowser })).status).toBe(400);
      expect((await st.site(second.app, `/oauth/retry?rid=${second.rid}`, { browser: legacyBrowser })).status).toBe(400);

      for (const { app, rid } of pending) {
        const retry = await st.site(app, `/oauth/retry?rid=${rid}`, { browser });
        expect((await retry.text()).includes('action="/oauth/authorize/phone"'), `retry in ${app}`).toBe(true);
        const cancelled = await st.site(app, "/oauth/authorize/cancel", { browser, form: { rid } });
        expect(cancelled.status).toBe(303);
      }
    }, T);

    test("OAuth with PKCE on peon.biz; check_status shows only peon; the token is refused on another site and on /mcp/openai", async () => {
      const phone = newPhone();
      const b = new Browser();
      expect((await webJoin(st, "peon", phone, { age: 40, browser: b })).res.status).toBe(200);
      expect((await webJoin(st, "slop", phone, { age: 40, browser: b })).res.status).toBe(200);
      // A fresh browser: the authorize page on peon's own domain asks for the number and the code.
      const c = await connectMcp(st, "peon", phone);
      expect(c.token?.access_token, c.html.slice(0, 300)).toEqual(expect.any(String));
      expect(new URL(c.location!).searchParams.get("iss")).toBe(st.sites.peon.origin);
      const token = c.token!.access_token as string;
      const status = toolData(await rpc(st, "peon", "/mcp", "tools/call", { name: "check_status", arguments: {} }, token));
      expect(status.app).toBe("peon");
      expect(status.status).toBe("active");
      expect(JSON.stringify(status)).not.toMatch(/slop|\+1212|"age"/);
      // Another app named in the call: refused, never answered with slop's state.
      const other = toolData(await rpc(st, "peon", "/mcp", "tools/call", { name: "check_status", arguments: { app: "slop" } }, token));
      expect(other.error ?? other.app).not.toBe("slop");
      if (!other.error) expect(other.status).toBeUndefined();
      // The same token on slop.date's /mcp and on peon's /mcp/openai: 401 (a token is bound to one resource).
      expect((await rpc(st, "slop", "/mcp", "tools/call", { name: "check_status", arguments: {} }, token)).res.status).toBe(401);
      expect((await rpc(st, "peon", "/mcp/openai", "tools/call", { name: "check_status", arguments: {} }, token)).body?.result?.isError ?? true).toBe(true);
    }, T);

    test("signed in on the site already: the authorize page skips the code; leaving the app revokes the grant", async () => {
      const phone = newPhone();
      const b = new Browser();
      expect((await webJoin(st, "friends", phone, { age: 27, browser: b })).res.status).toBe(200);
      const sent = st.otp.sent.length;
      const c = await connectMcp(st, "friends", phone, { browser: b });
      expect(c.token?.access_token, c.html.slice(0, 300)).toEqual(expect.any(String));
      expect(st.otp.sent.length).toBe(sent);
      const token = c.token!.access_token as string;
      expect(toolData(await rpc(st, "friends", "/mcp", "tools/call", { name: "check_status", arguments: {} }, token)).status).toBe("active");
      // spec/connectedAssistants.md, "A confirmed removal shows its result"
      const grants = await (await st.site("friends", "/oauth/consents", { browser: b })).text();
      const grant = /name="remove" value="([^"]+)"/.exec(grants)![1]!;
      const confirm = await (await st.site("friends", `/oauth/consents?remove=${encodeURIComponent(grant)}`, { browser: b })).text();
      const confirmation = /name="confirmation" value="([^"]+)"/.exec(confirm)![1]!;
      const post = (proof?: string) => st.site("friends", "/oauth/consents/revoke", {
        browser: b, form: { grant, ...(proof ? { confirmation: proof } : {}) },
      });
      expect(await (await post()).text()).not.toContain("Access removed.");
      expect(await (await post(confirmation)).text()).toContain("Access removed.");
      expect((await rpc(st, "friends", "/mcp", "tools/call", { name: "check_status", arguments: {} }, token)).res.status).toBe(401);

      const second = await connectMcp(st, "friends", phone, { browser: b });
      expect(second.token?.access_token).toEqual(expect.any(String));
      expect((await st.site("friends", "/api/me/delete", { browser: b, json: { scope: "app" } })).status).toBe(200);
      const after = await rpc(st, "friends", "/mcp", "tools/call", { name: "check_status", arguments: {} }, second.token!.access_token);
      expect(after.res.status).toBe(401);
    }, T);

    test("keeps an exact removal confirmation through a browser session rotation", async () => {
      const phone = newPhone();
      const { b, res } = await webJoin(st, "friends", phone, { age: 29 });
      expect(res.status).toBe(200);
      const oldCookie = b.jar.get("sid_friends");
      if (!oldCookie) throw new Error("missing verified site session");
      const justBeforeRotation = new Date(st.clock.now() - SESSION_ROTATE_MS + 1000);
      const aged = await sql`update platform.sessions set created_at=${justBeforeRotation},started_at=${justBeforeRotation}
        where app_id='friends' and e164=${phone} and revoked_at is null returning token_hash`;
      expect(aged).toHaveLength(1);

      const connection = await connectMcp(st, "friends", phone, { browser: b });
      const access = connection.token?.access_token;
      expect(access).toBeTypeOf("string");
      const list = await (await st.site("friends", "/oauth/consents", { browser: b })).text();
      const grant = /name="remove" value="([^"]+)"/.exec(list)?.[1];
      if (!grant) throw new Error("missing live grant");
      const confirm = await (await st.site("friends", `/oauth/consents?remove=${encodeURIComponent(grant)}`, { browser: b })).text();
      const confirmation = /name="confirmation" value="([^"]+)"/.exec(confirm)?.[1];
      if (!confirmation) throw new Error("missing bound confirmation");

      st.clock.advance(2000);
      expect((await st.site("friends", "/api/me", { browser: b })).status).toBe(200);
      expect(b.jar.get("sid_friends")).not.toBe(oldCookie);
      st.clock.advance(SESSION_GRACE_MS + 1);
      const staleBrowser = new Browser();
      staleBrowser.jar.set("sid_friends", oldCookie);
      const post = (browser: Browser) => st.site("friends", "/oauth/consents/revoke", { browser, form: { grant, confirmation } });
      expect((await post(staleBrowser)).status).toBe(401);
      const removed = await post(b);
      expect(removed.status).toBe(200);
      expect((await removed.text()).includes("Access removed.")).toBe(true);
      expect((await rpc(st, "friends", "/mcp", "tools/call", {name: "check_status", arguments: {}}, access)).res.status).toBe(401);
      expect(await (await post(b)).text()).not.toContain("Access removed.");
    }, T);

    test("agent-first sign-up: join on the site, connect, submit_profile reaches the member's own Network; an age in it counts (decision 10)", async () => {
      const phone = newPhone();
      const b = new Browser();
      expect((await webJoin(st, "friends", phone, { age: 27, firstName: "Ola", browser: b })).res.status).toBe(200);
      const c = await connectMcp(st, "friends", phone, { browser: b });
      const token = c.token!.access_token as string;
      expect(c.token!.scope).toContain("profile:write");
      const about = "Ola, around Fort Greene. I want people to play pickup basketball and board games with, weekday evenings. Small groups are best.";
      const r = toolData(await rpc(st, "friends", "/mcp", "tools/call", { name: "submit_profile", arguments: { about } }, token));
      expect(r).toMatchObject({ app: "friends", submitted: true });
      const m = (await memberRow("friends", phone))!;
      // Stored as the member's own inbound message, and the Network answered it like a text.
      const msgs = await sql`select direction, body, type from network.messages where member_id = ${m.id} order by ts`;
      expect(msgs.filter((x: any) => x.direction === "inbound" && x.type === "agent_profile" && x.body === "Private profile from the member's agent.")).toHaveLength(1);
      expect(msgs.some((x: any) => x.body === about)).toBe(false);
      // A phone number or a code in the profile is refused and stored nowhere.
      const bad = toolData(await rpc(st, "friends", "/mcp", "tools/call", { name: "submit_profile", arguments: { about: "text me at 212 555 0199 about games" } }, token));
      expect(bad.error).toMatch(/phone numbers, codes and email/);
      expect((await sql`select 1 from network.messages where body like ${"%555 0199%"}`).length).toBe(0);
      // A minor's age stated in the profile makes the member a minor (single-player) on every app.
      const teen = newPhone();
      const tb = new Browser();
      expect((await webJoin(st, "friends", teen, { age: 19, firstName: "Kit", browser: tb })).res.status).toBe(200);
      const tc = await connectMcp(st, "friends", teen, { browser: tb });
      expect(toolData(await rpc(st, "friends", "/mcp", "tools/call", { name: "submit_profile", arguments: { about: "Kit here, I'm 15 actually, I like drawing and chess." } }, tc.token!.access_token)).submitted).toBe(true);
      const tm = (await memberRow("friends", teen))!;
      const rt = [...st.svc.runtimes.values()].find(x => x.app.id === "friends")!;
      expect(rt.net.member(tm.id as never).minor).toBe(true);
      expect(tm.age).toBe(15);
    }, T);

    test("public OpenAI discovery lists slop.date only at the hub /mcp/slop/openai endpoint, and the slop.date site has no OpenAI surface", async () => {
      const list = toolData(await rpc(st, "ntwrk", "/mcp/openai", "tools/call", { name: "app_info", arguments: {} }));
      expect(list.apps.map((a: { id: string }) => a.id)).toEqual(["ntwrk", "peon", "friends"]);
      expect(JSON.stringify(list)).not.toMatch(/slop|dating/i);
      for (const app of ["peon", "friends"] as const) {
        const info = toolData(await rpc(st, "ntwrk", `/mcp/${app}/openai`, "tools/call", { name: "app_info", arguments: { app } }));
        expect(info.id).toBe(app);
      }
      for (const path of ["/mcp/peon/openai", "/mcp/friends/openai"]) {
        const other = await rpc(st, "ntwrk", path, "tools/list");
        expect(JSON.stringify(other.body), path).not.toMatch(/slop|dating/i);
      }
      const slopInfo = toolData(await rpc(st, "ntwrk", "/mcp/slop/openai", "tools/call", { name: "app_info", arguments: { app: "slop" } }));
      expect(slopInfo.id).toBe("slop");
      expect(JSON.stringify((await rpc(st, "ntwrk", "/mcp/slop/openai", "tools/list")).body)).toContain("slop");
      const full = toolData(await rpc(st, "ntwrk", "/mcp", "tools/call", { name: "app_info", arguments: {} }));
      expect(full.apps.map((a: { id: string }) => a.id)).toContain("slop");
      expect((await rpc(st, "slop", "/mcp/openai", "tools/list")).res.status).toBe(404);
      const meta = await st.site("peon", "/.well-known/oauth-protected-resource/mcp");
      expect(meta.status).toBe(200);
      expect(((await meta.json()) as { resource: string }).resource).toBe(`${st.sites.peon.origin}/mcp`);
    }, T);

    test("an authorize form from another site is refused, and Origin: null without Sec-Fetch-Site same-origin too", async () => {
      const reg = (await (await st.site("peon", "/oauth/register", { json: { client_name: "X", redirect_uris: ["https://client.example/callback"], token_endpoint_auth_method: "none" } })).json()) as { client_id: string };
      const b = new Browser();
      const q = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: "https://client.example/callback", code_challenge: "x".repeat(43), code_challenge_method: "S256", state: "s" });
      const html = await (await st.site("peon", `/oauth/authorize?${q}`, { browser: b })).text();
      const rid = /name="rid" value="([^"]+)"/.exec(html)![1]!;
      for (const headers of [{ origin: "https://evil.example" }, { origin: "null", "sec-fetch-site": "cross-site" }, { origin: "null" }] as Record<string, string>[]) {
        const res = await st.site("peon", "/oauth/authorize/phone", { browser: b, headers, form: { rid, phone: "+12125550190" } });
        expect(res.status, JSON.stringify(headers)).toBe(403);
      }
    });

    test("tools take no phone number and no code", async () => {
      const r = toolData(await rpc(st, "peon", "/mcp", "tools/call", { name: "start_signup", arguments: { app: "peon", phone: "+12125550188" } }));
      expect(r.error).toEqual(expect.any(String));
      const tools = (await rpc(st, "peon", "/mcp", "tools/list")).body!.result.tools as { name: string; inputSchema: { properties: Record<string, unknown> } }[];
      // submit_profile also takes the person's own approved text ("about"), which refuses phone numbers and codes;
      // get_updates takes an update reference (T-XXXXXX), never a verification code.
      const expectedProps: Record<string, string[]> = {
        submit_profile: ["app", "about"],
        get_updates: ["app", "update_token"],
        get_context: ["app", "include", "update_token"],
        set_availability: ["app", "days", "windows", "quietHours", "timezone", "notes"],
        set_red_lines: ["app", "redLines", "mode"],
        manage_domains: ["app", "enable", "disable"],
        pause_looking_for: ["app", "ref"],
        resume_looking_for: ["app", "ref"],
      };
      for (const t of tools) expect(Object.keys(t.inputSchema.properties ?? {})).toEqual(expectedProps[t.name] ?? ["app"]);
      expect(tools.map(t => t.name).sort()).toEqual(["app_info", "check_status", "get_context", "get_updates", "list_looking_for", "manage_domains", "pause_looking_for", "read_profile", "resume_looking_for", "set_availability", "set_red_lines", "start_signup", "submit_profile"]);
      for (const t of tools) expect(JSON.stringify(t.inputSchema), t.name).not.toMatch(/phone|code|otp|birth/i);
    });
  });

  describe("spoofed proxy headers", () => {
    test("straight to the backend: forged or stale x-network-proxy-* and retired x-ntwrk-proxy-* headers name no app", async () => {
      const ts = Math.floor(st.clock.now() / 1000);
      const forged: Record<string, string>[] = [
        { "x-ntwrk-proxy-ip": "203.0.113.9", "x-ntwrk-proxy-app": "slop", "x-ntwrk-proxy-ts": String(ts), "x-ntwrk-proxy-sig": "00".repeat(32), "x-forwarded-host": "slop.date" },
        { "x-network-proxy-ip": "203.0.113.9", "x-network-proxy-host": "slop.date", "x-network-proxy-ts": String(ts), "x-network-proxy-sig": "forged" },
        // A right signature with the wrong secret, and a right one that is 2 minutes old.
        { "x-network-proxy-ip": "203.0.113.9", "x-network-proxy-host": "slop.date", "x-network-proxy-ts": String(ts), "x-network-proxy-sig": await proxySignature("w".repeat(48), { method: "GET", path: "/api/app", host: "slop.date", ip: "203.0.113.9", ts }) },
        { "x-network-proxy-ip": "203.0.113.9", "x-network-proxy-host": "slop.date", "x-network-proxy-ts": String(ts - 120), "x-network-proxy-sig": await proxySignature("e2e-proxy-secret-0123456789abcdef0123456789abcdef", { method: "GET", path: "/api/app", host: "slop.date", ip: "203.0.113.9", ts: ts - 120 }) },
      ];
      for (const h of forged) {
        const res = await fetch(`${st.backendOrigin}/api/app`, { headers: h });
        expect(res.status, JSON.stringify(h)).toBe(404);
        expect(((await res.json()) as { error: string }).error).toBe("unknown_app");
        const mcp = await fetch(`${st.backendOrigin}/.well-known/oauth-authorization-server`, { headers: h });
        expect(mcp.status).toBe(404);
      }
    });

    test("through a site: a client's own proxy headers are replaced, so peon.biz stays peon", async () => {
      const ts = Math.floor(st.clock.now() / 1000);
      const res = await st.site("peon", "/api/app", { headers: { "x-network-proxy-host": "slop.date", "x-network-proxy-ip": "203.0.113.9", "x-network-proxy-ts": String(ts), "x-network-proxy-sig": "forged", "x-ntwrk-proxy-app": "slop", "x-forwarded-host": "slop.date" } });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { id: string }).id).toBe("peon");
    });
  });

  describe("minors (13-17)", () => {
    test("a 13-year-old joins friends.help and slop.date, and is never matched", async () => {
      const teen = newPhone();
      const tb = new Browser();
      const fj = await webJoin(st, "friends", teen, { age: 13, firstName: "Kai", interests: ["climbing", "board games"], browser: tb });
      expect(fj.res.status, JSON.stringify(fj.body)).toBe(200);
      expect(fj.body.membership.state).toBe("active");
      expect((await webJoin(st, "slop", teen, { age: 13, firstName: "Kai", browser: tb })).res.status).toBe(200);
      const fm = (await memberRow("friends", teen))!;
      expect(fm.age).toBe(13);
      // Adults with the same interests, so the engine has someone to propose.
      const adults: string[] = [];
      for (let i = 0; i < 4; i++) {
        const p = newPhone();
        adults.push(p);
        expect((await webJoin(st, "friends", p, { age: 25 + i, firstName: ["Ana", "Ben", "Cy", "Di"][i], interests: ["climbing", "board games"] })).res.status).toBe(200);
      }
      // Everyone says what they want on the shared line (the offline reader; no LLM key in tests).
      // Onboarding answers first (want, when and where, format), then a request of their own.
      for (const p of [...adults, teen]) {
        await st.text(p, "I want to find people to go climbing with this weekend, and to play board games.");
        await st.text(p, "Weekends mostly, I'm around Williamsburg.");
        await st.text(p, "Small groups are great.");
      }
      for (const p of [...adults, teen]) await st.text(p, "Find me someone to go bouldering with in Brooklyn this Saturday afternoon");
      const rt = [...st.svc.runtimes.values()].find(r => r.app.id === "friends")!;
      expect(rt.net.member(fm.id as never).minor).toBe(true);
      // friendsPack matches only members whose age and liveness checks passed (staff record them, PRD 40.5):
      // the adults pass; the minor is checked too, so only the age policy can keep them out.
      for (const p of [...adults, teen]) {
        const id = (await memberRow("friends", p))!.id;
        for (const check of ["age", "liveness"]) expect((await st.staff(`/apps/friends/members/${id}/verify`, { check, result: "pass", note: "e2e staff check" })).status).toBe(200);
      }
      expect((await st.staff("/apps/friends/matching", { on: true })).status).toBe(200);
      // Three daily engine runs (9:30 New York each day).
      for (let d = 0; d < 3; d++) {
        for (const r of st.svc.runtimes.values()) await r.tick();
        st.clock.advance(DAY);
      }
      st.clock.advance(HOUR);
      // The engine proposed among the adults (the test fails if nothing was proposed: a run with no
      // proposals proves nothing about the minor), and the minor is in none of it.
      const opps = await sql<{ id: string; parts: string[] }[]>`select o.id, array_agg(p.member_id) as parts from network.opportunities o join network.participations p on p.app_id = o.app_id and p.opportunity_id = o.id where o.app_id = 'friends' group by o.id`;
      expect(opps.length).toBeGreaterThan(0);
      // The engine's own input never holds the minor (packInput drops minors before any pack runs).
      const input = rt.net.packInput(st.clock.now());
      expect(input.members.map(m => m.id)).not.toContain(fm.id);
      expect(input.members.length).toBeGreaterThanOrEqual(adults.length);
      for (const o of opps) expect(o.parts).not.toContain(fm.id);
      expect((await sql`select 1 from network.participations where member_id = ${fm.id}`).length).toBe(0);
      const sm = (await memberRow("slop", teen))!;
      expect((await sql`select 1 from network.participations where member_id = ${sm.id}`).length).toBe(0);
      // No text to the minor names another member or proposes anyone.
      const toTeen = (await sql`select body from network.messages where member_id = ${fm.id} and direction = 'outbound'`).map((r: any) => r.body as string);
      for (const name of ["Ana", "Ben", "Cy", "Di"]) for (const body of toTeen) expect(body).not.toContain(name);
    }, T);

    test("minors cannot upload photos (adults_only at the age gate, with an adult control); no MCP tool takes one; none is stored", async () => {
      // A real (small) PNG with the current photo consent: before the fix this test sent a 4-byte body, so a
      // 4xx from photos_off, json_required or bad_image passed it whether or not the age gate worked.
      const chunk = (type: string, data: Uint8Array) => { const o = new Uint8Array(12 + data.length); o.set([0, 0, data.length >> 8, data.length & 0xff]); o.set(new TextEncoder().encode(type), 4); o.set(data, 8); return o; };
      const png = () => { const parts = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", new Uint8Array(13)), chunk("IDAT", new TextEncoder().encode("PIXELS")), chunk("IEND", new Uint8Array(0))];
        const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
      const upload = (b: Browser) => st.site("slop", "/api/photos", { browser: b, method: "POST", body: png(), headers: { "content-type": "image/png", "x-photo-consent": PHOTO_CONSENT.version } });
      const teen = newPhone(), adult = newPhone();
      const tb = new Browser(), ab = new Browser();
      expect((await webJoin(st, "slop", teen, { age: 15, browser: tb })).res.status).toBe(200);
      expect((await webJoin(st, "slop", adult, { age: 29, browser: ab })).res.status).toBe(200);
      const refused = await upload(tb);
      expect([refused.status, ((await refused.json()) as { error: string }).error]).toEqual([403, "adults_only"]);
      // Photo API eligibility remains restricted to adult members.
      const listOf = async (b: Browser) => (await st.site("slop", "/api/photos", { browser: b })).json() as Promise<{ eligible: boolean; photos: unknown[] }>;
      expect(await listOf(tb)).toMatchObject({ eligible: false, photos: [] });
      expect((await listOf(ab)).eligible).toBe(true);
      // The control: the same request from an adult is stored (no ID check, founder decision 9).
      const ok = await upload(ab);
      expect(ok.status, await ok.clone().text()).toBe(200);
      const tools = (await rpc(st, "slop", "/mcp", "tools/list")).body!.result.tools as { name: string; inputSchema: { properties: Record<string, unknown> } }[];
      expect(tools.some(t => /image|upload/i.test(t.name))).toBe(false);
      const photoTools = tools.filter(t => /photo/i.test(t.name));
      expect(photoTools.map(t => [t.name, Object.keys(t.inputSchema.properties)])).toEqual([["my_photos", ["app"]], ["photo_request", ["app", "words"]]]);
      for (const t of photoTools) expect(JSON.stringify(t.inputSchema), t.name).not.toMatch(/image|upload|base64|"format"|contentEncoding/i);
      const personOf = async (p: string) => (await sql`select person_id from platform.phone_identities where e164 = ${p}`)[0]!.person_id;
      expect((await sql`select 1 from platform.photos where person_id = ${await personOf(teen)}`).length).toBe(0);
      expect((await sql`select 1 from platform.photos where person_id = ${await personOf(adult)}`).length).toBe(1);
      const sm = (await memberRow("slop", teen))!;
      expect((await sql`select 1 from network.facets where member_id = ${sm.id} and (kind ilike '%photo%' or value ilike '%photo%')`).length).toBe(0);
    }, T);
  });
});
