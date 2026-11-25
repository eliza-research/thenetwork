/** The existing persisted line policy queue, with Cloud as the canonical transport owner. */
import {ChannelSendError, type SendReceipt, type SendRequest} from "../../blooio/src/types.ts";
import {readCappedText} from "../../platform/src/body.ts";
import {normalizePhone} from "../../platform/src/phone.ts";
import {cloudDeliveryReceiptAllowed, cloudDispatchMayRetry, cloudLookupConfirmsAbsence, cloudReceiptTimeAllowed} from "../../core/src/generated/cloudDeliveryReceipt.ts";
import {DELIVER_PATH, NETWORK_APP_IDS, type DeliverRequest, type NetworkAppId} from "../../core/src/svc/contract.ts";
import {SVC_MAX_SKEW_S, svcSign} from "../../core/src/svc/svc-auth.ts";
import {BlooioAdapter, type BlooioAdapterOptions} from "./channel.ts";

/**
 * Receipt lookup only (never a send) for a deliver whose acceptance is unknown: the same signed body as
 * DELIVER_PATH, the same id. Not in the mirror: upstream contract.ts has no constant for it, but Eliza
 * Cloud serves it (elizaos/eliza develop, packages/cloud/api/internal/network/deliver/receipt/route.ts,
 * handleNetworkDelivery in reconcile-only mode). Proposal for upstream: service/README.md "Contract".
 */
export const DELIVER_RECEIPT_PATH = "/api/internal/network/deliver/receipt";

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
      if (options.env?.NETWORK_ROUTE_AUTHORITY_POLICY !== undefined)
        throw new ChannelSendError("Isolated route delivery requires its original signed turn authority", "invalid");
      const payload:DeliverRequest={id:scope.id,to:request.to,text:request.text,app:options.app,memberId:scope.memberId,channel:"blooio",
        kind:scope.kind==="reply" || scope.kind==="compliance" ? "reply" : scope.id.startsWith("relay:") ? "relay" : "proactive"};
      const path=receiptOnly?DELIVER_RECEIPT_PATH:DELIVER_PATH,body=JSON.stringify(payload);
      let response:Response,value:unknown;
      try {
        response=await(options.fetch??fetch)(`${origin.origin}${path}`,{method:"POST",body,redirect:"error",signal:AbortSignal.timeout(10_000),
          headers:{"content-type":"application/json",...await svcSign(options.secret,{method:"POST",path,id:payload.id,body,nowS:Math.floor(options.clock.now()/1000)})}});
        const text=await readCappedText(response,64*1024);
        if (text==="too_large") throw new Error("Oversize Cloud receipt");
        value=JSON.parse(text);
      } catch {throw new ChannelSendError("Cloud acceptance is unknown","unknown");}
      const result=value && typeof value==="object" && !Array.isArray(value)?value as Record<string,unknown>:null;
      const rawTime = result?.acceptedAt;
      const timestamp = typeof rawTime === "string" ? Date.parse(rawTime) : NaN;
      const canonicalTime = Number.isFinite(timestamp) && new Date(timestamp).toISOString() === rawTime;
      const validTime = cloudReceiptTimeAllowed(scope.createdAt, options.clock.now(), SVC_MAX_SKEW_S * 1000,
        rawTime !== undefined, canonicalTime, canonicalTime ? timestamp : 0);
      const ids = result?.providerMessageIds;
      const providerIds = Array.isArray(ids) && ids.every(id => typeof id === "string" && id.trim()) && new Set(ids).size === ids.length
        ? ids as string[] : [];
      if (cloudDeliveryReceiptAllowed(response.status, result?.ok === true, result?.history === true, providerIds.length > 0,
        typeof result?.replayed === "boolean", validTime)) {
        return { providerMessageId: providerIds[0]!, providerMessageIds: providerIds, status: "queued", replayed: result?.replayed === true,
          ...(canonicalTime ? { acceptedAt: timestamp } : {}), historyRecorded: true };
      }
      const error = typeof result?.error === "string" ? result.error : "";
      const failed = result?.ok === false, retryable = result?.retryable === true;
      if (cloudLookupConfirmsAbsence(receiptOnly, failed, retryable, response.status, error))
        throw new ChannelSendError("Cloud never admitted this id","unknown",response.status,"not_found");
      if (cloudDispatchMayRetry(receiptOnly, failed, retryable, response.status, error))
        throw new ChannelSendError("Cloud refused admission before dispatch","retryable",response.status);
      if (!receiptOnly && result?.ok===false && result.error!=="unknown") {
        if (result.error==="opted_out") throw new ChannelSendError("Recipient opted out","blocked",response.status,"opted_out");
        if ([400,401,403,404,409,422].includes(response.status)) throw new ChannelSendError("Cloud refused delivery","invalid",response.status);
      }
      throw new ChannelSendError("Cloud acceptance is unknown","unknown",response.status);
    };
    super({...options,provider:{kind:"blooio",send:request=>post(request,false),receipt:request=>post(request,true)}});
  }
}
