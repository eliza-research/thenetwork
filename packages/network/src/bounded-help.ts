import {
  homeHelpAlternativeKnown, homeHelpApprovalCurrent, homeHelpDraftAllowed, homeHelpOpen, homeHelpRevisionMatches, homeHelpRosterAllowed,
  homeHelpTaskKnown, initial, parseState, step, type HomeHelpAlternative, type HomeHelpPlan, type HomeHelpTask,
} from "../../core/src/generated/boundedHelp.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import type { AppId } from "../../platform/src/apps.ts";
import { NEIGHBORHOOD } from "./geo.ts";

export interface HomeHelpDraft {
  task: HomeHelpTask;
  area: string;
  alternative: HomeHelpAlternative;
  effortMinutes: number;
  startsAt: number;
  endsAt: number;
  expiresAt: number;
}

export interface HomeHelpOwner { app: AppId; requesterId: string }
export interface HomeHelpReviewer { app: AppId; staffId: string }
interface PlanId { app: AppId; id: string }
interface PlanVersion extends PlanId { revision: number }

/** The owner's acknowledgement carries no helper identity. */
export interface HomeHelpReceipt { id: string; revision: number; phase: HomeHelpPlan["phase"] }
export interface HomeHelpReviewPlan extends HomeHelpReceipt, HomeHelpOwner {
  draft: HomeHelpDraft;
  helperIds: readonly string[];
  approval?: { staffId: string; at: number };
}

/** These facts come from the authenticated service, the live Network state and its membership graph. */
export interface HomeHelpAuthority {
  /** A current adult owner authorized to request help. */
  ownerEligible(tx: SQL, owner: HomeHelpOwner): Promise<boolean>;
  /** A human with authority to review this app. */
  reviewerAuthorized(tx: SQL, reviewer: HomeHelpReviewer): Promise<boolean>;
  /** Recheck adults, consent, blocks, holds, availability, task opt-in, capacity and roster format. */
  rosterEligibility(tx: SQL, plan: { owner: HomeHelpOwner; draft: HomeHelpDraft; helperIds: readonly string[] }): Promise<{
    everyoneEligible: boolean;
    singletonPreviouslyMet: boolean;
  }>;
}

const DRAFT_FIELDS = ["task", "area", "alternative", "effortMinutes", "startsAt", "endsAt", "expiresAt"] as const;
const validTime = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value)
  && value >= 0 && value <= 8_640_000_000_000_000;
const isTask = (value: unknown): value is HomeHelpTask => typeof value === "string" && homeHelpTaskKnown(value);
const isAlternative = (value: unknown): value is HomeHelpAlternative => typeof value === "string" && homeHelpAlternativeKnown(value);
const hasDraftFields = (value: object): value is Record<(typeof DRAFT_FIELDS)[number], unknown> =>
  Object.keys(value).length === DRAFT_FIELDS.length && DRAFT_FIELDS.every(key => Object.hasOwn(value, key));

/** The caller builds this DTO from confirmed facts. Free text never enters the plan. */
export function parseHomeHelpDraft(value: unknown): HomeHelpDraft | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value) || !hasDraftFields(value)) return;
  const { task, area, alternative, effortMinutes, startsAt, endsAt, expiresAt } = value;
  if (!isTask(task) || typeof area !== "string" || !NEIGHBORHOOD.has(area) || !isAlternative(alternative)
    || typeof effortMinutes !== "number" || !Number.isSafeInteger(effortMinutes) || effortMinutes <= 0 || effortMinutes > 2_147_483_647
    || !validTime(startsAt) || !validTime(endsAt) || !validTime(expiresAt)) return;
  return { task, area, alternative, effortMinutes, startsAt, endsAt, expiresAt };
}

function exactRoster(input: unknown, owner: string): string[] | undefined {
  if (!Array.isArray(input) || !input.length || input.length > 3) return;
  const ids: string[] = [];
  for (const id of input) {
    if (typeof id !== "string" || !id || id.length > 200 || id === owner || ids.includes(id)) return;
    ids.push(id);
  }
  return ids.sort();
}

