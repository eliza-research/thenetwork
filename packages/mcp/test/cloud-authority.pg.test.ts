import { setTimeout as sleep } from "node:timers/promises";
import { beforeAll,afterAll,test,expect } from "vitest";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { randomUUID } from "node:crypto";
import { devPgUp,DEV_PG_PORT } from "../../observatory/db/dev-pg.ts";
import { PgOAuthStore } from "../src/pg-store.ts";
import { setup,addMember,connect,call,tokenRequest,PHONE_A } from "./harness.ts";
import { platformHooks } from "../src/hooks.ts";
import { APPS } from "@thenetwork/platform";
import type { Grant,RefreshRotation,Token } from "../src/store.ts";

const base=`postgres://${process.env.USER}@localhost:${DEV_PG_PORT}`,db=`cloud_oauth_${process.pid}`;
let store:PgOAuthStore;
beforeAll(async()=>{await devPgUp();const admin=new SQL(`${base}/postgres`);await admin.unsafe(`create database ${db}`);await admin.close();store=new PgOAuthStore(`${base}/${db}`);await store.migrate();});
afterAll(async()=>{await store.close();const admin=new SQL(`${base}/postgres`);await admin.unsafe(`drop database ${db}`);await admin.close();});

test("Cloud OAuth grants persist authority across issuance/refresh and deny revoke, tamper and missing authority",async()=>{
 const env=setup({store});const person=await addMember(env,PHONE_A,[{app:"friends",state:"active"}]);
 let live=true,checks=0;const hooks=(env.handler as unknown);void hooks;
 // Actual OAuth HTTP/store pipeline; controlled Cloud authority is independently exercised through the producer/consumer join.
 const platform=platformHooks({store:env.people,otp:env.otp,accounts:env.accounts,sessions:env.sessions,app:id=>APPS[id],cookieName:id=>`sid_${id}`});
 const authority={version:1 as const,app:"friends" as const,resource:"https://friends.help/mcp",phoneKey:env.accounts.phoneHash(PHONE_A),issuedAt:Math.floor(env.clock.t/1000)-100,expiresAt:env.clock.t+60_000,sealed:"controlled-sealed-authority-fixture"};
 const e=setup({store,platform:{...platform,cloudAuthorityRequired:()=>true,
   session:async()=>live?{e164:PHONE_A,personId:person}:undefined,
   cloudGrantAuthority:async()=>live?authority:undefined,
   validateCloudGrant:async grant=>{checks++;return live&&!!grant.cloudAuthority&&Object.entries(authority).every(([key,value])=>grant.cloudAuthority![key as keyof typeof authority]===value)?"valid":"invalid";}}});
 e.clock.t=env.clock.t;
 const c=await connect(e,"friends.help",PHONE_A,{cookie:"sid_friends=server-session"});
 expect(c.token.access_token).toBeDefined();
 const [row]=await store.sql`select * from oauth.grants where client_id=${c.client.client_id}`;
 expect(row.id.startsWith("grant_cloud_")).toBe(true);expect(row.cloud_authority).toEqual(authority);expect(row.expires_at.getTime()).toBe(authority.expiresAt);
 expect((await call(e,"https://friends.help/mcp","check_status",{app:"friends"},{token:c.token.access_token})).res.status).toBe(200);
 const refreshed=await tokenRequest(e,"friends.help",{grant_type:"refresh_token",refresh_token:c.token.refresh_token,client_id:c.client.client_id});
 expect(refreshed.res.status).toBe(200);expect(refreshed.body.expires_in).toBeLessThanOrEqual(60);
 expect((await store.getGrant(row.id))?.cloudAuthority).toEqual(authority);
 await expect(Promise.resolve(store.sql`update oauth.grants set cloud_authority=null where id=${row.id}`)).rejects.toThrow();
 await expect(Promise.resolve(store.sql`update oauth.grants set resource='https://slop.date/mcp' where id=${row.id}`)).rejects.toThrow();
 await expect(Promise.resolve(store.sql`update oauth.grants set id=${`grant_legacy_${randomUUID()}`} where id=${row.id}`)).rejects.toThrow();
 live=false;
 expect((await call(e,"https://friends.help/mcp","check_status",{app:"friends"},{token:refreshed.body.access_token})).res.status).toBe(401);
 expect((await tokenRequest(e,"friends.help",{grant_type:"refresh_token",refresh_token:refreshed.body.refresh_token,client_id:c.client.client_id})).res.status).toBe(400);
 live=true;e.clock.t=authority.expiresAt;
 expect((await call(e,"https://friends.help/mcp","check_status",{app:"friends"},{token:refreshed.body.access_token})).res.status).toBe(401);
 expect(checks).toBeGreaterThanOrEqual(5);
 const legacy={id:`grant_legacy_${randomUUID()}`,clientId:c.client.client_id,app:"friends" as const,phoneKey:authority.phoneKey,personId:person,scopes:["membership:read" as const],resource:authority.resource,createdAt:e.clock.t,expiresAt:e.clock.t+60_000,revokedAt:null};
 await store.putGrant(legacy);expect((await store.getGrant(legacy.id))?.cloudAuthority).toBeUndefined();
 const nonPrefixed={...legacy,id:`grant_imported_${randomUUID()}`,cloudAuthority:authority};await store.putGrant(nonPrefixed);
 await expect(Promise.resolve(store.sql`update oauth.grants set cloud_authority=null where id=${nonPrefixed.id}`)).rejects.toThrow();
 await expect(store.putGrant({...legacy,id:`grant_cloud_${randomUUID()}`})).rejects.toThrow();
});

