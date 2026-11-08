// The photo-relay-item state machine (docs/research/quint-findings/relay.md) on the canonical owner: a member's
// selected photo -> staff preview and release over real HTTP -> the ConsentNetwork relay desk -> the durable
// outbox -> the Cloud deliver path. Photo storage and Cloud HTTP are controlled boundaries; no model and no
// provider is called. Needs the dev Postgres on :54339.
import {afterAll,beforeAll,expect,test} from "bun:test";
import {randomUUID,createHash} from "node:crypto";
import {SQL} from "bun";
import {DAY,MINUTE,SimClock,type MemberId} from "@thenetwork/core";
import {applySchema} from "../../observatory/db/dev-pg.ts";
import {TURN_PATH,DELIVER_PATH,type TurnRequest} from "../../core/src/svc/contract.ts";
import {svcSign,svcVerify} from "../../core/src/svc/svc-auth.ts";
import {CloudChannelAdapter} from "../service/cloud-channel.ts";
import {NetworkService} from "../service/service.ts";
import type {NetworkState} from "../src/network.ts";
import {PHOTO_CONSENT,type PhotoStorage} from "../../platform/src/photos.ts";

const db=`network_photo_relay_${randomUUID().replaceAll("-","")}`,url=`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/${db}`;
const admin=new SQL({url:`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/postgres`,max:1});
const secret="synthetic-photo-relay-item-secret-20261108",clock=new SimClock(Date.UTC(2026,9,9,16));
const staffToken="synthetic-photo-relay-item-token-20261108",staffId=`token:safety#${createHash("sha256").update(staffToken).digest("hex").slice(0,8)}`;
const a="+12125550411",b="+12125550412";
let service:NetworkService,server:ReturnType<typeof Bun.serve>,cloud:ReturnType<typeof Bun.serve>;
const sent:Array<{id:string;to:string;approvedPhotos?:unknown[]}>=[];
const photoBytes=new Map<string,Uint8Array>();
const photoStorage:PhotoStorage={kind:"local",put:async(k,bytes)=>{photoBytes.set(k,bytes.slice());},get:async k=>photoBytes.get(k),delete:async k=>{photoBytes.delete(k);}};
const post=async(path:string,body:object)=>{
  const raw=JSON.stringify(body);
  return fetch(new URL(path,server.url),{method:"POST",body:raw,headers:{"content-type":"application/json",...await svcSign(secret,{method:"POST",path,id:String((body as {messageId:string}).messageId),body:raw,nowS:Math.floor(clock.now()/1000)})}});
};
const turn=(from:string,messageId:string,text:string):TurnRequest=>({channel:"blooio",from,to:null,messageId,text,receivedAt:clock.now(),transport:"imessage",app:"slop"});

beforeAll(async()=>{
  await admin.unsafe(`create database ${db}`);await applySchema(url,{lockTimeout:"5s"});
  cloud=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async req=>{
    const path=new URL(req.url).pathname,raw=await req.text(),auth=await svcVerify(secret,{method:req.method,path,headers:req.headers,body:raw,nowS:Math.floor(clock.now()/1000)});
    expect(auth.ok).toBe(true);const input=JSON.parse(raw);
    if(path===DELIVER_PATH)sent.push(input);
    return Response.json({ok:true,replayed:path!==DELIVER_PATH,providerMessageIds:[`owned:${input.id}`],acceptedAt:new Date(clock.now()).toISOString(),history:true});
  }});
  service=new NetworkService({url,clock,photoStorage,photoDeliveryOrigin:"https://backend.photo-fixture.invalid",tokens:`safety@slop:${staffToken}`,
    photoRelayPolicy:{version:"relay-fixture-v1",notice:"Share this selected photo with {{recipient}} only after its designated safety review. Test fixture policy.",authorizeReviewer:async(id:string)=>id===staffId},
    env:{PLATFORM_ENV:"dev",CLEF_RATINGS:"off",SERVICE_TURN_SECRET:secret},networks:[{id:"slop:nyc",matchingEnabled:false}],log:()=>{},
    relayClassifier:async()=>({flags:[],source:"clef" as const}),
    adapter:(_net,rt)=>new CloudChannelAdapter({app:rt.app.id,clock,city:rt.city,from:"+12125550410",origin:cloud.url.origin,secret,
      env:{PLATFORM_ENV:"dev",BLOOIO_ALLOW_SEND:"1",NTWRK_LIVE_APPROVED:"1",SLOP_LIVE_APPROVED:"1"}})});
  await service.start();server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:req=>service.fetch(req)});
  for(const [phone,name] of [[a,"Dena"],[b,"Elle"]]) for(const [i,text] of ["slop.date",`${name}, 29`,"I enjoy hiking and cooking","Saturday afternoons work for me","Small groups are good"].entries()){
    clock.advance(MINUTE);expect((await post(TURN_PATH,turn(phone!,`setup:${name}:${i}`,text))).status).toBe(200);
  }
},120_000);
afterAll(async()=>{server?.stop(true);await service?.close();cloud?.stop(true);await admin.unsafe(`drop database if exists ${db} with (force)`);await admin.close();});

