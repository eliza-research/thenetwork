// One network ('<app>:<city>') inside the production service (service.ts holds one runtime per row
// of platform.networks). What a runtime does:
//  - Every unit of work (a tick, an inbound message, a staff action) runs under this network's own
//    PgStore advisory lock (key network-tick-<app>:<city>), loads the newest stored state and a fresh
//    snapshot of this app's rows, and saves after. A slow network never blocks another one.
//  - Every query on a network table runs in a transaction with `set_config('app.app_id', <app>, true)`
//    (scoped()), so the service works under the network_service role, whose row-level security shows
//    one app per transaction (audit network-service-M1). Every row also names its app explicitly.
//  - What a unit produced (messages, events, blocks, engine runs, network capital events, opt-outs, a
//    forget) is written in the same transaction as the Network state, then the channel adapter
//    delivers it: the platform consent ledger, the member's opt-out and the person cap first.
//  - After a restart the state is loaded first, then the rows that wait for delivery are delivered
//    once; rows past their time (a probe after 24 h, anything after 3 days, an item that closed) are
//    stored as expired and never sent (audit network-service-2).
//  - Nothing here reads another app's rows; the person cap across apps (service.ts) goes through a
//    SECURITY DEFINER function that returns ids only.
import { randomUUID } from "node:crypto";
import type { SQL } from "bun";
import { DAY, defaultLLM, type City, type Clock, type MemberId, type WorldSnapshot } from "@thenetwork/core";
import type { RunRecord } from "@thenetwork/core";
import type { NetworkContext, SimMessage } from "@thenetwork/core";
import { ConsentNetwork, type NetworkOptions, type NetworkState } from "../src/network.ts";
import { PgStore, runStored, runTick, type NetworkStore } from "../src/store.ts";
import { capitalWiring, type CapitalEvent } from "../src/capital.ts";
import { llmUnderstand } from "../src/extract.ts";
import type { MemberSettings } from "../src/intents.ts";
import { CHAT_FACET, learnedFacetRows, sameRow, type LearnedFacetRow } from "../src/learned.ts";
import { EVIDENCE_RETENTION_MS, type SafetySignal } from "../src/safety.ts";
import type { AppInfo } from "../../platform/src/apps.ts";
import { loadSnapshot } from "./snapshot.ts";
import { appWiring, type AppWiring } from "./packs.ts";
import { DryRunAdapter, WAITING_STATUSES, type ChannelAdapter, type Delivery, type Outbound } from "./channel.ts";
import { normalizeAddress } from "../../blooio/src/phone.ts";
// The Observatory's event shape and run summaries, so the console reads what this writes.
import { eventOf, membersOf, type EventRow } from "../../observatory/src/events.ts";

/** Delivery statuses of a send that did not go out (its person-cap slot is released). */
const NOT_SENT = /^(refused|suppressed|blocked|parked|failed)/;
import { summarizeRun } from "../../observatory/src/engineCapture.ts";

type Row = Record<string, unknown>;

/** A waiting row older than this is never sent after a restart (a probe or a proactive message: 24 h; anything else: 3 days). */
export const WAITING_TTL_PROACTIVE_MS = DAY;
export const WAITING_TTL_MS = 3 * DAY;
/** Opportunity stages after which a message about it is stale. */
const CLOSED_STAGES = new Set(["done", "closed"]);

/** What one unit of work produced. Written in the save transaction, then delivered. */
export interface Unit {
  inbound?: Row;
  sends: Outbound[];
  events: EventRow[];
  blocks: [MemberId, MemberId][];
  runs: Row[];
  capital: CapitalEvent[];
  optOut: Map<MemberId, boolean>;
  forget: Set<MemberId>;
  /** Settings members changed by text (pause, quiet hours, how often), for network.members. */
  settings: Map<MemberId, MemberSettings>;
  /** Safety signals (safety.ts): evidence holds are written with the unit; holds and minor reports go to the service after it commits. */
  safety: SafetySignal[];
}
const newUnit = (): Unit => ({ sends: [], events: [], blocks: [], runs: [], capital: [], optOut: new Map(), forget: new Set(), settings: new Map(), safety: [] });