// spec/connectedAssistants.md, "The page lists live grants only for a signed-in session"
test("the connected-assistant page checks live Cloud authority and retains a completed removal during an outage", async () => {
  const base = setup({ store });
  const phone = "+12125550194", host = "https://friends.help";
  const personId = await addMember(base, phone, [{ app: "friends", state: "active" }]);
  const platform = platformHooks({ store: base.people, otp: base.otp, accounts: base.accounts, sessions: base.sessions,
    app: id => APPS[id], cookieName: id => `sid_${id}` });
  const authority = { version: 1 as const, app: "friends" as const, resource: `${host}/mcp`, phoneKey: base.accounts.phoneHash(phone),
    issuedAt: Math.floor(base.clock.t / 1000), expiresAt: base.clock.t + 60_000, sealed: "connected-assistants-fixture" };
  const verdicts = new Map<string, "valid" | "invalid" | "unavailable">();
  let sessionUnavailable = false;
  const env = setup({ store, log: () => {}, platform: { ...platform, cloudAuthorityRequired: () => true,
    async session(app, req, host) {
      if (sessionUnavailable) throw new Error("Session store unavailable");
      return platform.session?.(app, req, host);
    },
    async cloudGrantAuthority() { return authority; },
    async validateCloudGrant(grant) { return verdicts.get(grant.id) ?? "valid"; },
  } });
  const session = await base.sessions.create("friends", phone, personId);
  const cookie = `sid_friends=${session.token}`;
  const first = await connect(env, "friends.help", phone, { cookie, register: { client_name: "Departed Assistant" } });
  const second = await connect(env, "friends.help", phone, { cookie, register: { client_name: "Current Assistant" } });
  expect([first.tokenRes.status, second.tokenRes.status]).toEqual([200, 200]);
  const grants = await store.grantsFor(authority.phoneKey, "friends", env.clock.t);
  const departed = grants.find(grant => grant.clientId === first.client.client_id);
  const current = grants.find(grant => grant.clientId === second.client.client_id);
  if (!departed || !current) throw new Error("Expected two browser-approved grants");
  const page = (suffix = "") => env.fetch(new Request(`${host}/oauth/consents${suffix}`, { headers: { cookie } }));
  expect(await (await page()).text()).toContain("Departed Assistant");

  verdicts.set(departed.id, "invalid");
  const active = await (await page(`?remove=${departed.id}`)).text();
  expect(active).toContain("Current Assistant");
  expect(active.includes("Departed Assistant")).toBe(false);
  expect(active).not.toContain('name="confirmation"');
  const form = await (await page(`?remove=${current.id}`)).text();
  const confirmation = /name="confirmation" value="([^"]+)"/.exec(form)?.[1];
  if (!confirmation) throw new Error("Expected the exact removal confirmation");

  verdicts.set(departed.id, "unavailable");
  const uncertain = await page();
  expect(uncertain.status).toBe(503);
  expect(await uncertain.text()).toContain('href="/oauth/consents"');
  const removed = await env.fetch(new Request(`${host}/oauth/consents/revoke`, {
    method: "POST", headers: { cookie, origin: host, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant: current.id, confirmation }),
  }));
  expect(removed.status).toBe(200);
  expect(await removed.text()).toContain("Access removed.");
  expect(await store.getGrant(current.id)).toMatchObject({ revokedAt: env.clock.t });
  expect(await store.getGrant(departed.id)).toMatchObject({ revokedAt: null });

  sessionUnavailable = true;
  const failedSession = await page();
  expect(failedSession.status).toBe(503);
  expect(await failedSession.text()).toContain("Please try again");
});

