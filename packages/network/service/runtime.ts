// One network ('<app>:<city>') inside the production service (service.ts holds one runtime per row
// of platform.networks). What a runtime does:
//  - Every unit of work (a tick, an inbound message, a staff action) runs under this network's own
//    PgStore advisory lock (key network-tick-<app>:<city>), loads the newest stored state and a fresh
//    snapshot of this app's rows, and saves after. A slow network never blocks another one.
//  - Every query on a network table runs in a transaction with `set_config('app.app_id', <app>, true)`
//    (scoped()), so the service works under the network_service role, whose row-level security shows
//    one app per transaction (audit network-service-M1). Every row also names its app explicitly.
//  - What a unit produced (messages, events, blocks, engine runs, network capital events, opt-outs, a
//    forget) is written in the same transaction as the Network state. With the Blooio adapter the sends
//    go into the persisted queue (platform.outbound) in that transaction too, and the queue delivers
//    after the commit, checking the platform consent ledger, the member's opt-out and the person cap
//    at send time. The dry-run adapter checks them after the commit and stores "dry_run".
//  - After a restart the state is loaded first, then the queue delivers what waits; rows a stopped
//    worker held go out again with the same provider key; rows past their time (a probe after 24 h,
//    anything after 3 days, an item that closed) are stored as expired and never sent (audit
//    network-service-2).
//  - Nothing here reads another app's rows; the person cap across apps (service.ts) goes through a
//    SECURITY DEFINER function that returns ids only.
import { DAY, LeakGuard } from "@thenetwork/core";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { calendarBridgeOwnerAllowed, calendarSchedulingPurpose } from "../../core/src/generated/calendarFreeBusy.ts";
import type { CalendarSchedulingObservation, CalendarSchedulingOwner } from "../../core/src/svc/calendar-scheduling.ts";
import { schedulingCalendarMembers, type CalendarSchedulingBridge, type CalendarSchedulingTarget } from "./calendar-scheduling.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import type { City, Clock, MemberId, WorldSnapshot } from "@thenetwork/core";
import type { RunRecord } from "@thenetwork/core";
import type { InitialInviteReceipt, NetworkContext, SimMessage } from "@thenetwork/core";
import { matchingDisabledByRegistry, startupPlan, tickRepairsProjection, tickRunsFollowup } from "../../core/src/generated/runtimeUnit.ts";
import { legacyIntentReconciliationDue } from "../../core/src/generated/standingIntentManagement.ts";
import { cofounderDeliveryAllowed, cofounderDeliveryIdPrefix, cofounderIntentEligible, cofounderPairCurrent } from "../../core/src/generated/cofounderDispatch.ts";
import { hireContactAllowed } from "../../core/src/generated/peonHireDispatch.ts";
import { slopPairContactAllowed } from "../../core/src/generated/datingRadius.ts";
import { cofounderIntentObjective } from "../../core/src/generated/cofounderIntent.ts";
import { lateArrivalRosterReady, lateArrivalText, lateArrivalWindow } from "../../core/src/generated/groupLateArrival.ts";
import { bookingNoticeReceived, canResolveAttendance, feedbackDelayMs, meetingFeedbackCandidate, restoreAttendance, settlementDelayMs } from "../../core/src/generated/meetingSettlement.ts";
import { isLateArrivalPairBooking, parseLateArrivalDeliveryId } from "../src/group-late-arrival.ts";
import { rescheduleOfferKey, RESCHEDULE_QUEUE_PREFIX } from "../src/rescheduling.ts";
import { standingIntentLive } from "../../core/src/standing-intent.ts";
import { standingEvidenceKey } from "@thenetwork/engine/src/match/standing.ts";
import { inviteJoinNoticeLifetimeMs } from "../../core/src/generated/outreachPolicy.ts";
import {
  contextFacetEligible, contextFacetLimit, contextFacetSizeLimit, contextMode, contextSinglePlayer,
  initial as initialContext, step as stepContext, type ContextMode,
} from "../../core/src/generated/sharedContext.ts";
import { bookedReminderKey, bookingNoticeReceiptKey, ConsentNetwork, gatheringRepeatOppPrefix, gatheringRepeatProbeKey, meetingFeedbackKey, presentInNyc, relayDispatchCheck, replacementProbeKey, SIM_AUTO_REVIEWER, storedCalendarOwnerOptedIn, storedInviteNoticePartyCurrent, storedLateArrivalCurrent, type NetworkOptions, type NetworkState, type StoredStandingIntentChange } from "../src/network.ts";
import { interruptionFeedbackKey } from "../src/interruption-feedback.ts";
import { planProbeReceiptSlot, probeReplyReceiptKey } from "../src/network.ts";
import { appTagFacet } from "../src/apphooks.ts";
import { hireSeatCurrent, readHireEvidence } from "../src/peon-hire-dispatch.ts";
import { lockPeerOpportunityContact } from "./peer-opportunity-admission.ts";
import type { AppliedProfileFactEdit } from "./profile-fact-edits.ts";
import type { RelayCanonical } from "../src/relay.ts";
import { loadRelayRows, PgStore, runStored, runTick, type NetworkStore } from "../src/store.ts";
import { capitalWiring, type CapitalEvent } from "../src/capital.ts";
import type { AppId, AppInfo } from "../../platform/src/apps.ts";
import { automatedFacetPredicate, effectiveParticipation, facetOf, intentOf, loadSnapshot, presenceOf } from "./snapshot.ts";
import { reconcileLegacyIntentRows } from "./standing-intent-reconciliation.ts";
import { appWiring, type AppWiring } from "./packs.ts";
import { BlooioAdapter, currentBookingReceipt, DryRunAdapter, WAITING_STATUSES, type ChannelAdapter, type Delivery, type Outbound } from "./channel.ts";
import { normalizeAddress } from "../../blooio/src/phone.ts";
import type { InboundTurn, CollectedReply, AtomicReplyReason } from "./inbox.ts";
import { BOUNDED_HOME_HELP_PROMPT } from "./bounded-home-help-intake.ts";
import { homeHelpNoticeId, lockHomeHelpNoticeRoster } from "./bounded-home-help-delivery.ts";
import { gatheringInvitationAdmission } from "./monthly-gathering-delivery.ts";
import { gatheringNoticeAdmission } from "./monthly-gathering-notices.ts";
import { currentGatheringRepeatSources, gatheringMatchSourceCurrent, lockGatheringMatchSource } from "./monthly-gathering-match-authority.ts";
import { gatheringRepeatContactAllowed } from "../../core/src/generated/gatheringRepeatDelivery.ts";
import { parseApprovedRelayPhotos, type TurnContext } from "../../core/src/svc/contract.ts";
import { ADULT_AGE, canBeMatched } from "../../core/src/policy.ts";
import { recordedChatAge } from "../../core/src/generated/memberAge.ts";
import { profileAgeCounts } from "../../core/src/generated/siteEnrollment.ts";
import { PgPeopleStore } from "../../platform/src/pg-store.ts";
import { atomicMemberReplyMatches } from "../../core/src/generated/signedInbox.ts";
import type { RecordedMemberAge } from "../../platform/src/store.ts";
import type { PhotoRelayService } from "../../platform/src/photo-relay.ts";
import type { ApprovedRelayPhoto } from "../../core/src/svc/contract.ts";
import { isDeepStrictEqual } from "node:util";
import type { Accounts } from "../../platform/src/accounts.ts";
import type { HeldMemberInvitation, ReferralJoin } from "../../platform/src/invite-links.ts";
import { inviteReviewContactToken, type InviteRelationship, type MemberInviteEvidence, type MemberInviteRequest } from "../src/invitation.ts";
import { outputLeaks } from "../../mcp/src/leaks.ts";
// The Observatory's event shape and run summaries, so the console reads what this writes.
import { eventOf, membersOf, type EventRow } from "../../observatory/src/events.ts";

import { NOT_SENT, type QueueRow, type RecipientCheck } from "../../blooio/src/outbound-queue.ts";
import { summarizeRun } from "../../observatory/src/engineCapture.ts";
import type { JobPosting } from "../src/jobs.ts";
import { JOB_INTENT } from "@thenetwork/engine/src/packs/peon/schema.ts";
import { savePosting } from "./postings.ts";

type Row = Record<string, unknown>;
interface GatheringRepeatMessage { id: string; opportunity_id: string; type: string; body: string }
interface HireContact { id: string; opportunity_id: string; type: "probe" | "proposal"; body: string }
interface StoredSendReceipt {
  id: string; member_id: string | null; opportunity_id: string | null; type: string | null;
  outbound_member_id: string | null; status: string; sent_at: Date | null; accepted_at: Date | null;
}
const cofounderRevealDeliveryId = (id: string) => `${cofounderDeliveryIdPrefix}reveal:${id}`;

export type StagedMemberInvitation =
  | { status: "review"; review: HeldMemberInvitation }
  | { status: "issued"; referral: ReferralJoin; url: string; relationship: InviteRelationship;
      evidence: MemberInviteEvidence; at: number; reviewId?: string };

const gatheringPrivateBody = { gathering_rsvp: "Private gathering RSVP", gathering_followup: "Private gathering follow-up" };
const gatheringMessage = (type?: string): type is keyof typeof gatheringPrivateBody => !!type && Object.hasOwn(gatheringPrivateBody, type);
const privateMemberMessage = (type?: string) => type === "bounded_home_help" || type === "profile_fact_edit" || type === "calendar_invite" || type === "inbox_updates" || type === "peon_candidate_search" || gatheringMessage(type) || type?.startsWith("member_invitation") === true;
const privateAtomicRequests: Partial<Record<AtomicReplyReason, string>> = {
  profile_fact_edit: "Private profile fact request.",
  calendar_invite: "Private calendar invite request.",
  peon_candidate_search: "Private job search request.",
  gathering_rsvp: `${gatheringPrivateBody.gathering_rsvp}.`,
  gathering_followup: `${gatheringPrivateBody.gathering_followup}.`,
};

/** What one unit of work produced. Written in the save transaction, then delivered. */
export interface Unit {
  inbound?: Row;
  privateInviteTurn?: true;
  privateHomeHelpTurn?: true;
  atomicReply?: AtomicReplyReason;
  memberInvitation?: StagedMemberInvitation;
  standingIntent?: StoredStandingIntentChange;
  legacyIntentState?: NetworkState;
  /** A signed member command prepares its own reply inside the save transaction. */
  memberCommand?: (tx: SQL) => Promise<void>;
  sends: Outbound[];
  events: EventRow[];
  blocks: [MemberId, MemberId][];
  runs: Row[];
  capital: CapitalEvent[];
  optOut: Map<MemberId, boolean>;
  forget: Set<MemberId>;
  collected: Set<string>;
  /** Exact source links for the signed public-event reply with this id. */
  collectedPublicLinks?: Map<string, readonly string[]>;
  /** A signed agent action's receipt (relay-endpoint.ts), completed in this unit's save transaction with its rows. */
  completeAction?: (tx: SQL) => Promise<void>;
  /** peon job postings saved in this unit (a manager's confirmed text, or staff): their rows go in the save transaction. */
  postings: JobPosting[];
  ages: StatedAge[];
  recordedAges?: (RecordedMemberAge & { memberId: MemberId })[];
}
type StatedAge = { memberId: MemberId; age: number };
const newUnit = (): Unit => ({ sends: [], events: [], blocks: [], runs: [], capital: [], optOut: new Map(), forget: new Set(), collected: new Set(), postings: [], ages: [] });

/** What the service gives each runtime: the shared connection and clock, and the checks that span apps. */
export interface RuntimeHost {
  sql: SQL;
  clock: Clock;
  instance: string;
  log: (line: string) => void;
  conversationNetworkId?(app: AppId, homeCity: string): string | undefined;
  accounts?: Pick<Accounts, "activeMembership" | "lowestAge" | "phoneHash">;
  photoRelay?: PhotoRelayService;
  /** Canonical read checks inside an existing admission transaction, without another pool lease. */
  accountsFor?(tx: SQL): Pick<Accounts, "activeMembership" | "lowestAge" | "phoneHash">;
  inboundTurn?(): InboundTurn | undefined;
  collectReplies?(tx: SQL, replies: CollectedReply[], reason?: AtomicReplyReason): Promise<void>;
  stageMemberInvitation?(rt: NetworkRuntime, request: MemberInviteRequest): StagedMemberInvitation | undefined;
  saveMemberInvitation?(tx: SQL, rt: NetworkRuntime, staged: StagedMemberInvitation): Promise<void>;
  admitExpectedInvitation?(tx: SQL, rt: NetworkRuntime, row: {id: string; to: string; text: string}): Promise<boolean>;
  claimExpectedInvitation?(tx: SQL, rt: NetworkRuntime, row: {id: string; to: string; text: string}): Promise<void>;
  homeHelpNoticeCurrent?(tx: SQL, app: AppInfo, noticeId: string, recipient: MemberId, to: string, body: string): Promise<boolean>;
  homeHelpRecipientStopped?(tx: SQL, app: AppId, memberId: MemberId): Promise<void>;
  /** Proactive sends of this batch the person-level daily cap refuses (ids). Called before delivery. */
  capRefused(rt: NetworkRuntime, batch: Outbound[]): Promise<Set<string>>;
  /** Give back the person-cap slots of sends the adapter refused (they never went out). */
  capRelease?(ids: string[]): Promise<void>;
  /** Sends of this batch to a number the platform consent ledger has opted out of this app (ids). Called before delivery. */
  consentRefused?(rt: NetworkRuntime, batch: Outbound[]): Promise<Set<string>>;
  /** The sends the adapter took (not refused or failed), after their statuses are stored. Errors are logged, never retried. */
  delivered?(rt: NetworkRuntime, sent: Outbound[]): Promise<void>;
  /** The current inbox records still authorize an immutable queued notification. */
  notificationCurrent?(id: string): Promise<boolean>;
  notificationHandoffUrl?(id: string, body: string): Promise<string | undefined>;
  notificationClaimCurrent?(tx: SQL, row: QueueRow): Promise<boolean>;
  /** After a tick that ran on this instance (the review SLA alerts, the weekly bias monitor). Errors are logged; the tick still counts. */
  afterTick?(rt: NetworkRuntime): Promise<void>;
}

