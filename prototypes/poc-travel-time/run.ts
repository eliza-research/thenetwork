// P15 PoC: is an H3-cell heuristic travel-time estimate within 25% of a routing engine?
// Members are stored at H3 res-8 cells (~0.7 km2, "neighborhood" precision, SEC-004); the engine
// must estimate travel time between two cells without calling a maps API for every candidate pair.
// Reference: public OSRM (car, free-flow) and routing.openstreetmap.de (foot, bike). Transit is not
// covered by any free router here; see RESULTS.md.
import { latLngToCell, cellToLatLng } from "h3-js";
import { writeFileSync, existsSync, readFileSync } from "node:fs";

type Pt = [number, number]; // lat, lng
const SF: Pt[] = [[37.7599, -122.4148], [37.7749, -122.4194], [37.7955, -122.4058], [37.8008, -122.4380], [37.7694, -122.4862],
  [37.7609, -122.4350], [37.7487, -122.4158], [37.7849, -122.4294], [37.7793, -122.3893], [37.7325, -122.4344],
  [37.7680, -122.4469], [37.7900, -122.4220], [37.7766, -122.4950], [37.7432, -122.4730], [37.7270, -122.4580],
  [37.8030, -122.4100], [37.7577, -122.3920], [37.7880, -122.4070], [37.7830, -122.4600], [37.7340, -122.3900]];
const NYC: Pt[] = [[40.7128, -74.0060], [40.7306, -73.9866], [40.7484, -73.9857], [40.7831, -73.9712], [40.8075, -73.9626],
  [40.7081, -73.9571], [40.6782, -73.9442], [40.6928, -73.9903], [40.7216, -73.9969], [40.7420, -74.0048],
  [40.7614, -73.9776], [40.6501, -73.9496], [40.7282, -73.7949], [40.7447, -73.9485], [40.7580, -73.9190],
  [40.6892, -73.9810], [40.7357, -74.0036], [40.7003, -73.9180], [40.8150, -73.9450], [40.6720, -73.9770]];

const rng = (() => { let s = 42; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32; })();
const jitter = ([la, ln]: Pt): Pt => [la + (rng() - 0.5) * 0.01, ln + (rng() - 0.5) * 0.012];
const cellCenter = (p: Pt): Pt => cellToLatLng(latLngToCell(p[0], p[1], 8)) as Pt;
function km([a, b]: Pt, [c, d]: Pt) {
  const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
}

const MODES = {
  car: "https://router.project-osrm.org/route/v1/driving",
  foot: "https://routing.openstreetmap.de/routed-foot/route/v1/foot",
  bike: "https://routing.openstreetmap.de/routed-bike/route/v1/bike",
} as const;
type Mode = keyof typeof MODES;

const CACHE = "cache.json";
const cache: Record<string, number> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
async function route(mode: Mode, a: Pt, b: Pt): Promise<number | null> {
  const key = `${mode}:${a.map(x => x.toFixed(5))}:${b.map(x => x.toFixed(5))}`;
  if (key in cache) return cache[key]!;
  await Bun.sleep(1100); // <=1 req/s per public server
  const res = await fetch(`${MODES[mode]}/${a[1]},${a[0]};${b[1]},${b[0]}?overview=false`,
    { headers: { "User-Agent": "thenetwork-poc-travel-time/0.1 (research prototype)" } }).catch(() => null);
  if (!res?.ok) return null;
  const j: any = await res.json();
  const sec = j?.routes?.[0]?.duration;
  if (typeof sec !== "number") return null;
  cache[key] = sec / 60;
  writeFileSync(CACHE, JSON.stringify(cache));
  return cache[key]!;
}

// Pairs: true endpoints (what routing sees) and the res-8 cell centers (what the engine knows).
const N = Number(process.env.PAIRS ?? 60);
const pairs: { city: string; a: Pt; b: Pt; distKm: number }[] = [];
for (const [city, pts] of [["SF", SF], ["NYC", NYC]] as const)
  for (let i = 0; i < N / 2; i++) {
    const a = jitter(pts[Math.floor(rng() * pts.length)]!), b = jitter(pts[Math.floor(rng() * pts.length)]!);
    pairs.push({ city, a, b, distKm: km(cellCenter(a), cellCenter(b)) });
  }

const rows: { city: string; mode: Mode; distKm: number; ref: number }[] = [];
for (const mode of Object.keys(MODES) as Mode[])
  for (const p of pairs) {
    const ref = await route(mode, p.a, p.b);
    if (ref != null) rows.push({ city: p.city, mode, distKm: p.distKm, ref });
  }

// Heuristic: minutes = overhead + distKm * minPerKm, fitted per mode (and city for car) on even rows, tested on odd rows.
const fit = (xs: { distKm: number; ref: number }[]) => {
  const n = xs.length, mx = xs.reduce((s, r) => s + r.distKm, 0) / n, my = xs.reduce((s, r) => s + r.ref, 0) / n;
  const slope = xs.reduce((s, r) => s + (r.distKm - mx) * (r.ref - my), 0) / (xs.reduce((s, r) => s + (r.distKm - mx) ** 2, 0) || 1);
  return { slope, icpt: my - slope * mx };
};
const out: string[] = ["| Mode | City | Pairs (test) | Fitted min/km | Overhead min | Median abs err | Within 25% | Within 25% (trips > 10 min) |", "|---|---|---|---|---|---|---|---|"];
for (const mode of Object.keys(MODES) as Mode[])
  for (const city of ["SF", "NYC"]) {
    const rs = rows.filter(r => r.mode === mode && r.city === city);
    const train = rs.filter((_, i) => i % 2 === 0), test = rs.filter((_, i) => i % 2 === 1);
    if (train.length < 3 || !test.length) continue;
    const { slope, icpt } = fit(train);
    const errs = test.map(r => ({ e: Math.abs(icpt + slope * r.distKm - r.ref) / r.ref, long: r.ref > 10 }));
    const med = errs.map(x => x.e).sort((a, b) => a - b)[Math.floor(errs.length / 2)]!;
    const w = (xs: typeof errs) => xs.length ? `${Math.round(100 * xs.filter(x => x.e <= 0.25).length / xs.length)}% (n=${xs.length})` : "n/a";
    out.push(`| ${mode} | ${city} | ${test.length} | ${slope.toFixed(2)} | ${icpt.toFixed(1)} | ${(med * 100).toFixed(0)}% | ${w(errs)} | ${w(errs.filter(x => x.long))} |`);
  }
console.log(out.join("\n"));
writeFileSync("results-table.md", out.join("\n") + "\n");
