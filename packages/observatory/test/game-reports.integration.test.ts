import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DAY, HOUR } from "@thenetwork/core";
import { createServer } from "../src/server.ts";
import { GameSource } from "../src/sources/game.ts";
import type { SafetyInfo } from "../src/types.ts";

test("game safety reports retain the Network's report identity, urgency and staff decision", async () => {
  const dir = await mkdtemp(join(tmpdir(), "game-reports-test-"));
  const token = "local-game-reports-test-0000000000";
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const server = await createServer({ port: 0, development: false, token, staffRolesUrl: false, peopleUrl: false,
    audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") },
    game: { seed: 7, days: 20, personas: 60, city: "nyc", network: "consent", engine: "engine-v1", pushMs: 3_600_000, tickMs: 3_600_000 },
  });
  try {
    const source = await server.source("game") as GameSource;
    const step = await fetch(`${server.url}/api/control`, { method: "POST", headers, body: JSON.stringify({ type: "step", ms: 14 * DAY }) });
    expect(step.status).toBe(200);
    expect((await step.json()).ok).toBe(true);
    const report = source.consent!.safetyReports().find(r => r.kind === "harassment")!;
    expect(report).toBeDefined();
    const read = async () => {
      const response = await fetch(`${server.url}/api/safety`, { headers });
      expect(response.status).toBe(200);
      return await response.json() as SafetyInfo;
    };
    const beforeRead = JSON.stringify(source.consent!.exportState());
    const safety = await read();
    const shown = safety.reports!.find(r => r.id === report.id)!;
    expect(shown).toBeDefined();
    expect(shown.kind).toBe("harassment");
    expect([shown.reporterId, shown.subjectId, shown.at, shown.status]).toEqual([report.reporterId, report.subjectId, report.at, "open"]);
    expect(shown.urgent).toBe(true);
    expect(shown.dueAt).toBe(report.at + HOUR);
    expect(shown.overdue).toBe(true);
    expect(JSON.stringify(source.consent!.exportState())).toBe(beforeRead);
    expect(source.consent!.dismissReport(report.id, "test-reviewer", "reviewed synthetic report").ok).toBe(true);
    const dismissed = (await read()).reports!.find(r => r.id === report.id)!;
    expect(dismissed.status).toBe("dismissed");
    expect(dismissed.overdue).toBe(false);
    expect(dismissed.kind).toBe("harassment");
  } finally {
    await server.stop();
    const owned = resolve(dir), parent = resolve(tmpdir()) + sep;
    if (!owned.startsWith(parent) || !owned.split(sep).pop()!.startsWith("game-reports-test-")) throw new Error("Unexpected temporary path");
    await rm(owned, { recursive: true, force: true });
  }
}, 120_000);
