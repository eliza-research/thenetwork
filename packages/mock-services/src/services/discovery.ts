import { escapeXml, jsonResponse, type ServiceContext, type ServiceResult } from "../http-helpers.ts";

const CITY_VENUES: Record<string, Array<{ name: string; neighborhood: string; address: string; category: string }>> = {
  nyc: [
    { name: "Bleecker Roasters", neighborhood: "West Village", address: "148 Bleecker St", category: "coffee_shop" },
    { name: "Prospect Books & Tea", neighborhood: "Park Slope", address: "312 7th Ave", category: "bookstore_cafe" },
    { name: "Dimes Square Listening Bar", neighborhood: "Lower East Side", address: "84 Canal St", category: "community_space" },
  ],
  sf: [
    { name: "Valencia Foundry Coffee", neighborhood: "Mission", address: "840 Valencia St", category: "coffee_shop" },
    { name: "North Beach Espresso Club", neighborhood: "North Beach", address: "1420 Grant Ave", category: "cafe" },
  ],
  la: [
    { name: "Silver Lake Vinyl Cafe", neighborhood: "Silver Lake", address: "3510 Sunset Blvd", category: "coffee_shop" },
  ],
  chicago: [
    { name: "Logan Square Hearth", neighborhood: "Logan Square", address: "2522 N Milwaukee Ave", category: "cafe" },
  ],
  miami: [
    { name: "Wynwood Courtyard Roasters", neighborhood: "Wynwood", address: "261 NW 26th St", category: "coffee_shop" },
  ],
  austin: [
    { name: "East Sixth Analog Coffee", neighborhood: "East Austin", address: "1704 E 6th St", category: "coffee_shop" },
  ],
};