export interface RuntimeOptions {
  /** '<app>:<city>' (platform.networks.id). */
  id: string;
  app: AppInfo;
  city: string;
  /**
   * The homes whose conversations this network owns (runtimeForHome). Matching stays in the network's
   * own city unless the app's wiring sets its markets: owning a conversation is not a matching market.
   */
  cities: readonly City[];
  /** platform.networks.matching_enabled: false keeps matching off whatever the stored switch says. */
  matchingAllowed: boolean;
  network?: Omit<NetworkOptions, "store" | "onEngineRun" | "app">;
  calendarScheduling?: CalendarSchedulingBridge;
  adapter?: ChannelAdapter | ((net: ConsentNetwork, rt: NetworkRuntime) => ChannelAdapter);
}

export class NetworkRuntime {
  readonly id: string;
  readonly app: AppInfo;
  readonly city: string;
  readonly cities: readonly City[];
  readonly net: ConsentNetwork;
  readonly pg: PgStore;
  readonly store: NetworkStore;
  readonly adapter: ChannelAdapter;
  /** The network capital ledger (packages/capital): every event the Network emits is recorded here and stored in network.capital_events. Its levers are not read yet. */
  readonly capital = capitalWiring(undefined, { reader: false });
  /** platform.networks.matching_enabled for this network. */
  matchingAllowed: boolean;
  /** This app's engine pack, its engine config and its hooks (packs.ts). */
  readonly wiring: AppWiring;
  private readonly calendarScheduling?: CalendarSchedulingBridge;
  private readonly calendarViews = new AsyncLocalStorage<ReadonlyMap<MemberId, CalendarSchedulingObservation>>();
  private snap?: WorldSnapshot;
  private joinedInviteeNames = new Map<string, string>();
  private initialInviteReceipts = new Map<string, InitialInviteReceipt>();
  private addrToMember = new Map<string, MemberId>();
  private memberToAddr = new Map<MemberId, string>();
  /** The unit being built. The service adds system sends (keyword confirmations) to it. */
  unit = newUnit();
  /** Sends committed with their state, waiting to be delivered (in commit order). */
  private committed: Outbound[] = [];
  /** Committed observations waiting for their follow-up projection. */
  private recordedAges: (RecordedMemberAge & { memberId: MemberId })[] = [];
  takeRecordedAges(memberId: MemberId): RecordedMemberAge[] {
    const mine = this.recordedAges.filter(a => a.memberId === memberId);
    this.recordedAges = this.recordedAges.filter(a => a.memberId !== memberId);
    return mine;
  }
  /** Who the inbound message being handled came from: sends to them are direct replies. */
  replyingTo?: MemberId;
  /** Message ids are unique across restarts and instances: `${member}:${time}:${nonce}${seq}`. */
  private readonly nonce = randomUUID().slice(0, 8);
  private seq = 0;
  lastTick?: { at: number; ran: boolean };

  constructor(private readonly host: RuntimeHost, o: RuntimeOptions) {
    this.id = o.id; this.app = o.app; this.city = o.city; this.cities = o.cities; this.matchingAllowed = o.matchingAllowed;
    this.pg = new PgStore(host.sql, o.id);
    this.store = this.serviceStore();
    this.wiring = appWiring(o.app.id);
    this.calendarScheduling = o.network?.calendarFreeBusy ? undefined : o.calendarScheduling;
    const w = this.wiring;
    this.net = new ConsentNetwork({
      matchingEnabled: false,
      // The app's pack and the engine config it was tuned with (options may override single fields).
      ...(w.pack ? { pack: w.pack } : {}), ...(w.hooks ? { hooks: w.hooks } : {}), ...(w.plansConfig ? { plansConfig: w.plansConfig } : {}), ...(w.plans !== undefined ? { plans: w.plans } : {}),
      ...o.network,
      ...(this.calendarScheduling ? { calendarFreeBusy: scope => scope.app === this.app.id && scope.purpose === calendarSchedulingPurpose ? this.calendarViews.getStore()?.get(scope.memberId) : undefined } : {}),
      engine: { cities: o.cities.filter(c => c === o.city), ...w.engine, ...o.network?.engine },
      app: o.app, review: "human", store: this.store,
      onEngineRun: (log, proposals, at) => {
        const s = summarizeRun(log, proposals, { at, city: this.city as City, wallMs: Math.round(log.timingsMs.total ?? 0) });
        this.unit.runs.push({ id: this.app.id === "ntwrk" ? s.id : `${this.app.id}.${s.id}`, app_id: this.app.id, at: new Date(at), city: this.city, engine_version: s.engineVersion, proposals: s.proposals, wall_ms: s.wallMs, summary: s });
      },
      onLedger: e => { this.capital.onLedger(e); this.unit.capital.push(e); },
      onAgeStated: (memberId, age, o) => {
        if (profileAgeCounts(o.explicit, o.declined, canBeMatched(age))) {
          this.unit.ages.push({ memberId, age: recordedChatAge(age, this.app.minJoinAge, o.declined) });
        }
      },
      // peon (#9): a posting the manager confirmed (or staff saved) is written with the unit (writeUnit).
      onPosting: p => { this.unit.postings.push(p); },
      memberInviteTurnAllowed: (memberId, messageId) => this.signedMemberTurn(memberId, messageId),
      lateArrivalTurnAllowed: (memberId, messageId) => this.signedMemberTurn(memberId, messageId),
      onPrivateInviteTurn: (memberId, messageId) => {
        if (this.signedMemberTurn(memberId, messageId)) this.unit.privateInviteTurn = true;
      },
      homeHelpIntakePrompt: memberId => {
        if (!this.signedMemberTurn(memberId)) return;
        this.unit.privateHomeHelpTurn = true;
        return BOUNDED_HOME_HELP_PROMPT;
      },
      issueMemberInvite: request => {
        const staged = this.host.stageMemberInvitation?.(this, request);
        if (!staged) return;
        this.unit.memberInvitation = staged;
        return staged.status === "issued" ? { status: "issued", url: staged.url } : { status: "review", reviewId: staged.review.id };
      },
    });
    this.net.init(this.context());
    this.adapter = typeof o.adapter === "function" ? o.adapter(this.net, this) : o.adapter ?? new DryRunAdapter(host.log);
    this.adapter.attach?.(this);
  }

  private get sql() { return this.host.sql; }
  private get clock() { return this.host.clock; }
  /** The service's connection pool (the persisted queue writes platform.outbound with it). */
  get db(): SQL { return this.host.sql; }
  /** This instance's name (the queue's lease owner). */
  get instance(): string { return this.host.instance; }

  // ------------------------------------------------------------------ send-time checks of the persisted queue
  async notificationCurrent(id: string): Promise<boolean> {
    return this.host.notificationCurrent ? this.host.notificationCurrent(id) : false;
  }

  notificationHandoffUrl(id: string, body: string): Promise<string | undefined> {
    return this.host.notificationHandoffUrl?.(id, body) ?? Promise.resolve(undefined);
  }

  async notificationClaimCurrent(tx: SQL, row: QueueRow): Promise<boolean> {
    return this.host.notificationClaimCurrent ? this.host.notificationClaimCurrent(tx, row) : false;
  }

  /** Consent at send time for one queued message: the platform consent ledger (and bans), then the member's own opt-out. */
  async optedOut(id: string, memberId: MemberId | undefined, to: string): Promise<boolean> {
    // The platform consent ledger, suppression and bans by address: also for a direct text to a non-member.
    const probe: Outbound = { id, memberId: memberId ?? ("" as MemberId), to, body: "", kind: "transactional", proactive: false, system: false, ts: this.clock.now() };
    if ((await this.host.consentRefused?.(this, [probe]))?.has(id)) return true;
    if (!memberId) return false;
    const [r] = await this.scoped(tx => tx`select opted_out from network.members where app_id = ${this.app.id} and id = ${memberId}`);
    return r?.opted_out === true;
  }
  /** The person cap at send time (a proactive message): true when the slot was taken. */
  async capTake(id: string, memberId: MemberId): Promise<boolean> {
    const probe: Outbound = { id, memberId, body: "", kind: "proactive", proactive: true, system: false, ts: this.clock.now() };
    return !(await this.host.capRefused(this, [probe])).has(id);
  }
  async capRelease(id: string): Promise<void> { await this.host.capRelease?.([id]); }

  // ------------------------------------------------------------------ relay (packages/network/src/relay.ts)
  /**
   * The canonical owners' view of relay members: the member row (active account, not opted out), and on the
   * platform the membership bound to the member's address with its consent ledger (STOP), bans, phone hold
   * and suppression (accounts.activeMembership), and the lowest known age (an adult only). Fails closed: a
   * member with no row, no address or no binding is not eligible. `tx` reads the member rows in that transaction.
   */
  async relayParties(ids: MemberId[], tx?: SQL): Promise<Map<MemberId, RelayCanonical>> {
    const out = new Map<MemberId, RelayCanonical>();
    if (!ids.length) return out;
    const read = (t: SQL) => t`select m.id,m.person_id,m.account_status,m.opted_out,(authority.staff_held or authority.report_held) as safety_held,
      (select p.e164 from platform.phone_identities p where p.person_id=m.person_id order by p.e164 limit 1) as e164
      from network.members m left join platform.matching_ages authority on authority.app_id=m.app_id and authority.member_id=m.id
      where m.app_id=${this.app.id} and m.id in ${t(ids)}`;
    const rows = (tx ? await read(tx) : await this.scoped(read)) as Row[];
    const accounts = tx ? this.host.accountsFor?.(tx) ?? this.host.accounts : this.host.accounts;
    for (const id of ids) {
      const r = rows.find(x => x.id === id), e164 = r?.e164 as string | undefined;
      let bound = false, adult = false;
      if (accounts && r?.person_id && e164) {
        const binding = await accounts.activeMembership(this.app, { e164, personId: r.person_id as string });
        if (binding?.membership.memberId === id) { bound = true; adult = canBeMatched(await accounts.lowestAge(e164, binding.person)); }
      }
      out.set(id, { adult, optedOut: !r || r.opted_out === true || !bound, held: !r || r.account_status !== "active" || r.safety_held === true });
    }
    return out;
  }

  /** Recheck a booked meeting logistics notice after asynchronous queue gates. */
  async groupLateArrivalAdmission(tx: SQL, row: { id: string; app: string; kind: string; text: string; memberId?: MemberId | null; oppId?: string }): Promise<RecipientCheck> {
    const refused: RecipientCheck = { ok: false, reason: "group_late_arrival_changed" };
    const delivery = parseLateArrivalDeliveryId(row.id);
    const app = this.app.id;
    if (!delivery || row.app !== app || delivery.app !== app || row.kind !== "transactional"
      || row.memberId !== delivery.to || row.oppId !== delivery.oppId) return refused;
    const [saved] = await tx<{ state: NetworkState }[]>`select state from network.network_state where id=${this.pg.id} and app_id=${app} for share`;
    const opp = saved?.state.opps.find(o => o.id === delivery.oppId);
    if (!saved || !opp || opp.stage !== "scheduled" || opp.meetingAt !== delivery.meetingAt
      || (opp.scheduleRevision ?? 0) !== delivery.revision) return refused;
    const notice = lateArrivalText(isLateArrivalPairBooking(opp));
    if (row.text !== notice) return refused;
    const receipts = await this.bookingNoticeReceipts(tx, opp, this.clock.now());
    const received = (id: MemberId) => receipts.has(id);
    if (!storedLateArrivalCurrent(saved.state, delivery, this.clock.now(), received)) return refused;
    const [message] = await tx`select id from network.messages where app_id=${app} and id=${row.id}
      and direction='outbound' and type='relay' and member_id=${delivery.to} and opportunity_id=${delivery.oppId} and body=${notice}`;
    if (!message || await this.canonicalPairBlocked(tx, delivery.from, delivery.to)) return refused;
    const parties = await this.relayParties([delivery.from, delivery.to], tx);
    if (![delivery.from, delivery.to].every(id => {
      const party = parties.get(id);
      return party?.adult && !party.optedOut && !party.held;
    })) return refused;
    return storedLateArrivalCurrent(saved.state, delivery, this.clock.now(), received) ? { ok: true } : refused;
  }

  private async bookingNoticeReceipts(tx: SQL, opp: NetworkState["opps"][number], now: number): Promise<Map<MemberId, number>> {
    const receipts = new Map<MemberId, number>();
    const roster = [...new Set(opp.participants)].filter(id => opp.bookedAt?.[id] !== undefined
      && opp.status.some(([member, status]) => member === id && status === "yes"));
    for (const id of roster) {
      const receipt = await currentBookingReceipt(tx, this.app.id, opp.id, id, opp.scheduleRevision ?? 0, opp.lane ?? null);
      const sentAt = receipt?.sent_at?.getTime();
      if (receipt && sentAt !== undefined && bookingNoticeReceived(receipt.status, sentAt, now)) receipts.set(id, sentAt);
    }
    return receipts;
  }

  /** Admit the exact reviewed introduction against current database state on the actual send. */
  async cofounderAdmission(tx: SQL, row: { id: string; memberId?: MemberId | null; oppId?: string }): Promise<RecipientCheck> {
    const refused: RecipientCheck = { ok: false, reason: "cofounder_intent_changed" };
    if (!row.memberId || !row.oppId) return refused;
    const [saved] = await tx<{ state: NetworkState }[]>`select state from network.network_state where id=${this.pg.id} for share`;
    const opp = saved?.state.opps.find(o => o.id === row.oppId);
    if (!opp || opp.lane !== "Cofounder" || opp.participants.length !== 2 || !opp.participants.includes(row.memberId)) return refused;
    const revealing = row.id.startsWith(`${cofounderDeliveryIdPrefix}reveal:`);
    if (!revealing && !row.id.startsWith(`${cofounderDeliveryIdPrefix}probe:`)) return refused;
    if (revealing ? opp.stage !== "scheduled" : opp.stage !== "probing") return refused;
    const [first, second] = opp.participants as [MemberId, MemberId];
    const ids = [opp.cofounderIntents?.[first], opp.cofounderIntents?.[second]];
    if (!ids[0] || !ids[1] || ids[0] === ids[1]) return refused;
    const app = this.app.id, now = this.clock.now();
    const rows = await tx`select * from network.intents where app_id=${app} and id in ${tx(ids)} order by id for share`;
    const intents = rows.map(intentOf);
    const current = (memberId: MemberId) => {
      const exact = intents.find(i => i.memberId === memberId && i.id === opp.cofounderIntents?.[memberId]);
      return !!exact && exact.objective === cofounderIntentObjective
        && cofounderIntentEligible(exact.app ?? "", app, exact.category, exact.details ?? "", standingIntentLive(exact, now));
    };
    if (!current(first) || !current(second) || await this.canonicalPairBlocked(tx, first, second)) return refused;
    const members = await tx`select id, prefs, participation_state, participation_window, opted_out from network.members
      where app_id=${app} and id in ${tx(opp.participants)} order by id for share`;
    const parties = await this.relayParties(opp.participants, tx);
    const eligible = members.length === 2 && members.every(member => {
      const party = parties.get(member.id);
      const trust = saved!.state.trust?.find(record => record.id === member.id)?.level ?? "ok";
      return party?.adult === true && !party.held && !party.optedOut && trust === "ok" && storedInviteNoticePartyCurrent(saved!.state, member.id)
        && member.prefs?.categoriesOptIn?.includes("professional") && member.prefs?.formats?.includes("one_to_one")
        && !member.prefs?.onlyWhenAsked && effectiveParticipation(member as Parameters<typeof effectiveParticipation>[0], now).state !== "paused";
    });
    const active = cofounderPairCurrent(first !== second, true, true, eligible);
    const bothAccepted = opp.participants.every(id => opp.status.some(([key, status]) => key === id && status === "yes") && opp.contacted.includes(id));
    return cofounderDeliveryAllowed(active, opp.review?.decision === "approve", revealing, bothAccepted) ? { ok: true } : refused;
  }

