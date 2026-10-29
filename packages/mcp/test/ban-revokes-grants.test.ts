import { describe, expect, test } from "bun:test";
import type { PeopleStore } from "@thenetwork/platform";
import { addMember, call, connect, origin, PHONE_A, setup, tokenRequest } from "./harness.ts";

const PEON = "peon.biz";

describe("staff ban eagerly revokes MCP OAuth grants", () => {
  test("revokeAllForKey kills pre-ban access and refresh tokens (eager table clear)", async () => {
    const env = setup();
    await addMember(env, PHONE_A, [{ app: "peon", state: "active" }]);
    const { token, client } = await connect(env, PEON, PHONE_A);
    expect((await call(env, `${origin(PEON)}/mcp`, "check_status", {}, { token: token.access_token })).res.status).toBe(200);

    const phoneKey = env.accounts.phoneHash(PHONE_A);
    const personId = (await env.accounts.personFor(PHONE_A))!.id;
    // Mirror NetworkService.ban → serve.ts onBan → revokeAllForKey (hashes, not cleartext).
    await (env.people as PeopleStore).ban({
      id: "ban_revoke_1",
      scope: "person",
      personId,
      phoneHash: phoneKey,
      reason: "staff",
      reportId: null,
      bannedBy: "staff:1",
      at: env.clock.t,
    });
    const revoked = await env.handler.revokeAllForKey(phoneKey, undefined, { detail: "staff ban" });
    expect(revoked).toBeGreaterThanOrEqual(1);
    expect(await env.store.grantsFor(phoneKey, "peon", env.clock.t)).toEqual([]);

    // Before the fix: ban left the grant live; Bearer still returned 200.
    const after = await call(env, `${origin(PEON)}/mcp`, "check_status", {}, { token: token.access_token });
    expect(after.res.status).toBe(401);

    const refreshed = await tokenRequest(env, PEON, {
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
      client_id: client.client_id,
    });
    expect(refreshed.res.status).toBe(400);
    expect(refreshed.body.error).toBe("invalid_grant");
  });

  test("revokeAllFor still forgets via phone number (leave/delete path unchanged)", async () => {
    const env = setup();
    await addMember(env, PHONE_A, [{ app: "peon", state: "active" }]);
    await connect(env, PEON, PHONE_A);
    expect(await env.handler.revokeAllFor(PHONE_A, "peon", { forget: true })).toBe(1);
    expect(await env.store.grantsFor(env.accounts.phoneHash(PHONE_A), "peon", env.clock.t)).toEqual([]);
  });
});
