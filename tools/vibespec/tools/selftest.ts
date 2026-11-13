// Does each check catch the kind of mistake it exists for? Every case builds a
// scratch project, from this project's own spec or from the small specs in
// tools/fixtures/, breaks one thing, and asserts which stage of `check` fails.
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { LIB_FILE, parseProofFile, readVerdict, splice } from "./prove.ts";
import { nodesOf } from "./studio/doc.ts";
import { startStudio } from "./studio/server.ts";
import { acceptContracts, acceptReviews, check, checkVerifiedSource, expandListHelpers, gen, init, parseSpec, pending, pendingContracts, readSpecs, replay, show, type Result } from "./spec.ts";

const project = path.join(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(project, file), "utf8");
const F = "`".repeat(3);
const roots: string[] = [];
const nodeModules = (function find(dir: string): string {
  const here = path.join(dir, "node_modules");
  return fs.existsSync(here) ? here : dir === path.dirname(dir) ? assert.fail("no node_modules: run npm install") : find(path.dirname(dir));
})(project);
after(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

/** A scratch project holding the given files. */
function scratch(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "spec-selftest-"));
  roots.push(root);
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  if (Object.keys(files).some((f) => /^(src|test)\//.test(f)) && !files["tsconfig.json"]) {
    fs.writeFileSync(path.join(root, "tsconfig.json"), read("tsconfig.json"));
    fs.symlinkSync(nodeModules, path.join(root, "node_modules"), "dir");
  }
  return root;
}
/** A scratch project whose specs are the named fixtures, each changed by `edit` if it is given. */
const fixtures = (names: string[], edit: (files: Record<string, string>) => void = () => {}) => {
  const files = Object.fromEntries(names.map((n) => [`spec/${n}.md`, read(`tools/fixtures/${n}.md`)]));
  edit(files);
  return scratch(files);
};
/** A scratch project with one spec made of a single rule. */
const oneRule = (name: string, heading: string, quint: string) => scratch({ [`spec/${name}.md`]: `# T\n\n## Story\n\n### ${heading}\n\n${F}quint\n${quint}\n${F}\n` });

// This project's spec and src with whatever awaits sign-off here accepted, checked once
// so that every copy starts with its cache: an edit then re-runs only what it changes.
const pristine = scratch({});
for (const dir of ["spec", "src", "test", "tsconfig.json"]) fs.cpSync(path.join(project, dir), path.join(pristine, dir), { recursive: true });
fs.symlinkSync(nodeModules, path.join(pristine, "node_modules"), "dir");
for (const spec of readSpecs(pristine)) acceptReviews(pristine, spec);
acceptContracts(pristine);
const pristineCheck = await check(pristine);
assert.equal(pristineCheck.ok, true, pristineCheck.results.map(show).join("\n"));

/** A copy of the pristine project with `edit` applied to one file. */
function copyOfProject(file?: string, edit: (text: string) => string = (s) => s): string {
  const root = scratch({});
  fs.cpSync(pristine, root, { recursive: true });
  if (!file) return root;
  const target = path.join(root, file);
  const before = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  const changed = edit(before);
  assert.notEqual(changed, before, "the edit must change the file");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, changed);
  return root;
}

/** Check a project: the stages that failed, and what a stage said that matches a pattern. */
async function run(root: string, accept: false | "reviews" | "unproved" = false) {
  const { results, next } = await check(root, accept);
  const text = results.map(show).join("\n");
  return {
    text,
    next,
    failed: [...new Set(results.filter((r) => !r.ok).map((r) => r.stage))],
    said: (stage: Result["stage"], pattern: RegExp) => results.find((r) => r.stage === stage && pattern.test(`${r.summary}\n${r.detail}`)),
  };
}
const failedStages = async (file: string, edit: (text: string) => string) => (await run(copyOfProject(file, edit))).failed;
const pendingItems = (root: string) => readSpecs(root).flatMap((spec) => pending(root, spec).map((p) => `${p.where.split("  ")[1]}: ${p.status}${p.note ?? ""}`));
/** Run a fresh CLI process so toolchain fingerprints cannot carry over from another invocation. */
const runCli = (script: string, root: string, ...args: string[]) => new Promise<{ status: number; stdout: string; stderr: string }>((done) =>
  execFile(process.execPath, [script, ...args], { cwd: root, maxBuffer: 1 << 26 }, (e, stdout, stderr) => done({ status: e ? Number(e.code) : 0, stdout, stderr })));
