// Where the ConsentNetwork keeps its state between processes (docs/network.md 11, admin-console gap 1).
//  - MemoryStore: tests and the simulator.
//  - PgStore: Postgres (PostgreSQL). One JSON document per network in network.network_state, plus
//    normalized rows the console reads (opportunities, participations, review_items, requests).
//    Every unit of work (a tick, an inbound message, a staff action) runs under one Postgres advisory
//    lock and loads the newest state first, so two processes never overwrite each other's saves.
// The SQL is in packages/network/db/network-state.sql.
import { fileAt } from "../../core/src/runtime/files.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { engineAttemptAllowed, tickMayEnter, tickMayStartBesideEngine, tickMayTryLock } from "../../core/src/generated/runtimeUnit.ts";
import { captureEngine, EngineRunDue, inlineEngine, preparedEngine, type EngineStep } from "./tick-engine.ts";
import { runStoredNetworkUnit } from "../../core/src/vibe/runtimeUnitShell.js";
import { reviewStateOf, type ConsentNetwork, type NetworkState } from "./network.ts";
import type { RelayRecord } from "../../engine/src/relay.ts";
import { emptyRelayState, RELAY_LOG_MAX, type RelayState } from "./relay.ts";

export interface NetworkStore {
  load(): Promise<NetworkState | undefined>;
  save(state: NetworkState): Promise<void>;
  /** Run `fn` while holding the Network lock. Undefined (and `fn` does not run) when another holder has it or waits for it. */
  withTickLock<T>(fn: () => Promise<T>): Promise<T | undefined>;
  /** Run `fn` while holding the same lock. Waits for the lock: inbound messages and staff actions are never skipped. */
  withLock<T>(fn: () => Promise<T>): Promise<T>;
}

/** One holder at a time inside this process. `busy` while anyone holds the lock or waits for it. */
class Queue {
  private tail: Promise<void> = Promise.resolve();
  private n = 0;
  get busy() { return this.n > 0; }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    this.n++;
    const prev = this.tail;
    let done!: () => void;
    this.tail = new Promise<void>(r => (done = r));
    try { await prev; return await fn(); } finally { this.n--; done(); }
  }
}

/** In memory, for tests and the simulator. It keeps a JSON copy, exactly as a database would. */
export class MemoryStore implements NetworkStore {
  private json?: string;
  private readonly queue = new Queue();
  async load() { return this.json === undefined ? undefined : (JSON.parse(this.json) as NetworkState); }
  async save(state: NetworkState) { this.json = JSON.stringify(state); }
  async withTickLock<T>(fn: () => Promise<T>): Promise<T | undefined> { return tickMayTryLock(this.queue.busy) ? this.queue.run(fn) : undefined; }
  withLock<T>(fn: () => Promise<T>): Promise<T> { return this.queue.run(fn); }
}

function storeOf(net: ConsentNetwork, store: NetworkStore | undefined): NetworkStore {
  const s = store ?? net.store;
  if (!s) throw new Error("runTick and runStored need a NetworkStore (pass one, or set the ConsentNetwork store option)");
  return s;
}

/** Under the lock: load the newest stored state, run `fn`, save. Another process's saves are never overwritten. */
function stored<T>(net: ConsentNetwork, s: NetworkStore, fn: (net: ConsentNetwork) => Promise<T> | T): Promise<T> {
  return runStoredNetworkUnit({
    load: () => s.load(),
    restore: state => net.importState(state),
    run: () => fn(net),
    save: () => s.save(net.exportState()),
  });
}

const computing = new WeakSet<NetworkStore>();

type TickUnitScope = <T>(unit: () => Promise<T>) => Promise<T>;

