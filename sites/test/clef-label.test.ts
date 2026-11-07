// The real inline script of tools/clef-label/index.html, driven through its own handlers on a small DOM.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { coreBlock, inlined } from "../../tools/clef-label/build.ts";
import * as core from "../../tools/clef-label/core.ts";

const PAGE = join(import.meta.dir, "../../tools/clef-label/index.html");
const html = readFileSync(PAGE, "utf8");
const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;

type Line = Record<string, any>;
interface Opts { photos: string[]; dim?: string; seed?: number; store?: Map<string, string>; plan?: unknown[]; resume?: unknown[]; answers?: string[] }

function open(o: Opts) {
  const els = new Map<string, any>();
  const el = (id: string) => { if (!els.has(id)) els.set(id, { id, hidden: false, value: "", checked: false, files: [], textContent: "", src: "" }); return els.get(id); };
  let keydown: (e: unknown) => void = () => {};
  const store = o.store ?? new Map<string, string>();
  const answers = [...(o.answers ?? [])];
  const document = { getElementById: el, addEventListener: (_: string, f: (e: unknown) => void) => { keydown = f; }, createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } };
  const localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  const URL = { createObjectURL: (f: { name: string }) => "blob:" + f.name, revokeObjectURL() {} };
  new Function("document", "localStorage", "URL", "prompt", "confirm", "location", script)(document, localStorage, URL, () => answers.shift() ?? null, () => true, { reload() {} });
  const jsonl = (rows: unknown[]) => [{ text: async () => rows.map(r => JSON.stringify(r)).join("\n") }];
  el("attest").checked = true; el("rater").value = "r1"; el("seed").value = String(o.seed ?? 3); el("dimMode").value = o.dim ?? "overall";
  el("folder").onchange({ target: { files: o.photos.map(n => ({ name: n, webkitRelativePath: "root/" + n })) } });
  if (o.plan) el("plan").files = jsonl(o.plan);
  if (o.resume) el("resume").files = jsonl(o.resume);
  const key = (k: string) => keydown({ key: k, preventDefault() {} });
  const shown = () => el("pair").hidden ? null : [el("imgL").src.slice(5), el("imgR").src.slice(5)] as [string, string];
  const labels = (): Line[] => JSON.parse(store.get("clef-label:r1:" + (o.seed ?? 3)) ?? "[]");
  return { el, key, shown, labels, store, start: () => el("start").onclick() as Promise<void> };
}

const pairId = (a: string, b: string, dim: string) => [a, b].sort().join("|") + "|" + dim;
const names = (n: number) => Array.from({ length: n }, (_, i) => `p${String(i).padStart(2, "0")}.jpg`);

/** Answer until the page has no pair or the limit is reached. Returns every pair that it showed. */
function answerAll(p: ReturnType<typeof open>, limit: number) {
  const seen: string[][] = [];
  for (let i = 0; i < limit; i++) { const s = p.shown(); if (!s) break; seen.push(s); p.key(i % 2 ? "1" : "2"); }
  return seen;
}

