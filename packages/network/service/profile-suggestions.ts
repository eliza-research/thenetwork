import { parseNetworkCollectionCommand, networkCollectionDeadline, NETWORK_COLLECTION_MAX_WINDOW_MS } from "../../core/src/svc/learning-collection-command.ts";
import { createHash, randomUUID } from "node:crypto";
import type { SQL } from "bun";
import { parseProfileReviewWithdrawalProof, type ProfileReviewWithdrawalRequest,
  type ProfileReviewWithdrawalProof } from "../../core/src/svc/profile-review-withdrawal.ts";
import { parseProfileReviewDisconnectProof, parseProfileReviewDisconnectRequest,
  type ProfileReviewDisconnectRequest, type ProfileReviewDisconnectProof } from "../../core/src/svc/profile-review-disconnect.ts";
import { fold, isSensitiveTerm, type AppId } from "@thenetwork/core";

export interface ConnectionCleanupCounts { pending: number; retainedAccepted: number; linkedFacts: number }
/** Validate aggregate results and expose only the three permitted counts. */
export function cleanupCounts(counts: ConnectionCleanupCounts): ConnectionCleanupCounts | null {
  const { pending, retainedAccepted, linkedFacts } = counts;
  return [pending, retainedAccepted, linkedFacts].some(n => !Number.isSafeInteger(n) || n < 0)
    ? null : { pending, retainedAccepted, linkedFacts };
}

/** These values come from authenticated server context, never an assistant's arguments. */
export interface SuggestionOwner { userId: string; organizationId: string; personId: string; app: AppId; chatId: string }
export interface SourceSuggestion {
  /** Gmail message timestamp or Calendar event start, not the time the source was read. */
  connectionId: string; source: "gmail" | "google_calendar"; observedAt: number;
  kind: "interest" | "goal" | "availability_pattern"; value: string; tags: string[];
  confidence: number;
  scope: "agent_private" | "matchable";
}
export interface SuggestionReviewBatch {
  id: string; revision: number; status: "pending"; personId: string; app: AppId; chatId: string; expiresAt: number;
  windowStart: number; windowEnd: number; timezone: string; retainOnDisconnect: boolean;
  allowedKinds: SourceSuggestion["kind"][];
  suggestions: (Omit<SourceSuggestion, "connectionId"> & { id: string })[];
}
export interface SuggestionDecision { suggestionId: string; action: "accept" | "reject"; editedValue?: string; scope?: "agent_private" | "matchable" }
export type SuggestionDecisionResult = { kind: "denied" } | { kind: "preview"; batch: SuggestionReviewBatch } | { kind: "saved"; accepted: string[]; rejected: string[] };
/** Must recheck the existing Cloud owner/connection and its consent before each promotion. No connector lives here. */
export interface SuggestionSourceConsent {
  connectionId: string; source: SourceSuggestion["source"]; windowStart: number; windowEnd: number; timezone: string;
  allowedKinds: SourceSuggestion["kind"][]; retainOnDisconnect: boolean;
}
export type SuggestionAuthorization = (owner: SuggestionOwner, consent: SuggestionSourceConsent, tx: SQL) => Promise<boolean>;
export interface SuggestionProposal {
  windowStart: number; windowEnd: number; timezone: string; expiresAt: number; retainOnDisconnect: boolean;
  allowedKinds: SourceSuggestion["kind"][]; suggestions: SourceSuggestion[];
}
/** Internal server context, never inferred from a suggestion or a model-selected owner. */
export interface SuggestionCollectionClaim { batchId: string; turnId: string; requestSha256: string; commandSha256?: string }
/** Collection scope is authority only when it exactly matches the original explicit member turn. */
export function collectionProposalMatchesStoredCommand(input: SuggestionProposal, text: string, batchId: string, arrivedAt: number, now: number): boolean {
  const command = parseNetworkCollectionCommand(text), deadline = networkCollectionDeadline(arrivedAt, now);
  if (command?.kind !== "collect" || command.batchId !== batchId || deadline === undefined) return false;
  const s = command.scope;
  return input.windowStart === s.windowStart && input.windowEnd === s.windowEnd && input.timezone === s.timezone
    && JSON.stringify(input.allowedKinds) === JSON.stringify(s.fields) && input.retainOnDisconnect === s.retainAcceptedOnDisconnect
    && Number.isSafeInteger(input.expiresAt) && input.expiresAt > now && input.expiresAt <= deadline
    && input.suggestions.every(x => Number.isSafeInteger(x.observedAt) && s.sources.includes(x.source) && x.observedAt >= s.windowStart && x.observedAt < s.windowEnd);
}
const sensitive = (s: string) => (fold(s).match(/\p{L}+/gu) ?? []).some(isSensitiveTerm);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const valueOK = (s: unknown): s is string => typeof s === "string" && s.trim().length >= 2 && s.length <= 400
  && !/[\u0000-\u001f\u007f]/u.test(s)
  && !/(?:https?:\/\/|\b[^\s@]+@[^\s@]+\.[^\s@]+|\+?\d[\d ().-]{7,}\d)/u.test(s)
  && !sensitive(s);

