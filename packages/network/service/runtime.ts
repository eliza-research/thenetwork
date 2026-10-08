// One network ('<app>:<city>') inside the production service (service.ts holds one runtime per row
// of platform.networks). What a runtime does:
//  - Every unit of work (a tick, an inbound message, a staff action) runs under this network's own
//    PgStore advisory lock (key network-tick-<app>:<city>), loads the newest stored state and a fresh
//    snapshot of this app's rows, and saves after. A slow network never blocks another one.
//  - What a unit produced (messages, events, blocks, engine runs, opt-outs, a forget) is written in
//    the same transaction as the Network state, with `set local app.app_id` and an explicit app_id on
//    every row, then the channel adapter delivers it.
//  - Every query on a network table names this app. Nothing here reads another app's rows; the person
//    cap across apps (service.ts) is the one cross-app read, and it reads counts only.
import type { SQL } from "bun";
import type { City, Clock, MemberId, WorldSnapshot } from "@thenetwork/core";
import type { RunRecord } from "@thenetwork/judge";
import type { NetworkContext, SimMessage } from "@thenetwork/sim";
import { ConsentNetwork, type NetworkOptions, type NetworkState } from "../src/network.ts";
import { PgStore, runStored, runTick, type NetworkStore } from "../src/store.ts";
import type { AppInfo } from "../../platform/src/apps.ts";
import { loadSnapshot } from "./snapshot.ts";
import { DryRunAdapter, WAITING_STATUSES, type ChannelAdapter, type Delivery, type Outbound } from "./channel.ts";
import { normalizeAddress } from "../../../prototypes/messaging-blooio/src/phone.ts";
// The Observatory's event shape and run summaries, so the console reads what this writes.
import { eventOf, membersOf, type EventRow } from "../../observatory/src/events.ts";
import { summarizeRun } from "../../observatory/src/engineCapture.ts";

type Row = Record<string, unknown>;

/** What one unit of work produced. Written in the save transaction, then delivered. */
export interface Unit {
  inbound?: Row;
  sends: Outbound[];
  events: EventRow[];
  blocks: [MemberId, MemberId][];
  runs: Row[];
  optOut: Map<MemberId, boolean>;
  forget: Set<MemberId>;
}
const newUnit = (): Unit => ({ sends: [], events: [], blocks: [], runs: [], optOut: new Map(), forget: new Set() });

/** What the service gives each runtime: the shared connection and clock, and the checks that span apps. */
export interface RuntimeHost {
  sql: SQL;
  clock: Clock;
  instance: string;
  log: (line: string) => void;
  /** Proactive sends of this batch the person-level daily cap refuses (ids). Called before delivery. */
  capRefused(rt: NetworkRuntime, batch: Outbound[]): Promise<Set<string>>;
  /** Sends of this batch to a number the platform consent ledger has opted out of this app (ids). Called before delivery. */
  consentRefused?(rt: NetworkRuntime, batch: Outbound[]): Promise<Set<string>>;
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
  /** platform.networks.matching_enabled for this network. */
  matchingAllowed: boolean;
  private snap?: WorldSnapshot;
  private addrToMember = new Map<string, MemberId>();
  private memberToAddr = new Map<MemberId, string>();
  /** The unit being built. The service adds system sends (keyword confirmations) to it. */
  unit = newUnit();
  /** Sends committed with their state, waiting to be delivered (in commit order). */
  private committed: Outbound[] = [];
  /** Who the inbound message being handled came from: sends to them are direct replies. */
  replyingTo?: MemberId;
  private seq = 0;
  lastTick?: { at: number; ran: boolean };

  constructor(private readonly host: RuntimeHost, o: RuntimeOptions) {
    this.id = o.id; this.app = o.app; this.city = o.city; this.matchingAllowed = o.matchingAllowed;
    this.pg = new PgStore(host.sql, o.id);
    this.store = this.serviceStore();
    this.net = new ConsentNetwork({
      matchingEnabled: false, ...o.network, app: o.app, review: "human", store: this.store,
      onEngineRun: (log, proposals, at) => {
        const s = summarizeRun(log, proposals, { at, city: this.city as City, wallMs: Math.round(log.timingsMs.total ?? 0) });
        this.unit.runs.push({ id: this.app.id === "ntwrk" ? s.id : `${this.app.id}.${s.id}`, app_id: this.app.id, at: new Date(at), city: this.city, engine_version: s.engineVersion, proposals: s.proposals, wall_ms: s.wallMs, summary: s });
      },
    });
    this.net.init(this.context());
    this.adapter = typeof o.adapter === "function" ? o.adapter(this.net, this) : o.adapter ?? new DryRunAdapter(host.log);
  }

  private get sql() { return this.host.sql; }
  private get clock() { return this.host.clock; }

