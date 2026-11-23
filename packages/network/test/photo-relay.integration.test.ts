import {afterAll,beforeAll,expect,test} from "vitest";
import {serveHttp,type HttpServer} from "../../core/src/runtime/http.ts";
import {SQL} from "../../core/src/runtime/postgres.ts";
import {DAY,HOUR,MINUTE,SimClock} from "@thenetwork/core";
import {dropTestDb,pgAvailable,testDb} from "../../observatory/test/pg.ts";
import {TURN_PATH,type TurnRequest} from "../../core/src/svc/contract.ts";
import {svcSign,svcVerify} from "../../core/src/svc/svc-auth.ts";
import {CloudChannelAdapter} from "../service/cloud-channel.ts";
import {NetworkService} from "../service/service.ts";
import type {NetworkState} from "../src/network.ts";
import {PHOTO_CONSENT,type PhotoStorage} from "../../platform/src/photos.ts";
import {simulatedPhotoScreen} from "../../platform/src/photo-screen.ts";
import {PhotoPages,PHOTO_PAGE_COOKIE} from "../../platform/src/photo-pages.ts";
import {PgAudit} from "../../observatory/src/staff.ts";
import type {AuditEntry} from "../../observatory/src/types.ts";

const secret="synthetic-photo-relay-signing-secret-20261122",start=Date.UTC(2026,10,22,17),clock=new SimClock(start);
const staffToken="synthetic-photo-relay-safety-token-20261122",reviewerToken="synthetic-photo-relay-reviewer-token-20261122";
const phones={ari:"+12125550301",maya:"+12125550302",jordan:"+12125550303",teo:"+12125550304",nia:"+12125550305",omar:"+12125550306",
  lee:"+12125550307",kim:"+12125550308",rosa:"+12125550309",tao:"+12125550310",sam:"+12125550311",una:"+12125550312"} as const;
type Who=keyof typeof phones;
let url:string,sql:SQL,service:NetworkService,server:HttpServer,cloud:HttpServer,seq=0,storageReads=0,failPreviewAudit=false,screenMode:"clean"|"flagged"|"down"="clean",screenCalls=0;
const people:Record<Who,{personId:string;memberId:string}>={} as never;
const photoBytes=new Map<string,Uint8Array>();
const photoStorage:PhotoStorage={kind:"local",put:async(k,bytes)=>{photoBytes.set(k,bytes.slice());},get:async k=>{storageReads++;return photoBytes.get(k);},delete:async k=>{photoBytes.delete(k);}};
const midday=()=>clock.advance((DAY-(clock.now()-start)%DAY)%DAY);

const post=async(path:string,body:object,id:string)=>{
  const raw=JSON.stringify(body);
  return fetch(new URL(path,server.url),{method:"POST",body:raw,headers:{"content-type":"application/json",...await svcSign(secret,{method:"POST",path,id,body:raw,nowS:Math.floor(clock.now()/1000)})}});
};
const turn=(who:Who,messageId:string,text:string):TurnRequest=>({channel:"blooio",from:phones[who],to:null,messageId,text,receivedAt:clock.now(),transport:"imessage",app:"slop"});
const say=async(who:Who,text:string,messageId=`photo-turn-${++seq}`)=>{
  clock.advance(MINUTE);
  const request=turn(who,messageId,text);
  const r=await post(TURN_PATH,request,messageId);expect(r.status).toBe(200);
  const body=await r.json() as {outcome:string;replies?:string[]};
  return {...body,messageId,request,reply:(body.replies??[]).join(" ")};
};
const join=async(who:Who,name:string,age:number)=>{
  for(const text of ["slop.date",`${name}, ${age}`,"I enjoy hiking and cooking","Saturday afternoons work for me","Small groups are good"]) await say(who,text);
  const person=(await service.accounts.personFor(phones[who]))!;
  people[who]={personId:person.id,memberId:(await service.people.getMembership(person.id,"slop"))!.memberId};
};
const pair=async(threadId:string,x:Who,y:Who)=>service.runtimeFor("slop")!.unitOfWork(n=>{
  const st=n.exportState(),now=clock.now(),ids=[people[x].memberId,people[y].memberId];st.opps=st.opps.filter(op=>op.id!==threadId);
  st.opps.push({id:threadId,origin:"engine",kind:"intro",category:"social",objective:"coffee",detail:"coffee",participants:ids,alternates:[],primed:[],status:ids.map(id=>[id,"yes"]),explanations:{},stage:"scheduled",deadline:now+60*DAY,createdAt:now,score:.8,generator:"fixture",components:{fit:0,mutualBenefit:0,warmPath:0,novelty:0,timingFit:0,activationCost:0,interruptionCost:0,load:0,repetition:0,socialRisk:0,confidence:0},exploration:false,review:{queuedAt:now,deadline:now+60*DAY,decision:"approve",approver:"staff",reviewer:"fixture"},sameDay:false,contacted:ids,reminded:[],feedbackFrom:[],tags:[],replacements:0} as NetworkState["opps"][number]);
  n.importState(st);
});
const upload=async(who:Who,n:number)=>{
  clock.advance(MINUTE);
  const r=await service.photos.upload(people[who].personId,"slop",Uint8Array.from([255,216,255,218,0,2,n,255,217]),PHOTO_CONSENT.version);
  if(!r.ok)throw Error(JSON.stringify(r));return r.value.id;
};
const offers=async(from:Who,to:Who)=>(await sql`select id,phase from platform.photo_offers where app_id='slop'
  and sender_person_id=${people[from].personId}::uuid and recipient_person_id=${people[to].personId}::uuid order by created_at,id` as {id:string;phase:string}[]).map(r=>({id:r.id,phase:r.phase}));