export async function runTick(net: ConsentNetwork, store: NetworkStore | undefined, now: number, scope: TickUnitScope = unit => unit()): Promise<boolean> {
  const s = storeOf(net, store);
  if (!tickMayStartBesideEngine(computing.has(s))) return false;
  const unit = (engine: EngineStep) => () => stored(net, s, async n => { await n.tick(now, engine); return true as const; });
  try {
    let engine: EngineStep = captureEngine;
    for (let attempt = 0; ; attempt++) {
      try {
        const step = unit(engine);
        return (await scope<true | undefined>(() => attempt === 0 ? s.withTickLock(step) : s.withLock(step))) === true;
      } catch (e) {
        if (!(e instanceof EngineRunDue)) throw e;
        if (!engineAttemptAllowed(attempt)) return false;
        computing.add(s);
        engine = preparedEngine({ request: e.request, result: await inlineEngine(e.request) });
      }
    }
  } finally {
    computing.delete(s);
  }
}

/**
 * Any other unit of work, stored: an inbound message (`n => n.onInbound(msg)`), a review decision or a
 * staff action. It waits for the lock (never skipped), loads the stored state, runs `fn` and saves.
 */
export function runStored<T>(net: ConsentNetwork, store: NetworkStore | undefined, fn: (net: ConsentNetwork) => Promise<T> | T): Promise<T> {
  const s = storeOf(net, store);
  return s.withLock(() => stored(net, s, fn));
}

type Row = Record<string, unknown>;
const REVIEW_REASONS = new Set(["weak_reason", "privacy_risk", "capacity_concern", "wrong_timing", "safety", "tone", "duplicate", "other"]);
const date = (t: number | undefined | null) => (typeof t === "number" && Number.isFinite(t) ? new Date(t) : null);

/** Opportunity states in the console's words (core OpportunityState, plus SKIPPED for never sent). */
function oppState(o: NetworkState["opps"][number]): string {
  switch (o.stage) {
    case "review": return "IN_REVIEW";
    case "probing": return "PROPOSED";
    case "scheduled": return "SCHEDULED";
    case "done": return "COMPLETED";
    default: return o.closedFrom === "scheduled" ? "CANCELLED" : "SKIPPED";
  }
}
const SOURCE: Record<string, string> = { engine: "engine", request: "member", plans: "member", second_encounter: "network", newcomer_welcome: "network", player: "player" };

/** A participant's status in the console's words (observatory ParticipantStatus). */
function partStatus(o: NetworkState["opps"][number], s: string | undefined, id: string): string {
  switch (s) {
    case "probing": return "checking";
    case "available": case "unavailable": case "dropped": return s;
    case "yes": {
      const mark = o.stage === "done" && o.finalized ? o.settledAttendance?.[id] : undefined;
      if (mark === "Attended") return "attended";
      if (mark === "Absent") return "no_show";
      return o.stage === "scheduled" ? (o.bookedTold?.includes(id) ? "confirmed" : "pending") : "accepted";
    }
    case "no": return "declined";
    default: return "pending"; // queued, or not contacted yet
  }
}