/** Decode only a complete stored result. Never reconstruct an earlier response from current profile state. */
function completedCleanupCounts(value: unknown): ConnectionCleanupCounts | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join() !== "linkedFacts,pending,retainedAccepted"
    || ![v.pending, v.retainedAccepted, v.linkedFacts].every(n => Number.isSafeInteger(n) && (n as number) >= 0)) return undefined;
  return { pending: v.pending as number, retainedAccepted: v.retainedAccepted as number, linkedFacts: v.linkedFacts as number };
}

/** Private review storage; only accepted values enter the existing canonical facet table. */
export class ProfileSuggestions {
  constructor(private readonly sql: SQL, private readonly authorize: SuggestionAuthorization,
    private readonly authorizeOwner?: (owner: SuggestionOwner, tx: SQL) => Promise<boolean>,
    private readonly fence?: { now: () => number; valid: () => boolean }) {}

  private checkAuthority(batch?: { expires_at: unknown }) {
    if (!this.fence) return;
    const now = this.fence.now();
    if (!Number.isSafeInteger(now) || !this.fence.valid() || (batch && new Date(batch.expires_at as string).getTime() <= now))
      throw new Error("Suggestion authority expired during transaction");
  }

  private async owned(tx: SQL, owner: SuggestionOwner) {
    await tx`select set_config('app.app_id', ${owner.app}, true)`;
    // Use the same person-first order as canonical leave/delete operations.
    await tx`select id from platform.people where id=${owner.personId} for update`;
    const rows = await tx`select n.id,(n.account_status='active' and not n.opted_out and n.age>=18 and p.lowest_age>=18
      and m.state in ('active','onboarding') and m.review is null
      and not exists(select 1 from platform.bans b where b.person_id=p.id or b.phone_hash=p.phone_hash)
      and not exists(select 1 from platform.suppression s where s.phone_hash=p.phone_hash)
      and not exists(select 1 from platform.phone_identities ph where ph.person_id=p.id and ph.hold is not null)) as eligible
      from network.members n join platform.people p on p.id=n.person_id
      join platform.memberships m on m.person_id=p.id and m.app_id=n.app_id
      where n.app_id=${owner.app} and p.id=${owner.personId} and p.deleted_at is null
        and m.state<>'removed' for update of n, m`;
    if (rows[0] && this.authorizeOwner && !await this.authorizeOwner(owner, tx)) return undefined;
    this.checkAuthority();
    return rows[0] as { id: string; eligible: boolean } | undefined;
  }

  private async batch(tx: SQL, owner: SuggestionOwner, id: string) {
    const member = await this.owned(tx, owner);
    if (!member) return undefined;
    const rows = await tx`select * from platform.profile_suggestion_batches where id=${id} and app_id=${owner.app}
      and person_id=${owner.personId} and member_id=${member.id} and user_id=${owner.userId}
      and organization_id=${owner.organizationId} and chat_id=${owner.chatId} for update`;
    return rows[0] ? { ...rows[0], eligible: member.eligible } : undefined;
  }

  private async view(tx: SQL, b: any, now: number): Promise<SuggestionReviewBatch | null> {
    if (new Date(b.expires_at).getTime() <= now) {
      await tx`update platform.profile_suggestions set status='expired',value=null,tags='{}' where batch_id=${b.id} and status='proposed'`;
      return null;
    }
    const rows = await tx`select * from platform.profile_suggestions where batch_id=${b.id} and status='proposed' order by id`;
    return { id: b.id, revision: b.revision, status: "pending", personId: b.person_id, app: b.app_id, chatId: b.chat_id,
      expiresAt: new Date(b.expires_at).getTime(), windowStart: new Date(b.window_start).getTime(), windowEnd: new Date(b.window_end).getTime(),
      timezone: b.timezone, retainOnDisconnect: b.retain_on_disconnect, allowedKinds: b.allowed_kinds,
      suggestions: rows.map((r: any) => ({ id: r.id, source: r.source, observedAt: new Date(r.observed_at).getTime(), kind: r.kind, value: r.value, tags: r.tags, confidence: r.confidence, scope: r.privacy_scope })) };
  }

