import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DAY, HOUR } from "@thenetwork/core";
import { createServer } from "../src/server.ts";
import { GameSource } from "../src/sources/game.ts";
import type { OpportunityDetail, SystemEvent } from "../src/types.ts";

const long = (t: string) => t.padEnd(32, "-0123456789abcdef");
const TOK = { admin: long("adm-7c1e"), reviewer: long("rev-2b9d"), safety: long("saf-55aa"), analyst: long("ana-0f3c"), engineer: long("eng-4d8a"), legacy: long("old-admin-9911") };

test("a check-in report shows in its opportunity History for safety staff only", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opp-history-report-"));
  const server = await createServer({ port: 0, development: false, token: TOK.legacy,
    tokens: `admin:${TOK.admin},reviewer:${TOK.reviewer},safety:${TOK.safety},analyst:${TOK.analyst},engineer:${TOK.engineer}`,
    staffRolesUrl: false, peopleUrl: false,
    audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") },
    game: { seed: 7, days: 20, personas: 60, city: "nyc", network: "consent", engine: "engine-v1", pushMs: 3_600_000, tickMs: 3_600_000 },
  });
  try {
    const source = await server.source("game") as GameSource;
    const admin = { authorization: `Bearer ${TOK.admin}`, "content-type": "application/json" };
    const step = await fetch(`${server.url}/api/control`, { method: "POST", headers: admin, body: JSON.stringify({ type: "step", ms: 14 * DAY }) });
    expect(step.status).toBe(200);
    expect((await step.json()).ok).toBe(true);
    const network = source.consent!;
    const state = await (await fetch(`${server.url}/api/state`, { headers: admin })).json() as { opportunities: { id: string; participants: string[]; state: string }[] };
    const opp = state.opportunities.find(o => o.participants.length >= 2
      && !source.inOpenReview(o.participants[0]!) && !source.inOpenReview(o.participants[1]!))
      ?? state.opportunities.find(o => o.participants.length >= 2);
    expect(opp).toBeDefined();
    const [reporterId, subjectId] = opp!.participants;
    const reporter = source.state().members.find(m => m.id === reporterId)!;
    const subject = source.state().members.find(m => m.id === subjectId)!;
    (network as unknown as { fileReport: (reporter: string, subject: string, kind: string, o: { oppId: string; source: string; met: boolean }) => void })
      .fileReport(reporterId!, subjectId!, "unsafe", { oppId: opp!.id, source: "check_in", met: true });
    const report = network.safetyReports().find(r => r.kind === "unsafe" && r.subjectId === subjectId && r.opportunityId === opp!.id);
    expect(report).toBeDefined();
    expect((await source.control({ type: "step", ms: 2 * HOUR })).ok).toBe(true);
    const reportRows = async (tok: string) => {
      const res = await fetch(`${server.url}/api/opportunity/${opp!.id}`, { headers: { authorization: `Bearer ${tok}` } });
      return { status: res.status, rows: res.status === 200 ? ((await res.json()) as OpportunityDetail).events.filter((e: SystemEvent) => e.type === "report_received") : [] };
    };
    const safetyRead = await reportRows(TOK.safety);
    expect(safetyRead.status).toBe(200);
    expect(safetyRead.rows).toHaveLength(1);
    expect(safetyRead.rows[0]!.text).toContain(reporter.name);
    expect(safetyRead.rows[0]!.text).toContain(subject.name);
    expect(safetyRead.rows[0]!.text).toContain("unsafe");
    const adminRead = await reportRows(TOK.admin);
    expect(adminRead.status).toBe(200);
    expect(adminRead.rows).toHaveLength(1);
    const reviewerRead = await reportRows(TOK.reviewer);
    expect(reviewerRead.status).toBe(200);
    expect(reviewerRead.rows).toHaveLength(0);
    const engineerRead = await reportRows(TOK.engineer);
    expect(engineerRead.status).toBe(200);
    expect(engineerRead.rows).toHaveLength(0);
    const analystRead = await reportRows(TOK.analyst);
    expect(analystRead.status).toBe(200);
    expect(analystRead.rows).toHaveLength(0);
    const safetyApi = await fetch(`${server.url}/api/safety`, { headers: { authorization: `Bearer ${TOK.reviewer}` } });
    expect(safetyApi.status).toBe(403);
  } finally {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
}, 120_000);
