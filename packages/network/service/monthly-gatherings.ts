import { randomUUID } from "node:crypto";
import { CITY_TZ, MINUTE, localParts } from "@thenetwork/core";
import { plans } from "@thenetwork/engine";
import { monthlyGatheringReview, monthlyGatheringStaffAllowed, monthlyGatheringWindowAllowed, type GatheringPhase } from "../../core/src/generated/monthlyGathering.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import { allowed, rolesFor } from "../../../apps/observatory/src/staff.ts";
import type { StaffUser } from "../../../apps/observatory/src/types.ts";
import type { AppId } from "../../platform/src/apps.ts";
import { readCappedText } from "../../platform/src/body.ts";
import { PLAN_VENUES } from "../src/plans.ts";
import { readPublicEvents } from "./public-events.ts";

interface GatheringContext {
  app: AppId;
  city: string;
  staff: StaffUser;
  now: () => number;
  scoped: <T>(run: (tx: SQL) => Promise<T>) => Promise<T>;
}

type VenueKind = "curated" | "listing";
type GatheringStatus = "draft" | "approved" | "rejected";
interface GatheringInput {
  month: string;
  venue: { kind: VenueKind; id: string };
  startsAt: number;
  endsAt: number;
  capacity: number;
}
interface GatheringRow {
  id: string;
  month: string;
  venue_kind: VenueKind;
  venue_ref: string;
  venue_name: string;
  starts_at: Date;
  ends_at: Date;
  capacity: number;
  status: GatheringStatus;
  revision: number;
  created_at: Date;
  created_by: string;
  reviewed_at: Date | null;
  reviewed_by: string | null;
}
const phase: Record<GatheringStatus, GatheringPhase> = {
  draft: "GatheringDraft", approved: "GatheringApproved", rejected: "GatheringRejected",
};
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const VENUE_REF = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;
const GATHERING_REVIEW = /^\/gatherings\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/review$/;

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length === keys.length && keys.every(key => Object.hasOwn(record, key))) return record;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && Number.isSafeInteger(value) && Number.isFinite(new Date(value).getTime());
}

function parseDraft(value: unknown): GatheringInput | undefined {
  const draft = exactRecord(value, ["month", "venue", "startsAt", "endsAt", "capacity"]);
  const venue = exactRecord(draft?.venue, ["kind", "id"]);
  if (!draft || !venue || typeof draft.month !== "string" || !MONTH.test(draft.month)
    || (venue.kind !== "curated" && venue.kind !== "listing") || typeof venue.id !== "string" || !VENUE_REF.test(venue.id)
    || !isTimestamp(draft.startsAt) || !isTimestamp(draft.endsAt) || typeof draft.capacity !== "number" || !Number.isSafeInteger(draft.capacity)) return;
  return { month: draft.month, venue: { kind: venue.kind, id: venue.id }, startsAt: draft.startsAt, endsAt: draft.endsAt, capacity: draft.capacity };
}

export type StoredGatheringVenue = Pick<GatheringRow, "month" | "venue_kind" | "venue_ref" | "venue_name" | "starts_at" | "ends_at" | "capacity">;

function gatheringInput(row: StoredGatheringVenue): GatheringInput {
  return { month: row.month, venue: { kind: row.venue_kind, id: row.venue_ref }, startsAt: row.starts_at.getTime(), endsAt: row.ends_at.getTime(), capacity: row.capacity };
}

function gatheringView(row: GatheringRow) {
  const input = gatheringInput(row);
  return {
    ...input, id: row.id, app: "ntwrk", city: "nyc", venue: { ...input.venue, name: row.venue_name }, status: row.status, revision: row.revision,
    createdBy: row.created_by, createdAt: row.created_at.getTime(), reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at?.getTime() ?? null,
  };
}

function nyMonth(at: number): string {
  const local = localParts(at, CITY_TZ.nyc);
  return `${local.year}-${String(local.month).padStart(2, "0")}`;
}
async function publicVenueName(tx: SQL, input: GatheringInput, now: number): Promise<string | undefined> {
  const { startsAt, endsAt } = input;
  if (input.venue.kind === "curated") {
    const venue = PLAN_VENUES.find(v => v.id === input.venue.id && v.city === "nyc" && v.public);
    if (!venue || (venue.capacity ?? Infinity) < input.capacity) return;
    const slot = { start: startsAt, end: endsAt };
    const untilEnd = (endsAt - startsAt + startsAt % MINUTE) / MINUTE;
    return plans.venueOpenForSlot(venue, slot, untilEnd, CITY_TZ.nyc) ? venue.name : undefined;
  }
  const [event] = await readPublicEvents(tx, now, "nyc", input.venue.id);
  return event?.start === startsAt && event.end === endsAt ? event.listing?.venue : undefined;
}

async function gatheringVenue(tx: SQL, input: GatheringInput, now: number): Promise<string | undefined> {
  const { startsAt, endsAt } = input;
  const inMonth = input.month === nyMonth(startsAt) && input.month === nyMonth(endsAt - 1);
  const name = await publicVenueName(tx, input, now);
  return monthlyGatheringWindowAllowed(now, startsAt, endsAt, inMonth, !!name, input.capacity) ? name : undefined;
}