  async propose(owner: SuggestionOwner, input: SuggestionProposal, now: number, claim?: SuggestionCollectionClaim): Promise<SuggestionReviewBatch | null> {
    if (!Number.isFinite(now) || !Number.isFinite(input.windowStart) || !Number.isFinite(input.windowEnd)
      || !(input.windowStart < input.windowEnd && input.windowEnd - input.windowStart <= NETWORK_COLLECTION_MAX_WINDOW_MS && input.expiresAt > now)
      || !Number.isFinite(input.expiresAt) || typeof input.retainOnDisconnect !== "boolean"
      || !input.timezone || !input.allowedKinds.length || input.allowedKinds.some(k => !["interest", "goal", "availability_pattern"].includes(k))
      || input.suggestions.length < 1 || input.suggestions.length > 10) return null;
    try { new Intl.DateTimeFormat("en", { timeZone: input.timezone }); } catch { return null; }
    for (const s of input.suggestions) {
      if (!valueOK(s.value) || !input.allowedKinds.includes(s.kind)
        || !["gmail", "google_calendar"].includes(s.source) || !["agent_private", "matchable"].includes(s.scope)
        || !Number.isSafeInteger(s.observedAt) || s.observedAt < input.windowStart || s.observedAt >= input.windowEnd
        || (s.source === "gmail" && s.observedAt > now)
        || !Number.isFinite(s.confidence) || s.confidence < 0 || s.confidence > 1
        || !s.connectionId || s.connectionId.length > 200
        || s.tags.length > 12 || s.tags.some(t => !/^[a-z][a-z0-9_:-]{0,79}$/u.test(t) || sensitive(t.replace(/[_:]/gu, " ")))) return null;
    }
    if (claim && (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(claim.batchId)
      || !/^msg:(blooio|twilio):[^\r\n\u0000]{1,512}$/u.test(claim.turnId) || !/^[0-9a-f]{64}$/u.test(claim.requestSha256))) return null;
    return this.sql.begin(async tx => {
      const member = await this.owned(tx, owner);
      if (!member?.eligible) return null;
      // Verify stored explicit scope before consulting any source authorization.
      const id = claim?.batchId ?? randomUUID();
      let collectionTurn: any;
      if (claim) {
        [collectionTurn] = await tx`select i.response,i.action_receipts,i.request_hash,i.arrived_at,m.body
          from platform.inbound i join platform.people p on p.phone_hash=i.sender_hash and p.id=${owner.personId}
          join network.messages m on m.app_id=${owner.app} and m.member_id=${member.id} and m.id=${`in:${claim.turnId.slice(4)}`} and m.direction='inbound'
          where i.id=${claim.turnId} and i.status='done' for update of i`;
        if (collectionTurn?.response?.outcome !== 'open' || collectionTurn.response.app !== owner.app || collectionTurn.response.memberId !== member.id
          || !/^[0-9a-f]{64}$/u.test(collectionTurn.request_hash ?? '') || typeof collectionTurn.body !== 'string'
          || (claim.commandSha256 !== undefined && hash(collectionTurn.body) !== claim.commandSha256)
          || !collectionProposalMatchesStoredCommand(input, collectionTurn.body, id, new Date(collectionTurn.arrived_at).getTime(), this.fence?.now() ?? now)) return null;
      }
      for (const s of input.suggestions) if (!await this.authorize(owner, { connectionId: s.connectionId, source: s.source,
        windowStart: input.windowStart, windowEnd: input.windowEnd, timezone: input.timezone,
        allowedKinds: input.allowedKinds, retainOnDisconnect: input.retainOnDisconnect }, tx)) return null;
      this.checkAuthority({ expires_at: new Date(input.expiresAt) });
      const receiptKey = claim ? `profile-collect:${id}` : undefined;
      const inputSha256 = hash(JSON.stringify(input));
      if (claim) {
        // Existing inbound action receipts are the durable idempotency owner. Deleting a batch
        // never deletes this receipt, so replay cannot recreate erased private suggestions.
        const turn = collectionTurn;
        const prior = turn.action_receipts?.[receiptKey!];
        if (prior) {
          if (prior.state !== 'completed' || prior.requestHash !== claim.requestSha256 || prior.response?.kind !== 'profile_collection'
            || prior.response.inputSha256 !== inputSha256 || prior.response.batchId !== id) return null;
          // Owner/source were checked above in this same transaction. Do not rebind
          // identity here and accidentally replace the freshly acquired source deadline.
          const [b] = await tx`select * from platform.profile_suggestion_batches where id=${id} and app_id=${owner.app}
            and person_id=${owner.personId} and member_id=${member.id} and user_id=${owner.userId}
            and organization_id=${owner.organizationId} and chat_id=${owner.chatId} for update`;
          if (!b || b.revision !== 1) return null;
          const rows = await tx`select status from platform.profile_suggestions where batch_id=${id}`;
          if (rows.length !== input.suggestions.length || rows.some((r: any) => r.status !== 'proposed')) return null;
          const preview = await this.view(tx, b, this.fence?.now() ?? now);
          this.checkAuthority(b);
          return preview;
        }
        if (Object.keys(turn.action_receipts ?? {}).length >= 16) return null;
        // A later turn cannot reuse an erased batch UUID while its original minimal receipt remains.
        if ((await tx`select id from platform.inbound where jsonb_exists(action_receipts,${receiptKey!}) limit 1`).length) return null;
        if ((await tx`select id from platform.profile_suggestion_batches where id=${id}`).length) return null;
      }
      const [b] = await tx`insert into platform.profile_suggestion_batches(id,app_id,person_id,member_id,user_id,organization_id,chat_id,created_at,expires_at,window_start,window_end,timezone,allowed_kinds,retain_on_disconnect)
        values(${id},${owner.app},${owner.personId},${member.id},${owner.userId},${owner.organizationId},${owner.chatId},${new Date(now)},${new Date(input.expiresAt)},${new Date(input.windowStart)},${new Date(input.windowEnd)},${input.timezone},${tx.array(input.allowedKinds,"TEXT")},${input.retainOnDisconnect}) returning *`;
      for (const s of input.suggestions) await tx`insert into platform.profile_suggestions(id,batch_id,app_id,connection_id,source,observed_at,kind,confidence,value,tags,original_value_hash,privacy_scope)
        values(${randomUUID()},${id},${owner.app},${s.connectionId},${s.source},${new Date(s.observedAt)},${s.kind},${s.confidence},${s.value.trim()},${tx.array(s.tags,"TEXT")},${hash(s.value.trim())},${s.scope})`;
      if (claim) await tx`update platform.inbound set action_receipts=jsonb_set(action_receipts,array[${receiptKey!}],
        ${{ state: 'completed', requestHash: claim.requestSha256, response: { kind: 'profile_collection', inputSha256, batchId: id } }}::jsonb) where id=${claim.turnId}`;
      const preview = await this.view(tx, b, this.fence?.now() ?? now);
      this.checkAuthority(b);
      return preview;
    });
  }