/** What the service gives each runtime: the shared connection and clock, and the checks that span apps. */
export interface RuntimeHost {
  sql: SQL;
  clock: Clock;
  instance: string;
  log: (line: string) => void;
  /** Proactive sends of this batch the person-level daily cap refuses (ids). Called before delivery. */
  capRefused(rt: NetworkRuntime, batch: Outbound[]): Promise<Set<string>>;
  /** Give back the person-cap slots of sends the adapter refused (they never went out). */
  capRelease?(ids: string[]): Promise<void>;
  /** Sends of this batch to a number the platform consent ledger has opted out of this app (ids). Called before delivery. */
  consentRefused?(rt: NetworkRuntime, batch: Outbound[]): Promise<Set<string>>;
  /** The sends the adapter took (not refused or failed), after their statuses are stored. Errors are logged, never retried. */
  delivered?(rt: NetworkRuntime, sent: Outbound[]): Promise<void>;
  /** Person-level safety after a unit committed (a hold on every app, a minor report). Errors are logged; the network's own hold already stands. */
  safety?(rt: NetworkRuntime, signals: SafetySignal[]): Promise<void>;
}

export interface RuntimeOptions {
  /** '<app>:<city>' (platform.networks.id). */
  id: string;
  app: AppInfo;
  city: string;
  /** platform.networks.matching_enabled: false keeps matching off whatever the stored switch says. */
  matchingAllowed: boolean;
  network?: Omit<NetworkOptions, "store" | "onEngineRun" | "app">;
  adapter?: ChannelAdapter | ((net: ConsentNetwork, rt: NetworkRuntime) => ChannelAdapter);
}

export class NetworkRuntime {
  readonly id: string;
  readonly app: AppInfo;
  readonly city: string;
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
  private snap?: WorldSnapshot;
  private addrToMember = new Map<string, MemberId>();
  private memberToAddr = new Map<MemberId, string>();
  /** The unit being built. The service adds system sends (keyword confirmations) to it. */
  unit = newUnit();
  /** Sends committed with their state, waiting to be delivered (in commit order). */
  private committed: Outbound[] = [];
  /** Safety signals committed with their unit, for the service (RuntimeHost.safety). */
  private committedSafety: SafetySignal[] = [];
  /** Ages members stated in the units since the service last took them (takeAges). */
  private statedAges: { memberId: MemberId; age: number; explicit: boolean; declined: boolean }[] = [];
  /** The ages this member stated (and whether the Network declined them), taken once. */
  takeAges(memberId: MemberId) {
    const mine = this.statedAges.filter(a => a.memberId === memberId);
    this.statedAges = this.statedAges.filter(a => a.memberId !== memberId);
    return mine;
  }
  /** Who the inbound message being handled came from: sends to them are direct replies. */
  replyingTo?: MemberId;
  /** Message ids are unique across restarts and instances: `${member}:${time}:${nonce}${seq}`. */
  private readonly nonce = randomUUID().slice(0, 8);
  private seq = 0;
  lastTick?: { at: number; ran: boolean };

  constructor(private readonly host: RuntimeHost, o: RuntimeOptions) {
    this.id = o.id; this.app = o.app; this.city = o.city; this.matchingAllowed = o.matchingAllowed;
    this.pg = new PgStore(host.sql, o.id);
    this.store = this.serviceStore();
    this.wiring = appWiring(o.app.id);
    const w = this.wiring;
    this.net = new ConsentNetwork({
      matchingEnabled: false,
      // The app's pack and the engine config it was tuned with (options may override single fields).
      ...(w.pack ? { pack: w.pack } : {}), ...(w.hooks ? { hooks: w.hooks } : {}), ...(w.plansConfig ? { plansConfig: w.plansConfig } : {}), ...(w.plans !== undefined ? { plans: w.plans } : {}),
      // A contact swap both members said yes to (relay.ts) sends each the other's phone number; never an Apple ID or email.
      contactOf: id => { const a = this.addressOf(id); return a?.startsWith("+") ? a : undefined; },
      ...o.network,
      ...(w.engine || o.network?.engine ? { engine: { ...w.engine, ...o.network?.engine } } : {}),
      app: o.app, review: "human", store: this.store,
      onEngineRun: (log, proposals, at) => {
        const s = summarizeRun(log, proposals, { at, city: this.city as City, wallMs: Math.round(log.timingsMs.total ?? 0) });
        this.unit.runs.push({ id: this.app.id === "ntwrk" ? s.id : `${this.app.id}.${s.id}`, app_id: this.app.id, at: new Date(at), city: this.city, engine_version: s.engineVersion, proposals: s.proposals, wall_ms: s.wallMs, summary: s });
      },
      onLedger: e => { this.capital.onLedger(e); this.unit.capital.push(e); },
      // An age a member stated (network-consent-12): the service writes it to the person after the unit.
      onAgeStated: (memberId, age, o) => { this.statedAges.push({ memberId, age, ...o }); },
      // A pause, quiet hours or cadence the member set by text: written to network.members with the unit.
      onSettings: (memberId, st) => { this.unit.settings.set(memberId, { ...this.unit.settings.get(memberId), ...st }); },
      // The LLM reader (gpt-6-luna via defaultLLM, OpenAI fallback) and the engine judge are off unless turned on.
      ...(process.env.NETWORK_LLM_READER === "1" ? { understand: llmUnderstand(defaultLLM(), { app: o.app.id }) } : {}),
      ...(process.env.NETWORK_ENGINE_JUDGE === "1" ? { engineLLM: defaultLLM() } : {}),
      // Safety across apps (safety.ts): written with the unit (evidence) or applied by the service after it.
      onSafety: s => { this.unit.safety.push(s); },
    });
    this.net.init(this.context());
    this.adapter = typeof o.adapter === "function" ? o.adapter(this.net, this) : o.adapter ?? new DryRunAdapter(host.log);
  }

