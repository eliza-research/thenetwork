import { seedInvitationBatchSizeAllowed, seedInvitationCitySupported, seedInvitationVouchSizeAllowed } from "../../core/src/generated/seedInvitation.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import { rolesFor } from "../../../apps/observatory/src/staff.ts";
import type { StaffUser } from "../../../apps/observatory/src/types.ts";
import type { AppId } from "../../platform/src/apps.ts";
import { normalizePhone } from "../../platform/src/phone.ts";

type SeedCity = "nyc" | "sf";

interface SeedInvitationEntry {
  e164: string;
  homeCity: SeedCity;
  vouchNote: string;
}

interface SeedInvitationBatch {
  requestId: string;
  entries: SeedInvitationEntry[];
}

const BATCH_ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

function fields(input: unknown, keys: readonly string[]): input is Record<string, unknown> {
  return !!input && typeof input === "object" && !Array.isArray(input)
    && Object.keys(input).length === keys.length && keys.every(key => Object.hasOwn(input, key));
}

function seedCity(value: unknown): value is SeedCity {
  return typeof value === "string" && seedInvitationCitySupported(value);
}

export function seedInvitationBatch(input: unknown): SeedInvitationBatch | undefined {
  if (!fields(input, ["batchId", "invitations"]) || typeof input.batchId !== "string" || !BATCH_ID.test(input.batchId)
    || !Array.isArray(input.invitations) || !seedInvitationBatchSizeAllowed(input.invitations.length)) return;
  const recipients = new Set<string>();
  const entries: SeedInvitationEntry[] = [];
  for (const value of input.invitations) {
    if (!fields(value, ["phone", "city", "vouch"]) || !seedCity(value.city) || typeof value.vouch !== "string") return;
    const e164 = normalizePhone(value.phone);
    const vouchNote = value.vouch.trim();
    if (!e164 || recipients.has(e164) || !seedInvitationVouchSizeAllowed(Buffer.byteLength(vouchNote, "utf8"))) return;
    recipients.add(e164);
    entries.push({ e164, homeCity: value.city, vouchNote });
  }
  return { requestId: input.batchId, entries };
}

/** Persist attribution to the authenticated issuer without recipient details in the staff log. */
export async function auditSeedInvitationBatch(tx: SQL, app: AppId, user: StaffUser, batchId: string, count: number, at: number): Promise<void> {
  const roles = [...rolesFor(user, app, "real")];
  await tx`insert into network.staff_audit (at, actor, roles, action, target_type, target_id, mode, ok, detail, app_id)
    values (${new Date(at)}, ${user.id}, ${tx.array(roles, "TEXT")}, 'issue_seed_invitation_batch', 'case', ${batchId}, 'real', true,
      ${{ count }}::jsonb, ${app})`;
}
