/**
 * Builds a span for a Leaflet tooltip or popup. Leaflet interprets a string as HTML, so
 * pass a DOM node with textContent to display member names and areas as literal text.
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