  private get sql() { return this.host.sql; }
  private get clock() { return this.host.clock; }

  /** A transaction for this app: row-level security (network_service) shows and accepts this app's rows only. */
  scoped<T>(fn: (tx: SQL) => Promise<T>): Promise<T> {
    return this.sql.begin(async tx => {
      await tx`select set_config('app.app_id', ${this.app.id}, true)`;
      return fn(tx);
    }) as Promise<T>;
  }

  /** The stored state of this network (inside an app-scoped transaction). */
  private async loadState(): Promise<NetworkState | undefined> {
    const [r] = await this.scoped(tx => tx`select state from network.network_state where id = ${this.pg.id}`);
    const s = r?.state;
    return s === undefined ? undefined : ((typeof s === "string" ? JSON.parse(s) : s) as NetworkState);
  }

  /**
   * After a restart: load the state first (the queue checks each recipient against it), then deliver
   * what waits once. A row past its time, or about an opportunity that closed, is stored as expired.
   */
  async start() {
    // The ledger starts from what is stored (events this process did not emit), oldest first.
    for (const r of await this.scoped(tx => tx`select event from network.capital_events where app_id = ${this.app.id} order by t, id`) as any[]) {
      try { this.capital.ledger.record(typeof r.event === "string" ? JSON.parse(r.event) : r.event); } catch { /* out of order: counted by the wiring only for new events */ }
    }
    if (this.adapter.storedStatus === "dry_run") return;
    await this.unitOfWork(async n => {
      const rows = await this.scoped(tx => tx`select id, member_id, body, type, opportunity_id, proactive, system, ts from network.messages
        where app_id = ${this.app.id} and direction = 'outbound' and status = any(${`{${WAITING_STATUSES.join(",")}}`}::text[]) order by ts, id`) as any[];
      const now = this.clock.now();
      const expired: string[] = [];
      for (const r of rows) {
        const age = now - new Date(r.ts).getTime();
        const opp = r.opportunity_id ? n.opps.get(r.opportunity_id) : undefined;
        const stale = age > WAITING_TTL_MS || (r.proactive && age > WAITING_TTL_PROACTIVE_MS) || (opp !== undefined && CLOSED_STAGES.has(opp.stage));
        if (stale) { expired.push(r.id); continue; }
        this.committed.push({
          id: r.id, memberId: r.member_id, to: this.memberToAddr.get(r.member_id), body: r.body, kind: r.system ? "compliance" : r.proactive ? "proactive" : "transactional",
          type: r.type ?? undefined, oppId: r.opportunity_id ?? undefined, proactive: r.proactive, system: r.system, ts: new Date(r.ts).getTime(),
        });
      }
      if (expired.length) {
        await this.storeStatuses(expired.map(id => ({ id, status: "expired" })));
        this.host.log(`[restart] ${expired.length} waiting message(s) expired, not sent (${this.id})`);
      }
    });
  }

