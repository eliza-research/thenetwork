import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { simulatedServiceJudge } from "../../engine/src/reviewJudge.ts";
import { START } from "./mini.ts";

const T = 300_000;
const SECRET = "whsec_dating_shown_to";
const ADMIN = "adm-tok";
const KAI = "+12125550181", SAM = "+12125550182";

let url: string;
let sql: SQL;
let svc: NetworkService | undefined;
let evt = 0;

describe.skipIf(!pgAvailable)("dating: a nonbinary member's shown-to choice (NetworkService, Postgres)", () => {
  beforeAll(async () => {
    url = await migratedDb("dating_shown_to");
    sql = new SQL({ url, max: 2 });
  }, T);
  afterAll(async () => {
    await svc?.close();
    await sql?.close();
    await dropDb(url);
  });

  test("a man who seeks women is proposed to a nonbinary member shown to women seekers", async () => {
    const clock = new SimClock(START);
    const s = svc = new NetworkService({
      url, clock, instance: "dating-shown-to", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: [{ id: "slop:nyc" }],
      tokens: `admin:${ADMIN}`, webhookSecret: SECRET, network: { seed: 1 }, photoStorage: null, notify: false,
      adapter: () => new DryRunAdapter(() => {}), reviewJudge: simulatedServiceJudge({ exceptions: false }),
    });
    await s.start();
    const text = async (from: string, body: string) => {
      const n = ++evt;
      const raw = JSON.stringify({ id: `evt_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test", data: { message_id: `msg_${n}`, sender: from, chat_id: from, text: body, protocol: "imessage" } });
      const res = await s.fetch(new Request(`http://127.0.0.1${WEBHOOK_PATH}`, { method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(SECRET, raw, Math.floor(clock.now() / 1000)) }, body: raw }));
      expect(res.status).toBe(200);
      await res.text();
      clock.advance(MINUTE);
    };
    const lastOutbound = async (e164: string): Promise<string> => {
      const [m] = await sql`select x.body from network.messages x join network.members m on m.id = x.member_id and m.app_id = x.app_id
        join platform.phone_identities p on p.person_id = m.person_id where x.app_id = 'slop' and p.e164 = ${e164}
        and x.direction = 'outbound' order by x.ts desc, x.id desc limit 1`;
      return (m?.body as string | undefined) ?? "";
    };
    const runtime = s.runtimes.get("slop:nyc")!;

    const memberIds: string[] = [];
    for (const [e164, lines, shownTo] of [
      [KAI, ["slop", "Kai, 30", "I'm nonbinary, looking for men. Live in Greenpoint, love climbing and live music", "I'm nonbinary looking for men, 27 to 38, within 5 miles of 11222", "Something serious, no smokers", "Weekend evenings work best"], "Women, please"],
      [SAM, ["slop", "Sam, 31", "I'm a man into women. Williamsburg, I climb and go to shows", "I'm a man looking for women, 25 to 35, within 5 miles of 11211", "A relationship, no smokers", "Weekend evenings work best"], "Neither"],
    ] as const) {
      for (const line of lines) await text(e164, line);
      const answered: string[] = [];
      for (let i = 0; i < 8; i++) {
        const q = await lastOutbound(e164);
        if (answered.includes(q) || !/\?/.test(q)) break;
        answered.push(q);
        await text(e164, /right\?/.test(q) ? "Yes, that's right." : /shown to people/.test(q) ? shownTo : /trans people/.test(q) ? "Yes" : "Coffee or a walk.");
      }
      const [row] = await sql<{ id: string }[]>`select m.id from network.members m join platform.phone_identities p on p.person_id = m.person_id where m.app_id = 'slop' and p.e164 = ${e164}`;
      memberIds.push(row!.id);
    }
    const st = (await runtime.pg.load())!;
    const tagsOf = (id: string) => (st.members.find(x => x.id === id)!.appTags ?? []).map(t => t.tag);
    expect(tagsOf(memberIds[0]!)).toEqual(expect.arrayContaining(["romance:is:nonbinary", "romance:seeks:man", "romance:shown_to:woman", "romance:open_trans:open"]));
    expect(tagsOf(memberIds[0]!)).not.toContain("romance:seeks:woman");
    expect(tagsOf(memberIds[1]!)).toEqual(expect.arrayContaining(["romance:is:man", "romance:seeks:woman"]));

    const matching = await s.fetch(new Request("http://127.0.0.1:4848/apps/slop/matching", { method: "POST",
      headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" }, body: JSON.stringify({ on: true }) }));
    expect(matching.status).toBe(200);
    await matching.text();
    const pair = async () => (await runtime.pg.load())!.opps.find(o => memberIds.every(id => o.participants.includes(id)));
    for (let i = 0; i < 12 && !(await pair()); i++) {
      for (let t = 0; t < 4; t++) { clock.advance(30 * MINUTE); await s.tick(); }
    }
    expect(await pair()).toMatchObject({ category: "romance" });
    expect((await sql<{ status: string }[]>`select distinct status from network.messages where direction = 'outbound'`).map(r => r.status)).toEqual(["dry_run"]);
  }, T);
});
