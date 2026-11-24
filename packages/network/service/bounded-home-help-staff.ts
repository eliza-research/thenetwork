import type { SQL } from "../../core/src/runtime/postgres.ts";
import { allowed, rolesFor } from "../../../apps/observatory/src/staff.ts";
import type { StaffRole, StaffUser } from "../../../apps/observatory/src/types.ts";
import type { AppId } from "../../platform/src/apps.ts";
import { readCapped } from "../../platform/src/body.ts";
import type { BoundedHomeHelp } from "../src/bounded-help.ts";
import type { HomeHelpConsentKey } from "../src/bounded-home-help-consent.ts";

const QUEUE_PATH = "/safety/home-help";
const BODY_LIMIT = 4096;
const PLAN_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const MEMBER_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$/;

type Decision = { action: "nominate" | "approve"; revision: number; helperIds: string[] } | { action: "close"; revision: number };

export type BoundedHomeHelpStaffAudit = {
  at: number;
  actor: string;
  roles: StaffRole[];
  app: AppId;
  mode: "real";
  ok: boolean;
} & ({ action: "read_bounded_home_help" } | {
  action: "decide_bounded_home_help";
  targetType: "case";
  targetId: string;
  detail: { decision: Decision["action"]; revision: number };
});

export interface BoundedHomeHelpStaffDeps {
  store: BoundedHomeHelp;
  transaction<T>(app: AppId, run: (tx: SQL) => Promise<T>): Promise<T>;
  /** Write through this transaction. A failed audit rolls back any decision. */
  writeAudit(tx: SQL, entry: BoundedHomeHelpStaffAudit): Promise<void>;
  stageConsent?(tx: SQL, key: HomeHelpConsentKey): Promise<boolean>;
  now(): number;
}

export interface BoundedHomeHelpStaffRoute {
  app: AppId;
  /** The staff router's canonical path after resolving its app scope. */
  path: string;
  /** The authenticated actor of record from the staff router. */
  user: StaffUser;
}

/** Append the staff audit through the same transaction as the read or decision. */
export async function writeBoundedHomeHelpStaffAudit(tx: SQL, entry: BoundedHomeHelpStaffAudit): Promise<void> {
  const target = entry.action === "decide_bounded_home_help" ? entry : undefined;
  await tx`insert into network.staff_audit (at, actor, roles, action, target_type, target_id, mode, ok, detail, app_id)
    values (${new Date(entry.at)}, ${entry.actor}, ${tx.array(entry.roles, "TEXT")}, ${entry.action}, ${target?.targetType ?? null},
      ${target?.targetId ?? null}, ${entry.mode}, ${entry.ok}, ${target?.detail ?? {}}::jsonb, ${entry.app})`;
}

function parseDecision(input: unknown): Decision | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input) || !Object.hasOwn(input, "action") || !Object.hasOwn(input, "revision")) return;
  if (!("action" in input) || !("revision" in input) || typeof input.revision !== "number"
    || !Number.isInteger(input.revision) || input.revision < 1 || input.revision > 2_147_483_647) return;
  if (input.action === "close" && Object.keys(input).length === 2) return { action: "close", revision: input.revision };
  if ((input.action !== "nominate" && input.action !== "approve") || Object.keys(input).length !== 3 || !Object.hasOwn(input, "helperIds") || !("helperIds" in input)
    || !Array.isArray(input.helperIds) || input.helperIds.length < 1 || input.helperIds.length > 3) return;
  const helperIds: string[] = [];
  for (const id of input.helperIds) {
    if (typeof id !== "string" || !MEMBER_ID.test(id) || helperIds.includes(id)) return;
    helperIds.push(id);
  }
  return { action: input.action, revision: input.revision, helperIds };
}

function json(status: number, value: unknown, allow?: string): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store", ...(allow ? { allow } : {}) } });
}

/** Pass the authenticated staff user. An unrelated path belongs to the surrounding router. */
export async function handleBoundedHomeHelpStaff(
  deps: BoundedHomeHelpStaffDeps, request: Request, route: BoundedHomeHelpStaffRoute,
): Promise<Response | undefined> {
  const { app, path, user } = route;
  if (path !== QUEUE_PATH && !path.startsWith(`${QUEUE_PATH}/`)) return;
  if (!user.id || !allowed(user, ["safety"], app, "real")) return json(403, { ok: false, error: "forbidden" });

  const audit = { actor: user.id, roles: [...rolesFor(user, app, "real")], app, mode: "real" as const };
  const reviewer = { app, staffId: user.id };
  if (path === QUEUE_PATH) {
    if (request.method !== "GET") return json(405, { ok: false, error: "method_not_allowed" }, "GET");
    try {
      const items = await deps.transaction(app, async tx => {
        const plans = await deps.store.listForReview(tx, reviewer);
        await deps.writeAudit(tx, { ...audit, at: deps.now(), action: "read_bounded_home_help", ok: true });
        return plans;
      });
      return json(200, { ok: true, items });
    } catch {
      return json(503, { ok: false, error: "home_help_unavailable" });
    }
  }

  if (request.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" }, "POST");
  const id = path.slice(QUEUE_PATH.length + 1);
  if (!PLAN_ID.test(id)) return json(400, { ok: false, error: "invalid_plan_id" });
  let decision: Decision | undefined;
  try {
    const bytes = await readCapped(request, BODY_LIMIT);
    if (bytes === "too_large") return json(413, { ok: false, error: "payload_too_large" });
    decision = parseDecision(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch {
    return json(400, { ok: false, error: "invalid_decision" });
  }
  if (!decision) return json(400, { ok: false, error: "invalid_decision" });

  const { action, revision } = decision;
  try {
    const result = await deps.transaction(app, async tx => {
      const key = { app, id, revision };
      const changed = decision.action === "close"
        ? await deps.store.close(tx, { ...key, actor: { kind: "reviewer", staffId: user.id } })
        : decision.action === "nominate"
          ? await deps.store.proposeRoster(tx, { ...key, helperIds: decision.helperIds })
          : await deps.store.approve(tx, { ...key, staffId: reviewer.staffId, helperIds: decision.helperIds });
      if (changed && decision.action === "approve" && deps.stageConsent && !await deps.stageConsent(tx, key)) {
        throw new Error("The approved consent roster could not be staged");
      }
      await deps.writeAudit(tx, {
        ...audit, at: deps.now(), action: "decide_bounded_home_help", targetType: "case", targetId: id,
        ok: !!changed, detail: { decision: action, revision },
      });
      return changed;
    });
    if (!result) return json(409, { ok: false, error: "plan_unavailable" });
    return json(200, result === true ? { ok: true } : { ok: true, result });
  } catch {
    return json(503, { ok: false, error: "home_help_unavailable" });
  }
}