const messages=async(who:Who,prefix:string)=>(await sql`select id,body from network.messages where app_id='slop' and member_id=${people[who].memberId}
  and direction='outbound' and id like ${`${prefix}%`} order by ts,id` as {id:string;body:string}[]).map(r=>({id:r.id,body:r.body}));
const items=async(offerId:string)=>(await sql`select id,state from platform.photo_relay_items where offer_id=${offerId} order by id` as {id:string;state:string}[]).map(r=>({id:r.id,state:r.state}));
const askOf=async(offerId:string)=>`photo-ask:${(await sql`select request_key from platform.photo_offers where id=${offerId}`)[0]!.request_key as string}`;

beforeAll(async()=>{
  if(!pgAvailable)return;
  url=await testDb();sql=new SQL({url,max:4});
  cloud=await serveHttp({hostname:"127.0.0.1",port:0,fetch:async req=>{
    const path=new URL(req.url).pathname,raw=await req.text(),auth=await svcVerify(secret,{method:req.method,path,headers:req.headers,body:raw,nowS:Math.floor(clock.now()/1000)});
    expect(auth.ok).toBe(true);const input=JSON.parse(raw);
    return Response.json({ok:true,replayed:false,providerMessageIds:[`owned:${input.id}`],acceptedAt:new Date(clock.now()).toISOString(),history:true});
  }});
  const audit=new PgAudit(url);
  service=new NetworkService({url,clock,photoStorage,tokens:`safety@slop:${staffToken},reviewer@slop:${reviewerToken}`,env:{PLATFORM_ENV:"dev",SERVICE_TURN_SECRET:secret},
    audit:{kind:audit.kind,list:q=>audit.list(q),close:()=>audit.close(),write:async(entry:AuditEntry)=>{
      if(failPreviewAudit&&entry.action==="read_relay_photo"&&entry.detail?.phase==="requested")throw Error("synthetic preview audit write failure");
      await audit.write(entry);
    }},
    networks:[{id:"slop:nyc",matchingEnabled:false}],log:()=>{},relayClassifier:async()=>({flags:[],source:"clef" as const}),
    photoScreen:simulatedPhotoScreen(()=>{screenCalls++;return screenMode==="clean"?{kind:"answered",riskPerMille:0}:screenMode==="flagged"?{kind:"answered",riskPerMille:800}:{kind:"unanswered"};}),
    adapter:(_net,rt)=>new CloudChannelAdapter({app:rt.app.id,clock,city:rt.city,from:"+12125550300",origin:cloud.url.origin,secret,env:{PLATFORM_ENV:"dev"}})});
  await service.start();server=await serveHttp({hostname:"127.0.0.1",port:0,fetch:req=>service.fetch(req)});
  await join("ari","Ari",29);await join("maya","Maya",29);await join("jordan","Jordan",31);
  await pair("photo-ari-maya","ari","maya");await pair("photo-ari-jordan","ari","jordan");
  await upload("ari",1);await upload("ari",2);
},180_000);
afterAll(async()=>{await server?.stop(true);await service?.close();await cloud?.stop(true);await sql?.close();await dropTestDb();});