/** The console's rows for a state: opportunities, participations, review items and requests. Never a member's words. */
export function consoleRows(state: NetworkState, savedAt = state.savedAt, city = "nyc"): { opportunities: Row[]; participations: Row[]; review_items: Row[]; requests: Row[] } {
  const opportunities: Row[] = [], participations: Row[] = [], review_items: Row[] = [];
  for (const o of state.opps) {
    const status = new Map(o.status);
    for (const id of o.participants) participations.push({ opportunity_id: o.id, member_id: id, role: "participant", status: partStatus(o, status.get(id), id), booked_told: o.bookedTold?.includes(id) ?? false, enjoyment: null, invited_at: null, responded_at: null });
    for (const id of o.alternates) if (!o.participants.includes(id)) participations.push({ opportunity_id: o.id, member_id: id, role: "alternate", status: "alternate", booked_told: false, enjoyment: null, invited_at: null, responded_at: null });
    opportunities.push({
      id: o.id, kind: o.kind, state: oppState(o), source: SOURCE[o.origin] ?? "network", generator: o.generator, category: o.category, city,
      objective: o.objective, score: o.score, components: o.components, explanations: o.explanations, exploration: o.exploration,
      window_start: null, window_end: null, meeting_at: date(o.meetingAt), reason: o.closedReason ?? null, run_id: o.runId ?? null,
      created_at: date(o.createdAt), updated_at: date(savedAt),
    });
    const r = o.review;
    if (r) review_items.push({
      opportunity_id: o.id, queued_at: date(r.queuedAt), deadline: date(r.deadline), decision: r.decision ?? null,
      reason: r.reason && REVIEW_REASONS.has(r.reason) ? r.reason : null, note: r.note ?? null, reviewer: r.reviewer ?? null, decided_at: date(r.decidedAt),
      origin: o.origin, seconds_spent: r.secondsSpent ?? null, edits: r.edits ?? null, rerolls: r.rerolls?.length ?? 0, invalidated: r.invalidated ?? null,
      approver: r.approver ?? null, exception_reason: reviewStateOf(o).phase === "HeldForStaff" ? r.exception?.reason ?? null : null, judge_verdict: r.judged?.verdict ?? null,
    });
  }
  const requests: Row[] = state.requests.map(q => ({
    id: q.id, member_id: q.memberId, kind: q.kind, category: q.category, desire_id: q.desireId ?? null, outcome: q.outcome ?? null, tries: q.tries ?? 0,
    opportunity_id: q.oppId ?? null, created_at: date(q.at), fulfilled_at: date(q.fulfilledAt), updated_at: date(savedAt),
  }));
  return { opportunities, participations, review_items, requests };
}

// ------------------------------------------------------------------ relay rows (migration 0026)
const RELAY_ROW_WINDOW_MS = 2 * 86_400_000;
/** A Postgres text[] literal for bulk inserts. */
const textArray = (xs: readonly string[]) => `{${xs.map(x => `"${String(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;

export function relayRows(state: NetworkState, app: string, networkId?: string): { threads: Row[]; records: Row[] } {
  const r = state.relay;
  if (!r) return { threads: [], records: [] };
  const recent = (state.savedAt ?? 0) - RELAY_ROW_WINDOW_MS;
  return {
    threads: r.threads.map(t => ({ app_id: app, ...(networkId ? { network_id: networkId } : {}), id: t.id, opportunity_id: t.id, members: textArray(t.members), opened_at: new Date(t.openedAt), messages: t.messages.length })),
    records: r.log.filter(x => x.at >= recent).map(x => ({
      app_id: app, ...(networkId ? { network_id: networkId } : {}), item_id: x.itemId, opportunity_id: x.opportunityId, kind: x.kind, from_member: x.from, to_member: x.to, at: new Date(x.at),
      decision: x.decision, reasons: textArray(x.reasons), photo_count: x.photoCount, contact_shared: x.contactShared, age_signal: x.ageSignal, policy: x.policy,
    })),
  };
}

/** Migration 0026 (the tables) and 0031 (network_id): which of them this database has. */
async function relaySchema(tx: SQL): Promise<{ tables: boolean; network: boolean }> {
  const [{ ok, net }] = await tx`select to_regclass('network.relay_records') is not null as ok,
    exists (select 1 from information_schema.columns where table_schema = 'network' and table_name = 'relay_records' and column_name = 'network_id') as net`;
  return { tables: !!ok, network: !!net };
}

/**
 * Write the relay rows (inside the save transaction; app.app_id is set). Skipped before migration 0026.
 * `networkId` ('<app>:<city>', migration 0031): a row of another network of the same app is never overwritten.
 */
