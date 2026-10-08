// The Network on a real map of New York: members at their home neighborhoods (jittered), the
// relationships between them, open opportunities as dashed lines, meetings at the public venues
// they were scheduled at, and every venue the Network can suggest. Leaflet + OSM tiles.
// Filters and focus come from the store: the borough filter hides members, the members filter and
// the focus dim them, and a focus change flies (member) or fits (opportunity, neighborhood) once.
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { memberPoint, NEIGHBORHOOD, VENUES } from "@thenetwork/network/geo"; // geo only: the package root pulls server code into the browser bundle
import type { ObsMember } from "../src/types.ts";
import { EDGE_STYLE, memberColor, OPP_COLOR } from "./graph.ts";
import { focusKey, OPEN, store } from "./store.ts";

const NYC: L.LatLngExpression = [40.73, -73.95];
const MEETING_STATES = new Set(["SCHEDULED", "COMPLETED", "FEEDBACK_COLLECTED"]);

export class MapView {
  private map: L.Map;
  private renderer = L.canvas({ padding: 0.3 });
  private members = new Map<string, L.CircleMarker>();
  private edgeLayer = L.layerGroup();
  private oppLayer = L.layerGroup();
  private venueLayer = L.layerGroup();
  private meetLayer = L.layerGroup();
  private oppVersion = "";
  private edgeKey = "";
  private lastFocusKey = "";
  private lastBorough = "all";
  private raf = 0;
  private last = 0;

