import { fileURLToPath } from "node:url";
import {
  DEFAULT_MATCHMAKER_REGISTRY,
  getCity,
  getCityIds,
  seedVenuesForCity,
  type CityLaunchStatus,
  type CitySpec,
  type MatchmakerPersona,
} from "../packages/core/src/index.ts";
import { SQL } from "../packages/core/src/runtime/postgres.ts";
import { devPgUp } from "../packages/db/dev-pg.ts";
import { upsertVenue } from "../packages/network/service/meetup-store.ts";

export interface CitySeedSummary {
  city: string;
  name: string;
  tz: string;
  launchStatus: CityLaunchStatus;
  venuesUpserted: number;
  allAgesVenues: number;
  matchmakersUpserted: string[];
  networksTouched: 0;
  existingNetworks: string[];
}

function defaultPersonasForCity(spec: CitySpec): [MatchmakerPersona, MatchmakerPersona] {
  const existing = DEFAULT_MATCHMAKER_REGISTRY.getCityMatchmakers(spec.id);
  if (existing) return [existing.female, existing.male];
  const hubs = spec.neighborhoods.slice(0, 4).map(n => n.name);
  const disclosure = `Local matchmaker & small-group host in ${spec.name} (not dating here myself — setting up real offline intros).`;
  return [
    {
      id: `${spec.id}-f`,
      city: spec.id,
      gender: "female",
      firstName: "Maya",
      tz: spec.tz,
      hubs,
      verticals: ["slop", "friends"],
      humanOperated: true,
      bioDisclosure: disclosure,
      status: "active",
      dailyOutboundCap: 10,
      dailyOutboundCount: 0,
      rollingChatsCount: 0,
      rollingUnmatchesCount: 0,
    },
    {
      id: `${spec.id}-m`,
      city: spec.id,
      gender: "male",
      firstName: "Devon",
      tz: spec.tz,
      hubs,
      verticals: ["slop", "friends"],
      humanOperated: true,
      bioDisclosure: disclosure,
      status: "active",
      dailyOutboundCap: 10,
      dailyOutboundCount: 0,
      rollingChatsCount: 0,
      rollingUnmatchesCount: 0,
    },
  ];
}

/**
 * Idempotently upsert platform.cities, CitySpec.seedVenues -> platform.venues,
 * and the city's 2 platform.matchmaker_personas WITHOUT touching platform.networks.
 */
export async function seedCity(sql: SQL, cityId: string): Promise<CitySeedSummary> {
  const normalized = cityId.trim().toLowerCase();
  const spec = getCity(normalized);
  if (!spec) {
    throw new Error(`Unknown city "${cityId}". Registered cities: ${getCityIds().join(", ")}`);
  }
  const defaultStatus: CityLaunchStatus = spec.launchStatus ?? (spec.id === "nyc" ? "active" : "waitlist");

  const [cityRow] = await sql<{ id: string; name: string; tz: string; launch_status: CityLaunchStatus }[]>`
    insert into platform.cities (id, name, tz, launch_status)
    values (${spec.id}, ${spec.name}, ${spec.tz}, ${defaultStatus})
    on conflict (id) do update set
      name = excluded.name,
      tz = excluded.tz
    returning id, name, tz, launch_status
  `;

  const venues = seedVenuesForCity(spec.id);
  let allAgesVenues = 0;
  for (const venue of venues) {
    const saved = await upsertVenue(sql, venue);
    if (saved.allAges) allAgesVenues++;
  }

  const personas = defaultPersonasForCity(spec);
  const matchmakersUpserted: string[] = [];
  for (const persona of personas) {
    const [saved] = await sql<{ id: string }[]>`
      insert into platform.matchmaker_personas (
        id, city, gender, first_name, tz, hubs, verticals,
        human_operated, bio_disclosure, status, daily_outbound_cap
      ) values (
        ${persona.id}, ${spec.id}, ${persona.gender}, ${persona.firstName}, ${persona.tz},
        ${JSON.stringify(persona.hubs)}::jsonb, ${JSON.stringify(persona.verticals)}::jsonb,
        true, ${persona.bioDisclosure}, ${persona.status}, ${persona.dailyOutboundCap}
      )
      on conflict (id) do update set
        first_name = excluded.first_name,
        tz = excluded.tz,
        hubs = excluded.hubs,
        verticals = excluded.verticals,
        bio_disclosure = excluded.bio_disclosure,
        updated_at = now()
      returning id
    `;
    matchmakersUpserted.push(saved!.id);
  }

  const networks = await sql<{ id: string }[]>`
    select id from platform.networks where city = ${spec.id} order by id
  `;

  return {
    city: cityRow!.id,
    name: cityRow!.name,
    tz: cityRow!.tz,
    launchStatus: cityRow!.launch_status,
    venuesUpserted: venues.length,
    allAgesVenues,
    matchmakersUpserted,
    networksTouched: 0,
    existingNetworks: networks.map(r => r.id),
  };
}

interface CliArgs {
  cities: string[];
  json: boolean;
  url?: string;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const cities: string[] = [];
  let json = false;
  let all = false;
  let url: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--json") {
      json = true;
    } else if (arg === "--all") {
      all = true;
    } else if (arg === "--city" && argv[i + 1]) {
      const next = argv[++i]!;
      for (const part of next.split(",")) {
        const trimmed = part.trim();
        if (trimmed) cities.push(trimmed);
      }
    } else if (arg.startsWith("--city=")) {
      for (const part of arg.slice("--city=".length).split(",")) {
        const trimmed = part.trim();
        if (trimmed) cities.push(trimmed);
      }
    } else if (arg === "--url" && argv[i + 1]) {
      url = argv[++i]!;
    } else if (arg.startsWith("--url=")) {
      url = arg.slice("--url=".length);
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node --import tsx scripts/city-seed.ts --city <id> [--json] [--url <postgres-url>]");
      console.log("       node --import tsx scripts/city-seed.ts --all [--json]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (all) {
    return { cities: getCityIds(), json, url };
  }
  if (!cities.length) {
    throw new Error("Missing required --city <id> (or --all). Example: --city nyc --json");
  }
  return { cities: [...new Set(cities)], json, url };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = args.url ?? process.env.NETWORK_DATABASE_URL ?? process.env.DATABASE_URL ?? (await devPgUp());
  const sql = new SQL({ url, max: 2, connection: { application_name: "city-seed" } });
  try {
    const results: CitySeedSummary[] = [];
    for (const city of args.cities) {
      results.push(await seedCity(sql, city));
    }
    if (args.json) {
      console.log(JSON.stringify({ ok: true, cities: results }, null, 2));
    } else {
      for (const r of results) {
        console.log(
          `[city-seed] ${r.city} (${r.name}, ${r.tz}, status=${r.launchStatus}): ` +
            `${r.venuesUpserted} venues (${r.allAgesVenues} all-ages), ` +
            `matchmakers=[${r.matchmakersUpserted.join(", ")}], ` +
            `platform.networks untouched (existing=[${r.existingNetworks.join(", ")}])`
        );
      }
    }
  } finally {
    await sql.end();
  }
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntrypoint) {
  main().catch(err => {
    const msg = err instanceof Error ? err.message : String(err);
    if (process.argv.includes("--json")) {
      console.error(JSON.stringify({ ok: false, error: msg }));
    } else {
      console.error(`[city-seed] error: ${msg}`);
    }
    process.exit(1);
  });
}
