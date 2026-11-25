import { afterAll, describe, expect, test } from "vitest";
import { SQL } from "../../packages/core/src/runtime/postgres.ts";
import { HOUR, MINUTE, SimClock } from "../../packages/core/src/index.ts";
import { signBlooioPayload } from "../../packages/blooio/src/blooio/webhook.ts";
import { DryRunAdapter } from "../../packages/network/service/channel.ts";
import { NetworkService, WEBHOOK_PATH } from "../../packages/network/service/service.ts";
import { START } from "../../packages/network/test/mini.ts";
import { dropTestDb, pgAvailable, testDb } from "../../apps/observatory/test/pg.ts";
import { createBackend, jsonLogger, loadConfig } from "./backend.ts";

const SECRET = "whsec_selection_delivery";
const ADMIN = "selection-admin-token", REVIEWER = "selection-reviewer-token";
const IVY = "+12125550181", LEO = "+12125550182";
type ReviewItem = { oppId: string; revision: number; proposal: { participants: string[] } };

describe.skipIf(!pgAvailable)("backend: a selected proposal goes through review approval to a queued delivery (createBackend, Postgres, dry-run)", () => {
  let sql: SQL | undefined, svc: NetworkService | undefined;
  afterAll(async () => { await svc?.close(); await sql?.close(); await dropTestDb(); });

  test("selection waits in review with nobody contacted; the staff approval through the staff port leads the backend tick to a dry-run delivery to the pair", async () => {
    const url = await testDb();
    sql = new SQL({ url, max: 2 });
    const clock = new SimClock(START);
    const s = svc = new NetworkService({
      url, clock, instance: "selection-delivery", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: [{ id: "ntwrk:nyc" }, { id: "slop:nyc" }],
      tokens: `admin:${ADMIN},reviewer:${REVIEWER}`, webhookSecret: SECRET, network: { seed: 1 }, photoStorage: null, notify: false,
      adapter: () => new DryRunAdapter(() => {}),
    });
    await s.start();
    const config = { ...loadConfig({ PLATFORM_ENV: "dev", DATABASE_URL: url }), build: "selection-delivery-test" };
    expect([config.deployed, config.blooioWebhook]).toEqual([false, true]);
    const backend = createBackend({ svc: s, config, log: jsonLogger(() => {}), ping: async () => true, now: () => clock.now() });

    let evt = 0;
    const text = async (from: string, body: string) => {
      const n = ++evt;
      const raw = JSON.stringify({ id: `evt_sel_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test", data: { message_id: `msg_sel_${n}`, sender: from, chat_id: from, text: body, protocol: "imessage" } });
      const res = await backend.publicFetch(new Request(`http://api.example.test${WEBHOOK_PATH}`, { method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(SECRET, raw, Math.floor(clock.now() / 1000)) }, body: raw }));
      expect(res.status).toBe(200);
      clock.advance(MINUTE);
    };
    const staff = (token: string, method: string, path: string, b?: unknown) =>
      backend.staffFetch(new Request(`http://127.0.0.1:4848${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(b ? { "content-type": "application/json" } : {}) }, ...(b ? { body: JSON.stringify(b) } : {}) }));
    const memberId = async (e164: string) =>
      ((await sql!`select m.id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = 'slop' and ph.e164 = ${e164}`)[0] as { id: string } | undefined)?.id;
    const aboutOpp = async (opp: string) =>
      ((await sql!`select member_id, status, proactive from network.messages where app_id = 'slop' and direction = 'outbound' and opportunity_id = ${opp} order by ts, id`) as { member_id: string; status: string; proactive: boolean }[])
        .map(r => ({ member: r.member_id, status: r.status, proactive: r.proactive }));
    const advance = async (ms: number) => { clock.advance(ms); await backend.tickAll(); };

    const people = [
      { e164: IVY, name: "Ivy, 30", about: "I'm a woman into men. Live in Greenpoint, love climbing and live music", seeking: "I'm a woman looking for men, 27 to 38, within 5 miles of 11222", goal: "Something serious, no smokers" },
      { e164: LEO, name: "Leo, 32", about: "I'm a man into women. Williamsburg, I climb and go to shows", seeking: "I'm a man looking for women, 25 to 35, within 5 miles of 11211", goal: "A relationship, no smokers" },
    ];
    for (const p of people) for (const body of ["slop", p.name, p.about, p.seeking, p.goal, "Weekend evenings work best"]) await text(p.e164, body);
    const ivy = (await memberId(IVY))!, leo = (await memberId(LEO))!;
    expect([ivy, leo].every(Boolean)).toBe(true);

    expect((await staff(ADMIN, "POST", "/apps/slop/matching", { on: true })).status).toBe(200);
    let item: ReviewItem | undefined;
    for (let i = 0; i < 12 && !item; i++) {
      await advance(2 * HOUR);
      const queue = await (await staff(REVIEWER, "GET", "/apps/slop/review")).json() as { items?: ReviewItem[] };
      item = queue.items?.find(x => x.proposal.participants.includes(ivy) && x.proposal.participants.includes(leo));
    }
    if (!item) throw new Error("no review item for the pair after 24 hours");
    await advance(2 * HOUR);
    expect(await aboutOpp(item.oppId)).toEqual([]);

    const decided = await staff(REVIEWER, "POST", `/apps/slop/review/${encodeURIComponent(item.oppId)}`, { decision: "approve", secondsSpent: 20, revision: item.revision });
    expect(decided.status).toBe(200);
    expect(((await decided.json()) as { ok: boolean }).ok).toBe(true);
    let delivered: { member: string; status: string; proactive: boolean }[] = [];
    for (let i = 0; i < 24 && !delivered.length; i++) { await advance(HOUR); delivered = await aboutOpp(item.oppId); }
    expect(delivered.length).toBeGreaterThan(0);
    expect(delivered.every(m => [ivy, leo].includes(m.member))).toBe(true);
    expect(delivered.every(m => m.status === "dry_run")).toBe(true);
    expect(delivered[0]!.proactive).toBe(true);
  }, 300_000);
});
