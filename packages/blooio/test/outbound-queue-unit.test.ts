import { describe, expect, test } from "vitest";
import { SimClock } from "../../core/src/clock.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import { OutboundQueue, isAgentInitiated, recipientWindowHasher, type AppChecks, type MessageKind, type QueueOptions } from "../src/outbound-queue.ts";
import type { ChannelAdapter, SendRequest } from "../src/types.ts";

interface MockRow {
  id: string;
  app_id: string;
  network_id?: string | null;
  member_id: string | null;
  line: string;
  to_address: string | null;
  kind: MessageKind;
  body: string | null;
  media_urls: string[];
  fingerprint: string;
  opportunity_id: string | null;
  time_zone: string;
  status: string;
  attempts: number;
  next_attempt_at: Date;
  created_at: Date;
  updated_at: Date;
  ended_at: Date | null;
  lease_owner: string | null;
  lease_until: Date | null;
  in_doubt: boolean;
  person_cap: boolean;
  new_conversation: boolean;
  reengagement: boolean;
  note: string | null;
  last_error: string | null;
  sent_at: Date | null;
  delivered_at: Date | null;
  read_at: Date | null;
  provider_message_id: string | null;
  provider_message_ids: string[] | null;
  history_recorded: boolean | null;
  chat_id: string | null;
  transport: string | null;
  approved_photos: unknown;
  leak_released_by: string | null;
}

interface MockConv {
  line: string;
  address: string;
  unanswered: number;
  reengagement_used: boolean;
  first_outbound_at: Date | null;
  last_outbound_at: Date | null;
  last_inbound_at: Date | null;
}

interface MockState {
  rows: Map<string, MockRow>;
  convs: Map<string, MockConv>;
  lineSafety: Map<string, string>;
  members: Map<string, { id: string; app_id: string; person_id: string | null; account_status: string; safety_held: boolean; opted_out: boolean; quiet_hours: unknown; time_zone: string | null }>;
  queries: { sql: string; values: unknown[] }[];
}

function flattenSql(strings: TemplateStringsArray, values: unknown[]): { text: string; vals: unknown[] } {
  let text = "";
  const vals: unknown[] = [];
  for (let i = 0; i < strings.length; i++) {
    text += strings[i];
    if (i < values.length) {
      const v = values[i] as any;
      if (v && typeof v === "object" && v.__fragment) {
        text += v.text;
        vals.push(...v.vals);
      } else {
        text += `$${vals.length + 1}`;
        vals.push(v);
      }
    }
  }
  return { text: text.replace(/\s+/g, " ").trim(), vals };
}

