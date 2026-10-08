// OBS-02 (audit observatory-1, P1): no string reaches an HTML sink in the console's browser code.
// A static scan of packages/observatory/web: every Leaflet tooltip and popup gets a DOM node (web/safe.ts
// textNode, or a function that returns one), and nothing sets innerHTML, outerHTML,
// insertAdjacentHTML, document.write or dangerouslySetInnerHTML.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dir, "..", "web");
/** The code without comments (a comment may name a sink to warn about it). */
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const files = readdirSync(WEB).filter(f => /\.(ts|tsx)$/.test(f)).map(f => ({ f, text: code(readFileSync(join(WEB, f), "utf8")) }));

/** The argument text of each call to `name(` (up to the matching parenthesis). */
function calls(text: string, name: string): string[] {
  const out: string[] = [];
  let i = text.indexOf(`${name}(`);
  while (i >= 0) {
    let depth = 0, j = i + name.length;
    for (; j < text.length; j++) { if (text[j] === "(") depth++; else if (text[j] === ")" && --depth === 0) break; }
    out.push(text.slice(i + name.length + 1, j));
    i = text.indexOf(`${name}(`, j);
  }
  return out;
}

describe("no string-HTML sinks with member fields (OBS-02)", () => {
  test("the scan sees the web code", () => {
    expect(files.map(x => x.f)).toEqual(expect.arrayContaining(["map.ts", "store.ts", "panels.tsx", "safe.ts"]));
  });

  test("every bindTooltip, bindPopup and setContent gets a DOM node, never a string or a template literal", () => {
    let n = 0;
    for (const { f, text } of files) for (const sink of ["bindTooltip", "bindPopup", "setContent"]) for (const arg of calls(text, sink)) {
      n++;
      const first = arg.trim();
      expect([f, sink, /^(textNode\(|\(\)\s*=>\s*textNode\()/.test(first)]).toEqual([f, sink, true]);
    }
    expect(n).toBeGreaterThanOrEqual(3);
  });

  test("no innerHTML, outerHTML, insertAdjacentHTML, document.write or dangerouslySetInnerHTML", () => {
    for (const { f, text } of files) expect([f, text.match(/\b(innerHTML|outerHTML|insertAdjacentHTML|document\.write|dangerouslySetInnerHTML)\b/)?.[0] ?? null]).toEqual([f, null]);
  });
});
