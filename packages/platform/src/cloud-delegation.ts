import { randomUUID } from "node:crypto";
import { NETWORK_LOGIN_PATH, networkTarget, parseNetworkDelegation, type NetworkLoginRealm, type NetworkLoginApp, type NetworkDelegation } from "../../core/src/svc/network-delegation.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { readCapped } from "./body.ts";

/**
 * Exact production recipient only; existing staging/local transport remains separate. Cloud issues
 * issuedAt on its own clock: `skewMs` is how far ahead of ours it may be.
 */
export function productionCloudDelegation(o: { secret: string; now: () => number; skewMs: number; realm?: NetworkLoginRealm; fetch?: typeof fetch }) {
  if (o.secret.length < 32) throw new Error("Cloud delegation requires the existing service authority");
  async function post(app: NetworkLoginApp, action: "exchange" | "validate", fields: Record<string, unknown>) {
    const target=networkTarget(app,o.realm??"canonical"),path=`${NETWORK_LOGIN_PATH}/${action}`,body=JSON.stringify({target,...fields});
    const response=await(o.fetch??fetch)(new Request(`https://api.eliza.app${path}`,{method:"POST",body,redirect:"error",cache:"no-store",signal:AbortSignal.timeout(5000),
      headers:{"Content-Type":"application/json",origin:target.origin,...await svcSign(o.secret,{method:"POST",path,id:randomUUID(),body,nowS:Math.floor(o.now()/1000)})}}));
    const bytes=await readCapped(response,16*1024);
    if(bytes==="too_large" || response.redirected) throw new Error("Cloud delegation response unavailable");
    let value:unknown;try{value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}catch{throw new Error("Cloud delegation response unavailable");}
    return {response,value:value as Record<string,unknown>};
  }
  return {
    async exchange(app:NetworkLoginApp,code:string,codeVerifier:string):Promise<(NetworkDelegation&{proof:string})|undefined>{
      const {response,value}=await post(app,"exchange",{code,codeVerifier});
      if(!response.ok)return;
      const identity=parseNetworkDelegation(value?.identity,networkTarget(app,o.realm??"canonical"),o.now(),o.skewMs);
      if(!identity || typeof value.proof!=="string" || !value.proof.startsWith("ensd_") || value.proof.length>12000)return;
      return {...identity,proof:value.proof};
    },
    async validate(app:NetworkLoginApp,stored:Record<string,unknown>):Promise<"valid"|"invalid"|"unavailable">{
      try{
        const identity=parseNetworkDelegation(stored.identity,networkTarget(app,o.realm??"canonical"),o.now(),o.skewMs);
        if(!identity || typeof stored.proof!=="string")return "invalid";
        const {response,value}=await post(app,"validate",{proof:stored.proof});
        if(response.status===403 && value.ok===false)return "invalid";
        if(!response.ok || value.ok!==true)return "unavailable";
        const current=parseNetworkDelegation(value.identity,networkTarget(app,o.realm??"canonical"),o.now(),o.skewMs);
        if(!current)return "unavailable";
        return Object.keys(identity).every(key=>current[key as keyof NetworkDelegation]===identity[key as keyof NetworkDelegation])?"valid":"invalid";
      }catch{return "unavailable";}
    },
  };
}
