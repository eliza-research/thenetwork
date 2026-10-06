import { getRobots, isAllowed } from "../src/http";
// usage: bun scripts/robots-check.ts <url>...
for (const u of process.argv.slice(2)) {
  const url = new URL(u);
  const r = await getRobots(url.origin);
  console.log(isAllowed(r, url.pathname + url.search) ? "ALLOW   " : "DISALLOW", u, r ? `(delay=${r.crawlDelay ?? "-"}, ${r.disallow.length} disallow rules)` : "(no robots)");
}
