// The Agent Skills files (sites/skills/<name>/SKILL.md; docs/research/2026-10-08-skills-plugins-deploy.md
// 2.1 and 2.8): valid frontmatter, the sections a person and an agent need, the same backend in every
// skill, ages equal to the platform registry, nothing private from another app, and the copies the
// build serves (/SKILL.md, /.well-known/agent-skills/<name>/SKILL.md, index.json digests).
//   bun test sites
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APPS } from "../../packages/platform/src/apps.ts";
import { SITES, SKILLS_DIR, buildSite, skillText, type Site } from "../sites.ts";
import { DEFAULT_BACKEND_ORIGIN, DEFAULT_MCP_URL, mcpUrlFor, skillsConfig } from "../skills.config.ts";

const ENV = { ...process.env, BACKEND_ORIGIN: "", MCP_URL: "" };
const cfg = skillsConfig(ENV);
const tmp = mkdtempSync(join(tmpdir(), "skills-test-"));
const out = (s: Site) => join(tmp, s.domain);

interface Parsed { fm: Record<string, unknown>; body: string; raw: string }
function parse(raw: string): Parsed {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error("no frontmatter");
  return { fm: Bun.YAML.parse(m[1]!) as Record<string, unknown>, body: m[2]!, raw };
}
const skill = (s: Site) => parse(skillText(s.skill, ENV));