test("photo-relay-item: an approved photo that met the rate limit can be released again after the window (SD-320)",async()=>{
  const sender=(await service.accounts.personFor(a))!,recipient=(await service.accounts.personFor(b))!;
  const from=(await service.people.getMembership(sender.id,"slop"))!.memberId as MemberId,to=(await service.people.getMembership(recipient.id,"slop"))!.memberId as MemberId;
  const rt=service.runtimeFor("slop")!;
  // An explicit canonical mutual-consent fixture: this case qualifies the relay, not matching or human review.
  await rt.unitOfWork(n=>{const state=n.exportState(),pair=[from,to];
    state.opps.push({id:"photo-pair",origin:"engine",kind:"intro",category:"social",objective:"coffee",detail:"coffee",participants:pair,alternates:[],primed:[],status:pair.map(p=>[p,"yes"]),explanations:{},stage:"scheduled",deadline:clock.now()+DAY,createdAt:clock.now(),score:.8,generator:"fixture",components:{fit:0,mutualBenefit:0,warmPath:0,novelty:0,timingFit:0,activationCost:0,interruptionCost:0,load:0,repetition:0,socialRisk:0,confidence:0},exploration:false,review:{queuedAt:clock.now(),deadline:clock.now()+DAY,decision:"approve",reviewer:"fixture"},sameDay:false,contacted:pair,reminded:[],feedbackFrom:[],tags:[],replacements:0} as NetworkState["opps"][number]);
    n.importState(state);});
  const upload=await service.photos.upload(sender.id,"slop",Uint8Array.from([255,216,255,218,0,2,1,255,217]),PHOTO_CONSENT.version);
  if(!upload.ok)throw Error(JSON.stringify(upload));
  const selected=await service.photoRelay.select("slop",sender.id,"photo-pair",upload.value.id,"relay-fixture-v1",true,"fixture-select-rate-20261108");
  if(!selected)throw Error("selected item refused");
  // Dena sends six texts in a few minutes: the relay burst limit (6 in 10 minutes) is reached.
  for(let i=0;i<6;i++){clock.advance(MINUTE);await rt.unitOfWork(n=>n.relayRequest({itemId:`rate-text-${i}`,from,kind:"text",text:`see you at the park ${i}`}));}
  // Each release follows a staff preview (its review token lasts 5 minutes).
  const release=async()=>{
    const preview=await fetch(new URL(`/relay/${selected.itemId}/photo?app=slop`,server.url),{headers:{authorization:`Bearer ${staffToken}`}});
    expect(preview.status).toBe(200);await preview.arrayBuffer();
    return fetch(new URL(`/relay/${selected.itemId}/release?app=slop`,server.url),{method:"POST",headers:{authorization:`Bearer ${staffToken}`,"content-type":"application/json"},
      body:JSON.stringify({note:"Selected item checked for fixture consent and safety",photoReviewToken:preview.headers.get("x-network-photo-review-token")})});
  };
  // Inside the burst window the release is held by the rate limit only: nothing is kept for staff and nothing goes.
  expect((await (await release()).json() as any).ok).toBe(false);
  expect(await rt.readState(n=>n.relayHeld().filter(h=>h.itemId===selected.itemId))).toEqual([]);
  expect((await rt.readState(n=>n.relayLog())).find(r=>r.itemId===selected.itemId)?.reasons).toEqual(["rate:burst"]);
  // Ten minutes after the first texts (and inside the 15-minute selection) the same approved photo goes on the next release.
  clock.advance(6*MINUTE);
  // Elle answers, so the conversation streak of unanswered texts does not refuse the send.
  expect((await post(TURN_PATH,turn(b,"photo-recipient-engaged","Sounds good, thanks"))).status).toBe(200);
  const again=await release();
  expect(await again.json()).toMatchObject({ok:true});
  await rt.deliver();
  expect(sent.filter(x=>x.id===`relay:${selected.itemId}`&&x.to===b)).toHaveLength(1);
},60_000);
