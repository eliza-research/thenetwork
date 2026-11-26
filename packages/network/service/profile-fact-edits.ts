import { createCipheriv, createDecipheriv, createSecretKey, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import {
  profileFactEditClearsDerived, profileFactEditDisablesSourceReplay, profileFactEditDraftCurrent, profileFactEditMayApply,
  profileFactEditMayCancel, profileFactEditMayRead, profileFactEditMayStage, profileFactEditOperationAllowed, profileFactEditTtlMs,
  type ProfileFactEditOperation,
} from "../../core/src/generated/profileFactEdit.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import type { AppId, FacetKind, PrivacyScope, Provenance } from "../../core/src/types.ts";
import { keyedHash } from "../../platform/src/phone.ts";
import { MEMBER_FACT_PAGE_SIZE, MEMBER_FACT_VALUE_LIMIT, type MemberFactChange, type MemberFactView } from "./member-fact-command.ts";

export interface ProfileFactOwner { app: AppId; memberId: string }
export type ProfileFactChange = MemberFactChange;
export type ProfileFactView = MemberFactView;
export type AppliedProfileFactEdit = {
  fact: ProfileFactView & { id: string; signupInterest: boolean };
  change: ProfileFactChange;
  previousTags: string[];
};

type FacetRow = {
  id: string; kind: FacetKind; value: string; tags: string[]; privacy_scope: PrivacyScope; provenance: Provenance; source: string | null;
  confidence: number; revision: number; valid_from: Date | null; valid_to: Date | null; observed_at: Date | null;
};
type Sealed = { nonce: Buffer; ciphertext: Buffer; auth_tag: Buffer };
type DraftRow = Sealed & { fact_reference: string; staged_at: Date; expires_at: Date };

const REFERENCE = /^pfr_[a-p]{32}$/;
const CODE = /^pfc_[a-p]{32}$/;
const UNSAFE_TEXT = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
const ALGORITHM = "aes-256-gcm";
const OPERATIONS = { correct: "CorrectFact", remove: "RemoveFact", scope: "ChangeFactScope" } as const satisfies Record<ProfileFactChange["kind"], ProfileFactEditOperation>;
const SIGNUP_INTEREST = "member-fact:signup-interest:";

function letters(hex: string): string {
  return hex.replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + Number.parseInt(digit, 16)));
}

function decodeChange(value: unknown): ProfileFactChange | undefined {
  if (!value || typeof value !== "object" || !("kind" in value)) return;
  if (value.kind === "remove") return { kind: "remove" };
  if (value.kind === "correct" && "value" in value && typeof value.value === "string") {
    const text = value.value.trim();
    if (text.length > 0 && text.length <= MEMBER_FACT_VALUE_LIMIT && !UNSAFE_TEXT.test(text)) return { kind: "correct", value: text };
  }
  if (value.kind === "scope" && "scope" in value && (value.scope === "agent_private" || value.scope === "matchable" || value.scope === "shareable")) {
    return { kind: "scope", scope: value.scope };
  }
}

export class ProfileFactEdits {
  private readonly encryptionKey;

  constructor(private readonly secret: string, private readonly now: () => number) {
    const material = Buffer.from(hkdfSync("sha256", secret, "thenetwork", "profile-fact-edit-draft-v1", 32));
    try { this.encryptionKey = createSecretKey(material); } finally { material.fill(0); }
  }

  private reference(owner: ProfileFactOwner, row: FacetRow): string {
    const identity = ["profile-fact-reference-v1", owner.app, owner.memberId, row.id, row.kind, row.value, row.tags,
      row.privacy_scope, row.provenance, row.source, row.confidence, row.revision, row.valid_from, row.valid_to, row.observed_at];
    return `pfr_${letters(keyedHash(this.secret, JSON.stringify(identity)).slice(0, 32))}`;
  }

  private view(owner: ProfileFactOwner, row: FacetRow): ProfileFactView {
    return { reference: this.reference(owner, row), kind: row.kind, value: row.value, scope: row.privacy_scope, source: row.source, provenance: row.provenance };
  }

