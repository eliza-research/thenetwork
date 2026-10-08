// The two plugin packages in plugins/: the OpenAI plugin never carries slop.date, every snapshot
// equals a fresh build from sites/skills, and each manifest points at an MCP endpoint this server serves.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { build, OPENAI_MCP_URL, PLUGINS, siteMcpUrl } from "../../../plugins/build.ts";
import { rpc, setup } from "./harness.ts";

const ROOT = join(import.meta.dir, "..", "..", "..", "plugins");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const walk = (dir: string): string[] => readdirSync(dir).flatMap(f => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));

function frontmatter(md: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(md);
  if (!m) throw new Error("no frontmatter");
  return Object.fromEntries(m[1]!.split("\n").filter(l => /^[a-z]+:/.test(l)).map(l => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]));
}

describe("plugin packages", () => {
  test("every snapshot equals a fresh build from sites/skills", () => {
    for (const [rel, text] of build()) expect(read(rel), rel).toBe(text);
    for (const [plugin, p] of Object.entries(PLUGINS)) expect(readdirSync(join(ROOT, plugin, "skills")).sort()).toEqual([...p.skills].sort());
  });

  test("the OpenAI plugin has ntwrk, peon and friends only, and no slop.date anywhere", () => {
    expect(PLUGINS.openai.skills).toEqual(["ntwrk-love", "peon-biz", "friends-help"]);
    for (const f of walk(join(ROOT, "openai")).filter(f => !f.endsWith(".png"))) expect(readFileSync(f, "utf8"), f).not.toMatch(/slop|dating/i);
    const mcp = JSON.parse(read("openai/mcp.json"));
    expect(Object.values(mcp.mcpServers)).toEqual([{ type: "streamable-http", url: OPENAI_MCP_URL }]);
    const ui = JSON.parse(read("openai/plugin.json")).extensions["com.openai"].interface;
    for (const k of ["websiteURL", "privacyPolicyURL", "termsOfServiceURL"]) expect(ui[k]).toMatch(/^https:\/\/ntwrk\.love(\/|$)/);
    for (const k of ["composerIcon", "logo"]) {
      const png = readFileSync(join(ROOT, "openai", ui[k]));
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)];
      expect(w).toBe(h);
      expect(w).toBeGreaterThanOrEqual(48);
    }
    expect(existsSync(join(ROOT, "openai", ".app.json"))).toBe(false); // OpenAI refuses ZIPs with app references or hooks
  });

  test("the Claude plugin has all four skills and one MCP server per site", () => {
    const mcp = JSON.parse(read("claude/.mcp.json")).mcpServers as Record<string, { type: string; url: string }>;
    expect(Object.values(mcp).map(s => s.url).sort()).toEqual(PLUGINS.claude.skills.map(siteMcpUrl).sort());
    for (const s of Object.values(mcp)) expect(s.type).toBe("http");
    expect(JSON.parse(read("claude/.claude-plugin/plugin.json")).name).not.toMatch(/claude|anthropic/);
  });

  test("skill frontmatter follows the Agent Skills rules", () => {
    for (const [plugin, p] of Object.entries(PLUGINS)) {
      for (const skill of p.skills) {
        const fm = frontmatter(read(`${plugin}/skills/${skill}/SKILL.md`));
        expect(fm.name).toBe(skill);
        expect(fm.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(fm.description!.length).toBeGreaterThan(0);
        expect(fm.description!.length).toBeLessThanOrEqual(1024);
        expect(fm.description).not.toMatch(/[<>]/);
      }
    }
  });

  test("the OpenAI endpoint the plugin names serves no slop", async () => {
    const env = setup();
    const list = await rpc(env, OPENAI_MCP_URL, "tools/list");
    expect(list.res.status).toBe(200);
    expect(list.text).not.toMatch(/slop/i);
    for (const url of PLUGINS.claude.skills.map(siteMcpUrl)) expect((await rpc(env, url, "tools/list")).res.status).toBe(200);
  });
});