const unguarded = (s: string) => s.replace("o.status == Draft and o.units > 0", "o.status == Draft");
const notInductive = (s: string) => s.replace(/### Drafts and cancelled orders hold no money[\s\S]*?```\n\n/, "");

describe("each check catches its own kind of mistake", { concurrency: true }, () => {
  test("a fresh spec with enum and bool parameters and an unguarded transition passes everything but review", async () => {
    const root = fixtures(["door"]);
    const { failed, text } = await run(root);
    assert.deepEqual(failed, ["review"], text);
    assert.match(fs.readFileSync(path.join(root, "gen/proof/door.log"), "utf8"), /Dafny auditor completed/);
  });

  test("a missing guard is found by simulation, as a trace that the same seed gives again, and the later stages say they were skipped", async () => {
    const root = copyOfProject("spec/order.md", unguarded);
    const [first, again] = [await run(root), await run(root)];
    const trace = first.said("always", /./);
    assert.equal(trace?.ok, false, first.text);
    assert.match(trace!.detail, /seed \d+; to simulate again: npx quint run gen\/order\.run\.qnt .* --seed \d+/);
    assert.equal(again.said("always", /./)?.detail, trace!.detail, "the same harness gives the same trace");
    assert.ok(first.said("skipped", /^types, proof and tests: /), first.text);
    assert.match(first.next, /^always \(spec\/order\.md\) is the first ✗/);
  });

  test("a rule set that holds in simulation but is not inductive is caught by the proof, and the deleted rule awaits review", async () => {
    const { failed, said, text } = await run(copyOfProject("spec/order.md", notInductive));
    assert.deepEqual(failed, ["proof", "review"], text);
    assert.ok(said("review", /removed or renamed/), text);
  });

  test("rules too strict to ever reach a goal are caught by a `sometimes` rule", async () => {
    const failed = await failedStages("spec/order.md", (s) => s.replace("o.paid + amount <= o.due", "o.paid + amount < o.due"));
    assert.ok(failed.includes("sometimes"), failed.join());
  });

  test("a guard that never allows its event is caught, although every rule holds of the event trivially", async () => {
    // Cancelling refunds every payment, so a reopen that needs money paid can never happen.
    const { failed, text, said } = await run(copyOfProject("spec/order.md", (s) => s.replace("canReopen(o: Order): bool = o.status == Cancelled", "canReopen(o: Order): bool = o.status == Cancelled and o.paid > 0")));
    assert.ok(failed.includes("sometimes"), text);
    assert.ok(said("sometimes", /reopen in .* never happened: its guard canReopen refused it/), text);
  });

  test("a guard that needs values the simulator does not try says which to define", async () => {
    const { text, said } = await run(copyOfProject("spec/order.md", (s) => s.replace("o.status == Pending and amount > 0 and neverMoreThanPaid", "o.status == Pending and amount > 6 and neverMoreThanPaid")));
    assert.ok(said("sometimes", /takeBack in .* never happened: .*define amountValues/), text);
    assert.ok(!/\bpay in .* never happened/.test(text), text);
  });

  test("a guard that never refuses its event is reported without failing", async () => {
    // Every reachable lamp has counted its flips, so this guard restates a rule and restricts nothing.
    const { failed, text, said } = await run(fixtures(["lamp"], (f) => {
      f["spec/lamp.md"] = f["spec/lamp.md"].replace("pure def toggle(", "pure def canToggle(l: Lamp): bool = l.flips >= 0\npure def toggle(");
    }));
    assert.deepEqual(failed, ["review"], text);
    assert.ok(said("sometimes", /never seen to refuse it .*: canToggle\b/), text);
  });

  test("prose edited without the model is flagged for review, and accept records it only while every other stage passes", async () => {
    const reworded = (s: string) => s.replace("Every unit costs the same", "Each unit has one price");
    const root = copyOfProject("spec/order.md", reworded);
    assert.deepEqual((await run(root)).failed, ["review"]);
    assert.deepEqual((await run(root, "reviews")).failed, []);
    assert.deepEqual((await run(copyOfProject("spec/order.md", (s) => unguarded(reworded(s))), "reviews")).failed, ["always", "review"]);
  });

  test("a rule with no formal half is flagged", async () => {
    const failed = await failedStages("spec/order.md", (s) => s + "\n### Refunds arrive within three days\n\nNot yet modelled.\n");
    assert.deepEqual(failed, ["review"]);
  });

  test("Quint outside the supported subset, or that the translator cannot render faithfully, is refused", async () => {
    const refused: [string, (s: string) => string][] = [
      ["an operator outside the subset", (s) => s.replace("pure val unitPrice = 5", "pure val unitPrice = 5^1")],
      ["integer beyond 2^53", (s) => s.replace("pure val unitPrice = 5", "pure val unitPrice = 9007199254740993")],
      ["parameter named like a variant", (s) => s.replace("canCancel(o: Order): bool = o.status == Pending", "canCancel(o: Order): bool = o.status == Pending\npure def isIt(o: Order, Draft: Status): bool = o.status == Draft")],
      ["rule name with the wrong capital", (s) => s.replace(/alwaysPaidWithinDue/g, "alwayspaidWithinDue")],
      ["TypeScript keyword as a name", (s) => s.replace(/\bcancel\b/g, "delete").replace(/canCancel/g, "canDelete")],
      ["parameter that collides with the harness's state variable", (s) => s.replace(/\bamount\b/g, "state")],
      ["duplicate rule heading", (s) => s.replace("### An order can be cancelled", "### A pending order can be cancelled, refunding every payment")],
    ];
    for (const [what, edit] of refused) assert.deepEqual(await failedStages("spec/order.md", edit), ["model"], what);
  });

  test("names and constructs that would be translated wrongly are refused", async () => {
    const refused: [string, string, RegExp][] = [
      ["a type named like a generated one", "type Event = { n: int }\npure val initial: Event = { n: 0 }", /cannot be used as a name/],
      ["a definition named like a JavaScript global", "pure val initial: int = 0\npure def Number(n: int): int = n", /cannot be used as a name/],
      ["a set of two computed members", "pure val initial: int = 0\npure def pair(a: int, b: int): int = Set(a, b).size()", /could hold the same value twice/],
      ["a variant field called tag", "type P = A({ tag: int }) | B\npure val initial: int = 0\npure def tick(n: int): int = n", /cannot be called `tag`/],
      ["a match binder used as a whole value", "type N = { n: int }\ntype P = A(N) | B\npure val initial: int = 0\npure def g(r: N): int = r.n\npure def f(p: P): int = match p { | A(x) => g(x) | _ => 0 }\npure def tick(n: int): int = n", /is what a match arm carries/],
      ["state declared by hand", "pure val initial: int = 0\nvar n: int", /only types, imports, `pure val` and `pure def` belong in a spec/],
    ];
    for (const [what, quint, message] of refused) {
      const { said, text } = await run(oneRule("t", "A rule", quint));
      assert.equal(said("model", message)?.ok, false, `${what}\n${text}`);
    }
  });

  test("a rule written as a `pure val` is refused rather than generated as a constant, and a constant named alike is not", async () => {
    const { said, text } = await run(oneRule("t", "A rule", "pure val initial: int = 0\npure val alwaysNever = false"));
    assert.equal(said("model", /is a `pure def` with parameters/)?.ok, false, text);
    const constant = await run(oneRule("t", "A rule", "pure val stepLimit = 3\npure def lawPositive(k: int): bool = stepLimit > 0"));
    assert.ok(!constant.failed.includes("model"), constant.text);
  });

  test("a comment or string left open at the end of a quint block is refused, so prose can never become model", async () => {
    // Prose is tangled as `// …`; inside an open block comment, `// */ code` would be code that no review or cache key sees as such.
    const { said, text } = await run(copyOfProject("spec/order.md", (s) => s.replace("pure val unitPrice = 5", "pure val unitPrice = 5\n/*")));
    assert.equal(said("model", /a comment is still open at the end of this quint block/)?.ok, false, text);
  });

  test("who sent an event travels beside it, a guard takes only what it uses, a step rule sees the event, and deep goals are found", async () => {
    const vault = (edit: (s: string) => string = (s) => s) => fixtures(["vault"], (f) => { f["spec/vault.md"] = edit(f["spec/vault.md"]); });
    const root = vault();
    const ok = await run(root);
    assert.deepEqual(ok.failed, ["review"], ok.text);
    assert.ok(ok.said("sometimes", /sometimesLate is reachable/), ok.text); // thirty ticks: beyond a trace of 20 events
    const gen = await import(path.join(root, "gen/vault.ts"));
    assert.deepEqual(gen.parseEvent({ type: "open", by: "Owner" }), { type: "open" });
    assert.equal(gen.enabled(gen.initial, { type: "open" }, "Guest"), false);
    assert.equal(gen.step(gen.initial, { type: "relabel", label: "a" }, "Owner").label, "a");
    // A counterexample shows each event with only what it changed.
    const broken = await run(vault((s) => s.replace("{ ...v, open: false }", "{ ...v, open: true }")));
    assert.ok(broken.said("always", /a step breaks[\s\S]*\n\s+close\s+-> open = true\n/), broken.text);
    const stray = await run(vault((s) => s.replace("canRelabel(v: Vault, by: Actor): bool = by", "canRelabel(v: Vault, who: Actor): bool = who")));
    assert.ok(stray.said("model", /canRelabel: `who` must be a parameter of relabel/), stray.text);
  });

  test("a rule broken only on the way to a `sometimes` goal is still reported", async () => {
    // Only the witness search goes deep enough: the goal is three steps away and the break is on the way.
    const quint = "pure val initial: int = 0\npure def up(n: int): int = n + 1\npure def canUp(n: int): bool = n < 5\npure def alwaysBelowThree(n: int): bool = n < 3\npure def sometimesFour(n: int): bool = n == 4";
    const { failed, text } = await run(oneRule("t", "Counting", quint));
    assert.ok(failed.includes("always"), text);
    assert.ok(!failed.includes("sometimes") || failed.includes("always"), text);
  });

  test("hand-written code that changes what it is checked against is refused or flagged", async () => {
    const reexport = await failedStages("src/ledger.ts", (s) => s + '\nexport * from "./app.ts";\n');
    assert.ok(reexport.includes("proof"), reexport.join());
    const { said, text } = await run(copyOfProject("src/ledger.ts", (s) => s.replace(/(\/\/@ ensures)/, "//@ requires true\n$1")));
    assert.ok(said("proof", /^src-ledger\.ts: .*under 2 \/\/@ requires/), text);
  });

  test("the application's types and tests are checked", async () => {
    assert.ok((await failedStages("src/app.ts", (s) => s + "\nconst wrong: number = \"x\";\n")).includes("types"));
    const failing = await run(copyOfProject("test/app.test.ts", (s) => s + '\ntest("fails", () => { throw new Error("no"); });\n'));
    assert.ok(failing.failed.includes("tests"), failing.text);
    const untyped = copyOfProject();
    fs.rmSync(path.join(untyped, "tsconfig.json"));
    assert.ok((await run(untyped)).failed.includes("types"));
  });

  test("Markdown the tools would read differently from a viewer is refused or read as a viewer does", async () => {
    const cr = await failedStages("spec/order.md", (s) => s.replace("Every unit costs the same", "Every unit costs the same\rpure val sneaky = 1"));
    assert.deepEqual(cr, ["model"]);
    // A fence with an info string does not close a quint block, so what follows is still Quint (and here not valid Quint).
    const fence = await failedStages("spec/order.md", (s) => s.replace("pure val unitPrice = 5", "pure val unitPrice = 5\n```text\nnot quint"));
    assert.ok(fence.includes("model"), fence.join());
  });

  test("duplicate story headings are rejected instead of sharing review state", async () => {
    const text = `# Duplicate\n\n## Story\n\n### First\n\n${F}quint\npure val first = 1\n${F}\n\n## Story\n\n### Second\n\n${F}quint\npure val second = 2\n${F}\n`;
    const { said, text: result } = await run(scratch({ "spec/duplicate.md": text }));
    assert.equal(said("model", /duplicate story/)?.ok, false, result);
  });

  test("a story whose title starts another story's title still needs rules of its own", async () => {
    const story = "\n## Story: Wrap\n\n> As a shopper, I want my order wrapped.\n\n## Story: Wrap / gifts\n\n### Gifts are wrapped\n\n```quint\npure def lawWrapped(n: int): bool = true\n```\n";
    const { said, text } = await run(copyOfProject("spec/order.md", (s) => s + story));
    assert.ok(said("review", /  Story: Wrap\n\s+story has no rules/), text);
  });

  test("a machine whose state holds a library's type can be imported under a name", async () => {
    const spec = (title: string, quint: string) => `# ${title}\n\n## Story\n\n### ${title}\n\n${F}quint\n${quint}\n${F}\n`;
    const root = scratch({
      "spec/lib.md": spec("Library", "type T = { n: int }\npure def lawZeroIsZero(k: int): bool = k * 0 == 0"),
      "spec/mach.md": spec("Machine", 'import lib.* from "./lib"\ntype St = { t: T }\npure val initial: St = { t: { n: 0 } }\npure def bump(s: St): St = { t: { n: s.t.n + 1 } }'),
      "spec/sys.md": spec("System", 'import mach as M from "./mach"\ntype Sys = { a: M::St }\npure val initial: Sys = { a: M::initial }\npure def go(s: Sys): Sys = { a: M::bump(s.a) }'),
    });
    const { failed, said, text } = await run(root);
    assert.deepEqual(failed, ["review"], text);
    assert.ok(said("proof", /^sys\.ts: all \d+ obligations proved/), text);
  });

  test("simulator sample sets match real parameters and stay outside generated code", async () => {
    const base = "type S = { n: int }\npure val initial: S = { n: 0 }\npure def canAdd(s: S, amount: int): bool = amount > 0\npure def add(s: S, amount: int): S = { n: s.n + amount }";
    const cases: [string, string, RegExp][] = [
      ["a sample of the wrong type", 'pure val amountValues = Set("bad")\n' + base, /amountValues.*holds.*parameter amount/],
      ["an unused sample set", "pure val typoValues = Set(1)\n" + base, /no parameter is named typo/],
      ["a sample set used at runtime", "pure val amountValues = Set(1)\n" + base + "\npure def total(k: int): int = amountValues.size()", /amountValues.*(simulat|runtime|sample)/],
    ];
    const results = await Promise.all(cases.map(([, quint]) => run(oneRule("sample", "Samples", quint))));
    cases.forEach(([what, , message], i) => assert.equal(results[i].said("model", message)?.ok, false, `${what}\n${results[i].text}`));
  });

  test("unsupported or ambiguous shapes are refused before TypeScript chooses a different meaning", async () => {
    const cases: [string, string, RegExp][] = [
      ["identical record shapes", "type A = { n: int }\ntype B = { n: int }\npure def convert(a: A): B = { n: a.n }", /have the same fields/],
      ["a definition with no parameters", "pure def one(): int = 1", /parameter/],
      ["two declarations on one line", "pure val first = 1 pure val second = 2", /declaration|own line|rule/],
      ["an initial state without a transition", "pure val initial: int = 0", /transition/],
      ["a set of records", "type A = { n: int }\npure def count(xs: Set[A]): int = xs.size()", /set|Set/],
      ["a map into records", "pure def records(xs: Set[int]): Set[{ n: int }] = xs.map(x => { n: x })", /set|Set|record/],
    ];
    const results = await Promise.all(cases.map(([, quint]) => run(oneRule("shape", "Shapes", quint))));
    cases.forEach(([what, , message], i) => assert.equal(results[i].said("model", message)?.ok, false, `${what}\n${results[i].text}`));
  });

  test("nested set samples stay bounded and an inner lambda may shadow a match binder", async () => {
    const root = oneRule("nested", "Nested values", "type P = A({ xs: List[int] }) | B\npure def sum(p: P): int = match p { | A(x) => x.xs.foldl(0, (n, x) => n + x) | _ => 0 }\npure def lawSum(k: int): bool = sum(A({ xs: List(1, 2) })) == 3\npure def lawCount(xs: List[Set[int]]): bool = xs.length() >= 0\npure def zeros(n: int): Set[int] = Set(n * 0)\npure def lawZeros(n: int): bool = zeros(n).contains(0)");
    const { failed, text } = await run(root);
    assert.deepEqual(failed, ["review"], text);
  });

  test("a locally chosen enum keeps its Quint type in the generated proof", async () => {
    const root = oneRule("choice", "Choose", "type Choice = Left | Right\npure def use(c: Choice): int = if (c == Left) 1 else 2\npure def chosen(b: bool): int =\n  val c = if (b) Left else Right\n  use(c)\npure def lawChosen(b: bool): bool = chosen(b) == (if (b) 1 else 2)");
    const { failed, text } = await run(root);
    assert.deepEqual(failed, ["review"], text);
  });

  test("a transition and its guard bind a second state-shaped parameter identically during replay", async () => {
    const root = oneRule("copy", "Copy", "pure val initial: int = 0\npure def canCopy(n: int, source: int): bool = n <= source\npure def copy(n: int, source: int): int = source\npure def alwaysNonnegative(n: int): bool = n >= 0");
    const { failed, text } = await run(root);
    assert.deepEqual(failed, ["review"], text);
  });

  test("a law over a reachable state is checked beyond the initial state", async () => {
    const root = fixtures(["lamp"], (f) => { f["spec/lamp.md"] += `\n### No flips\n\n${F}quint\npure def lawZero(l: Lamp): bool = l.flips == 0\n${F}\n`; });
    const { said, text } = await run(root);
    assert.equal(said("always", /^the law .* is false/)?.ok, false, text);
    assert.ok(!text.includes("the simulator could not run"), text);
  });

  test("a quint block indented inside a list is still part of the model", async () => {
    const failed = await failedStages("spec/order.md", (s) => s + "\n### Nothing is ever fine\n\n- because:\n\n  ```quint\n  pure def alwaysBogus(o: Order): bool = false\n  ```\n");
    assert.ok(failed.includes("always"), failed.join());
  });

  test("a story with no rules is flagged for translation", async () => {
    const failed = await failedStages("spec/order.md", (s) => s + "\n## Story: Gift wrap\n\n> As a shopper, I want my order wrapped.\n");
    assert.deepEqual(failed, ["review"]);
  });

  test("lists, nested helpers, an imported library, laws, step rules and the proof ledger work together", async () => {
    const shop = (edit?: (files: Record<string, string>) => void) => fixtures(["lib", "shop"], edit);
    // The nested helpers (some inside some inside every) agree between Quint and TypeScript, and simulation passes.
    const plain = await run(shop());
    assert.deepEqual(plain.failed, ["proof", "review"], plain.text);
    assert.ok(plain.said("proof", /not proved/), plain.text);
    // Once the unproved obligations are recorded, only the review is left.
    // Hand-written code proved against the shop says that it rests on what is simulated only there.
    const recorded = shop((f) => { f["src/count.ts"] = 'import { type Cart } from "../gen/shop.ts";\n//@ pure\nexport function count(c: Cart): number {\n  //@ ensures \\result === c.count\n  return c.count;\n}\n'; });
    const recording = await check(recorded, "unproved");
    const ledger = recording.results.find((r) => r.stage === "proof" && /^spec\/unproved\.lock\.json: [1-9]\d* added, 0 removed$/.test(r.summary));
    assert.match(ledger?.detail ?? "", /^    \+ shop\.ts: /m, recording.results.map(show).join("\n"));
    const accepted = await run(recorded);
    assert.deepEqual(accepted.failed, ["review"], accepted.text);
    assert.ok(accepted.said("proof", /^src-count\.ts: all 1 obligations proved for all states and inputs, assuming the obligations that are simulated only \([^)]*\d+ of shop\.ts\)/), accepted.text);
    // A proof line that relies on what is simulated only lists it.
    assert.match(accepted.said("proof", /^shop\.ts: \d+ obligations, of which \d+ are simulated only \(accepted\)/)?.detail ?? "", /simulated only, accepted in spec\/unproved\.lock\.json:\n\s+\w+: /, accepted.text);
    assert.match(accepted.said("proof", /^src-count\.ts: /)?.detail ?? "", /assumed from the module it is proved against, simulated only there:\n\s+(lib|shop)\.ts: \w+: /, accepted.text);
    // What was recorded is tied to the text it was recorded for: once the unit's text changes, it no longer counts.
    fs.appendFileSync(path.join(recorded, "spec/lib.md"), `\n### Two\n\n${F}quint\npure val two = 2\n${F}\n`);
    const moved = await run(recorded);
    assert.equal(moved.said("proof", /^shop\.ts: \d+ of \d+ obligations not proved; the \d+ accepted earlier were accepted for another text/)?.ok, false, moved.text);
    const wrongStep = await run(shop((f) => { f["spec/shop.md"] = f["spec/shop.md"].replace("count: c.count }", "count: c.count - 1 }"); }));
    assert.equal(wrongStep.said("always", /^a step breaks/)?.ok, false, wrongStep.text);
    const wrongLaw = await run(shop((f) => { f["spec/lib.md"] = f["spec/lib.md"].replace("total(List(n)) == n", "total(List(n)) == n + 1"); }));
    assert.equal(wrongLaw.said("always", /^the law .* is false for \{"n":/)?.ok, false, wrongLaw.text);
    const importsMachine = await run(shop((f) => { f["spec/other.md"] = `# Other\n\n## Group\n\n### Uses a machine\n\n${F}quint\nimport shop.* from "./shop"\npure val two = 2\n${F}\n`; }));
    assert.ok(importsMachine.said("model", /is imported under a name/), importsMachine.text);
    const circle = await run(shop((f) => { f["spec/lib.md"] = f["spec/lib.md"].replace("pure def total", 'import shop.* from "./shop"\npure def total'); }));
    assert.ok(circle.said("model", /import each other in a circle/), circle.text);
  });

  test("list helpers are expanded into built-in folds, innermost first, without moving a line or touching strings and comments", () => {
    const out = expandListHelpers("pure def f(xs: List[T]): bool =\n  xs.every(t => t.ps.some(p =>\n    p == t.id))\n// xs.some(note in prose)");
    assert.equal(out.split("\n").length, 4);
    assert.ok(!/\.(every|some)\(/.test(out.split("\n").slice(0, 3).join("\n")), out);
    assert.match(out, /std_every_\d+ and/);
    assert.match(out, /std_some_\d+ or/);
    assert.match(out, /\/\/ xs\.some\(note in prose\)$/);
    const kept = expandListHelpers('pure val note = "xs.some(y)" // xs.every(z)\npure def f(xs: List[int]): bool = xs.some(x => x > 0)');
    assert.ok(kept.includes('"xs.some(y)" // xs.every(z)'), kept);
    assert.match(kept, /xs\.foldl\(false, \(std_some_\d+, x\)/);
    assert.throws(() => expandListHelpers("pure def f(xs: List[int]): bool = xs.every(x => x > 0 // oops"), /no closing parenthesis/);
  });

  test("a state whose stages carry different data, with match and sets, is simulated, replayed, fully proved and parsed", async () => {
    const root = fixtures(["parcel"]);
    const { failed, said, text } = await run(root);
    assert.deepEqual(failed, ["review"], text);
    assert.ok(said("proof", /^parcel\.ts: all \d+ obligations proved/), text);
    assert.match(fs.readFileSync(path.join(root, "gen/parcel.ts"), "utf8"), /\| \{ tag: "Shipped"; weight: number; labels: string\[\]; hops: number \}/);
    const parcel = await import(path.join(root, "gen/parcel.ts"));
    assert.deepEqual(parcel.parseState({ tag: "Packed", weight: 1, labels: ["fragile"] }), { tag: "Packed", weight: 1, labels: ["fragile"] });
    for (const x of [{ tag: "Packed", weight: 1, labels: ["a", "a"] }, { tag: "Lost", weight: 1 }, { tag: "Shipped", weight: 1, labels: [], hops: -1 }, { tag: "Gone" }])
      assert.equal(parcel.parseState(x), undefined, JSON.stringify(x));
  });

  test("a machine built from a component states and proves a rule that spans two of them", async () => {
    const { failed, said, text } = await run(fixtures(["account", "bank"]));
    assert.deepEqual(failed, ["review"], text);
    assert.ok(said("model", /^spec\/bank\.md: 2 transitions, 1 always, 1 step, 1 sometimes/), text);
  });

  test("one machine uses another under a name, keeps its rules, and adds rules about the pair", async () => {
    const { failed, said, text } = await run(fixtures(["lamp", "room"]));
    assert.deepEqual(failed, ["review"], text);
    assert.ok(said("proof", /^room\.ts: all \d+ obligations proved/), text);
  });

  test("a map is looked up safely, division and remainder agree with Quint for negative numbers, and the parsers admit only what fits", async () => {
    const root = fixtures(["stock"]);
    const { failed, said, text } = await run(root);
    assert.deepEqual(failed, ["proof", "review"], text);
    assert.ok(said("replay", /every law, and \d+ definitions/)?.ok, text);
    assert.ok(!/lawBoxesAndLooseMakeTheWhole/.test(text), "the division law is proved, so it is not listed as unproved");
    const stock = await import(path.join(root, "gen/stock.ts"));
    // A map key that every object has, a getter on an event, and an extra field are all harmless.
    const received = stock.step(stock.initial, stock.parseEvent({ type: "receive", sku: "constructor", qty: 1 }));
    assert.equal(stock.level(received, "constructor"), 1);
    assert.equal(stock.level(received, "toString"), 0);
    let reads = 0;
    assert.deepEqual(stock.parseEvent({ type: "receive", sku: "a", get qty() { return reads++ ? 1000 : 2; }, extra: 1 }), { type: "receive", sku: "a", qty: 2 });
    assert.equal(stock.parseEvent({ type: "receive", sku: "a", qty: 1.5 }), undefined);
    // parseState admits exactly a value with the state's shape that keeps every rule, as a fresh copy.
    const kept = { levels: { $a: 2 }, known: ["a"] };
    const parsed = stock.parseState(kept);
    assert.deepEqual(parsed, kept);
    assert.ok(parsed !== kept && parsed.levels !== kept.levels, "a fresh copy");
    assert.equal(stock.level(parsed, "a"), 2);
    const refused = [
      undefined, null, "state", [], { levels: { a: 2 }, known: ["a"] }, { levels: { $a: 1.5 }, known: ["a"] }, { levels: [], known: [] },
      { ...kept, extra: 1 }, { levels: { $a: -1 }, known: ["a"] }, // the last has the right shape but breaks alwaysNoLevelIsNegative
    ];
    for (const x of refused) assert.equal(stock.parseState(x), undefined, JSON.stringify(x));
  });

  test("replay notices TypeScript that disagrees with Quint, in a step or in a definition", async () => {
    const root = copyOfProject();
    const model = await gen(root, parseSpec(root, "spec/order.md"));
    const domain = await import(path.join(root, "gen/order.ts"));
    const trace = [{ state: domain.initial }, ...[{ type: "addItem", qty: 1 }, { type: "submit" }, { type: "pay", amount: 2 }]
      .map((event, i, all) => ({ event, state: all.slice(0, i + 1).reduce(domain.step, domain.initial) }))];
    replay(domain, trace);
    const broken = { ...domain, step: (s: any, e: any) => (e.type === "pay" ? { ...domain.step(s, e), status: "Paid" } : domain.step(s, e)) };
    assert.throws(() => replay(broken, trace), /TypeScript and Quint disagree/);
    assert.ok(model.evals.some((v) => v.name === "canSubmit"), "guards are among the definitions compared");
    const evaluated = (result: boolean) => [{ state: domain.initial }, { evaluated: { name: "canSubmit", picks: {}, result } }];
    replay(domain, evaluated(false), model);
    assert.throws(() => replay(domain, evaluated(true), model), /disagree on canSubmit/);
    assert.throws(() => replay({ ...domain, canSubmit: () => true }, evaluated(false), model), /disagree on canSubmit/);
  });

  test("a rule heading cannot become code", async () => {
    const { said, text } = await run(oneRule("counter", "A counter */ globalThis.INJECTED = true; /* starts at zero", "pure val initial: int = 0\npure def bump(n: int): int = n + 1"));
    assert.equal((globalThis as any).INJECTED, undefined, "the heading ran as code");
    assert.ok(said("replay", /agrees with Quint/)?.ok, text);
  });

  test("a proof cannot be forged from inside the project", async () => {
    const withFile = (file: string, text: string) => {
      const root = copyOfProject("spec/order.md", notInductive);
      fs.writeFileSync(path.join(root, file), text);
      return root;
    };
    const unproved = /^order\.ts: \d+ of \d+ obligations not proved/;
    // A file in src/ named after the spec does not take the place of the spec's own proof.
    const namesake = await run(withFile("src/order.ts", "//@ pure\nexport function one(): number {\n  return 1;\n}\n"));
    assert.ok(namesake.said("proof", unproved), namesake.text);
    // A LemmaScript configuration in the project cannot point the proof at files someone could edit.
    const configured = await run(withFile("lemmascript.json", `{"proof-dir":"proofs"}`));
    assert.ok(configured.said("proof", unproved), configured.text);
    // Nor can the project's tsconfig.json add files, globals or options to the proof: each unit has its own.
    const tsconfigured = withFile("tsconfig.json", `{"compilerOptions":{"noLib":true,"types":["missing"]},"files":["missing.ts"]}`);
    const ownConfig = await run(tsconfigured);
    assert.ok(ownConfig.said("proof", unproved), ownConfig.text);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tsconfigured, "gen/proof/order/tsconfig.json"), "utf8")).files, ["order.ts"]);
    // An annotation that asks the prover for trust is refused wherever it sits on the line.
    const sneaky = await run(copyOfProject("src/ledger.ts", (s) => s.replace("return order.due - order.paid;", "/* x */ //@ assume false\n  return order.paid - order.due;")));
    assert.ok(sneaky.said("proof", /`\/\/@ assume` is not allowed/), sneaky.text);
    // So is an import of anything but a generated module, however it is indented, or of a look-alike of one.
    const lying = await run(copyOfProject("src/ledger.ts", (s) => s.replace("\n/** Rebuild", '\n  import { owed } from "/tmp/lies.ts";\n/** Rebuild')));
    assert.ok(lying.said("proof", /may only import generated modules/), lying.text);
    assert.deepEqual(await failedStages("src/ledger.ts", (s) => s.replace('"../gen/order.ts"', '"./order.ts"')), ["proof"]);
  });

  test("a law that needs induction is proved by a proof file, and only then offered to the spec that imports it", async () => {
    const highestProof = "// The fold keeps the larger of the two.\nlemma lawTheHighestIsAtLeastTheStart_ensures(xs: seq<int>, start: int)\n  ensures (lawTheHighestIsAtLeastTheStart(xs, start) == true)\n{\n  ProofLib.FoldLeftMax((top: int, x: int) => (if (x > top) then x else top), start, xs);\n}\n";
    const ticketProof = "lemma issue_ensures(d: Desk)\n  ensures (inv(d) ==> alwaysTheLastNumberIsNotNegative(issue(d)))\n{\n  highest_lawTheHighestIsAtLeastTheStart_ensures(d.issued, d.last);\n}\n";
    const project = (files: Record<string, string>) => fixtures(["highest", "ticket"], (f) => Object.assign(f, files));
    // Without a proof file the law is not proved, and a proof file that belongs to nothing is pointed out.
    const bare = await run(project({ "spec/typo.proof.dfy": "" }));
    assert.equal(bare.said("proof", /^highest\.ts: 1 of 1 obligations not proved/)?.ok, false, bare.text);
    assert.equal(bare.said("proof", /^spec\/typo\.proof\.dfy belongs to no proof unit/)?.ok, false, bare.text);
    // With both proof files, everything proves, and the final Dafny is there to read.
    const root = project({ "spec/highest.proof.dfy": highestProof, "spec/ticket.proof.dfy": ticketProof });
    const proved = await run(root);
    assert.deepEqual(proved.failed, ["review"], proved.text);
    assert.ok(proved.said("proof", /^ticket\.ts: all 3 obligations proved/), proved.text);
    assert.match(fs.readFileSync(path.join(root, "gen/proof/ticket/ticket.dfy"), "utf8"), /lemma \{:axiom\} highest_lawTheHighestIsAtLeastTheStart_ensures/);
    // A law its own unit does not prove is not offered.
    const unoffered = await run(project({ "spec/ticket.proof.dfy": ticketProof }));
    assert.equal(unoffered.said("proof", /^ticket\.ts: Dafny could not check it[\s\S]*unresolved identifier: highest_lawTheHighestIsAtLeastTheStart_ensures/)?.ok, false, unoffered.text);
    // A proof file that asks for trust is refused, with its file and line.
    const trusting = await run(project({ "spec/highest.proof.dfy": highestProof.replace("ProofLib.FoldLeftMax", "assume false;\n  ProofLib.FoldLeftMax") }));
    assert.equal(trusting.said("proof", /spec\/highest\.proof\.dfy:5: `assume` is not allowed/)?.ok, false, trusting.text);
  });

  test("a proof file may only add lemmas, and only bodies to the generated ones", () => {
    const refused: [string, string, RegExp][] = [
      ["a block comment", "lemma A() { /* } */ }", /block comments are not allowed/],
      ["an @-attribute", "@Axiom\nlemma A() {}", /p\.dfy:1: `@` is not allowed/],
      ["the axiom attribute", "lemma {:axiom} A() ensures false {}", /the attribute \{:axiom\} is not allowed/],
      ["an attribute with spaces", "lemma A() { assert { : verify false } true; }", /the attribute \{:verify\} is not allowed/],
      ["a character literal", "lemma A() { var c := 'a'; }", /character literals are not allowed/],
      ["assume", "lemma A()\n  ensures false\n{\n  assume false;\n}", /p\.dfy:4: `assume` is not allowed/],
      ["a function", "function F(): int { 1 }", /`function` is not allowed/],
      ["a predicate", "lemma A() {}\npredicate P() { true }", /p\.dfy:2: `predicate` is not allowed/],
      ["an include", 'include "other.dfy"', /`include` is not allowed/],
      ["a module", "module M {}", /`module` is not allowed/],
      ["expect", "lemma A() { expect false; }", /`expect` is not allowed/],
      ["reads", "lemma A() reads {} {}", /`reads` is not allowed/],
      ["a lemma with no body", "lemma A() ensures false", /lemma A has no body/],
      ["an unclosed body", "lemma A() { if true { }", /unbalanced braces/],
      ["a brace that closes nothing", "lemma A() { } }", /this \} closes nothing/],
      ["anything else at the top level", "assert false;", /only `lemma` declarations/],
      ["a lemma declared twice", "lemma A() {}\nlemma A() {}", /declared twice/],
      ["a carriage return that would end a comment early", "lemma A() { // note\rassume false;\n}", /line breaks other than/],
      ["a string that is not closed", 'lemma A() { var s := "x; }', /not closed/],
    ];
    for (const [what, text, message] of refused) assert.throws(() => parseProofFile(text, "p.dfy"), message, what);
    assert.equal(parseProofFile("// a comment\nlemma A(xs: seq<int>)\n  ensures forall i {:trigger xs[i]} :: 0 <= i < |xs| ==> xs[i] == xs[i]\n{\n  reveal F();\n  calc { 1; 1; }\n  forall i | 0 <= i < |xs| ensures xs[i] == xs[i] {}\n  assert true by { var x := 1; if x > 0 { } match xs { case _ => } }\n}\n", "p.dfy").length, 1);

    const gen = "function f(x: int): int\n{\n  x\n}\n\nlemma f_ensures(x: int)\n  ensures (f(x) >= x)\n{\n}\n";
    const spliced = (text: string) => splice(gen, { proof: { file: "p.dfy", text }, axioms: [] }).dfy;
    // A body goes inside the generated lemma; a helper is appended; nothing generated changes.
    const out = spliced("lemma f_ensures(x: int)\n  ensures (f(x) >= x)   // spacing and comments do not matter\n{\n  Helper(x);\n}\nlemma Helper(x: int) ensures f(x) == x { }\n");
    assert.ok(out.startsWith(gen.replace("{\n}\n", "{\n  Helper(x);\n}\n")), out);
    assert.match(out, /lemma Helper\(x: int\)/);
    // A header that no longer matches the generated one is stale.
    assert.throws(() => spliced("lemma f_ensures(x: int)\n  requires x > 0\n  ensures (f(x) >= x)\n{\n}\n"), /p\.dfy:1: lemma f_ensures does not repeat its generated header, so it is refused as stale/);
    // A helper may not take a generated name, or the library's.
    assert.throws(() => spliced("lemma f(x: int) { }"), /p\.dfy:1: lemma f: the name is already declared/);
    assert.throws(() => spliced("lemma ProofLib() { }"), /the name is already declared/);
  });

  test("an obligation that fails is not assumed while the others are checked", async () => {
    const { said, text } = await run(fixtures(["twins"]));
    const found = said("proof", /^twins\.ts: 3 of 4 obligations not proved/);
    assert.equal(found?.ok, false, text);
    assert.match(found!.detail, /alwaysBIsAtMostThreeOrNinetyNine/);
    // The tools' step body calls the transition's lemma, so step rests on what that lemma does not prove.
    assert.match(found!.detail, /step: inv\(step\(current, event\)\)   \[rests on bump: /);
  });

  test("verified code in a subdirectory of src is proved too", async () => {
    const failed = await failedStages("src/deep/owed.ts", () => 'import { type Order } from "../../gen/order.ts";\n//@ pure\nexport function owed(o: Order): number {\n  //@ ensures \\result > 0\n  return o.due - o.paid;\n}\n');
    assert.deepEqual(failed, ["proof", "review"]); // and its contract is new
  });

  test("hand-written logic that breaks its contract is caught by the proof", async () => {
    const failed = await failedStages("src/ledger.ts", (s) => s.replace("return order.due - order.paid;", "return order.paid - order.due;"));
    assert.deepEqual(failed, ["proof"]);
  });

  test("moving a line break so that a comment swallows half a guard is a change to the model", async () => {
    const failed = await failedStages("spec/order.md", (s) => s.replace("pure def canAddItem(o: Order, qty: int): bool =\n  o.status == Draft and qty > 0 and o.units + qty <= maxUnits",
      "pure def canAddItem(o: Order, qty: int): bool =\n  o.status == Draft and qty > 0 // and o.units + qty <= maxUnits"));
    assert.ok(failed.includes("review"), failed.join());
  });

  test("init preserves local instructions and refreshes its marked procedure", () => {
    const root = scratch({ "AGENTS.md": "mine\n", "package.json": `{"scripts":{"check":"mine"}}` });
    const added = init(root);
    const agents = path.join(root, "AGENTS.md");
    const expected = `mine\n\n<!-- vibespec:start -->\n${read("AGENTS.md").trim()}\n<!-- vibespec:end -->\n`;
    assert.equal(fs.readFileSync(agents, "utf8"), expected);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).scripts.check, "mine");
    assert.ok(["sync", "design"].every((s) => fs.existsSync(path.join(root, `.claude/skills/${s}/SKILL.md`))) && added.includes("tsconfig.json"), added.join());
    assert.match(fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8"), /^@AGENTS\.md$/m);
    assert.deepEqual(init(root), []);
    fs.writeFileSync(path.join(root, "CLAUDE.md"), "My existing instructions.\n");
    init(root);
    assert.equal(fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8"), "My existing instructions.\n\n@AGENTS.md\n");
    assert.equal(fs.readFileSync(agents, "utf8"), expected);
    assert.deepEqual(init(root), []);
    fs.writeFileSync(agents, "before\r\n<!-- onespec:start -->\r\nold instructions\r\n<!-- onespec:end -->\r\nafter\r\n");
    init(root);
    assert.equal(fs.readFileSync(agents, "utf8"), `before\r\n<!-- vibespec:start -->\r\n${read("AGENTS.md").trim().replace(/\r?\n/g, "\r\n")}\r\n<!-- vibespec:end -->\r\nafter\r\n`);
    assert.deepEqual(init(root), []);
    for (const invalid of [
      "<!-- vibespec:start -->\nincomplete\n",
      "<!-- vibespec:start -->\n<!-- onespec:end -->\n",
      "<!-- vibespec:start -->\n<!-- vibespec:end -->\n<!-- vibespec:start -->\n<!-- vibespec:end -->\n",
    ]) {
      fs.writeFileSync(agents, invalid);
      assert.throws(() => init(root), /repair.*markers/);
      assert.equal(fs.readFileSync(agents, "utf8"), invalid);
    }
  });

  test("the package's own test script is what runs, never the check itself, and a test citing a heading the spec does not have is caught", async () => {
    const root = copyOfProject("package.json", () => JSON.stringify({ scripts: { test: `node ${JSON.stringify(path.join(project, "tools/spec.ts"))} check` } }));
    const again = await run(root);
    assert.deepEqual(again.failed, ["tests"], again.text);
    assert.ok(again.said("tests", /runs `spec check`; it must run only the tests/), again.text);
    fs.writeFileSync(path.join(root, "package.json"), "{}");
    const cite = (heading: string) => `// spec/order.md, ${JSON.stringify(heading)}\n`;
    const cites = ["Story: Check out", "Only a non-empty draft can be submitted", "Refunds are instant"].map(cite).join("");
    fs.mkdirSync(path.join(root, "test/journeys"), { recursive: true });
    fs.writeFileSync(path.join(root, "test/journeys/checkout.test.ts"), `import { test } from "node:test";\n${cites}test("a journey", () => {});\n`);
    const { failed, text, said } = await run(root);
    assert.deepEqual(failed, ["tests"], text);
    assert.ok(said("tests", /^1 citations[\s\S]*test\/journeys\/checkout\.test\.ts:4 {2}spec\/order\.md, "Refunds are instant"$/), text);
    assert.ok(said("tests", /^pass\n$/), text);
  });

  test("nothing stale survives in gen/", async () => {
    const root = copyOfProject();
    fs.mkdirSync(path.join(root, "gen"), { recursive: true });
    fs.writeFileSync(path.join(root, "gen/renamed.ts"), "export const stale = true;\n");
    await check(root);
    assert.deepEqual(fs.readdirSync(path.join(root, "gen")).filter((f) => f.endsWith(".ts")), ["order.ts"]);
  });

  test("the studio publishes a spec with its origins, checks it, and refuses remote or concurrent writes", async () => {
    const root = fixtures(["door"]);
    const studio = await startStudio({ projects: [{ id: ".", name: "Door", root }], port: 0, agents: {} });
    const url = studio.url.replace("localhost", "127.0.0.1");
    const post = (route: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${url}/api/${route}`, {
      method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
    });
    try {
      for (const file of ["/", "/app.js", "/style.css"]) {
        const asset = await fetch(url + file);
        assert.equal(asset.status, 200, file);
        assert.ok((await asset.arrayBuffer()).byteLength > 0, file);
      }
      const first = await (await fetch(`${url}/api/project`)).json();
      assert.deepEqual(first.specs.map((spec: { file: string }) => spec.file), ["spec/door.md"]);
      for (const route of ["spec", "accept"]) {
        const remote = await post(route, { name: "remote" }, { origin: "https://untrusted.example" });
        assert.equal(remote.status, 403, route);
      }
      const hostile = await new Promise<number>((resolve, reject) => {
        http.get(`${url}/api/project`, { headers: { host: "untrusted.example" } }, (response) => {
          response.resume();
          resolve(response.statusCode!);
        }).on("error", reject);
      });
      assert.equal(hostile, 403);
      assert.equal((await post("spec", { name: "plain" }, { "content-type": "text/plain" })).status, 415);
      const original = first.specs[0];
      const text = original.text + "\nThe door remains available.\n";
      const origins = nodesOf(original.file, text).map((n) => [n.id, n.id]);
      const body = { files: [{ file: original.file, base: original.hash, text }], origins };
      const published = await post("publish", body);
      assert.equal(published.status, 200, await published.clone().text());
      const manifest = (await published.json()).manifest;
      assert.ok(manifest.changes.some((c: { kind: string; what: string[] }) => c.kind === "rule" && c.what.includes("prose")));
      assert.equal(fs.readFileSync(path.join(root, original.file), "utf8"), text);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, ".studio/state.json"), "utf8")).ids, Object.fromEntries(origins));
      const concurrent = await Promise.all([post("publish", body), post("spec", { name: "parallel" })]);
      for (const response of concurrent) assert.equal(response.status, 400, await response.text());
      assert.ok(!fs.existsSync(path.join(root, "spec/parallel.md")));
      let current = await (await fetch(`${url}/api/project`)).json();
      while (current.job?.status === "running") {
        await new Promise((resolve) => setTimeout(resolve, 50));
        current = await (await fetch(`${url}/api/project`)).json();
      }
      assert.equal(current.job?.status, "failed");
      assert.equal(current.check?.next.includes("npm run accept"), true);
    } finally {
      await studio.close();
    }
  });

  test("a truncated cache entry is recomputed and generated modules run in a CommonJS project", async () => {
    const root = fixtures(["door"], (f) => { f["package.json"] = '{"type":"commonjs"}'; });
    const before = await run(root);
    assert.deepEqual(before.failed, ["review"], before.text);
    const cache = path.join(root, ".spec-cache");
    const entries = fs.readdirSync(cache).filter((f) => f.endsWith(".json"));
    assert.ok(entries.length > 0);
    for (const entry of entries) fs.writeFileSync(path.join(cache, entry), "{");
    const after = await run(root);
    assert.deepEqual(after.failed, ["review"], after.text);
    for (const entry of fs.readdirSync(cache).filter((f) => f.endsWith(".json"))) assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(cache, entry), "utf8")));
  });

  test("changing an imported definition invalidates model and simulation results", async () => {
    const wrap = (text: string) => `# Library\n\n## Values\n\n### Price\n\n${F}quint\n${text}\n${F}\n`;
    const root = scratch({
      "spec/lib.md": wrap("pure val price = 1"),
      "spec/use.md": wrap('import lib.* from "./lib"\npure def lawPrice(k: int): bool = price == 1'),
    });
    const first = await run(root);
    assert.deepEqual(first.failed, ["review"], first.text);
    fs.writeFileSync(path.join(root, "spec/lib.md"), wrap("pure val price = 2"));
    const after = await run(root);
    assert.equal(after.said("always", /the law .* is false/)?.ok, false, after.text);
  });

  test("proof caching follows library changes and compiler failure waits for proof completion", async () => {
    const root = fixtures(["highest"], (f) => {
      f["package.json"] = '{"type":"module"}';
      f["spec/highest.proof.dfy"] = "lemma lawTheHighestIsAtLeastTheStart_ensures(xs: seq<int>, start: int)\n  ensures (lawTheHighestIsAtLeastTheStart(xs, start) == true)\n{\n  ProofLib.FoldLeftMax((top: int, x: int) => (if (x > top) then x else top), start, xs);\n}\n";
    });
    fs.cpSync(path.join(project, "tools"), path.join(root, "tools"), { recursive: true });
    const modules = path.join(root, "node_modules");
    fs.mkdirSync(path.join(modules, ".bin"), { recursive: true });
    for (const entry of fs.readdirSync(nodeModules).filter((f) => f !== ".bin"))
      fs.symlinkSync(path.join(nodeModules, entry), path.join(modules, entry), fs.statSync(path.join(nodeModules, entry)).isDirectory() ? "dir" : "file");
    for (const tool of ["quint", "lsc"]) {
      const executable = process.platform === "win32" ? `${tool}.cmd` : tool;
      fs.symlinkSync(path.join(nodeModules, ".bin", executable), path.join(modules, ".bin", executable), "file");
    }
    const script = path.join(root, "tools/spec.ts");
    const first = await runCli(script, root, "check", "--json");
    const checked = JSON.parse(first.stdout);
    assert.ok(checked.results.some((r: Result) => r.stage === "proof" && r.ok), first.stdout + first.stderr);
    const marker = "// A distinct proof-library version for this scratch project.";
    fs.appendFileSync(path.join(root, "tools/proof/lib.dfy"), `\n${marker}\n`);
    const second = await runCli(script, root, "check", "--json");
    const again = JSON.parse(second.stdout);
    assert.ok(again.results.some((r: Result) => r.stage === "proof" && r.ok), second.stdout + second.stderr);
    assert.ok(fs.readFileSync(path.join(root, "gen/proof/highest/highest.dfy"), "utf8").includes(marker));
    fs.writeFileSync(path.join(root, "tsconfig.json"), '{"compilerOptions":{"noEmit":true},"include":["gen/*.ts"]}');
    if (process.platform !== "win32") {
      const compiler = path.join(modules, ".bin/tsc");
      fs.writeFileSync(compiler, "#!/bin/sh\nexit 1\n");
      fs.chmodSync(compiler, 0o644);
    }
    fs.appendFileSync(path.join(root, "spec/highest.proof.dfy"), "// Recheck the proof beside the failed compiler.\n");
    const failed = await runCli(script, root, "check", "--json");
    const result = JSON.parse(failed.stdout);
    assert.equal(failed.status, 1, failed.stdout + failed.stderr);
    assert.ok(result.results.some((r: Result) => r.stage === "types" && !r.ok), failed.stdout);
    assert.ok(result.results.some((r: Result) => r.stage === "proof" && r.ok), failed.stdout);
    assert.ok(!fs.existsSync(path.join(root, ".spec-cache/lock")));
  });

  test("a story's text, a definition a rule relies on, here or in an imported spec, and a src contract are each reviewed", () => {
    const root = copyOfProject();
    const edit = (file: string, change: (s: string) => string) => fs.writeFileSync(path.join(root, file), change(fs.readFileSync(path.join(root, file), "utf8")));
    assert.deepEqual(pendingItems(root), []);
    const original = read("spec/order.md");
    edit("spec/order.md", (s) => s.replace("so that I can buy\n> several things in one go.", "so that I can buy\n> many things at once."));
    assert.deepEqual(pendingItems(root), ["Story: Fill a draft: story changed"]);
    edit("spec/order.md", () => original.replace("pure val unitPrice = 5", "pure val unitPrice = 7"));
    const moved = pendingItems(root);
    assert.ok(moved.includes("Domain / Unit price and order size: model changed"), moved.join("\n"));
    assert.ok(moved.includes("Story: Fill a draft / Items can only be added to a draft: model changed through unitPrice, maxUnits (Domain / Unit price and order size)")
      || moved.includes("Story: Fill a draft / Items can only be added to a draft: model changed through maxUnits, unitPrice (Domain / Unit price and order size)"), moved.join("\n"));
    assert.ok(moved.includes("Story: Fill a draft / The amount due is always the price of the units: model changed through unitPrice (Domain / Unit price and order size)"), moved.join("\n"));
    assert.ok(!moved.some((m) => m.startsWith("Story: Check out / A payment never exceeds the balance")), "a rule that does not use the price is not flagged");

    // Across specs: a change to a library definition flags the rules that use it.
    const shop = fixtures(["lib", "shop"]);
    for (const spec of readSpecs(shop)) acceptReviews(shop, spec);
    fs.writeFileSync(path.join(shop, "spec/lib.md"), read("tools/fixtures/lib.md").replace("acc + x)", "x + acc)"));
    const flagged = pendingItems(shop);
    assert.ok(flagged.includes("Story: Fill a cart / A cart holds lines: model changed through total (spec/lib.md: Sums / The total of a list)"), flagged.join("\n"));

    // The //@ lines of hand-written code: changed, new, and gone, whether the file loses them or is deleted.
    const contract = () => pendingContracts(root).map((p) => `${p.where}: ${p.status}`);
    assert.deepEqual(contract(), []);
    edit("src/ledger.ts", (s) => s.replace("  //@ ensures \\result >= 0\n", ""));
    fs.writeFileSync(path.join(root, "src/extra.ts"), "//@ pure\nexport function one(): number {\n  //@ ensures \\result === 1\n  return 1;\n}\n");
    assert.deepEqual(contract(), ["src/extra.ts: new contract", "src/ledger.ts: contract changed"]);
    acceptContracts(root);
    edit("src/ledger.ts", (s) => s.replace(/^.*\/\/@.*\n/gm, ""));
    fs.rmSync(path.join(root, "src/extra.ts"));
    assert.deepEqual(contract(), ["src/extra.ts: contract removed", "src/ledger.ts: contract removed"]);
  });

  test("a namespaced dependency remains reviewed when a local definition has the same name", () => {
    const wrap = (text: string) => `# Names\n\n## Rules\n\n### Identity\n\n${F}quint\n${text}\n${F}\n`;
    const root = scratch({
      "spec/lib.md": wrap("pure def identity(n: int): int = n"),
      "spec/use.md": wrap('import lib as L from "./lib"\npure def identity(n: int): int = 0\npure def lawIdentity(n: int): bool = L::identity(n) == n'),
    });
    for (const spec of readSpecs(root)) acceptReviews(root, spec);
    fs.writeFileSync(path.join(root, "spec/lib.md"), wrap("pure def identity(n: int): int = n + 0"));
    assert.ok(pendingItems(root).some((item) => item.includes("model changed through") && item.includes("identity")), pendingItems(root).join("\n"));
  });

  test("a comment cannot hide an imported rule's dependency from review", () => {
    const wrap = (text: string) => `# Names\n\n## Rules\n\n### Imported\n\n${F}quint\n${text}\n${F}\n`;
    const lib = wrap("pure def value(n: int): int = n + 1");
    const use = `# Use\n\n## Rules\n\n### Local\n\n${F}quint\nimport lib.* from "./lib"\n/*\npure def value(n: int): int = 0\n*/\npure def other(n: int): int = n\n${F}\n\n### Uses imported value\n\n${F}quint\npure def lawValue(n: int): bool = value(n) > n\n${F}\n`;
    const root = scratch({ "spec/lib.md": lib, "spec/use.md": use });
    for (const spec of readSpecs(root)) acceptReviews(root, spec);
    fs.writeFileSync(path.join(root, "spec/lib.md"), lib.replace("n + 1", "n + 2"));
    assert.ok(pendingItems(root).some((item) => item.startsWith("Rules / Uses imported value: model changed through") && item.includes("value")), pendingItems(root).join("\n"));
  });

  test("source edited by a test cannot be accepted with a proof of its earlier contents", async () => {
    const source = "//@ pure\nexport function one(): number {\n  //@ ensures \\result === 1\n  return 1;\n}\n";
    const changed = source.replace("return 1", "return 2");
    const root = fixtures(["door"], (f) => {
      f["src/count.ts"] = source;
      f["test/change.test.ts"] = `import fs from "node:fs";\nimport { test } from "node:test";\ntest("an editor changes source", () => fs.writeFileSync("src/count.ts", ${JSON.stringify(changed)}));\n`;
    });
    for (const spec of readSpecs(root)) acceptReviews(root, spec);
    acceptContracts(root);
    const ledger = fs.readFileSync(path.join(root, "spec/src.lock.json"), "utf8");
    const result = await run(root, "reviews");
    assert.ok(result.failed.length > 0, result.text);
    assert.match(result.text, /source.*changed|changed.*source|changed during|changed while/i);
    assert.equal(fs.readFileSync(path.join(root, "spec/src.lock.json"), "utf8"), ledger);
  });

  test("moving an unchanged contract to another function requires review", () => {
    const text = "//@ pure\nexport function one(): number {\n  //@ ensures \\result === 1\n  return 1;\n}\n//@ pure\nexport function two(): number {\n  return 2;\n}\n";
    const root = scratch({ "src/count.ts": text });
    fs.mkdirSync(path.join(root, "spec"));
    acceptContracts(root);
    fs.writeFileSync(path.join(root, "src/count.ts"), text.replace("  //@ ensures \\result === 1\n", "").replace("  return 2;", "  //@ ensures \\result === 1\n  return 2;"));
    assert.deepEqual(pendingContracts(root).map((p) => p.status), ["contract changed"]);
  });

  test("accept records a changed story and a changed contract, after which nothing is left to reconcile", async () => {
    const root = copyOfProject("src/ledger.ts", (s) => s.replace("  //@ ensures order.status === \"Paid\" ==> \\result === 0\n", ""));
    fs.writeFileSync(path.join(root, "spec/order.md"), read("spec/order.md").replace("> get my money back.", "> get all my money back."));
    const before = await run(root);
    assert.deepEqual(before.failed, ["review"], before.text);
    assert.ok(before.said("review", /story changed/) && before.said("review", /src\/ledger\.ts\n\s+contract changed/), before.text);
    assert.match(before.next, /npm run accept/);
    await check(root, "reviews");
    const after = await run(root);
    assert.deepEqual(after.failed, [], after.text);
    assert.equal(after.next, "all green");
    // The total is the `ensures` of the generated Dafny: two are left in src/ledger.ts, and its loop invariants are not counted.
    assert.ok(after.said("proof", /^src-ledger\.ts: all 2 obligations proved/), after.text);
  });

  test("a second check in the same project is refused, a lock left by a process that ended is taken over, and unused cache entries go", async () => {
    const root = fixtures(["door"]);
    const lock = path.join(root, ".spec-cache/lock");
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, `${process.pid}\n`);
    await assert.rejects(check(root), /another check or accept is running in this project \(process \d+\)/);
    fs.writeFileSync(lock, `${spawnSync(process.execPath, ["-e", ""]).pid}\n`);
    const unused = path.join(root, ".spec-cache/000000000000000000000000.json");
    fs.writeFileSync(unused, "{}");
    const { failed, text } = await run(root);
    assert.deepEqual(failed, ["review"], text);
    assert.ok(!fs.existsSync(lock), "the lock is released");
    assert.ok(!fs.existsSync(unused), "a cache entry the run did not use is deleted");
    assert.ok(fs.readdirSync(path.dirname(lock)).length > 0, "the entries it used are kept");
  });

  test("the command line: spec new, the arguments it accepts, gen --if-valid and check --json", async () => {
    const cli = (root: string, ...args: string[]) => runCli(path.join(project, "tools/spec.ts"), root, ...args);
    const root = scratch({});
    assert.equal((await cli(root, "new", "Tally")).status, 1);
    assert.equal((await cli(root, "new", "src")).status, 1);
    assert.equal((await cli(root, "new", "tally")).status, 0);
    assert.match((await cli(root, "new", "tally")).stderr, /spec\/tally\.md already exists/);
    assert.equal((await cli(root, "accept", "unprovd")).status, 2);
    assert.equal((await cli(root, "check", "--everything")).status, 2);
    // The starter spec passes every stage but review, and proves without a proof file.
    const checked = JSON.parse((await cli(root, "check", "--json")).stdout);
    assert.deepEqual([...new Set(checked.results.filter((r: Result) => !r.ok).map((r: Result) => r.stage))], ["review"], JSON.stringify(checked, null, 2));
    for (const stage of ["model", "always", "sometimes", "replay", "proof"]) assert.ok(checked.results.some((r: Result) => r.stage === stage && r.ok), stage);
    assert.match(checked.next, /npm run accept/);
    fs.appendFileSync(path.join(root, "spec/tally.md"), `\n### Broken\n\n${F}quint\npure def\n${F}\n`);
    const lenient = await cli(root, "gen", "--if-valid");
    assert.equal(lenient.status, 0, lenient.stderr);
    assert.match(lenient.stdout, /^note: gen\/ was not generated/);
    assert.equal((await cli(root, "gen")).status, 1);
  });

  test("a fence of any length or kind holds prose, and closes only with its own kind and length", () => {
    const four = "`".repeat(4);
    const root = scratch({ "spec/f.md": `# F\n\n## Story\n\n### Real\n\n${F}quint\npure val a = 1\n${F}\n\n${four}markdown\n### Not a rule\n${F}quint\npure val b = 2\n${F}\n${four}\n\n~~~\n### Nor this\n${F}\n~~~\n\n### Also real\n\n${F}quint\npure val c = 3\n${F}\n` });
    const spec = parseSpec(root, "spec/f.md");
    assert.deepEqual(spec.rules.map((r) => r.key), ["Story / Real", "Story / Also real"]);
    assert.deepEqual(spec.rules.flatMap((r) => r.defs), ["a", "c"]);
    assert.match(spec.rules[0].prose, /### Not a rule[\s\S]*### Nor this/);
  });
  // Each of these is a way a false obligation could be reported as proved.
  const bumpHeader = "lemma bump_ensures(c: C, k: int)\n  ensures (inv(c) ==> canBump(c, k) ==> alwaysNonNegative(bump(c, k)))\n  ensures (inv(c) ==> canBump(c, k) ==> alwaysBumpsNonNegative(bump(c, k)))\n{\n";
  const magic = (proof?: string) => fixtures(["magic"], (f) => { if (proof !== undefined) f["spec/magic.proof.dfy"] = proof; });

  test("a proof file reaches the standard library only by the names the generated code uses, and the tools' library only by its own", () => {
    const lib = fs.readFileSync(LIB_FILE, "utf8");
    const gen = "function f(xs: seq<int>): bool\n{\n  Std.Collections.Seq.All(xs, (x: int) => x > 0)\n}\n\nlemma f_ensures(xs: seq<int>)\n  ensures (f(xs) == true)\n{\n}\n";
    const header = "lemma f_ensures(xs: seq<int>)\n  ensures (f(xs) == true)\n{\n";
    const spliced = (body: string) => splice(gen, { proof: { file: "p.dfy", text: `${header}${body}\n}\n` }, axioms: [], lib }).dfy;
    // Std.Ordinal.TimesIncreasingOnLeft is a false {:axiom}; dafny audit reports it only against the library's own file.
    assert.throws(() => spliced("  Std.Ordinal.TimesIncreasingOnLeft(0, 0, 0);"), /p\.dfy:4: `Std\.Ordinal\.TimesIncreasingOnLeft` is not allowed[^\n]*\(Std\.Collections\.Seq\.All\)/);
    assert.throws(() => spliced("  ProofLib.Seq.LemmaFlattenConcat<int>([], []);"), /`ProofLib\.Seq\.LemmaFlattenConcat` is not a lemma or function of tools\/proof\/lib\.dfy/);
    assert.throws(() => spliced("  assert (xs).Std.Ordinal == 0;"), /`Std` may only begin a name/);
    assert.ok(spliced("  assert Std.Collections.Seq.All(xs, (x: int) => x > 0) == f(xs);\n  ProofLib.FilterNil((x: int) => true, []);").includes("ProofLib.FilterNil"));
  });

  test("a lemma's body is the brace group that ends it, after a complete header; a set display is never a body", () => {
    const noBody: [string, string][] = [
      ["decreases with a set display", "lemma Bad() ensures false decreases {0}\nlemma B() { Bad(); }"],
      ["ensures with a set display", "lemma Bad(x: int) ensures x in {1}"],
      ["a multiset display", "lemma Bad(x: int) ensures x in multiset{1}"],
      ["a body followed by more", "lemma A() { } ensures false"],
    ];
    for (const [what, text] of noBody) assert.throws(() => parseProofFile(text, "p.dfy"), /p\.dfy:1: lemma \w+ has no body/, what);
    const [lemma] = parseProofFile("lemma Ok(s: set<int>) ensures s == {} ==> |s| == 0 ensures 1 in {1} { assert true; }", "p.dfy");
    assert.equal(lemma.body.trim(), "assert true;");
    assert.throws(() => parseProofFile("lemma A() { }\0", "p.dfy"), /p\.dfy:1: NUL characters are not allowed/);
  });

  test("a failure is charged to the definition it is in, by where the tools put each line, not by reading the text back", () => {
    const gen = "function f(x: int): int\n{\n  x\n}\n\nlemma f_ensures(x: int)\n  ensures (f(x) >= x)\n{\n}\n";
    const { dfy, regions } = splice(gen, { proof: { file: "p.dfy", text: "lemma\nLiar()\n  ensures false\n{\n}\nlemma f_ensures(x: int)\n  ensures (f(x) >= x)\n{\n  Liar();\n}\n" }, axioms: [] });
    const lines = dfy.split("\n");
    const liar = lines.indexOf("Liar()");
    assert.deepEqual(regions[liar], { def: "Liar", generated: false });
    assert.equal(regions[lines.indexOf("  Liar();")].def, "f_ensures");
    const out = (summary: string, ...messages: string[]) => `${messages.join("\n")}\n\nDafny program verifier finished with ${summary}\n`;
    const failure = `t.dfy(${liar + 4},0): Error: a postcondition could not be proved on this return path\nt.dfy(${liar + 2},10): Related location: this is the postcondition that could not be proved`;
    assert.match([...readVerdict(out("3 verified, 1 error", failure), dfy, "t.dfy", regions).errors].join("\n"), /^Liar \(t\.dfy:\d+\) does not verify: false; a lemma that is not generated must prove$/);
  });

  test("only Dafny's own messages are read: from the start of a line, from the error's block and definition, and as many as it counted", () => {
    const gen = "lemma a_ensures(x: int)\n  ensures P(x)\n  ensures Q(x)\n{\n}\n\nlemma b_ensures(x: int)\n  ensures R(x)\n{\n}\n";
    const { dfy, regions } = splice(gen, { axioms: [] });
    const verdict = (...messages: string[]) => readVerdict(`${messages.join("\n")}\n`, dfy, "t.dfy", regions);
    const error = "t.dfy(4,0): Error: a postcondition could not be proved on this return path";
    const related = (line: number) => `t.dfy(${line},2): Related location: this is the postcondition that could not be proved`;
    const summary = (n: number) => `\nDafny program verifier finished with 2 verified, ${n} error${n === 1 ? "" : "s"}`;
    // A message in the text of a line (as an echoed source line would carry it) is not a message.
    const echoed = verdict(error, related(3), `  | //x/t.dfy(8,2): Related location: this is the postcondition that could not be proved`, summary(1));
    assert.deepEqual([...echoed.unproved.keys()], ["a: Q(x)"]);
    assert.deepEqual([...echoed.errors], []);
    // A postcondition of another definition does not answer for this one.
    const elsewhere = verdict(error, related(8), summary(1));
    assert.deepEqual([...elsewhere.unproved.keys()], []);
    assert.match([...elsewhere.errors].join("\n"), /a_ensures: a postcondition could not be proved on this return path, and Dafny named no postcondition of it/);
    // One that comes after another message is not part of the error's block.
    const later = verdict(error, "t.dfy(9,0): Warning: something", related(3), summary(1));
    assert.deepEqual([...later.unproved.keys()], []);
    // Fewer failures read than Dafny counted is an error, never a smaller list.
    assert.match([...verdict(error, related(3), summary(2)).errors].join("\n"), /Dafny reported 2 failures, but 1 were read from its output/);
  });

  test("a proof file can neither use the standard library's axioms, nor charge a helper's failure to an obligation, nor spoof Dafny's messages", async () => {
    const [std, liar, spoof] = await Promise.all([
      run(magic(`${bumpHeader}  Std.Ordinal.TimesIncreasingOnLeft(0, 0, 0);\n}\n`)),
      run(magic(`lemma\nLiar()\n  ensures false\n{\n}\n\n${bumpHeader}  Liar();\n}\n`)),
      // A message inside a source comment must not name mark's obligation in place of bump's.
      run(magic(`${bumpHeader}  return; //magic.dfy(39,40): Related location: this is the postcondition that could not be proved\n}\n`)),
    ]);
    assert.equal(std.said("proof", /^magic\.ts: Dafny could not check it[\s\S]*spec\/magic\.proof\.dfy:5: `Std\.Ordinal\.TimesIncreasingOnLeft` is not allowed/)?.ok, false, std.text);
    assert.equal(liar.said("proof", /^magic\.ts: Dafny could not check it[\s\S]*Liar \(magic\.dfy:\d+\) does not verify/)?.ok, false, liar.text);
    const spoofed = spoof.said("proof", /^magic\.ts: 3 of 6 obligations not proved/);
    assert.equal(spoofed?.ok, false, spoof.text);
    assert.match(spoofed!.detail, /bump: \(inv\(c\) ==> canBump\(c, k\) ==> alwaysNonNegative\(bump\(c, k\)\)\)/);
  });

  test("an obligation whose proof calls a lemma that is not proved is not proved either, the tools' own step body included", async () => {
    const markProof = "lemma mark_ensures(c: C, k: int)\n  ensures (inv(c) ==> canMark(c, k) ==> alwaysNonNegative(mark(c, k)))\n  ensures (inv(c) ==> canMark(c, k) ==> alwaysBumpsNonNegative(mark(c, k)))\n{\n  bump_ensures(C(0, 0), 777777);\n  assert false;\n}\n";
    const [bare, borrowed] = await Promise.all([run(magic()), run(magic(markProof))]);
    const plain = bare.said("proof", /^magic\.ts: 3 of 6 obligations not proved/);
    assert.equal(plain?.ok, false, bare.text);
    assert.match(plain!.detail, /step: inv\(step\(current, event\)\)   \[rests on bump: /);
    const resting = borrowed.said("proof", /^magic\.ts: 4 of 6 obligations not proved/);
    assert.equal(resting?.ok, false, borrowed.text);
    assert.match(resting!.detail, /mark: \(inv\(c\) ==> canMark\(c, k\) ==> alwaysNonNegative\(mark\(c, k\)\)\)   \[rests on bump: /);
  });

  test("a law is offered to an importer only if it is proved without resting on one that is not", async () => {
    const counter = read("tools/fixtures/magic.md").replace("type C = {", 'import forbidden.* from "./forbidden"\ntype C = {').replace(/### Mark by[\s\S]*?(?=### The count is never)/, "").replace(/### The count of bumps[\s\S]*?(?=### Bumped)/, "");
    const { said, text } = await run(fixtures(["forbidden"], (f) => Object.assign(f, {
      "spec/magic.md": counter,
      "spec/forbidden.proof.dfy": "lemma lawNotSecond_ensures(n: int)\n  ensures (lawNotSecond(n) == true)\n{\n  lawNotFirst_ensures(987654321);\n}\n",
      "spec/magic.proof.dfy": "lemma bump_ensures(c: C, k: int)\n  ensures (inv(c) ==> canBump(c, k) ==> alwaysNonNegative(bump(c, k)))\n{\n  forbidden_lawNotSecond_ensures(123456789);\n}\n",
    })));
    const lib = said("proof", /^forbidden\.ts: 2 of 2 obligations not proved/);
    assert.equal(lib?.ok, false, text);
    assert.match(lib!.detail, /lawNotSecond: \(lawNotSecond\(n\) == true\)   \[rests on lawNotFirst: /);
    assert.equal(said("proof", /^magic\.ts: Dafny could not check it[\s\S]*unresolved identifier: forbidden_lawNotSecond_ensures/)?.ok, false, text);
  });

  test("verified code is refused where the proof and Node would read it differently", () => {
    const refused: [string, string, RegExp][] = [
      ["a renamed import", 'import { sometimesFour as alwaysNotNegative, type C } from "../gen/counter.ts";', /may not rename what it imports/],
      ["a default import", 'import counter from "../gen/counter.ts";', /not a default or namespace import/],
      ["a namespace import", 'import * as counter from "../gen/counter.ts";', /not a default or namespace import/],
      ["an export list", "function double(x: number): number {\n  return x * 2;\n}\nexport { double as half };", /may hold only imports, functions with a body/],
      ["a re-export", 'export * from "../gen/counter.ts";', /may hold only imports, functions with a body/],
      ["a default export", "export default function f(): number {\n  return 1;\n}", /`default` is not allowed/],
      ["an export assignment", "const f = 1;\nexport = f;", /may hold only imports, functions with a body/],
      ["a statement at the top level", "Math.max = (a: number, b: number) => -1000;", /may hold only imports, functions with a body/],
      ["a declaration without a body", "declare function f(x: number): number;", /`declare` is not allowed/],
      ["an overload without a body", "export function f(x: number): number;\nexport function f(x: number): number {\n  return x;\n}", /may hold only imports, functions with a body/],
      ["a let", "let x = 1;", /may hold only imports, functions with a body/],
      ["an annotation in a block comment", "export function twice(x: number): number {\n  //@ ensures \\result >= x\n  /*\n  //@ ensures \\result === 3 * x\n  */\n  return x + x;\n}", /:5: `\/\/@` here is not in a `\/\/` comment/],
      ["an annotation in a doc comment", "/** //@ ensures \\result === 3 */\nexport function three(): number {\n  return 3;\n}", /:2: `\/\/@` here is not in a `\/\/` comment/],
      ["an annotation in a string", 'export const note = "//@ ensures false";', /`\/\/@` here is not in a `\/\/` comment/],
      ["an annotation in a template", "export const note = `${1} //@ ensures false`;", /`\/\/@` here is not in a `\/\/` comment/],
      ["a NUL character", "export const x = 1; // \0", /NUL characters are not allowed/],
      ["a carriage return in a comment", "export const x = 1; // \r hidden", /line break/],
      ["a Unicode line break in a comment", "export const x = 1; // \u2028 hidden", /line break/],
    ];
    for (const [what, code, message] of refused) assert.throws(() => checkVerifiedSource("src/x.ts", `//@ backend dafny\n${code}\n`), message, what);
    checkVerifiedSource("src/ledger.ts", read("src/ledger.ts"));
    checkVerifiedSource("src/x.ts", '//@ backend dafny\n// What the //@ lines promise.\nimport { type C, inv } from "../gen/c.ts";\nexport type D = C;\nexport interface E { c: C }\nconst limit = 3;\n//@ pure\nexport function f(c: C): boolean {\n  //@ ensures \\result === inv(c)\n  return inv(c) && limit > 0 || inv(c);\n}\n');
  });

  test("verified code that renames an import, or annotations in a file that is not .ts, fail the proof", async () => {
    const renamed = copyOfProject("src/guard.ts", () => '//@ backend dafny\nimport { canSubmit as canCancel, type Order } from "../gen/order.ts";\n//@ pure\nexport function cancellable(o: Order): boolean {\n  //@ ensures \\result === (o.status === "Pending")\n  return canCancel(o);\n}\n');
    const module = copyOfProject("src/dec.mts", () => "//@ backend dafny\nexport function dec(x: number): number {\n  //@ ensures \\result > x\n  return x - 1;\n}\n");
    const [r, m] = await Promise.all([run(renamed), run(module)]);
    assert.equal(r.said("proof", /src\/guard\.ts:2: `canSubmit as canCancel`: verified code may not rename what it imports/)?.ok, false, r.text);
    assert.equal(m.said("proof", /src\/dec\.mts: `\/\/@` appears in it, but only \.ts files under src\/ are proved/)?.ok, false, m.text);
  });

  test("hand-written code is not simulated, so none of its obligations can be accepted as simulated only", async () => {
    const root = fixtures(["door"], (f) => { f["src/inc.ts"] = "//@ backend dafny\n//@ pure\nexport function inc(x: number): number {\n  //@ ensures \\result === x\n  return x + 1;\n}\n"; });
    const { results } = await check(root, "unproved");
    const text = results.map(show).join("\n");
    const inc = results.find((r) => r.stage === "proof" && r.summary.startsWith("src-inc.ts: 1 of 1 obligations not proved"));
    assert.equal(inc?.ok, false, text);
    assert.match(inc!.summary, /Hand-written code is not simulated, so they must be proved/);
    assert.doesNotMatch(inc!.summary, /accept -- unproved/);
    const ledger = path.join(root, "spec/unproved.lock.json");
    assert.ok(!fs.existsSync(ledger) || !fs.readFileSync(ledger, "utf8").includes("src-inc.ts"), text);
  });
});
