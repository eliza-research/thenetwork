import { parseNetworkCollectionCommand, networkCollectionDeadline, NETWORK_COLLECTION_MAX_WINDOW_MS } from "../../core/src/svc/learning-collection-command.ts";
import { createHash, randomUUID } from "node:crypto";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import {
  cleanupCoversGrant, collectionReceiptHasRoom, collectionRevisionIsOriginal, initial as initialSource, ownerCleanupUsesReceipt,
  sourceUseAllowed, step as stepSource, suggestionCleanupAction,
} from "../../core/src/generated/profileSuggestionSource.ts";
import { observedTimeAllowed, storedReviewReplays, type StoredReview } from "../../core/src/generated/profileSuggestionReview.ts";
import { batchPastRetention, suggestionPastRetention, suggestionRetentionCutoff } from "../../core/src/generated/platformRetention.ts";
import { personLedgerOptedOut } from "./consent-ledger-read.ts";
import { parseProfileReviewWithdrawalProof, type ProfileReviewWithdrawalRequest,
  type ProfileReviewWithdrawalProof } from "../../core/src/svc/profile-review-withdrawal.ts";
import { parseProfileReviewDisconnectProof, parseProfileReviewDisconnectRequest,
  type ProfileReviewDisconnectRequest, type ProfileReviewDisconnectProof } from "../../core/src/svc/profile-review-disconnect.ts";
import { canBeMatched, fold, isSensitiveTerm, type AppId } from "@thenetwork/core";
import { effectiveAgesOf } from "./snapshot.ts";