  private peonHireContacts(tx: SQL, memberId: MemberId, ids: readonly string[]) {
    return tx<HireContact[]>`select id,opportunity_id,type,body from network.messages
      where app_id='peon' and member_id=${memberId} and id in ${tx([...ids])} and direction='outbound'
        and opportunity_id is not null and type in ('probe','proposal') order by opportunity_id,id`;
  }

  /** The carrier's claim already locks the exact peer roster in state/person order. */
  private async peonHireContactCurrent(tx: SQL, contact: HireContact, memberId: MemberId, body: string): Promise<boolean> {
    const [saved] = await tx<{ state: NetworkState }[]>`select state from network.network_state where id=${this.pg.id} and app_id='peon' for share`;
    const opp = saved?.state.opps.find(item => item.id === contact.opportunity_id);
    if (!opp) return false;
    if (!opp.seat) return true;
    const { seat, participants, review } = opp;
    const candidate = participants.find(id => id !== seat.manager);
    if (contact.body !== body || !candidate || participants.length !== 2 || !participants.includes(seat.manager)
      || !participants.includes(memberId) || !this.matchingAllowed || !saved?.state.matchingEnabled) return false;
    const now = this.clock.now(), reveal = contact.type === "proposal", statuses = new Map(opp.status);
    const phase = reveal ? opp.stage === "scheduled" && now < (opp.meetingAt ?? 0) && opp.bookedTold?.includes(memberId) === true
      : opp.stage === "probing" && now < opp.deadline && opp.contacted.includes(memberId) && statuses.get(memberId) === "probing";
    const accepted = (id: MemberId) => statuses.get(id) === (reveal ? "yes" : "available") && opp.contacted.includes(id);
    const humanReview = review?.decision === "approve" && !review.invalidated && !!review.reviewer && review.reviewer !== SIM_AUTO_REVIEWER;
    if (!hireContactAllowed(true, humanReview, phase, memberId === seat.manager, reveal, accepted(candidate), accepted(seat.manager))) return false;
    if (await this.canonicalPairBlocked(tx, candidate, seat.manager)) return false;
    const parties = await this.relayParties(participants, tx);
    if (!participants.every(id => {
      const party = parties.get(id);
      return party?.adult === true && !party.held && !party.optedOut && storedInviteNoticePartyCurrent(saved.state, id);
    })) return false;
    const [intents, facets] = await Promise.all([
      tx`select * from network.intents where app_id='peon' and member_id in ${tx(participants)} order by member_id,id`,
      tx`select * from network.facets where app_id='peon' and member_id in ${tx(participants)} and status<>'rejected'
        and ${automatedFacetPredicate(tx)} order by member_id,id`,
    ]);
    return hireSeatCurrent(seat, readHireEvidence({ intents: intents.map(intentOf), facets: facets.map(facetOf) }, seat, candidate, now, false));
  }

  async peonHireAdmission(tx: SQL, row: Pick<QueueRow, "id" | "app" | "memberId" | "oppId" | "text">): Promise<RecipientCheck> {
    if (this.app.id !== "peon" || row.app !== "peon" || !row.memberId || !row.oppId) return { ok: true };
    const [contact] = await this.peonHireContacts(tx, row.memberId, [row.id]);
    const current = !contact || (contact.opportunity_id === row.oppId && await this.peonHireContactCurrent(tx, contact, row.memberId, row.text));
    return current ? { ok: true } : { ok: false, reason: "peon_search_changed" };
  }

  async peonHireRepliesCurrent(tx: SQL, memberId: MemberId, ids: readonly string[], bodies: readonly string[]): Promise<boolean> {
    if (this.app.id !== "peon" || !ids.length) return true;
    for (const contact of await this.peonHireContacts(tx, memberId, ids)) {
      await lockPeerOpportunityContact(tx, this.app.id, this.pg.id, memberId, contact.id);
      if (!await this.peonHireContactCurrent(tx, contact, memberId, bodies[ids.indexOf(contact.id)] ?? "")) return false;
    }
    return true;
  }

  private async slopContact(tx: SQL, row: QueueRow) {
    if (this.app.id !== "slop" || row.app !== this.app.id || !row.oppId || !row.memberId) return;
    const [contact] = await tx<{ type: "probe" | "proposal"; body: string }[]>`select msg.type,msg.body from network.messages msg
      where msg.app_id=${row.app} and msg.id=${row.id} and msg.opportunity_id=${row.oppId}
        and msg.member_id=${row.memberId} and msg.direction='outbound' and msg.type in ('probe','proposal')`;
    return contact;
  }

  /** Lock the exact reviewed pair before the queue takes its usual one-recipient locks. */
  async lockSlopPairAdmission(tx: SQL, row: QueueRow): Promise<void> {
    if (!await this.slopContact(tx, row)) return;
    const [saved] = await tx<{ state: NetworkState }[]>`select state from network.network_state
      where id=${this.pg.id} and app_id=${row.app} for share`;
    const opp = saved?.state.opps.find(item => item.id === row.oppId);
    if (!opp || opp.participants.length !== 2 || !opp.participants.includes(row.memberId!)) return;
    await tx`select person.id from platform.people person join network.members member on member.person_id=person.id
      where member.app_id=${row.app} and member.id in ${tx(opp.participants)} order by person.id for update of person`;
    await tx`select id from network.members where app_id=${row.app} and id in ${tx(opp.participants)} order by id for update`;
  }

  /** Recheck both live Slop profiles after the asynchronous gates, in the queue's claim transaction. */
  async slopPairAdmission(tx: SQL, row: QueueRow): Promise<RecipientCheck> {
    const contact = await this.slopContact(tx, row);
    if (!contact) return { ok: true };
    const refused: RecipientCheck = { ok: false, reason: "slop_pair_changed" };
    const check = this.wiring.hooks?.hardDatingPairCurrent;
    if (!check || contact.body !== row.text) return refused;
    const [saved] = await tx<{ state: NetworkState }[]>`select state from network.network_state where id=${this.pg.id} and app_id=${row.app}`;
    const state = saved?.state;
    const opp = state?.opps.find(item => item.id === row.oppId);
    if (!state || !opp || opp.category !== "romance" || opp.participants.length !== 2 || !opp.participants.includes(row.memberId!)) return refused;
    const [first, second] = opp.participants as [MemberId, MemberId];
    const reveal = contact.type === "proposal";
    const now = this.clock.now();
    const stageCurrent = reveal ? opp.stage === "scheduled" : opp.stage === "probing" && opp.contacted.includes(row.memberId!)
      && opp.status.some(([memberId, status]) => memberId === row.memberId && status === "probing");
    const approved = stageCurrent && opp.review?.decision === "approve" && !opp.review.invalidated;
    const accepted = opp.participants.every(id => opp.status.some(([memberId, status]) => memberId === id && status === "yes"));
    if (!slopPairContactAllowed(approved, first !== second, reveal, accepted)) return refused;
    if (!opp.participants.every(id => storedInviteNoticePartyCurrent(state, id) && !state.trust?.some(t => t.id === id && t.level !== "ok"))) return refused;
    const pair = [first, second].sort().join("|");
    if (state.blocks.includes(pair) || state.avoid.includes(pair) || await this.canonicalPairBlocked(tx, first, second)) return refused;
    for (const party of (await this.relayParties(opp.participants, tx)).values()) if (!party.adult || party.held || party.optedOut) return refused;

    const [members, facets, presence, blocks] = await Promise.all([
      tx`select m.id,m.name,m.home_city,m.prefs,m.participation_state,m.participation_window,m.joined_at,m.unanswered_proactive,a.age
        from network.members m join platform.matching_ages a on a.app_id=m.app_id and a.member_id=m.id
        where m.app_id=${row.app} and m.id in ${tx(opp.participants)} and m.account_status='active' and not m.opted_out order by m.id`,
      tx`select * from network.facets where app_id=${row.app} and member_id in ${tx(opp.participants)} and status<>'rejected'
        and ${automatedFacetPredicate(tx)} order by member_id,id`,
      tx`select * from network.presence where app_id=${row.app} and member_id in ${tx(opp.participants)} order by member_id,city,type`,
      // Mirror the snapshot's direct edges plus its canonical person blocks for these subjects.
      tx`select from_id,to_id,created_at from network.edges where app_id=${row.app} and type='blocked' and to_id in ${tx(opp.participants)}
        union all
        select f.id,t.id,pb.at from platform.person_blocks pb
          join network.members f on f.person_id=pb.from_person and f.app_id=${row.app}
          join network.members t on t.person_id=pb.to_person and t.app_id=${row.app}
          where t.id in ${tx(opp.participants)} and not exists (
            select 1 from network.edges e where e.app_id=${row.app} and e.from_id=f.id and e.to_id=t.id and e.type='blocked')
        order by from_id,to_id`,
    ]);
    const input: Parameters<typeof check>[0] = {
      now, members: members.map(m => ({ id: m.id, name: m.name, homeCity: m.home_city, prefs: m.prefs, age: m.age,
        state: effectiveParticipation(m as Parameters<typeof effectiveParticipation>[0], now).state,
        joinedAt: m.joined_at?.getTime() ?? 0, unansweredProactive: m.unanswered_proactive })),
      facets: [...facets.map(facetOf), ...state.members.filter(m => opp.participants.includes(m.id))
        .flatMap(m => (m.appTags ?? []).map(tag => appTagFacet(m.id, tag)))],
      presence: presence.map(presenceOf), intents: [], recentProposals: [],
      edges: blocks.map(e => ({ from: e.from_id, to: e.to_id, type: "blocked", strength: 1, explicit: true, createdAt: e.created_at.getTime() })),
      recentAsks: state.asks, feedback: state.feedback, interactions: state.interactions,
    };
    const prepared = this.wiring.hooks?.engineInput?.(input) ?? input;
    return check(prepared, opp.participants) ? { ok: true } : refused;
  }

  /**
   * Final dispatch admission of a relayed row, inside the outbound queue's admission transaction after
   * every asynchronous gate (outbound ids "relay:<item>", and "relay:<item>:ask" for the swap question).
   * The item must be one the relay desk passed (network.relay_records, written with the queued row) for
   * exactly this recipient and not rejected since; the newest stored state must still hold the open
   * two-person match of these members with both of them eligible (relayDispatchCheck); no block between
   * them in the canonical edges or person blocks; and both members pass the canonical checks (relayParties).
   * The stored state is read FOR SHARE, so a unit that closes the match either commits first (and is seen
   * here) or waits for this admission.
   */
  async relayAdmission(tx: SQL, row: { id: string; memberId?: string | null; oppId?: string; approvedPhotos?: ApprovedRelayPhoto[] }): Promise<RecipientCheck> {
    const no = (reason: string): RecipientCheck => ({ ok: false, reason });
    const id = /^relay:([^:]+)(:ask)?$/.exec(row.id);
    if (!id || !row.memberId) return no("relay:unknown");
    const to = row.memberId as MemberId, app = this.app.id;
    const [saved] = await tx`select state from network.network_state where id=${this.pg.id} for share`;
    if (!saved?.state) return no("relay:no_state");
    const state = (typeof saved.state === "string" ? JSON.parse(saved.state) : saved.state) as NetworkState;
    let from: MemberId | undefined, matchId: string | undefined;
    if (id[2]) {
      // The swap question names no item of its own: the match is the row's, the sender its other member.
      matchId = row.oppId;
      from = state.opps.find(o => o.id === matchId)?.participants.find(p => p !== to);
    } else {
      const [rec] = await tx`select opportunity_id,from_member,to_member,decision,review from network.relay_records where app_id=${app} and item_id=${id[1]!}`;
      if (!rec || rec.to_member !== to || rec.decision !== "pass" || rec.review === "rejected") return no("relay:not_passed");
      from = rec.from_member as MemberId; matchId = rec.opportunity_id as string;
      if (row.oppId && row.oppId !== matchId) return no("relay:pair");
    }
    if (!from || !matchId) return no("relay:pair");
    const pair = await this.relayPairAdmission(tx, state, from, to, matchId);
    if (!pair.ok) return pair;
    if (row.approvedPhotos?.length) {
      if (row.approvedPhotos.length!==1 || !this.host.photoRelay) return no("photo:unavailable");
      const photo=row.approvedPhotos[0]!;
      if (photo.itemId!==id[1] || photo.app!==app || photo.threadId!==matchId || photo.senderMemberId!==from || photo.recipientMemberId!==to)
        return no("photo:scope");
      const current=await this.host.photoRelay.approved(photo.itemId,tx);
      if (!current || !isDeepStrictEqual(current,photo)) return no("photo:revoked");
    }
    return {ok:true};
  }

  private async relayPairAdmission(tx: SQL, state: NetworkState, from: MemberId, to: MemberId, matchId: string): Promise<RecipientCheck> {
    const no = (reason: string): RecipientCheck => ({ ok: false, reason });
    const why = relayDispatchCheck(state, { matchId, from, to, now: this.clock.now() });
    if (why) return no(why);
    if (await this.canonicalPairBlocked(tx, from, to)) return no("party:blocked");
    for (const [, c] of await this.relayParties([from, to], tx)) {
      if (!c.adult) return no("party:age");
      if (c.optedOut) return no("party:opted_out");
      if (c.held) return no("party:held");
    }
    return { ok: true };
  }

