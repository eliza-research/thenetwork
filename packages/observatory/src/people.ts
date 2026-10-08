// The cross-app person view (platform plan 5, 2.4 rule 5): one person's memberships, per-app states,
// holds and person-to-person blocks. Only cross_app_safety@* and admin@* reach it (server.ts). It
// reads the platform schema through a read-only login: OBSERVATORY_PLATFORM_DATABASE_URL (grant it
// network_observatory_cross_app, migration 0005), else the real-mode database URL (local use). It
// never reads a phone number, a name or a message text. Each app's panel is read only after the
// server has written the audit row for it. A private app (slop, dating; PRD 40.3) is left out of the
// summary: no membership row, its holds show only as "restricted" and its blocks without the app.
// Its panel opens like any other, with a typed reason (that answer says whether there is a membership).
import { SQL } from "bun";
import { APP_IDS, isAppId, isPrivateApp, PRIVATE_APPS, type AppId } from "./apps.ts";
import type { PersonAppPanel, PersonSummary } from "./types.ts";

const ms = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : undefined);
const json = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : v) as T;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const peopleUrl = (env: Record<string, string | undefined> = process.env) =>
  env.OBSERVATORY_PLATFORM_DATABASE_URL ?? env.NETWORK_DATABASE_URL ?? env.DATABASE_URL;

export class PeopleView {
  private sql: SQL;
  constructor(url: string) {
    this.sql = new SQL({ url, max: 2, idleTimeout: 30, connection: { default_transaction_read_only: "on", application_name: "network-observatory-cross-app", statement_timeout: "10000" } });
  }

  /** The person behind a member of one app (undefined: no person linked yet). */
  async personOf(app: AppId, memberId: string): Promise<string | undefined> {
    const rows = await this.sql`select person_id from platform.memberships where app_id = ${app} and member_id = ${memberId}
      union all select person_id from network.members where app_id = ${app} and id = ${memberId} and person_id is not null limit 1`;
    return (rows as { person_id: string }[])[0]?.person_id;
  }

  /** The newest console row of every app's Network state: member id -> trust level, and the cases. */
  private async states(): Promise<Map<AppId, { trust: Map<string, string>; cases: any[] }>> {
    const out = new Map<AppId, { trust: Map<string, string>; cases: any[] }>();
    // The cross-app role reads only trust levels and cases (network_state_console_cross_app, migration 0010);
    // a local login without it reads the shared view. Every city of an app counts.
    const rows = await this.sql`select app, trust, cases from network.network_state_console_cross_app`.catch(() =>
      this.sql`select case when position(':' in id) > 0 then split_part(id, ':', 1) else 'ntwrk' end as app, trust, cases from network.network_state_console`.catch(() => []));
    for (const r of rows as any[]) {
      if (!isAppId(r.app)) continue;
      const cur = out.get(r.app) ?? { trust: new Map<string, string>(), cases: [] as any[] };
      for (const t of json<any[]>(r.trust) ?? []) cur.trust.set(String(t.id), String(t.level));
      cur.cases.push(...(json<any[]>(r.cases) ?? []));
      out.set(r.app, cur);
    }
    return out;
  }

  async summary(personId: string): Promise<PersonSummary | undefined> {
    if (!UUID.test(personId)) return undefined;
    const [people, memberships, made, received, states] = await Promise.all([
      this.sql`select id, lowest_age, created_at, deleted_at from platform.people where id = ${personId}`,
      this.sql`select app_id, member_id, state, review, joined_at, left_at from platform.memberships where person_id = ${personId} order by app_id`,
      this.sql`select to_person, origin_app, at from platform.person_blocks where from_person = ${personId} order by at`,
      this.sql`select from_person, origin_app, at from platform.person_blocks where to_person = ${personId} order by at`,
      this.states(),
    ]);
    const p = (people as any[])[0];
    if (!p) return undefined;
    const ms_ = (memberships as any[]).filter(m => isAppId(m.app_id)).sort((a, b) => APP_IDS.indexOf(a.app_id) - APP_IDS.indexOf(b.app_id));
    const holds: PersonSummary["holds"] = [];
    const restricted = () => { if (!holds.some(h => h.app === "*")) holds.push({ app: "*", level: "restricted" }); };
    const list = ms_.flatMap(m => {
      const hold = states.get(m.app_id)?.trust.get(m.member_id) === "hold";
      // A private app: no row; a hold or restriction there shows as "restricted" on an app not named.
      if (isPrivateApp(m.app_id)) { if (hold || m.state === "restricted") restricted(); return []; }
      if (hold) holds.push({ app: m.app_id, level: "hold" });
      if (m.state === "restricted") holds.push({ app: m.app_id, level: "restricted" });
      if (m.review === "recycled_number") holds.push({ app: m.app_id, level: "recycled_number" });
      return [{ app: m.app_id as string, state: m.state as string, joinedAt: ms(m.joined_at), leftAt: ms(m.left_at), ...(m.review ? { review: m.review } : {}), hold }];
    });
    const origin = (a: string) => (isPrivateApp(a) ? "*" : a);
    return {
      personId: p.id, lowestAge: p.lowest_age ?? null, createdAt: ms(p.created_at) ?? 0, ...(p.deleted_at ? { deletedAt: ms(p.deleted_at) } : {}),
      memberships: list, holds,
      blocks: {
        made: (made as any[]).map(b => ({ person: b.to_person, originApp: origin(b.origin_app), at: ms(b.at) ?? 0 })),
        received: (received as any[]).map(b => ({ person: b.from_person, originApp: origin(b.origin_app), at: ms(b.at) ?? 0 })),
      },
      privateApps: [...PRIVATE_APPS].filter(isAppId),
    };
  }

  /** One app's panel: the member's state, trust, counts and cases. Call only after the audit row is written. */
  async panel(personId: string, app: AppId): Promise<PersonAppPanel | undefined> {
    if (!UUID.test(personId)) return undefined;
    const m = (await this.sql`select member_id, state, joined_at from platform.memberships where person_id = ${personId} and app_id = ${app}`)[0] as any;
    if (!m) return undefined;
    const id = m.member_id as string;
    const [msgs, opps, states] = await Promise.all([
      this.sql`select count(*) filter (where direction = 'inbound')::int as n_in, count(*) filter (where direction = 'outbound')::int as n_out, max(ts) as last
        from network.messages where app_id = ${app} and member_id = ${id} and not system`,
      this.sql`select count(distinct opportunity_id)::int as n from network.participations where app_id = ${app} and member_id = ${id} and role = 'participant'`,
      this.states(),
    ]);
    const st = states.get(app);
    const g = (msgs as any[])[0] ?? {};
    return {
      personId, app, memberId: id, state: m.state, joinedAt: ms(m.joined_at),
      trust: (st?.trust.get(id) as PersonAppPanel["trust"]) ?? "ok",
      messages: { in: g.n_in ?? 0, out: g.n_out ?? 0, last: ms(g.last) },
      opportunities: (opps as any[])[0]?.n ?? 0,
      cases: (st?.cases ?? []).filter(c => c.memberId === id).map(c => ({ id: String(c.id), level: String(c.level), status: String(c.status), opened: Number(c.opened) || 0 })),
    };
  }

  async close() { await this.sql.close(); }
}