export interface SuggestionOwner { userId: string; organizationId: string; personId: string; app: AppId; chatId: string }
export interface SourceSuggestion {
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
export interface SuggestionSourceConsent {
  connectionId: string; source: SourceSuggestion["source"]; windowStart: number; windowEnd: number; timezone: string;
  allowedKinds: SourceSuggestion["kind"][]; retainOnDisconnect: boolean;
}
interface SourceGrant { issuedAt: number }
export type SuggestionAuthorization = (owner: SuggestionOwner, consent: SuggestionSourceConsent, tx: SQL) => Promise<SourceGrant | false>;
export interface SuggestionProposal {
  windowStart: number; windowEnd: number; timezone: string; expiresAt: number; retainOnDisconnect: boolean;
  allowedKinds: SourceSuggestion["kind"][]; suggestions: SourceSuggestion[];
}
export interface SuggestionCollectionClaim { batchId: string; turnId: string; requestSha256: string; commandSha256?: string }
export interface SuggestionReviewClaim { turnId: string; requestSha256: string }
export type StoredReviewResult = SuggestionDecisionResult | { kind: "deleted" };
type CleanupCounts = { pending: number; retainedAccepted: number; linkedFacts: number };
const reviewReceiptKey = (batchId: string) => `profile-review:${batchId}`;
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

function completedCleanupCounts(value: unknown): CleanupCounts | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join() !== "linkedFacts,pending,retainedAccepted"
    || ![v.pending, v.retainedAccepted, v.linkedFacts].every(n => Number.isSafeInteger(n) && (n as number) >= 0)) return undefined;
  return { pending: v.pending as number, retainedAccepted: v.retainedAccepted as number, linkedFacts: v.linkedFacts as number };
}

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

  private at(now: number): number { return this.fence?.now() ?? now; }

  private async owned(tx: SQL, owner: SuggestionOwner, now: number) {
    return await this.ownerAuthorized(tx, owner) ? this.lockedMember(tx, owner, now) : undefined;
  }

  private async ownedMember(tx: SQL, owner: SuggestionOwner): Promise<{ id: string } | undefined> {
    if (!await this.ownerAuthorized(tx, owner)) return undefined;
    await tx`select id from platform.people where id=${owner.personId} for update`;
    const row = await this.ownerRow(tx, owner, true);
    this.checkAuthority();
    return row && { id: row.id };
  }

  private async ownerAuthorized(tx: SQL, owner: SuggestionOwner): Promise<boolean> {
    await tx`select set_config('app.app_id', ${owner.app}, true)`;
    return !this.authorizeOwner || await this.authorizeOwner(owner, tx);
  }

  private async lockedMember(tx: SQL, owner: SuggestionOwner, now: number) {
    await tx`select id from platform.people where id=${owner.personId} for update`;
    const member = await this.memberRow(tx, owner, true, now);
    this.checkAuthority();
    return member;
  }

  private async memberRow(tx: SQL, owner: SuggestionOwner, lock: boolean, now: number): Promise<{ id: string; eligible: boolean } | undefined> {
    const row = await this.ownerRow(tx, owner, lock);
    if (!row) return undefined;
    const adult = canBeMatched((await effectiveAgesOf(tx, owner.app, [row.id], now)).get(row.id));
    return { id: row.id, eligible: row.eligible && adult && !await personLedgerOptedOut(tx, owner.personId, owner.app) };
  }

  private async ownerRow(tx: SQL, owner: SuggestionOwner, lock: boolean): Promise<{ id: string; eligible: boolean } | undefined> {
    const [row] = await tx<{ id: string; eligible: boolean }[]>`select n.id,(n.account_status='active' and not n.opted_out
      and m.state in ('active','onboarding') and m.review is null
      and not exists(select 1 from platform.bans b where b.person_id=p.id or b.phone_hash=p.phone_hash)
      and not exists(select 1 from platform.suppression s where s.phone_hash=p.phone_hash)
      and not exists(select 1 from platform.phone_identities ph where ph.person_id=p.id and ph.hold is not null)) as eligible
      from network.members n join platform.people p on p.id=n.person_id
      join platform.memberships m on m.person_id=p.id and m.app_id=n.app_id
      where n.app_id=${owner.app} and p.id=${owner.personId} and p.deleted_at is null
        and m.state<>'removed' ${lock ? tx`for update of n, m` : tx``}`;
    return row;
  }

  private async batch(tx: SQL, owner: SuggestionOwner, id: string, now: number) {
    const member = await this.owned(tx, owner, now);
    return member ? this.batchRow(tx, owner, member.id, id) : undefined;
  }

  private async batchRow(tx: SQL, owner: SuggestionOwner, memberId: string, id: string, lock = true) {
    const rows = await tx`select * from platform.profile_suggestion_batches where id=${id} and app_id=${owner.app}
      and person_id=${owner.personId} and member_id=${memberId} and user_id=${owner.userId}
      and organization_id=${owner.organizationId} and chat_id=${owner.chatId} ${lock ? tx`for update` : tx``}`;
    return rows[0];
  }

  private async reviewTurn(tx: SQL, owner: SuggestionOwner, memberId: string, claim: SuggestionReviewClaim) {
    const [turn] = await tx`select i.response,i.action_receipts from platform.inbound i
      join platform.people p on p.phone_hash=i.sender_hash and p.id=${owner.personId}
      where i.id=${claim.turnId} and i.status='done' for update of i`;
    return turn?.response?.outcome === "open" && turn.response.app === owner.app && turn.response.memberId === memberId
      ? turn as { action_receipts: Record<string, unknown> | null } : undefined;
  }

  private async replayReview(tx: SQL, owner: SuggestionOwner, memberId: string, batchId: string,
    stored: unknown, claim: SuggestionReviewClaim, now: number): Promise<StoredReviewResult> {
    const s = stored as { state?: unknown; requestHash?: unknown; response?: Record<string, unknown> } | null;
    const response = s && typeof s === "object" && s.state === "completed" ? s.response : undefined;
    const kinds: Record<string, StoredReview> = { saved: "StoredSaved", deleted: "StoredDeleted", preview: "StoredPreview" };
    const kind = typeof response?.kind === "string" ? kinds[response.kind] : undefined;
    if (!kind) return { kind: "denied" };
    const b = kind === "StoredPreview" ? await this.batchRow(tx, owner, memberId, batchId) : undefined;
    const t = this.at(now);
    if (!storedReviewReplays(kind, true, s!.requestHash === claim.requestSha256,
      !!b && b.revision === response!.revision, !!b && new Date(b.expires_at).getTime() > t)) return { kind: "denied" };
    const ids = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === "string") ? v as string[] : undefined;
    if (kind === "StoredSaved") {
      const accepted = ids(response!.accepted), rejected = ids(response!.rejected);
      return accepted && rejected ? { kind: "saved", accepted, rejected } : { kind: "denied" };
    }
    if (kind === "StoredDeleted") return { kind: "deleted" };
    const preview = await this.view(tx, b, t);
    return preview ? { kind: "preview", batch: preview } : { kind: "denied" };
  }

  async priorReview(owner: SuggestionOwner, batchId: string, claim: SuggestionReviewClaim, now: number): Promise<StoredReviewResult | undefined> {
    if (!Number.isFinite(now)) return { kind: "denied" };
    return this.sql.begin(async tx => {
      const member = await this.owned(tx, owner, this.at(now));
      if (!member) return undefined;
      const turn = await this.reviewTurn(tx, owner, member.id, claim);
      const prior = turn?.action_receipts?.[reviewReceiptKey(batchId)];
      if (prior === undefined) return undefined;
      const result = await this.replayReview(tx, owner, member.id, batchId, prior, claim, now);
      this.checkAuthority();
      return result;
    });
  }

  private async claimReview(tx: SQL, owner: SuggestionOwner, memberId: string, batchId: string,
    claim: SuggestionReviewClaim, now: number): Promise<StoredReviewResult | "new"> {
    const turn = await this.reviewTurn(tx, owner, memberId, claim);
    if (!turn) return { kind: "denied" };
    const receipts = turn.action_receipts ?? {};
    const prior = receipts[reviewReceiptKey(batchId)];
    if (prior !== undefined) return this.replayReview(tx, owner, memberId, batchId, prior, claim, now);
    return collectionReceiptHasRoom(Object.keys(receipts).length) ? "new" : { kind: "denied" };
  }

  private async keepReview(tx: SQL, batchId: string, claim: SuggestionReviewClaim | undefined, response: Record<string, unknown>) {
    if (claim) await tx`update platform.inbound set action_receipts=jsonb_set(action_receipts,array[${reviewReceiptKey(batchId)}],
      ${{ state: "completed", requestHash: claim.requestSha256, response }}::jsonb) where id=${claim.turnId}`;
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

  private async collectionTurn(tx: SQL, owner: SuggestionOwner, memberId: string, claim: SuggestionCollectionClaim,
    input: SuggestionProposal, batchId: string, now: number, lock: boolean) {
    const [turn] = await tx`select i.response,i.action_receipts,i.request_hash,i.arrived_at,m.body
      from platform.inbound i join platform.people p on p.phone_hash=i.sender_hash and p.id=${owner.personId}
      join network.messages m on m.app_id=${owner.app} and m.member_id=${memberId} and m.id=${`in:${claim.turnId.slice(4)}`} and m.direction='inbound'
      where i.id=${claim.turnId} and i.status='done' ${lock ? tx`for update of i` : tx``}`;
    const matches = turn?.response?.outcome === 'open' && turn.response.app === owner.app && turn.response.memberId === memberId
      && /^[0-9a-f]{64}$/u.test(turn.request_hash ?? '') && typeof turn.body === 'string'
      && (claim.commandSha256 === undefined || hash(turn.body) === claim.commandSha256)
      && collectionProposalMatchesStoredCommand(input, turn.body, batchId, new Date(turn.arrived_at).getTime(), this.at(now));
    return matches ? turn as { action_receipts: Record<string, any> | null } : undefined;
  }

  private async cleanedSinceGrant(tx: SQL, owner: SuggestionOwner, grants: { connectionId: string; issuedAt: number }[]): Promise<boolean> {
    for (const { connectionId, issuedAt } of new Map(grants.map(g => [`${g.connectionId}\u0000${g.issuedAt}`, g])).values()) {
      const revoked = await tx<{ revoked_at: Date }[]>`select revoked_at from platform.profile_suggestion_connection_receipts where app_id=${owner.app}
        and person_id=${owner.personId} and connection_id=${connectionId} and operation in ('disconnect','delete')`;
      const withdrawn = await tx<{ cutoff_at: number }[]>`select (r.value->>'cutoffAt')::float8 as cutoff_at from platform.inbound i
        join platform.people p on p.phone_hash=i.sender_hash and p.id=${owner.personId}
        cross join lateral jsonb_each(case when jsonb_typeof(i.action_receipts)='object' then i.action_receipts else '{}'::jsonb end) r
        where r.key like 'profile-withdrawal-v2:%' and r.value->>'app'=${owner.app} and r.value->>'connectionId'=${connectionId}
        and r.value->>'operation' in ('withdraw','delete') and jsonb_typeof(r.value->'cutoffAt')='number'`;
      const cutoffs = [...revoked.map(r => new Date(r.revoked_at).getTime()), ...withdrawn.map(r => Number(r.cutoff_at))];
      if (cutoffs.some(cutoffAt => Number.isFinite(cutoffAt) && cleanupCoversGrant(Math.floor(cutoffAt), issuedAt))) return true;
    }
    return false;
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
        || !observedTimeAllowed(s.source === "google_calendar", s.observedAt, now)
        || !Number.isFinite(s.confidence) || s.confidence < 0 || s.confidence > 1
        || !s.connectionId || s.connectionId.length > 200
        || s.tags.length > 12 || s.tags.some(t => !/^[a-z][a-z0-9_:-]{0,79}$/u.test(t) || sensitive(t.replace(/[_:]/gu, " ")))) return null;
    }
    if (claim && (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(claim.batchId)
      || !/^msg:(blooio|twilio):[^\r\n\u0000]{1,512}$/u.test(claim.turnId) || !/^[0-9a-f]{64}$/u.test(claim.requestSha256))) return null;
    return this.sql.begin(async tx => {
      const member = await this.ownerAuthorized(tx, owner) ? await this.memberRow(tx, owner, false, this.at(now)) : undefined;
      let collection = stepSource(initialSource, { type: "startSourceCollection", eligible: !!member?.eligible, claimed: !!claim });
      if (!member || collection.phase === "SourceDenied") return null;
      const id = claim?.batchId ?? randomUUID();
      if (claim) collection = stepSource(collection, { type: "readCollectionTurn",
        matches: !!await this.collectionTurn(tx, owner, member.id, claim, input, id, now, false) });
      if (collection.phase !== "CheckingLiveSources") return null;
      const scopeKey = (s: Pick<SourceSuggestion, "source" | "connectionId">) => `${s.source}\u0000${s.connectionId}`;
      const grants = new Map<string, number>();
      let allowed = true;
      for (const [key, s] of new Map(input.suggestions.map(s => [scopeKey(s), s]))) {
        const grant = await this.authorize(owner, { connectionId: s.connectionId, source: s.source,
          windowStart: input.windowStart, windowEnd: input.windowEnd, timezone: input.timezone,
          allowedKinds: input.allowedKinds, retainOnDisconnect: input.retainOnDisconnect }, tx);
        allowed = !!grant && Number.isSafeInteger(grant.issuedAt);
        if (!grant || !allowed) break;
        grants.set(key, grant.issuedAt);
      }
      const after = allowed ? await this.lockedMember(tx, owner, this.at(now)) : undefined;
      const collectionTurn = after && claim ? await this.collectionTurn(tx, owner, after.id, claim, input, id, now, true) : undefined;
      const cleanedSince = !!after && await this.cleanedSinceGrant(tx, owner, input.suggestions.map(s => ({ connectionId: s.connectionId, issuedAt: grants.get(scopeKey(s))! })));
      collection = stepSource(collection, { type: "readLiveSourceConsent", allowed,
        stillEligible: !!after && after.id === member.id && after.eligible && (!claim || !!collectionTurn) && !cleanedSince });
      if (collection.phase !== "ReadingCollectionReceipt") return null;
      this.checkAuthority({ expires_at: new Date(input.expiresAt) });
      const receiptKey = claim ? `profile-collect:${id}` : undefined;
      const inputSha256 = hash(JSON.stringify(input));
      const prior = claim ? collectionTurn!.action_receipts?.[receiptKey!] : undefined;
      collection = stepSource(collection, {
        type: "readCollectionReceipt",
        prior: !!prior,
        matches: !!prior && prior.state === 'completed' && prior.requestHash === claim?.requestSha256
          && prior.response?.kind === 'profile_collection' && prior.response.inputSha256 === inputSha256 && prior.response.batchId === id,
      });
      if (collection.phase === "ReplayingCollection") {
        const [b] = await tx`select * from platform.profile_suggestion_batches where id=${id} and app_id=${owner.app}
          and person_id=${owner.personId} and member_id=${member.id} and user_id=${owner.userId}
          and organization_id=${owner.organizationId} and chat_id=${owner.chatId} for update`;
        if (!b) return null;
        const rows = collectionRevisionIsOriginal(b.revision)
          ? await tx<{ status: string }[]>`select status from platform.profile_suggestions where batch_id=${id}`
          : [];
        collection = stepSource(collection, {
          type: "checkCollectionReplay", revision: b.revision,
          sameCount: rows.length === input.suggestions.length, onlyPending: rows.every(r => r.status === "proposed"),
        });
        if (collection.phase !== "CollectionReadyToReplay") return null;
        const preview = await this.view(tx, b, this.at(now));
        this.checkAuthority(b);
        return preview;
      }
      if (collection.phase !== "SavingCollection") return null;
      const receiptCount = claim ? Object.keys(collectionTurn!.action_receipts ?? {}).length : 0;
      const batchIdUnused = !receiptKey || (collectionReceiptHasRoom(receiptCount)
        && !(await tx`select 1 from platform.inbound where jsonb_exists(action_receipts,${receiptKey}) limit 1`).length
        && !(await tx`select 1 from platform.profile_suggestion_batches where id=${id}`).length);
      collection = stepSource(collection, { type: "checkCollectionSave", receiptCount, batchIdUnused });
      if (collection.phase !== "CollectionReadyToSave") return null;
      const [b] = await tx`insert into platform.profile_suggestion_batches(id,app_id,person_id,member_id,user_id,organization_id,chat_id,created_at,expires_at,window_start,window_end,timezone,allowed_kinds,retain_on_disconnect)
        values(${id},${owner.app},${owner.personId},${member.id},${owner.userId},${owner.organizationId},${owner.chatId},${new Date(now)},${new Date(input.expiresAt)},${new Date(input.windowStart)},${new Date(input.windowEnd)},${input.timezone},${tx.array(input.allowedKinds,"TEXT")},${input.retainOnDisconnect}) returning *`;
      for (const s of input.suggestions) await tx`insert into platform.profile_suggestions(id,batch_id,app_id,connection_id,source,observed_at,kind,confidence,value,tags,original_value_hash,privacy_scope,source_authorized_at)
        values(${randomUUID()},${id},${owner.app},${s.connectionId},${s.source},${new Date(s.observedAt)},${s.kind},${s.confidence},${s.value.trim()},${tx.array(s.tags,"TEXT")},${hash(s.value.trim())},${s.scope},${new Date(grants.get(scopeKey(s))!)})`;
      if (claim) await tx`update platform.inbound set action_receipts=jsonb_set(action_receipts,array[${receiptKey!}],
        ${{ state: 'completed', requestHash: claim.requestSha256, response: { kind: 'profile_collection', inputSha256, batchId: id } }}::jsonb) where id=${claim.turnId}`;
      const preview = await this.view(tx, b, this.at(now));
      this.checkAuthority(b);
      return preview;
    });
  }

  async getPendingBatch(owner: SuggestionOwner, id: string, now: number): Promise<SuggestionReviewBatch | null> {
    if (!Number.isFinite(now)) return null;
    return this.sql.begin(async tx => {
      const b = await this.batch(tx, owner, id, this.at(now));
      const value = b ? await this.view(tx, b, this.at(now)) : null;
      this.checkAuthority(value ? b : undefined);
      return value;
    });
  }

  async decide(owner: SuggestionOwner, input: { batchId: string; revision: number; decisions: SuggestionDecision[] }, now: number,
    claim?: SuggestionReviewClaim): Promise<StoredReviewResult> {
    if (!Number.isFinite(now)) return { kind: "denied" };
    return this.sql.begin(async tx => {
      const unlocked = await this.ownerAuthorized(tx, owner) ? await this.memberRow(tx, owner, false, this.at(now)) : undefined;
      const granted = unlocked ? await this.acceptGrants(tx, owner, unlocked, input) : new Set<string>();
      const member = unlocked ? await this.lockedMember(tx, owner, this.at(now)) : undefined;
      if (!member || member.id !== unlocked!.id) return { kind: "denied" };
      const claimed = claim ? await this.claimReview(tx, owner, member.id, input.batchId, claim, now) : "new";
      if (claimed !== "new") { this.checkAuthority(); return claimed; }
      const b = await this.batchRow(tx, owner, member.id, input.batchId);
      if (b && new Date(b.expires_at).getTime() <= this.at(now)) {
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
          || (d.action === "accept" && !sourceUseAllowed(granted.has(`${s.source}\u0000${s.connection_id}`), member.eligible))) return { kind: "denied" };
      }
      this.checkAuthority(b);
      if (input.decisions.some(d => d.editedValue !== undefined || (d.scope !== undefined && d.scope !== rows.find((r: any) => r.id === d.suggestionId).privacy_scope))) {
        for (const d of input.decisions) if (d.action === "accept") await tx`update platform.profile_suggestions
          set value=coalesce(${d.editedValue?.trim() ?? null},value),privacy_scope=coalesce(${d.scope ?? null},privacy_scope),
            tags=case when ${d.editedValue !== undefined} then '{}'::text[] else tags end where id=${d.suggestionId}`;
        const [updated] = await tx`update platform.profile_suggestion_batches set revision=revision+1 where id=${b.id} returning *`;
        const preview = await this.view(tx, updated, this.at(now));
        await this.keepReview(tx, b.id, claim, { kind: "preview", revision: updated.revision });
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
      await this.keepReview(tx, b.id, claim, { kind: "saved", accepted, rejected });
      this.checkAuthority(b);
      return { kind: "saved", accepted, rejected };
    });
  }

  private async acceptGrants(tx: SQL, owner: SuggestionOwner, member: { id: string; eligible: boolean },
    input: { batchId: string; decisions: SuggestionDecision[] }): Promise<Set<string>> {
    const granted = new Set<string>();
    const b = member.eligible && input.decisions.some(d => d.action === "accept")
      ? await this.batchRow(tx, owner, member.id, input.batchId, false) : undefined;
    if (!b) return granted;
    const accepted = new Set(input.decisions.filter(d => d.action === "accept").map(d => d.suggestionId));
    const rows = await tx`select id,source,connection_id from platform.profile_suggestions where batch_id=${b.id} and status='proposed' order by id`;
    for (const r of rows.filter((r: any) => accepted.has(r.id))) {
      const key = `${r.source}\u0000${r.connection_id}`;
      if (granted.has(key)) continue;
      if (!await this.authorize(owner, { connectionId: r.connection_id, source: r.source,
        windowStart: new Date(b.window_start).getTime(), windowEnd: new Date(b.window_end).getTime(), timezone: b.timezone,
        allowedKinds: b.allowed_kinds, retainOnDisconnect: b.retain_on_disconnect }, tx)) return new Set();
      granted.add(key);
    }
    return granted;
  }

  async deleteBatch(owner: SuggestionOwner, id: string, review?: { claim: SuggestionReviewClaim; now: number }): Promise<boolean> {
    return this.sql.begin(async tx => {
      const memberId = (await this.ownedMember(tx, owner))?.id;
      if (!memberId) return false;
      const claimed = review ? await this.claimReview(tx, owner, memberId, id, review.claim, review.now) : "new";
      if (claimed !== "new") { this.checkAuthority(); return claimed.kind === "deleted"; }
      const b = await this.batchRow(tx, owner, memberId, id);
      if (!b) return false;
      this.checkAuthority();
      await this.keepReview(tx, b.id, review?.claim, { kind: "deleted" });
      await tx`delete from platform.profile_suggestion_batches where id=${b.id}`;
      this.checkAuthority();
      return true;
    });
  }

  private async cleanupRows(tx: SQL, owner: SuggestionOwner, batchId: string, connectionId: string, cutoffAt: number) {
    const rows = await tx<{ id: string; status: string; fact_id: string | null; source_authorized_at: Date }[]>`select id,status,fact_id,source_authorized_at
      from platform.profile_suggestions where app_id=${owner.app} and batch_id=${batchId} and connection_id=${connectionId}
      order by id for update`;
    return rows.filter(row => cleanupCoversGrant(cutoffAt, new Date(row.source_authorized_at).getTime()));
  }

  private async cleanupCounts(tx: SQL, owner: SuggestionOwner, memberId: string, connectionId: string, cutoffAt: number,
    retainedNeedsChoice: boolean): Promise<CleanupCounts> {
    const rows = await tx<{ status: string; retain: boolean; linked: boolean; source_authorized_at: Date }[]>`select s.status,
      b.retain_on_disconnect as retain,f.id is not null as linked,s.source_authorized_at
      from platform.profile_suggestion_batches b join platform.profile_suggestions s on s.batch_id=b.id and s.app_id=b.app_id
      left join network.facets f on f.id=s.fact_id and f.app_id=b.app_id and f.member_id=b.member_id
      where b.app_id=${owner.app} and b.person_id=${owner.personId} and b.member_id=${memberId}
      and b.user_id=${owner.userId} and b.organization_id=${owner.organizationId} and b.chat_id=${owner.chatId}
      and s.connection_id=${connectionId}`;
    const covered = rows.filter(row => cleanupCoversGrant(cutoffAt, new Date(row.source_authorized_at).getTime()));
    return { pending: covered.filter(row => row.status === "proposed").length,
      retainedAccepted: covered.filter(row => row.status === "accepted" && (!retainedNeedsChoice || row.retain)).length,
      linkedFacts: covered.filter(row => row.linked).length };
  }

  async disconnect(owner: SuggestionOwner, connectionId: string): Promise<void> {
    await this.sql.begin(async tx => {
      const member = await this.ownedMember(tx, owner);
      if (!member) return;
      const batches = await tx`select * from platform.profile_suggestion_batches where app_id=${owner.app} and person_id=${owner.personId}
        and member_id=${member.id} and user_id=${owner.userId} and organization_id=${owner.organizationId} for update`;
      for (const b of batches) {
        const rows = await tx`select * from platform.profile_suggestions where batch_id=${b.id} and connection_id=${connectionId} for update`;
        for (const s of rows) {
          if (suggestionCleanupAction("disconnect", s.status, b.retain_on_disconnect) === "KeepSuggestion") continue;
          if (s.fact_id) await tx`delete from network.facets where id=${s.fact_id} and app_id=${owner.app}`;
          await tx`update platform.profile_suggestions set status='withdrawn',value=null,tags='{}',fact_id=null where id=${s.id}`;
        }
        await tx`update platform.profile_suggestion_batches set revision=revision+1 where id=${b.id}`;
      }
    });
  }

  async applyRevokedConnection(owner: SuggestionOwner, request: ProfileReviewDisconnectRequest,
    proof: ProfileReviewDisconnectProof, fence: () => boolean): Promise<CleanupCounts | null> {
    const denied = new Error("Revoked connection authority changed");
    const valid = () => !!this.fence && !!this.authorizeOwner && fence()
        && !!parseProfileReviewDisconnectRequest(request)
        && !!parseProfileReviewDisconnectProof(proof, request, proof.requestSha256, this.fence.now())
        && owner.personId === proof.personId && owner.app === proof.app && owner.userId === proof.userId
        && owner.organizationId === proof.organizationId && owner.chatId === proof.chatId;
    if (!valid()) return null;
    try {
      return await this.sql.begin(async tx => {
        const member = await this.ownedMember(tx, owner);
        const cleanup = stepSource(initialSource, {
          type: "startSourceCleanup", authorized: !!member && member.id === request.memberId && valid(), ownerWithdrawal: false,
        });
        if (!member || cleanup.phase !== "ReadingCleanupReceipt") return null;
        const [previous] = await tx`select * from platform.profile_suggestion_connection_receipts where request_nonce=${request.requestNonce}`;
        if (previous) {
          const stored = previous.result;
          const counts = stored && typeof stored === 'object' && !Array.isArray(stored)
            && Object.keys(stored).sort().join() === 'counts,purpose,version'
            && stored.version === 1 && stored.purpose === 'network-profile-review-revoked-owner-v1'
            ? completedCleanupCounts(stored.counts) : undefined;
          const replay = stepSource(cleanup, {
            type: "readCleanupReceipt", prior: true,
            matches: !!counts && previous.request_hash === proof.requestSha256 && previous.event_id === request.revokedEventId
              && previous.operation === request.operation && previous.app_id === owner.app && previous.person_id === owner.personId
              && previous.member_id === request.memberId && previous.user_id === owner.userId && previous.organization_id === owner.organizationId
              && previous.chat_id === owner.chatId && previous.connection_id === request.connectionId
              && new Date(previous.revoked_at).getTime() === proof.revokedAt,
          });
          if (!counts || replay.phase !== "ReplayingCleanup") return null;
          const current = await this.ownedMember(tx, owner);
          const confirmed = stepSource(replay, {
            type: "confirmSourceCleanup", authorized: !!current && current.id === request.memberId && valid(),
          });
          return confirmed.phase === "CleanupConfirmed" ? counts : null;
        }
        const applying = stepSource(cleanup, { type: "readCleanupReceipt", prior: false, matches: false });
        if (applying.phase !== "ApplyingCleanup") return null;
        const batches = await tx`select id,retain_on_disconnect from platform.profile_suggestion_batches
          where app_id=${owner.app} and person_id=${owner.personId} and member_id=${member.id}
          and user_id=${owner.userId} and organization_id=${owner.organizationId} and chat_id=${owner.chatId}
          order by id for update`;
        for (const batch of batches) {
          const rows = await this.cleanupRows(tx, owner, batch.id, request.connectionId, proof.revokedAt);
          let changed = false;
          for (const row of rows) {
            const action = suggestionCleanupAction(request.operation, row.status, batch.retain_on_disconnect);
            if (action === "KeepSuggestion") continue;
            if (row.fact_id) await tx`delete from network.facets where id=${row.fact_id} and app_id=${owner.app} and member_id=${member.id}`;
            if (action === "DeleteSuggestion") await tx`delete from platform.profile_suggestions where id=${row.id} and app_id=${owner.app} and batch_id=${batch.id}`;
            else await tx`update platform.profile_suggestions set status='withdrawn',value=null,tags='{}',fact_id=null
              where id=${row.id} and app_id=${owner.app} and batch_id=${batch.id}`;
            changed = true;
          }
          if (changed) await tx`update platform.profile_suggestion_batches set revision=revision+1 where id=${batch.id} and app_id=${owner.app}`;
        }
        const result = await this.cleanupCounts(tx, owner, member.id, request.connectionId, proof.revokedAt, true);
        const receipt = await tx`insert into platform.profile_suggestion_connection_receipts
          (request_nonce,request_hash,event_id,operation,app_id,person_id,member_id,user_id,organization_id,chat_id,connection_id,revoked_at,result)
          values(${request.requestNonce},${proof.requestSha256},${request.revokedEventId},${request.operation},${owner.app},
            ${owner.personId},${member.id},${owner.userId},${owner.organizationId},${owner.chatId},${request.connectionId},${new Date(proof.revokedAt)},
            ${{ version: 1, purpose: 'network-profile-review-revoked-owner-v1', counts: result }}::jsonb)
          on conflict(request_nonce) do nothing returning request_nonce`;
        if (!receipt.length) throw denied;
        const finalMember = await this.ownedMember(tx, owner);
        const confirmed = stepSource(applying, {
          type: "confirmSourceCleanup", authorized: !!finalMember && finalMember.id === request.memberId && valid(),
        });
        if (confirmed.phase !== "CleanupConfirmed") throw denied;
        return result;
      });
    } catch (error) { if (error === denied) return null; throw error; }
  }

  async applyOwnerWithdrawal(owner: SuggestionOwner, request: ProfileReviewWithdrawalRequest,
    proof: ProfileReviewWithdrawalProof, fence: () => boolean): Promise<CleanupCounts | null> {
    const denied = new Error("Owner withdrawal authority changed");
    const valid = () => !!this.fence && !!this.authorizeOwner && fence()
      && !!parseProfileReviewWithdrawalProof(proof, request, proof.requestSha256, this.fence.now())
      && owner.personId === proof.personId && owner.app === proof.app && owner.userId === proof.userId
      && owner.organizationId === proof.organizationId && owner.chatId === proof.chatId;
    if (!valid()) return null;
    try {
      return await this.sql.begin(async tx => {
        const member = await this.ownedMember(tx, owner);
        const cleanup = stepSource(initialSource, {
          type: "startSourceCleanup", authorized: !!member && member.id === request.memberId && valid(), ownerWithdrawal: true,
        });
        if (!member || cleanup.phase !== "CheckingWithdrawalTurn") return null;
        const m = proof, turnId = `msg:${m.channel}:${m.messageId}`;
        const receiptKey = `profile-withdrawal-v2:${request.withdrawalId}`;
        const [turn] = await tx`select i.response,i.action_receipts,i.request_hash,msg.body
          from platform.inbound i join platform.people p on p.phone_hash=i.sender_hash and p.id=${owner.personId}
          join network.messages msg on msg.app_id=${owner.app} and msg.member_id=${member.id}
            and msg.id=${`in:${m.channel}:${m.messageId}`} and msg.direction='inbound'
          where i.id=${turnId} and i.status='done' for update of i,msg`;
        const bound = stepSource(cleanup, {
          type: "readWithdrawalTurn",
          matches: !!turn && turn.response?.outcome === 'open' && turn.response.app === owner.app && turn.response.memberId === member.id
            && /^[a-f0-9]{64}$/u.test(turn.request_hash ?? '') && typeof turn.body === 'string'
            && hash(turn.body) === m.commandSha256,
        });
        if (bound.phase !== "ReadingCleanupReceipt") return null;
        const receipts = turn.action_receipts ?? {};
        if (typeof receipts !== 'object' || Array.isArray(receipts)) return null;
        const identity = { state: 'completed', version: 2, purpose: 'network-profile-review-withdrawal-v2', operation: request.operation,
          requestHash: proof.requestSha256, withdrawalId: request.withdrawalId, requestNonce: request.requestNonce,
          connectionId: request.connectionId, cutoffAt: proof.cutoffAt, app: owner.app, personId: owner.personId,
          memberId: request.memberId, userId: owner.userId, organizationId: owner.organizationId, chatId: owner.chatId,
          channel: m.channel, messageId: m.messageId, commandSha256: m.commandSha256, inboundRequestHash: turn.request_hash };
        const usesReceipt = ownerCleanupUsesReceipt(request.operation);
        if (usesReceipt) {
          const previous = receipts[receiptKey];
          if (previous !== undefined) {
            const counts = previous && typeof previous === 'object' && !Array.isArray(previous)
              && Object.keys(previous).length === Object.keys(identity).length + 1
              && Object.entries(identity).every(([key, value]) => previous[key] === value)
              ? completedCleanupCounts(previous.result) : undefined;
            const replay = stepSource(bound, { type: "readCleanupReceipt", prior: true, matches: !!counts });
            if (!counts || replay.phase !== "ReplayingCleanup") return null;
            const current = await this.ownedMember(tx, owner);
            const confirmed = stepSource(replay, {
              type: "confirmSourceCleanup", authorized: !!current && current.id === request.memberId && valid(),
            });
            return confirmed.phase === "CleanupConfirmed" ? counts : null;
          }
          if (Object.keys(receipts).length >= 16) return null;
          if ((await tx`select id from platform.inbound where jsonb_exists(action_receipts,${receiptKey}) limit 1`).length) return null;
        }
        const applying = stepSource(bound, { type: "readCleanupReceipt", prior: false, matches: false });
        if (applying.phase !== "ApplyingCleanup") return null;
        const batches = await tx`select id from platform.profile_suggestion_batches where app_id=${owner.app}
          and person_id=${owner.personId} and member_id=${member.id} and user_id=${owner.userId}
          and organization_id=${owner.organizationId} and chat_id=${owner.chatId}
          order by id for update`;
        for (const batch of batches) {
          const rows = await this.cleanupRows(tx, owner, batch.id, request.connectionId, proof.cutoffAt);
          let changed = false;
          for (const row of rows) {
            const action = suggestionCleanupAction(request.operation, row.status, false);
            if (action === "KeepSuggestion") continue;
            if (action === "DeleteSuggestion") {
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
        const result = await this.cleanupCounts(tx, owner, member.id, request.connectionId, proof.cutoffAt, false);
        if (usesReceipt) await tx`update platform.inbound set action_receipts=jsonb_set(action_receipts,array[${receiptKey}],
          ${{ ...identity, result }}::jsonb) where id=${turnId}`;
        const after = await this.ownedMember(tx, owner);
        const confirmed = stepSource(applying, {
          type: "confirmSourceCleanup", authorized: !!after && after.id === request.memberId && valid(),
        });
        if (confirmed.phase !== "CleanupConfirmed") throw denied;
        return result;
      });
    } catch (error) { if (error === denied) return null; throw error; }
  }

  async applyRetention(app: AppId, now: number): Promise<void> {
    if (!Number.isSafeInteger(now)) return;
    const cutoff = suggestionRetentionCutoff(now);
    await this.sql.begin(async tx => {
      await tx`select set_config('app.app_id', ${app}, true)`;
      await tx`with expired as (select b.id from platform.profile_suggestion_batches b where b.app_id=${app}
        and b.expires_at<=${new Date(now)} and exists(select 1 from platform.profile_suggestions s where s.batch_id=b.id and s.status='proposed')
        order by b.expires_at limit 100 for update skip locked)
        update platform.profile_suggestions s set status='expired',value=null,tags='{}'
        from expired e where s.batch_id=e.id and s.app_id=${app} and s.status='proposed'`;
      const rows = await tx<{ id: string; status: string; has_fact: boolean; expires_at: Date }[]>`select s.id,s.status,s.fact_id is not null as has_fact,b.expires_at
        from platform.profile_suggestions s
        join platform.profile_suggestion_batches b on b.id=s.batch_id and b.app_id=s.app_id
        where s.app_id=${app} and b.expires_at<${new Date(cutoff)} and s.status<>'proposed' and (s.status<>'accepted' or s.fact_id is null)
        order by b.expires_at limit 500 for update of s skip locked`;
      const purged = rows.filter(r => suggestionPastRetention(r.status, r.has_fact, new Date(r.expires_at).getTime(), cutoff)).map(r => r.id);
      if (purged.length) await tx`delete from platform.profile_suggestions where app_id=${app} and id in ${tx(purged)}`;
      const batches = await tx`select b.id,b.expires_at,(select count(*)::int from platform.profile_suggestions s where s.batch_id=b.id) as remaining
        from platform.profile_suggestion_batches b where b.app_id=${app} and b.expires_at<${new Date(cutoff)}
        and not exists(select 1 from platform.profile_suggestions s where s.batch_id=b.id)
        order by b.expires_at limit 500 for update of b skip locked`;
      const empty = batches.filter((b: any) => batchPastRetention(b.remaining, new Date(b.expires_at).getTime(), cutoff)).map((b: any) => b.id as string);
      if (empty.length) await tx`delete from platform.profile_suggestion_batches where app_id=${app} and id in ${tx(empty)}
        and not exists(select 1 from platform.profile_suggestions s where s.batch_id=profile_suggestion_batches.id)`;
    });
  }
}