  private async canonicalPairBlocked(tx: SQL, from: MemberId, to: MemberId): Promise<boolean> {
    const app = this.app.id;
    const [blocked] = await tx`select 1 as b from network.edges where app_id=${app} and type='blocked'
      and ((from_id=${from} and to_id=${to}) or (from_id=${to} and to_id=${from}))
      union all select 1 from platform.person_blocks pb join network.members f on f.app_id=${app} and f.id=${from} join network.members t on t.app_id=${app} and t.id=${to}
      where (pb.from_person=f.person_id and pb.to_person=t.person_id) or (pb.from_person=t.person_id and pb.to_person=f.person_id) limit 1`;
    return !!blocked;
  }

  async invitationNoticeAdmission(tx: SQL, id: string, recipient?: MemberId | null): Promise<boolean> {
    if (!recipient) return false;
    const [row] = await tx`select invite_join_members from network.messages where app_id=${this.app.id} and id=${id}
      and direction='outbound' and member_id=${recipient}`;
    return this.invitationNoticeCurrent(tx, recipient, row?.invite_join_members as MemberId[] | undefined);
  }

  async lockHomeHelpConsentAdmission(tx: SQL, id: string, recipient?: MemberId | null): Promise<void> {
    const noticeId = homeHelpNoticeId(id);
    if (!noticeId || !recipient) return;
    await tx`select id from network.network_state where id=${this.pg.id} for share`;
    await lockHomeHelpNoticeRoster(tx, this.app.id, noticeId, recipient);
  }

  async homeHelpConsentAdmission(tx: SQL, row: { id: string; memberId?: MemberId | null; to: string; text: string }): Promise<boolean> {
    const noticeId = homeHelpNoticeId(row.id);
    return !!noticeId && !!row.memberId && !!await this.host.homeHelpNoticeCurrent?.(tx, this.app, noticeId, row.memberId, row.to, row.text);
  }

  async gatheringInvitationAdmission(tx: SQL, row: QueueRow): Promise<RecipientCheck> {
    const accounts = this.host.accountsFor?.(tx);
    if (!accounts || !this.matchingAllowed) return { ok: false, reason: "gathering_invitation_changed" };
    return gatheringInvitationAdmission(tx, this.app, this.pg.id, accounts, row, this.clock.now());
  }

  async gatheringNoticeAdmission(tx: SQL, row: QueueRow): Promise<RecipientCheck> {
    const accounts = this.host.accountsFor?.(tx);
    if (!accounts || !this.matchingAllowed) return { ok: false, reason: "gathering_notice_changed" };
    return gatheringNoticeAdmission(tx, this.app, this.pg.id, accounts, row, this.clock.now());
  }

  private async gatheringRepeatState(tx: SQL, lock = false): Promise<NetworkState | undefined> {
    if (this.id !== "ntwrk:nyc") return;
    const [saved] = await tx<{ state: NetworkState }[]>`select state from network.network_state
      where app_id=${this.app.id} and id=${this.pg.id} ${lock ? tx`for share` : tx``}`;
    return saved?.state;
  }

  async lockGatheringRepeatClaim(tx: SQL, oppId: string): Promise<void> {
    const state = await this.gatheringRepeatState(tx, true);
    const source = state?.opps.find(item => item.id === oppId)?.gatheringRepeat;
    if (source) await lockGatheringMatchSource(tx, this.app, source);
  }

  private async gatheringRepeatMessageCurrent(tx: SQL, state: NetworkState, message: GatheringRepeatMessage, memberId: string,
    address: string, body: string): Promise<boolean> {
    const opportunity = state.opps.find(item => item.id === message.opportunity_id);
    if (!opportunity) return false;
    const { gatheringRepeat: source, participants, review } = opportunity;
    const statuses = new Map(opportunity.status);
    const exactMessage = message.body === body && participants.includes(memberId);
    const probe = message.type === "probe" || message.type === "scheduling";
    const initialBooking = message.type === "proposal" && !message.id.startsWith(RESCHEDULE_QUEUE_PREFIX);
    if (!probe && !initialBooking) return exactMessage;
    const exactPair = !!source && participants.length === 2 && source.members.every(id => participants.includes(id));
    const humanApproved = review?.decision === "approve" && !review.invalidated && !!review.reviewer && review.reviewer !== SIM_AUTO_REVIEWER;
    const lifecycle = probe
      ? opportunity.stage === "probing" && statuses.get(memberId) === "probing" && message.id === gatheringRepeatProbeKey(opportunity.id, memberId, message.type === "scheduling")
      : opportunity.stage === "scheduled" && participants.every(id => statuses.get(id) === "yes" && opportunity.contacted.includes(id))
        && opportunity.bookedTold?.includes(memberId) === true;
    const rollout = this.matchingAllowed && state.matchingEnabled;
    const accounts = this.host.accountsFor?.(tx);
    const current = !!accounts && !!source && rollout && exactPair && humanApproved && lifecycle && exactMessage
      && await gatheringMatchSourceCurrent(tx, accounts, this.app, source, this.clock.now(), { memberId, e164: address }, state);
    return gatheringRepeatContactAllowed(rollout, exactPair, humanApproved, lifecycle, exactMessage, current);
  }

  async gatheringRepeatClaim(tx: SQL, row: QueueRow): Promise<boolean> {
    if (!row.memberId || !row.oppId || row.app !== this.app.id) return false;
    const state = await this.gatheringRepeatState(tx);
    if (!state) return false;
    const [message] = await tx<GatheringRepeatMessage[]>`select id,opportunity_id,type,body from network.messages
      where app_id=${this.app.id} and id=${row.id} and opportunity_id=${row.oppId} and member_id=${row.memberId} and direction='outbound'`;
    if (!message) return row.id.startsWith("relay:");
    if (message.type === "probe" || message.type === "scheduling" || message.type === "proposal") {
      if (row.mediaUrls.length || row.approvedPhotos?.length) return false;
    }
    return this.gatheringRepeatMessageCurrent(tx, state, message, row.memberId, row.to, row.text);
  }

  async gatheringRepeatRepliesCurrent(tx: SQL, memberId: string, address: string, ids: readonly string[], bodies: readonly string[]): Promise<boolean> {
    if (this.app.id !== "ntwrk") return true;
    const messages = await tx<GatheringRepeatMessage[]>`select id,opportunity_id,type,body from network.messages
      where app_id=${this.app.id} and id=any(${tx.array([...ids], "TEXT")}) and member_id=${memberId} and direction='outbound'
        and starts_with(opportunity_id,${gatheringRepeatOppPrefix}) order by opportunity_id,id`;
    if (!messages.length) return true;
    const state = await this.gatheringRepeatState(tx, true);
    if (!state) return false;
    for (const message of messages) {
      const source = state.opps.find(item => item.id === message.opportunity_id)?.gatheringRepeat;
      if (source) await lockGatheringMatchSource(tx, this.app, source);
      if (!await this.gatheringRepeatMessageCurrent(tx, state, message, memberId, address, bodies[ids.indexOf(message.id)] ?? "")) return false;
    }
    return true;
  }

  async expectedInvitationAdmission(tx: SQL, row: { id: string; to: string; text: string }): Promise<boolean> {
    return !!await this.host.admitExpectedInvitation?.(tx, this, row);
  }

  async expectedInvitationClaimed(tx: SQL, row: { id: string; to: string; text: string }): Promise<void> {
    if (!this.host.claimExpectedInvitation) throw new Error("Expected invitation attempt store is unavailable");
    await this.host.claimExpectedInvitation(tx, this, row);
  }

  private async invitationNoticeCurrent(tx: SQL, inviter: MemberId, invitees?: readonly MemberId[]): Promise<boolean> {
    if (!invitees?.length) return false;
    const app = this.app.id;
    const links = await tx`select i.id,i.home_city,v.home_city as inviter_home from network.members i join network.members v on v.app_id=i.app_id and v.id=i.invited_by
      where i.app_id=${app} and v.id=${inviter} and i.id in ${tx([...invitees])}
      and not exists(select 1 from network.edges b where b.app_id=${app} and b.type='blocked'
        and ((b.from_id=i.id and b.to_id=v.id) or (b.from_id=v.id and b.to_id=i.id)))
      and not exists(select 1 from platform.person_blocks b where (b.from_person=i.person_id and b.to_person=v.person_id)
        or (b.from_person=v.person_id and b.to_person=i.person_id))`;
    if (links.length !== invitees.length) return false;
    const ownerOf = (city: string) => this.host.conversationNetworkId?.(app, city) ?? this.id;
    const members = new Map<MemberId, string>([[inviter, ownerOf(links[0]!.inviter_home as string)]]);
    if (members.get(inviter) !== this.id) return false;
    for (const row of links) members.set(row.id as string, ownerOf(row.home_city as string));
    const stateRows = await tx`select id,state from network.network_state where id in ${tx([...new Set(members.values())])}`;
    const states = new Map(stateRows.map(row => [row.id as string, (typeof row.state === "string" ? JSON.parse(row.state) : row.state) as NetworkState]));
    if (![...members].every(([member, network]) => {
      const state = states.get(network);
      return state && storedInviteNoticePartyCurrent(state, member);
    })) return false;
    const parties = await this.relayParties([...members.keys()], tx);
    return [...parties.values()].every(party => party.adult && !party.optedOut && !party.held);
  }

  /** Current canonical parties for a selected photo; no participant or phone is selected by the model. */
  async relayPhotoParties(input: { app: AppInfo["id"]; threadId: string; senderPersonId: string }, transaction?: SQL): Promise<{
    senderPersonId: string; senderMemberId: string; recipientPersonId: string; recipientMemberId: string;
  } | undefined> {
    if (input.app !== this.app.id) return;
    const read = async (tx: SQL) => {
      await tx`select set_config('app.app_id', ${this.app.id}, true)`;
      // This lookup can run under the photo item's lock. Do not take the inverse
      // network_state lock order; the outbound queue owns its final shared lock.
      const [saved] = await tx`select state from network.network_state where id=${this.pg.id}`;
      if (!saved?.state) return;
      const state = (typeof saved.state === "string" ? JSON.parse(saved.state) : saved.state) as NetworkState;
      const op = state.opps.find(o => o.id === input.threadId);
      if (!op || op.participants.length !== 2) return;
      const rows = await tx`select id,person_id from network.members where app_id=${this.app.id} and id in ${tx(op.participants)}`;
      const sender = rows.find((r: Row) => r.person_id === input.senderPersonId);
      const recipient = rows.find((r: Row) => r.id !== sender?.id);
      if (!sender?.person_id || !recipient?.person_id || recipient.person_id === sender.person_id) return;
      const allowed = await this.relayPairAdmission(tx, state, sender.id as MemberId, recipient.id as MemberId, op.id);
      if (!allowed.ok) return;
      return { senderPersonId: sender.person_id as string, senderMemberId: sender.id as string,
        recipientPersonId: recipient.person_id as string, recipientMemberId: recipient.id as string };
    };
    return transaction ? read(transaction) : this.scoped(read);
  }

  /** A transaction for this app: row-level security (network_service) shows and accepts this app's rows only. */
  scoped<T>(fn: (tx: SQL) => Promise<T>): Promise<T> {
    return this.sql.begin(async tx => {
      await tx`select set_config('app.app_id', ${this.app.id}, true)`;
      return fn(tx);
    }) as Promise<T>;
  }

  /** The stored state of this network (inside an app-scoped transaction). */
  private async loadState(): Promise<NetworkState | undefined> {
    return this.scoped(async tx => {
      const [r] = await tx`select state from network.network_state where id = ${this.pg.id}`;
      const s = r?.state;
      // A state without its relay log gets it back from network.relay_records (store.ts).
      return loadRelayRows(tx, s === undefined ? undefined : ((typeof s === "string" ? JSON.parse(s) : s) as NetworkState), this.app.id, this.pg.id);
    });
  }

  /**
   * After a restart: the state loads first (the queue checks each recipient against it; audit
   * network-service-2), then the queue delivers what waits. Rows a stopped worker held during a
   * provider call go back to the queue first and are sent again with the same provider key. The queue
   * itself expires a row past its time (a proactive message after 24 h, anything after 3 days) or
   * about an opportunity that closed.
   */
  async start() {
    // The ledger starts from what is stored (events this process did not emit), oldest first.
    for (const r of await this.scoped(tx => tx`select event from network.capital_events where app_id = ${this.app.id} order by t, id`) as any[]) {
      try { this.capital.ledger.record(typeof r.event === "string" ? JSON.parse(r.event) : r.event); } catch { /* out of order: counted by the wiring only for new events */ }
    }
    // spec/runtimeUnit.md, "Runtime follow-up depends on the adapter and whether the tick ran"
    if (startupPlan(!!this.adapter.enqueue) === "RepairProjection") { await this.projectNotifications(); return; }
    const recovered = (await this.adapter.recover?.()) ?? 0;
    if (recovered) this.host.log(`[restart] ${recovered} message(s) ${this.adapter.name === "eliza_cloud" ? "held for receipt lookup" : "go out again with the same provider key"} (${this.id})`);
    // One unit loads the state and the address book; its delivery drains the queue.
    await this.unitOfWork(() => undefined);
  }

  // ------------------------------------------------------------------ units of work
  /** The store the Network uses: every load starts a unit (fresh snapshot); every save writes the unit in the same transaction. */
  private serviceStore(): NetworkStore {
    return {
      load: async () => {
        this.unit = newUnit();
        await this.refresh();
        const state = await this.loadState();
        this.net.setGatheringRepeatSources([]);
        if (state?.matchingEnabled && this.matchingAllowed && this.id === "ntwrk:nyc" && this.host.accountsFor) {
          // A read failure must retry the unit. Only a successful scan may retire an unbooked source.
          const sources = await this.scoped(tx => currentGatheringRepeatSources(tx, this.host.accountsFor!(tx), this.app, this.clock.now(), state));
          this.net.setGatheringRepeatSources(sources);
        }
        await this.refreshInitialInviteReceipts(state);
        if (legacyIntentReconciliationDue(!!state, state?.legacyIntentRowsReconciled === true)) this.unit.legacyIntentState = state;
        // The registry's switch wins: a network whose matching is not allowed never matches, whatever was stored.
        if (state && matchingDisabledByRegistry(this.matchingAllowed)) state.matchingEnabled = false;
        return state;
      },
      save: async (state: NetworkState) => {
        const u = this.unit;
        // PgStore.save sets app.app_id for its own transaction; the unit's rows go in the same one.
        await this.pg.save({ ...state, legacyIntentRowsReconciled: true }, tx => this.writeUnit(tx, u));
        if (u.recordedAges) this.recordedAges.push(...u.recordedAges);
        this.committed.push(...u.sends.filter(s => !u.collected.has(s.id)));
        this.unit = newUnit();
      },
      withTickLock: fn => this.pg.withTickLock(fn),
      withLock: fn => this.pg.withLock(fn),
    };
  }

