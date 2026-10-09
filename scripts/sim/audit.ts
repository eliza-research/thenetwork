// The audit block: regression gates for the P0 and P1 findings of the 2026-10-08 audit
// (docs/audit/2026-10-08-weaknesses.md) in network, platform, sites and deploy whose fix had no gate
// after the 2026-10-08 cleanup deleted the unit tests. The status of every finding, and which gate or
// security test proves it, is in docs/audit/2026-10-09-platform-status.md.
//
// Offline and deterministic: the ConsentNetwork in the NYC world (seed 3, 9 days, simulated
// reviewer), the network's trust and plans code, the console's web code (HTML sinks), the engine
// judge wiring, the four sites built into a scratch folder, the
// Cloudflare deploy guard (scripts/wrangler.sh) on commands it must refuse (they exit before wrangler
// runs, so nothing reaches Cloudflare), and the sites' API client against a fake fetch. Two Postgres
// parts, each on a throwaway database of its own on the dev cluster (:54339): the console's WebSocket
// re-check (it needs a real-mode source), and the NetworkService under a login that is only
// network_service (as production runs it), restarted. Blocking when the dev Postgres runs, tracked as
// skipped when it does not. Fakes only: a fake Blooio, phones +1 212 555 01xx.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DAY, HOUR, type MemberId, type RunRecord } from "../../packages/core/src/index.ts";
import { INTERESTS } from "../../packages/engine/src/packs/network/vocabulary.ts";
import { PolicyPersonaAgent, World } from "../../packages/sim/src/index.ts";
import { friendFactory, nycPersonas } from "../../packages/network/harness/index.ts";
import { ConsentNetwork } from "../../packages/network/src/index.ts";
import { planLedger } from "../../packages/network/src/plans.ts";
import { Trust } from "../../packages/network/src/trust.ts";
import { buildSite, DRAFT_MARKERS, SITES } from "../../sites/sites.ts";
import { DEFAULT_BACKEND_ORIGIN } from "../../sites/skills.config.ts";
import { DATA_DIR } from "../synthetic/common.ts";
import { Block, expect } from "./gate.ts";

type Msg = Extract<RunRecord, { type: "message" }>;
type Log = Extract<RunRecord, { type: "network_log" }>;
const logs = (r: RunRecord[], kind: string) => r.filter((x): x is Log => x.type === "network_log" && x.kind === kind);
const outbound = (r: RunRecord[]) => r.filter((x): x is Msg => x.type === "message" && x.msg.direction === "outbound" && !x.msg.system);
const REPO = join(import.meta.dir, "../..");

export async function auditBlock(b: Block): Promise<void> {
  await networkGates(b);
  await trustAndPlans(b);
  await consoleAndEngine(b);
  await sitesGates(b);
  await deployGuard(b);
  await consoleSockets(b);
  await serviceLogin(b);
}

