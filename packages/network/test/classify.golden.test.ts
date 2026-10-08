// Golden corpora for the offline understanding rules (audit 2026-10-08 test plan NET-03, NET-12,
// NET-14, NET-20, NET-22 and the parser launch gates). Every line was written by hand for these
// tests, in members' own words, never by the simulator's templates. The *-heldout files were written
// after the rules were tuned and were scored once before any fix (docs/results/2026-10-08-network-hardening.md).
// The corpora are append-only: a misread found in the wild is added here, then fixed.
import { describe, expect, test } from "bun:test";
import { classify, extractProfile, otherAgeStated, parseProbeReply } from "../src/classify.ts";

const dir = `${import.meta.dir}/fixtures`;
const jsonl = async <T>(name: string): Promise<T[]> => (await Bun.file(`${dir}/${name}`).text()).trim().split("\n").filter(Boolean).map(l => JSON.parse(l) as T);
const OPTIONS = [{ key: "a", start: 1, end: 2, label: "Thursday 7pm" }, { key: "b", start: 3, end: 4, label: "Saturday 11am" }, { key: "c", start: 5, end: 6, label: "Sunday 2pm" }];

describe("consent replies (NET-03; parser gates: accuracy >= 97%, refusals read as yes = 0)", () => {
  for (const file of ["consent-replies.jsonl", "consent-heldout.jsonl"]) test(file, async () => {
    const lines = await jsonl<{ text: string; label: "yes" | "no" | "unclear"; keys?: string[] }>(file);
    expect(lines.length).toBeGreaterThanOrEqual(file === "consent-replies.jsonl" ? 300 : 75);
    let ok = 0;
    const notYesAsYes: string[] = [], misses: string[] = [];
    for (const l of lines) {
      const r = parseProbeReply(l.text, OPTIONS);
      if (r.answer === l.label && (!l.keys || JSON.stringify(r.keys) === JSON.stringify(l.keys))) ok++;
      else misses.push(`${l.text} -> ${r.answer} ${r.keys.join(",")}`);
      if (l.label !== "yes" && r.answer === "yes") notYesAsYes.push(l.text);
    }
    expect(notYesAsYes).toEqual([]);
    expect([ok / lines.length >= 0.97, misses]).toEqual([true, expect.any(Array)]);
  });
});

describe("benign and abuse corpora (NET-12; gate: benign precision >= 99%, abuse recall >= 95%)", () => {
  test("benign adult phrasing gives no abuse and no minor signal", async () => {
    const lines = (await Bun.file(`${dir}/benign-adult.txt`).text()).trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(200);
    const flagged = lines.filter(t => classify(t).abuse.length);
    expect(1 - flagged.length / lines.length).toBeGreaterThanOrEqual(0.99);
    expect(lines.filter(t => classify(t).minorSignal)).toEqual([]);
  });
  test("real abuse is still caught, as the right kind", async () => {
    const lines = await jsonl<{ text: string; kind: string }>("abuse.jsonl");
    expect(lines.length).toBeGreaterThanOrEqual(100);
    const caught = lines.filter(l => classify(l.text).abuse.length);
    expect(caught.length / lines.length).toBeGreaterThanOrEqual(0.95);
    const wrongKind = lines.filter(l => classify(l.text).abuse.length && !classify(l.text).abuse.includes(l.kind as never)).map(l => l.text);
    expect(wrongKind.length / lines.length).toBeLessThanOrEqual(0.05);
  });
});

describe("teen and third-party age statements (NET-14; gate: teen recall >= 95%)", () => {
  test("teen phrasings read as under 18; adult and teacher phrasings never do; third-party ages are read", async () => {
    const lines = await jsonl<{ text: string; teen?: boolean; other?: number | null }>("teen-age.jsonl");
    expect(lines.length).toBeGreaterThanOrEqual(150);
    const self = lines.filter(l => l.teen !== undefined);
    const minor = (t: string) => { const c = classify(t); return c.minorSignal || (c.statedAge !== undefined && c.statedAge < 18); };
    const teens = self.filter(l => l.teen), adults = self.filter(l => !l.teen);
    expect(teens.filter(l => minor(l.text)).length / teens.length).toBeGreaterThanOrEqual(0.95);
    expect(adults.filter(l => minor(l.text)).map(l => l.text)).toEqual([]);
    for (const l of lines.filter(l => l.other !== undefined)) expect([l.text, otherAgeStated(l.text) ?? null]).toEqual([l.text, l.other ?? null]);
  });
});

describe("paraphrased wants and areas (NET-20; gate: recall >= 0.8 per want, false positives <= 0.05, area recall >= 0.9)", () => {
  test("every want is read from members' own words, and nothing else is", async () => {
    const lines = await jsonl<{ text: string; desire: string | null }>("paraphrases.jsonl");
    const ids = [...new Set(lines.map(l => l.desire).filter((x): x is string => !!x))];
    expect(ids.length).toBe(20);
    for (const id of ids) {
      const pos = lines.filter(l => l.desire === id), neg = lines.filter(l => l.desire !== id);
      const recall = pos.filter(l => extractProfile(l.text).desireIds.includes(id)).length / pos.length;
      const fpr = neg.filter(l => extractProfile(l.text).desireIds.includes(id)).length / neg.length;
      expect([id, recall >= 0.8, fpr <= 0.05]).toEqual([id, true, true]);
    }
  });
  test("neighborhoods in members' own words; an unknown place is undefined, never a default", async () => {
    const lines = await jsonl<{ text: string; area: string | null }>("areas.jsonl");
    expect(lines.length).toBeGreaterThanOrEqual(190);
    const known = lines.filter(l => l.area), unknown = lines.filter(l => !l.area);
    expect(known.filter(l => extractProfile(l.text).area === l.area).length / known.length).toBeGreaterThanOrEqual(0.9);
    expect(unknown.filter(l => extractProfile(l.text).area !== undefined).map(l => l.text)).toEqual([]);
    expect(extractProfile("I live in Hoboken").areaUnknown).toBe(true);
  });
});

describe("negated wants (NET-22)", () => {
  test("a negated want is no want, no interest and no request", async () => {
    const lines = await jsonl<{ text: string }>("negations.jsonl");
    expect(lines.length).toBeGreaterThanOrEqual(100);
    const bad = lines.filter(l => { const x = extractProfile(l.text); return x.desireIds.length || x.interests.length || classify(l.text).kind === "people_request"; }).map(l => l.text);
    expect(bad).toEqual([]);
  });
});
