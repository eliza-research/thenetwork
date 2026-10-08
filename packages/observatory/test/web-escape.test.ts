// OBS-01 (audit observatory-1, P1): a member's name or area is text in every map tooltip. Leaflet
// treats a string tooltip as HTML, so map.ts builds each tooltip as a DOM node (web/safe.ts). This
// runs the real Leaflet in a DOM (happy-dom) with hostile names: the markup shows as text, and no
// element and no handler is created. The control case shows that a string tooltip would create them.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { memberTooltipText, textNode } from "../web/safe.ts";

const HOSTILE = [
  `<img src=x onerror="globalThis.__xss++">`,
  `<b>bold</b> Smith`,
  `"><svg onload="globalThis.__xss++">`,
  `Ana <script>globalThis.__xss++</script>`,
  `<a href="javascript:globalThis.__xss++">click</a>`,
  `&lt;b&gt;already escaped&lt;/b&gt;`,
];

let win: Window;
let L: typeof import("leaflet");
let map: import("leaflet").Map;
let host: HTMLElement;
const g = globalThis as Record<string, unknown>;
const saved: Record<string, unknown> = {};

beforeAll(async () => {
  win = new Window({ url: "http://localhost/" });
  for (const k of ["window", "document", "navigator", "HTMLElement"]) saved[k] = g[k];
  Object.assign(g, { window: win, document: win.document, navigator: win.navigator, HTMLElement: win.HTMLElement, __xss: 0 });
  L = (await import("leaflet")).default;
  host = win.document.createElement("div") as unknown as HTMLElement;
  win.document.body.appendChild(host as never);
  map = L.map(host, { center: [40.73, -73.95], zoom: 12 });
});
afterAll(async () => {
  map?.remove();
  await win?.happyDOM.close();
  for (const [k, v] of Object.entries(saved)) g[k] = v;
  delete g.__xss;
});

/** Open a permanent tooltip with this content and return its element. */
function tooltip(content: string | HTMLElement): HTMLElement {
  const t = L.tooltip({ permanent: true }).setLatLng([40.73, -73.95]).setContent(content).addTo(map);
  const el = t.getElement()!;
  return el;
}

describe("map tooltips render member fields as text (OBS-01)", () => {
  test("hostile names and areas show literally: no img, b, svg, script or a element, no handler runs", async () => {
    for (const name of HOSTILE) {
      const el = tooltip(textNode(memberTooltipText({ name, area: name, minor: true, trust: "hold" }), win.document as unknown as Document));
      expect(el.textContent).toBe(`${name} · ${name} · Under 18 · hold`);
      for (const tag of ["img", "b", "svg", "script", "a"]) expect([name, tag, el.querySelector(tag)]).toEqual([name, tag, null]);
    }
    await Bun.sleep(20);
    expect(g.__xss).toBe(0);
  });

  test("control: the same name as a string tooltip becomes markup (what map.ts did before the fix)", () => {
    const el = tooltip(`${HOSTILE[1]} · Astoria`);
    expect(el.querySelector("b")?.textContent).toBe("bold");
  });
});
