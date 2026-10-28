import { describe, expect, test } from "bun:test";
import type { PeopleStore } from "@thenetwork/platform";
import { addMember, call, connect, origin, PHONE_A, setup, tokenRequest } from "./harness.ts";

const PEON = "peon.biz";

describe("staff ban ends live MCP grants", () => {
  test("a pre-ban access token and refresh token stop working after people.ban (peon / non-custom-slop client)", async () => {
    const env = setup();
    await addMember(env, PHONE_A, [{ app: "peon", state: "active" }]);
    const { token, client } = await connect(env, PEON, PHONE_A);
    expect((await call(env, `${origin(PEON)}/mcp`, "check_status", {}, { token: token.access_token })).res.status).toBe(200);

    const personId = (await env.accounts.personFor(PHONE_A))!.id;
    await (env.people as PeopleStore).ban({
      id: "ban_grant_1",
      scope: "person",
      personId,
      phoneHash: env.accounts.phoneHash(PHONE_A),
      reason: "staff",
      reportId: null,
      bannedBy: "staff:1",
      at: env.clock.t,
    });
    expect(await env.accounts.banned(PHONE_A)).toBe(true);

    // Before the fix: peon's customSlopEligible short-circuit left this at 200.
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
});