const rosterKey = (ids: readonly string[]): string => ids.length ? JSON.stringify(ids) : "";
const date = (time: number) => new Date(time);
const requestIdValid = (id: string) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id);
const planIdentityValid = (key: PlanId) => requestIdValid(key.id);

interface StoredHomeHelp {
  app_id: AppId;
  id: string;
  requester_id: string;
  phase: string;
  revision: number;
  task: string;
  area: string;
  alternative: string;
  effort_minutes: number;
  starts_at: Date;
  ends_at: Date;
  expires_at: Date;
  helper_ids: string[];
  approved_by: string | null;
  approved_at: Date | null;
}

type StoredPlan = { record: HomeHelpReviewPlan; state: HomeHelpPlan };

function decodePlan(row: StoredHomeHelp): StoredPlan | undefined {
  const draft = parseHomeHelpDraft({ task: row.task, area: row.area, alternative: row.alternative, effortMinutes: row.effort_minutes,
    startsAt: row.starts_at.getTime(), endsAt: row.ends_at.getTime(), expiresAt: row.expires_at.getTime() });
  const helpers = row.helper_ids.length ? exactRoster(row.helper_ids, row.requester_id) : [];
  if (!draft || !helpers) return;
  const state = parseState({ phase: row.phase, revision: row.revision, expiresAt: draft.expiresAt, rosterKey: rosterKey(helpers) });
  if (!state || state.phase === "NotSubmitted") return;
  const approval = row.approved_by && row.approved_at ? { staffId: row.approved_by, at: row.approved_at.getTime() } : undefined;
  return { state, record: { id: row.id, app: row.app_id, requesterId: row.requester_id, phase: state.phase, revision: state.revision,
    draft, helperIds: helpers, ...(approval ? { approval } : {}) } };
}

const receipt = (id: string, state: HomeHelpPlan): HomeHelpReceipt => ({ id, revision: state.revision, phase: state.phase });

/** Call inside the app-scoped transaction that owns the authorized request or review. */
export class BoundedHomeHelp {
  constructor(private readonly authority: HomeHelpAuthority, private readonly now: () => number) {}

  private async load(tx: SQL, key: PlanId): Promise<StoredPlan | undefined> {
    if (!planIdentityValid(key)) return;
    const [row] = await tx<StoredHomeHelp[]>`select * from network.bounded_home_help where app_id=${key.app} and id=${key.id} for update`;
    return row && decodePlan(row);
  }

  /** Match erasure's lock order. Its membership trigger must see a new plan or roster that commits first. */
  private async lockActiveMembers(tx: SQL, app: AppId, ids: string[]): Promise<boolean> {
    const people = await tx<{ id: string }[]>`select p.id from platform.people p where p.deleted_at is null
      and exists (select 1 from platform.memberships m where m.person_id=p.id and m.app_id=${app} and m.member_id in ${tx(ids)})
      order by p.id for share of p`;
    if (people.length !== ids.length) return false;
    const members = await tx`select member_id from platform.memberships where app_id=${app} and member_id in ${tx(ids)}
      and person_id in ${tx(people.map(p => p.id))} and state='active' and review is null order by member_id for share`;
    return members.length === ids.length;
  }

  private async lockRoster(tx: SQL, key: PlanId, input: unknown) {
    if (!planIdentityValid(key)) return;
    const [row] = await tx<{ requester_id: string }[]>`select requester_id from network.bounded_home_help where app_id=${key.app} and id=${key.id}`;
    if (!row) return;
    const helpers = exactRoster(input, row.requester_id);
    if (!helpers || !await this.lockActiveMembers(tx, key.app, [row.requester_id, ...helpers])) return;
    const prior = await this.load(tx, key);
    if (prior?.record.requesterId === row.requester_id) return { prior, helperIds: helpers };
  }

  private async draftAllowed(tx: SQL, input: HomeHelpOwner & { detailsConfirmed: boolean; alternativeChecked: boolean }, draft: HomeHelpDraft) {
    const eligible = await this.authority.ownerEligible(tx, input);
    return homeHelpDraftAllowed(eligible, input.detailsConfirmed, true, input.alternativeChecked,
      this.now(), draft.expiresAt, draft.startsAt, draft.endsAt, draft.effortMinutes);
  }

