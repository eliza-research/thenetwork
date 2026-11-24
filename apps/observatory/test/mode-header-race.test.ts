// SD-286: a staff action carries the mode its page shows (x-observatory-mode). The server checks that
// header, then reads the body and writes the audit row. When an admin switches the mode in that time,
// the action must still run in the mode that the check saw, and its audit rows must name that mode.
// Skipped without Postgres (real mode reads a test database).
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DAY } from "@thenetwork/core";
import { createServer, MODE_HEADER, type ObservatoryServer } from "../src/server.ts";
import { FileAudit, type AuditSink } from "../src/staff.ts";
import type { AuditEntry, ObsState } from "../src/types.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

const T = 300_000;
const TOKEN = "mode-race-admin-token".padEnd(32, "-0123456789abcdef");

describe.skipIf(!pgAvailable)("the mode header check and a mode switch during the request (Postgres)", () => {
  let dir: string;
  let obs: ObservatoryServer;
  let holdReviewRequested = false;
  let onReviewAuditStarted: (() => void) | undefined;
  let releaseReviewAudit: (() => void) | undefined;
  const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
  const call = (path: string, init: RequestInit = {}) => fetch(obs.url + path, { ...init, headers: { ...headers, ...Object.fromEntries(new Headers(init.headers)) } });

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "obs-mode-race-"));
    const inner = new FileAudit(join(dir, "audit"));
    const audit: AuditSink = {
      kind: "file",
      async write(e) {
        if (holdReviewRequested && e.action === "review" && (e.detail as { phase?: string })?.phase === "requested") {
          holdReviewRequested = false;
          onReviewAuditStarted?.();
          await new Promise<void>(resolve => { releaseReviewAudit = resolve; });
        }
        await inner.write(e);
      },
      list: q => inner.list(q),
      close: () => inner.close(),
    };
    obs = await createServer({
      port: 0, development: false, token: TOKEN, mode: "game", audit, lab: { dir: join(dir, "lab") }, peopleUrl: false, staffRolesUrl: false,
      game: { seed: 1, review: "human", pushMs: 3_600_000, tickMs: 3_600_000 }, real: { url: await testDb(), pollMs: 3_600_000, pushMs: 3_600_000, service: false },
    });
    expect((await call("/api/control", { method: "POST", body: JSON.stringify({ type: "step", ms: DAY }) })).status).toBe(200);
  }, T);
  afterAll(async () => {
    releaseReviewAudit?.();
    await obs?.stop(); await dropTestDb();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  test("a review sent from the game page runs in game mode when the console switches to real while the handler awaits", async () => {
    const s = await (await call("/api/state")).json() as ObsState;
    const item = s.opportunities.find(o => o.state === "IN_REVIEW")!;
    expect(item).toBeDefined();
    // Hold the review's "requested" audit write (after guard() checked x-observatory-mode) until the mode switches.
    holdReviewRequested = true;
    const auditStarted = new Promise<void>(resolve => { onReviewAuditStarted = resolve; });
    const pending = call("/api/control", {
      method: "POST",
      headers: { [MODE_HEADER]: "game" },
      body: JSON.stringify({ type: "review", oppId: item.id, decision: "approve", secondsSpent: 20 }),
    });
    await auditStarted;
    const sw = await call("/api/mode", { method: "POST", body: JSON.stringify({ mode: "real" }) });
    expect(await sw.json()).toEqual({ ok: true, mode: "real" });
    releaseReviewAudit!();
    const r = await pending;
    const out = await r.json() as { ok: boolean; code?: string };
    expect(out).toMatchObject({ ok: true });
    expect(r.status).toBe(200);
    // The audit rows of the review name the mode the action ran in.
    const rows = await obs.audit.list({ limit: 100 });
    const review = rows.filter(e => e.action === "review" && e.targetId === item.id).reverse();
    expect(review.map(e => [(e.detail as { phase?: string })?.phase, e.mode])).toEqual([["requested", "game"], ["result", "game"]]);
  }, T);
});
