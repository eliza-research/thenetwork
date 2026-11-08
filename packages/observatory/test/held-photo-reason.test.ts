// SD-467 (gap-console GC8): the console's own store (web/store.ts heldPhoto) against the console server in
// real mode and a local fake of the Network service. The review reason goes in a request header, and a
// header value must be a byte string. A reason with a character above 0xFF (a curly apostrophe, a dash
// from text substitution, a non-Latin script) must still load the selected photo, and the audit log must
// keep the reason as the staff member typed it.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Window } from "happy-dom";
import { createServer, type ObservatoryServer } from "../src/server.ts";
import type { AuditEntry } from "../src/types.ts";

const T = 120_000;
const long = (t: string) => t.padEnd(32, "-0123456789abcdef");
const TOK = { admin: long("adm-reason"), safety: long("saf-reason") };
const ID = "pri_" + "d".repeat(32);
const REASON = "Checked the sender’s consent — Zoë 確認";
const photoCalls: (string | null)[] = [];
let fake: ReturnType<typeof Bun.serve>;
let obs: ObservatoryServer;
let dir: string;
const keep = { NETWORK_DATABASE_URL: process.env.NETWORK_DATABASE_URL, DATABASE_URL: process.env.DATABASE_URL };

beforeAll(async () => {
  delete process.env.NETWORK_DATABASE_URL; delete process.env.DATABASE_URL;
  fake = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === `/staff/relay/${ID}/photo`) {
        photoCalls.push(req.headers.get("x-network-reason"));
        return new Response(Uint8Array.from([255, 216, 255, 218, 0, 2, 1, 255, 217]), { headers: { "content-type": "image/jpeg", "x-network-photo-review-token": `${Date.now() + 60_000}.${"a".repeat(64)}` } });
      }
      return Response.json({ error: "no route" }, { status: 404 });
    },
  });
  dir = await mkdtemp(join(tmpdir(), "obs-held-reason-"));
  obs = await createServer({
    port: 0, development: false, mode: "real", audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") }, peopleUrl: false, staffRolesUrl: false,
    tokens: `admin:${TOK.admin},safety@slop:${TOK.safety}`,
    real: { url: undefined, pollMs: 3_600_000, pushMs: 3_600_000, service: { url: fake.url.href, token: long("console-svc") } },
  });
}, T);
afterAll(async () => {
  await obs?.stop(); fake?.stop(true);
  for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  if (dir) await rm(dir, { recursive: true, force: true });
});

test("a held photo loads with a reason that has characters above 0xFF, and the audit keeps that reason", async () => {
  const window = new Window({ url: obs.url }), prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({ window, document: window.document, navigator: window.navigator, location: window.location, history: window.history, localStorage: window.localStorage, sessionStorage: window.sessionStorage })) {
    prior.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  }
  window.sessionStorage.setItem("obs.token", TOK.safety);
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = ((input: any, init?: RequestInit) => nativeFetch(typeof input === "string" ? new URL(input, obs.url) : input, init)) as typeof fetch;
  try {
    const { store } = await import("../web/store.ts");
    store.mode = "real"; store.app = "slop";
    const result = await store.heldPhoto(ID, REASON);
    expect(result.error).toBeUndefined();
    expect(result.blob?.type).toBe("image/jpeg");
    expect(photoCalls).toHaveLength(1);
  } finally {
    globalThis.fetch = nativeFetch; await window.happyDOM.close();
    for (const [name, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as any)[name]; }
  }
  const audited = await (await fetch(`${obs.url}/api/audit?app=slop`, { headers: { authorization: `Bearer ${TOK.admin}` } })).json() as { entries: AuditEntry[] };
  expect(audited.entries.some(e => e.action === "read_relay_photo" && e.reason === REASON)).toBe(true);
}, T);