describe("clef label page: a flagged photo never comes back", () => {
  test("not in a repeat pair", async () => {
    const p = open({ photos: names(12), dim: "rotate", answers: ["L", "1"] });
    await p.start();
    answerAll(p, 60);
    const bad = p.shown()![0];
    p.key("f");
    expect(p.labels().at(-1)).toMatchObject({ flag: bad, reason: "may be under 18" });
    const after = answerAll(p, 2000);
    expect(after.length).toBeGreaterThan(50);
    expect(after.flat()).not.toContain(bad);
    expect(p.labels().some(l => l.repeat)).toBe(true);
  });

  test("not in a plan row", async () => {
    const [a, b, c, d] = names(4) as [string, string, string, string];
    const plan = [{ a, b, dim: "face" }, { a, b: c, dim: "face" }, { a: c, b: a, dim: "body" }, { a: c, b: d, dim: "face" }];
    const p = open({ photos: names(4), plan, answers: ["L", "1"] });
    await p.start();
    expect(p.shown()).toEqual([a, b]);
    p.key("f");
    expect(p.shown()).toEqual([c, d]);
    p.key("1");
    expect(p.shown()).toBeNull();
    expect(p.labels().filter(l => l.a).map(l => l.a)).toEqual([c]);
  });

  test("not after a resume from this browser or from a saved labels file", async () => {
    const bad = names(6)[2]!;
    const flagLine = { flag: bad, reason: "may be under 18", rater: "r1", t: "2026-11-07T00:00:00.000Z" };
    const stored = open({ photos: names(6), store: new Map([["clef-label:r1:3", JSON.stringify([flagLine])]]) });
    await stored.start();
    const fromFile = open({ photos: names(6), resume: [flagLine] });
    await fromFile.start();
    for (const p of [stored, fromFile]) {
      const seen = answerAll(p, 200);
      expect(seen.length).toBeGreaterThan(3);
      expect(seen.flat()).not.toContain(bad);
    }
  });

  test("a resume that leaves fewer than two photos stops on the existing message", async () => {
    const [a, b] = names(2) as [string, string];
    const p = open({ photos: [a, b], store: new Map([["clef-label:r1:3", JSON.stringify([{ flag: b, reason: "other", rater: "r1", t: "x" }])]]) });
    await p.start();
    expect(p.shown()).toBeNull();
    expect(p.el("question").textContent).toContain("Too few unflagged photos");
  });
});

describe("clef label page: undo", () => {
  test("the undone pair is not shown again, as the note says", async () => {
    const p = open({ photos: names(6), dim: "face" });
    await p.start();
    answerAll(p, 12);
    const last = p.labels().at(-1)!;
    p.key("u");
    expect(p.labels().find(l => l.t === last.t && l.a === last.a && l.b === last.b)).toBeUndefined();
    expect(p.el("saved").textContent).toContain("not shown again");
    const after = answerAll(p, 2000);
    expect(after.length).toBeGreaterThan(0);
    expect(after.map(([a, b]) => pairId(a!, b!, "face"))).not.toContain(pairId(last.a, last.b, "face"));
  });

  test("undo of a repeat line keeps the first answer of that pair closed", async () => {
    const p = open({ photos: names(8), dim: "rotate", seed: 5 });
    await p.start();
    for (let i = 0; i < 400 && !p.labels().at(-1)?.repeat; i++) p.key("1");
    const rep = p.labels().at(-1)!;
    expect(rep.repeat).toBe(true);
    const before = p.labels().length;
    p.key("u");
    expect(p.labels()).toHaveLength(before - 1);
    expect(p.labels().filter(l => pairId(l.a ?? "x", l.b ?? "y", l.dim) === pairId(rep.a, rep.b, rep.dim) && !l.repeat)).toHaveLength(1);
    answerAll(p, 2000);
    expect(p.labels().filter(l => pairId(l.a ?? "x", l.b ?? "y", l.dim) === pairId(rep.a, rep.b, rep.dim) && !l.repeat)).toHaveLength(1);
  });

  test("undo never removes a flag line; it removes the answer before it", async () => {
    const p = open({ photos: names(6), answers: ["L", "1"] });
    await p.start();
    p.key("1");
    const answered = p.labels().at(-1)!;
    const bad = p.shown()![0];
    p.key("f");
    p.key("u");
    expect(p.labels().map(l => l.flag ?? l.a)).toEqual([bad]);
    expect(p.labels().find(l => l.a === answered.a)).toBeUndefined();
    p.key("u");
    expect(p.labels()).toHaveLength(1);
    const again = open({ photos: names(6), store: p.store });
    await again.start();
    expect(answerAll(again, 200).flat()).not.toContain(bad);
  });
});

describe("clef label page: build", () => {
  test("the inlined block is the build output of core.ts, and the page stays local", () => {
    expect(inlined(html)).toBe(html);
    expect(script).toContain(coreBlock());
    for (const name of Object.keys(core)) expect(script).toContain(`function ${name}(`);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("connect-src 'none'");
    expect((html.match(/<script\b/g) ?? []).length).toBe(1);
    expect(html).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|https?:\/\/|<link\b|<form\b|\bimport\s*\(/i);
  });
});