  constructor(el: HTMLElement) {
    this.map = L.map(el, { zoomControl: true, preferCanvas: true, attributionControl: true }).setView(NYC, 12);
    // OpenStreetMap's standard tiles (attribution required; light, local use per the OSM tile policy),
    // darkened with a CSS filter (.nyc-map .tiles-dark) to match the observatory.
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, className: "tiles-dark",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(this.map);
    this.edgeLayer.addTo(this.map); this.oppLayer.addTo(this.map); this.meetLayer.addTo(this.map); this.venueLayer.addTo(this.map);
    for (const v of VENUES) {
      L.circleMarker([v.lat, v.lng], { renderer: this.renderer, radius: 3.5, color: "#ffd45c", weight: 1, fillColor: "#ffd45c", fillOpacity: 0.25 })
        .bindTooltip(`${v.name} · ${v.neighborhood}`, { direction: "top" }).addTo(this.venueLayer);
    }
    if (store.pendingFly) { this.map.setView([store.pendingFly.lat, store.pendingFly.lng], 15); store.pendingFly = null; this.lastFocusKey = focusKey(store.ui.focus); }
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() { cancelAnimationFrame(this.raf); this.map.remove(); }

  focus(id: string) {
    const m = store.members.get(id);
    if (m) this.map.flyTo(this.point(m), Math.max(this.map.getZoom(), 14), { duration: 0.6 });
  }

  /** Fly to a venue or any lat/lng (the opportunity view's venue link). */
  flyTo(lat: number, lng: number) { this.map.flyTo([lat, lng], Math.max(this.map.getZoom(), 15), { duration: 0.6 }); }

  private point(m: ObsMember): L.LatLngExpression {
    const p = memberPoint(m.id, m.area);
    return [p.lat, p.lng];
  }

  private frame = (t: number) => {
    this.raf = requestAnimationFrame(this.frame);
    if (t - this.last < 250) return; // 4 updates a second is plenty for a map
    this.last = t;
    this.sync();
  };

  /** On a focus change: fly to a member, or fit the bounds of an opportunity or neighborhood, once. */
  private followFocus() {
    const f = store.ui.focus, key = focusKey(f);
    if (key === this.lastFocusKey || (f && !store.members.size)) return; // wait for data before following a focus from the URL
    this.lastFocusKey = key;
    if (!f) return;
    if (f.kind === "member") { this.focus(f.id); return; }
    const pts: L.LatLngExpression[] = [];
    if (f.kind === "opportunity") {
      const o = store.opps.get(f.id);
      for (const id of [...(o?.participants ?? []), ...(o?.alternates ?? [])]) { const m = store.members.get(id); if (m) pts.push(this.point(m)); }
      if (o?.venue) pts.push([o.venue.lat, o.venue.lng]);
    } else {
      for (const m of store.members.values()) if (m.area === f.id) pts.push(this.point(m));
      const n = NEIGHBORHOOD.get(f.id);
      if (!pts.length && n) pts.push([n.lat, n.lng]);
    }
    if (pts.length === 1) this.map.flyTo(pts[0]!, Math.max(this.map.getZoom(), 14), { duration: 0.6 });
    else if (pts.length > 1) this.map.flyToBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 15, duration: 0.6 });
  }

  private sync() {
    const ui = store.ui;
    const f = ui.focus;
    const sel = f?.kind === "member" ? f.id : null;
    const area = f?.kind === "neighborhood" ? f.id : null;
    const busy = store.busy();
    const bright = store.focusSet();
    this.followFocus();
    if (ui.filters.borough !== this.lastBorough && store.members.size) {
      // A new borough: fit the members it shows (unless a focus already moved the map).
      this.lastBorough = ui.filters.borough;
      const pts = [...store.members.values()].filter(m => store.inBorough(m)).map(m => this.point(m));
      if (!f && pts.length > 1) this.map.flyToBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 14, duration: 0.6 });
    }
    // Members (create once, restyle each update). The borough filter hides; the members filter and the focus dim.
    for (const m of store.members.values()) {
      let mk = this.members.get(m.id);
      const shown = store.inBorough(m) || !!bright?.has(m.id); // the focus and the picks stay visible outside the borough
      if (!shown) { if (mk) { mk.remove(); this.members.delete(m.id); } continue; }
      if (!mk) {
        mk = L.circleMarker(this.point(m), { renderer: this.renderer, radius: 4 });
        mk.on("click", e => { if ((e.originalEvent as MouseEvent).shiftKey) store.togglePick(m.id); else store.focus({ kind: "member", id: m.id }); });
        mk.bindTooltip(() => {
          const cur = store.members.get(m.id) ?? m;
          return `${cur.name} · ${cur.area ?? ""}${cur.minor ? " · Under 18" : ""}${cur.trust === "hold" ? " · hold" : cur.trust === "watch" ? " · watch" : ""}`;
        }, { direction: "top" });
        mk.addTo(this.map);
        this.members.set(m.id, mk);
      }
      const picked = ui.picks.includes(m.id);
      const dim = (bright && !bright.has(m.id)) || !store.matchMemberFilter(m);
      const color = m.trust === "hold" ? "#ff3b4e" : m.trust === "watch" ? "#ff9a6b" : memberColor(m, ui.colorBy);
      mk.setStyle({
        color: picked ? "#ffd45c" : sel === m.id ? "#ffffff" : busy.has(m.id) && !dim ? "rgba(255,255,255,0.7)" : color,
        weight: picked || sel === m.id ? 3 : busy.has(m.id) && !dim ? 1.5 : 1,
        opacity: dim ? 0.3 : 1,
        fillColor: color, fillOpacity: dim ? 0.15 : m.joined ? (m.state === "opted_out" ? 0.1 : 0.85) : 0.25,
      });
      mk.setRadius(3 + Math.min(5, Math.sqrt(m.counters.meetings * 2 + m.counters.accepted)));
    }
    // Relationships: rebuilt when the graph, the layer toggles, the borough or the focus change.
    const edgeKey = `${store.graphTick}|${JSON.stringify(ui.edgeTypes)}|${ui.filters.borough}|${focusKey(f)}`;
    if (edgeKey !== this.edgeKey) {
      this.edgeKey = edgeKey;
      this.edgeLayer.clearLayers();
      for (const e of store.edges.values()) {
        if (!ui.edgeTypes[e.type]) continue;
        const a = store.members.get(e.from), b = store.members.get(e.to);
        if (!a || !b || !store.inBorough(a) || !store.inBorough(b)) continue;
        if (sel && e.from !== sel && e.to !== sel) continue;
        if (area && (a.area !== area || b.area !== area)) continue;
        const st = EDGE_STYLE[e.type]!;
        const strong = !!sel || !!area;
        L.polyline([this.point(a), this.point(b)], { renderer: this.renderer, color: st.color, weight: strong ? st.width * 2 : st.width, opacity: strong ? 0.9 : Math.min(0.9, st.alpha * 2.2), dashArray: st.dash?.join(" "), interactive: false }).addTo(this.edgeLayer);
      }
    }
    // Opportunities and meetings: rebuilt when they, the filters or the focus change.
    const oppVersion = `${store.version}|${ui.showOpps}|${JSON.stringify(ui.filters)}|${focusKey(f)}|${Math.floor(store.now() / 3_600_000)}`;
    if (oppVersion !== this.oppVersion) {
      this.oppVersion = oppVersion;
      this.oppLayer.clearLayers(); this.meetLayer.clearLayers();
      const meetings = new Map<string, { lat: number; lng: number; name: string; n: number; upcoming: number; opps: string[] }>();
      for (const o of store.opps.values()) {
        const ms = o.participants.map(id => store.members.get(id)).filter((x): x is ObsMember => !!x);
        if (ms.length < 2 || !store.matchOpp(o)) continue;
        const focused = f?.kind === "opportunity" && f.id === o.id;
        const faded = !!bright && !focused && !o.participants.some(id => bright.has(id));
        if (o.venue && MEETING_STATES.has(o.state)) {
          const k = o.venue.name;
          const cur = meetings.get(k) ?? { ...o.venue, n: 0, upcoming: 0, opps: [] };
          cur.n++; cur.opps.push(o.id); if (o.state === "SCHEDULED") cur.upcoming++;
          meetings.set(k, cur);
          if (ui.showOpps && o.state === "SCHEDULED") for (const m of ms) L.polyline([this.point(m), [o.venue.lat, o.venue.lng]], { renderer: this.renderer, color: OPP_COLOR.SCHEDULED, weight: focused ? 3 : 1.5, opacity: faded ? 0.15 : 0.8, interactive: false }).addTo(this.oppLayer);
          continue;
        }
        if (!ui.showOpps || !(OPEN.has(o.state) || o.source === "shadow")) continue;
        const color = o.source === "shadow" ? "#ffffff" : OPP_COLOR[o.state] ?? "#aaa";
        const dash = o.state === "IN_REVIEW" ? "1 4" : o.state === "PROPOSED" ? "2 5" : "6 4";
        const line = L.polyline(ms.map(m => this.point(m)), { renderer: this.renderer, color, weight: focused ? 4 : o.source === "player" ? 2.5 : 1.5, opacity: faded ? 0.15 : 0.85, dashArray: dash });
        line.on("click", () => store.focus({ kind: "opportunity", id: o.id }));
        line.addTo(this.oppLayer);
      }
      for (const v of meetings.values()) {
        const mk = L.circleMarker([v.lat, v.lng], { renderer: this.renderer, radius: 6 + Math.min(10, v.n * 1.5), color: "#3dff9a", weight: 2, fillColor: "#3dff9a", fillOpacity: v.upcoming ? 0.45 : 0.18 })
          .bindTooltip(`${v.name}: ${v.n} meeting${v.n > 1 ? "s" : ""}${v.upcoming ? ` (${v.upcoming} upcoming)` : ""}`, { direction: "top" });
        mk.on("click", () => {
          if (v.opps.length === 1) { store.focus({ kind: "opportunity", id: v.opps[0]! }); return; }
          const venue = VENUES.find(x => x.name === v.name);
          if (venue) store.focus({ kind: "neighborhood", id: venue.neighborhood });
        });
        mk.addTo(this.meetLayer);
      }
    }
  }
}