  /** Deliver what a restart left stored but not delivered (live adapters only; dry-run rows are final). */
  async start() {
    if (this.adapter.storedStatus === "dry_run") return;
    const rows = await this.sql`select id, member_id, body, type, opportunity_id, proactive, system, ts from network.messages
      where app_id = ${this.app.id} and direction = 'outbound' and status = any(${`{${WAITING_STATUSES.join(",")}}`}::text[]) order by ts`;
    if (!rows.length) return;
    await this.identities();
    this.committed.push(...(rows as any[]).map((r): Outbound => ({
      id: r.id, memberId: r.member_id, to: this.memberToAddr.get(r.member_id), body: r.body, kind: r.system ? "compliance" : r.proactive ? "proactive" : "transactional",
      type: r.type ?? undefined, oppId: r.opportunity_id ?? undefined, proactive: r.proactive, system: r.system, ts: new Date(r.ts).getTime(),
    })));
    await this.deliver();
  }

  // ------------------------------------------------------------------ units of work
  /** The store the Network uses: every load starts a unit (fresh snapshot); every save writes the unit in the same transaction. */
  private serviceStore(): NetworkStore {
    return {
      load: async () => {
        this.unit = newUnit();
        await this.refresh();
        const state = await this.pg.load();
        // The registry's switch wins: a network whose matching is not allowed never matches, whatever was stored.
        if (state && !this.matchingAllowed) state.matchingEnabled = false;
        return state;
      },
      save: async (state: NetworkState) => {
        const u = this.unit;
        await this.pg.save(state, tx => this.writeUnit(tx, u));
        this.committed.push(...u.sends);
        this.unit = newUnit();
      },
      withTickLock: fn => this.pg.withTickLock(fn),
      withLock: fn => this.pg.withLock(fn),
    };
  }

  /** The snapshot and the address book, read fresh for every unit (inside the lock). */
  private async refresh() {
    this.snap = await loadSnapshot(this.sql, this.clock.now(), { app: this.app.id, city: this.city });
    await this.identities();
  }

