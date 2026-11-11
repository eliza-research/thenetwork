// SD-122 (gap-status GS-7): the console's matching status in real mode, on Postgres. The Network service
// matches when the registry row allows it and the stored switch is on (service.ts setMatching, runtime.ts
// load); it does not read the console's pack list. A stored state with no switch yet starts with matching
// off (runtime.ts). The overview line, the health alert and the config panel must show the stored switch.
// Skipped without Postgres.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { appHealth } from "../src/health.ts";
import { RealSource } from "../src/sources/real.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

describe.skipIf(!pgAvailable)("console matching status against the stored switch (Postgres)", () => {
  let url: string;
  let sql: SQL;
  const sources: RealSource[] = [];
  const LOGINS = { peon: `obs_gate_peon_${process.pid}`, slop: `obs_gate_slop_${process.pid}` };

  const open = async (app: "peon" | "slop") => {
    const real = new RealSource({ url, app, appUrl: url.replace(/\/\/[^@]+@/, `//${LOGINS[app]}@`), pollMs: 3_600_000, pushMs: 3_600_000, service: false });
    sources.push(real);
    await real.init();
    return real;
  };

  beforeAll(async () => {
    url = await testDb();
    sql = new SQL(url);
    // The service turned matching on for peon (a direct POST /matching on: the registry row allows it).
    await sql.begin(async tx => {
      await tx`set local app.app_id = 'peon'`;
      await tx`insert into network.network_state (id, version, state) values ('peon:nyc', 1, ${{ matchingEnabled: true, trust: [], cases: [], members: [] }}::jsonb)`;
    });
    for (const [app, login] of Object.entries(LOGINS)) {
      await sql.unsafe(`drop role if exists ${login}`);
      await sql.unsafe(`create role ${login} login in role network_observatory_${app}`);
    }
  }, 120_000);

  afterAll(async () => {
    for (const s of sources) await s.dispose();
    for (const login of Object.values(LOGINS)) await sql?.unsafe(`drop role if exists ${login}`).catch(() => {});
    await sql?.close();
    await dropTestDb();
  });

  test("peon with the stored switch on: the overview says on and no alert says matching is off", async () => {
    const real = await open("peon");
    const st = real.state();
    expect(st.network?.matchingEnabled).toBe(true);
    expect(appHealth("peon", st, 12).matching).toBe("on");
    expect(st.stats.alerts?.find(a => a.key === "matching_off")).toBeUndefined();
    expect((await real.config()).matchingEnabled).toBe(true);
  });

  test("slop with no stored state: matching is off, as in the service", async () => {
    const real = await open("slop");
    const st = real.state();
    expect(st.network).toBeUndefined();
    expect((await real.config()).matchingEnabled).toBe(false);
    expect(appHealth("slop", st, 6).matching).toBe("off");
  });
});