function makeMockSql(state: MockState): SQL {
  const exec = (strings: TemplateStringsArray | Record<string, unknown>, ...values: unknown[]): any => {
    if (!Array.isArray(strings)) {
      return { __insert: strings };
    }
    const { text, vals } = flattenSql(strings as TemplateStringsArray, values);
    state.queries.push({ sql: text, values: vals });

    const run = async (): Promise<any[]> => {
      if (text.startsWith("select set_config(") || text.startsWith("select pg_advisory_")) return [];
      if (text.startsWith("select person.id from platform.people")) return [];
      if (text.startsWith("select membership.member_id from platform.memberships")) return [];
      if (text.startsWith("insert into platform.outbound ")) {
        const obj = (vals[0] as { __insert: Record<string, unknown> }).__insert;
        if (state.rows.has(String(obj.id))) return [];
        state.rows.set(String(obj.id), {
          id: String(obj.id),
          app_id: String(obj.app_id),
          ...("network_id" in obj ? { network_id: obj.network_id as string | null } : {}),
          member_id: (obj.member_id as string | null) ?? null,
          line: String(obj.line),
          to_address: (obj.to_address as string | null) ?? null,
          kind: obj.kind as MessageKind,
          body: (obj.body as string | null) ?? null,
          media_urls: (obj.media_urls as string[]) ?? [],
          fingerprint: String(obj.fingerprint),
          opportunity_id: (obj.opportunity_id as string | null) ?? null,
          time_zone: String(obj.time_zone),
          status: String(obj.status),
          attempts: 0,
          next_attempt_at: obj.next_attempt_at as Date,
          created_at: obj.created_at as Date,
          updated_at: obj.updated_at as Date,
          ended_at: (obj.ended_at as Date | null) ?? null,
          lease_owner: null,
          lease_until: null,
          in_doubt: false,
          person_cap: false,
          new_conversation: false,
          reengagement: false,
          note: (obj.note as string | null) ?? null,
          last_error: null,
          sent_at: null,
          delivered_at: null,
          read_at: null,
          provider_message_id: null,
          provider_message_ids: null,
          history_recorded: null,
          chat_id: null,
          transport: null,
          approved_photos: null,
          leak_released_by: null,
        });
        return [{ id: obj.id }];
      }
      if (text.startsWith("update platform.outbound set status =") && text.includes("lease_until <")) return [];
      if (text.startsWith("select * from platform.outbound where app_id =") && text.includes("status = 'held_awaiting_reply'")) return [];
      if (text.startsWith("select * from platform.outbound where app_id=") && text.includes("status='unknown_acceptance'")) return [];
      if (text.startsWith("update platform.outbound set status='failed_unknown'")) return [];
      if (text.startsWith("update platform.outbound set network_id = app_id || ':nyc'")) {
        const [app, line] = vals as [string, string];
        for (const r of state.rows.values()) {
          if (r.app_id === app && r.line === line && r.network_id == null) r.network_id = `${r.app_id}:nyc`;
        }
        return [];
      }
      if (text.startsWith("select * from platform.outbound where app_id =") && text.includes("order by next_attempt_at")) {
        const hasNetwork = text.includes("and network_id =");
        const app = vals[0] as string;
        const line = vals[1] as string;
        const net = hasNetwork ? (vals[2] as string) : undefined;
        const dueCutoff = vals[hasNetwork ? 4 : 3] as Date;
        return [...state.rows.values()].filter(r =>
          r.app_id === app && r.line === line
          && (!hasNetwork || r.network_id === net)
          && ["pending", "retry_scheduled", "deferred_quiet_hours"].includes(r.status)
          && r.next_attempt_at.getTime() <= dueCutoff.getTime(),
        );
      }
      if (text.startsWith("select * from platform.line_conversations")) {
        const [line, address] = vals as [string, string];
        const c = state.convs.get(`${line}|${address}`);
        return c ? [c] : [];
      }
      if (text.startsWith("select member.id,member.person_id,member.account_status,member.opted_out")) {
        const [app, id] = vals as [string, string];
        const m = state.members.get(`${app}|${id}`);
        return m ? [m] : [];
      }
      if (text.startsWith("select action from platform.line_safety")) {
        const action = state.lineSafety.get(String(vals[0]));
        return action ? [{ action }] : [];
      }
      if (text.startsWith("select (count(*) filter")) {
        const to = vals[0] as string;
        const cutoff = vals[1] as Date;
        const line = vals[6] as string;
        const dayCutoff = vals[7] as Date;
        const sent = [...state.rows.values()].filter(r => r.line === line && r.sent_at && r.sent_at.getTime() > dayCutoff.getTime());
        return [{
          recipient: sent.filter(r => r.to_address === to && r.sent_at!.getTime() > cutoff.getTime()).length,
          line: sent.filter(r => ["proactive", "transactional"].includes(r.kind)).length,
          new_chats: sent.filter(r => r.new_conversation).length,
        }];
      }
      if (text.startsWith("select body from platform.outbound where line =")) return [];
      if (text.startsWith("update platform.outbound set status='sending'")) {
        const [owner, leaseUntil, updatedAt, isNew, reeng, id] = vals as [string, Date, Date, boolean, boolean, string];
        const r = state.rows.get(id);
        if (!r || r.lease_until !== null) return [];
        r.status = "sending";
        r.attempts += 1;
        r.lease_owner = owner;
        r.lease_until = leaseUntil;
        r.updated_at = updatedAt;
        r.new_conversation = isNew;
        r.reengagement = reeng;
        return [{ id: r.id }];
      }
      if (text.startsWith("update platform.outbound set status=") && text.includes("provider_message_id=")) {
        const status = vals[0] as string;
        const providerId = vals[1] as string;
        const at = vals[7] as Date;
        const id = vals[14] as string;
        const r = state.rows.get(id);
        if (!r) return [];
        r.status = status;
        r.provider_message_id = providerId;
        r.sent_at = status === "failed" ? r.sent_at : (r.sent_at ?? at);
        r.lease_owner = null;
        r.lease_until = null;
        return [{ member_id: r.member_id, sent_at: r.sent_at }];
      }
      if (text.startsWith("insert into platform.line_conversations")) {
        const [line, address, unanswered, reeng, at] = vals as [string, string, number, boolean, Date];
        const k = `${line}|${address}`;
        const prev = state.convs.get(k);
        if (!prev) state.convs.set(k, { line, address, unanswered, reengagement_used: reeng, first_outbound_at: at, last_outbound_at: at, last_inbound_at: null });
        else { prev.unanswered += unanswered; prev.last_outbound_at = at; prev.reengagement_used ||= reeng; }
        return [];
      }
      if (text.startsWith("update platform.outbound set status = ") && text.includes("next_attempt_at =")) {
        const [status, nextAt, note, updatedAt, id] = vals as [string, Date, string, Date, string];
        const r = state.rows.get(id);
        if (!r) return [];
        r.status = status;
        r.next_attempt_at = nextAt;
        r.note = note;
        r.updated_at = updatedAt;
        return [{ id: r.id }];
      }
      if (text.startsWith("update platform.outbound set status = ") && text.includes("ended_at =")) {
        const [status, note, , endedAt, , , , id] = vals as [string, string | null, unknown, Date, unknown, unknown, unknown, string];
        const r = state.rows.get(id);
        if (!r) return [];
        r.status = status;
        r.note = note;
        r.ended_at = endedAt;
        return [{ id: r.id }];
      }
      return [];
    };
    return Object.assign(run(), { __fragment: true, text, vals });
  };
  const proxy = new Proxy(exec, {
    get(target, prop) {
      if (prop === "array") return (v: unknown[]) => v;
      if (prop === "begin") return async <T>(fn: (tx: SQL) => Promise<T>) => fn(proxy as unknown as SQL);
      if (prop === "reserve") return async () => Object.assign(proxy, { release() {} });
      return Reflect.get(target, prop);
    },
  });
  return proxy as unknown as SQL;
}