// ---------------------------------------------------------------- the ConsentNetwork (NYC world)
async function networkGates(b: Block) {
  const seed = 3, days = 9;
  const personas = await nycPersonas();
  const start = (await Bun.file(`${DATA_DIR}/manifest.json`).json()).snapshotNow as number;
  const net = new ConsentNetwork({ seed, review: "auto" });
  const R: RunRecord[] = [];
  const w = new World({ seed, personas, days, start, writeLog: false, network: net, agent: new PolicyPersonaAgent(start), spawnFriend: friendFactory({ seed }), onRecord: r => R.push(r) });
  await w.begin();
  await w.advanceTo(start + (days - 1) * DAY);

  // The cast for the scripted part, chosen from what happened (deterministic for the seed).
  const now = w.clock.now();
  const met = [...net.opps.values()].find(o => !o.plan && o.meetingAt !== undefined && o.meetingAt < now && o.participants.length === 2
    && o.participants.every(p => o.contacted.has(p) && !net.member(p).minor && !net.isDeclined(p)));
  const adultsNow = net.memberList().filter(m => !m.minor && m.stage === "active" && !met?.participants.includes(m.id) && net.trust.level(m.id) === "ok").map(m => m.id);
  const [signal, teen] = adultsNow;
  const minorId = met?.participants[0], others = met?.participants.slice(1) ?? [];
  if (minorId) {
    // A member with no age on record (a member from before age attestation) says they are 12: the
    // Network declines and deletes them. Nothing else wrote the adults' safety record first.
    w.personaList().find(p => p.id === minorId)!.public.claimedAge = Number.NaN;
    net.member(minorId).age = Number.NaN;
    w.act({ do: "say", persona: minorId, text: "I am 12 years old" });
  }
  if (signal) w.act({ do: "say", persona: signal, text: "can we do something after school? my mom says i have to be home by 10 on school nights" });
  if (teen) w.act({ do: "say", persona: teen, text: "I'm 16" });
  await w.advanceTo(start + (days - 1) * DAY + 2 * HOUR);

  await b.run("network-consent-3 (P0): a member declined under the join age after a meeting: the adults they met keep a contact_with_minor case that survives the delete", () => {
    expect(minorId).toBeTruthy();
    expect(net.isDeclined(minorId!)).toBe(true);
    expect(net.memberList().some(m => m.id === minorId)).toBe(false);
    const after = logs(R, "minor_after_contact").filter(l => l.detail.memberId === minorId);
    const declined = logs(R, "join_declined").filter(l => l.t >= (after[0]?.t ?? Infinity));
    expect(after.length).toBeGreaterThan(0);
    expect(declined.length).toBeGreaterThan(0);
    // The safety record is written before the delete, and the delete keeps it (ids only).
    expect(R.indexOf(after[0]!)).toBeLessThan(R.indexOf(declined[0]!));
    for (const a of others) {
      const c = net.safetyCases().find(x => x.memberId === a && x.events.some(e => e.kind === "contact_with_minor"));
      expect([a, !!c]).toEqual([a, true]);
    }
    expect(net.safetyCases().some(c => c.memberId === minorId)).toBe(false);
  });

  await b.run("network-consent-10: a minor signal on an adult record is cleared only by an audited staff action; a stated minor age is never cleared", () => {
    expect(signal && teen).toBeTruthy();
    expect(net.member(signal!).minor).toBe(true);
    expect(net.member(teen!).minor).toBe(true);
    expect(net.clearMinorSignal(signal!, " ")).toEqual({ ok: false, reason: "actor_required" });
    expect(net.clearMinorSignal(teen!, "staff@sim")).toEqual({ ok: false, reason: "stated_minor" });
    expect(net.member(teen!).minor).toBe(true);
    expect(net.clearMinorSignal(signal!, "staff@sim", "a parent, not a teen")).toEqual({ ok: true });
    expect(net.member(signal!).minor).toBe(false);
    const audit = logs(R, "safety_action").filter(l => l.detail.action === "clear_minor_signal");
    expect(audit.map(l => [l.detail.memberId, l.detail.actor])).toEqual([[signal, "staff@sim"]]);
  });

  await w.advanceTo(w.end);
  await w.complete();

  await b.run("network-consent-5: after a probe \"no\", the pair is not probed again (no later opportunity holds the member and the person they declined)", () => {
    const parts = new Map<string, MemberId[]>();
    for (const l of logs(R, "probe_started")) parts.set(String((l.detail.proposal as { id: string }).id), (l.detail.proposal as { participants: MemberId[] }).participants);
    const noes = logs(R, "probe_answer").filter(l => l.detail.yes === false && !l.detail.expired && !l.detail.plan);
    expect(noes.length).toBeGreaterThan(5);
    const again: string[] = [];
    for (const n of noes) {
      const m = String(n.detail.memberId), others = (parts.get(String(n.detail.oppId)) ?? []).filter(x => x !== m);
      for (const l of logs(R, "probe_started").filter(l => l.t > n.t && !l.detail.plan)) {
        const p = (l.detail.proposal as { id: string; participants: MemberId[] });
        if (p.participants.includes(m) && others.some(o => p.participants.includes(o))) again.push(`${n.detail.oppId} -> ${p.id}`);
      }
    }
    expect(again).toEqual([]);
  });

  await b.run("network-consent-11: an interest named to a member in a probe or a reveal is one another participant marked shareable", () => {
    const shared = new Map<MemberId, Set<string>>();
    for (const f of w.snapshot().facets) if (f.scope === "shareable") for (const t of f.tags) { if (!shared.has(f.memberId)) shared.set(f.memberId, new Set()); shared.get(f.memberId)!.add(t); }
    const tagOf = (label: string) => INTERESTS.find(i => i.label.toLowerCase() === label.toLowerCase() || i.tag.replace(/_/g, " ") === label.toLowerCase())?.tag;
    const parts = new Map<string, MemberId[]>();
    for (const l of logs(R, "probe_started")) parts.set(String((l.detail.proposal as { id: string }).id), (l.detail.proposal as { participants: MemberId[] }).participants);
    let named = 0;
    const bad: string[] = [];
    for (const m of outbound(R).filter(m => ["probe", "proposal"].includes(String(m.msg.meta?.type)) && !/wants to/.test(m.msg.body))) {
      const opp = String((m.msg.meta?.probe as { key?: string } | undefined)?.key ?? m.msg.meta?.proposalId ?? "");
      const others = (parts.get(opp) ?? []).filter(x => x !== m.msg.memberId);
      if (!others.length) continue;
      for (const x of m.msg.body.matchAll(/\b(?:who's|both|are|they're) into (.+?)(?: too\b| and live\b|[,.;!?]|$)/g)) {
        const tag = tagOf(x[1]!.trim());
        if (!tag) continue;
        named++;
        if (!others.some(o => shared.get(o)?.has(tag))) bad.push(`${opp} to ${m.msg.memberId}: ${x[1]}`);
      }
    }
    expect(named).toBeGreaterThan(10);
    expect(bad).toEqual([]);
  });
}