  // ------------------------------------------------------------------ units of work
  /** The store the Network uses: every load starts a unit (fresh snapshot); every save writes the unit in the same transaction. */
  private serviceStore(): NetworkStore {
    return {
      load: async () => {
        this.unit = newUnit();
        await this.refresh();
        const state = await this.loadState();
        // The registry's switch wins: a network whose matching is not allowed never matches, whatever was stored.
        if (state && !this.matchingAllowed) state.matchingEnabled = false;
        return state;
      },
      save: async (state: NetworkState) => {
        const u = this.unit;
        // PgStore.save sets app.app_id for its own transaction; the unit's rows go in the same one.
        await this.pg.save(state, async tx => { await this.writeUnit(tx, u); await this.writeLearned(tx, state, u); });
        this.committed.push(...u.sends);
        this.committedSafety.push(...u.safety.filter(x => x.t !== "evidence"));
        this.unit = newUnit();
      },
      withTickLock: fn => this.pg.withTickLock(fn),
      withLock: fn => this.pg.withLock(fn),
    };
  }

  /** The snapshot and the address book, read fresh for every unit (inside the lock), in one app-scoped transaction. */
  private async refresh() {
    this.snap = await this.scoped(tx => loadSnapshot(tx, this.clock.now(), { app: this.app.id, city: this.city }));
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
      await tx`select ci.member_id, ci.address from network.channel_identities ci
        join network.members m on m.app_id = ci.app_id and m.id = ci.member_id
        where ci.app_id = ${this.app.id} and ci.channel in ('imessage', 'sms') and m.account_status not in ('invited', 'removed') order by ci.is_primary desc, ci.member_id`,
      // A number on hold (it may have a new owner) is nobody's address until staff decide.
      await tx`select m.id as member_id, ph.e164 as address from network.members m join platform.phone_identities ph on ph.person_id = m.person_id
        where m.app_id = ${this.app.id} and m.account_status not in ('invited', 'removed') and ph.hold is null order by m.id`,
    ]);
    this.addrToMember.clear(); this.memberToAddr.clear();
    for (const r of [...platform, ...legacy] as any[]) {
      const a = normalizeAddress(r.address);
      this.addrToMember.set(a, r.member_id);
      if (!this.memberToAddr.has(r.member_id)) this.memberToAddr.set(r.member_id, a);
    }
  }

  /** Address to member of this app (E.164 or Apple ID, normalized), from the last refresh. */
  memberOf = (address: string): MemberId | undefined => this.addrToMember.get(normalizeAddress(address));
  addressOf = (id: MemberId): string | undefined => this.memberToAddr.get(id);

  private context(): NetworkContext {
    const ev = (rec: unknown) => { const e = eventOf(rec as RunRecord); if (e) this.unit.events.push(e); };
    return {
      clock: this.clock,
      send: (memberId, body, o) => {
        const t = this.clock.now();
        const meta = o?.meta ?? {};
        const id = o?.idempotencyKey ?? `${memberId}:${t}:${this.nonce}${++this.seq}`;
        this.unit.sends.push({
          id, memberId, to: this.memberToAddr.get(memberId), body,
          // "reply" only when the Network says so (send(): never a proactive send, a growth ask, a
          // re-engagement or a check-in), so the queue's quiet hours and caps still apply to those.
          kind: o?.reply && this.replyingTo === memberId ? "reply" : meta.proactive ? "proactive" : "transactional",
          // A probe names its opportunity only in meta.probe (anonymous to the member); the row links it either way.
          type: meta.type, oppId: meta.proposalId ?? meta.probe?.key, proactive: !!meta.proactive, system: false, ts: t,
        });
        return { id, ts: t, direction: "outbound", channel: "imessage", from: "network", to: memberId, memberId, body, status: "delivered", meta } satisfies SimMessage;
      },
      snapshot: () => this.snap ?? { now: this.clock.now(), members: [], facets: [], intents: [], presence: [], edges: [], recentProposals: [] },
      // A proposal record has no oracle in production; eventOf reads only the proposal and the source.
      recordProposal: (proposal, source = "network") => ev({ t: this.clock.now(), type: "proposal", source, proposal }),
      recordMeeting: m => { ev({ t: this.clock.now(), type: "meeting_scheduled", meetingId: m.proposalId, proposalId: m.proposalId, participants: m.participants, at: m.at, city: m.city }); return m.proposalId; },
      recordBlock: (from, to) => { this.unit.blocks.push([from, to]); ev({ t: this.clock.now(), type: "block", from, to }); },
      log: (kind, detail) => ev({ t: this.clock.now(), type: "network_log", kind, detail }),
    };
  }

  /** A system send (keyword confirmations, the link notice) in the current unit. It does not go through the Network. */
  system(memberId: MemberId, id: string, body: string, kind: Outbound["kind"] = "compliance", type = "system") {
    this.unit.sends.push({ id, memberId, to: this.memberToAddr.get(memberId), body, kind, type, proactive: false, system: true, ts: this.clock.now() });
  }

  /** Everything the unit produced, inside the save transaction (app.app_id is set). Rows that name a member not in this app's network.members are skipped. */
  private async writeUnit(tx: SQL, u: Unit) {
    const app = this.app.id;
    const named = new Set<string>([...u.sends.map(s => s.memberId), ...(u.inbound ? [u.inbound.member_id as string] : []), ...u.blocks.flat(), ...u.optOut.keys()]);
    const known = new Set<string>();
    if (named.size) for (const r of await tx`select id from network.members where app_id = ${app} and id in ${tx([...named])}`) known.add(r.id);
    const ok = (id: string) => known.has(id) && !u.forget.has(id);
    if (u.inbound && ok(u.inbound.member_id as string)) await tx`insert into network.messages ${tx({ ...u.inbound, app_id: app })} on conflict (id) do nothing`;
    const out = u.sends.filter(s => ok(s.memberId)).map(s => ({
      id: s.id, app_id: app, member_id: s.memberId, direction: "outbound", channel: "imessage", body: s.body, status: this.adapter.storedStatus,
      type: s.type ?? null, opportunity_id: s.oppId ?? null, proactive: s.proactive, system: s.system, ts: new Date(s.ts),
    }));
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
    for (const [from, to] of u.blocks) if (ok(from) && ok(to)) {
      await tx`insert into network.edges (app_id, from_id, to_id, type, strength, explicit) values (${app}, ${from}, ${to}, 'blocked', 1, true) on conflict (from_id, to_id, type) do nothing`;
      // Blocks are person to person: the block holds on every app the two people use (the snapshot of each app reads it).
      await tx`insert into platform.person_blocks (from_person, to_person, origin_app, at)
        select f.person_id, t.person_id, ${app}, ${new Date(this.clock.now())} from network.members f, network.members t
        where f.app_id = ${app} and f.id = ${from} and t.app_id = ${app} and t.id = ${to} and f.person_id is not null and t.person_id is not null
        on conflict do nothing`;
    }
    for (const r of u.runs) await tx`insert into network.matching_runs ${tx(r)} on conflict (id) do nothing`;
    for (const [id, out] of u.optOut) if (ok(id)) await tx`update network.members set opted_out = ${out} where app_id = ${app} and id = ${id}`;
    // Settings the member changed by text: the record the snapshot, the engine and the settings page read.
    for (const [id, st] of u.settings) {
      if (!ok(id) && !(await tx`select 1 from network.members where app_id = ${app} and id = ${id}`).length) continue;
      if (st.state) await tx`update network.members set participation_state = ${st.state} where app_id = ${app} and id = ${id}`;
      if (st.quietHours) await tx`update network.members set prefs = jsonb_set(coalesce(prefs, '{}'::jsonb), '{quietHours}', (${JSON.stringify(st.quietHours)}::text)::jsonb) where app_id = ${app} and id = ${id}`;
    }
    // Evidence holds (safety.ts): a report or a case keeps both people's messages, feedback and events
    // for EVIDENCE_RETENTION_DAYS, even when they delete their data. Written before the forget below.
    const until = new Date(this.clock.now() + EVIDENCE_RETENTION_MS);
    for (const s of u.safety) if (s.t === "evidence") for (const id of new Set(s.memberIds)) {
      await tx`insert into network.evidence_holds (app_id, member_id, case_id, until) values (${app}, ${id}, ${s.caseId ?? ""}, ${until})
        on conflict (app_id, member_id, case_id) do update set until = greatest(network.evidence_holds.until, excluded.until)`;
    }
    const held = u.forget.size ? await this.evidenceHeld(tx) : new Set<string>();
    // The forget path (an under-age decline, leaving the app, deleting everything): keep only the id. Nothing that names the member stays,
    // except what an evidence hold keeps (their messages, feedback and events; the member row below is emptied either way).
    for (const id of u.forget) {
      // Declined under 13 while handling their own message (memberUnit): nothing of theirs is kept, evidence or not.
      const declined = this.net.isDeclined(id) && u.inbound?.member_id === id;
      await this.deleteMemberRows(tx, id, { keep: held.has(id) && !declined, heldAbout: [...held] });
      await tx`delete from network.capital_events where app_id = ${app} and (member_id = ${id} or position(${`"${id}"`} in event::text) > 0)`;
      await tx`delete from network.facets where app_id = ${app} and member_id = ${id}`;
      await tx`delete from network.intents where app_id = ${app} and member_id = ${id}`;
      await tx`delete from network.presence where app_id = ${app} and member_id = ${id}`;
      await tx`delete from network.edges where app_id = ${app} and (from_id = ${id} or to_id = ${id})`;
      await tx`delete from network.channel_identities where app_id = ${app} and member_id = ${id}`;
      await tx`update network.members set invited_by = null where app_id = ${app} and invited_by = ${id}`;
      await tx`update network.members set name = null, home_city = null, home_area = null, account_status = 'removed', opted_out = false, age = null, invited_by = null,
        community = null, occupation = null, bio = null, prefs = '{}'::jsonb, unanswered_proactive = 0, joined_at = null, person_id = null where app_id = ${app} and id = ${id}`;
    }
  }

  /** Members of this app with a live evidence hold. */
  private async evidenceHeld(tx: SQL): Promise<Set<string>> {
    const rows = await tx`select distinct member_id from network.evidence_holds where app_id = ${this.app.id} and until > ${new Date(this.clock.now())}`;
    return new Set((rows as any[]).map(r => r.member_id as string));
  }

  /**
   * The rows that hold what a member said and did here: messages, feedback and events. `keep`: the
   * member is under an evidence hold, so they stay (staff only). Feedback about a held member is kept
   * whoever wrote it: a reporter's feedback is never deleted while it is evidence.
   */
  private async deleteMemberRows(tx: SQL, id: string, o: { keep: boolean; heldAbout: string[] }) {
    const app = this.app.id;
    if (o.keep) return;
    await tx`delete from network.messages where app_id = ${app} and member_id = ${id}`;
    await tx`delete from network.feedback where app_id = ${app} and (from_id = ${id} or about_id = ${id}) and not (about_id = any(${tx.array(o.heldAbout, "TEXT")}))`;
    // Every event that names them, by the same keys the writer reads (membersOf): actor, object and the payload.
    await tx`delete from network.events where app_id = ${app} and (actor_id = ${id} or object_id = ${id}
      or payload->>'memberId' = ${id} or payload->>'from' = ${id} or payload->>'newMemberId' = ${id} or payload->>'out' = ${id} or payload->>'in' = ${id}
      or coalesce(payload->'participants', '[]'::jsonb) @> to_jsonb(${id}::text) or coalesce(payload->'members', '[]'::jsonb) @> to_jsonb(${id}::text)
      or jsonb_exists(coalesce(payload->'attendance', '{}'::jsonb), ${id}))`;
  }

  /**
   * Retention: evidence holds past their time. A member who left (account removed) and has no live
   * hold left loses the messages, feedback and events the holds kept; then the expired rows go.
   */
  async purgeEvidence(): Promise<number> {
    const now = new Date(this.clock.now());
    return this.scoped(async tx => {
      const expired = await tx`select distinct e.member_id from network.evidence_holds e join network.members m on m.app_id = e.app_id and m.id = e.member_id
        where e.app_id = ${this.app.id} and e.until <= ${now} and m.account_status = 'removed'
          and not exists (select 1 from network.evidence_holds x where x.app_id = e.app_id and x.member_id = e.member_id and x.until > ${now})`;
      const held = [...await this.evidenceHeld(tx)];
      for (const r of expired as any[]) await this.deleteMemberRows(tx, r.member_id, { keep: false, heldAbout: held });
      const gone = await tx`delete from network.evidence_holds where app_id = ${this.app.id} and until <= ${now} returning member_id`;
      return (gone as any[]).length;
    });
  }

  /** Hand the committed safety signals to the service (after delivery; one network unit is never inside another). */
  private async flushSafety() {
    const s = this.committedSafety.splice(0);
    if (!s.length || !this.host.safety) return;
    await this.host.safety(this, s).catch(e => this.host.log(`[safety] person-level safety failed (${this.id}): ${(e as Error).message}`));
  }

  /**
   * What the Network learned from members' texts (interests, skills, wants, the app's tags) as
   * network.facets rows with ":chat:" in the id (learned.ts), so the member's export and the console
   * see them. Only rows that changed are written; rows the state no longer has are deleted. App tags
   * stay agent_private. Members not in network.members (or forgotten in this unit) get nothing.
   */
  private async writeLearned(tx: SQL, state: NetworkState, u: Unit) {
    const app = this.app.id;
    const want = learnedFacetRows(state);
    const ids = [...new Set([...want.values()].map(r => r.member_id))];
    const members = new Set<string>();
    for (let i = 0; i < ids.length; i += 500) {
      for (const r of await tx`select id from network.members where app_id = ${app} and account_status <> 'removed' and id in ${tx(ids.slice(i, i + 500))}`) members.add(r.id);
    }
    const have = new Map<string, any>();
    for (const r of await tx`select id, member_id, kind, value, tags, privacy_scope, provenance, valid_to from network.facets where app_id = ${app} and position(${CHAT_FACET} in id) > 0`) have.set(r.id, r);
    const write: LearnedFacetRow[] = [];
    for (const r of want.values()) {
      if (!members.has(r.member_id) || u.forget.has(r.member_id)) continue;
      const h = have.get(r.id);
      if (!h || !sameRow(r, { ...h, tags: h.tags ?? [], valid_to: h.valid_to ? new Date(h.valid_to).getTime() : null })) write.push(r);
    }
    const drop = [...have.keys()].filter(id => !want.has(id) || !members.has(want.get(id)!.member_id));
    for (let i = 0; i < drop.length; i += 500) await tx`delete from network.facets where app_id = ${app} and id in ${tx(drop.slice(i, i + 500))}`;
    for (const r of write) {
      await tx`insert into network.facets (app_id, id, member_id, kind, value, tags, privacy_scope, provenance, source, confidence, status, valid_from, valid_to)
        values (${app}, ${r.id}, ${r.member_id}, ${r.kind}, ${r.value}, ${tx.array(r.tags, "TEXT")}, ${r.privacy_scope}, ${r.provenance}, ${r.source}, ${r.confidence}, 'confirmed',
          ${new Date(r.valid_from)}, ${r.valid_to === null ? null : new Date(r.valid_to)})
        on conflict (id) do update set kind = excluded.kind, value = excluded.value, tags = excluded.tags, privacy_scope = excluded.privacy_scope,
          provenance = excluded.provenance, source = excluded.source, confidence = excluded.confidence, valid_from = excluded.valid_from, valid_to = excluded.valid_to`;
    }
  }

  /**
   * Deliver what was committed: the platform consent ledger, the member's own opt-out and the person
   * cap first, then the adapter; store each new status. An adapter error keeps the rows waiting: the
   * next tick hands them over again (the provider key stops a second send).
   */
  async deliver() {
    const batch = this.committed.splice(0);
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
        const no = new Set(notSent);
        const sent = go.filter(b => !no.has(b.id));
        if (sent.length) await this.host.delivered(this, sent).catch(e => this.host.log(`[deliver] delivered hook failed (${this.id}): ${(e as Error).message}`));
      }
    } catch (e) {
      this.host.log(`[deliver] ${go.length} send(s) wait for the next tick (${this.id}): ${(e as Error).message}`);
      this.retry.push(...go);
    }
  }
  /** Sends the adapter could not take (an error after commit): handed over again on the next tick. */
  private retry: Outbound[] = [];

  async storeStatuses(ds: Delivery[], only?: Set<string>) {
    const rows = ds.filter(d => d.status !== this.adapter.storedStatus && (!only || only.has(d.id)));
    if (!rows.length) return;
    await this.scoped(async tx => {
      for (const d of rows) await tx`update network.messages set status = ${d.status} where app_id = ${this.app.id} and id = ${d.id} and direction = 'outbound'`;
    });
  }

  /** One tick under the lock (skipped when another holder has it), then delivery. */
  async tick(): Promise<boolean> {
    const now = this.clock.now();
    const ran = await runTick(this.net, this.store, now);
    this.lastTick = { at: now, ran };
    if (this.retry.length) this.committed.unshift(...this.retry.splice(0));
    await this.deliver();
    await this.storeStatuses(await this.adapter.flush());
    await this.flushSafety();
    return ran;
  }

  /** A unit that waits for the lock (an inbound message or a staff action), then delivery. */
  async unitOfWork<T>(fn: (n: ConsentNetwork) => Promise<T> | T): Promise<T> {
    const out = await runStored(this.net, this.store, fn);
    await this.deliver();
    await this.flushSafety();
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

