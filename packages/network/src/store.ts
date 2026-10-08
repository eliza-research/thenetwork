// Where the ConsentNetwork keeps its state between processes (docs/network.md 11, admin-console gap 1).
//  - MemoryStore: tests and the simulator.
//  - PgStore: Postgres (Bun SQL). One JSON document per network in network.network_state, plus
//    normalized rows the console reads (opportunities, participations, review_items, requests).
//    Every unit of work (a tick, an inbound message, a staff action) runs under one Postgres advisory
//    lock and loads the newest state first, so two processes never overwrite each other's saves.
// The SQL is in packages/network/db/network-state.sql.
import { SQL } from "bun";
import type { ConsentNetwork, NetworkState } from "./network.ts";

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
  async withTickLock<T>(fn: () => Promise<T>): Promise<T | undefined> { return this.queue.busy ? undefined : this.queue.run(fn); }
  withLock<T>(fn: () => Promise<T>): Promise<T> { return this.queue.run(fn); }
}

function storeOf(net: ConsentNetwork, store: NetworkStore | undefined): NetworkStore {
  const s = store ?? net.store;
  if (!s) throw new Error("runTick and runStored need a NetworkStore (pass one, or set the ConsentNetwork store option)");
  return s;
}

/** Under the lock: load the newest stored state, run `fn`, save. Another process's saves are never overwritten. */
async function stored<T>(net: ConsentNetwork, s: NetworkStore, fn: (net: ConsentNetwork) => Promise<T> | T): Promise<T> {
  const state = await s.load();
  if (state) net.importState(state);
  const out = await fn(net);
  await s.save(net.exportState());
  return out;
}

/**
 * One tick, stored: under the lock, load the stored state, tick, then save. Returns false when another
 * process holds the lock (nothing ran). The state is loaded on every call, so this Network never
 * ticks from an old copy.
 */
export async function runTick(net: ConsentNetwork, store: NetworkStore | undefined, now: number): Promise<boolean> {
  const s = storeOf(net, store);
  const done = await s.withTickLock(() => stored(net, s, async n => { await n.tick(now); return true; }));
  return done === true;
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
    // A booked plan is confirmed for a member once it reached them (silence = in); before that they are not told yet.
    case "yes": return o.stage === "done" ? "attended" : o.stage === "scheduled" ? (o.bookedTold?.includes(id) ? "confirmed" : "pending") : "accepted";
    case "no": return "declined";
    default: return "pending"; // queued, or not contacted yet
  }
}

