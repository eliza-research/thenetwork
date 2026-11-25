import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DAY, HOUR } from "@thenetwork/core";
import { createServer } from "../src/server.ts";
import { GameSource } from "../src/sources/game.ts";
import type { MemberTimeline, ObsState, SystemEvent } from "../src/types.ts";

const long = (t: string) => t.padEnd(32, "-0123456789abcdef");
const TOK = { admin: long("adm-7c1e"), reviewer: long("rev-2b9d"), safety: long("saf-55aa"), analyst: long("ana-0f3c"), legacy: long("old-admin-9911") };

test("a report shows on the reported member's timeline for safety staff only", async () => {
  const dir = await mkdtemp(join(tmpdir(), "member-timeline-report-"));
  const server = await createServer({ port: 0, development: false, token: TOK.legacy,
    tokens: `admin:${TOK.admin},reviewer:${TOK.reviewer},safety:${TOK.safety},analyst:${TOK.analyst}`,
    staffRolesUrl: false, peopleUrl: false,
    audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") },
    game: { seed: 1, review: "human", pushMs: 3_600_000, tickMs: 3_600_000 },
  });
  try {
    const source = await server.source("game") as GameSource;
    const admin = { authorization: `Bearer ${TOK.admin}`, "content-type": "application/json" };
    const step = await fetch(`${server.url}/api/control`, { method: "POST", headers: admin, body: JSON.stringify({ type: "step", ms: DAY }) });
    expect(step.status).toBe(200);
    const network = source.consent!;
    const state = await (await fetch(`${server.url}/api/state`, { headers: admin })).json() as ObsState;
    const item = state.opportunities.find(o => o.state === "IN_REVIEW");
    expect(item).toBeDefined();
    const subjectId = item!.participants[0]!;
    const subject = source.state().members.find(m => m.id === subjectId)!;
    const st = network.exportState();
    const metBefore = (a: string, b: string) =>
      st.opps.some(o => o.meetingAt !== undefined && o.bookedTold?.includes(a) && o.bookedTold.includes(b))
      || st.interactions.some(x => x.participants.includes(a) && x.participants.includes(b) && (x.outcome === "completed" || x.outcome === "no_show"));
    const reporter = source.state().members.find(m => m.joined && m.id !== subjectId && !metBefore(m.id, subjectId));
    expect(reporter).toBeDefined();
    const ts = source.world.clock.now();
    await network.onInbound({ id: "member-timeline-report", memberId: reporter!.id, channel: "imessage", ts,
      body: `Report ${subject.name}, they harassed me.` });
    const report = network.safetyReports().find(r => r.kind === "harassment" && r.subjectId === subjectId);
    expect(report).toBeDefined();
    expect(source.inOpenReview(subjectId)).toBe(true);
    expect((await source.control({ type: "step", ms: 2 * HOUR })).ok).toBe(true);
    const reportRows = async (tok: string) => {
      const res = await fetch(`${server.url}/api/member/${subjectId}/timeline`, { headers: { authorization: `Bearer ${tok}` } });
      return { status: res.status, rows: res.status === 200 ? ((await res.json()) as MemberTimeline).entries.filter((e): e is { t: number; kind: "event"; event: SystemEvent } => e.kind === "event" && e.event.type === "report_received") : [] };
    };
    const adminRead = await reportRows(TOK.admin);
    expect(adminRead.status).toBe(200);
    expect(adminRead.rows).toHaveLength(1);
    expect(adminRead.rows[0]!.event.text).toBe(`${reporter!.name} reported ${subject.name}: harassment (by text, never met through us)`);
    const safetyRead = await reportRows(TOK.safety);
    expect(safetyRead.status).toBe(200);
    expect(safetyRead.rows).toHaveLength(1);
    const reviewerRead = await reportRows(TOK.reviewer);
    expect(reviewerRead.status).toBe(200);
    expect(reviewerRead.rows).toHaveLength(0);
    const analystRead = await reportRows(TOK.analyst);
    expect(analystRead.status).toBe(403);
  } finally {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
}, 120_000);