  private async rosterAllowed(tx: SQL, plan: HomeHelpReviewPlan, helperIds: readonly string[]): Promise<boolean> {
    const facts = await this.authority.rosterEligibility(tx, { owner: plan, draft: plan.draft, helperIds });
    return homeHelpRosterAllowed(helperIds.length, facts.singletonPreviouslyMet, facts.everyoneEligible);
  }

  async submit(tx: SQL, input: HomeHelpOwner & PlanId & { draft: unknown; detailsConfirmed: boolean; alternativeChecked: boolean }): Promise<HomeHelpReceipt | undefined> {
    const draft = parseHomeHelpDraft(input.draft);
    if (!draft || !planIdentityValid(input) || !await this.lockActiveMembers(tx, input.app, [input.requesterId])) return;
    const next = step(initial, { type: "submitHomeHelp", draftAllowed: await this.draftAllowed(tx, input, draft), expiresAt: draft.expiresAt });
    if (next === initial) return;
    const rows = await tx`insert into network.bounded_home_help (app_id,id,requester_id,phase,revision,task,area,alternative,effort_minutes,starts_at,ends_at,expires_at)
      values (${input.app},${input.id},${input.requesterId},${next.phase},${next.revision},${draft.task},${draft.area},${draft.alternative},
        ${draft.effortMinutes},${date(draft.startsAt)},${date(draft.endsAt)},${date(draft.expiresAt)})
      on conflict (app_id,id) do nothing returning id`;
    if (rows.length) return receipt(input.id, next);
    const prior = await this.load(tx, input);
    if (prior?.record.requesterId === input.requesterId && DRAFT_FIELDS.every(key => prior.record.draft[key] === draft[key])) {
      return receipt(input.id, prior.state);
    }
  }

  /** Read the owner's current safe draft before preparing a revision in the same unit. */
  async readOwnerDraft(tx: SQL, input: HomeHelpOwner & PlanVersion): Promise<HomeHelpDraft | undefined> {
    if (!planIdentityValid(input) || !await this.lockActiveMembers(tx, input.app, [input.requesterId])) return;
    const prior = await this.load(tx, input);
    if (prior?.record.requesterId !== input.requesterId || prior.state.revision !== input.revision) return;
    if (await this.authority.ownerEligible(tx, input) && homeHelpOpen(prior.state, this.now())) return prior.record.draft;
  }

  async revise(tx: SQL, input: HomeHelpOwner & PlanVersion & { draft: unknown; detailsConfirmed: boolean; alternativeChecked: boolean }): Promise<HomeHelpReceipt | undefined> {
    const draft = parseHomeHelpDraft(input.draft);
    if (!draft || !planIdentityValid(input) || !await this.lockActiveMembers(tx, input.app, [input.requesterId])) return;
    const prior = await this.load(tx, input);
    if (prior?.record.requesterId !== input.requesterId) return;
    const draftAllowed = await this.draftAllowed(tx, input, draft);
    const next = step(prior.state, { type: "reviseHomeHelp", now: this.now(), revision: input.revision, draftAllowed, expiresAt: draft.expiresAt });
    if (next === prior.state) return;
    await tx`update network.bounded_home_help set phase=${next.phase},revision=${next.revision},helper_ids='{}',approved_at=null,approved_by=null,
      task=${draft.task},area=${draft.area},alternative=${draft.alternative},effort_minutes=${draft.effortMinutes},
      starts_at=${date(draft.startsAt)},ends_at=${date(draft.endsAt)},expires_at=${date(draft.expiresAt)} where app_id=${input.app} and id=${input.id}`;
    return receipt(input.id, next);
  }

  /** The internal planner nominates current helpers. It cannot approve the resulting revision. */
  async proposeRoster(tx: SQL, input: PlanVersion & { helperIds: unknown }): Promise<HomeHelpReceipt | undefined> {
    const locked = await this.lockRoster(tx, input, input.helperIds);
    if (!locked) return;
    const { prior, helperIds } = locked;
    const rosterAllowed = await this.rosterAllowed(tx, prior.record, helperIds);
    const next = step(prior.state, { type: "setHomeHelpRoster", now: this.now(), revision: input.revision, rosterKey: rosterKey(helperIds), rosterAllowed });
    if (next === prior.state) return;
    await tx`update network.bounded_home_help set phase=${next.phase},revision=${next.revision},helper_ids=${tx.array(helperIds, "TEXT")},
      approved_at=null,approved_by=null where app_id=${input.app} and id=${input.id}`;
    return receipt(input.id, next);
  }