  async getPendingBatch(owner: SuggestionOwner, id: string, now: number): Promise<SuggestionReviewBatch | null> {
    if (!Number.isFinite(now)) return null;
    return this.sql.begin(async tx => {
      const b = await this.batch(tx, owner, id);
      const value = b ? await this.view(tx, b, this.fence?.now() ?? now) : null;
      this.checkAuthority(value ? b : undefined);
      return value;
    });
  }

  async decide(owner: SuggestionOwner, input: { batchId: string; revision: number; decisions: SuggestionDecision[] }, now: number): Promise<SuggestionDecisionResult> {
    if (!Number.isFinite(now)) return { kind: "denied" };
    return this.sql.begin(async tx => {
      const b = await this.batch(tx, owner, input.batchId);
      if (b && new Date(b.expires_at).getTime() <= (this.fence?.now() ?? now)) {
        await tx`update platform.profile_suggestions set status='expired',value=null,tags='{}' where batch_id=${b.id} and status='proposed'`;
        return { kind: "denied" };
      }
      if (!b || b.revision !== input.revision
        || !input.decisions.length || new Set(input.decisions.map(d => d.suggestionId)).size !== input.decisions.length) return { kind: "denied" };
      const rows = await tx`select * from platform.profile_suggestions where batch_id=${b.id} order by id for update`;
      for (const d of input.decisions) {
        const s = rows.find((r: any) => r.id === d.suggestionId);
        if (!s || s.status !== "proposed" || !["accept", "reject"].includes(d.action)
          || (d.editedValue !== undefined && (d.action !== "accept" || !valueOK(d.editedValue)))
          || (d.scope !== undefined && !["agent_private", "matchable"].includes(d.scope))
          || (d.action === "accept" && (!b.eligible || !await this.authorize(owner, { connectionId: s.connection_id, source: s.source,
            windowStart: new Date(b.window_start).getTime(), windowEnd: new Date(b.window_end).getTime(), timezone: b.timezone,
            allowedKinds: b.allowed_kinds, retainOnDisconnect: b.retain_on_disconnect }, tx)))) return { kind: "denied" };
      }
      this.checkAuthority(b);
      // An edit or scope change is always a new preview, never an implicit acceptance.
      if (input.decisions.some(d => d.editedValue !== undefined || (d.scope !== undefined && d.scope !== rows.find((r: any) => r.id === d.suggestionId).privacy_scope))) {
        for (const d of input.decisions) if (d.action === "accept") await tx`update platform.profile_suggestions
          set value=coalesce(${d.editedValue?.trim() ?? null},value),privacy_scope=coalesce(${d.scope ?? null},privacy_scope),
            tags=case when ${d.editedValue !== undefined} then '{}'::text[] else tags end where id=${d.suggestionId}`;
        const [updated] = await tx`update platform.profile_suggestion_batches set revision=revision+1 where id=${b.id} returning *`;
        const preview = await this.view(tx, updated, this.fence?.now() ?? now);
        this.checkAuthority(b);
        return { kind: "preview", batch: preview! };
      }
      const accepted: string[] = [], rejected: string[] = [];
      for (const d of input.decisions) {
        this.checkAuthority(b);
        const s = rows.find((r: any) => r.id === d.suggestionId)!;
        if (d.action === "accept") {
          const factId = `source-suggestion:${s.id}`;
          await tx`insert into network.facets(app_id,id,member_id,kind,value,tags,privacy_scope,provenance,source,confidence,status,valid_from,observed_at)
            values(${owner.app},${factId},${b.member_id},${s.kind},${s.value},${tx.array(s.tags,"TEXT")},${s.privacy_scope},'inferred',${s.source},${s.confidence},'confirmed',${new Date(s.observed_at)},${new Date(s.observed_at)})`;
          await tx`update platform.profile_suggestions set status='accepted',fact_id=${factId},value=null,tags='{}' where id=${s.id}`;
          accepted.push(s.id);
        } else {
          await tx`update platform.profile_suggestions set status='rejected',value=null,tags='{}' where id=${s.id}`;
          rejected.push(s.id);
        }
      }
      await tx`update platform.profile_suggestion_batches set revision=revision+1 where id=${b.id}`;
      this.checkAuthority(b);
      return { kind: "saved", accepted, rejected };
    });
  }