export function handleDiscoveryRequest(
  ctx: ServiceContext,
  req: Request,
  url: URL,
): ServiceResult | null {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (!path.startsWith("/discovery/")) return null;
  if (req.method !== "GET") {
    return { service: "discovery", response: jsonResponse({ error: "method_not_allowed" }, 405) };
  }

  const nowMs = ctx.registry.clock.now();
  const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") ?? url.searchParams.get("$limit") ?? 10) || 10));

  if (path === "/discovery/hn") {
    const query = url.searchParams.get("query") ?? "nyc";
    const hits = Array.from({ length: Math.min(limit, 5) }, (_, i) => ({
      objectID: `hn_${ctx.state.seed}_${i + 1}`,
      title: `${query} builders meetup & local community thread #${i + 1}`,
      author: `builder_${ctx.state.seed}_${i + 1}`,
      url: `https://news.ycombinator.com/item?id=${40_000_000 + i}`,
      points: 45 + i * 18,
      created_at: new Date(nowMs - (i + 1) * 3_600_000).toISOString(),
    }));
    return { service: "discovery", response: jsonResponse({ hits }) };
  }

  if (path === "/discovery/github") {
    const q = url.searchParams.get("q") ?? "location:NYC";
    const items = Array.from({ length: Math.min(limit, 5) }, (_, i) => ({
      id: 1000 + i,
      login: `oss_maintainer_${ctx.state.seed}_${i + 1}`,
      html_url: `https://github.com/oss_maintainer_${ctx.state.seed}_${i + 1}`,
      bio: `Principal engineer in ${q}`,
    }));
    return { service: "discovery", response: jsonResponse({ total_count: items.length, items }) };
  }

  if (path === "/discovery/arxiv") {
    const q = url.searchParams.get("search_query") ?? "cs.AI";
    const entries = Array.from({ length: Math.min(limit, 3) }, (_, i) =>
      `<entry><id>http://arxiv.org/abs/2611.000${i + 1}</id><title>${escapeXml(`Local Graph Coordination ${i + 1} (${q})`)}</title><author><name>Dr. Maya Patel ${i + 1}</name></author><summary>Research paper summary for ${escapeXml(q)}.</summary></entry>`,
    ).join("");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">${entries}</feed>`;
    return {
      service: "discovery",
      response: new Response(xml, { status: 200, headers: { "content-type": "application/atom+xml; charset=utf-8" } }),
    };
  }

  const redditMatch = /^\/discovery\/reddit\/r\/([^/]+)\/new\.json$/.exec(path);
  if (redditMatch) {
    const sub = redditMatch[1]!;
    const children = Array.from({ length: Math.min(limit, 4) }, (_, i) => ({
      kind: "t3",
      data: {
        id: `disc_rd_${ctx.state.seed}_${i + 1}`,
        subreddit: sub,
        title: `Looking for weekend coffee & running friends in r/${sub} #${i + 1}`,
        selftext: `Moved here recently and want to meet people offline.`,
        author: `local_redditor_${i + 1}`,
        created_utc: Math.floor((nowMs - (i + 1) * 7_200_000) / 1000),
        permalink: `/r/${sub}/comments/disc_rd_${i + 1}/post/`,
      },
    }));
    return { service: "discovery", response: jsonResponse({ kind: "Listing", data: { children } }) };
  }

  const openDataMatch = /^\/discovery\/opendata\/([^/]+)$/.exec(path);
  if (openDataMatch) {
    const city = openDataMatch[1]!.toLowerCase();
    const venues = CITY_VENUES[city] ?? CITY_VENUES.nyc!;
    const rows = venues.slice(0, limit).map((v, i) => ({
      camis: `${city.toUpperCase()}-${1000 + i}`,
      dba: v.name,
      boro: v.neighborhood,
      street: v.address,
      cuisine_description: v.category,
      grade: "A",
      inspection_date: new Date(nowMs - 86_400_000).toISOString(),
    }));
    return { service: "discovery", response: jsonResponse(rows) };
  }

  if (path === "/discovery/openalex") {
    const results = Array.from({ length: Math.min(limit, 3) }, (_, i) => ({
      id: `https://openalex.org/A${5000 + i}`,
      display_name: `Prof. Jordan Kim ${i + 1}`,
      works_count: 42 + i * 10,
      cited_by_count: 1800 + i * 400,
    }));
    return { service: "discovery", response: jsonResponse({ results }) };
  }

  if (path === "/discovery/sec") {
    const hits = Array.from({ length: Math.min(limit, 3) }, (_, i) => ({
      _id: `formd_${ctx.state.seed}_${i + 1}`,
      _source: {
        display_names: [`Acme Labs ${i + 1} Inc.`],
        form: "D",
        file_date: new Date(nowMs - 86_400_000).toISOString().slice(0, 10),
      },
    }));
    return { service: "discovery", response: jsonResponse({ hits: { hits } }) };
  }

  if (path === "/discovery/propublica") {
    const organizations = Array.from({ length: Math.min(limit, 3) }, (_, i) => ({
      ein: 120000000 + i,
      name: `Local Arts & Community Foundation ${i + 1}`,
      city: "New York",
      state: "NY",
    }));
    return { service: "discovery", response: jsonResponse({ organizations }) };
  }

  if (path === "/discovery/clinicaltrials") {
    const studies = Array.from({ length: Math.min(limit, 2) }, (_, i) => ({
      protocolSection: {
        identificationModule: { nctId: `NCT0900000${i + 1}`, briefTitle: `Longevity Study ${i + 1}` },
        contactsLocationsModule: { overallOfficials: [{ name: `Dr. Elena Vance ${i + 1}`, affiliation: "NYC Medical Center" }] },
      },
    }));
    return { service: "discovery", response: jsonResponse({ studies }) };
  }

  const evtMatch = /^\/discovery\/(luma|eventbrite)\/([^/]+)$/.exec(path);
  if (evtMatch) {
    const source = evtMatch[1]!;
    const city = evtMatch[2]!;
    return {
      service: "discovery",
      response: jsonResponse({
        source,
        city,
        events: [
          { id: `${source}_${city}_1`, name: `${city.toUpperCase()} Founders & Creators Salon`, start_at: new Date(nowMs + 2 * 86_400_000).toISOString() },
          { id: `${source}_${city}_2`, name: `${city.toUpperCase()} Sunday Coffee Run`, start_at: new Date(nowMs + 3 * 86_400_000).toISOString() },
        ],
      }),
    };
  }

  return { service: "discovery", response: jsonResponse({ error: `Unhandled discovery route ${path}` }, 404) };
}
