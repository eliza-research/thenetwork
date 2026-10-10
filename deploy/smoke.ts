// Smoke check for one deployed site (or a local `wrangler dev`). Read-only GETs, no secrets.
//   bun run deploy/smoke.ts https://slop-date-site.example.workers.dev slop          # static files
//   bun run deploy/smoke.ts https://ntwrk.party ntwrk --api                            # plus /api/app
// Exits 1 with one line per failed check. CI runs it after every deploy (deploy-sites.yml).

const SKILL: Record<string, string> = { ntwrk: "ntwrk-party", slop: "slop-date", peon: "peon-biz", friends: "friends-help" };

export interface Check { name: string; ok: boolean; detail: string }

export async function smoke(base: string, app: string, opts: { api?: boolean; fetchFn?: typeof fetch } = {}): Promise<Check[]> {
  const f = opts.fetchFn ?? fetch;
  const origin = base.replace(/\/+$/, "");
  const skill = SKILL[app];
  if (!skill) throw new Error(`unknown app ${app}`);
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail = "") => checks.push({ name, ok, detail });
  const get = async (path: string) => {
    try {
      const res = await f(origin + path, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
      return { res, body: await res.text() };
    } catch (e) {
      return { res: undefined, body: String(e) };
    }
  };

  const home = await get("/");
  add("GET / is 200 HTML", home.res?.status === 200 && /text\/html/.test(home.res.headers.get("content-type") ?? ""), String(home.res?.status));
  add("/ has the security headers", !!home.res?.headers.get("content-security-policy")?.includes("frame-ancestors 'none'") && home.res?.headers.get("x-content-type-options") === "nosniff", home.res?.headers.get("content-security-policy") ?? "none");

  const md = await get("/SKILL.md");
  add("GET /SKILL.md is 200 markdown", md.res?.status === 200 && /markdown|text\/plain/.test(md.res.headers.get("content-type") ?? ""), `${md.res?.status} ${md.res?.headers.get("content-type")}`);
  add("/SKILL.md names this site's skill", md.body.includes(`name: ${skill}\n`) && !md.body.includes("{{"), md.body.slice(0, 60));

  const idx = await get("/.well-known/agent-skills/index.json");
  let names: string[] = [];
  try {
    names = (JSON.parse(idx.body) as { skills: { name: string }[] }).skills.map((s) => s.name);
  } catch {
    /* reported below */
  }
  add("skills index lists this skill", idx.res?.status === 200 && names.includes(skill), `${idx.res?.status} ${names.join(",")}`);
  const canonical = await get(`/.well-known/agent-skills/${skill}/SKILL.md`);
  add("/SKILL.md equals the canonical copy", canonical.res?.status === 200 && canonical.body === md.body, String(canonical.res?.status));

  for (const p of ["/privacy", "/terms", "/support", "/join", "/settings"]) {
    const r = await get(p);
    add(`GET ${p} is 200`, r.res?.status === 200, String(r.res?.status));
  }
  const missing = await get("/no-such-page-smoke");
  add("an unknown page is 404", missing.res?.status === 404, String(missing.res?.status));

  if (opts.api) {
    const a = await get("/api/app");
    let id = "";
    try {
      id = (JSON.parse(a.body) as { id?: string }).id ?? "";
    } catch {
      /* reported below */
    }
    add("GET /api/app answers JSON for this app", a.res?.status === 200 && id === app, `${a.res?.status} ${a.body.slice(0, 80)}`);
  }
  return checks;
}

if (import.meta.main) {
  const [base, app, ...rest] = process.argv.slice(2);
  if (!base || !app) {
    console.error("usage: bun run deploy/smoke.ts <origin> <ntwrk|slop|peon|friends> [--api]");
    process.exit(2);
  }
  const checks = await smoke(base, app, { api: rest.includes("--api") });
  for (const c of checks) console.log(`${c.ok ? "ok  " : "FAIL"} ${c.name}${c.ok ? "" : `  (${c.detail})`}`);
  process.exit(checks.every((c) => c.ok) ? 0 : 1);
}