  private eligible(tx: SQL, owner: ProfileFactOwner, now: number) {
    const at = new Date(now);
    return tx`f.app_id=${owner.app} and f.member_id=${owner.memberId} and f.status='confirmed' and f.sensitive is null
      and (f.valid_from is null or f.valid_from<=${at}) and (f.valid_to is null or f.valid_to>${at})
      and f.privacy_scope in ('agent_private','matchable','shareable')
      and f.kind in ('interest','skill','goal','desire','availability_pattern','preference','resource','trait','fact')
      and coalesce(f.source,'') not in ('staff','photo_rater','home_help_command')
      and not exists (select 1 from unnest(f.tags) tag(value) where tag.value like any(array[
        'signal:%','verify:%','appearance:%','photo:%','peon:posting:%','peon:verified%','peon:company:%','slop:zip:%','safety:%'
      ]::text[]))
      and (f.provenance in ('said','connected_source') or (f.provenance='inferred' and f.source in ('gmail','google_calendar')
        and exists (select 1 from platform.profile_suggestions s join platform.profile_suggestion_batches b
          on b.app_id=s.app_id and b.id=s.batch_id where b.app_id=f.app_id and b.member_id=f.member_id and s.fact_id=f.id and s.status='accepted')))`;
  }

  async list(tx: SQL, owner: ProfileFactOwner, offset = 0): Promise<{ facts: ProfileFactView[]; hasMore: boolean }> {
    if (!Number.isSafeInteger(offset) || offset < 0 || !profileFactEditMayRead(true, !!owner.memberId, true)) return { facts: [], hasMore: false };
    const rows = await tx<FacetRow[]>`select f.id,f.kind,f.value,f.tags,f.privacy_scope,f.provenance,f.source,f.confidence,f.revision,
      f.valid_from,f.valid_to,f.observed_at from network.facets f where ${this.eligible(tx, owner, this.now())}
      order by f.kind,f.id limit ${MEMBER_FACT_PAGE_SIZE + 1} offset ${offset}`;
    return { facts: rows.slice(0, MEMBER_FACT_PAGE_SIZE).map(row => this.view(owner, row)), hasMore: rows.length > MEMBER_FACT_PAGE_SIZE };
  }

  private async resolve(tx: SQL, owner: ProfileFactOwner, reference: string, now: number): Promise<FacetRow | undefined> {
    const rows = await tx<FacetRow[]>`select f.id,f.kind,f.value,f.tags,f.privacy_scope,f.provenance,f.source,f.confidence,f.revision,
      f.valid_from,f.valid_to,f.observed_at from network.facets f where ${this.eligible(tx, owner, now)}`;
    return rows.find(row => this.reference(owner, row) === reference);
  }

  private challengeHash(owner: ProfileFactOwner, code: string): string {
    return keyedHash(this.secret, JSON.stringify(["profile-fact-confirmation-v1", owner.app, owner.memberId, code]));
  }

  private context(owner: ProfileFactOwner, reference: string, hash: string, expiry: number): Buffer {
    return Buffer.from(JSON.stringify(["profile-fact-edit-draft-v1", owner.app, owner.memberId, reference, hash, expiry]));
  }