  async deleteBatch(owner: SuggestionOwner, id: string): Promise<boolean> {
    return this.sql.begin(async tx => {
      const b = await this.batch(tx, owner, id);
      if (!b) return false;
      this.checkAuthority();
      await tx`delete from platform.profile_suggestion_batches where id=${b.id}`;
      this.checkAuthority();
      return true;
    });
  }

  /** Called only after the existing connector owner revokes the connection. */
  async disconnect(owner: SuggestionOwner, connectionId: string): Promise<void> {
    await this.sql.begin(async tx => {
      const member = await this.owned(tx, owner);
      if (!member) return;
      const batches = await tx`select * from platform.profile_suggestion_batches where app_id=${owner.app} and person_id=${owner.personId}
        and member_id=${member.id} and user_id=${owner.userId} and organization_id=${owner.organizationId} for update`;
      for (const b of batches) {
        const rows = await tx`select * from platform.profile_suggestions where batch_id=${b.id} and connection_id=${connectionId} for update`;
        for (const s of rows) {
          if (s.status === "accepted" && b.retain_on_disconnect) continue;
          if (s.fact_id) await tx`delete from network.facets where id=${s.fact_id} and app_id=${owner.app}`;
          await tx`update platform.profile_suggestions set status='withdrawn',value=null,tags='{}',fact_id=null where id=${s.id}`;
        }
        await tx`update platform.profile_suggestion_batches set revision=revision+1 where id=${b.id}`;
      }
    });
  }