  /** Resolve each plan invitation and exact Slop or Hire reply from its provider record. */
  private async refreshProbeReplyReceipts(state: NetworkState | undefined): Promise<Set<string>> {
    const exactPlanIds = new Set<string>();
    if (!state) return exactPlanIds;
    const open = new Map(state.opps.filter(opp => !opp.plan && opp.stage === "probing"
      && ((this.app.id === "slop" && opp.category === "romance") || (this.app.id === "peon" && !!opp.seat))).map(opp => [opp.id, opp]));
    const pending = state.members.flatMap(member => {
      const slot = member.awaiting;
      const opp = slot?.kind === "probe" && slot.oppId ? open.get(slot.oppId) : undefined;
      if (!slot || !opp) return [];
      if (!opp.status.some(([id, status]) => id === member.id && status === "probing")) return [];
      const formerInvite = opp.timeRetry?.includes(member.id) ? undefined
        : member.pendingAsks.find(invite => invite.kind === "probe" && invite.opportunityId === opp.id);
      return [{ key: probeReplyReceiptKey(opp.id, member.id, slot), id: slot.probeReceiptId ?? formerInvite?.deliveryId ?? null,
        member_id: member.id, opportunity_id: opp.id, opened_at: new Date(slot.at).toISOString(), plan: false }];
    });
    const members = new Map(state.members.map(member => [member.id, member]));
    for (const opp of state.opps) {
      if (!opp.plan || !opp.planRun || (opp.stage !== "probing" && opp.stage !== "scheduled")) continue;
      for (const memberId of opp.participants) {
        const member = members.get(memberId);
        const question = member?.awaiting;
        const sentAt = opp.sentAt?.[memberId] ?? (question?.kind === "probe" && question.oppId === opp.id ? question.at : undefined);
        if (opp.planRun.answers[memberId] !== "pending" || sentAt === undefined) continue;
        const slot = planProbeReceiptSlot(opp.id, sentAt, member);
        const replacement = opp.replacementFor ? replacementProbeKey(opp.id, memberId) : undefined;
        const id = replacement ?? slot.probeReceiptId ?? null;
        if (id) exactPlanIds.add(id);
        pending.push({ key: replacement ?? probeReplyReceiptKey(opp.id, memberId, slot), id,
          member_id: memberId, opportunity_id: opp.id, opened_at: new Date(slot.at).toISOString(), plan: true });
      }
    }
    if (!pending.length) return exactPlanIds;
    const rows = await this.scoped(tx => tx<{
      key: string; id: string; plan: boolean; matched: number; status: string; outbound_member_id: string | null;
      sent_at: Date | null; ended_at: Date | null; provider_message_id: string | null; in_doubt: boolean | null; ts: Date;
    }[]>`select probe.key,probe.plan,m.id,count(*) over (partition by probe.key)::int as matched,
        coalesce(o.status,m.status) as status,o.member_id as outbound_member_id,o.sent_at,o.ended_at,o.provider_message_id,o.in_doubt,m.ts
      from jsonb_to_recordset(${pending}::jsonb) as probe(key text,id text,member_id text,opportunity_id text,opened_at timestamptz,plan boolean)
      join network.messages m on m.app_id=${this.app.id} and m.member_id=probe.member_id and m.opportunity_id=probe.opportunity_id
        and m.direction='outbound' and (case when probe.plan then m.type='plan_probe' else m.type in ('probe','scheduling') end)
        and (m.id=probe.id or (probe.id is null and m.ts=probe.opened_at))
      left join platform.outbound o on o.app_id=m.app_id and o.id=m.id and o.member_id=m.member_id
        and (not probe.plan or (o.opportunity_id=m.opportunity_id and o.kind='proactive'))`);
    for (const row of rows) {
      if (row.plan) exactPlanIds.add(row.id);
      if (row.matched !== 1) continue;
      const acceptedAt = row.outbound_member_id && /^(accepted|sent|delivered|read)$/.test(row.status) ? row.sent_at
        : this.adapter.name === "dry_run" && row.status === "dry_run" ? row.ts : undefined;
      const receipt: InitialInviteReceipt | undefined = acceptedAt ? { kind: "accepted", at: acceptedAt.getTime() }
        : row.plan && row.outbound_member_id && row.ended_at && row.sent_at === null && row.provider_message_id === null
          && row.in_doubt === false && row.status !== "failed_unknown" && row.status !== "parked_leak_review" && NOT_SENT.test(row.status)
          ? { kind: "not_sent" } : undefined;
      if (!receipt) continue;
      this.initialInviteReceipts.set(row.key, receipt);
      // The attention ledger may be tracking the same invitation by its raw message ID.
      if (row.plan) this.initialInviteReceipts.set(row.id, receipt);
    }
    return exactPlanIds;
  }

  /** Read receipts for exact committed sends whose acceptance is still unresolved in Network state. */
  private async refreshInitialInviteReceipts(state: NetworkState | undefined) {
    this.initialInviteReceipts.clear();
    const exactPlanIds = await this.refreshProbeReplyReceipts(state);
    const gathering = new Map((state?.opps ?? []).filter(opp => opp.gatheringRepeat && opp.stage === "probing").map(opp => [opp.id, opp]));
    const exactReplies = new Map<string, { key: string; memberId: MemberId; oppId: string | null;
      type: "scheduling" | "reminder" | "feedback_request" | "crew_offer" }>();
    const now = this.clock.now();
    const bookingReceiptsNeeded = (state?.opps ?? []).filter(opp => {
      if (opp.seat || opp.meetingAt === undefined) return false;
      const elapsed = now - opp.meetingAt;
      if (opp.stage === "scheduled" && opp.review?.decision === "approve" && !opp.review.invalidated
        && lateArrivalRosterReady(isLateArrivalPairBooking(opp), new Set(opp.participants).size) && lateArrivalWindow(-elapsed)) return true;
      if (opp.stage !== "done" && !(opp.stage === "scheduled" && elapsed >= feedbackDelayMs)) return false;
      const everyoneResponded = opp.participants.every(id => !opp.status.some(([member, status]) => member === id && status === "yes") || !!opp.post?.[id]);
      return canResolveAttendance(restoreAttendance(!!opp.finalized), elapsed >= settlementDelayMs, everyoneResponded);
    });
    if (bookingReceiptsNeeded.length) await this.scoped(async tx => {
      for (const opp of bookingReceiptsNeeded) for (const [id, at] of await this.bookingNoticeReceipts(tx, opp, now)) {
        this.initialInviteReceipts.set(bookingNoticeReceiptKey(opp.id, id, opp.scheduleRevision), { kind: "accepted", at });
      }
    });
    for (const opp of state?.opps ?? []) {
      if (opp.stage === "done" && opp.meetingAt !== undefined) {
        for (const [memberId, status] of opp.status) {
          if (status !== "yes") continue;
          // An unresolved settlement can still use an earlier exact receipt when a worker's tick runs late.
          const needsSettlementReceipt = !opp.finalized && !opp.post?.[memberId];
          const canAnswer = meetingFeedbackCandidate(true, true, opp.feedbackFrom.includes(memberId), now - opp.meetingAt);
          if (!needsSettlementReceipt && !canAnswer) continue;
          const key = meetingFeedbackKey(opp.id, memberId, opp.scheduleRevision);
          exactReplies.set(key, { key, memberId, oppId: opp.id, type: "feedback_request" });
        }
      }
      const draft = opp.reschedule;
      if (!draft || opp.stage !== "scheduled") continue;
      for (const memberId of draft.offered) {
        const key = rescheduleOfferKey(draft, memberId);
        exactReplies.set(opp.lane === "Cofounder" ? cofounderRevealDeliveryId(key) : key, { key, memberId, oppId: opp.id, type: "scheduling" });
      }
    }
    const gatheringIds: string[] = [];
    const ids = (state?.members ?? []).flatMap(member => {
      const pending = member.pendingAsks.flatMap(invite => invite.deliveryId !== undefined && invite.acceptedAt === undefined
        && !exactPlanIds.has(invite.deliveryId) ? [invite.deliveryId] : []);
      const awaiting = member.awaiting;
      if (awaiting?.kind === "booked" && awaiting.oppId && awaiting.bookedCheckIn) {
        const key = bookedReminderKey("day-of-checkin", awaiting.oppId, member.id, awaiting.bookedCheckIn.revision);
        exactReplies.set(key, { key, memberId: member.id, oppId: awaiting.oppId, type: "reminder" });
      }
      if (awaiting?.kind === "crew" && awaiting.crewOfferReceiptId) {
        const key = awaiting.crewOfferReceiptId;
        exactReplies.set(key, { key, memberId: member.id, oppId: null, type: "crew_offer" });
      }
      const repeat = awaiting?.kind === "probe" && awaiting.oppId ? gathering.get(awaiting.oppId) : undefined;
      if (repeat) gatheringIds.push(gatheringRepeatProbeKey(repeat.id, member.id, !!repeat.timeRetry?.includes(member.id)));
      const survey = member.interruptionSurvey;
      if (survey?.sentAt !== undefined) pending.push(interruptionFeedbackKey(this.app.id, member.id, survey.opportunityId));
      return pending;
    });
    if (!ids.length && !gatheringIds.length && !exactReplies.size) return;
    const rows = await this.scoped(tx => tx<StoredSendReceipt[]>`select m.id,m.member_id,m.opportunity_id,m.type,o.member_id as outbound_member_id,o.sent_at,
      coalesce(o.status, m.status) as status,
      case when o.id is null then m.ts else o.sent_at end as accepted_at
      from network.messages m left join platform.outbound o on o.app_id = m.app_id and o.id = m.id
      where m.app_id=${this.app.id} and m.direction='outbound' and (
        (m.id=any(${tx.array(ids, "TEXT")}) and m.proactive) or
        (m.id=any(${tx.array(gatheringIds, "TEXT")}) and m.type in ('probe','scheduling')) or
        (m.id=any(${tx.array([...exactReplies.keys()], "TEXT")}) and m.type in ('scheduling','reminder','feedback_request','crew_offer')))`);
    for (const row of rows) {
      const exact = exactReplies.get(row.id);
      if (exact && (row.type !== exact.type || row.member_id !== exact.memberId || row.outbound_member_id !== exact.memberId
        || row.opportunity_id !== exact.oppId)) continue;
      // Replies to check-ins, feedback prompts, crew offers and reschedule offers require exact acceptance.
      const acceptedAt = exact ? row.sent_at : row.accepted_at;
      if (acceptedAt && /^(accepted|sent|delivered|read)$/.test(row.status)) {
        this.initialInviteReceipts.set(exact?.key ?? row.id, { kind: "accepted", at: acceptedAt.getTime() });
      } else if (!exact && row.status !== "parked_leak_review" && (row.status === "dry_run" || NOT_SENT.test(row.status))) {
        this.initialInviteReceipts.set(row.id, { kind: "not_sent" });
      }
    }
  }

  /** The snapshot and the address book, read fresh for every unit (inside the lock), in one app-scoped transaction. */
  private async refresh() {
    const app = this.app.id, now = this.clock.now(), homes = this.cities;
    await this.scoped(async tx => {
      const [snapshot, names] = await Promise.all([
        loadSnapshot(tx, now, { app, city: this.city, homeCities: homes }),
        tx`select i.id,i.invited_by,i.name from network.members i join network.members v on v.app_id=i.app_id and v.id=i.invited_by
          join platform.matching_ages a on a.app_id=i.app_id and a.member_id=i.id
          where i.app_id=${app} and v.home_city in ${tx([...homes])} and i.home_city not in ${tx([...homes])}
            and i.joined_at>${new Date(now - inviteJoinNoticeLifetimeMs)} and i.account_status='active' and not i.opted_out and a.age>=${ADULT_AGE}`,
      ]);
      this.snap = snapshot;
      this.joinedInviteeNames = new Map(names.flatMap(row => {
        const first = (row.name as string | null)?.trim().split(/\s+/)[0];
        return first ? [[`${row.invited_by}\0${row.id}`, first] as const] : [];
      }));
    });
    await this.identities();
  }

  /**
   * This app's joined members' addresses. An invited person (the invite gate has not let them in) or a
   * removed one is not a member here. A member the platform knows (members.person_id) gets the person's
   * verified phone (platform.phone_identities, the one place a phone lives). Members from before the
   * platform keep their channel_identities rows (one per app and address).
   */
  async identities() {
    const [legacy, platform] = await this.scoped(async tx => [
      await tx`select ci.member_id, ci.address, m.home_city from network.channel_identities ci
        join network.members m on m.app_id = ci.app_id and m.id = ci.member_id
        where ci.app_id = ${this.app.id} and ci.channel in ('imessage', 'sms') and m.person_id is null
          and not exists (select 1 from platform.phone_identities ph where ph.e164 = ci.address)
          and m.account_status not in ('invited', 'removed') order by ci.is_primary desc, ci.member_id`,
      // A number on hold (it may have a new owner) is nobody's address until staff decide.
      await tx`select m.id as member_id, ph.e164 as address, m.home_city from network.members m join platform.phone_identities ph on ph.person_id = m.person_id
        where m.app_id = ${this.app.id} and m.account_status not in ('invited', 'removed') and ph.hold is null order by m.id`,
    ]);
    this.addrToMember.clear(); this.memberToAddr.clear();
    for (const r of [...platform, ...legacy] as any[]) {
      if (!this.cities.includes(r.home_city)) continue;
      const a = normalizeAddress(r.address);
      // The current platform phone takes priority over a historical alias at the same address.
      if (!this.addrToMember.has(a)) this.addrToMember.set(a, r.member_id);
      if (!this.memberToAddr.has(r.member_id)) this.memberToAddr.set(r.member_id, a);
    }
  }

