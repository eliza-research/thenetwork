// Text for Leaflet tooltips and popups. Leaflet treats a string as HTML, so a member's name or area
// written as "<img src=x onerror=...>" would run in a staff browser (audit observatory-1). Every
// tooltip is built here as a DOM node whose text is set with textContent: the markup shows as text.
// web-sinks.test.ts checks that no tooltip, popup or innerHTML in the web code takes a string.

/** A <span> showing `text` literally. */
export function textNode(text: string, doc: Document = document): HTMLElement {
  const el = doc.createElement("span");
  el.textContent = text;
  return el;
}

/** The member tooltip: name, area, and the under-18 and trust markers. */
export function memberTooltipText(m: { name: string; area?: string; minor?: boolean; trust?: string }): string {
  return `${m.name} · ${m.area ?? ""}${m.minor ? " · Under 18" : ""}${m.trust === "hold" ? " · hold" : m.trust === "watch" ? " · watch" : ""}`;
}