// ---------------------------------------------------------------- trust and plans
async function trustAndPlans(b: Block) {
  await b.run("network-consent-7: one weight per reporter, none for a stranger, and a staff lift clears old corroboration", () => {
    const t = new Trust();
    const at = Date.UTC(2026, 9, 5);
    expect(t.report("x", "s1", at, { met: false }) + t.report("x", "s2", at, { met: false })).toBe(0);
    expect(t.report("x", "a", at, { met: true })).toBe(0);
    expect(t.report("x", "a", at + HOUR, { met: true })).toBe(0);
    expect(t.get("x").score).toBe(0);
    let n = 0;
    for (const by of ["b", "c", "d", "e", "f"]) n += t.report("x", by, at + 2 * HOUR, { met: true });
    expect(n).toBeGreaterThan(0);
    t.add("x", at + 3 * HOUR, "staff_hold", 100);
    expect(t.level("x")).toBe("hold");
    expect(t.lift("x", at + 4 * HOUR)).toBe(true);
    expect(t.get("x").reportsFrom.size).toBe(0);
    // After the lift, one new reporter alone does not count (no carried-over corroboration).
    expect(t.report("x", "g", at + 5 * HOUR, { met: true })).toBe(0);
    expect(t.level("x")).toBe("ok");
  });

  await b.run("attention-MISSED-1: a plan invite the member answered carries repliedAt, so the plan allowance is not spent for good", () => {
    const at = Date.UTC(2026, 9, 5);
    const l = planLedger("m1", [at, at + 2 * DAY, at + 4 * DAY], [at + HOUR, at + 2 * DAY + HOUR]);
    expect(l.map(e => e.repliedAt)).toEqual([at + HOUR, at + 2 * DAY + HOUR, undefined]);
  });
}

