import { createHash, randomUUID } from "node:crypto";
import type { MemberId } from "@thenetwork/core";
import { readCapped } from "../../platform/src/body.ts";
import { svcSign, svcVerify } from "../../core/src/svc/svc-auth.ts";
import {
  CALENDAR_SCHEDULING_MAX_BODY, calendarOwnerProof, calendarOwnerRequest, calendarReplyObservation, type CalendarOwnerRequest, type CalendarPreloadRequest,
  type CalendarSchedulingObservation, type CalendarSchedulingOwner,
} from "../../core/src/svc/calendar-scheduling.ts";
import { calendarAuthorityLifetimeMs, calendarCoverageMaxMs, calendarOwnerPath, calendarPreloadPath, calendarPreloadSeatAllowed, calendarSchedulingPurpose } from "../../core/src/generated/calendarFreeBusy.ts";
import { storedCalendarOwnerOptedIn, type NetworkState } from "../src/network.ts";

const REQ_TIMEOUT_MS = 1500;
const digest = (body: string) => createHash("sha256").update(body).digest("hex");

export type CalendarSchedulingTarget = { kind: "tick" } | { kind: "member"; memberId: MemberId; reschedule: boolean } | { kind: "review"; opportunityId: string };

/** Limit reads to seats whose reviewed scheduling can advance in this unit. */
export function schedulingCalendarMembers(state: NetworkState, target: CalendarSchedulingTarget, now: number): MemberId[] {
  const ids = new Set<MemberId>();
  for (const opp of state.opps) {
    const related = target.kind === "member" ? opp.participants.includes(target.memberId)
      : target.kind === "review" ? opp.id === target.opportunityId : true;
    if (!related || opp.seat) continue;
    const reviewing = opp.stage === "review" && target.kind === "review" && (opp.review?.deadline ?? 0) > now;
    const probing = opp.stage === "probing" && opp.deadline > now;
    const rescheduling = target.kind === "member" && target.reschedule;
    const statuses = new Map(opp.status);
    const pendingSeat = (id: MemberId) => opp.planRun?.answers[id] === "pending" && statuses.get(id) !== "yes"
      && calendarPreloadSeatAllowed(statuses.get(id) ?? "", true, true);
    const lateJoin = target.kind === "tick" ? opp.participants.some(pendingSeat)
      : target.kind === "member" && !rescheduling && pendingSeat(target.memberId);
    const booked = opp.stage === "scheduled" && (opp.meetingAt ?? 0) > now && (lateJoin || rescheduling);
    if (!reviewing && !(opp.review?.decision === "approve" && !opp.review.invalidated && (probing || booked))) continue;
    // spec/calendarFreeBusy.md, "A scheduling read uses only the seats still involved in that work"
    const seats = opp.participants.filter(id => calendarPreloadSeatAllowed(statuses.get(id) ?? "", booked, lateJoin && pendingSeat(id)));
    if (target.kind === "member" && !seats.includes(target.memberId)) continue;
    for (const id of seats) {
      if (storedCalendarOwnerOptedIn(state, id)) ids.add(id);
    }
  }
  return [...ids].sort();
}

export interface CalendarSchedulingBridge {
  load(owner: CalendarSchedulingOwner): Promise<CalendarSchedulingObservation | undefined>;
  ownerProof(req: Request, resolve: (input: CalendarOwnerRequest) => Promise<CalendarSchedulingOwner | undefined>): Promise<Response>;
}

