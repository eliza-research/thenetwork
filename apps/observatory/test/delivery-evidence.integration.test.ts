import { expect, test } from "vitest";
import { SQL } from "../../../packages/core/src/runtime/postgres.ts";
import { createServer } from "../src/server.ts";
import type { AuditEntry, MemberDetail, MemberTimeline, OpportunityDetail, SearchHit } from "../src/types.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

test.skipIf(!pgAvailable)("the staff timeline shows only exact scoped delivery and leak evidence", async () => {
  // spec/consoleMemberView.md, "The timeline shows recorded delivery and leak evidence for the exact message"
  const url = await testDb();
  const sql = new SQL(url);
  const at = new Date(Date.UTC(2026, 9, 9, 16));
  const member = "delivery-member", other = "other-member", opportunity = "delivery-opportunity";
  const retiredBody = "synthetic withheld detail in prepared text";
  const note = "fixture operator note including a private marker";
  const providerError = "fixture detailed provider error";
  const releaseActor = "fixture safety reviewer";
  const address = "+12125550148";
  const safety = "fixture-ntwrk-safety-staff", friends = "fixture-friends-safety-staff";
  const audit: AuditEntry[] = [];
  let workspace: Awaited<ReturnType<typeof createServer>> | undefined;

  try {
    await sql`insert into network.members(app_id,id,name,age,home_city,home_area) values
      ('ntwrk',${member},'Ari',30,'nyc','Park Slope'),('ntwrk',${other},'Blair',30,'nyc','Park Slope')`;
    await sql`insert into network.network_state(id,state,saved_at,version) values ('ntwrk:nyc','{}',${at},1)`;
    await sql`insert into network.opportunities(app_id,id,kind,state,city,objective) values
      ('ntwrk',${opportunity},'intro','IN_REVIEW','nyc','Meet a local walking group')`;
    await sql`insert into network.participations(app_id,opportunity_id,member_id,role,status) values
      ('ntwrk',${opportunity},${member},'participant','invited')`;
    const messageRows = [
      ["waiting", "A possible outing", "pending", 0],
      ["quiet", "An evening outing", "deferred_quiet_hours", 0],
      ["blocked", retiredBody, "parked_leak_review", 0],
      ["released", "A reviewed update", "pending", 0],
      ["accepted", "A public venue update", "accepted", 1],
      ["different-body", "A scrubbed update", "accepted", 1],
      ["ineligible", "Another proposed outing", "suppressed_ineligible", 0],
      ["wrong-member", "A second proposed outing", "parked_leak_review", 0],
      ["wrong-app", "A third proposed outing", "parked_leak_review", 0],
      ["legacy", "An older update", null, 0],
    ] as const;

    for (const [id, body, status, attempts] of messageRows) {
      await sql`insert into network.messages(app_id,id,member_id,direction,body,status,opportunity_id,ts)
        values ('ntwrk',${id},${member},'outbound',${body},'queued',${opportunity},${at})`;
      if (!status) continue;
      await sql`insert into platform.outbound (app_id,id,member_id,line,kind,to_address,body,fingerprint,status,attempts,time_zone,
        note,last_error,leak_released_by,sent_at,next_attempt_at,created_at,updated_at)
        values (${id === "wrong-app" ? "friends" : "ntwrk"},${id},${id === "wrong-member" ? other : member},'fixture-line','transactional',
          ${address},${id === "different-body" ? "An earlier body" : body},${`fixture:${id}`},${status},${attempts},'America/New_York',
          ${id === "ineligible" ? "plan_availability_changed" : note},${providerError},${id === "released" ? releaseActor : null},
          ${attempts ? at : null},${at},${at},${at})`;
    }
    // An old fallback event remains visible without assigning its outcome to every message at the same instant.
    await sql`insert into network.events (app_id,at,actor_type,type,object_type,object_id,payload)
      values ('ntwrk',${at},'agent','guard_blocked','member',${member},${{ kind: "reply", fallback: true }}::jsonb)`;

    await sql.begin(async tx => {
      await tx`set local role network_observatory_ntwrk`;
      expect((await tx`select message_id from network.outbound_evidence_ntwrk order by message_id`).map(row => row.message_id))
        .toEqual(["accepted", "blocked", "different-body", "ineligible", "quiet", "released", "waiting"]);
    });
    await expect(sql.begin(async tx => {
      await tx`set local role network_observatory_ntwrk`;
      return tx`select note,to_address,last_error from platform.outbound`;
    })).rejects.toMatchObject({ code: "42501" });
    await expect(sql.begin(async tx => {
      await tx`set local role network_observatory_ntwrk`;
      return tx`select * from network.outbound_evidence_friends`;
    })).rejects.toMatchObject({ code: "42501" });

    const running = workspace = await createServer({ hostname: "127.0.0.1", port: 0, mode: "real", realOnly: true, platformEnv: "dev",
      tokens: `safety@ntwrk:${safety},safety@friends:${friends}`, minTokenLength: 10, staffRolesUrl: false, peopleUrl: false,
      real: { url, service: false }, audit: { kind: "file", async write(entry) { audit.push(entry); }, async list() { return audit; }, async close() {} },
    });
    const api = (path: string, token = safety, body?: object) => fetch(new URL(path, running.url), {
      method: body ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, "x-observatory-mode": "real", ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const timeline = `/api/member/${member}/timeline?app=ntwrk`;
    expect((await api(timeline, friends)).status).toBe(403);
    const response = await api(timeline);
    expect(response.status).toBe(200);
    const opened = await response.json() as MemberTimeline;
    const messages = Object.fromEntries(opened.entries.flatMap(entry => entry.kind === "message" ? [[entry.message.id, entry.message] as const] : []));
    expect(messages.waiting).toMatchObject({ status: "pending" });
    expect(messages.quiet).toMatchObject({ status: "deferred_quiet_hours", deliveryReason: "quiet_hours" });
    expect(messages.blocked).toMatchObject({ status: "parked_leak_review", deliveryReason: "leak_guard", guard: "blocked", body: "[outbound message withheld]" });
    expect(messages.released).toMatchObject({ status: "pending", guard: "released" });
    expect(messages.accepted).toMatchObject({ status: "accepted", deliveryReason: "accepted_by_provider", guard: "passed" });
    expect(messages.ineligible).toMatchObject({ status: "suppressed_ineligible", deliveryReason: "plan_availability_changed" });
    for (const id of ["legacy", "waiting", "quiet", "ineligible", "wrong-member", "wrong-app", "different-body"]) expect(messages[id]).not.toHaveProperty("guard");
    for (const id of ["legacy", "wrong-member", "wrong-app"]) expect(messages[id]).toMatchObject({ status: "queued" });
    const fallback = opened.entries.find(entry => entry.kind === "event" && entry.event.type === "guard_blocked");
    expect(fallback).toMatchObject({ event: { detail: { fallback: true } } });
    expect(fallback?.kind === "event" && fallback.event.text).not.toContain("was sent");
    for (const hidden of [retiredBody, note, providerError, address, releaseActor]) expect(JSON.stringify(opened)).not.toContain(hidden);

    const detail = await (await api(`/api/member/${member}?app=ntwrk`)).json() as MemberDetail;
    expect(detail.messages.find(row => row.id === "accepted")?.guard).toBe("passed");
    const opp = await (await api(`/api/opportunity/${opportunity}?app=ntwrk`)).json() as OpportunityDetail;
    expect(opp.messages.find(row => row.id === "blocked")).toMatchObject({ guard: "blocked", body: "[outbound message withheld]" });
    expect((await api("/api/reveal?app=ntwrk", safety, { memberId: member, reason: "Review the observed message", minutes: 5 })).status).toBe(200);
    expect(await (await api(timeline)).text()).not.toContain(retiredBody);
    const search = await (await api("/api/search?app=ntwrk&q=synthetic%20withheld%20detail")).json() as SearchHit[];
    expect(search).toEqual([]);
    expect(audit.some(row => row.action === "read_timeline" && row.app === "ntwrk" && row.targetId === member)).toBe(true);
    await sql`drop view network.outbound_evidence_ntwrk`;
    const unavailable = await api(timeline);
    expect(unavailable.status).toBe(500);
    expect(await unavailable.text()).not.toContain(retiredBody);
  } finally {
    await workspace?.stop();
    await sql.close();
    await dropTestDb();
  }
}, 60_000);
