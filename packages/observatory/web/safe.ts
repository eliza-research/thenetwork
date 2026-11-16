/**
 * A <span> that shows `text` literally. Leaflet reads a tooltip string as HTML, so a name or area such as
 * "<img src=x onerror=...>" would run in a staff browser (audit observatory-1). Build every tooltip and popup with this
 * node: its text is set with textContent, so markup shows as text. No tooltip, popup or innerHTML in the web code takes a string.
 */
export function textNode(text: string, doc: Document = document): HTMLElement {
  const el = doc.createElement("span");
  el.textContent = text;
  return el;
}

/** The member tooltip: name, area, and the under-18 and trust markers. */
export function memberTooltipText(m: { name: string; area?: string; minor?: boolean; trust?: string }): string {
  return `${m.name} · ${m.area ?? ""}${m.minor ? " · Under 18" : ""}${m.trust === "hold" ? " · hold" : m.trust === "watch" ? " · watch" : ""}`;
}
