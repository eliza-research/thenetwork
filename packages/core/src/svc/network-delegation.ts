/** Domain-separated Network login contract. This grants membership login, never Google/history access. */
export const NETWORK_LOGIN_PATH = "/api/auth/sso-bridge/network";
export const NETWORK_SITES = Object.freeze({ ntwrk: "https://ntwrk.party", slop: "https://slop.date", friends: "https://friends.help", peon: "https://peon.biz" });
export type NetworkLoginApp = keyof typeof NETWORK_SITES;
export const NETWORK_FRESH_PERSON_SITES = Object.freeze({ ntwrk: "https://fresh-person.ntwrk-party-eliza.pages.dev", slop: "https://fresh-person.slop-date-eliza-stage.pages.dev", friends: "https://fresh-person.friends-help-eliza-stage.pages.dev", peon: "https://fresh-person.peon-biz-eliza-stage.pages.dev" });
export type NetworkLoginRealm = "canonical" | "fresh-person-20261015";
export const networkSitesForRealm = (realm: NetworkLoginRealm) => realm === "canonical" ? NETWORK_SITES : realm === "fresh-person-20261015" ? NETWORK_FRESH_PERSON_SITES : undefined;

export interface NetworkLoginTarget {
  app: NetworkLoginApp; realm: NetworkLoginRealm; origin: string; audience: "network-membership-v1"; resource: string; callback: string;
}
export interface NetworkDelegation extends NetworkLoginTarget {
  version: 1; userId: string; organizationId: string; stewardUserId: string; e164: string;
  agentId: string; issuedAt: number; expiresAt: number;
}
/** Network-sealed authority for one OAuth resource; no raw Cloud bearer or phone is stored here. */
export interface CloudGrantAuthority {
  version: 1; app: NetworkLoginApp; resource: string; phoneKey: string; issuedAt: number; expiresAt: number; sealed: string;
}
export const networkTarget = (app: NetworkLoginApp, realm: NetworkLoginRealm = "canonical"): NetworkLoginTarget => {
  const sites=networkSitesForRealm(realm);if(!sites || !Object.hasOwn(sites,app))throw Error("Unknown exact Network app/realm");
  return { app, realm, origin: sites[app], audience: "network-membership-v1", resource: `${sites[app]}/api`, callback: `${sites[app]}/api/auth/cloud/callback` };
};
export function parseNetworkTarget(value: unknown): NetworkLoginTarget | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const x = value as Record<string, unknown>;
  if (Object.keys(x).sort().join() !== "app,audience,callback,origin,realm,resource" || typeof x.app !== "string" || !Object.hasOwn(NETWORK_SITES, x.app) || (x.realm!=="canonical" && x.realm!=="fresh-person-20261015")) return undefined;
  const target = networkTarget(x.app as NetworkLoginApp, x.realm as NetworkLoginRealm);
  return Object.entries(target).every(([key, v]) => x[key] === v) ? target : undefined;
}
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(v);
/** `skewMs`: how far the issuer's clock may be ahead of `now` (the reader's clock) for issuedAt only. */
export function parseNetworkDelegation(value: unknown, expected: NetworkLoginTarget, now: number, skewMs = 0): NetworkDelegation | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const x = value as Record<string, unknown>;
  if (Object.keys(x).sort().join() !== "agentId,app,audience,callback,e164,expiresAt,issuedAt,organizationId,origin,realm,resource,stewardUserId,userId,version"
    || x.version !== 1 || !parseNetworkTarget(expected) || Object.entries(expected).some(([k,v]) => x[k] !== v)
    || !uuid(x.userId) || !uuid(x.organizationId) || typeof x.stewardUserId !== "string" || !x.stewardUserId.trim() || x.stewardUserId.length > 256
    || typeof x.e164 !== "string" || !/^\+[1-9]\d{6,14}$/u.test(x.e164) || typeof x.agentId !== "string" || !/^personal:[0-9a-f-]{36}$/iu.test(x.agentId)
    || !Number.isSafeInteger(now) || !Number.isSafeInteger(x.issuedAt) || !Number.isSafeInteger(x.expiresAt)
    || (x.issuedAt as number) <= 0 || (x.issuedAt as number)*1000 > now + skewMs || (x.expiresAt as number) <= now
    || (x.expiresAt as number) > (x.issuedAt as number)*1000 + 3600_000) return undefined;
  return value as NetworkDelegation;
}