export async function writeRelayRows(
  tx: SQL,
  state: NetworkState,
  app: string,
  networkId?: string,
  cachedSchema?: { tables: boolean; network: boolean },
): Promise<void> {
  const schema = cachedSchema ?? await relaySchema(tx);
  if (!schema.tables) return;
  const net = schema.network ? networkId ?? `${app}:nyc` : undefined;
  const { threads, records } = relayRows(state, app, net);
  for (let i = 0; i < threads.length; i += 500) await tx`insert into network.relay_threads ${tx(threads.slice(i, i + 500))}
    on conflict (app_id, id) do update set members = excluded.members, messages = excluded.messages
    where ${net ?? null}::text is null or relay_threads.network_id = ${net ?? null}`;
  for (let i = 0; i < records.length; i += 500) await tx`insert into network.relay_records ${tx(records.slice(i, i + 500))}
    on conflict (app_id, item_id) do update set decision = excluded.decision, reasons = excluded.reasons, photo_count = excluded.photo_count,
      contact_shared = excluded.contact_shared
    where ${net ?? null}::text is null or relay_records.network_id = ${net ?? null}`;
}

export async function loadRelayRows(
  tx: SQL,
  state: NetworkState | undefined,
  app: string,
  networkId?: string,
  cachedSchema?: { tables: boolean; network: boolean },
): Promise<NetworkState | undefined> {
  if (!state || state.relay?.log.length) return state;
  const schema = cachedSchema ?? await relaySchema(tx);
  if (!schema.tables) return state;
  const net = schema.network ? networkId ?? `${app}:nyc` : undefined;
  const rows = await tx`select * from network.relay_records where app_id = ${app} and (${net ?? null}::text is null or network_id = ${net ?? null})
    order by at desc, item_id limit ${RELAY_LOG_MAX}` as Row[];
  if (!rows.length) return state;
  const relay: RelayState = state.relay ?? emptyRelayState();
  const ms = (v: unknown) => new Date(v as string).getTime();
  relay.log = rows.reverse().map(r => ({
    itemId: r.item_id as string, opportunityId: r.opportunity_id as string, app, kind: r.kind as RelayRecord["kind"], from: r.from_member as string, to: r.to_member as string,
    at: ms(r.at), decision: r.decision as RelayRecord["decision"], reasons: (r.reasons as string[]) ?? [], photoCount: Number(r.photo_count ?? 0),
    contactShared: r.contact_shared === true, ageSignal: r.age_signal === true, policy: r.policy as string,
  }));
  return { ...state, relay };
}

/** '<app>:<city>' -> the app and the city. A legacy id with no ':' ('nyc') is The Network's (ntwrk). */
export function splitNetworkId(id: string): { app: string; city: string } {
  const i = id.indexOf(":");
  return i < 0 ? { app: "ntwrk", city: id } : { app: id.slice(0, i), city: id.slice(i + 1) };
}

/**
 * Postgres. Run packages/network/db/network-state.sql first (PgStore.migrate() does). The id is the
 * network's '<app>:<city>' (platform.networks.id; default 'ntwrk:nyc'): the lock key and the
 * network_state row. Every save sets `app.app_id` for its transaction (migration 0004: the service
 * role writes only that app's rows). Rows the state no
 * longer holds (an under-13 decline deletes everything that names the member, a re-roll changes the
 * participants) are deleted on save.
 */
export class PgStore implements NetworkStore {
  readonly sql: SQL;
  private readonly owned: boolean;
  readonly app: string;
  readonly city: string;
  seen?: string;
  private relaySchemaCache?: { tables: boolean; network: boolean };
  private hasMembersTableCache?: boolean;
  constructor(db: string | SQL, readonly id = "ntwrk:nyc") {
    ({ app: this.app, city: this.city } = splitNetworkId(id));
    this.owned = typeof db === "string";
    this.sql = typeof db === "string" ? new SQL({ url: db, max: 4 }) : db;
  }

  private async getRelaySchema(tx: SQL): Promise<{ tables: boolean; network: boolean }> {
    if (!this.relaySchemaCache) this.relaySchemaCache = await relaySchema(tx);
    return this.relaySchemaCache;
  }

  private async hasMembersTable(tx: SQL): Promise<boolean> {
    if (this.hasMembersTableCache === undefined) {
      const [{ members }] = await tx`select to_regclass('network.members') is not null as members`;
      this.hasMembersTableCache = !!members;
    }
    return this.hasMembersTableCache;
  }