  /** Address to member of this app (E.164 or Apple ID, normalized), from the last refresh. */
  memberOf = (address: string): MemberId | undefined => this.addrToMember.get(normalizeAddress(address));
  addressOf = (id: MemberId): string | undefined => this.memberToAddr.get(id);

  signedMemberTurn(memberId: MemberId, messageId?: string): boolean {
    const turn = this.host.inboundTurn?.();
    return !!turn && turn.app === this.app.id && turn.memberId === memberId && (messageId === undefined || `in:${turn.id.slice(4)}` === messageId)
      && normalizeAddress(this.addressOf(memberId) ?? "") === normalizeAddress(turn.from);
  }

  private context(): NetworkContext {
    const ev = (rec: unknown) => { const e = eventOf(rec as RunRecord); if (e) this.unit.events.push(e); };
    return {
      clock: this.clock,
      send: (memberId, body, o) => {
        const t = this.clock.now();
        const meta = o?.meta ?? {};
        const approvedPhotos = meta.approvedPhotos === undefined ? undefined : parseApprovedRelayPhotos(meta.approvedPhotos);
        if (meta.approvedPhotos !== undefined && !approvedPhotos) throw new Error("Invalid deferred approved photo payload");
        const baseId = o?.idempotencyKey ?? `${memberId}:${t}:${this.nonce}${++this.seq}`;
        const oppId = meta.proposalId ?? meta.probe?.key;
        const cofounderContact = !!oppId && this.net.opps.get(oppId)?.lane === "Cofounder"
          && (meta.type === "probe" || meta.type === "scheduling" || meta.type === "proposal");
        const id = cofounderContact ? (meta.type === "proposal" || baseId.startsWith(RESCHEDULE_QUEUE_PREFIX)
          ? cofounderRevealDeliveryId(baseId) : `${cofounderDeliveryIdPrefix}probe:${baseId}`)
          : meta.privateInviteVouch && !meta.approvedInviteLink ? `invite-vouch:${baseId}` : baseId;
        const turn = this.host.inboundTurn?.();
        const causal = !cofounderContact && turn?.app === this.app.id && turn.memberId === memberId && o?.reply === true
          && normalizeAddress(this.memberToAddr.get(memberId) ?? "") === normalizeAddress(turn.from);
        const pendingInvite = this.unit.memberInvitation;
        if (meta.approvedInviteLink) {
          if (!causal || pendingInvite?.status !== "issued" || pendingInvite.referral.inviterMemberId !== memberId || pendingInvite.url !== meta.approvedInviteLink) {
            throw new Error("Invitation reply has no matching signed issuer");
          }
          (this.unit.collectedPublicLinks ??= new Map()).set(id, [pendingInvite.url]);
        }
        if (meta.privateInviteVouch && !causal) throw new Error("Private invitation text requires its signed member reply");
        const type = meta.homeHelpConsentFor ? "home_help_consent" : meta.approvedInviteLink ? "member_invitation" : meta.privateInviteVouch
          ? pendingInvite?.status === "review" ? "member_invitation_review" : "member_invitation_vouch"
          : this.unit.privateHomeHelpTurn && causal ? "bounded_home_help" : meta.type;
        if (causal) this.unit.collected.add(id);
        this.unit.sends.push({
          id, memberId, to: this.memberToAddr.get(memberId), body,
          // "reply" only when the Network says so (send(): never a proactive send, a growth ask, a
          // re-engagement or a check-in), so the queue's quiet hours and caps still apply to those.
          kind: o?.reply && (causal || this.replyingTo === memberId) ? "reply" : meta.proactive ? "proactive" : "transactional",
          // A probe names its opportunity only in meta.probe (anonymous to the member); the row links it either way.
          ...(approvedPhotos ? { approvedPhotos } : {}), ...(meta.invitationJoins ? { invitationJoins: meta.invitationJoins } : {}),
          ...(type === "proposal" && meta.booked && meta.participants?.length ? { bookingRoster: [...meta.participants] } : {}),
          type, oppId, proactive: !!meta.proactive, system: false, ts: t,
        });
        return { id, ts: t, direction: "outbound", channel: "imessage", from: "network", to: memberId, memberId, body, status: causal ? "collected" : "delivered", meta } satisfies SimMessage;
      },
      initialInviteReceipt: id => this.initialInviteReceipts.get(id),
      snapshot: () => this.snap ?? { now: this.clock.now(), members: [], facets: [], intents: [], presence: [], edges: [], recentProposals: [] },
      verifiedJoinedInviteeName: (inviter, invitee) => this.joinedInviteeNames.get(`${inviter}\0${invitee}`),
      // A proposal record has no oracle in production; eventOf reads only the proposal and the source.
      recordProposal: (proposal, source = "network") => ev({ t: this.clock.now(), type: "proposal", source, proposal }),
      recordMeeting: m => { ev({ t: this.clock.now(), type: "meeting_scheduled", meetingId: m.proposalId, proposalId: m.proposalId, participants: m.participants, at: m.at, city: m.city }); return m.proposalId; },
      recordBlock: (from, to) => { this.unit.blocks.push([from, to]); ev({ t: this.clock.now(), type: "block", from, to }); },
      log: (kind, detail) => ev({ t: this.clock.now(), type: "network_log", kind, detail }),
    };
  }

  /** A system send (keyword confirmations, the link notice) in the current unit. It does not go through the Network. */
  system(memberId: MemberId, id: string, body: string, kind: Outbound["kind"] = "compliance", type = "system", mediaUrls?: string[]) {
    const turn = this.host.inboundTurn?.();
    if (turn?.app === this.app.id && turn.memberId === memberId && (kind === "reply" || kind === "compliance")
      && normalizeAddress(this.memberToAddr.get(memberId) ?? "") === normalizeAddress(turn.from)) this.unit.collected.add(id);
    this.unit.sends.push({ id, memberId, to: this.memberToAddr.get(memberId), body, ...(mediaUrls?.length ? { mediaUrls } : {}), kind, type, proactive: false, system: true, ts: this.clock.now() });
  }

  /** A directly requested result for this signed member. Source links grant only a per-reply contact exception. */
  collectedMemberReply(memberId: MemberId, id: string, body: string,
    type: "solo_events" | "contribution_history" | "member_invitation_vouch" | AtomicReplyReason, publicLinks: readonly string[] = []) {
    const turn = this.host.inboundTurn?.();
    if (turn?.app !== this.app.id || turn.memberId !== memberId
      || normalizeAddress(this.addressOf(memberId) ?? "") !== normalizeAddress(turn.from)) return;
    const reasons = new LeakGuard({ ...this.net.leakSources([memberId]), canaryShapes: true }).check(body, { contactAllow: publicLinks });
    if (reasons.length) {
      this.host.log(`[alert] a ${type} reply failed the leak guard (${this.id}, ${id})`);
      return;
    }
    this.system(memberId, id, body, "reply", type);
    if (publicLinks.length) (this.unit.collectedPublicLinks ??= new Map()).set(id, publicLinks);
  }

  /** Remove old copies that could otherwise restore a saved facet in the next matching run. */
  async clearProfileFactProjections(tx: SQL, memberId: MemberId, { fact, change, previousTags }: AppliedProfileFactEdit) {
    const app = this.app.id;
    if (fact.signupInterest && change.kind !== "scope") {
      const [membership] = await tx<{ interests: unknown }[]>`select profile->'interests' as interests from platform.memberships
        where app_id=${app} and member_id=${memberId} for update`;
      if (Array.isArray(membership?.interests) && membership.interests.includes(fact.value)) {
        const interests = membership.interests.flatMap(interest => interest !== fact.value ? [interest]
          : change.kind === "correct" ? [change.value] : []);
        await tx`update platform.memberships set profile=profile || ${{ interests: [...new Set(interests)] }}::jsonb
          where app_id=${app} and member_id=${memberId}`;
      }
    }
    const clearsLearned = previousTags.length > 0 && (fact.kind === "interest" || fact.kind === "skill");
    const clearsStanding = change.kind !== "scope" || change.scope === "agent_private";
    if (!clearsLearned && !clearsStanding) return;
    // PgStore has serialized this unit's state. The city lock stays held through the update.
    const [row] = await tx<{ state: NetworkState }[]>`select state from network.network_state where id=${this.id} for update`;
    if (!row) return;
    const state = row.state;
    let changed = false;
    if (clearsLearned) {
      const member = state.members.find(candidate => candidate.id === memberId);
      const field = fact.kind === "interest" ? "interests" : "skills";
      if (member) {
        const remaining = member.learned[field].filter(tag => !previousTags.includes(tag));
        changed = remaining.length !== member.learned[field].length;
        member.learned[field] = remaining;
      }
    }
    if (clearsStanding && state.memberStanding?.length) {
      const remaining = state.memberStanding.filter(entry => entry.memberId !== memberId
        || !entry.evidenceIds.includes(standingEvidenceKey(app, memberId, entry.lane, entry.side, fact.id)));
      if (remaining.length !== state.memberStanding.length) {
        if (remaining.length) state.memberStanding = remaining;
        else delete state.memberStanding;
        changed = true;
      }
    }
    if (changed) await tx`update network.network_state set state=${state}::jsonb where id=${this.id}`;
  }