const LINE = "+12125550100";
const NY = "America/New_York";

describe("OutboundQueue unit coverage (network scoping + safety kind)", () => {
  test("network option isolates enqueue, recordCollected, drain, and pre-0072 null backfill", async () => {
    const state: MockState = { rows: new Map(), convs: new Map(), lineSafety: new Map(), members: new Map(), queries: [] };
    const sql = makeMockSql(state);
    const clock = new SimClock(Date.UTC(2026, 9, 9, 16));
    const sent: SendRequest[] = [];
    const provider: ChannelAdapter = {
      kind: "sim",
      async send(req) { sent.push(req); return { providerMessageId: `sim:${req.idempotencyKey}`, status: "sent" }; },
    };
    const makeQ = (network?: string, checks: AppChecks = { live: () => true }) => new OutboundQueue({
      sql, clock, provider, line: LINE, app: "friends", network, checks,
      recipientWindowKey: recipientWindowHasher("synthetic-unit-secret"),
      newChatsPerLinePerDay: 1000, perLinePerDay: 1000,
    });

    const nyc = makeQ("friends:nyc");
    const sf = makeQ("friends:sf");
    const legacy = makeQ(undefined);

    await nyc.enqueue(sql, [{ id: "m-nyc", to: "+12125550101", kind: "transactional", text: "NYC update", timeZone: NY }]);
    await sf.enqueue(sql, [{ id: "m-sf", to: "+12125550102", kind: "transactional", text: "SF update", timeZone: "America/Los_Angeles" }]);
    await legacy.enqueue(sql, [{ id: "m-null", to: "+12125550103", kind: "transactional", text: "Legacy row", timeZone: NY }]);
    await sf.recordCollected(sql, [{ id: "c-sf", memberId: "mem-sf", to: "+12125550104", kind: "reply", text: "SF reply" }]);

    expect(state.rows.get("m-nyc")?.network_id).toBe("friends:nyc");
    expect(state.rows.get("m-sf")?.network_id).toBe("friends:sf");
    expect("network_id" in state.rows.get("m-null")!).toBe(false);
    expect(state.rows.get("c-sf")?.network_id).toBe("friends:sf");

    // sf drain backfills null network_id to friends:nyc (so sf does NOT drain m-null or m-nyc!) and sends only m-sf.
    await sf.drain();
    expect(sent.map(r => r.idempotencyKey)).toEqual(["tn:m-sf"]);
    expect(state.rows.get("m-null")?.network_id).toBe("friends:nyc");
    expect(state.rows.get("m-nyc")?.status).toBe("pending");

    await nyc.drain();
    expect(sent.map(r => r.idempotencyKey)).toEqual(["tn:m-sf", "tn:m-nyc", "tn:m-null"]);
  });

  test("SD-475: safety kind bypasses quiet hours, invalid timezone, streak, line caps, and safety_held fence while keeping consent, hourly recipient cap, line safety, and leak guard", async () => {
    const state: MockState = { rows: new Map(), convs: new Map(), lineSafety: new Map(), members: new Map(), queries: [] };
    const sql = makeMockSql(state);
    // 03:00 UTC = 23:00 in New York (quiet hours).
    const clock = new SimClock(Date.UTC(2026, 9, 11, 3));
    const sent: SendRequest[] = [];
    const provider: ChannelAdapter = {
      kind: "sim",
      async send(req) { sent.push(req); return { providerMessageId: `sim:${req.idempotencyKey}`, status: "sent" }; },
    };
    expect(isAgentInitiated("safety")).toBe(true);

    const addr = "+12125550111";
    state.members.set("friends|m1", {
      id: "m1", app_id: "friends", person_id: "p1", account_status: "paused", safety_held: true,
      opted_out: false, quiet_hours: [21, 9], time_zone: NY,
    });
    // Exhaust unanswered streak AND saturate line daily cap & new chats cap via earlier row.
    state.convs.set(`${LINE}|${addr}`, {
      line: LINE, address: addr, unanswered: 5, reengagement_used: true,
      first_outbound_at: new Date(clock.now() - 10_000), last_outbound_at: new Date(clock.now() - 10_000), last_inbound_at: null,
    });
    await sql`insert into platform.outbound ${(sql as any)({
      id: "prior-line-1", app_id: "friends", member_id: "m0", line: LINE, to_address: "+12125550199",
      kind: "proactive", body: "Earlier proactive", media_urls: [], fingerprint: "fp0", opportunity_id: null,
      time_zone: NY, status: "sent", next_attempt_at: new Date(clock.now()), created_at: new Date(clock.now()),
      updated_at: new Date(clock.now()), ended_at: null,
    })}`;
    state.rows.get("prior-line-1")!.sent_at = new Date(clock.now() - 1000);
    state.rows.get("prior-line-1")!.new_conversation = true;

    let optedOut = false;
    let capTook = 0;
    const q = new OutboundQueue({
      sql, clock, provider, line: LINE, app: "friends",
      recipientWindowKey: recipientWindowHasher("synthetic-unit-secret"),
      perLinePerDay: 1, newChatsPerLinePerDay: 1, perRecipientPerHour: 2, maxUnanswered: 3,
      checks: {
        live: () => true,
        optedOut: () => optedOut,
        capTake: async () => { capTook++; return true; },
        leaks: () => ({ canaries: ["CANARY_SECRET_123"] }),
      },
    });

    // Enqueued with unusable timezone: safety notice stays pending (unlike transactional).
    await q.enqueue(sql, [
      { id: "saf-hold", memberId: "m1", to: addr, kind: "safety", text: "You will hear from a person soon.", timeZone: "Invalid/Zone" },
      { id: "txn-bad-tz", memberId: "m1", to: addr, kind: "transactional", text: "Reminder.", timeZone: "Invalid/Zone" },
    ]);
    expect(state.rows.get("saf-hold")?.status).toBe("pending");
    expect(state.rows.get("txn-bad-tz")?.status).toBe("parked_invalid_timezone");

    await q.drain();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.context?.kind).toBe("safety");
    expect(capTook).toBe(0);
    expect(state.rows.get("saf-hold")?.status).toBe("sent");

    // Line safety "review" still holds safety notice.
    state.lineSafety.set(LINE, "review");
    await q.enqueue(sql, [{ id: "saf-line-safety", memberId: "m1", to: addr, kind: "safety", text: "Second notice.", timeZone: NY }]);
    await q.drain();
    expect(state.rows.get("saf-line-safety")?.status).toBe("retry_scheduled");
    state.lineSafety.delete(LINE);

    // Leak guard still parks safety notice.
    await q.enqueue(sql, [{ id: "saf-leak", memberId: "m1", to: addr, kind: "safety", text: "Notice with CANARY_SECRET_123.", timeZone: NY }]);
    await q.drain();
    expect(state.rows.get("saf-leak")?.status).toBe("parked_leak_review");

    // Opt-out still refuses safety notice.
    optedOut = true;
    await q.enqueue(sql, [{ id: "saf-opted-out", memberId: "m1", to: addr, kind: "safety", text: "Third notice.", timeZone: NY }]);
    await q.drain();
    expect(state.rows.get("saf-opted-out")?.status).toBe("refused_opted_out");
    optedOut = false;

    // Per-recipient hourly cap still applies to safety notice (cap=2: saf-hold sent once, send one more, 3rd waits).
    await q.enqueue(sql, [{ id: "saf-cap-1", memberId: "m1", to: addr, kind: "safety", text: "Notice ok.", timeZone: NY }]);
    await q.drain();
    expect(state.rows.get("saf-cap-1")?.status).toBe("sent");
    await q.enqueue(sql, [{ id: "saf-cap-2", memberId: "m1", to: addr, kind: "safety", text: "Notice capped.", timeZone: NY }]);
    await q.drain();
    expect(state.rows.get("saf-cap-2")?.status).toBe("retry_scheduled");
    expect(state.rows.get("saf-cap-2")?.note).toBe("per-recipient hourly cap");
  });

  test("a saved half-hour quiet window defers a proactive send inside it", async () => {
    const state: MockState = { rows: new Map(), convs: new Map(), lineSafety: new Map(), members: new Map(), queries: [] };
    const sql = makeMockSql(state);
    // 00:45 UTC = 20:45 in New York: inside a saved 20:30-10:30 window, outside the 21:00-09:00 default.
    const clock = new SimClock(Date.UTC(2026, 9, 11, 0, 45));
    const sent: SendRequest[] = [];
    const provider: ChannelAdapter = {
      kind: "sim",
      async send(req) { sent.push(req); return { providerMessageId: `sim:${req.idempotencyKey}`, status: "sent" }; },
    };
    state.members.set("friends|m1", {
      id: "m1", app_id: "friends", person_id: "p1", account_status: "active", safety_held: false,
      opted_out: false, quiet_hours: [20.5, 10.5], time_zone: NY,
    });
    const q = new OutboundQueue({
      sql, clock, provider, line: LINE, app: "friends",
      recipientWindowKey: recipientWindowHasher("synthetic-unit-secret"),
      newChatsPerLinePerDay: 1000, perLinePerDay: 1000,
      checks: { live: () => true },
    });
    await q.enqueue(sql, [{ id: "half-hour-quiet", memberId: "m1", to: "+12125550111", kind: "proactive", text: "A new introduction.", timeZone: NY }]);
    await q.drain();
    expect(sent).toHaveLength(0);
    expect(state.rows.get("half-hour-quiet")?.status).toBe("deferred_quiet_hours");
  });
});