function response(body: object, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
export async function gatheringVenueStillCurrent(tx: SQL, row: StoredGatheringVenue, now: number): Promise<boolean> {
  return await gatheringVenue(tx, gatheringInput(row), now) === row.venue_name;
}

const failure = (error: string, status: number) => response({ ok: false, error }, status);

async function auditGathering(tx: SQL, ctx: GatheringContext, at: number, id: string, action: "create_monthly_gathering" | "approve_monthly_gathering" | "reject_monthly_gathering", revision: number, ok: boolean) {
  const roles = [...rolesFor(ctx.staff, ctx.app, "real")];
  await tx`insert into network.staff_audit (at, actor, roles, action, target_type, target_id, mode, ok, detail, app_id)
    values (${new Date(at)}, ${ctx.staff.id}, ${tx.array(roles, "TEXT")}, ${action}, 'case', ${id}, 'real', ${ok}, ${{ revision }}::jsonb, ${ctx.app})`;
}

async function createGathering(tx: SQL, input: GatheringInput, ctx: GatheringContext): Promise<Response> {
  const now = ctx.now();
  const venue = await gatheringVenue(tx, input, now);
  if (!venue) return failure("invalid_gathering", 400);
  const [row] = await tx<GatheringRow[]>`insert into network.monthly_gatherings
      (app_id, id, city, month, venue_kind, venue_ref, venue_name, starts_at, ends_at, capacity, created_by, created_at)
      values (${ctx.app}, ${randomUUID()}, 'nyc', ${input.month}, ${input.venue.kind}, ${input.venue.id}, ${venue},
        ${new Date(input.startsAt)}, ${new Date(input.endsAt)}, ${input.capacity}, ${ctx.staff.id}, ${new Date(now)})
      on conflict (app_id, city, month) where status in ('draft', 'approved') do nothing returning *`;
  if (!row) return failure("month_unavailable", 409);
  await auditGathering(tx, ctx, now, row.id, "create_monthly_gathering", row.revision, true);
  return response({ ok: true, gathering: gatheringView(row) }, 201);
}

async function reviewGathering(tx: SQL, id: string, expectedRevision: number, decision: "approve" | "reject", ctx: GatheringContext): Promise<Response> {
  const [row] = await tx<GatheringRow[]>`select * from network.monthly_gatherings
    where app_id = ${ctx.app} and id = ${id} for update`;
  if (!row) return failure("not_found", 404);
  const now = ctx.now();
  const currentWindow = decision === "approve" && row.status === "draft" && row.revision === expectedRevision
    && await gatheringVenueStillCurrent(tx, row, now);
  const result = monthlyGatheringReview(phase[row.status], row.revision, expectedRevision,
    decision === "approve" ? "ApproveGathering" : "RejectGathering", currentWindow);
  const action = decision === "approve" ? "approve_monthly_gathering" : "reject_monthly_gathering";
  if (result === "GatheringReviewRefused") {
    await auditGathering(tx, ctx, now, id, action, expectedRevision, false);
    return failure("gathering_not_reviewable", 409);
  }
  const status = result === "GatheringReviewApproved" ? "approved" : "rejected";
  const [decided] = await tx<GatheringRow[]>`update network.monthly_gatherings
    set status = ${status}, revision = revision + 1, reviewed_by = ${ctx.staff.id}, reviewed_at = ${new Date(now)}
    where app_id = ${ctx.app} and id = ${id} and status = 'draft' and revision = ${expectedRevision} returning *`;
  if (!decided) return failure("gathering_not_reviewable", 409);
  await auditGathering(tx, ctx, now, id, action, decided.revision, true);
  return response({ ok: true, gathering: gatheringView(decided) });
}
export async function handleMonthlyGatherings(req: Request, path: string, ctx: GatheringContext): Promise<Response | undefined> {
  const review = GATHERING_REVIEW.exec(path);
  if (path !== "/gatherings" && !review) return;
  if (!monthlyGatheringStaffAllowed(ctx.app === "ntwrk", ctx.city === "nyc", allowed(ctx.staff, ["admin"], ctx.app, "real"))) return failure("forbidden", 403);
  if (path === "/gatherings" && req.method === "GET") {
    const rows = await ctx.scoped(tx => tx<GatheringRow[]>`select * from network.monthly_gatherings where app_id = ${ctx.app}
      order by starts_at desc, created_at desc, id limit 120`);
    return response({ ok: true, gatherings: rows.map(gatheringView) });
  }
  if (req.method !== "POST") return failure("method_not_allowed", 405);
  let body: unknown;
  try {
    const raw = await readCappedText(req, 2048);
    if (raw === "too_large") return failure("body_too_large", 413);
    body = JSON.parse(raw);
  } catch {
    return failure("invalid_request", 400);
  }
  if (review) {
    const action = exactRecord(body, ["revision", "decision"]);
    const revision = action?.revision;
    const decision = action?.decision;
    if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0 || revision > 2_147_483_647
      || (decision !== "approve" && decision !== "reject")) return failure("invalid_review", 400);
    return ctx.scoped(tx => reviewGathering(tx, review[1]!, revision, decision, ctx));
  }
  const input = parseDraft(body);
  if (!input) return failure("invalid_gathering", 400);
  return ctx.scoped(tx => createGathering(tx, input, ctx));
}
