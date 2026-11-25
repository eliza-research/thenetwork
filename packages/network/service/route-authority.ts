import { parseNetworkRouteAuthorityV1, type NetworkRouteAuthorityV1 } from "../../core/src/svc/contract.ts";

export interface NetworkRoutePolicy {
  authority: NetworkRouteAuthorityV1;
  admitUntil: number;
  drainUntil: number;
}

export function networkRoutePolicy(env: Record<string, string | undefined>): NetworkRoutePolicy | undefined {
  const raw = env.NETWORK_ROUTE_AUTHORITY_POLICY;
  if (raw === undefined) return undefined;
  if (env.PLATFORM_ENV !== "staging") throw new Error("Network route authority requires staging");
  let p: Record<string, unknown>;
  try { p = JSON.parse(raw); } catch { throw new Error("Invalid network route authority policy"); }
  if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).length !== 3
    || Object.keys(p).some(k => !["authority", "admitUntil", "drainUntil"].includes(k))) throw new Error("Invalid network route authority policy");
  const authority = parseNetworkRouteAuthorityV1(p.authority);
  if (!authority || !Number.isSafeInteger(p.admitUntil) || !Number.isSafeInteger(p.drainUntil)
    || (p.admitUntil as number) <= 0 || (p.drainUntil as number) < (p.admitUntil as number)
    || (p.drainUntil as number) > 8_640_000_000_000_000) throw new Error("Invalid network route authority policy");
  return { authority, admitUntil: p.admitUntil as number, drainUntil: p.drainUntil as number };
}

export function sameNetworkAuthority(a: unknown, b: NetworkRouteAuthorityV1): boolean {
  const parsed = parseNetworkRouteAuthorityV1(a);
  return !!parsed && parsed.routeId === b.routeId && parsed.generation === b.generation
    && parsed.audience === b.audience && parsed.realmId === b.realmId;
}

export function routeEnvelopeAllowed(policy: NetworkRoutePolicy | undefined, value: unknown, now: number): boolean {
  return policy ? now < policy.drainUntil && sameNetworkAuthority(value, policy.authority) : value === undefined;
}