export function calendarSchedulingBridgeFromEnv(env: Record<string, string | undefined>, now: () => number, send: typeof fetch = fetch): CalendarSchedulingBridge | undefined {
  const key = env.NETWORK_CALENDAR_FREE_BUSY_SECRET, rawOrigin = env.NETWORK_CLOUD_DELIVERY_ORIGIN;
  if (!key) return;
  const origin = rawOrigin ? new URL(rawOrigin) : undefined;
  if (!origin || origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/"
    || key.length < 32 || key === env.SERVICE_TURN_SECRET) throw new Error("Calendar scheduling needs its own service key and an exact HTTPS Cloud origin");
  const secret = key, cloud = origin.origin;

  return {
    async load(owner) {
      const started = now();
      if (!Number.isSafeInteger(started) || started < 0) return;
      const request: CalendarPreloadRequest = { ...owner, purpose: calendarSchedulingPurpose, nonce: randomUUID(), coverage: { start: started, end: started + calendarCoverageMaxMs } };
      const id = `calendar-read:${request.nonce}`, body = JSON.stringify(request);
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<undefined>(resolve => {
        timer = setTimeout(() => { controller.abort(); resolve(undefined); }, REQ_TIMEOUT_MS);
      });
      try {
        const read = (async () => {
          const auth = await svcSign(secret, { method: "POST", path: calendarPreloadPath, id, body, nowS: Math.floor(started / 1000) });
          const response = await send(cloud + calendarPreloadPath, { method: "POST", headers: { "Content-Type": "application/json", ...auth },
            cache: "no-store", redirect: "error", signal: controller.signal, body });
          if (response.status !== 200 || response.redirected || controller.signal.aborted) return;
          const raw = await boundedBody(response);
          if (!raw || controller.signal.aborted) return;
          const checkedAt = now();
          if (!Number.isSafeInteger(checkedAt) || checkedAt < started) return;
          const signed = await svcVerify(secret, { method: "POST", path: calendarPreloadPath, headers: response.headers, body: raw, nowS: Math.floor(checkedAt / 1000) });
          if (!signed.ok || signed.id !== `${id}:proof`) return;
          return calendarReplyObservation(JSON.parse(raw), request, digest(body), now());
        })().catch(() => undefined);
        return await Promise.race([read, deadline]);
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    },

    async ownerProof(req, resolve) {
      if (req.method !== "POST") return denied(405);
      if (new URL(req.url).search) return denied(400);
      try {
        const raw = await boundedBody(req);
        if (!raw) return denied(400);
        const checkedAt = now();
        if (!Number.isSafeInteger(checkedAt) || checkedAt < 0) return denied(503);
        const auth = await svcVerify(secret, { method: "POST", path: calendarOwnerPath, headers: req.headers, body: raw, nowS: Math.floor(checkedAt / 1000) });
        if (!auth.ok) return denied(401);
        let input: CalendarOwnerRequest | undefined;
        try { input = calendarOwnerRequest(JSON.parse(raw)); } catch { return denied(400); }
        if (!input || auth.id !== `calendar-owner:${input.nonce}`) return denied(400);
        const owner = await resolve(input);
        if (!owner || owner.app !== input.app) return denied(403);
        const issued = now();
        if (!Number.isSafeInteger(issued) || issued < checkedAt || issued - checkedAt >= calendarAuthorityLifetimeMs) return denied(503);
        const proof = calendarOwnerProof(owner, digest(raw), issued);
        const body = JSON.stringify(proof);
        const headers = await svcSign(secret, { method: "POST", path: calendarOwnerPath, id: `${auth.id}:proof`, body, nowS: Math.floor(issued / 1000) });
        const fresh = await resolve(input);
        const verifiedAt = now();
        if (!fresh || fresh.app !== owner.app || fresh.personId !== owner.personId || fresh.memberId !== owner.memberId
          || !Number.isSafeInteger(verifiedAt) || verifiedAt < issued || verifiedAt >= proof.expiresAt) return denied(403);
        return new Response(body, { headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" } });
      } catch {
        return denied(503);
      }
    },
  };
}

async function boundedBody(source: Request | Response) {
  const bytes = await readCapped(source, CALENDAR_SCHEDULING_MAX_BODY);
  return bytes === "too_large" ? undefined : new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function denied(status: number) {
  return Response.json({ error: "calendar_authority_unavailable" }, { status, headers: { "Cache-Control": "no-store" } });
}
