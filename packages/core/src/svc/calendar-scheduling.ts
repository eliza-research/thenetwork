import { isAppId, type AppId, type MemberId } from "../types.ts";
import {
  calendarAuthorityLifetimeMs, calendarBridgeProofCurrent, calendarIntervalWithin, calendarSchedulingPurpose, calendarSource,
} from "../generated/calendarFreeBusy.ts";
import { readCalendarFreeBusy, type CalendarFreeBusyAuthority, type CalendarFreeBusyGrant, type CalendarInterval } from "../calendar-free-busy.ts";

export const CALENDAR_SCHEDULING_MAX_BODY = 16 * 1024;

export interface CalendarSchedulingOwner { app: AppId; personId: string; memberId: MemberId }
export interface CalendarOwnerRequest {
  app: AppId; e164: string; organizationId: string; userId: string; connectionId: string;
  purpose: string; nonce: string;
}
export interface CalendarPreloadRequest extends CalendarSchedulingOwner { purpose: string; nonce: string; coverage: CalendarInterval }
export type CalendarSchedulingObservation = NonNullable<ReturnType<CalendarFreeBusyAuthority>>;

const uuid = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const timestamp = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const object = (value: unknown, keys: readonly string[]): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key)) ? row : undefined;
};

export function calendarOwnerRequest(value: unknown): CalendarOwnerRequest | undefined {
  const input = object(value, ["app", "e164", "organizationId", "userId", "connectionId", "purpose", "nonce"]);
  if (!input || !isAppId(input.app) || typeof input.e164 !== "string" || !/^\+[1-9]\d{6,14}$/.test(input.e164)
    || !uuid(input.organizationId) || !uuid(input.userId) || !uuid(input.connectionId) || !uuid(input.nonce)
    || input.purpose !== calendarSchedulingPurpose) return;
  return { app: input.app, e164: input.e164, organizationId: input.organizationId, userId: input.userId,
    connectionId: input.connectionId, purpose: input.purpose, nonce: input.nonce };
}

export function calendarReplyObservation(value: unknown, request: CalendarPreloadRequest, requestSha256: string, now: number): CalendarSchedulingObservation | undefined {
  const reply = object(value, ["app", "personId", "memberId", "purpose", "requestSha256", "issuedAt", "expiresAt", "grant", "observation"]);
  if (!reply || !timestamp(reply.issuedAt) || !timestamp(reply.expiresAt)) return;
  const { app, personId, memberId, purpose, coverage } = request;
  if (!calendarBridgeProofCurrent(true, reply.requestSha256 === requestSha256,
    reply.app === app && reply.personId === personId && reply.memberId === memberId && reply.purpose === purpose,
    reply.issuedAt, reply.expiresAt, now)) return;
  const sourceGrant = object(reply.grant, ["app", "memberId", "purpose", "provider", "connectionId", "active", "grantedAt", "expiresAt"]);
  if (!sourceGrant || sourceGrant.app !== app || sourceGrant.memberId !== memberId || sourceGrant.purpose !== purpose
    || sourceGrant.provider !== calendarSource || !uuid(sourceGrant.connectionId) || sourceGrant.active !== true
    || !timestamp(sourceGrant.grantedAt) || !timestamp(sourceGrant.expiresAt)) return;
  const grant: CalendarFreeBusyGrant = { app, memberId, purpose, provider: calendarSource, connectionId: sourceGrant.connectionId,
    active: true, grantedAt: sourceGrant.grantedAt, expiresAt: Math.min(sourceGrant.expiresAt, reply.expiresAt) };
  const checked = readCalendarFreeBusy({ app, memberId, purpose, now }, true, true, () => ({ grant, observation: reply.observation }));
  if (!checked || !calendarIntervalWithin(coverage.start, coverage.end, checked.coverage.start, checked.coverage.end)) return;
  return { grant, observation: { app, memberId, purpose, provider: grant.provider, connectionId: grant.connectionId,
    observedAt: checked.observedAt, coverage: checked.coverage, busy: checked.busy } };
}

export function calendarOwnerProof(owner: CalendarSchedulingOwner, requestSha256: string, now: number) {
  return { ...owner, purpose: calendarSchedulingPurpose, requestSha256, issuedAt: now, expiresAt: now + calendarAuthorityLifetimeMs };
}