// ---------------------------------------------------------------- console page and engine wiring
async function consoleAndEngine(b: Block) {
  await b.run("observatory-1: no console web code hands a string to an HTML sink (tooltips and popups get textNode); the page has a CSP", () => {
    const dir = join(REPO, "packages/observatory/web");
    const bad: string[] = [];
    let tooltips = 0;
    for (const f of readdirSync(dir).filter(f => /\.(ts|tsx)$/.test(f))) {
      const lines = readFileSync(join(dir, f), "utf8").split("\n");
      lines.forEach((l, i) => {
        if (/^\s*\/\//.test(l)) return;
        if (/innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML|document\.write|createContextualFragment|\.html\(/.test(l)) bad.push(`${f}:${i + 1}`);
        for (const m of l.matchAll(/\.(bindTooltip|bindPopup|setTooltipContent|setPopupContent|setContent)\((.*)$/g)) {
          tooltips++;
          if (!/^(\(\)\s*=>\s*)?textNode\(/.test(m[2]!.trim())) bad.push(`${f}:${i + 1} ${m[1]}`);
        }
      });
    }
    expect(tooltips).toBeGreaterThanOrEqual(3);
    expect(bad).toEqual([]);
    expect(readFileSync(join(dir, "index.html"), "utf8")).toMatch(/http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self';/);
  });

  await b.run("matching-e2e-M2: without an engine LLM the Network reports the engine judge off (no run log claims a judge that never ran)", () => {
    expect(new ConsentNetwork({ seed: 1 }).effectiveEngineConfig().judge?.enabled).toBe(false);
  });
}

// ---------------------------------------------------------------- the four sites
async function sitesGates(b: Block) {
  const dir = mkdtempSync(join(tmpdir(), "audit-sites-"));
  const env = { ...process.env, DEPLOY_TARGET: "production", BACKEND_ORIGIN: undefined, MCP_URL: undefined, TURNSTILE_SITE_KEY: "0x4AAAAAAAsimauditkey" };
  const built: Record<string, { ok: boolean; logs: string[]; out: string }> = {};
  try {
    for (const s of SITES) { const out = join(dir, s.domain); built[s.domain] = { ...(await buildSite(s, out, env)), out }; }

    await b.run("sites-infra-10, -14: each production build ships _headers, robots.txt, SKILL.md and the router; no page says Draft", () => {
      for (const s of SITES) {
        const r = built[s.domain]!;
        expect([s.domain, r.ok, r.logs.filter(l => !l.startsWith("warning"))]).toEqual([s.domain, true, []]);
        for (const f of ["_headers", "robots.txt", "SKILL.md", "_worker.js", "_routes.json", "index.html", "terms.html", "privacy.html"]) expect([s.domain, f, existsSync(join(r.out, f))]).toEqual([s.domain, f, true]);
      }
    });

    await b.run("platform-5: every site's phone step renders the Turnstile widget with the build's site key (the production API refuses codes without a token)", () => {
      for (const s of SITES) {
        const page = readFileSync(join(built[s.domain]!.out, "join.html"), "utf8");
        expect([s.domain, page.includes('content="0x4AAAAAAAsimauditkey"') && page.includes("data-turnstile")]).toEqual([s.domain, true]);
      }
    });

    await b.run("sites-infra-14: a production build with draft legal text fails", async () => {
      const s = SITES.find(x => x.app === "slop")!;
      const copy = mkdtempSync(join(tmpdir(), "audit-draft-"));
      try {
        // A scratch site (no scripts) whose terms say "Draft. Not yet in effect."; the real files are not touched.
        const page = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body>${body}</body></html>`;
        await Bun.write(join(copy, "public", "index.html"), page("<p>slop.date</p>"));
        await Bun.write(join(copy, "public", "terms.html"), page("<p>Draft. Not yet in effect.</p>"));
        const draft = await buildSite({ ...s, src: join(copy, "public") }, join(copy, "dist"), env);
        expect(draft.ok).toBe(false);
        expect(draft.logs.join("\n")).toMatch(/draft legal text/);
        // The same scratch site without the marker builds: the refusal is the marker, nothing else.
        await Bun.write(join(copy, "public", "terms.html"), page("<p>Terms.</p>"));
        expect((await buildSite({ ...s, src: join(copy, "public") }, join(copy, "dist"), env)).ok).toBe(true);
        for (const x of SITES) expect([x.domain, DRAFT_MARKERS.some(m => m.test(readFileSync(join(x.src, "terms.html"), "utf8")))]).toEqual([x.domain, false]);
      } finally { rmSync(copy, { recursive: true, force: true }); }
    });

    await b.run("plugin-prototypes-26, platform-9: one SKILL.md per site, same backend, its own MCP URL; STOP stops every app and \"leave <site>\" one, in the skill and the SMS terms", () => {
      for (const s of SITES) {
        const r = built[s.domain]!;
        const skill = readFileSync(join(r.out, "SKILL.md"), "utf8");
        expect([s.domain, skill.includes(`https://${s.domain}/mcp`)]).toEqual([s.domain, true]);
        for (const o of SITES.filter(o => o.domain !== s.domain)) expect([s.domain, o.domain, skill.includes(`https://${o.domain}/mcp`)]).toEqual([s.domain, o.domain, false]);
        expect([s.domain, readFileSync(join(r.out, "_worker.js"), "utf8").includes(DEFAULT_BACKEND_ORIGIN)]).toEqual([s.domain, true]);
        expect([s.domain, /13 or older/i.test(skill) && /18 (and|or) older/i.test(skill)]).toEqual([s.domain, true]);
        if (s.app === "ntwrk") continue;
        expect([s.domain, /STOP[^\n]*every app/.test(skill) && skill.includes(`"leave ${s.domain}"`)]).toEqual([s.domain, true]);
        const sms = join(r.out, "sms-terms.html");
        if (existsSync(sms)) expect([s.domain, /STOP[\s\S]{0,120}(every|all) text/.test(readFileSync(sms, "utf8")) && readFileSync(sms, "utf8").includes(`leave ${s.domain}`)]).toEqual([s.domain, true]);
      }
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }

  await b.run("sites-infra-1: every POST from the sites' API client is JSON (settings stop and log out are not refused with 415)", async () => {
    const seen: { method: string; type: string | null; body: unknown }[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      seen.push({ method: init?.method ?? "GET", type: new Headers(init?.headers).get("content-type"), body: init?.body });
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;
    try {
      const { api } = await import("../../sites/shared/api.ts");
      await api.logout();
      await api.stop();
    } finally { globalThis.fetch = real; }
    expect(seen.length).toBe(2);
    for (const s of seen) { expect(s.type).toMatch(/^application\/json/); expect(typeof s.body).toBe("string"); }
  });
}

// ---------------------------------------------------------------- the Cloudflare deploy guard
async function deployGuard(b: Block) {
  await b.run("sites-infra-4: the deploy guard refuses every changing command, with flags (and flag values) before it, without NTWRK_ALLOW_DEPLOY", async () => {
    const refuse = [
      ["deploy"], ["--config", "x.toml", "deploy"], ["-c", "wrangler.toml", "deploy"], ["--env", "production", "deploy"],
      ["--some-new-flag", "deploy", "whoami"], ["deploy", "--dry-run", "--no-dry-run"], ["deploy", "--dry-run=false"],
      ["pages", "deploy", "dist", "--project-name", "slop-date", "--branch", "main"], ["pages", "project", "create", "x"],
      ["versions", "upload"], ["versions", "deploy"], ["secret", "put", "X"], ["pages", "secret", "put", "X"],
      ["kv", "key", "put", "k", "v"], ["r2", "object", "put", "b/k"], ["r2", "bucket", "create", "b"], ["d1", "execute", "db"],
      ["dev", "--remote"], ["pages", "dev", "dist", "--remote"], ["delete"], ["rollback"], ["triggers", "deploy"], ["queues", "create", "q"],
    ];
    const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: "audit-sim-no-account", NTWRK_ALLOW_DEPLOY: "" };
    const ran: string[] = [];
    for (const args of refuse) {
      const p = Bun.spawnSync(["bash", join(REPO, "scripts/wrangler.sh"), ...args], { env, stdout: "pipe", stderr: "pipe" });
      if (p.exitCode !== 3 || !/refusing to run/.test(p.stderr.toString())) ran.push(`${args.join(" ")} -> exit ${p.exitCode}`);
    }
    expect(ran).toEqual([]);
  });
}

// ---------------------------------------------------------------- the console's WebSockets (observatory-6)
async function consoleSockets(b: Block) {
  const { pgAvailable } = await import("../../packages/observatory/test/pg.ts");
  if (!pgAvailable) { b.track("observatory-6: skipped (no Postgres on this machine)", false); return; }
  const pg = await import("../../packages/platform/test/pg.ts");
  let url: string;
  try { url = await pg.migratedDb("simaudit"); } catch (e) { b.track("observatory-6: skipped (the dev Postgres did not start)", false, (e as Error).message.split("\n")[0]); return; }
  const { createServer, WS_FORBIDDEN } = await import("../../packages/observatory/src/server.ts");
  const audit = mkdtempSync(join(tmpdir(), "audit-console-"));
  const E = "sim-engineer-token-0000000000000000000", R = "sim-reviewer-token-0000000000000000000";
  const srv = await createServer({ port: 0, hostname: "127.0.0.1", mode: "game", tokens: `engineer@*:${E},reviewer@ntwrk:${R}`, real: { url, pollMs: 600_000 }, staffRolesUrl: false, peopleUrl: false, audit: { dir: audit }, development: false, socketCheckMs: 600_000 });
  const sockets: WebSocket[] = [];
  try {
    await b.run("observatory-6: a mode switch re-checks every open console socket: the engineer's (no role in real mode) is closed 4403, a reviewer's stays", async () => {
      const open = async (token: string) => {
        const r = await fetch(`${srv.url}/api/ws-ticket?app=ntwrk`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
        expect(r.status).toBe(200);
        const { ticket } = (await r.json()) as { ticket: string };
        const ws = new WebSocket(`${srv.url.replace(/^http/, "ws")}/ws?app=ntwrk&ticket=${ticket}`);
        sockets.push(ws);
        const closed = new Promise<number>(res => ws.addEventListener("close", e => res(e.code)));
        await new Promise<void>((res, rej) => { ws.addEventListener("message", () => res(), { once: true }); ws.addEventListener("error", () => rej(new Error("socket error"))); });
        return { ws, closed };
      };
      const engineer = await open(E), reviewer = await open(R);
      await srv.setMode("real");
      expect(await Promise.race([engineer.closed, Bun.sleep(5000).then(() => -1)])).toBe(WS_FORBIDDEN);
      expect(reviewer.ws.readyState).toBe(WebSocket.OPEN);
      // A new engineer socket in real mode is refused at the upgrade.
      const t = await fetch(`${srv.url}/api/ws-ticket?app=ntwrk`, { method: "POST", headers: { authorization: `Bearer ${E}` } });
      expect(t.status).toBe(403);
    });
  } finally {
    for (const ws of sockets) ws.close();
    await srv.stop();
    await pg.dropDb(url);
    rmSync(audit, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- the service under its own login (network-service-M1)
async function serviceLogin(b: Block) {
  const { pgAvailable } = await import("../../packages/observatory/test/pg.ts");
  if (!pgAvailable) { b.track("network-service-M1: skipped (no Postgres on this machine)", false); return; }
  const pg = await import("../../packages/platform/test/pg.ts");
  const { DEV_PG_PORT } = await import("../../packages/observatory/db/dev-pg.ts");
  const { SQL } = await import("bun");
  const { MINUTE, SimClock } = await import("../../packages/core/src/index.ts");
  const H = await import("./pipeline/harness.ts");
  let url: string;
  try { url = await pg.migratedDb("simauditsvc"); } catch (e) { b.track("network-service-M1: skipped (the dev Postgres did not start)", false, (e as Error).message.split("\n")[0]); return; }
  const role = `sim_audit_svc_${process.pid}`, password = "sim-audit-service-password-0000000";
  const clusterAdmin = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}/postgres`;
  const admin = new SQL({ url, max: 1 });
  const clock = new SimClock(H.START);
  const fake = new H.FakeBlooio(clock, "audit_msg");
  const log: string[] = [];
  const svcUrl = `postgres://${role}:${password}@localhost:${DEV_PG_PORT}/${new URL(url).pathname.slice(1)}`;
  let svc: InstanceType<typeof import("../../packages/network/service/service.ts").NetworkService> | undefined;
  try {
    // The production login (deploy/backend ensureServiceLogin): no superuser, no BYPASSRLS, only network_service.
    await admin.unsafe(`drop role if exists ${role}`).catch(() => {});
    await admin.unsafe(`create role ${role} login password '${password}' nosuperuser nobypassrls nocreaterole nocreatedb`);
    await admin.unsafe(`grant network_service to ${role}`);
    await admin.unsafe(`do $$ begin execute format('grant connect on database %I to ${role}', current_database()); end $$`);
    svc = H.pipelineService(svcUrl, clock, fake, "audit-a", {}, x => log.push(x));
    const say = async (from: string, text: string) => { const r = await H.post(svc!, H.signedRequest(clock, H.messageBody(clock, from, text))); clock.advance(MINUTE); await H.receipts(svc!, clock, fake); return r.result; };
    const A = "+12125550191", B = "+12125550192", C = "+12125550193";

    await b.run("network-service-M1, network-consent-12, plugin-prototypes-22: the service runs under a network_service-only login: joins, onboarding, an under-13 decline and STOP store their rows; a restart loads the state; a stated 16 reaches the person and the next app; an agent-submitted profile age too", async () => {
      await svc!.start();
      const said: string[] = [];
      for (const t of ["friends", "Ana, 29", "I love climbing and hiking, I live in Greenpoint", "Weekends, mostly. Greenpoint", "One-on-one is good."]) said.push(await say(A, t));
      for (const t of ["slop", "Bea, 30"]) said.push(await say(B, t));
      for (const t of ["friends", "Cy, 12"]) said.push(await say(C, t));
      await H.run(svc!, clock, fake, 30 * MINUTE);
      said.push(await say(B, "STOP"));
      expect(said).toEqual(["join_asked", "joined", "handled", "handled", "handled", "join_asked", "joined", "join_asked", "under_age", "handled"]);
      await svc!.close();
      // A new process on the same database, the same login.
      svc = H.pipelineService(svcUrl, clock, fake, "audit-b", {}, x => log.push(x));
      await svc.start();
      const rt = svc.runtimeFor("friends" as never)!;
      await rt.identities();
      const ana = rt.memberOf(A);
      expect(ana).toBeTruthy();
      expect(rt.memberOf(C)).toBeUndefined();
      expect(rt.net.memberList().some(m => m.id === ana)).toBe(true);
      expect(await admin`select app_id, count(*)::int as n from network.members group by 1 order by 1`).toEqual([{ app_id: "friends", n: 1 }, { app_id: "slop", n: 1 }]);
      expect((await admin`select id, jsonb_array_length(state->'members')::int as n from network.network_state where id in ('friends:nyc', 'slop:nyc') order by 1`).map((r: any) => r.n)).toEqual([1, 1]);
      expect((await admin`select state from platform.consent_events where e164 = ${B} and app_id is null`).map((r: any) => r.state)).toEqual(["opted_out"]);
      expect(fake.to(A).length).toBeGreaterThanOrEqual(4);
      expect(log.filter(l => /permission denied|row-level security|bypassrls/i.test(l))).toEqual([]);
      // network-consent-12: an age stated in chat reaches the person (the lowest age) and every app's member.
      said.length = 0;
      said.push(await say(A, "actually I'm 16, sorry"));
      said.push(await say(A, "slop"));
      said.push(await say(A, "Ana, 25"));
      const [person] = await admin`select p.lowest_age from platform.people p join platform.phone_identities i on i.person_id = p.id where i.e164 = ${A}`;
      expect(person?.lowest_age).toBe(16);
      expect(rt.net.member(ana!).minor).toBe(true);
      expect(said).toEqual(["handled", "join_asked", "joined"]);
      // Joining slop later as "25": the person's lowest age (16) wins; a minor on slop too, never matched.
      const srt = svc.runtimeFor("slop" as never)!;
      await srt.identities();
      const onSlop = srt.memberOf(A);
      expect(onSlop).toBeTruthy();
      expect([srt.net.member(onSlop!).minor, srt.net.member(onSlop!).age]).toEqual([true, 16]);
      expect((await admin`select age from network.members where app_id = 'friends' and id = ${ana!}`)[0].age).toBe(16);
      // plugin-prototypes-22 (the MCP connector): an age in a profile the person's own agent submits is read like a text.
      const D = "+12125550194";
      for (const t of ["peon", "Dee, 34"]) await say(D, t);
      const [dee] = await admin`select person_id from platform.phone_identities where e164 = ${D}`;
      expect(await svc.submitProfile(dee.person_id, "peon", D, "I'm 15 and I build robots after school")).toBe("accepted");
      expect((await admin`select lowest_age from platform.people where id = ${dee.person_id}`)[0].lowest_age).toBe(15);
      const prt = svc.runtimeFor("peon" as never)!;
      await prt.identities();
      expect(prt.net.member(prt.memberOf(D)!).minor).toBe(true);
      // The login really is held to row-level security: it sees no row without an app in the transaction.
      const raw = new SQL({ url: svcUrl, max: 1 });
      try { expect((await raw`select count(*)::int as n from network.members`)[0].n).toBe(0); } finally { await raw.close(); }
    });
  } finally {
    await svc?.close().catch(() => {});
    await admin.close();
    await pg.dropDb(url);
    const a = new SQL({ url: clusterAdmin, max: 1 });
    try { await a.unsafe(`drop role if exists ${role}`); } catch { /* the database drop may still hold it; the next run drops it */ } finally { await a.close(); }
  }
}