  /** Everything the unit produced, inside the save transaction (app.app_id is set). Rows that name a member not in this app's network.members are skipped. */
  private async writeUnit(tx: SQL, u: Unit) {
    const app = this.app.id;
    await u.memberCommand?.(tx);
    if (u.ages.length) {
      const store = new PgPeopleStore(tx);
      const accounts = this.host.accounts;
      u.recordedAges = [];
      for (const observation of u.ages) {
        const e164 = this.addressOf(observation.memberId);
        if (!accounts || !e164) continue;
        const recorded = await store.recordMemberAge(app, observation.memberId, e164,
          accounts.phoneHash(e164), observation.age, this.clock.now());
        if (recorded) u.recordedAges.push({ ...recorded, memberId: observation.memberId });
      }
    }
    const personIds = new Map<string, string>();
    if (u.forget.size) {
      const rows = await tx`select person.id,member.id as member_id from platform.people person
        join network.members member on member.person_id=person.id where member.app_id=${app} and member.id in ${tx([...u.forget])}
        order by person.id for update of person`;
      for (const row of rows as Row[]) personIds.set(row.member_id as string, row.id as string);
    }
    const named = new Set<string>([...u.sends.map(s => s.memberId), ...(u.inbound ? [u.inbound.member_id as string] : []),
      ...(u.standingIntent ? [u.standingIntent.memberId] : []), ...u.blocks.flat(), ...u.optOut.keys(), ...u.postings.map(p => p.managerId)]);
    const known = new Set<string>();
    if (named.size) for (const r of await tx`select id from network.members where app_id = ${app} and id in ${tx([...named])}`) known.add(r.id);
    const ok = (id: string) => known.has(id) && !u.forget.has(id);
    if (u.standingIntent) {
      const change = u.standingIntent;
      if (!ok(change.memberId)) throw new Error("Standing intent owner is unavailable");
      const rows = await tx`update network.intents set status = ${change.status}
        where app_id = ${app} and id = ${change.id} and member_id = ${change.memberId}
          and status = ${change.previousStatus} and coalesce(details, '') not like ${`${JOB_INTENT}%`}
        returning id`;
      if (rows.length !== 1) throw new Error("Selected standing intent changed before commit");
    }
    if (u.legacyIntentState) {
      const inactive = new Set(u.forget);
      for (const [member, optedOut] of u.optOut) if (optedOut) inactive.add(member);
      await reconcileLegacyIntentRows(tx, app, this.cities, u.legacyIntentState, this.clock.now(), inactive);
    }
    if (u.inbound && ok(u.inbound.member_id as string)) {
      const privateRequest = u.atomicReply && privateAtomicRequests[u.atomicReply];
      const privateFields = u.privateHomeHelpTurn ? { body: "Private home-help request.", type: "bounded_home_help" }
        : u.privateInviteTurn ? { body: "Private invitation request.", type: "member_invitation_vouch" }
          : privateRequest ? { body: privateRequest, type: u.atomicReply } : {};
      await tx`insert into network.messages ${tx({ ...u.inbound, ...privateFields, app_id: app })} on conflict (id) do nothing`;
    }
    const turn = this.host.inboundTurn?.();
    const queue = this.adapter instanceof BlooioAdapter ? this.adapter.queue : undefined;
    for (const send of u.sends) {
      if (!send.invitationJoins?.length) continue;
      if (!ok(send.memberId) || send.invitationJoins.some(member => u.forget.has(member)) || !await this.invitationNoticeCurrent(tx, send.memberId, send.invitationJoins)) {
        u.collected.delete(send.id);
        u.sends = u.sends.filter(message => message.id !== send.id);
      }
    }
    // Collected replies (Cloud sends them) get the queue's own leak guard first: canary shapes, contacts,
    // the recipient's leak sources and the thread check. One that fails is not collected; it goes into
    // the queue like any other send, where the same guard parks it for staff (parked_leak_review).
    if (queue) for (const s of u.sends) {
      if (!u.collected.has(s.id) || !s.to) continue;
      const bookedLink = s.kind === "reply" && s.type === "proposal" ? this.net.approvedBookingLink(s.oppId, s.memberId, s.body, s.id) : undefined;
      const staged = u.memberInvitation;
      const reviewToken = s.type === "member_invitation_review" && staged?.status === "review" && staged.review.inviterMemberId === s.memberId
        ? inviteReviewContactToken(s.body, staged.review.id) : undefined;
      const approvedContact = bookedLink ?? reviewToken;
      const contactAllow = u.collectedPublicLinks?.get(s.id) ?? (approvedContact ? [approvedContact] : undefined);
      const reasons = await queue.collectedLeaks(tx, { id: s.id, ...(u.forget.has(s.memberId) ? {} : { memberId: s.memberId }), to: s.to, kind: s.kind, text: s.body, contactAllow });
      if (reasons.length) {
        u.collected.delete(s.id);
        if (s.type === "solo_events" || s.type === "contribution_history" || s.type === "participation_controls"
          || privateMemberMessage(s.type) || (u.atomicReply && s.type === u.atomicReply)) {
          // This result was authorized for the signed reply only.
          u.sends = u.sends.filter(message => message.id !== s.id);
          this.host.log(`[alert] a ${s.type} reply failed the collected leak guard (${this.id}, ${s.id})`);
        } else this.host.log(`[alert] a collected reply failed the leak guard and goes to the queue for review (${this.id}, ${s.id})`);
      }
    }
    const captured = u.sends.filter(s => u.collected.has(s.id) && (ok(s.memberId) || u.forget.has(s.memberId)));
    const staged = u.memberInvitation;
    const replyReason = staged ? (staged.status === "issued" ? "member_invitation" : "member_invitation_review") : u.atomicReply;
    const [reply] = captured;
    if (replyReason && !atomicMemberReplyMatches(replyReason, reply?.type ?? "", captured.length, reply?.kind === "reply")) {
      throw new Error(`Atomic ${replyReason} reply was not collected`);
    }
    if (staged) {
      const inviterId = staged.status === "issued" ? staged.referral.inviterMemberId : staged.review.inviterMemberId;
      // The invitation outcome and its allowance must roll back together if the exact reply was withheld.
      if (reply?.memberId !== inviterId || !ok(inviterId) || !this.host.saveMemberInvitation) throw new Error("Member invitation reply was not collected");
      await this.host.saveMemberInvitation(tx, this, staged);
    }
    if (captured.length) {
      if (!turn || !this.host.collectReplies) throw new Error("Signed turn collector is unavailable");
      await this.host.collectReplies(tx, captured.map(s => ({id:s.id, body:s.body, kind:s.kind === "compliance" ? "compliance" : "reply"})), replyReason);
    }
    const out = u.sends.filter(s => ok(s.memberId)).map(s => ({
      id: s.id, app_id: app, member_id: s.memberId, direction: "outbound", channel: "imessage",
      body: s.type === "bounded_home_help" ? "Private home-help reply." : s.type === "profile_fact_edit" ? "Private profile fact reply."
        : s.type === "calendar_invite" ? "Private calendar invite reply."
        : s.type === "inbox_updates" ? "Private inbox updates reply."
        : s.type === "peon_candidate_search" ? "Private job search reply."
        : gatheringMessage(s.type) ? `${gatheringPrivateBody[s.type]} reply.`
        : privateMemberMessage(s.type) ? "Private invitation reply." : s.body,
      status: u.collected.has(s.id) ? "collected" : this.adapter.storedStatus,
      inbound_id: u.collected.has(s.id) ? turn!.id : null,
      invite_join_members: s.invitationJoins ? tx.array([...s.invitationJoins], "TEXT") : null,
      booking_roster_member_ids: s.bookingRoster ? tx.array([...s.bookingRoster], "TEXT") : null,
      type: s.type ?? null, opportunity_id: s.oppId ?? null, proactive: s.proactive, system: s.system, ts: new Date(s.ts),
    }));
    // Collected replies to members join the line's thread history (platform.outbound "collected"; sent_at when Cloud accepts), so the
    // leak guard's thread check (core-14) sees what Cloud delivered, and a value split across a reply and a later text is caught.
    if (queue) await queue.recordCollected(tx, captured.filter(s => ok(s.memberId) && s.to && !privateMemberMessage(s.type))
      .map(s => ({ id: s.id, memberId: s.memberId, to: s.to!, kind: s.kind, text: s.body })));
    for (let i = 0; i < out.length; i += 500) {
      const chunk = out.slice(i, i + 500);
      const wrote = new Set((await tx`insert into network.messages ${tx(chunk)} on conflict (id) do nothing returning id`).map((r: any) => r.id as string));
      // An id that is already stored with another text is an error: the unit fails and nothing is sent under the old key (network-service-9).
      const again = chunk.filter(m => !wrote.has(m.id));
      if (again.length) {
        const stored = new Map((await tx`select id, member_id, body from network.messages where app_id = ${app} and id in ${tx(again.map(m => m.id))}`).map((r: any) => [r.id, r]));
        const clash = again.find(m => { const s = stored.get(m.id) as any; return !s || s.body !== m.body || s.member_id !== m.member_id; });
        if (clash) throw new Error(`outbound message id ${clash.id} is already stored with other content (${this.id})`);
      }
    }
    const events = u.events.filter(e => !membersOf(e).some(id => u.forget.has(id))).map(e => ({ ...e, app_id: app, at: new Date(e.at) }));
    for (let i = 0; i < events.length; i += 500) await tx`insert into network.events ${tx(events.slice(i, i + 500))}`;
    const capital = u.capital.filter(e => !u.forget.has((e as { member?: string }).member ?? "")).map(e => ({
      app_id: app, id: e.id, type: e.type, member_id: (e as { member?: string }).member ?? null, t: new Date(e.t), event: e,
    }));
    for (let i = 0; i < capital.length; i += 500) await tx`insert into network.capital_events ${tx(capital.slice(i, i + 500))} on conflict (app_id, id) do nothing`;
    const blocks = u.blocks.filter(([from, to]) => ok(from) && ok(to));
    if (blocks.length) {
      // Queue claims lock the same canonical people before reading pair safety.
      await tx`select person.id from platform.people person join network.members member on member.person_id=person.id
        where member.app_id=${app} and member.id in ${tx([...new Set(blocks.flat())])} order by person.id for key share of person`;
    }
    for (const [from, to] of blocks) {
      await tx`insert into network.edges (app_id, from_id, to_id, type, strength, explicit) values (${app}, ${from}, ${to}, 'blocked', 1, true) on conflict (from_id, to_id, type) do nothing`;
      // Blocks are person to person: the block holds on every app the two people use (the snapshot of each app reads it).
      await tx`insert into platform.person_blocks (from_person, to_person, origin_app, at)
        select f.person_id, t.person_id, ${app}, ${new Date(this.clock.now())} from network.members f, network.members t
        where f.app_id = ${app} and f.id = ${from} and t.app_id = ${app} and t.id = ${to} and f.person_id is not null and t.person_id is not null
        on conflict do nothing`;
    }
    for (const r of u.runs) await tx`insert into network.matching_runs ${tx(r)} on conflict (id) do nothing`;
    // Job postings: the intent and its tagged facets on the manager (postings.ts); never for a member this unit forgets.
    for (const p of u.postings) if (ok(p.managerId)) await savePosting(tx, app, p);
    for (const [id, out] of u.optOut) if (ok(id)) {
      await tx`update network.members set opted_out = ${out} where app_id = ${app} and id = ${id}`;
      if (out) await this.host.homeHelpRecipientStopped?.(tx, app, id);
    }
    // The forget path (an under-age decline, leaving the app, deleting everything): keep only the id. Nothing that names the member stays.
    for (const id of u.forget) {
      // Seal old signed replay payloads in the same canonical removal transaction. Keep only dedupe metadata.
      const address = this.addressOf(id);
      const senderHash = address && this.host.accounts?.phoneHash(address);
      await tx`update platform.inbound set status='unresolved',response=null,replies='[]'::jsonb,receipt=null,receipt_hash=null,action_receipts='{}'::jsonb,
        sender=null,event=null,sender_hash=null,member_id=null,app_id=null
        where request_hash is not null and app_id=${app} and (member_id=${id} or sender_hash=${senderHash ?? null})
        and id<>${turn?.id ?? ""}`;
      await tx`delete from network.messages where app_id = ${app} and member_id = ${id}`;
      await tx`delete from network.feedback where app_id = ${app} and (from_id = ${id} or about_id = ${id})`;
      // Every event that names them, by the same keys the writer reads (membersOf): actor, object and the payload.
      await tx`delete from network.events where app_id = ${app} and (actor_id = ${id} or object_id = ${id}
        or payload->>'memberId' = ${id} or payload->>'from' = ${id} or payload->>'newMemberId' = ${id} or payload->>'out' = ${id} or payload->>'in' = ${id}
        or payload->>'target' = ${id} or payload->>'by' = ${id}
        or coalesce(payload->'participants', '[]'::jsonb) @> to_jsonb(${id}::text) or coalesce(payload->'members', '[]'::jsonb) @> to_jsonb(${id}::text)
        or jsonb_exists(coalesce(payload->'attendance', '{}'::jsonb), ${id}))`;
      await tx`delete from network.capital_events where app_id = ${app} and (member_id = ${id} or position(${`"${id}"`} in event::text) > 0)`;
      await tx`delete from network.facets where app_id = ${app} and member_id = ${id}`;
      await tx`delete from network.intents where app_id = ${app} and member_id = ${id}`;
      await tx`delete from network.presence where app_id = ${app} and member_id = ${id}`;
      await tx`delete from network.edges where app_id = ${app} and (from_id = ${id} or to_id = ${id})`;
      await tx`delete from network.channel_identities where app_id = ${app} and member_id = ${id}`;
      await tx`delete from platform.member_invitations where app_id=${app} and (inviter_member_id=${id} or redeemed_member_id=${id})`;
      await tx`delete from platform.member_invitation_reviews where app_id=${app} and inviter_member_id=${id}`;
      const linkedNotices = await tx`select id,inbound_id,booking_roster_member_ids is not null as booking from network.messages where app_id=${app}
        and (${id}=any(invite_join_members) or ${id}=any(booking_roster_member_ids))`;
      if (linkedNotices.length) {
        const ids = linkedNotices.map(row => row.id as string);
        await tx`update platform.outbound set body=null, ended_at=coalesce(ended_at,${new Date(this.clock.now())}),
          status=case when status=any(${tx.array([...WAITING_STATUSES, "collected", "send_unknown"], "TEXT")}) then 'dropped_forgotten' else status end
          where app_id=${app} and id in ${tx(ids)}`;
        const turns = linkedNotices.flatMap(row => row.inbound_id ? [row.inbound_id as string] : []);
        if (turns.length) await tx`update platform.inbound set status='unresolved',response=null,replies='[]'::jsonb,
          receipt=null,receipt_hash=null,action_receipts='{}'::jsonb where app_id=${app} and id in ${tx(turns)}`;
        await tx`update network.messages set body=case when booking_roster_member_ids is not null then 'Booking notice erased.' else 'Invitation notice erased.' end,
          booking_roster_member_ids=null,invite_join_members=null where app_id=${app} and id in ${tx(ids)}`;
        const bookingDeliveries = linkedNotices.filter(row => row.booking).map(row => `net:${row.id}`);
        if (bookingDeliveries.length) await tx`update notify.inbox_items set summary='Booking notice erased.'
          where app_id=${app} and delivery_id in ${tx(bookingDeliveries)}`;
      }
      await tx`update network.members set invited_by = null where app_id = ${app} and invited_by = ${id}`;
      await tx`update network.members set name = null, home_city = null, home_area = null, account_status = 'removed', opted_out = false, age = null, invited_by = null,
        community = null, occupation = null, bio = null, participation_window=null, prefs = '{}'::jsonb, unanswered_proactive = 0, joined_at = null, person_id = null where app_id = ${app} and id = ${id}`;
      if (personIds.has(id)) await tx`select notify.forget_data(${personIds.get(id)!},${app})`;
      // The persisted queue keeps no text or address of theirs; what still waits is never sent.
      await tx`update platform.outbound set body = null, to_address = null, ended_at = coalesce(ended_at, ${new Date(this.clock.now())}),
        status = case when status = any(${`{${WAITING_STATUSES.join(",")}}`}::text[]) then 'dropped_forgotten' else status end
        where app_id = ${app} and member_id = ${id}`;
    }
    // The persisted queue: the unit's sends in this same transaction (delivered after the commit). The one
    // decline to a member the unit forgets goes as a text to a non-member. Sends it does not queue (the live
    // flags are off, no address) get their status here.
    if (this.adapter.enqueue) {
      const queued = u.sends.filter(s => !u.collected.has(s.id) && (ok(s.memberId) || u.forget.has(s.memberId)));
      const refused = await this.adapter.enqueue(tx, queued, u.forget);
      for (const [id, status] of refused) await tx`update network.messages set status = ${status} where app_id = ${app} and id = ${id} and direction = 'outbound'`;
    }
    // Last: the action receipt commits with the relay log, the messages and the queued rows, or none of them do.
    await u.completeAction?.(tx);
  }

  /**
   * Deliver what was committed: the platform consent ledger, the member's own opt-out and the person
   * cap first, then the adapter; store each new status. An adapter error keeps the rows waiting: the
   * next tick hands them over again (the provider key stops a second send).
   */
  async deliver() {
    const batch = this.committed.splice(0);
    // The persisted queue holds the sends already (written in the save): it delivers what is due.
    if (this.adapter.enqueue) return this.drainQueue();
    if (!batch.length) return;
    // The platform consent ledger is the source of truth for STOP at send time (not an adapter's memory).
    const stopped = (await this.host.consentRefused?.(this, batch)) ?? new Set<string>();
    // The member's own opt-out (network.members.opted_out), whatever wrote it.
    const ids = [...new Set(batch.filter(b => b.kind !== "compliance" && !stopped.has(b.id)).map(b => b.memberId))];
    if (ids.length) {
      const out = new Set((await this.scoped(tx => tx`select id from network.members where app_id = ${this.app.id} and opted_out and id in ${tx(ids)}`)).map((r: any) => r.id as string));
      for (const b of batch) if (b.kind !== "compliance" && out.has(b.memberId)) stopped.add(b.id);
    }
    const open = batch.filter(b => !stopped.has(b.id));
    const capped = await this.host.capRefused(this, open);
    const go = open.filter(b => !capped.has(b.id));
    await this.storeStatuses([...stopped].map(id => ({ id, status: "refused_opted_out" })));
    await this.storeStatuses([...capped].map(id => ({ id, status: "refused_person_cap" })));
    if (!go.length) return;
    try {
      const ds = await this.adapter.deliver(go);
      await this.storeStatuses(ds, new Set(go.map(b => b.id)));
      // A send the adapter refused did not go out: its person-cap slot goes back (dry-run counts as sent).
      const notSent = ds.filter(d => NOT_SENT.test(d.status)).map(d => d.id);
      if (notSent.length) await this.host.capRelease?.(notSent);
      if (this.host.delivered) {
        const accepted = new Set(ds.filter(d => /^(accepted|sent|delivered|read|dry_run)$/.test(d.status)).map(d => d.id));
        const sent = go.filter(b => accepted.has(b.id));
        if (sent.length) await this.host.delivered(this, sent).catch(e => this.host.log(`[deliver] delivered hook failed (${this.id}): ${(e as Error).message}`));
      }
    } catch (e) {
      this.host.log(`[deliver] ${go.length} send(s) wait for the next tick (${this.id}): ${(e as Error).message}`);
      this.retry.push(...go);
    }
  }
  /** Sends the adapter could not take (an error after commit): handed over again on the next tick. */
  private retry: Outbound[] = [];