  /** Revocation cleanup never depends on an active source-read grant. Replay consumes no mutation. */
  async applyRevokedConnection(owner: SuggestionOwner, request: ProfileReviewDisconnectRequest,
    proof: ProfileReviewDisconnectProof, fence: () => boolean): Promise<ConnectionCleanupCounts | null> {
    const denied = new Error("Revoked connection authority changed");
    const valid = () => {
      const now = this.fence?.now() ?? Date.now();
      return !!this.authorizeOwner && fence() && !!parseProfileReviewDisconnectRequest(request)
        && !!parseProfileReviewDisconnectProof(proof, request, proof.requestSha256, now)
        && owner.personId === proof.personId && owner.app === proof.app && owner.userId === proof.userId
        && owner.organizationId === proof.organizationId && owner.chatId === proof.chatId;
    };
    if (!valid()) return null;
    try {
      return await this.sql.begin(async tx => {
        const member = await this.owned(tx, owner);
        if (!member || member.id !== request.memberId || !valid()) return null;
        // Receipts are append-only; person/member locks serialize same-owner retries.
        // Do not request FOR UPDATE here: the runtime role intentionally has SELECT/INSERT only.
        const [previous] = await tx`select * from platform.profile_suggestion_connection_receipts where request_nonce=${request.requestNonce}`;
        if (previous) {
          const stored = previous.result;
          const counts = stored && typeof stored === 'object' && !Array.isArray(stored)
            && Object.keys(stored).sort().join() === 'counts,purpose,version'
            && stored.version === 1 && stored.purpose === 'network-profile-review-revoked-owner-v1'
            ? completedCleanupCounts(stored.counts) : undefined;
          if (!counts || previous.request_hash !== proof.requestSha256 || previous.event_id !== request.revokedEventId
            || previous.operation !== request.operation || previous.app_id !== owner.app || previous.person_id !== owner.personId
            || previous.member_id !== request.memberId || previous.user_id !== owner.userId || previous.organization_id !== owner.organizationId
            || previous.chat_id !== owner.chatId || previous.connection_id !== request.connectionId
            || new Date(previous.revoked_at).getTime() !== proof.revokedAt) return null;
          const current = await this.owned(tx, owner);
          return current && current.id === request.memberId && valid() ? counts : null;
        }
        const batches = await tx`select id,retain_on_disconnect from platform.profile_suggestion_batches
          where app_id=${owner.app} and person_id=${owner.personId} and member_id=${member.id}
          and user_id=${owner.userId} and organization_id=${owner.organizationId} and chat_id=${owner.chatId}
          and created_at<=${new Date(proof.revokedAt)} order by id for update`;
        for (const batch of batches) {
          const rows = await tx`select id,status,fact_id from platform.profile_suggestions
            where app_id=${owner.app} and batch_id=${batch.id} and connection_id=${request.connectionId} order by id for update`;
          let changed = false;
          for (const row of rows) {
            if (request.operation === "readback") continue;
            if (request.operation === "disconnect" && row.status === "accepted" && batch.retain_on_disconnect) continue;
            if (row.fact_id) await tx`delete from network.facets where id=${row.fact_id} and app_id=${owner.app} and member_id=${member.id}`;
            if (request.operation === "delete") await tx`delete from platform.profile_suggestions where id=${row.id} and app_id=${owner.app} and batch_id=${batch.id}`;
            else await tx`update platform.profile_suggestions set status='withdrawn',value=null,tags='{}',fact_id=null
              where id=${row.id} and app_id=${owner.app} and batch_id=${batch.id}`;
            changed = true;
          }
          if (changed) await tx`update platform.profile_suggestion_batches set revision=revision+1 where id=${batch.id} and app_id=${owner.app}`;
        }
        const [counts] = await tx`select count(*) filter(where s.status='proposed')::int as pending,
          count(*) filter(where s.status='accepted' and b.retain_on_disconnect)::int as retained_accepted,
          count(f.id)::int as linked_facts
          from platform.profile_suggestion_batches b join platform.profile_suggestions s on s.batch_id=b.id and s.app_id=b.app_id
          left join network.facets f on f.id=s.fact_id and f.app_id=b.app_id and f.member_id=b.member_id
          where b.app_id=${owner.app} and b.person_id=${owner.personId} and b.member_id=${member.id}
          and b.user_id=${owner.userId} and b.organization_id=${owner.organizationId} and b.chat_id=${owner.chatId}
          and b.created_at<=${new Date(proof.revokedAt)} and s.connection_id=${request.connectionId}`;
        const result = { pending: Number(counts.pending), retainedAccepted: Number(counts.retained_accepted), linkedFacts: Number(counts.linked_facts) };
        // Publish completion with its original result in the same transaction as the mutations.
        const receipt = await tx`insert into platform.profile_suggestion_connection_receipts
          (request_nonce,request_hash,event_id,operation,app_id,person_id,member_id,user_id,organization_id,chat_id,connection_id,revoked_at,result)
          values(${request.requestNonce},${proof.requestSha256},${request.revokedEventId},${request.operation},${owner.app},
            ${owner.personId},${member.id},${owner.userId},${owner.organizationId},${owner.chatId},${request.connectionId},${new Date(proof.revokedAt)},
            ${{ version: 1, purpose: 'network-profile-review-revoked-owner-v1', counts: result }}::jsonb)
          on conflict(request_nonce) do nothing returning request_nonce`;
        // Cross-owner/app nonce conflicts must roll back mutations, never commit via return null.
        if (!receipt.length) throw denied;
        const finalMember = await this.owned(tx, owner);
        if (!finalMember || finalMember.id !== request.memberId || !valid()) throw denied;
        return result;
      });
    } catch (error) { if (error === denied) return null; throw error; }
  }