test("Cloud grant consent scopes cannot expand or shrink while legacy grants remain editable",async()=>{
 const at=Date.now(),clientId=randomUUID();
 await store.putClient({id:clientId,secretHash:null,name:"scope fixture",redirectUris:["https://client.example/callback"],authMethod:"none",app:"friends",surface:"full",kind:"dcr",createdAt:at});
 const base:Grant={id:`grant_legacy_${randomUUID()}`,clientId,app:"friends",phoneKey:"scope-fixture-key",personId:randomUUID(),scopes:["membership:read"],resource:"https://friends.help/mcp",createdAt:at,expiresAt:at+60_000,revokedAt:null};
 const authority={version:1 as const,app:"friends" as const,resource:base.resource,phoneKey:base.phoneKey,issuedAt:Math.floor(at/1000),expiresAt:base.expiresAt,sealed:"synthetic-scope-authority"};
 for(const id of [`grant_cloud_${randomUUID()}`,`grant_imported_${randomUUID()}`]){
  await store.putGrant({...base,id,cloudAuthority:authority});
  await expect(Promise.resolve(store.sql`update oauth.grants set scopes=array['membership:read','profile:write'] where id=${id}`)).rejects.toThrow("Cloud grant authority is immutable");
  await expect(Promise.resolve(store.sql`update oauth.grants set scopes=array[]::text[] where id=${id}`)).rejects.toThrow("Cloud grant authority is immutable");
  expect((await store.getGrant(id))?.scopes).toEqual(base.scopes);
 }
 await store.putGrant(base);
 await store.sql`update oauth.grants set scopes=array['membership:read','profile:write'] where id=${base.id}`;
 expect((await store.getGrant(base.id))?.scopes).toEqual(["membership:read","profile:write"]);
});

test("refresh serialization respects concurrent grant revoke and preserves sealed authority",async()=>{
 const at=Date.now(),id=`grant_cloud_${randomUUID()}`;
 const client={id:randomUUID(),secretHash:null,name:"fixture",redirectUris:["https://client.example/callback"],authMethod:"none" as const,app:"friends" as const,surface:"full" as const,kind:"dcr" as const,createdAt:at};await store.putClient(client);
 const g:Grant={id,clientId:client.id,app:"friends",phoneKey:"fixture-key",personId:randomUUID(),scopes:["membership:read"],resource:"https://friends.help/mcp",createdAt:at,expiresAt:at+60_000,revokedAt:null,
 cloudAuthority:{version:1,app:"friends",resource:"https://friends.help/mcp",phoneKey:"fixture-key",issuedAt:Math.floor(at/1000),expiresAt:at+60_000,sealed:"fixture"}};await store.putGrant(g);
 const refresh:Token={hash:randomUUID(),kind:"refresh",grantId:id,clientId:client.id,app:g.app,resource:g.resource,scopes:g.scopes,createdAt:at,expiresAt:g.expiresAt,revokedAt:null,rotatedAt:null};await store.putToken(refresh);
 const pair:[Token,Token]=[{...refresh,hash:randomUUID(),kind:"access"},{...refresh,hash:randomUUID()}];
 await Promise.all([store.revokeGrant(id,at+1),store.rotateRefresh({refresh,grant:g,tokens:pair,now:()=>at+1,
  audit:{kind:"token_refreshed",clientId:client.id,grantId:id,app:g.app,detail:null}})]);
 expect((await store.getGrant(id))?.revokedAt).toBe(at+1);
 for(const token of pair){const r=await store.getToken(token.hash);expect(!r||r.revokedAt!==null).toBe(true);}
 expect((await store.getGrant(id))?.cloudAuthority).toEqual(g.cloudAuthority);
});

test("refresh waiting on the grant lock cannot publish tokens after the original authority expires",async()=>{
 const at=Date.now(),id=`grant_cloud_${randomUUID()}`,clientId=randomUUID(),expiresAt=at+120;
 await store.putClient({id:clientId,secretHash:null,name:"fixture",redirectUris:["https://client.example/callback"],authMethod:"none",app:"friends",surface:"full",kind:"dcr",createdAt:at});
 const grant:Grant={id,clientId,app:"friends",phoneKey:"fixture-key",personId:randomUUID(),scopes:["membership:read"],resource:"https://friends.help/mcp",createdAt:at,expiresAt,revokedAt:null,
 cloudAuthority:{version:1,app:"friends",resource:"https://friends.help/mcp",phoneKey:"fixture-key",issuedAt:Math.floor(at/1000),expiresAt,sealed:"fixture"}};await store.putGrant(grant);
 const old:Token={hash:randomUUID(),kind:"refresh",grantId:id,clientId,app:"friends",resource:grant.resource,scopes:grant.scopes,createdAt:at,expiresAt,revokedAt:null,rotatedAt:null};await store.putToken(old);
 const pair:[Token,Token]=[{...old,hash:randomUUID(),kind:"access"},{...old,hash:randomUUID()}];
 let pending:ReturnType<typeof store.rotateRefresh>|undefined;
 const rotation:RefreshRotation={refresh:old,grant,tokens:pair,now:Date.now,
  audit:{kind:"token_refreshed",clientId,grantId:id,app:"friends",detail:null}};
 await store.sql.begin(async tx=>{await tx`select id from oauth.grants where id=${id} for update`;
 pending=store.rotateRefresh(rotation);await sleep(150);});
 expect(await pending).toBe("RefreshNotCommitted");expect(await store.getToken(pair[0].hash)).toBeUndefined();expect((await store.getToken(old.hash))?.rotatedAt).toBeNull();
});