  private seal(change: ProfileFactChange, aad: Buffer): Sealed {
    const nonce = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.encryptionKey, nonce, { authTagLength: 16 });
    cipher.setAAD(aad);
    const clear = Buffer.from(JSON.stringify(change));
    try {
      return { nonce, ciphertext: Buffer.concat([cipher.update(clear), cipher.final()]), auth_tag: cipher.getAuthTag() };
    } finally {
      clear.fill(0);
    }
  }

  private open(owner: ProfileFactOwner, hash: string, row: DraftRow): ProfileFactChange | undefined {
    try {
      const decipher = createDecipheriv(ALGORITHM, this.encryptionKey, row.nonce, { authTagLength: 16 });
      decipher.setAAD(this.context(owner, row.fact_reference, hash, row.expires_at.getTime()));
      decipher.setAuthTag(row.auth_tag);
      const clear = decipher.update(row.ciphertext);
      try {
        decipher.final();
        return decodeChange(JSON.parse(clear.toString("utf8")));
      } finally {
        clear.fill(0);
      }
    } catch {
      return;
    }
  }

  private operationAllowed(row: FacetRow, change: ProfileFactChange): boolean {
    return (change.kind !== "correct" || row.value !== change.value) && profileFactEditOperationAllowed(
      OPERATIONS[change.kind], false, false, row.privacy_scope, change.kind === "scope" ? change.scope : row.privacy_scope,
    );
  }

  async stage(tx: SQL, owner: ProfileFactOwner, input: { reference: string; change: ProfileFactChange }): Promise<{
    code: string; expiresAt: number; fact: ProfileFactView; change: ProfileFactChange;
  } | undefined> {
    if (!REFERENCE.test(input.reference) || !owner.memberId) return;
    const change = decodeChange(input.change);
    if (!change) return;
    const now = this.now();
    const found = await this.resolve(tx, owner, input.reference, now);
    if (!found || !profileFactEditMayStage({ direct: true, ownerCurrent: true, exactFact: true,
      operationAllowed: this.operationAllowed(found, change), validInput: true })) return;
    const code = `pfc_${letters(randomBytes(16).toString("hex"))}`;
    const hash = this.challengeHash(owner, code);
    const expiresAt = now + profileFactEditTtlMs;
    const { nonce, ciphertext, auth_tag } = this.seal(change, this.context(owner, input.reference, hash, expiresAt));
    await tx`insert into platform.profile_fact_edit_drafts (app_id,member_id,fact_reference,challenge_hash,staged_at,expires_at,nonce,ciphertext,auth_tag)
      values (${owner.app},${owner.memberId},${input.reference},${hash},${new Date(now)},${new Date(expiresAt)},${nonce},${ciphertext},${auth_tag})
      on conflict (app_id,member_id) do update set fact_reference=excluded.fact_reference,challenge_hash=excluded.challenge_hash,
        staged_at=excluded.staged_at,expires_at=excluded.expires_at,nonce=excluded.nonce,ciphertext=excluded.ciphertext,auth_tag=excluded.auth_tag`;
    return { code, expiresAt, fact: this.view(owner, found), change };
  }

  private draft(tx: SQL, owner: ProfileFactOwner, hash: string, lock: boolean) {
    return tx<DraftRow[]>`select fact_reference,staged_at,expires_at,nonce,ciphertext,auth_tag from platform.profile_fact_edit_drafts
      where app_id=${owner.app} and member_id=${owner.memberId} and challenge_hash=${hash} ${lock ? tx`for update` : tx``}`;
  }

  private isLive(draft: DraftRow, now: number): boolean {
    return draft.expires_at.getTime() > now && profileFactEditDraftCurrent(draft.staged_at.getTime(), now);
  }

  async stageIsCurrent(tx: SQL, owner: ProfileFactOwner, code: string): Promise<boolean> {
    if (!CODE.test(code) || !owner.memberId) return false;
    const hash = this.challengeHash(owner, code);
    const [draft] = await this.draft(tx, owner, hash, false);
    const now = this.now();
    if (!draft || !this.isLive(draft, now)) return false;
    const change = this.open(owner, hash, draft);
    const fact = await this.resolve(tx, owner, draft.fact_reference, now);
    return !!change && !!fact && this.operationAllowed(fact, change);
  }

  private clear(tx: SQL, owner: ProfileFactOwner, hash: string) {
    return tx`delete from platform.profile_fact_edit_drafts where app_id=${owner.app} and member_id=${owner.memberId}
      and challenge_hash=${hash} returning member_id`;
  }

  async cancel(tx: SQL, owner: ProfileFactOwner, code: string): Promise<boolean> {
    if (!CODE.test(code) || !owner.memberId) return false;
    const hash = this.challengeHash(owner, code);
    const [draft] = await this.draft(tx, owner, hash, true);
    if (!draft) return false;
    await this.clear(tx, owner, hash);
    return profileFactEditMayCancel(true, true, this.isLive(draft, this.now()));
  }

  private async lockFact(tx: SQL, owner: ProfileFactOwner, fact: FacetRow): Promise<FacetRow | undefined> {
    await tx`select b.id from platform.profile_suggestion_batches b where b.app_id=${owner.app} and b.member_id=${owner.memberId}
      and exists (select 1 from platform.profile_suggestions s where s.app_id=b.app_id and s.batch_id=b.id and s.fact_id=${fact.id})
      order by b.id for update`;
    const [locked] = await tx<FacetRow[]>`select f.id,f.kind,f.value,f.tags,f.privacy_scope,f.provenance,f.source,f.confidence,f.revision,
      f.valid_from,f.valid_to,f.observed_at from network.facets f where ${this.eligible(tx, owner, this.now())} and f.id=${fact.id} for update of f`;
    return locked;
  }

  private async scrubSource(tx: SQL, owner: ProfileFactOwner, factId: string): Promise<void> {
    await tx`with cleared as (
        update platform.profile_suggestions s set status='withdrawn',fact_id=null,value=null,tags='{}',original_value_hash=''
        from platform.profile_suggestion_batches b where b.app_id=${owner.app} and b.member_id=${owner.memberId}
          and s.app_id=b.app_id and s.batch_id=b.id and s.fact_id=${factId} and s.status='accepted' returning s.batch_id
      ) update platform.profile_suggestion_batches set revision=revision+1
      where app_id=${owner.app} and id in (select batch_id from cleared)`;
  }

  async confirm(tx: SQL, owner: ProfileFactOwner, code: string): Promise<AppliedProfileFactEdit | undefined> {
    if (!CODE.test(code) || !owner.memberId) return;
    const hash = this.challengeHash(owner, code);
    const [draft] = await this.draft(tx, owner, hash, true);
    if (!draft) return;
    const now = this.now();
    const change = this.isLive(draft, now) && this.open(owner, hash, draft);
    const resolved = change && await this.resolve(tx, owner, draft.fact_reference, now);
    const fact = resolved && await this.lockFact(tx, owner, resolved);
    const confirmedAt = this.now();
    await this.clear(tx, owner, hash);
    if (!change || !fact || !this.isLive(draft, confirmedAt) || !profileFactEditMayApply({ direct: true, ownerCurrent: true,
      exactDraft: true, exactFact: true, unchanged: this.reference(owner, fact) === draft.fact_reference,
      operationAllowed: this.operationAllowed(fact, change), stagedAt: draft.staged_at.getTime(), now: confirmedAt })) return;

    const operation = OPERATIONS[change.kind];
    const clearDerived = profileFactEditClearsDerived(operation);
    const signupInterest = fact.kind === "interest" && (fact.id.startsWith(SIGNUP_INTEREST)
      || (fact.source === "web_join" && fact.id.startsWith(`${owner.memberId}:join:`)));
    if (profileFactEditDisablesSourceReplay(operation)) await this.scrubSource(tx, owner, fact.id);
    if (change.kind === "remove") {
      await tx`delete from network.facets where app_id=${owner.app} and member_id=${owner.memberId} and id=${fact.id}`;
    } else if (change.kind === "correct") {
      const id = `${signupInterest ? SIGNUP_INTEREST : "member-fact:"}${randomUUID()}`;
      await tx`update network.facets set id=${id},value=${change.value},
        tags=case when ${clearDerived} then '{}'::text[] else tags end,
        provenance='said',source='chat',confidence=1,revision=revision+1,observed_at=${new Date(confirmedAt)}
        where app_id=${owner.app} and member_id=${owner.memberId} and id=${fact.id}`;
    } else {
      await tx`update network.facets set privacy_scope=${change.scope},revision=revision+1,
        tags=case when ${clearDerived} then '{}'::text[] else tags end
        where app_id=${owner.app} and member_id=${owner.memberId} and id=${fact.id}`;
    }
    return { fact: { ...this.view(owner, fact), id: fact.id, signupInterest }, change, previousTags: fact.tags };
  }

  async purgeExpired(tx: SQL, app: AppId): Promise<void> {
    await tx`delete from platform.profile_fact_edit_drafts where app_id=${app} and expires_at<=${new Date(this.now())}`;
  }
}