  /**
   * The persisted queue: deliver what is due for this app (consent, the person cap and every line rule
   * are checked at send time inside the queue), store the new statuses, and give the sends that went
   * out to the host (the inbox). An error leaves the rows in the queue for the next tick.
   */
  private async drainQueue() {
    let ds: Delivery[];
    try { ds = await this.adapter.deliver([]); } catch (e) { this.host.log(`[deliver] the queue waits for the next tick (${this.id}): ${(e as Error).message}`); return; }
    const mine = ds.filter(d => d.memberId && (d.app ?? this.app.id) === this.app.id);
    await this.storeStatuses(mine);
    await this.projectNotifications();
  }

  /** Repair the existing Notify projection after acceptance, including a crash after its SQL commit. */
  async projectNotifications() {
    if (!this.host.delivered) return;
    await this.store.withLock(async () => {
      const rows = await this.scoped(tx => tx`select m.id,m.member_id,m.body,m.type,m.opportunity_id,m.proactive,m.system,m.ts,o.kind,o.sent_at,o.status as outbound_status
        from network.messages m left join platform.outbound o on o.id=m.id and o.app_id=m.app_id
        left join platform.inbound inbound on inbound.id=m.inbound_id
        join network.members member on member.app_id=m.app_id and member.id=m.member_id
        where m.app_id=${this.app.id} and m.direction='outbound' and member.account_status<>'removed'
        and m.notification_recorded_at is null and (
          (o.status in ('accepted','sent','delivered','read') and o.sent_at is not null and o.body is not null and o.to_address is not null)
          or (o.id is null and m.status='sent' and inbound.status='done' and inbound.receipt->>'outcome'='accepted'))
        order by coalesce(o.sent_at,m.ts),m.id limit 50`);
      for (const r of rows as Row[]) {
        const message:Outbound={id:r.id as string,memberId:r.member_id as string,body:r.body as string,kind:(r.kind??"reply") as Outbound["kind"],
          type:r.type as string|undefined,oppId:r.opportunity_id as string|undefined,proactive:r.proactive as boolean,system:r.system as boolean,
          ts:new Date(r.ts as string).getTime(),...(r.sent_at?{acceptedAt:new Date(r.sent_at as string).getTime()}:{} )};
        try {
          await this.host.delivered!(this,[message]);
          // The select qualified the row; mark it by id alone (a message whose status lagged the queue's, e.g. a crash after
          // acceptance, would otherwise be selected and projected again on every drain), and repair that status from the queue's.
          await this.scoped(tx=>tx`update network.messages set notification_recorded_at=${new Date(this.clock.now())},
            status=coalesce(${(r.outbound_status as string | null) ?? null}::text,status)
            where id=${message.id} and app_id=${this.app.id} and notification_recorded_at is null and direction='outbound'`);
        } catch {this.host.log(`[deliver] notification projection waits (${this.id})`);}
      }
    });
  }

  async storeStatuses(ds: Delivery[], only?: Set<string>) {
    const rows = ds.filter(d => d.status !== this.adapter.storedStatus && (!only || only.has(d.id)));
    if (!rows.length) return;
    await this.scoped(async tx => {
      for (const d of rows) await tx`update network.messages set status = ${d.status} where app_id = ${this.app.id} and id = ${d.id} and direction = 'outbound'`;
    });
  }

  private async currentCalendarOwner(tx: SQL, e164: string, memberId: MemberId, localOptIn: boolean): Promise<CalendarSchedulingOwner | undefined> {
    if (!localOptIn) return;
    const accounts = this.host.accountsFor?.(tx) ?? this.host.accounts;
    const binding = await accounts?.activeMembership(this.app, { e164, personId: null });
    if (!binding || binding.membership.memberId !== memberId) return;
    const [member] = await tx`select id,prefs,participation_state,participation_window from network.members where app_id=${this.app.id} and id=${memberId}
      and person_id=${binding.person.id} and account_status='active' and not opted_out
      and (select count(*) from platform.phone_identities phone where phone.person_id=${binding.person.id})=1`;
    const adult = canBeMatched(await accounts!.lowestAge(e164, binding.person));
    const exact = !!member && effectiveParticipation(member as Parameters<typeof effectiveParticipation>[0], this.clock.now()).state !== "paused";
    if (calendarBridgeOwnerAllowed(adult, localOptIn, exact)) return { app: this.app.id, personId: binding.person.id, memberId };
  }

  async calendarSchedulingOwner(e164: string, memberId: MemberId): Promise<CalendarSchedulingOwner | undefined> {
    const state = await this.pg.load();
    return this.scoped(tx => this.currentCalendarOwner(tx, e164, memberId, storedCalendarOwnerOptedIn(state, memberId)));
  }

  private async withSchedulingCalendar<T>(target: CalendarSchedulingTarget | undefined, operation: () => Promise<T>): Promise<T> {
    const bridge = this.calendarScheduling;
    if (!bridge || !target) return operation();
    const view = new Map<MemberId, CalendarSchedulingObservation>();
    try {
      const state = await this.pg.load();
      const ids = state ? schedulingCalendarMembers(state, target, this.clock.now()).slice(0, 12) : [];
      const owners = ids.length ? await this.scoped(async tx => {
        const rows = await tx<{ member_id: string; e164: string }[]>`select m.id as member_id, ph.e164 from network.members m
          join platform.phone_identities ph on ph.person_id=m.person_id and ph.hold is null
          where m.app_id=${this.app.id} and m.id in ${tx(ids)} order by m.id,ph.e164`;
        const canonical: CalendarSchedulingOwner[] = [];
        for (const id of ids) {
          const phones = rows.filter(row => row.member_id === id);
          if (phones.length !== 1) continue;
          const owner = await this.currentCalendarOwner(tx, phones[0]!.e164, id, true);
          if (owner) canonical.push(owner);
        }
        return canonical;
      }) : [];
      await Promise.all(owners.map(async owner => {
        const current = await bridge.load(owner);
        if (current) view.set(owner.memberId, current);
      }));
    } catch { /* No valid calendar authority is available for this scheduling unit. */ view.clear(); }
    return this.calendarViews.run(view, operation);
  }

  /** One tick under the lock (skipped when another holder has it), then delivery. */
  async tick(): Promise<boolean> {
    const now = this.clock.now();
    const ran = await this.withSchedulingCalendar({ kind: "tick" }, () => runTick(this.net, this.store, this.clock.now()));
    this.lastTick = { at: now, ran };
    if (this.retry.length) this.committed.unshift(...this.retry.splice(0));
    await this.deliver();
    await this.storeStatuses(await this.adapter.flush());
    if (tickRepairsProjection(ran, !!this.adapter.enqueue)) await this.projectNotifications();
    if (tickRunsFollowup(ran, !!this.host.afterTick)) await this.host.afterTick?.(this).catch(e => this.host.log(`[tick] after-tick work failed (${this.id}): ${(e as Error).message}`));
    return ran;
  }

  /** A unit that waits for the lock (an inbound message or a staff action), then delivery. */
  async unitOfWork<T>(fn: (n: ConsentNetwork) => Promise<T> | T, scheduling?: CalendarSchedulingTarget): Promise<T> {
    const out = await this.withSchedulingCalendar(scheduling, () => runStored(this.net, this.store, fn));
    await this.deliver();
    return out;
  }

  /** The review queue, oldest first, from the newest stored state. Read-only: nothing is saved (audit network-service-19). */
  reviewQueue() {
    return this.store.withLock(async () => {
      const s = await this.store.load();
      if (s) this.net.importState(s);
      this.unit = newUnit();
      return this.net.reviewQueue();
    });
  }

  /** Read the newest stored state without saving anything (like reviewQueue). */
  readState<T>(fn: (n: ConsentNetwork) => T): Promise<T> {
    return this.store.withLock(async () => {
      const s = await this.store.load();
      if (s) this.net.importState(s);
      this.unit = newUnit();
      return fn(this.net);
    });
  }

  /** Model-visible projection from the canonical snapshot, reauthorized inside its read lock. */
  sharedContext(memberId: string): Promise<TurnContext | null> {
    return this.store.withLock(async () => {
      await this.refresh();
      const e164 = this.addressOf(memberId);
      const accounts = this.host.accounts;
      // spec/sharedContext.md, "Only the canonical member of the requested app can receive context"
      const account = stepContext(initialContext, { type: "checkAccount", canReadAccount: !!e164 && !!accounts });
      if (account.phase !== "CheckingMembership" || !e164 || !accounts) return null;
      const binding = await accounts.activeMembership(this.app, {e164, personId: null});
      const membership = stepContext(account, { type: "checkMembership", exactMember: binding?.membership.memberId === memberId });
      if (membership.phase !== "CheckingMember" || !binding) return null;
      const snapshot = this.snap!;
      const member = snapshot.members.find(m => m.id === memberId);
      if (!member) return null;
      const [canonical] = await this.scoped(tx => tx`select participation_state,participation_window,opted_out from network.members where app_id=${this.app.id} and id=${memberId}`);
      if (!canonical) return null;
      const participation = effectiveParticipation(canonical as {participation_state: typeof member.state; participation_window?:unknown; opted_out?:boolean},snapshot.now);
      const stateByMode = {
        ModeOpen: "open", ModeBusy: "busy", ModeTraveling: "traveling", ModePaused: "paused", ModeUnavailable: null,
      } as const satisfies Record<ContextMode, TurnContext["state"] | null>;
      const state = stateByMode[contextMode(participation.active, participation.window?.state ?? "", participation.state)];
      const memberContext = stepContext(membership, { type: "checkMember", memberAndModeExist: state !== null });
      if (memberContext.phase !== "CheckingLabels" || state === null) return null;
      const firstName = member.name.trim().split(/\s+/)[0] ?? "";
      const forbidden = [e164, binding.person.id, ...snapshot.facets.map(f => f.id), ...snapshot.members.flatMap(m => {
        const first = m.name.trim().split(/\s+/)[0] ?? "";
        // A shared first name is also the caller's own public name. Keep other full names private.
        const otherName = m.name.trim().toLowerCase() !== firstName.toLowerCase() ? [m.name] : [];
        return m.id === memberId ? [m.id] : [m.id, ...otherName, ...(first.toLowerCase() !== firstName.toLowerCase() ? [first] : [])];
      })];
      const facts = [...snapshot.facets.filter(f => f.scope === "agent_private").map(f => f.value),...(participation.window?.note?[participation.window.note]:[])];
      const safe = (text: string) => outputLeaks(text, {forbidden, facts, contacts: true}).length === 0;
      // spec/sharedContext.md, "Check the public labels and each confirmed shareable fact"
      const labels = stepContext(memberContext, { type: "checkLabels", labelsSafe: safe(firstName) && safe(member.homeCity) });
      if (labels.phase !== "CheckingFacets") return null;
      const facets = snapshot.facets.filter(f => contextFacetEligible(f.memberId === memberId, f.scope === "shareable", f.confirmedByMember === true,
        !!f.sensitive, (f.validFrom === undefined || f.validFrom <= snapshot.now) && (f.validTo === undefined || f.validTo > snapshot.now)) && safe(f.value)).map(f => f.value);
      // The deployed plugin contract rejects larger context. Withhold it whole; never truncate a fact.
      const ready = stepContext(labels, { type: "checkFacets", facetCount: facets.length,
        oversized: facets.length <= contextFacetLimit && facets.some(f => f.length > contextFacetSizeLimit),
      });
      if (ready.phase !== "ContextReady") return null;
      const present = presentInNyc(snapshot, member.id, snapshot.now, snapshot.now + 6 * DAY);
      return {
        firstName, city: member.homeCity, state, stateFrom: participation.active?participation.window!.from:null, stateUntil: participation.active?participation.window!.until:null, facets,
        activeItems: null, singlePlayer: contextSinglePlayer(present, present && canBeMatched(await accounts.lowestAge(e164, binding.person))),
      };
    });
  }

  /** Health for the heartbeat alert (PRD 35.2): last tick, lock holder, backlog, refusals. Reads the stored state; changes nothing. */
  async health() {
    const key = `network-tick-${this.pg.id}`;
    const [holder] = await this.sql`select l.pid, a.application_name from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where l.locktype = 'advisory' and l.granted and l.objsubid = 1 and ((l.classid::bigint << 32) | l.objid::bigint) = hashtext(${key})::bigint limit 1`;
    const [saved, statuses, capital] = await this.scoped(async tx => [
      (await tx`select saved_at from network.network_state where id = ${this.pg.id}`)[0],
      await tx`select status, count(*)::int as n from network.messages where app_id = ${this.app.id} and direction = 'outbound' group by status`,
      (await tx`select count(*)::int as n from network.capital_events where app_id = ${this.app.id}`)[0],
    ]);
    const state = await this.loadState();
    const now = this.clock.now();
    const review = state?.opps.filter(o => o.stage === "review" && o.review) ?? [];
    const byStatus = Object.fromEntries((statuses as any[]).map(r => [r.status, r.n]));
    const channel = Object.fromEntries(Object.entries(byStatus).filter(([s]) => /^(refused|suppressed|parked|blocked|failed|held|expired)/.test(s)));
    return {
      ok: true, instance: this.host.instance, network: this.id, app: this.app.id, city: this.city, channel: this.adapter.name, reviewMode: "human" as const,
      matchingAllowed: this.matchingAllowed,
      matchingEnabled: this.matchingAllowed && (state?.matchingEnabled ?? this.net.matchingEnabled()),
      lastTick: { thisInstance: this.lastTick ?? null, stored: state?.lastTick || null, savedAt: saved ? new Date((saved as any).saved_at).getTime() : null },
      lockHolder: holder ? { pid: holder.pid, application: holder.application_name } : null,
      backlog: {
        review: review.length, reviewOverdue: review.filter(o => now >= o.review!.deadline).length, deferred: state?.deferred.length ?? 0,
        outboundWaiting: WAITING_STATUSES.reduce((n, st) => n + (byStatus[st] ?? 0), 0) + this.retry.length,
      },
      refusals: { sendRefused: state?.counters.sendRefused ?? 0, guardBlocked: state?.counters.guardBlocked ?? 0, channel },
      capital: { stored: (capital as any)?.n ?? 0, rejected: this.capital.rejected() },
    };
  }
}