  /** Apply packages/network/db/network-state.sql (idempotent). */
  async migrate() {
    // Read the URL directly to support checkout paths
    // with non-ASCII characters.
    await this.sql.unsafe(await fileAt(new URL("../db/network-state.sql", import.meta.url)).text());
    this.relaySchemaCache = undefined;
    this.hasMembersTableCache = undefined;
  }

  async load(): Promise<NetworkState | undefined> {
    return this.sql.begin(async tx => {
      await tx`select set_config('app.app_id', ${this.app}, true)`;
      const rows = await tx`select state, xmin::text as v from network.network_state where id = ${this.id}`;
      const s = rows[0]?.state;
      this.seen = rows[0]?.v;
      const parsed = s === undefined ? undefined : ((typeof s === "string" ? JSON.parse(s) : s) as NetworkState);
      const schema = parsed && !parsed.relay?.log.length ? await this.getRelaySchema(tx) : undefined;
      return loadRelayRows(tx, parsed, this.app, this.id, schema);
    }) as Promise<NetworkState | undefined>;
  }

  /**
   * Save the state and its console rows in one transaction. `also` runs inside the same transaction
   * (the production service writes the messages, events and edges of the unit of work there), so the
   * state and what it sent are committed together or not at all.
   */
  async save(state: NetworkState, also?: (tx: SQL) => Promise<void>): Promise<void> {
    const rows = consoleRows(state, state.savedAt, this.city);
    await this.inTx(async tx => {
      await tx`select set_config('app.app_id', ${this.app}, true),
        set_config('app.age_as_of', ${new Date(state.savedAt).toISOString()}, true)`;
      // What the last save held, so rows the state dropped are deleted (and only rows this store wrote).
      const prev = await tx`select coalesce(jsonb_path_query_array(state, '$.opps[*].id'), '[]'::jsonb) as opps, coalesce(jsonb_path_query_array(state, '$.requests[*].id'), '[]'::jsonb) as reqs
        from network.network_state where id = ${this.id}`;
      const ids = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : (v ?? [])) as string[];
      const oppIds = new Set(state.opps.map(o => o.id)), reqIds = new Set(state.requests.map(r => r.id));
      const goneOpps = ids(prev[0]?.opps).filter(x => !oppIds.has(x));
      const goneReqs = ids(prev[0]?.reqs).filter(x => !reqIds.has(x));
      if (goneOpps.length) await tx`delete from network.opportunities where id in ${tx(goneOpps)}`;
      if (goneReqs.length) await tx`delete from network.requests where id in ${tx(goneReqs)}`;
      // Participations are rewritten for every opportunity the state holds: a re-roll or a decline
      // (forget) changes who is in it. Gone opportunities lose theirs by the cascade.
      const stateOppIds = [...oppIds];
      for (let i = 0; i < stateOppIds.length; i += 500) await tx`delete from network.participations where opportunity_id in ${tx(stateOppIds.slice(i, i + 500))}`;
      let parts = rows.participations;
      // With the console schema, a participation needs its network.members row (foreign key): skip any member not there.
      const members = await this.hasMembersTable(tx);
      if (members && parts.length) {
        const ids = [...new Set(parts.map(p => p.member_id as string))];
        const known = new Set<string>();
        for (let i = 0; i < ids.length; i += 500) for (const r of await tx`select id from network.members where id in ${tx(ids.slice(i, i + 500))}`) known.add(r.id);
        parts = parts.filter(p => known.has(p.member_id as string));
      }
      const [saved] = await tx`insert into network.network_state (id, version, state, saved_at) values (${this.id}, ${state.version}, ${state}::jsonb, now())
        on conflict (id) do update set version = excluded.version, state = excluded.state, saved_at = excluded.saved_at returning xmin::text as v`;
      this.seen = saved.v;
      for (let i = 0; i < rows.opportunities.length; i += 500) await tx`insert into network.opportunities ${tx(rows.opportunities.slice(i, i + 500))}
        on conflict (id) do update set state = excluded.state, objective = excluded.objective, explanations = excluded.explanations, meeting_at = excluded.meeting_at,
          reason = excluded.reason,
          -- The time the row last changed, not the time of the last save (every save writes every row).
          updated_at = case when (network.opportunities.state, network.opportunities.objective, network.opportunities.explanations, network.opportunities.meeting_at, network.opportunities.reason)
            is distinct from (excluded.state, excluded.objective, excluded.explanations, excluded.meeting_at, excluded.reason) then excluded.updated_at else network.opportunities.updated_at end`;
      for (let i = 0; i < parts.length; i += 500) await tx`insert into network.participations ${tx(parts.slice(i, i + 500))}`;
      for (let i = 0; i < rows.review_items.length; i += 500) await tx`insert into network.review_items ${tx(rows.review_items.slice(i, i + 500))}
        on conflict (opportunity_id) do update set deadline = excluded.deadline, decision = excluded.decision, reason = excluded.reason, note = excluded.note,
          reviewer = excluded.reviewer, decided_at = excluded.decided_at, origin = excluded.origin, seconds_spent = excluded.seconds_spent, edits = excluded.edits,
          rerolls = excluded.rerolls, invalidated = excluded.invalidated, approver = excluded.approver, exception_reason = excluded.exception_reason,
          judge_verdict = excluded.judge_verdict`;
      for (let i = 0; i < rows.requests.length; i += 500) await tx`insert into network.requests ${tx(rows.requests.slice(i, i + 500))}
        on conflict (id) do update set outcome = excluded.outcome, tries = excluded.tries, opportunity_id = excluded.opportunity_id,
          fulfilled_at = excluded.fulfilled_at, updated_at = excluded.updated_at`;
      await writeRelayRows(tx, state, this.app, this.id, await this.getRelaySchema(tx));
      if (also) await also(tx);
    });
  }

  private readonly queue = new Queue();
  private lockConn?: Awaited<ReturnType<SQL["reserve"]>>;

  private async inTx<T>(fn: (tx: SQL) => Promise<T>): Promise<T> {
    const conn = this.lockConn;
    if (!conn) return this.sql.begin(fn) as Promise<T>;
    await conn.unsafe("begin");
    try {
      const out = await fn(conn);
      await conn.unsafe("commit");
      return out;
    } catch (err) {
      await conn.unsafe("rollback").catch(() => {});
      throw err;
    }
  }

  withTickLock<T>(fn: () => Promise<T>): Promise<T | undefined> {
    return tickMayTryLock(this.queue.busy) ? this.queue.run(() => this.locked(false, fn)) : Promise.resolve(undefined);
  }

  withLock<T>(fn: () => Promise<T>): Promise<T> {
    return this.queue.run(async () => (await this.locked(true, fn)) as T);
  }

  /**
   * A session-level advisory lock on one reserved connection, released in finally. One caller per
   * process at a time (the queue), so waiters never use up the pool that load() needs. save() runs on
   * the lock's connection (the fence: a save after the lock was lost fails).
   */
  private async locked<T>(wait: boolean, fn: () => Promise<T>): Promise<T | undefined> {
    const key = `network-tick-${this.id}`;
    const conn = await this.sql.reserve();
    try {
      if (wait) await conn`select pg_advisory_lock(hashtext(${key}))`;
      else {
        const [row] = await conn`select pg_try_advisory_lock(hashtext(${key})) as ok`;
        if (!tickMayEnter(!!row?.ok)) return undefined;
      }
      this.lockConn = conn;
      try { return await fn(); } finally { this.lockConn = undefined; await conn`select pg_advisory_unlock(hashtext(${key}))`.catch(() => {}); }
    } finally {
      conn.release();
    }
  }

  async close() { if (this.owned) await this.sql.close(); }
}
