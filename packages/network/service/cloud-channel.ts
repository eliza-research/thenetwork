/** The existing persisted line policy queue, with Cloud as the canonical transport owner. */
import {ChannelSendError, type SendReceipt, type SendRequest} from "../../blooio/src/types.ts";
import {readCappedText} from "../../platform/src/body.ts";
import {normalizePhone} from "../../platform/src/phone.ts";
import {DELIVER_PATH, NETWORK_APP_IDS, type DeliverRequest, type NetworkAppId} from "../../core/src/svc/contract.ts";
import {svcSign} from "../../core/src/svc/svc-auth.ts";
import {BlooioAdapter, type BlooioAdapterOptions} from "./channel.ts";

export class CloudChannelAdapter extends BlooioAdapter {
  override readonly name = "eliza_cloud" as const;
  constructor(options: Omit<BlooioAdapterOptions,"provider"|"app"> & {app:NetworkAppId; origin:string; secret:string; fetch?:typeof fetch}) {
    const origin=new URL(options.origin);
    const local=options.env?.PLATFORM_ENV==="dev" && origin.protocol==="http:" && ["127.0.0.1","localhost"].includes(origin.hostname);
    if ((!local && origin.protocol!=="https:") || origin.username || origin.password || origin.search || origin.hash || origin.pathname!=="/") throw new Error("Cloud delivery needs an exact HTTPS origin or explicit local development origin");
    if (options.secret.length<32) throw new Error("Cloud delivery needs SERVICE_TURN_SECRET of at least 32 characters");
    const post=async(request:SendRequest,receiptOnly:boolean):Promise<SendReceipt>=>{
      const scope=request.context;
      if (!scope || scope.app!==options.app || !NETWORK_APP_IDS.includes(scope.app as NetworkAppId) || normalizePhone(request.to)!==request.to || request.mediaUrls?.length)
        throw new ChannelSendError("Cloud delivery needs a canonical text and persisted queue scope","invalid");
      const payload:DeliverRequest={id:scope.id,to:request.to,text:request.text,app:options.app,memberId:scope.memberId,channel:"blooio",
        kind:scope.kind==="reply" || scope.kind==="compliance" ? "reply" : "proactive"};
      const path=receiptOnly?`${DELIVER_PATH}/receipt`:DELIVER_PATH,body=JSON.stringify(payload);
      let response:Response,value:unknown;
      try {
        response=await(options.fetch??fetch)(`${origin.origin}${path}`,{method:"POST",body,redirect:"error",signal:AbortSignal.timeout(10_000),
          headers:{"content-type":"application/json",...await svcSign(options.secret,{method:"POST",path,id:payload.id,body,nowS:Math.floor(options.clock.now()/1000)})}});
        const text=await readCappedText(response,64*1024);
        if (text==="too_large") throw new Error("Oversize Cloud receipt");
        value=JSON.parse(text);
      } catch {throw new ChannelSendError("Cloud acceptance is unknown","unknown");}
      const result=value && typeof value==="object" && !Array.isArray(value)?value as Record<string,unknown>:null;
      if (response.status===200 && result?.ok===true && result.history===true && typeof result.replayed==="boolean"
        && Array.isArray(result.providerMessageIds) && result.providerMessageIds.length>0 && result.providerMessageIds.every(id=>typeof id==="string" && id.trim())
        && typeof result.acceptedAt==="string" && Number.isFinite(Date.parse(result.acceptedAt))) {
        return {providerMessageId:result.providerMessageIds[0] as string,providerMessageIds:result.providerMessageIds as string[],status:"queued",
          replayed:result.replayed,acceptedAt:Date.parse(result.acceptedAt),historyRecorded:true};
      }
      if (!receiptOnly && result?.ok===false && result.error!=="unknown") {
        if (result.error==="opted_out") throw new ChannelSendError("Recipient opted out","blocked",response.status,"opted_out");
        if (result.error==="rejected" && result.retryable===true) throw new ChannelSendError("Cloud refused admission before dispatch","retryable",response.status);
        if ([400,401,403,404,409,422].includes(response.status)) throw new ChannelSendError("Cloud refused delivery","invalid",response.status);
      }
      throw new ChannelSendError("Cloud acceptance is unknown","unknown",response.status);
    };
    super({...options,provider:{kind:"blooio",send:request=>post(request,false),receipt:request=>post(request,true)}});
  }
}