  /** Owner-intake withdrawal V2; no OAuth-revocation assertion and no active source read. */
  async applyOwnerWithdrawal(owner: SuggestionOwner, request: ProfileReviewWithdrawalRequest,
    proof: ProfileReviewWithdrawalProof, fence: () => boolean): Promise<ConnectionCleanupCounts | null> {
    const denied = new Error("Owner withdrawal authority changed");
    const valid = () => !!this.authorizeOwner && fence()
      && !!parseProfileReviewWithdrawalProof(proof, request, proof.requestSha256, this.fence?.now() ?? Date.now())
      && owner.personId === proof.personId && owner.app === proof.app && owner.userId === proof.userId
      && owner.organizationId === proof.organizationId && owner.chatId === proof.chatId;
    if (!valid()) return null;
    try {
      return await this.sql.begin(async tx => {
        const member = await this.owned(tx, owner);
        if (!member || member.id !== request.memberId || !valid()) return null;
        const m = proof, turnId = `msg:${m.channel}:${m.messageId}`;
        const receiptKey = `profile-withdrawal-v2:${request.withdrawalId}`;
        const [turn] = await tx`select i.response,i.action_receipts,i.request_hash,i.arrived_at,msg.body
          from platform.inbound i join platform.people p on p.phone_hash=i.sender_hash and p.id=${owner.personId}
          join network.messages msg on msg.app_id=${owner.app} and msg.member_id=${member.id}
            and msg.id=${`in:${m.channel}:${m.messageId}`} and msg.direction='inbound'
          where i.id=${turnId} and i.status='done' for update of i,msg`;
        if (!turn || turn.response?.outcome !== 'open' || turn.response.app !== owner.app || turn.response.memberId !== member.id
          || !/^[a-f0-9]{64}$/u.test(turn.request_hash ?? '') || typeof turn.body !== 'string'
          || hash(turn.body) !== m.commandSha256
          || new Date(turn.arrived_at).getTime() > proof.cutoffAt
          || !Number.isFinite(new Date(turn.arrived_at).getTime())) return null;
        const receipts = turn.action_receipts ?? {};
        if (typeof receipts !== 'object' || Array.isArray(receipts)) return null;
        const identity = { state: 'completed', version: 2, purpose: 'network-profile-review-withdrawal-v2', operation: request.operation,
          requestHash: proof.requestSha256, withdrawalId: request.withdrawalId, requestNonce: request.requestNonce,
          connectionId: request.connectionId, cutoffAt: proof.cutoffAt, app: owner.app, personId: owner.personId,
          memberId: request.memberId, userId: owner.userId, organizationId: owner.organizationId, chatId: owner.chatId,
          channel: m.channel, messageId: m.messageId, commandSha256: m.commandSha256, inboundRequestHash: turn.request_hash };
        if (request.operation !== 'readback') {
          const previous = receipts[receiptKey];
          if (previous !== undefined) {
            const counts = previous && typeof previous === 'object' && !Array.isArray(previous)
              && Object.keys(previous).length === Object.keys(identity).length + 1
              && Object.entries(identity).every(([key, value]) => previous[key] === value)
              ? completedCleanupCounts(previous.result) : undefined;
            if (!counts) return null;
            const current = await this.owned(tx, owner);
            return current && current.id === request.memberId && valid() ? counts : null;
          }
          if (Object.keys(receipts).length >= 16) return null;
          // Person row is locked by owned(); the same event cannot move to another inbound turn.
          if ((await tx`select id from platform.inbound where jsonb_exists(action_receipts,${receiptKey}) limit 1`).length) return null;
        }
        const batches = await tx`select id from platform.profile_suggestion_batches where app_id=${owner.app}
          and person_id=${owner.personId} and member_id=${member.id} and user_id=${owner.userId}
          and organization_id=${owner.organizationId} and chat_id=${owner.chatId}
          and created_at<=${new Date(proof.cutoffAt)} order by id for update`;
        for (const batch of batches) {
          const rows = await tx`select id,status,fact_id from platform.profile_suggestions where app_id=${owner.app}
            and batch_id=${batch.id} and connection_id=${request.connectionId} order by id for update`;
          let changed = false;
          for (const row of rows) {
            if (request.operation === 'readback' || (request.operation === 'withdraw' && row.status !== 'proposed')) continue;
            if (request.operation === 'delete') {
              if (row.fact_id) await tx`delete from network.facets where app_id=${owner.app} and member_id=${member.id} and id=${row.fact_id}`;
              await tx`delete from platform.profile_suggestions where id=${row.id} and app_id=${owner.app} and batch_id=${batch.id}`;
            } else {
              await tx`update platform.profile_suggestions set status='withdrawn',value=null,tags='{}',fact_id=null
                where id=${row.id} and app_id=${owner.app} and batch_id=${batch.id} and status='proposed'`;
            }
            changed = true;
          }
          if (changed) await tx`update platform.profile_suggestion_batches set revision=revision+1 where id=${batch.id} and app_id=${owner.app}`;
        }
        const [count] = await tx`select count(*) filter(where s.status='proposed')::int as pending,
          count(*) filter(where s.status='accepted')::int as retained_accepted,count(f.id)::int as linked_facts
          from platform.profile_suggestion_batches b join platform.profile_suggestions s on s.batch_id=b.id and s.app_id=b.app_id
          left join network.facets f on f.id=s.fact_id and f.app_id=b.app_id and f.member_id=b.member_id
          where b.app_id=${owner.app} and b.person_id=${owner.personId} and b.member_id=${member.id}
          and b.user_id=${owner.userId} and b.organization_id=${owner.organizationId} and b.chat_id=${owner.chatId}
          and b.created_at<=${new Date(proof.cutoffAt)} and s.connection_id=${request.connectionId}`;
        const result = { pending: Number(count.pending), retainedAccepted: Number(count.retained_accepted), linkedFacts: Number(count.linked_facts) };
        if (request.operation !== 'readback') await tx`update platform.inbound set action_receipts=jsonb_set(action_receipts,array[${receiptKey}],
          ${{ ...identity, result }}::jsonb) where id=${turnId}`;
        const after = await this.owned(tx, owner);
        if (!after || after.id !== request.memberId || !valid()) throw denied;
        return result;
      });
    } catch (error) { if (error === denied) return null; throw error; }
  }

  /** Internal tick cleanup; no owner needs to return to an expired preview. */
  async expirePending(app: AppId, now: number): Promise<void> {
    if (!Number.isFinite(now)) return;
    await this.sql.begin(async tx => {
      await tx`select set_config('app.app_id', ${app}, true)`;
      await tx`with expired as (select b.id from platform.profile_suggestion_batches b where b.app_id=${app}
        and b.expires_at<=${new Date(now)} and exists(select 1 from platform.profile_suggestions s where s.batch_id=b.id and s.status='proposed')
        order by b.expires_at limit 100 for update skip locked)
        update platform.profile_suggestions s set status='expired',value=null,tags='{}'
        from expired e where s.batch_id=e.id and s.app_id=${app} and s.status='proposed'`;
    });
  }
}