/** The console's rows for a state: opportunities, participations, review items and requests. Never a member's words. */
export function consoleRows(state: NetworkState, savedAt = state.savedAt, city = "nyc"): { opportunities: Row[]; participations: Row[]; review_items: Row[]; requests: Row[] } {
  const opportunities: Row[] = [], participations: Row[] = [], review_items: Row[] = [];
  for (const o of state.opps) {
    const status = new Map(o.status);
    for (const id of o.participants) participations.push({ opportunity_id: o.id, member_id: id, role: "participant", status: partStatus(o, status.get(id), id), enjoyment: null, invited_at: null, responded_at: null });
    for (const id of o.alternates) if (!o.participants.includes(id)) participations.push({ opportunity_id: o.id, member_id: id, role: "alternate", status: "alternate", enjoyment: null, invited_at: null, responded_at: null });
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
    });
  }
  const requests: Row[] = state.requests.map(q => ({
    id: q.id, member_id: q.memberId, kind: q.kind, category: q.category, desire_id: q.desireId ?? null, outcome: q.outcome ?? null, tries: q.tries ?? 0,
    opportunity_id: q.oppId ?? null, created_at: date(q.at), fulfilled_at: date(q.fulfilledAt), updated_at: date(savedAt),
  }));
  return { opportunities, participations, review_items, requests };
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
  constructor(db: string | SQL, readonly id = "ntwrk:nyc") {
    ({ app: this.app, city: this.city } = splitNetworkId(id));
    this.owned = typeof db === "string";
    this.sql = typeof db === "string" ? new SQL({ url: db, max: 4 }) : db;
  }

  /** Apply packages/network/db/network-state.sql (idempotent). */
  async migrate() {
    await this.sql.unsafe(await Bun.file(new URL("../db/network-state.sql", import.meta.url).pathname).text());
  }

  async load(): Promise<NetworkState | undefined> {
    const rows = await this.sql`select state from network.network_state where id = ${this.id}`;
    const s = rows[0]?.state;
    return s === undefined ? undefined : ((typeof s === "string" ? JSON.parse(s) : s) as NetworkState);
  }

  /**
   * Save the state and its console rows in one transaction. `also` runs inside the same transaction
   * (the production service writes the messages, events and edges of the unit of work there), so the
   * state and what it sent are committed together or not at all.
   */
  async save(state: NetworkState, also?: (tx: SQL) => Promise<void>): Promise<void> {
    const rows = consoleRows(state, state.savedAt, this.city);
    await this.sql.begin(async tx => {
      await tx`select set_config('app.app_id', ${this.app}, true)`;
      // What the last save held, so rows the state dropped are deleted (and only rows this store wrote).
      const prev = await tx`select coalesce(jsonb_path_query_array(state, '$.opps[*].id'), '[]'::jsonb) as opps, coalesce(jsonb_path_query_array(state, '$.requests[*].id'), '[]'::jsonb) as reqs
        from network.network_state where id = ${this.id}`;
      const ids = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : (v ?? [])) as string[];
      const goneOpps = ids(prev[0]?.opps).filter(x => !state.opps.some(o => o.id === x));
      const goneReqs = ids(prev[0]?.reqs).filter(x => !state.requests.some(r => r.id === x));
      if (goneOpps.length) await tx`delete from network.opportunities where id in ${tx(goneOpps)}`;
      if (goneReqs.length) await tx`delete from network.requests where id in ${tx(goneReqs)}`;
      // Participations are rewritten for every opportunity the state holds: a re-roll or a decline
      // (forget) changes who is in it. Gone opportunities lose theirs by the cascade.
      const oppIds = state.opps.map(o => o.id);
      for (let i = 0; i < oppIds.length; i += 500) await tx`delete from network.participations where opportunity_id in ${tx(oppIds.slice(i, i + 500))}`;
      let parts = rows.participations;
      // With the console schema, a participation needs its network.members row (foreign key): skip any member not there.
      const [{ members }] = await tx`select to_regclass('network.members') is not null as members`;
      if (members && parts.length) {
        const ids = [...new Set(parts.map(p => p.member_id as string))];
        const known = new Set<string>();
        for (let i = 0; i < ids.length; i += 500) for (const r of await tx`select id from network.members where id in ${tx(ids.slice(i, i + 500))}`) known.add(r.id);
        parts = parts.filter(p => known.has(p.member_id as string));
      }
      await tx`insert into network.network_state (id, version, state, saved_at) values (${this.id}, ${state.version}, ${state}::jsonb, now())
        on conflict (id) do update set version = excluded.version, state = excluded.state, saved_at = excluded.saved_at`;
      for (let i = 0; i < rows.opportunities.length; i += 500) await tx`insert into network.opportunities ${tx(rows.opportunities.slice(i, i + 500))}
        on conflict (id) do update set state = excluded.state, objective = excluded.objective, explanations = excluded.explanations, meeting_at = excluded.meeting_at,
          reason = excluded.reason, updated_at = excluded.updated_at`;
      for (let i = 0; i < parts.length; i += 500) await tx`insert into network.participations ${tx(parts.slice(i, i + 500))}`;
      for (let i = 0; i < rows.review_items.length; i += 500) await tx`insert into network.review_items ${tx(rows.review_items.slice(i, i + 500))}
        on conflict (opportunity_id) do update set deadline = excluded.deadline, decision = excluded.decision, reason = excluded.reason, note = excluded.note,
          reviewer = excluded.reviewer, decided_at = excluded.decided_at, origin = excluded.origin, seconds_spent = excluded.seconds_spent, edits = excluded.edits,
          rerolls = excluded.rerolls, invalidated = excluded.invalidated`;
      for (let i = 0; i < rows.requests.length; i += 500) await tx`insert into network.requests ${tx(rows.requests.slice(i, i + 500))}
        on conflict (id) do update set outcome = excluded.outcome, tries = excluded.tries, opportunity_id = excluded.opportunity_id,
          fulfilled_at = excluded.fulfilled_at, updated_at = excluded.updated_at`;
      if (also) await also(tx);
    });
  }

  private readonly queue = new Queue();

  withTickLock<T>(fn: () => Promise<T>): Promise<T | undefined> {
    return this.queue.busy ? Promise.resolve(undefined) : this.queue.run(() => this.locked(false, fn));
  }

  withLock<T>(fn: () => Promise<T>): Promise<T> {
    return this.queue.run(async () => (await this.locked(true, fn)) as T);
  }

  /**
   * A session-level advisory lock on one reserved connection, released in finally. One caller per
   * process at a time (the queue), so waiters never use up the pool that load() and save() need.
   */
  private async locked<T>(wait: boolean, fn: () => Promise<T>): Promise<T | undefined> {
    const key = `network-tick-${this.id}`;
    const conn = await this.sql.reserve();
    try {
      if (wait) await conn`select pg_advisory_lock(hashtext(${key}))`;
      else {
        const [row] = await conn`select pg_try_advisory_lock(hashtext(${key})) as ok`;
        if (!row?.ok) return undefined;
      }
      try { return await fn(); } finally { await conn`select pg_advisory_unlock(hashtext(${key}))`; }
    } finally {
      conn.release();
    }
  }

  async close() { if (this.owned) await this.sql.close(); }
}