  async listForReview(tx: SQL, reviewer: HomeHelpReviewer): Promise<HomeHelpReviewPlan[]> {
    if (!await this.authority.reviewerAuthorized(tx, reviewer)) return [];
    const rows = await tx<StoredHomeHelp[]>`select * from network.bounded_home_help where app_id=${reviewer.app}
      and expires_at>${date(this.now())} and phase in ('AwaitingHelpers','AwaitingReview') order by expires_at,id limit 50`;
    return rows.flatMap(row => decodePlan(row)?.record ?? []);
  }

  async approve(tx: SQL, input: HomeHelpReviewer & PlanVersion & { helperIds: unknown }): Promise<HomeHelpReceipt | undefined> {
    if (!input.staffId || !await this.authority.reviewerAuthorized(tx, input)) return;
    const locked = await this.lockRoster(tx, input, input.helperIds);
    if (!locked) return;
    const { prior, helperIds } = locked;
    if (!homeHelpRevisionMatches(prior.state, input.revision, rosterKey(helperIds))) return;
    const rosterAllowed = await this.rosterAllowed(tx, prior.record, helperIds);
    const reviewerAuthorized = await this.authority.reviewerAuthorized(tx, input);
    const approvedAt = this.now();
    const next = step(prior.state, { type: "approveHomeHelp", now: approvedAt, revision: input.revision,
      rosterKey: rosterKey(helperIds), reviewerAuthorized, rosterAllowed });
    if (next === prior.state) return;
    await tx`update network.bounded_home_help set phase=${next.phase},approved_by=${input.staffId},approved_at=${date(approvedAt)}
      where app_id=${input.app} and id=${input.id}`;
    return receipt(input.id, next);
  }

  /** Read authority for this revision and roster under the caller's transaction. This does not send. */
  async currentApproval(tx: SQL, input: PlanVersion & { helperIds: unknown }): Promise<HomeHelpReviewPlan | undefined> {
    const locked = await this.lockRoster(tx, input, input.helperIds);
    if (!locked) return;
    const { prior, helperIds } = locked;
    if (!prior.record.approval || !homeHelpOpen(prior.state, this.now()) || !homeHelpRevisionMatches(prior.state, input.revision, rosterKey(helperIds))) return;
    const rosterAllowed = await this.rosterAllowed(tx, prior.record, helperIds);
    if (homeHelpApprovalCurrent(prior.state, this.now(), input.revision, rosterKey(helperIds), rosterAllowed)) return prior.record;
  }

  async close(tx: SQL, input: PlanVersion & { actor: { kind: "owner"; requesterId: string } | { kind: "reviewer"; staffId: string } }): Promise<boolean> {
    const prior = await this.load(tx, input);
    if (!prior) return false;
    const authorized = input.actor.kind === "owner"
      ? prior.record.requesterId === input.actor.requesterId
      : await this.authority.reviewerAuthorized(tx, { app: input.app, staffId: input.actor.staffId });
    const next = step(prior.state, { type: "closeHomeHelp", now: this.now(), revision: input.revision, authorized });
    return this.closeIfChanged(tx, input, prior.state, next);
  }

  async expire(tx: SQL, key: PlanId): Promise<boolean> {
    const prior = await this.load(tx, key);
    if (!prior) return false;
    const next = step(prior.state, { type: "expireHomeHelp", now: this.now() });
    return this.closeIfChanged(tx, key, prior.state, next);
  }

  private async closeIfChanged(tx: SQL, key: PlanId, prior: HomeHelpPlan, next: HomeHelpPlan): Promise<boolean> {
    if (next === prior) return false;
    await tx`update network.bounded_home_help set phase=${next.phase},helper_ids='{}',approved_at=null,approved_by=null
      where app_id=${key.app} and id=${key.id}`;
    return true;
  }
}
