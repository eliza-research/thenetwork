// The seed prompt: pass1-screen-v2 exactly as committed (git HEAD), with CITATION_RULES interpolated.
// Read with `git show` so the other agent's uncommitted judge-v2 edits in the working tree are not used.
const gitShow = (path: string, rev = "HEAD") => {
  const r = Bun.spawnSync(["git", "show", `${rev}:${path}`], { cwd: `${import.meta.dir}/../../..` });
  if (r.exitCode !== 0) throw new Error(`git show ${rev}:${path} failed`);
  return r.stdout.toString();
};

export const SEED_VERSION = "pass1-screen-v2";

export function seedPrompt(rev = "HEAD"): string {
  const screen = gitShow("packages/engine/src/judgeScreen.ts", rev);
  const common = gitShow("packages/engine/src/judgeCommon.ts", rev);
  const m = screen.match(/export const SCREEN_SYSTEM = `([\s\S]*?)`;/);
  const c = common.match(/export const CITATION_RULES = `([\s\S]*?)`;/);
  if (!m || !c) throw new Error("could not extract the committed pass-1 prompt");
  if (!screen.includes(`SCREEN_PROMPT_VERSION = "${SEED_VERSION}"`)) throw new Error(`HEAD pass-1 prompt is not ${SEED_VERSION}`);
  return m[1]!.replace("${CITATION_RULES}", c[1]!);
}

/** The fixed output contract: the optimizer may not change it (parsers and key-order checks depend on it). */
export const CONTRACT_LINE = `Return ONLY a JSON object: {"reasoning":string,"cited_facts":[...],"dealbreaker":bool,"dealbreaker_reason":string,"verdict":"yes"|"no","match_probability":number,"accept_probability":{"P1":number,...},"member_why":string}`;

/** Hard-policy lines that every candidate must keep verbatim. */
export const POLICY_LINES = [
  "Everyone involved in ANY role (attending or connector) must be 18 or older.",
  "Never propose people when one has blocked the other.",
  "Romance/dating configurations require every attending person to have romance_opt_in=true.",
];