  /**
   * This app's joined members' addresses. An invited person (the invite gate has not let them in) or a
   * removed one is not a member here. A member the platform knows (members.person_id) gets the person's
   * verified phone (platform.phone_identities, the one place a phone lives): one phone can be a member
   * of several apps, and network.channel_identities allows one member per address. Members from before
   * the platform keep their channel_identities rows.
   */
  async identities() {
    const [legacy, platform] = await Promise.all([
      this.sql`select ci.member_id, ci.address from network.channel_identities ci
        join network.members m on m.id = ci.member_id and m.app_id = ${this.app.id}
        where ci.channel in ('imessage', 'sms') and m.account_status not in ('invited', 'removed') order by ci.is_primary desc`,
      // A number on hold (it may have a new owner) is nobody's address until staff decide.
      this.sql`select m.id as member_id, ph.e164 as address from network.members m join platform.phone_identities ph on ph.person_id = m.person_id
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
        const id = o?.idempotencyKey ?? `${memberId}:${t}:${++this.seq}`;
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

  /** Everything the unit produced, inside the save transaction. Rows that name a member not in this app's network.members are skipped. */
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
    for (let i = 0; i < out.length; i += 500) await tx`insert into network.messages ${tx(out.slice(i, i + 500))} on conflict (id) do nothing`;
    const events = u.events.filter(e => !membersOf(e).some(id => u.forget.has(id))).map(e => ({ ...e, app_id: app, at: new Date(e.at) }));
    for (let i = 0; i < events.length; i += 500) await tx`insert into network.events ${tx(events.slice(i, i + 500))}`;
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
    // The forget path (an under-age decline, leaving the app, deleting everything): keep only the id. Nothing that names the member stays.
    for (const id of u.forget) {
      await tx`delete from network.messages where app_id = ${app} and member_id = ${id}`;
      await tx`delete from network.feedback where app_id = ${app} and (from_id = ${id} or about_id = ${id})`;
      // Every event that names them, by the same keys the writer reads (membersOf): actor, object and the payload.
      await tx`delete from network.events where app_id = ${app} and (actor_id = ${id} or object_id = ${id}
        or payload->>'memberId' = ${id} or payload->>'from' = ${id} or payload->>'newMemberId' = ${id} or payload->>'out' = ${id} or payload->>'in' = ${id}
        or coalesce(payload->'participants', '[]'::jsonb) @> to_jsonb(${id}::text) or coalesce(payload->'members', '[]'::jsonb) @> to_jsonb(${id}::text)
        or jsonb_exists(coalesce(payload->'attendance', '{}'::jsonb), ${id}))`;
      await tx`delete from network.facets where app_id = ${app} and member_id = ${id}`;
      await tx`delete from network.intents where app_id = ${app} and member_id = ${id}`;
      await tx`delete from network.presence where app_id = ${app} and member_id = ${id}`;
      await tx`delete from network.edges where app_id = ${app} and (from_id = ${id} or to_id = ${id})`;
      await tx`delete from network.channel_identities where member_id = ${id}`;
      await tx`update network.members set invited_by = null where app_id = ${app} and invited_by = ${id}`;
      await tx`update network.members set name = null, home_city = null, home_area = null, account_status = 'removed', opted_out = false, age = null, invited_by = null,
        community = null, occupation = null, bio = null, prefs = '{}'::jsonb, unanswered_proactive = 0, joined_at = null, person_id = null where app_id = ${app} and id = ${id}`;
    }
  }

  /** Deliver what was committed (after the consent ledger and the person cap), then store each new status. */
  async deliver() {
    const batch = this.committed.splice(0);
    if (!batch.length) return;
    // The platform consent ledger is the source of truth for STOP at send time (not an adapter's memory).
    const stopped = (await this.host.consentRefused?.(this, batch)) ?? new Set<string>();
    const open = batch.filter(b => !stopped.has(b.id));
    const capped = await this.host.capRefused(this, open);
    const go = open.filter(b => !capped.has(b.id));
    await this.storeStatuses([...stopped].map(id => ({ id, status: "refused_opted_out" })));
    await this.storeStatuses([...capped].map(id => ({ id, status: "refused_person_cap" })));
    if (go.length) await this.storeStatuses(await this.adapter.deliver(go), new Set(go.map(b => b.id)));
  }

  async storeStatuses(ds: Delivery[], only?: Set<string>) {
    for (const d of ds) {
      if (d.status === this.adapter.storedStatus || (only && !only.has(d.id))) continue;
      await this.sql`update network.messages set status = ${d.status} where app_id = ${this.app.id} and id = ${d.id} and direction = 'outbound'`;
    }
  }

  /** One tick under the lock (skipped when another holder has it), then delivery. */
  async tick(): Promise<boolean> {
    const now = this.clock.now();
    const ran = await runTick(this.net, this.store, now);
    this.lastTick = { at: now, ran };
    await this.deliver();
    await this.storeStatuses(await this.adapter.flush());
    return ran;
  }

  /** A unit that waits for the lock (an inbound message or a staff action), then delivery. */
  async unitOfWork<T>(fn: (n: ConsentNetwork) => Promise<T> | T): Promise<T> {
    const out = await runStored(this.net, this.store, fn);
    await this.deliver();
    return out;
  }

  /** The review queue, oldest first, from the newest stored state. */
  reviewQueue() { return this.unitOfWork(n => n.reviewQueue()); }

  /** Health for the heartbeat alert (PRD 35.2): last tick, lock holder, backlog, refusals. Reads the stored state; changes nothing. */
  async health() {
    const key = `network-tick-${this.pg.id}`;
    const [holder] = await this.sql`select l.pid, a.application_name from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where l.locktype = 'advisory' and l.granted and l.objsubid = 1 and ((l.classid::bigint << 32) | l.objid::bigint) = hashtext(${key})::bigint limit 1`;
    const [saved] = await this.sql`select saved_at from network.network_state where id = ${this.pg.id}`;
    const state = await this.pg.load();
    const now = this.clock.now();
    const review = state?.opps.filter(o => o.stage === "review" && o.review) ?? [];
    const statuses = await this.sql`select status, count(*)::int as n from network.messages where app_id = ${this.app.id} and direction = 'outbound' group by status`;
    const byStatus = Object.fromEntries((statuses as any[]).map(r => [r.status, r.n]));
    const channel = Object.fromEntries(Object.entries(byStatus).filter(([s]) => /^(refused|suppressed|parked|blocked|failed|held)/.test(s)));
    return {
      ok: true, instance: this.host.instance, network: this.id, app: this.app.id, city: this.city, channel: this.adapter.name, reviewMode: "human" as const,
      matchingAllowed: this.matchingAllowed,
      matchingEnabled: this.matchingAllowed && (state?.matchingEnabled ?? this.net.matchingEnabled()),
      lastTick: { thisInstance: this.lastTick ?? null, stored: state?.lastTick || null, savedAt: saved ? new Date(saved.saved_at).getTime() : null },
      lockHolder: holder ? { pid: holder.pid, application: holder.application_name } : null,
      backlog: {
        review: review.length, reviewOverdue: review.filter(o => now >= o.review!.deadline).length, deferred: state?.deferred.length ?? 0,
        outboundWaiting: WAITING_STATUSES.reduce((n, st) => n + (byStatus[st] ?? 0), 0),
      },
      refusals: { sendRefused: state?.counters.sendRefused ?? 0, guardBlocked: state?.counters.guardBlocked ?? 0, channel },
    };
  }
}
