// Synthetic dataset v1.2 invariants: the committed data validates, the validator has teeth for the
// new richness / source rules, and generation is deterministic from the seed.
import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATA_DIR, FILES, GENERATOR_VERSION, REPO, readJsonl, sha256, type FacetRecord, type HiddenTruthRecord, type MemberRecord } from "./common.ts";
import { loadPersonas, loadSnapshot } from "./load.ts";

const run = (args: string[]) => Bun.spawnSync(["bun", ...args], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
const tmp = () => mkdtempSync(join(tmpdir(), "synthetic-test-"));

function validate(dir: string): { exit: number; report: any } {
  const out = join(dir, "validation.out.json");
  const r = run(["scripts/synthetic/validate.ts", "--dir", dir, "--out", out]);
  return { exit: r.exitCode, report: JSON.parse(readFileSync(out, "utf8")) };
}
const failing = (rep: any) => rep.checks.filter((c: any) => !c.pass).map((c: any) => c.name).sort();

/** Copy the committed dataset, apply a mutation to one JSONL file, return the dir. */
function mutated<T>(file: string, f: (rows: T[]) => void): string {
  const dir = tmp();
  cpSync(DATA_DIR, dir, { recursive: true });
  const rows = readFileSync(join(dir, file), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l) as T);
  f(rows);
  writeFileSync(join(dir, file), rows.map(r => JSON.stringify(r)).join("\n") + "\n");
  return dir;
}

describe("synthetic v1 dataset (generator 1.2.0)", () => {
  test("committed data passes every validation check", () => {
    const dir = tmp();
    cpSync(DATA_DIR, dir, { recursive: true });
    const { exit, report } = validate(dir);
    expect(failing(report)).toEqual([]);
    expect(exit).toBe(0);
    const manifest = JSON.parse(readFileSync(join(DATA_DIR, FILES.manifest), "utf8"));
    expect(manifest.generatorVersion).toBe(GENERATOR_VERSION);
    expect(GENERATOR_VERSION).toBe("synthetic-gen 1.2.0");
    rmSync(dir, { recursive: true });
  }, 60_000);

  test("validator catches a shareable sensitive inference", () => {
    const dir = mutated<FacetRecord>(FILES.facets, rows => { const f = rows.find(r => r.sensitive)!; f.scope = "shareable"; });
    expect(failing(validate(dir).report)).toContain("sensitive_inferences_never_shareable");
    rmSync(dir, { recursive: true });
  }, 60_000);

  test("validator catches Gmail on a minor and facets from a source the member never connected", () => {
    const dir = mutated<MemberRecord>(FILES.members, rows => {
      const m = rows.find(r => r.segment === "minor")!;
      m.connectedSources = [...(m.connectedSources ?? []), { source: "gmail", link: "oauth", status: "connected", subject: "self", connectedAt: m.joinedAt, observations: 0 }];
      const a = rows.find(r => r.segment === "adult" && (r.connectedSources ?? []).some(s => s.observations > 0))!;
      a.connectedSources = a.connectedSources!.filter(s => s.observations === 0);
    });
    const f = failing(validate(dir).report);
    expect(f).toContain("minors_no_social_or_gmail_matching_facets");
    expect(f).toContain("known_facets_have_channel_no_hidden_leak");
    rmSync(dir, { recursive: true });
  }, 60_000);

  test("validator catches hidden truth leaking into a minimal member's known facets, and a non-unique canary", () => {
    const hidden = readFileSync(join(DATA_DIR, FILES.hidden), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l) as HiddenTruthRecord);
    const minimal = hidden.find(h => h.knowledge.richness === "minimal" && h.segment === "adult")!;
    const dir = mutated<FacetRecord>(FILES.facets, rows => {
      rows.push({ synthetic: true, id: `${minimal.memberId}:f99`, memberId: minimal.memberId, kind: "interest", value: minimal.hidden.interests[0]!, tags: [minimal.hidden.interests[0]!],
        scope: "matchable", provenance: "said", confidence: 0.8, source: "chat", observedAt: 0, inferred: false, confirmedByMember: true });
    });
    const withCanary = hidden.filter(h => h.hidden.privateDisclosure);
    const hdir = mutated<HiddenTruthRecord>(FILES.hidden, rows => { rows.find(r => r.memberId === withCanary[1]!.memberId)!.hidden.privateDisclosure!.canary = withCanary[0]!.hidden.privateDisclosure!.canary; });
    expect(failing(validate(dir).report)).toEqual(expect.arrayContaining(["richness_tier_distribution", "known_facets_have_channel_no_hidden_leak"]));
    expect(failing(validate(hdir).report)).toContain("canaries_agent_private_and_hidden_split");
    rmSync(dir, { recursive: true }); rmSync(hdir, { recursive: true });
  }, 60_000);

  test("deterministic from the seed: two --no-llm runs are byte-identical; structure matches the committed data", () => {
    const a = tmp(), b = tmp();
    for (const d of [a, b]) expect(run(["scripts/synthetic/generate.ts", "--no-llm", "--out", d]).exitCode).toBe(0);
    for (const f of [FILES.members, FILES.facets, FILES.intents, FILES.hidden, FILES.edges, FILES.presence])
      expect(sha256(readFileSync(join(a, f), "utf8"))).toBe(sha256(readFileSync(join(b, f), "utf8")));
    // Tiers, sources and source-facet truth labels do not depend on the LLM prose.
    const tiers = (dir: string) => readFileSync(join(dir, FILES.hidden), "utf8").split("\n").filter(Boolean).map(l => { const h = JSON.parse(l); return [h.memberId, h.knowledge.richness, h.knowledge.sources.map((s: any) => `${s.source}:${s.status}`).join(","), Object.keys(h.knowledge.observationTruth).length].join("|"); }).join("\n");
    expect(tiers(a)).toBe(tiers(DATA_DIR));
    rmSync(a, { recursive: true }); rmSync(b, { recursive: true });
  }, 60_000);

  test("loader: engine snapshot carries connectedSources + provenance detail, never truth labels; personas rebuild knowledge", async () => {
    const snap = await loadSnapshot();
    expect(snap.members.some(m => m.connectedSources?.length)).toBe(true);
    expect(snap.facets.every(f => f.source && typeof f.inferred === "boolean")).toBe(true);
    expect(JSON.stringify(snap)).not.toMatch(/observationTruth|wrong_inference|"richness"/);
    const ps = await loadPersonas();
    const facets = await readJsonl<FacetRecord>(join(DATA_DIR, FILES.facets));
    expect(ps.every(p => p.knowledge && p.hidden.richness === p.knowledge.richness)).toBe(true);
    expect(ps.reduce((n, p) => n + p.knowledge!.observations.length, 0)).toBe(facets.filter(f => f.source !== "chat").length);
  });
});
