import { beforeAll,afterAll,test,expect } from "bun:test";
import { SQL } from "bun";
import { randomUUID } from "node:crypto";
import { devPgUp,DEV_PG_PORT } from "../../observatory/db/dev-pg.ts";
import { PgOAuthStore } from "../src/pg-store.ts";
import { setup,addMember,connect,call,tokenRequest,PHONE_A } from "./harness.ts";
import type { Grant,Token } from "../src/store.ts";

const base=`postgres://${process.env.USER}@localhost:${DEV_PG_PORT}`,db=`cloud_oauth_${process.pid}`;
let store:PgOAuthStore;
beforeAll(async()=>{await devPgUp();const admin=new SQL(`${base}/postgres`);await admin.unsafe(`create database ${db}`);await admin.close();store=new PgOAuthStore(`${base}/${db}`);await store.migrate();});
afterAll(async()=>{await store.close();const admin=new SQL(`${base}/postgres`);await admin.unsafe(`drop database ${db}`);await admin.close();});

test("Cloud OAuth grants persist authority across issuance/refresh and deny revoke, tamper and missing authority",async()=>{
 const env=setup({store});const person=await addMember(env,PHONE_A,[{app:"friends",state:"active"}]);
 let live=true,checks=0;const hooks=(env.handler as unknown);void hooks;
 // Actual OAuth HTTP/store pipeline; controlled Cloud authority is independently exercised through the producer/consumer join.
 const { platformHooks }=await import("../src/hooks.ts");const { APPS }=await import("@thenetwork/platform");
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
 await Promise.all([store.revokeGrant(id,at+1),store.rotateRefresh(refresh.hash,at+1,pair,{at:at+1,kind:"token_refreshed",clientId:client.id,grantId:id,app:g.app,detail:null})]);
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
 let pending:Promise<"rotated"|"replay"|"stale">|undefined;
 await store.sql.begin(async tx=>{await tx`select id from oauth.grants where id=${id} for update`;
 pending=store.rotateRefresh(old.hash,at,pair,{at,kind:"token_refreshed",clientId,grantId:id,app:"friends",detail:null});await Bun.sleep(150);});
 expect(await pending).toBe("stale");expect(await store.getToken(pair[0].hash)).toBeUndefined();expect((await store.getToken(old.hash))?.rotatedAt).toBeNull();
});
