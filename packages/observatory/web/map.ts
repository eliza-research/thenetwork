// The Network on a real map of New York: members at their home neighborhoods (jittered), the
// relationships between them, open opportunities as dashed lines, meetings at the public venues
// they were scheduled at, and every venue the Network can suggest. Leaflet + CARTO dark tiles.
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { memberPoint, VENUES } from "../../network/src/geo.ts";
import type { ObsMember } from "../src/types.ts";
import { EDGE_STYLE, memberColor, OPP_COLOR } from "./graph.ts";
import { OPEN, store } from "./store.ts";

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
  private graphTick = -1;
  private oppVersion = "";
  private edgeKey = "";
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
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() { cancelAnimationFrame(this.raf); this.map.remove(); }

  focus(id: string) {
    const m = store.members.get(id);
    if (m) this.map.flyTo(this.point(m), Math.max(this.map.getZoom(), 14), { duration: 0.6 });
  }

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

  private sync() {
    const ui = store.ui;
    const sel = ui.selection?.kind === "member" ? ui.selection.id : null;
    const busy = store.busy();
    // Members (create once, restyle each update).
    for (const m of store.members.values()) {
      if (ui.city !== "all" && m.city !== ui.city) continue;
      let mk = this.members.get(m.id);
      if (!mk) {
        mk = L.circleMarker(this.point(m), { renderer: this.renderer, radius: 4 });
        mk.on("click", e => { if ((e.originalEvent as MouseEvent).shiftKey) store.togglePick(m.id); else store.select({ kind: "member", id: m.id }); });
        mk.bindTooltip(() => `${m.name} · ${m.area ?? ""}${m.trust && m.trust !== "ok" ? ` · ${m.trust}` : ""}`, { direction: "top" });
        mk.addTo(this.map);
        this.members.set(m.id, mk);
      }
      const picked = ui.picks.includes(m.id);
      const color = m.trust === "hold" ? "#ff3b4e" : m.trust === "watch" ? "#ff9a6b" : memberColor(m, ui.colorBy);
      mk.setStyle({
        color: picked ? "#ffd45c" : sel === m.id ? "#ffffff" : busy.has(m.id) ? "rgba(255,255,255,0.7)" : color,
        weight: picked || sel === m.id ? 3 : busy.has(m.id) ? 1.5 : 1,
        fillColor: color, fillOpacity: m.joined ? (m.state === "opted_out" ? 0.1 : 0.85) : 0.25,
      });
      mk.setRadius(3 + Math.min(5, Math.sqrt(m.counters.meetings * 2 + m.counters.accepted)));
    }
    // Relationships: rebuilt when the graph or the layer toggles change.
    const edgeKey = `${store.graphTick}|${JSON.stringify(ui.edgeTypes)}|${ui.city}|${sel}`;
    if (edgeKey !== this.edgeKey) {
      this.edgeKey = edgeKey;
      this.edgeLayer.clearLayers();
      for (const e of store.edges.values()) {
        if (!ui.edgeTypes[e.type]) continue;
        const a = store.members.get(e.from), b = store.members.get(e.to);
        if (!a || !b || (ui.city !== "all" && (a.city !== ui.city || b.city !== ui.city))) continue;
        const st = EDGE_STYLE[e.type]!;
        const focus = sel && (e.from === sel || e.to === sel);
        if (sel && !focus) continue;
        L.polyline([this.point(a), this.point(b)], { renderer: this.renderer, color: st.color, weight: focus ? st.width * 2 : st.width, opacity: focus ? 0.9 : Math.min(0.9, st.alpha * 2.2), dashArray: st.dash?.join(" "), interactive: false }).addTo(this.edgeLayer);
      }
    }
    // Opportunities and meetings: rebuilt when they change.
    const oppVersion = `${store.version}|${ui.showOpps}|${ui.city}`;
    if (oppVersion !== this.oppVersion) {
      this.oppVersion = oppVersion;
      this.oppLayer.clearLayers(); this.meetLayer.clearLayers();
      const meetings = new Map<string, { lat: number; lng: number; name: string; n: number; upcoming: number }>();
      for (const o of store.opps.values()) {
        const ms = o.participants.map(id => store.members.get(id)).filter((x): x is ObsMember => !!x);
        if (ms.length < 2) continue;
        if (o.venue && MEETING_STATES.has(o.state)) {
          const k = o.venue.name;
          const cur = meetings.get(k) ?? { ...o.venue, n: 0, upcoming: 0 };
          cur.n++; if (o.state === "SCHEDULED") cur.upcoming++;
          meetings.set(k, cur);
          if (ui.showOpps && o.state === "SCHEDULED") for (const m of ms) L.polyline([this.point(m), [o.venue.lat, o.venue.lng]], { renderer: this.renderer, color: OPP_COLOR.SCHEDULED, weight: 1.5, opacity: 0.8, interactive: false }).addTo(this.oppLayer);
          continue;
        }
        if (!ui.showOpps || !(OPEN.has(o.state) || o.source === "shadow")) continue;
        const color = o.source === "shadow" ? "#ffffff" : OPP_COLOR[o.state] ?? "#aaa";
        const line = L.polyline(ms.map(m => this.point(m)), { renderer: this.renderer, color, weight: o.source === "player" ? 2.5 : 1.5, opacity: 0.85, dashArray: o.state === "PROPOSED" ? "2 5" : "6 4" });
        line.on("click", () => store.select({ kind: "opportunity", id: o.id }));
        line.addTo(this.oppLayer);
      }
      for (const v of meetings.values()) {
        L.circleMarker([v.lat, v.lng], { renderer: this.renderer, radius: 6 + Math.min(10, v.n * 1.5), color: "#3dff9a", weight: 2, fillColor: "#3dff9a", fillOpacity: v.upcoming ? 0.45 : 0.18 })
          .bindTooltip(`${v.name}: ${v.n} meeting${v.n > 1 ? "s" : ""}${v.upcoming ? ` (${v.upcoming} upcoming)` : ""}`, { direction: "top" }).addTo(this.meetLayer);
      }
    }
  }
}
