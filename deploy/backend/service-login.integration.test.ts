// Integration: the deployed backend's service login (ensureServiceLogin on the first deploy, then the
// boot check serviceLoginProblem) on the dev Postgres (:54339), in a database of its own. A crash in the
// middle of the first deploy must not leave a login that passes the boot check but cannot use the
// network_service grants (every later boot would fail the same way). SD-163. Skipped without Postgres.
import { afterAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { dropDb, migratedDb, pgAvailable } from "../../packages/platform/test/pg.ts";
import { ensureServiceLogin, serviceLoginProblem } from "./backend.ts";

const crashed = `svc_login_crash_${process.pid}`;
const manual = `svc_login_manual_${process.pid}`;
let url = "";

async function asOwner<T>(fn: (sql: SQL) => Promise<T>): Promise<T> { const sql = new SQL({ url, max: 1 }); try { return await fn(sql); } finally { await sql.close(); } }
const loginUrl = (role: string, password = "p".repeat(30)) => Object.assign(new URL(url), { username: role, password }).toString();
/** The boot check, connected as the service login. */
const bootCheck = async (role: string) => { const sql = new SQL({ url: loginUrl(role), max: 1 }); try { return await serviceLoginProblem(q => sql.unsafe(q)); } finally { await sql.close(); } };
const isMember = (role: string) => asOwner(async sql => (await sql`select pg_has_role(${role}, 'network_service', 'MEMBER') as m`)[0].m as boolean);

describe.skipIf(!pgAvailable)("service login on the first deploy (SD-163)", () => {
  afterAll(async () => {
    if (!url) return;
    await asOwner(async sql => { for (const r of [crashed, manual]) await sql.unsafe(`drop role if exists ${r}`).catch(() => {}); }).catch(() => {});
    await dropDb(url);
  });

  test("a crash after create role leaves no half-made login; the next boot makes a complete one", async () => {
    url = await migratedDb("svc_login");
    // First boot: the process dies (its connection ends) between create role and the grant.
    const first = new SQL({ url, max: 1 });
    await expect(ensureServiceLogin(async q => {
      if (q.startsWith("grant network_service")) { await first.close(); throw new Error("process killed"); }
      return first.unsafe(q);
    }, loginUrl(crashed))).rejects.toThrow();
    // Next boot.
    await asOwner(sql => ensureServiceLogin(q => sql.unsafe(q), loginUrl(crashed)));
    expect(await isMember(crashed)).toBe(true);
    expect(await bootCheck(crashed)).toBeUndefined();
  }, 60_000);

  test("the boot check refuses a login that is not a member of network_service", async () => {
    await asOwner(async sql => {
      await sql.unsafe(`create role ${manual} login nosuperuser nobypassrls`);
      await sql.unsafe(`grant connect on database ${new URL(url).pathname.slice(1)} to ${manual}`);
    });
    expect(await bootCheck(manual)).toMatch(/network_service/);
  }, 60_000);
});