test.skipIf(!pgAvailable)("a sender names a photo in their own words, sees exactly what would go, and only a YES to that proposal offers it",async()=>{
  expect((await say("ari","call photo 1 beach")).reply).toBe('Done. Photo 1 is now "beach".');
  const proposed=await say("ari","send Maya the beach one");
  expect(proposed.outcome).toBe("handled");
  expect(proposed.reply).toContain('Send Maya photo 1 "beach"');
  expect(proposed.reply).toMatch(/https:\/\/[^ ]+\/photos\/check#[A-Za-z0-9_-]{20,}/);
  expect(proposed.reply).toContain("Reply YES to send it");
  expect(await offers("ari","maya")).toEqual([]);
  await service.runtimeFor("slop")!.unitOfWork(n=>{n.photoNotice(people.ari.memberId as never,"photo-fixture-later-prompt","Are you free on Saturday afternoon?","info");});
  clock.advance(MINUTE);
  const stale=await say("ari","yes");
  expect(stale.reply).not.toContain("I'll ask Maya");
  expect(await offers("ari","maya")).toEqual([]);
  await say("ari","send Maya the beach one");
  const yes=await say("ari","yes");
  expect(yes.outcome).toBe("handled");
  expect(yes.reply).toBe("Okay. I'll ask Maya if they want it. An automatic check screens it first. I'll tell you if it doesn't go.");
  const [offer]=await offers("ari","maya");
  expect(offer).toMatchObject({phase:"asking"});
  const asks=await messages("maya","photo-ask:");
  expect(asks).toEqual([{id:await askOf(offer!.id),body:"Ari wants to send you a photo. An automatic check screens every photo first. Want it? Reply YES or NO. If you say no, Ari isn't told why. Say NO MORE PHOTOS any time and I won't offer you photos again."}]);
  expect(await items(offer!.id)).toEqual([]);
  clock.advance(MINUTE);
  const replayed=await post(TURN_PATH,yes.request,yes.messageId);
  expect(replayed.status).toBe(200);
  expect((await replayed.json() as {replies?:string[]}).replies).toEqual(yes.replies);
  expect(await offers("ari","maya")).toHaveLength(1);
},120_000);

test.skipIf(!pgAvailable)("a changed photo set or a lapsed proposal never becomes consent",async()=>{
  const proposed=await say("ari","send Jordan photo 2");
  expect(proposed.reply).toContain("Send Jordan photo 2");
  const second=(await service.photos.rows(people.ari.personId,"slop")).sort((x,y)=>x.createdAt-y.createdAt)[1]!;
  expect(await service.photos.remove(people.ari.personId,"slop",second.id)).toBe(true);
  const changed=await say("ari","yes");
  expect(changed.reply.startsWith("Your photos changed since I asked.")).toBe(true);
  expect(await offers("ari","jordan")).toEqual([]);
  await upload("ari",3);
  expect((await say("ari","send Jordan photo 2")).reply).toContain("Send Jordan photo 2");
  clock.advance(15*MINUTE);
  expect((await say("ari","yes")).reply).toBe("That choice timed out, so I sent nothing. Tell me which photo again.");
  expect(await offers("ari","jordan")).toEqual([]);
},120_000);

test.skipIf(!pgAvailable)("the receiver is asked first: a no looks like a lapse to the sender, and after a yes the automatic check releases a clean photo at once with one view link",async()=>{
  const [first]=await offers("ari","maya");
  expect((await say("maya","no")).reply).toBe("Okay, I won't show it. Ari isn't told why.");
  expect((await offers("ari","maya"))[0]).toEqual({id:first!.id,phase:"declined"});
  await service.tick();
  expect(await messages("ari",`photo-notice:${first!.id}`)).toEqual([]);
  await say("ari","send Maya the beach one");
  expect((await say("ari","yes")).reply).toBe("Maya hasn't answered your last photo yet. You can offer another after that.");
  clock.advance(DAY);await service.tick();
  expect(await messages("ari",`photo-notice:${first!.id}`)).toEqual([{id:`photo-notice:${first!.id}`,body:"Maya didn't take your photo, so it stays with you."}]);
  await say("ari","send Maya the beach one");
  expect((await say("ari","yes")).reply).toMatch(/^You can offer Maya another photo after [A-Z][a-z]{2} \d{1,2}:\d{2} [AP]M\.$/);
  clock.advance(3*DAY+HOUR);await service.tick();
  await say("ari","send Maya the beach one");
  expect((await say("ari","yes")).reply).toContain("I'll ask Maya if they want it.");
  const second=(await offers("ari","maya")).at(-1)!;
  expect(second.phase).toBe("asking");
  expect((await messages("maya","photo-ask:")).at(-1)).toEqual({id:await askOf(second.id),body:"Ari wants to send you a photo. An automatic check screens every photo first. Want it? Reply YES or NO. If you say no, Ari isn't told why."});
  const calls=screenCalls;
  expect((await say("maya","yes")).reply).toBe("Okay. I'll text you a private link after the check.");
  expect(screenCalls).toBe(calls+1);
  expect((await items(second.id)).map(x=>x.state)).toEqual(["approved"]);
  expect((await offers("ari","maya")).at(-1)).toEqual({id:second.id,phase:"ready"});
  expect((await service.photoRelay.held("slop")).filter(h=>h.offerId===second.id)).toEqual([]);
  const ready=await messages("maya",`photo-ready:${second.id}`);
  expect(ready).toHaveLength(1);
  expect(ready[0]!.body).toMatch(/^Ari's photo is ready: https:\/\/[^ ]+\/photos\/view#[A-Za-z0-9_-]{43} It opens only on the first phone you open it on, until Ari takes it back\. Text PHOTO LINK for a new link\. Reply REPORT if it's not okay\.$/);
  expect(ready[0]!.body).not.toContain("24 hours");
  await service.tick();
  expect(await messages("ari",`photo-notice:${second.id}`)).toEqual([{id:`photo-notice:${second.id}`,body:"Your photo is on its way to Maya. I can't tell you if they open it."}]);
  expect((await sql`select 1 from information_schema.columns where table_schema='platform' and table_name='outbound' and column_name='approved_photos'`).length).toBe(0);
  expect(JSON.stringify(await sql`select body from network.messages where app_id='slop'`)).not.toMatch(/ph_[a-f0-9]{24}/);
},180_000);

test.skipIf(!pgAvailable)("a minor receiver is never offered a photo, and a STOP while asked ends the offer without a second ask",async()=>{
  await join("teo","Teo",16);await pair("photo-ari-teo","ari","teo");
  const toMinor=await say("ari","send Teo the beach one");
  expect(toMinor.outcome).toBe("handled");
  expect(toMinor.reply).not.toContain("/photos/check");
  expect(await offers("ari","teo")).toEqual([]);
  expect(await messages("teo","photo-")).toEqual([]);
  expect((await say("teo","my photos")).reply).toBe("I can't send photos here.");
  await join("nia","Nia",30);await pair("photo-ari-nia","ari","nia");
  await say("ari","send Nia the beach one");
  expect((await say("ari","yes")).reply).toContain("I'll ask Nia if they want it.");
  const [offer]=await offers("ari","nia");
  expect(offer!.phase).toBe("asking");
  await say("nia","STOP");
  clock.advance(MINUTE);await service.tick();
  expect((await offers("ari","nia"))[0]).toEqual({id:offer!.id,phase:"ended"});
  clock.advance(DAY);await service.tick();
  expect(await messages("nia","photo-ask:")).toHaveLength(1);
  expect(await messages("ari",`photo-notice:${offer!.id}`)).toEqual([{id:`photo-notice:${offer!.id}`,body:"Nia didn't take your photo, so it stays with you. Reply STOP anytime to opt out."}]);
},180_000);

test.skipIf(!pgAvailable)("NO MORE PHOTOS silences every later offer, and two unopened offers turn photos off for the pair",async()=>{
  await join("omar","Omar",33);await pair("photo-ari-omar","ari","omar");
  expect((await say("omar","no more photos")).reply).toBe("Done. I won't offer you photos from matches. Say PHOTOS OK to change that.");
  for(let i=0;i<2;i++){
    await say("ari","send Omar the beach one");
    expect((await say("ari","yes")).reply).toBe("Okay. I'll ask Omar if they want it. An automatic check screens it first. I'll tell you if it doesn't go.");
    expect((await offers("ari","omar")).at(-1)!.phase).toBe("declined");
    clock.advance(4*DAY);await service.tick();
  }
  expect(await messages("omar","photo-ask:")).toEqual([]);
  await say("ari","send Omar the beach one");
  expect((await say("ari","yes")).reply).toBe("Photos are off for this chat. You can still send messages.");
  expect(await offers("ari","omar")).toHaveLength(2);
},180_000);

test.skipIf(!pgAvailable)("a connected agent can only ask: the proposal is texted to the phone, the list has no ids or links, and no photo resolve route exists",async()=>{
  const requested=await service.photoRequest(people.ari.personId,"slop",phones.ari,"send Jordan the beach one");
  expect(requested).toEqual({status:"texted",text:"I texted you the photo to check. Reply YES to that text to send it."});
  expect(JSON.stringify(requested)).not.toContain("http");
  const texted=await messages("ari","photo-draft:");
  expect(texted).toHaveLength(1);
  expect(texted[0]!.body).toContain('Send Jordan photo 1 "beach"');
  expect(texted[0]!.body).toMatch(/\/photos\/check#[A-Za-z0-9_-]{20,}/);
  expect(await offers("ari","jordan")).toEqual([]);
  const held=await service.photoHoldings(people.ari.personId,"slop",phones.ari);
  expect(held?.photos.map(p=>p.number)).toEqual([1,2]);
  expect(held?.photos[0]).toMatchObject({number:1,name:"beach",addedOn:"2026-11-22"});
  expect(held?.photos[0]!.sharedWith).toContainEqual({firstName:"Maya",state:"ready"});
  expect(JSON.stringify(held)).not.toMatch(/ph_|http|sha256|[a-f0-9]{64}|pof_|pri_/);
  expect(await service.photoHoldings(people.ari.personId,"slop",phones.maya)).toBeUndefined();
  const ready=(await offers("ari","maya")).at(-1)!;
  expect(ready.phase).toBe("ready");
  expect((await say("ari","take back photo 1 from Maya")).reply).toBe("Done. Maya can't open it again, but I can't undo what they already saw.");
  expect((await offers("ari","maya")).at(-1)).toEqual({id:ready.id,phase:"revoked"});
  expect((await items(ready.id)).map(x=>x.state)).toEqual(["revoked"]);
  const after=(await service.photoHoldings(people.ari.personId,"slop",phones.ari))?.photos[0]!.sharedWith;
  expect(after).not.toContainEqual({firstName:"Maya",state:"ready"});
  expect(after).toContainEqual({firstName:"Maya",state:"taken_back"});
  const body=JSON.stringify({id:"photo-resolve-probe",deliveryId:"relay:pri_0",to:phones.maya,approvedPhotos:[]});
  const signed=async()=>({"content-type":"application/json",...await svcSign(secret,{method:"POST",path:"/internal/relay-photo/resolve",id:"photo-resolve-probe",body,nowS:Math.floor(clock.now()/1000)})});
  const resolve=await service.publicFetch(new Request("https://backend.photo-fixture.invalid/internal/relay-photo/resolve",{method:"POST",body,headers:await signed()}));
  expect(resolve.status).toBe(404);
  expect(await resolve.json()).toEqual({ok:false,error:"not_found"});
  const staffResolve=await fetch(new URL("/internal/relay-photo/resolve?app=slop",server.url),{method:"POST",body,headers:{...await signed(),authorization:`Bearer ${staffToken}`}});
  expect(staffResolve.status).toBe(404);
  expect(await staffResolve.json()).toEqual({ok:false,error:"not_found"});
},120_000);

test.skipIf(!pgAvailable)("a take-back with no match named takes that photo back from every open offer, and an unnamed take-back with two open offers asks which match",async()=>{
  midday();
  await join("lee","Lee",32);await join("kim","Kim",28);
  await pair("photo-ari-lee","ari","lee");await pair("photo-ari-kim","ari","kim");
  for(const name of ["Lee","Kim"]){
    await say("ari",`send ${name} the beach one`);
    expect((await say("ari","yes")).reply).toContain(`I'll ask ${name} if they want it.`);
  }
  const [toLee]=await offers("ari","lee"),[toKim]=await offers("ari","kim");
  expect([toLee!.phase,toKim!.phase]).toEqual(["asking","asking"]);
  const unnamed=await say("ari","unsend it");
  expect(unnamed.outcome).toBe("handled");
  expect(unnamed.reply).toMatch(/^Which match\? (Lee or Kim|Kim or Lee)\. Say something like "take back the photo from (Lee|Kim)"\.$/);
  expect([(await offers("ari","lee"))[0]!.phase,(await offers("ari","kim"))[0]!.phase]).toEqual(["asking","asking"]);
  const numbered=await say("ari","take back photo 1");
  expect(numbered.reply).toBe("Okay, I won't send your photo.");
  expect(await offers("ari","lee")).toEqual([{id:toLee!.id,phase:"revoked"}]);
  expect(await offers("ari","kim")).toEqual([{id:toKim!.id,phase:"revoked"}]);
  expect((await say("ari","take back photo 1")).reply).toBe("No photo of yours is waiting to go to this match.");
},180_000);

test.skipIf(!pgAvailable)("a photo that the automatic check flags keeps the staff gate: a failed audit reads nothing, a release needs a safety reviewer's preview, and an expired item is never released",async()=>{
  midday();
  screenMode="flagged";
  try{
  await join("rosa","Rosa",30);await pair("photo-ari-rosa","ari","rosa");
  await say("ari","send Rosa the beach one");
  expect((await say("ari","yes")).reply).toContain("I'll ask Rosa if they want it.");
  const [offer]=await offers("ari","rosa");
  expect((await say("rosa","yes")).reply).toBe("Okay. I'll text you a private link after the check.");
  const [item]=await items(offer!.id);
  expect(item!.state).toBe("pending");
  const preview=(token:string)=>fetch(new URL(`/relay/${item!.id}/photo?app=slop`,server.url),{headers:{authorization:`Bearer ${token}`}});
  const releaseWith=(token:string,photoReviewToken?:string)=>fetch(new URL(`/relay/${item!.id}/release?app=slop`,server.url),{method:"POST",
    headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({note:"Photo checked for consent and safety",...(photoReviewToken?{photoReviewToken}:{})})});
  const unchanged=async()=>{
    expect(await items(offer!.id)).toEqual([{id:item!.id,state:"pending"}]);
    expect(await offers("ari","rosa")).toEqual([{id:offer!.id,phase:"reviewing"}]);
    expect(await messages("rosa",`photo-ready:${offer!.id}`)).toEqual([]);
  };
  const reads=storageReads;
  failPreviewAudit=true;
  try{
    const refused=await preview(staffToken);
    expect(refused.status).toBe(503);
    expect(refused.headers.get("x-network-photo-review-token")).toBeNull();
    expect(storageReads).toBe(reads);
  }finally{failPreviewAudit=false;}
  expect(await service.audit.list({targetId:item!.id,actions:["read_relay_photo"]})).toHaveLength(0);
  const noPreview=await releaseWith(staffToken);
  expect(noPreview.status).toBe(403);
  expect(await noPreview.json()).toMatchObject({ok:false,reason:"photo_preview_required"});
  await unchanged();
  const byReviewer=await preview(reviewerToken);
  expect(byReviewer.status).toBe(403);
  expect(byReviewer.headers.get("x-network-photo-review-token")).toBeNull();
  expect(storageReads).toBe(reads);
  const shown=await preview(staffToken);
  expect(shown.status).toBe(200);await shown.arrayBuffer();
  const reviewToken=shown.headers.get("x-network-photo-review-token")!;
  expect(reviewToken).toMatch(/^\d+\.[a-f0-9]{64}$/);
  expect((await releaseWith(reviewerToken,reviewToken)).status).toBe(403);
  await unchanged();
  clock.advance(12*HOUR);await service.tick();
  expect(await items(offer!.id)).toEqual([{id:item!.id,state:"expired"}]);
  expect(await offers("ari","rosa")).toEqual([{id:offer!.id,phase:"check_timed_out"}]);
  const late=await preview(staffToken);
  expect(late.status).toBe(403);
  expect(late.headers.get("x-network-photo-review-token")).toBeNull();
  const lateRelease=await releaseWith(staffToken,reviewToken);
  expect(lateRelease.status).toBe(403);
  expect(await lateRelease.json()).toMatchObject({ok:false,reason:"photo_preview_required"});
  expect(await service.photoRelay.review(item!.id,{id:"fixture-safety-reviewer",roles:["safety"]},"safe")).toBe(false);
  expect(await items(offer!.id)).toEqual([{id:item!.id,state:"expired"}]);
  expect(await messages("rosa",`photo-ready:${offer!.id}`)).toEqual([]);
  }finally{screenMode="clean";}
},180_000);

test.skipIf(!pgAvailable)("a classifier outage releases nothing: the photo waits, is tried again after 1, 5, 15 and 60 minutes, and goes to staff after five tries",async()=>{
  midday();
  await join("tao","Tao",31);await pair("photo-ari-tao","ari","tao");
  screenMode="down";
  try{
    await say("ari","send Tao the beach one");
    expect((await say("ari","yes")).reply).toContain("I'll ask Tao if they want it.");
    const [offer]=await offers("ari","tao");
    const before=screenCalls;
    expect((await say("tao","yes")).reply).toBe("Okay. I'll text you a private link after the check.");
    expect(screenCalls).toBe(before+1);
    const [item]=await items(offer!.id);
    expect(item!.state).toBe("screening");
    for(const wait of [MINUTE,5*MINUTE,15*MINUTE,HOUR]){
      await service.tick();
      expect(await offers("ari","tao")).toEqual([{id:offer!.id,phase:"reviewing"}]);
      expect(await messages("tao",`photo-ready:${offer!.id}`)).toEqual([]);
      expect((await service.photoRelay.held("slop")).map(h=>h.id)).not.toContain(item!.id);
      clock.advance(wait);
    }
    await service.tick();
    expect(screenCalls).toBe(before+5);
    expect(await items(offer!.id)).toEqual([{id:item!.id,state:"pending"}]);
    expect((await service.photoRelay.held("slop")).map(h=>h.id)).toContain(item!.id);
    expect(await offers("ari","tao")).toEqual([{id:offer!.id,phase:"reviewing"}]);
    expect(await messages("tao",`photo-ready:${offer!.id}`)).toEqual([]);
    expect(Number((await sql`select count(*)::int n from platform.photo_page_links where offer_id=${offer!.id}`)[0]!.n)).toBe(0);
  }finally{screenMode="clean";}
},180_000);

test.skipIf(!pgAvailable)("a clean photo stays open after 48 hours, PHOTO LINK replaces the link, and a take-back by text ends it at once and lists it as taken back",async()=>{
  midday();
  await join("sam","Sam",30);await pair("photo-ari-sam","ari","sam");
  await say("ari","send Sam the beach one");
  expect((await say("ari","yes")).reply).toContain("I'll ask Sam if they want it.");
  const [offer]=await offers("ari","sam");
  expect((await say("sam","yes")).reply).toBe("Okay. I'll text you a private link after the check.");
  expect(await offers("ari","sam")).toEqual([{id:offer!.id,phase:"ready"}]);
  const [ready]=await messages("sam",`photo-ready:${offer!.id}`);
  const first=/\/photos\/view#([A-Za-z0-9_-]{43})/.exec(ready!.body)?.[1];
  expect(first).toBeDefined();
  const viewLinks=async()=>Number((await sql`select count(*)::int n from platform.photo_page_links where offer_id=${offer!.id} and purpose='view' and expires_at is null`)[0]!.n);
  expect(await viewLinks()).toBe(1);
  clock.advance(2*DAY);await service.tick();
  expect(await offers("ari","sam")).toEqual([{id:offer!.id,phase:"ready"}]);
  expect((await service.photoRelay.pageLink(first!))?.offerId).toBe(offer!.id);
  const renewed=await say("sam","PHOTO LINK");
  expect(renewed.outcome).toBe("handled");
  expect(renewed.reply).toMatch(/^Here is a new private link for Ari's photo: https:\/\/[^ ]+\/photos\/view#[A-Za-z0-9_-]{43} The old link no longer opens\.$/);
  const second=/\/photos\/view#([A-Za-z0-9_-]{43})/.exec(renewed.reply)?.[1];
  expect(second).toBeDefined();
  expect(second).not.toBe(first);
  expect(await service.photoRelay.pageLink(first!)).toBeUndefined();
  expect((await service.photoRelay.pageLink(second!))?.offerId).toBe(offer!.id);
  expect(await viewLinks()).toBe(1);
  expect((await say("ari","PHOTO LINK")).reply).toBe("No photo is waiting for you to open.");
  expect((await say("ari","take back photo 1 from Sam")).reply).toBe("Done. Sam can't open it again, but I can't undo what they already saw.");
  expect(await offers("ari","sam")).toEqual([{id:offer!.id,phase:"revoked"}]);
  expect((await items(offer!.id)).map(x=>x.state)).toEqual(["revoked"]);
  const shared=(await service.photoHoldings(people.ari.personId,"slop",phones.ari))?.photos[0]!.sharedWith;
  expect(shared).toContainEqual({firstName:"Sam",state:"taken_back"});
  expect(shared).not.toContainEqual({firstName:"Sam",state:"ready"});
  expect((await say("sam","PHOTO LINK")).reply).toBe("No photo is waiting for you to open.");
},180_000);

test.skipIf(!pgAvailable)("a ready photo does not hold the next offer to the same match, and STOP then START keeps the old link closed for good",async()=>{
  midday();
  await join("una","Una",30);await pair("photo-ari-una","ari","una");
  await say("ari","send Una the beach one");
  expect((await say("ari","yes")).reply).toContain("I'll ask Una if they want it.");
  const [first]=await offers("ari","una");
  expect((await say("una","yes")).reply).toBe("Okay. I'll text you a private link after the check.");
  expect(await offers("ari","una")).toEqual([{id:first!.id,phase:"ready"}]);
  const [ready]=await messages("una",`photo-ready:${first!.id}`);
  const token=/\/photos\/view#([A-Za-z0-9_-]{43})/.exec(ready!.body)![1]!;
  const pages=new PhotoPages({relay:service.photoRelay,photos:service.photos,sql,actions:{
    consent:async()=>({state:"refused"}),takeBack:async()=>({state:"nothing_open"}),report:async()=>undefined}});
  const open=async(cookie?:string)=>(await pages.route(new Request("https://slop.date/api/photos/page/open",{method:"POST",
    headers:{"content-type":"application/json",...(cookie?{cookie:`${PHOTO_PAGE_COOKIE}=${cookie}`}:{})},body:JSON.stringify({token})}),"/api/photos/page/open","slop"))!;
  const opened=await open();
  expect(opened.status).toBe(200);
  expect(opened.headers.get("set-cookie")).toMatch(/; Max-Age=34560000$/);
  const browser=/__Host-photo-page=([A-Za-z0-9_-]{43})/.exec(opened.headers.get("set-cookie")!)![1]!;

  expect((await say("ari","send Una photo 2")).reply).toContain("Send Una photo 2");
  expect((await say("ari","yes")).reply).toBe("Okay. I'll ask Una if they want it. An automatic check screens it first. I'll tell you if it doesn't go.");
  expect((await offers("ari","una")).map(o=>o.phase)).toEqual(["ready","asking"]);
  expect((await say("ari","send Una the beach one")).reply).toMatch(/^Una already has photo 1\. Which other one\? 2 \(/);
  await upload("ari",4);
  expect((await say("ari","send Una photo 3")).reply).toContain("Send Una photo 3");
  expect((await say("ari","yes")).reply).toBe("Una hasn't answered your last photo yet. You can offer another after that.");
  expect((await offers("ari","una")).map(o=>o.phase)).toEqual(["ready","asking"]);
  expect((await open(browser)).status).toBe(200);

  await say("una","STOP");
  await say("una","START");
  const afterStop=await say("ari","send Una the beach one");
  expect(afterStop.reply).toBe('Who should get it? Sam or Tao or Rosa or Kim or Lee or Omar or Jordan or Maya. Say something like "send Sam the beach one".');
  expect(afterStop.reply).not.toContain("Una");
  expect(afterStop.reply).not.toMatch(/\/photos\/check/);
  const reopened=await open(browser);
  expect(reopened.status).toBe(410);
  expect(await reopened.json()).toEqual({ok:false,error:"link_expired"});
  expect((await say("una","PHOTO LINK")).reply).toBe("No photo is waiting for you to open.");
  await service.tick();
  expect((await offers("ari","una")).map(o=>o.phase)).toEqual(["ended","ended"]);
  expect((await open(browser)).status).toBe(410);
},180_000);