beforeAll(async () => {
  for (const s of SITES) {
    const r = await buildSite(s, out(s), ENV);
    if (!r.ok) throw new Error(`build failed for ${s.domain}: ${r.logs.join("\n")}`);
  }
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

test("one skill folder per site, and nothing else", () => {
  expect(readdirSync(SKILLS_DIR).sort()).toEqual(SITES.map((s) => s.skill).sort());
});

test("the config defaults to the one shared backend", () => {
  expect(cfg).toEqual({ BACKEND_ORIGIN: DEFAULT_BACKEND_ORIGIN, MCP_URL: DEFAULT_MCP_URL });
  expect(DEFAULT_BACKEND_ORIGIN).toBe("https://api.ntwrk.love");
  expect(skillsConfig({ BACKEND_ORIGIN: "https://staging.example/" })).toEqual({ BACKEND_ORIGIN: "https://staging.example", MCP_URL: DEFAULT_MCP_URL });
  // Each site is its own MCP resource (packages/mcp binds a client to the site's app); the backend origin names no app.
  expect(mcpUrlFor("slop.date", {})).toBe("https://slop.date/mcp");
  expect(mcpUrlFor("peon.biz", { MCP_URL: "https://pr-1-{domain}.example/mcp" })).toBe("https://pr-1-peon.biz.example/mcp");
  expect(() => skillsConfig({ MCP_URL: "https://api.ntwrk.love/mcp" })).toThrow("{domain}");
  expect(() => skillsConfig({ BACKEND_ORIGIN: "http://api.example" })).toThrow("https");
});

describe.each(SITES)("$skill", (s) => {
  test("frontmatter is valid for the Agent Skills spec, Anthropic and OpenAI", () => {
    const { fm } = skill(s);
    expect(Object.keys(fm).sort()).toEqual(["compatibility", "description", "license", "metadata", "name"]);
    const name = fm.name as string;
    expect(name).toBe(s.skill);
    expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name).not.toMatch(/claude|anthropic/);
    const d = fm.description as string;
    expect(typeof d).toBe("string");
    expect(d.length).toBeGreaterThan(0);
    expect(d.length).toBeLessThanOrEqual(1024);
    expect(d).not.toMatch(/[<>]/);
    expect(d).toMatch(/Never signs anyone up/);
    expect((fm.compatibility as string).length).toBeLessThanOrEqual(500);
    for (const [k, v] of Object.entries(fm.metadata as Record<string, unknown>)) expect(typeof v, `metadata.${k}`).toBe("string");
  });

  test("names the one shared backend and MCP server, and its own app", () => {
    const { fm, body } = skill(s);
    const meta = fm.metadata as Record<string, string>;
    expect(meta.app).toBe(s.app);
    expect(meta.site).toBe(`https://${s.domain}`);
    expect(meta.backend).toBe(cfg.BACKEND_ORIGIN);
    expect(meta.mcp).toBe(`https://${s.domain}/mcp`);
    expect(body).toContain(cfg.BACKEND_ORIGIN);
    expect(body).toContain(`https://${s.domain}/mcp`);
    expect(body).not.toContain(`${cfg.BACKEND_ORIGIN}/mcp`);
    expect(body).toContain("All of these apps are powered by The Network");
  });

  test("covers sign-up, intent, eligibility, consent, privacy, allowed and forbidden actions, support", () => {
    const { body } = skill(s);
    expect(body.split("\n").length).toBeLessThan(500);
    for (const h of [/^## What the person is signing up for$/m, /^## Who can (use it|join)$/m, /^## How (a person joins|joining works)/m, /^## Consent rules$/m,
      /^## What you may do$/m, /^## What you must never do$/m, /^## Privacy across apps$/m, /^## Stop, leave and delete$/m, /^## Support$/m]) {
      expect(body, String(h)).toMatch(h);
    }
    expect(body).toContain("verification code");
    expect(body).toMatch(/Never sign up anyone else/);
    expect(body).toMatch(/verif(y|ies) (their|its) own phone|sign in, they do it in their own browser/);
    expect(body).not.toMatch(/I (will|can) sign you up|send me (the|your) code|tell me (the|your) code/i);
    // Agent-first sign-up (founder decision 10): collect the profile, one link for the phone, then submit_profile.
    expect(body).toContain(`https://${s.domain}/join?via=agent`);
    expect(body).toMatch(/submit_profile/);
    expect(body).not.toMatch(/one MCP server at/);
    expect(body).toContain(`https://${s.domain}/support`);
    expect(body).toContain(`https://${s.domain}/privacy`);
  });

  test("ages and keywords equal the platform registry", () => {
    const { body } = skill(s);
    const app = APPS[s.app];
    expect(body).toContain(`${app.minJoinAge} or older`);
    expect(body).toContain(`${app.minMatchAge} and older`);
    for (const m of body.matchAll(/\b(\d{1,2}) (?:or|and) older\b/g)) expect([app.minJoinAge, app.minMatchAge]).toContain(Number(m[1]));
    expect(body).toMatch(/13 to 17/);
    expect(body).toMatch(/never match|never matched|never matches/);
    if (s.app !== "ntwrk") {
      expect(body).toContain(`"${s.app}"`);
      expect(body).toContain(`"${app.domain}"`);
      expect(body).toContain(`https://${s.domain}/join`);
      expect(body).toContain(`"leave ${app.domain}"`);
    }
  });

  test("holds no other app's private data, and no phone number or other email", () => {
    const { raw } = skill(s);
    if (s.app === "peon" || s.app === "friends") expect(raw).not.toMatch(/orientation|photo|rating|dating preference/i);
    if (s.app !== "peon" && s.app !== "ntwrk") expect(raw).not.toMatch(/salary|social security|demographic/i);
    expect(raw).not.toMatch(/\+?1?[ (.-]*\d{3}[ ).-]*\d{3}[ .-]*\d{4}/);
    for (const m of raw.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) expect(m[0]).toBe("help@ntwrk.love");
  });

  test("every site URL in the skill is a page that exists (or the site's /mcp, which the router forwards)", () => {
    const { raw } = skill(s);
    for (const m of raw.matchAll(/https:\/\/(ntwrk\.love|slop\.date|peon\.biz|friends\.help)(\/[a-z-]*)?/g)) {
      if (m[2] === "/mcp") continue;
      const page = (m[2] ?? "/").slice(1) || "index";
      expect(existsSync(join(import.meta.dir, "..", m[1]!, "public", `${page}.html`)), m[0]).toBe(true);
    }
  });

  test("the build serves byte-identical copies and a matching digest", () => {
    const top = readFileSync(join(out(s), "SKILL.md"));
    const canonical = readFileSync(join(out(s), ".well-known/agent-skills", s.skill, "SKILL.md"));
    expect(top.equals(canonical)).toBe(true);
    expect(top.toString()).not.toContain("{{");
    const index = JSON.parse(readFileSync(join(out(s), ".well-known/agent-skills/index.json"), "utf8")) as { $schema: string; skills: { name: string; type: string; description: string; url: string; digest: string }[] };
    expect(index.$schema).toBe("https://schemas.agentskills.io/discovery/0.2.0/schema.json");
    const names = index.skills.map((x) => x.name);
    // ntwrk.love is the hub and lists every app's skill; each app lists only its own.
    expect(names).toEqual(s.app === "ntwrk" ? SITES.map((x) => x.skill) : [s.skill]);
    for (const e of index.skills) {
      const file = readFileSync(join(out(s), ".well-known/agent-skills", e.name, "SKILL.md"));
      expect(e.type).toBe("skill-md");
      expect(e.url).toBe(`/.well-known/agent-skills/${e.name}/SKILL.md`);
      expect(e.digest).toBe(`sha256:${createHash("sha256").update(file).digest("hex")}`);
      expect(e.description).toBe(parse(file.toString()).fm.description as string);
    }
  });
});

test("every built skill names the same backend", () => {
  const backends = new Set(SITES.map((s) => (skill(s).fm.metadata as Record<string, string>).backend));
  expect([...backends]).toEqual([cfg.BACKEND_ORIGIN]);
});

test("slop.date says it is not in the public OpenAI plugin, and photos are adults only", () => {
  const slop = SITES.find((s) => s.app === "slop")!;
  const { raw } = skill(slop);
  expect(raw).toContain("slop.date is not part of The Network's public OpenAI plugin");
  expect(raw).toMatch(/Photos[^.]*adults\s+\(18 or older\) only/);
  // Founder decision 9: no ID check (the old text promised "verified adults").
  expect(raw).not.toMatch(/verified adults/);
  expect(raw).toContain("never shown to anyone");
});
