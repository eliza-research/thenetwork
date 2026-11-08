// The peon posting machine through NetworkService on Postgres (docs/research/2026-11-07-state-machines.md,
// module matching_engine): who may start and confirm a job post, and what a closed post may become.
// Postgres in a database of its own; dry-run sends; fictional numbers (+1 212 555 01xx). Nothing is sent.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { SQL } from "bun";
import { MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { jobPostingRoutes } from "../service/postings.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { START } from "./mini.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_peon_lifecycle_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

const SECRET = "whsec_peon_lifecycle";
const SAM = "+12125550181", ALEX = "+12125550182";
const POST = "We're hiring a data analyst (level 2), 2 openings, $90k-$120k, hybrid in Brooklyn, must have SQL";

let sql: SQL;
let svc: NetworkService | undefined;
let evt = 0;

async function text(s: NetworkService, clock: SimClock, from: string, body: string) {
  const n = ++evt;
  const raw = JSON.stringify({ id: `evt_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test", data: { message_id: `msg_${n}`, sender: from, chat_id: from, text: body, protocol: "imessage" } });
  const res = await s.fetch(new Request(`http://127.0.0.1${WEBHOOK_PATH}`, { method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(SECRET, raw, Math.floor(clock.now() / 1000)) }, body: raw }));
  expect(res.status).toBe(200);
  clock.advance(MINUTE);
}
const member = async (e164: string) =>
  (await sql`select m.id, m.person_id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = 'peon' and ph.e164 = ${e164}`)[0] as { id: string; person_id: string } | undefined;
const postings = async (id: string) => (await sql`select id, status from network.intents where app_id = 'peon' and member_id = ${id} and details like 'peon:job%' order by id`) as { id: string; status: string }[];
const last = async (id: string) =>
  ((await sql`select body from network.messages where app_id = 'peon' and member_id = ${id} and direction = 'outbound' order by ts desc, id desc limit 1`)[0] as { body: string } | undefined)?.body ?? "";

function service(clock: SimClock) {
  return new NetworkService({
    url: URL_, clock, instance: "peon-lifecycle", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: [{ id: "ntwrk:nyc" }, { id: "peon:nyc" }],
    tokens: "admin:adm-tok", webhookSecret: SECRET, network: { seed: 1 }, photoStorage: null, notify: false,
    adapter: () => new DryRunAdapter(() => {}),
  });
}

describe.skipIf(!pgAvailable)("peon posting lifecycle (NetworkService, Postgres)", () => {
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    sql = new SQL({ url: URL_, max: 2 });
  }, T);
  afterAll(async () => {
    await svc?.close().catch(() => {});
    await sql?.close();
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
  });

  // SD-042: the member's AI assistant (submit_profile, source "mcp") teaches; it never starts or confirms a post.
  test("an assistant's profile neither starts nor confirms a job post; only the manager's own yes posts", async () => {
    const clock = new SimClock(START);
    const s = svc = service(clock);
    await s.start();
    await text(s, clock, SAM, "peon");
    await text(s, clock, SAM, "Sam, 41");
    const sam = (await member(SAM))!;
    expect(sam.id).toBeString();

    // The assistant sends the post and then its own yes: nothing is posted.
    expect(await s.submitProfile(sam.person_id, "peon", SAM, POST)).toBe("accepted");
    clock.advance(MINUTE);
    expect(await s.submitProfile(sam.person_id, "peon", SAM, "yes, post it")).toBe("accepted");
    clock.advance(MINUTE);
    expect(await postings(sam.id)).toHaveLength(0);

    // The manager's own post and read-back: the assistant's yes still does not confirm it.
    await text(s, clock, SAM, POST);
    expect(await last(sam.id)).toMatch(/^Here's your job post: Data analyst/);
    expect(await s.submitProfile(sam.person_id, "peon", SAM, "yes, post it")).toBe("accepted");
    clock.advance(MINUTE);
    expect(await postings(sam.id)).toHaveLength(0);

    // The manager's own yes in the thread posts it.
    await text(s, clock, SAM, "yes");
    expect(await last(sam.id)).toMatch(/^Posted: data analyst\./);
    expect((await postings(sam.id)).map(p => p.status)).toEqual(["active"]);
    await s.close(); svc = undefined;
  }, T);

  // SD-114: "closed" is terminal. A staff edit or a stale update draft does not reopen a closed post
  // (with its openings read back as 1).
  test("a closed post stays closed after a staff edit and after a stale update draft", async () => {
    const clock = new SimClock(START + 7 * 24 * 60 * MINUTE);
    const s = svc = service(clock);
    await s.start();
    await text(s, clock, ALEX, "peon");
    await text(s, clock, ALEX, "Alex, 38");
    const alex = (await member(ALEX))!;
    const routes = jobPostingRoutes({ rt: s.runtimeFor("peon")!, user: { id: "staff:test", roles: ["admin"] }, need: () => undefined, audit: async () => {}, now: () => clock.now() });
    const call = async (method: string, path: string, b?: unknown) => {
      const res = await routes(new Request(`http://127.0.0.1:4848/apps/peon${path}`, { method, ...(b ? { headers: { "content-type": "application/json" }, body: JSON.stringify(b) } : {}) }), path.split("?")[0]!);
      return { status: res!.status, body: await res!.json() as any };
    };
    const openings = async (postingId: string) =>
      ((await sql`select tags from network.facets where app_id = 'peon' and id = ${`${postingId}-open`}`)[0] as { tags: string[] }).tags.filter(t => t.startsWith("peon:openings:"));

    // Trigger A: staff close the post, then staff save it again to fix the pay.
    await text(s, clock, ALEX, POST);
    await text(s, clock, ALEX, "yes");
    const [a] = await postings(alex.id);
    expect(a!.status).toBe("active");
    expect((await call("POST", `/postings/${encodeURIComponent(a!.id)}/close`, { reason: "filled" })).body.ok).toBe(true);
    const edit = await call("POST", "/postings", { id: a!.id, managerId: alex.id, payMin: 95, payMax: 125 });
    expect(edit.status).toBe(409);
    expect((await postings(alex.id)).find(p => p.id === a!.id)!.status).toBe("closed");
    expect(await openings(a!.id)).toEqual(["peon:openings:0"]);

    // Trigger B: the manager asks to update a second post and gets the read-back; staff close it; the manager says yes.
    await text(s, clock, ALEX, "We're hiring a bookkeeper, 3 openings, $60k-$70k, onsite in Queens");
    await text(s, clock, ALEX, "yes");
    const b = (await postings(alex.id)).find(p => p.id !== a!.id)!;
    expect(b.status).toBe("active");
    await text(s, clock, ALEX, "Update my bookkeeper post: $65k-$75k");
    expect(await last(alex.id)).toMatch(/^Here.s your job post: Bookkeeper, .*\$65k-\$75k/);
    expect((await call("POST", `/postings/${encodeURIComponent(b.id)}/close`, { reason: "closed" })).body.ok).toBe(true);
    await text(s, clock, ALEX, "yes");
    expect(await last(alex.id)).not.toMatch(/^Updated:/);
    expect((await postings(alex.id)).find(p => p.id === b.id)!.status).toBe("closed");
    expect(await openings(b.id)).toEqual(["peon:openings:0"]);
    await s.close(); svc = undefined;
  }, T);
});
