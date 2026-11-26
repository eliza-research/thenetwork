import type { BrandAppId } from "./types.ts";

export const SUPPORTED_CITIES = [
  "nyc",
  "sf",
  "la",
  "chicago",
  "miami",
  "austin",
  "london",
] as const;

export type SupportedCity = (typeof SUPPORTED_CITIES)[number];

export type CityCurrency = "USD" | "GBP";

export type LaborClassification =
  | "1099_allowed"
  | "w2_required_ab5"
  | "uk_paye_or_agency";

export interface CityCorridor {
  readonly neighborhood: string;
  readonly landmarks: string;
  readonly bestWindows: string;
  readonly primaryApps: readonly BrandAppId[];
}

export interface CityNeighborhoodPattern {
  readonly label: string;
  readonly patterns: readonly string[];
}

export interface CityDiscoveryEndpoints {
  readonly lumaUrl: string;
  readonly eventbriteUrl: string;
  readonly subreddits: readonly string[];
  readonly githubLocationQuery: string;
  readonly openDataVenuesUrl: string | null;
  readonly liquorLicensesUrl: string | null;
}

export interface CityLegalRules {
  readonly laborClassification: LaborClassification;
  readonly w2RequiredForStreetTeams: boolean;
  readonly flierLicenceRequired: boolean;
  readonly freelanceStatute: string;
  readonly payoutSlaDays: number;
  readonly antiPostingRule: string;
  readonly transitExclusionRule: string;
  readonly likenessReleaseStatute: string;
  readonly disclosureAuthority: string;
  readonly permitSummary: string;
}

export interface CityVendorSeed {
  readonly craigslistSubdomain: string | null;
  readonly craigslistPostFeeCents: number;
  readonly recommendedAgencies: readonly string[];
  readonly recommendedPrinters: readonly string[];
}

export interface CityLaunchConfig {
  readonly code: SupportedCity;
  readonly label: string;
  readonly country: "US" | "UK";
  readonly currency: CityCurrency;
  readonly timezone: string;
  readonly isPrimaryLaunch: boolean;
  readonly defaultMonthlyBudgetCents: number;
  readonly defaultDailyCapCents: number;
  readonly defaultMaxTaskCents: number;
  readonly activationWaitlistMinAdults: number;
  readonly activationMinSignedVenues: number;
  readonly corridors: readonly CityCorridor[];
  readonly neighborhoodPatterns: readonly CityNeighborhoodPattern[];
  readonly transitKeywords: readonly string[];
  readonly discovery: CityDiscoveryEndpoints;
  readonly legal: CityLegalRules;
  readonly vendors: CityVendorSeed;
}

export interface CityHiringComplianceInput {
  readonly city: string;
  readonly role:
    | "street_fliering"
    | "event_activation"
    | "creator_video"
    | "agency_booking"
    | "rentahuman_courier";
  readonly contractorMode: "1099_direct" | "w2_agency" | "creator_direct";
  readonly boroughLicenceRef?: string | null;
}

export interface CityHiringComplianceResult {
  readonly allowed: boolean;
  readonly city: SupportedCity;
  readonly reasons: readonly string[];
  readonly requiredNotice: string;
}

export interface CityActivationReadiness {
  readonly city: SupportedCity;
  readonly ready: boolean;
  readonly isPrimaryLaunch: boolean;
  readonly verifiedStage2Adults: number;
  readonly requiredAdults: number;
  readonly signedVenues: number;
  readonly requiredVenues: number;
  readonly blockers: readonly string[];
}

export const CITY_CONFIGS: Readonly<Record<SupportedCity, CityLaunchConfig>> = {
  nyc: {
    code: "nyc",
    label: "New York City",
    country: "US",
    currency: "USD",
    timezone: "America/New_York",
    isPrimaryLaunch: true,
    defaultMonthlyBudgetCents: 1_000_000,
    defaultDailyCapCents: 100_000,
    defaultMaxTaskCents: 150_000,
    activationWaitlistMinAdults: 0,
    activationMinSignedVenues: 0,
    corridors: [
      {
        neighborhood: "West Village",
        landmarks: "Washington Square Park perimeter & West 4th St",
        bestWindows: "Thu-Sun 1:00 PM - 6:30 PM",
        primaryApps: ["slop", "friends"],
      },
      {
        neighborhood: "SoHo / Nolita",
        landmarks: "Broadway / Prince St / Spring St",
        bestWindows: "Fri-Sun 12:30 PM - 5:30 PM",
        primaryApps: ["ntwrk", "slop"],
      },
      {
        neighborhood: "Williamsburg",
        landmarks: "Bedford Ave & Domino Park perimeter",
        bestWindows: "Sat-Sun 12:00 PM - 6:00 PM",
        primaryApps: ["friends", "slop"],
      },
      {
        neighborhood: "East Village",
        landmarks: "Astor Place & St. Marks Pl",
        bestWindows: "Thu-Sat 4:00 PM - 8:30 PM",
        primaryApps: ["slop", "peon"],
      },
      {
        neighborhood: "Flatiron / Union Square",
        landmarks: "Union Square South & Flatiron Plaza sidewalks",
        bestWindows: "Tue-Fri 12:00 PM - 2:30 PM & 5:00 PM - 7:00 PM",
        primaryApps: ["peon", "ntwrk"],
      },
      {
        neighborhood: "Midtown West",
        landmarks: "Bryant Park exterior public sidewalks",
        bestWindows: "Tue-Thu 12:00 PM - 2:00 PM",
        primaryApps: ["peon", "ntwrk"],
      },
    ],
    neighborhoodPatterns: [
      {
        label: "West Village",
        patterns: ["west village", "washington square", "bleecker", "w 4th", "greenwich village"],
      },
      {
        label: "East Village",
        patterns: ["east village", "astor place", "st marks", "st. marks", "alphabet city"],
      },
      {
        label: "SoHo / Nolita",
        patterns: ["soho", "nolita", "prince st", "spring st", "w broadway"],
      },
      {
        label: "Flatiron / Union Square",
        patterns: ["flatiron", "union square", "gramercy", "14th st", "23rd st"],
      },
      {
        label: "Williamsburg",
        patterns: ["williamsburg", "bedford ave", "domino park", "greenpoint", "bushwick"],
      },
      {
        label: "Midtown West",
        patterns: ["midtown", "bryant park", "hudson yards", "hell's kitchen", "times square"],
      },
      {
        label: "Lower East Side",
        patterns: ["lower east side", "ludlow", "orchard st", "bowery", "delancey"],
      },
      {
        label: "Brooklyn",
        patterns: ["brooklyn", "kings", "dumbo", "park slope", "cobble hill"],
      },
      {
        label: "Manhattan",
        patterns: ["manhattan", "new york", "tribeca", "chelsea", "upper west", "upper east"],
      },
    ],
    transitKeywords: [
      "nyc",
      "manhattan",
      "brooklyn",
      "queens",
      "bronx",
      "subway",
      "mta",
      "union sq",
      "west 4th",
      "bedford",
      "astor",
      "train",
    ],
    discovery: {
      lumaUrl: "https://lu.ma/nyc",
      eventbriteUrl: "https://www.eventbrite.com/d/ny--new-york/events/",
      subreddits: ["nyc", "AskNYC", "nycmeetups", "startups"],
      githubLocationQuery: "location:NYC followers:>25",
      openDataVenuesUrl:
        "https://data.cityofnewyork.us/resource/43nn-pn8j.json?$limit=40&$where=grade='A'&$order=inspection_date%20DESC",
      liquorLicensesUrl:
        "https://data.ny.gov/resource/hrjk-bxus.json?$limit=40&$where=county_name_desc='NEW%20YORK'%20OR%20county_name_desc='KINGS'",
    },
    legal: {
      laborClassification: "1099_allowed",
      w2RequiredForStreetTeams: false,
      flierLicenceRequired: false,
      freelanceStatute:
        "NYLL § 191-d (Freelance Isn't Free Act): Itemized written clickwrap retained 6 years; payout within 48 hours of approved proof (internal hard SLA <= 15 days, statutory cap 30 days).",
      payoutSlaDays: 15,
      antiPostingRule:
        "NYC Administrative Code § 10-119: Hand-to-hand public sidewalk distribution only (>= 8 ft clearance). Zero taping, pasting, or placing fliers on lampposts, poles, trees, mailboxes, or car windshields.",
      transitExclusionRule:
        "21 NYCRR § 1050.6: Commercial flyers strictly prohibited inside MTA subway stations, mezzanines, and platforms. Stay >= 20 ft outside station entrances.",
      likenessReleaseStatute:
        "NY Civil Rights Law §§ 50-51: Prior written commercial likeness release required from every recognizable 18+ interviewee before publication.",
      disclosureAuthority:
        "FTC 16 CFR Part 255 & 465: Mandatory spoken disclosure, prominent first-3s on-screen #Ad / Paid Partnership overlay, and native Commercial Content toggle.",
      permitSummary:
        "No sidewalk hand-to-hand permit required; keep teams < 20 people with zero tables, tents, or amplified sound (56 RCNY § 1-05) and handheld-only filming (NYC MOME).",
    },
    vendors: {
      craigslistSubdomain: "newyork",
      craigslistPostFeeCents: 1_000,
      recommendedAgencies: [
        "Kinetic Events Staffing",
        "Street Teams Co",
        "Broadway Crew",
        "Victory Agency",
        "Oppizi NYC",
        "The PUSH Agency",
        "Mustard Lane",
      ],
      recommendedPrinters: [
        "4over4.com (Astoria, Queens)",
        "Printleaf (Midtown Manhattan)",
        "Bestype Imaging (SoHo)",
        "GotPrint",
      ],
    },
  },

  sf: {
    code: "sf",
    label: "San Francisco",
    country: "US",
    currency: "USD",
    timezone: "America/Los_Angeles",
    isPrimaryLaunch: false,
    defaultMonthlyBudgetCents: 750_000,
    defaultDailyCapCents: 75_000,
    defaultMaxTaskCents: 150_000,
    activationWaitlistMinAdults: 150,
    activationMinSignedVenues: 10,
    corridors: [
      {
        neighborhood: "Mission / Dolores",
        landmarks: "Valencia St corridor & Dolores Park perimeter sidewalks",
        bestWindows: "Fri-Sun 12:30 PM - 6:00 PM",
        primaryApps: ["slop", "friends"],
      },
      {
        neighborhood: "Hayes Valley",
        landmarks: "Hayes St & Octavia St pedestrian plaza",
        bestWindows: "Thu-Sun 2:00 PM - 7:30 PM",
        primaryApps: ["ntwrk", "slop"],
      },
      {
        neighborhood: "Marina / Cow Hollow",
        landmarks: "Chestnut St & Union St sidewalks",
        bestWindows: "Fri-Sun 1:00 PM - 6:00 PM",
        primaryApps: ["slop", "friends"],
      },
      {
        neighborhood: "SoMa / Jackson Square",
        landmarks: "2nd St, South Park & Jackson Sq founder corridor",
        bestWindows: "Tue-Thu 11:30 AM - 2:30 PM & 5:00 PM - 7:00 PM",
        primaryApps: ["peon", "ntwrk"],
      },
    ],
    neighborhoodPatterns: [
      { label: "Mission / Dolores", patterns: ["mission", "valencia", "dolores", "16th st", "24th st"] },
      { label: "Hayes Valley", patterns: ["hayes valley", "octavia", "patricia's green"] },
      { label: "Marina / Cow Hollow", patterns: ["marina", "chestnut", "cow hollow", "union st"] },
      { label: "SoMa / Jackson Square", patterns: ["soma", "south park", "jackson square", "fidi", "embarcadero"] },
      { label: "North Beach", patterns: ["north beach", "columbus ave", "washington square sf"] },
      { label: "San Francisco", patterns: ["san francisco", "sf", "bay area"] },
    ],
    transitKeywords: [
      "sf",
      "san francisco",
      "bart",
      "muni",
      "caltrain",
      "mission",
      "hayes",
      "marina",
      "soma",
      "embarcadero",
      "montgomery",
      "powell",
    ],
    discovery: {
      lumaUrl: "https://lu.ma/sf",
      eventbriteUrl: "https://www.eventbrite.com/d/ca--san-francisco/events/",
      subreddits: ["sanfrancisco", "AskSF", "bayarea", "startups"],
      githubLocationQuery: 'location:"San Francisco" followers:>25',
      openDataVenuesUrl: "https://data.sfgov.org/resource/pyih-qa8i.json?$limit=40",
      liquorLicensesUrl: null,
    },
    legal: {
      laborClassification: "w2_required_ab5",
      w2RequiredForStreetTeams: true,
      flierLicenceRequired: false,
      freelanceStatute:
        "California AB5 (Cal. Lab. Code § 2775) & SB 988 (Freelance Worker Protection Act): Hourly street-team and event-activator labor MUST run through W-2 agencies or W-2 staffing platforms (Instawork, Kinetic, Encore); bona fide independent creators receive written SB 988 contracts with <= 30d payment SLA.",
      payoutSlaDays: 15,
      antiPostingRule:
        "SF Public Works Code § 184 & Police Code Art. 5.1: Hand-to-hand distribution on public sidewalks only. Zero posting on utility poles, trees, Muni shelters, or parked vehicles.",
      transitExclusionRule:
        "BART & SFMTA Rules: Commercial distribution prohibited inside BART stations, paid fare areas, and Muni vehicles/stations. Stay on outdoor public sidewalks.",
      likenessReleaseStatute:
        "CA Civil Code § 3344: Prior written commercial likeness release required for every recognizable 18+ filmed participant.",
      disclosureAuthority:
        "FTC 16 CFR Part 255 & California SB 1001 (Bot Disclosure): Mandatory spoken + on-screen #Ad disclosure and transparent AI agent disclosure.",
      permitSummary:
        "W-2 agency staffing mandatory for hourly street teams under CA AB5; handheld sidewalk filming without exclusive sidewalk occupancy.",
    },
    vendors: {
      craigslistSubdomain: "sfbay",
      craigslistPostFeeCents: 1_000,
      recommendedAgencies: [
        "Kinetic Events Staffing",
        "Instawork (W-2)",
        "Encore Nationwide (W-2)",
        "Assist Marketing (W-2)",
        "Oppizi SF",
      ],
      recommendedPrinters: ["GotPrint (Burbank CA fast ship)", "4over Wholesale", "MOO"],
    },
  },

  la: {
    code: "la",
    label: "Los Angeles",
    country: "US",
    currency: "USD",
    timezone: "America/Los_Angeles",
    isPrimaryLaunch: false,
    defaultMonthlyBudgetCents: 750_000,
    defaultDailyCapCents: 75_000,
    defaultMaxTaskCents: 150_000,
    activationWaitlistMinAdults: 150,
    activationMinSignedVenues: 10,
    corridors: [
      {
        neighborhood: "Silver Lake / Echo Park",
        landmarks: "Sunset Junction & Sunset Blvd public sidewalks",
        bestWindows: "Fri-Sun 1:00 PM - 6:30 PM",
        primaryApps: ["slop", "friends"],
      },
      {
        neighborhood: "Venice / Abbot Kinney",
        landmarks: "Abbot Kinney Blvd & Main St Santa Monica sidewalks",
        bestWindows: "Fri-Sun 12:30 PM - 6:00 PM",
        primaryApps: ["slop", "ntwrk"],
      },
      {
        neighborhood: "West Hollywood",
        landmarks: "Melrose Ave & Santa Monica Blvd commercial sidewalks",
        bestWindows: "Thu-Sun 2:00 PM - 7:30 PM",
        primaryApps: ["slop", "ntwrk"],
      },
      {
        neighborhood: "Arts District / Culver City",
        landmarks: "E 3rd St & Culver Steps perimeter",
        bestWindows: "Tue-Fri 12:00 PM - 3:00 PM & 5:00 PM - 7:30 PM",
        primaryApps: ["peon", "friends"],
      },
    ],
    neighborhoodPatterns: [
      { label: "Silver Lake / Echo Park", patterns: ["silver lake", "silverlake", "echo park", "sunset junction"] },
      { label: "Venice / Santa Monica", patterns: ["venice", "abbot kinney", "santa monica", "silicon beach"] },
      { label: "West Hollywood", patterns: ["west hollywood", "weho", "melrose", "fairfax"] },
      { label: "Arts District / DTLA", patterns: ["arts district", "dtla", "downtown la", "culver city"] },
      { label: "Los Angeles", patterns: ["los angeles", "hollywood", "la"] },
    ],
    transitKeywords: [
      "la",
      "los angeles",
      "metro",
      "silver lake",
      "venice",
      "santa monica",
      "weho",
      "culver",
      "dtla",
      "expo line",
    ],
    discovery: {
      lumaUrl: "https://lu.ma/la",
      eventbriteUrl: "https://www.eventbrite.com/d/ca--los-angeles/events/",
      subreddits: ["LosAngeles", "AskLosAngeles", "LAlist", "startups"],
      githubLocationQuery: 'location:"Los Angeles" followers:>25',
      openDataVenuesUrl: "https://data.lacity.org/resource/6rrh-rzua.json?$limit=40",
      liquorLicensesUrl: null,
    },
    legal: {
      laborClassification: "w2_required_ab5",
      w2RequiredForStreetTeams: true,
      flierLicenceRequired: false,
      freelanceStatute:
        "California AB5 (Cal. Lab. Code § 2775) & SB 988: Hourly street-team and event-activator labor MUST run through W-2 staffing agencies/platforms; independent creators require written SB 988 agreements.",
      payoutSlaDays: 15,
      antiPostingRule:
        "LAMC § 28.04 & § 28.01: Hand-to-hand distribution to willing adults on public sidewalks only. Zero posting on poles, trees, or placing handbills on parked vehicles.",
      transitExclusionRule:
        "LA Metro Customer Code of Conduct: Commercial handbill distribution prohibited inside Metro stations and rail/bus platforms.",
      likenessReleaseStatute:
        "CA Civil Code § 3344: Prior written commercial likeness release required for every recognizable 18+ filmed participant.",
      disclosureAuthority:
        "FTC 16 CFR Part 255 & CA SB 1001: Spoken + on-screen #Ad disclosure, Paid Partnership toggle, and open AI disclosure.",
      permitSummary:
        "W-2 staffing mandatory under CA AB5; check FilmLA thresholds (stay strictly handheld, small crew, zero equipment on sidewalk).",
    },
    vendors: {
      craigslistSubdomain: "losangeles",
      craigslistPostFeeCents: 1_000,
      recommendedAgencies: [
        "Kinetic Events Staffing",
        "Instawork (W-2)",
        "Encore Nationwide (W-2)",
        "The PUSH Agency",
        "Attack! Marketing",
      ],
      recommendedPrinters: ["GotPrint (Burbank CA local pickup)", "4over Wholesale", "MOO"],
    },
  },

  chicago: {
    code: "chicago",
    label: "Chicago",
    country: "US",
    currency: "USD",
    timezone: "America/Chicago",
    isPrimaryLaunch: false,
    defaultMonthlyBudgetCents: 600_000,
    defaultDailyCapCents: 60_000,
    defaultMaxTaskCents: 120_000,
    activationWaitlistMinAdults: 150,
    activationMinSignedVenues: 10,
    corridors: [
      {
        neighborhood: "West Loop / Fulton Market",
        landmarks: "Randolph St & Fulton Market sidewalks",
        bestWindows: "Thu-Sun 12:30 PM - 7:00 PM",
        primaryApps: ["slop", "peon"],
      },
      {
        neighborhood: "Wicker Park / Logan Square",
        landmarks: "Milwaukee Ave & Damen Ave intersections",
        bestWindows: "Fri-Sun 1:00 PM - 6:30 PM",
        primaryApps: ["friends", "slop"],
      },
      {
        neighborhood: "River North / Loop",
        landmarks: "Merchandise Mart perimeter & Hubbard St",
        bestWindows: "Tue-Fri 12:00 PM - 2:30 PM & 5:00 PM - 7:00 PM",
        primaryApps: ["peon", "ntwrk"],
      },
    ],
    neighborhoodPatterns: [
      { label: "West Loop / Fulton Market", patterns: ["west loop", "fulton market", "randolph st"] },
      { label: "Wicker Park / Logan Square", patterns: ["wicker park", "logan square", "bucktown", "milwaukee ave"] },
      { label: "River North / Loop", patterns: ["river north", "the loop", "streeterville", "gold coast"] },
      { label: "Lincoln Park / Lakeview", patterns: ["lincoln park", "lakeview", "wrigleyville"] },
      { label: "Chicago", patterns: ["chicago", "chi"] },
    ],
    transitKeywords: [
      "chicago",
      "cta",
      "l train",
      "red line",
      "blue line",
      "brown line",
      "west loop",
      "wicker park",
      "logan square",
      "river north",
      "loop",
    ],
    discovery: {
      lumaUrl: "https://lu.ma/chicago",
      eventbriteUrl: "https://www.eventbrite.com/d/il--chicago/events/",
      subreddits: ["chicago", "AskChicago", "chicagomeetups", "startups"],
      githubLocationQuery: "location:Chicago followers:>25",
      openDataVenuesUrl: "https://data.cityofchicago.org/resource/4ijn-s7e5.json?$limit=40&$where=results='Pass'",
      liquorLicensesUrl: "https://data.cityofchicago.org/resource/nrmj-3kcf.json?$limit=40",
    },
    legal: {
      laborClassification: "1099_allowed",
      w2RequiredForStreetTeams: false,
      flierLicenceRequired: false,
      freelanceStatute:
        "Illinois Freelance Worker Protection Act (820 ILCS 193): Written itemized contract required for services >= $500 (applied uniformly from $1); payout <= 30 days (internal SLA <= 15 days).",
      payoutSlaDays: 15,
      antiPostingRule:
        "Chicago Municipal Code § 10-8-320: Hand-to-hand sidewalk distribution only; zero posting on poles, trees, or car windshields.",
      transitExclusionRule:
        "CTA Ordinance: Commercial flyer distribution prohibited inside CTA L stations, platforms, and rail cars.",
      likenessReleaseStatute:
        "Illinois Right of Publicity Act (765 ILCS 1075) & IL BIPA (740 ILCS 14): Prior written commercial likeness release required; zero biometric facial-geometry extraction.",
      disclosureAuthority:
        "FTC 16 CFR Part 255 & 465: Mandatory spoken + on-screen #Ad disclosure and native Commercial Content toggle.",
      permitSummary:
        "Public sidewalk hand-to-hand permitted without obstructing pedestrian flow; strictly zero facial-geometry scanning (IL BIPA).",
    },
    vendors: {
      craigslistSubdomain: "chicago",
      craigslistPostFeeCents: 700,
      recommendedAgencies: [
        "ATN Event Staffing",
        "Kinetic Events Staffing",
        "Street Teams Co",
        "The PUSH Agency",
      ],
      recommendedPrinters: ["GotPrint", "4over Wholesale", "MOO"],
    },
  },

  miami: {
    code: "miami",
    label: "Miami",
    country: "US",
    currency: "USD",
    timezone: "America/New_York",
    isPrimaryLaunch: false,
    defaultMonthlyBudgetCents: 600_000,
    defaultDailyCapCents: 60_000,
    defaultMaxTaskCents: 120_000,
    activationWaitlistMinAdults: 150,
    activationMinSignedVenues: 10,
    corridors: [
      {
        neighborhood: "Wynwood",
        landmarks: "NW 2nd Ave commercial sidewalks (outside private mural lots)",
        bestWindows: "Thu-Sun 2:00 PM - 8:00 PM",
        primaryApps: ["slop", "ntwrk"],
      },
      {
        neighborhood: "Brickell",
        landmarks: "S Miami Ave & Brickell City Centre perimeter sidewalks",
        bestWindows: "Tue-Fri 12:00 PM - 2:30 PM & 5:30 PM - 8:00 PM",
        primaryApps: ["peon", "slop"],
      },
      {
        neighborhood: "Coconut Grove / Coral Gables",
        landmarks: "Commodore Plaza & Miracle Mile public sidewalks",
        bestWindows: "Fri-Sun 1:00 PM - 6:30 PM",
        primaryApps: ["friends", "ntwrk"],
      },
    ],
    neighborhoodPatterns: [
      { label: "Wynwood", patterns: ["wynwood", "nw 2nd ave", "midtown miami"] },
      { label: "Brickell", patterns: ["brickell", "downtown miami", "bayfront"] },
      { label: "Coconut Grove", patterns: ["coconut grove", "coral gables", "miracle mile"] },
      { label: "Miami Beach", patterns: ["miami beach", "south beach", "sunset harbour"] },
      { label: "Miami", patterns: ["miami", "design district", "edgewater"] },
    ],
    transitKeywords: [
      "miami",
      "metrorail",
      "metromover",
      "brightline",
      "wynwood",
      "brickell",
      "coconut grove",
      "edgewater",
    ],
    discovery: {
      lumaUrl: "https://lu.ma/miami",
      eventbriteUrl: "https://www.eventbrite.com/d/fl--miami/events/",
      subreddits: ["Miami", "MiamiTech", "startups"],
      githubLocationQuery: "location:Miami followers:>20",
      openDataVenuesUrl: null,
      liquorLicensesUrl: null,
    },
    legal: {
      laborClassification: "1099_allowed",
      w2RequiredForStreetTeams: false,
      flierLicenceRequired: false,
      freelanceStatute:
        "Written itemized independent contractor clickwrap agreement retained 6 years; internal payout SLA <= 15 days (48h target post-proof).",
      payoutSlaDays: 15,
      antiPostingRule:
        "Miami Beach Code Ch. 46 & City of Miami Code Ch. 37: Strictly avoid restricted Miami Beach commercial handbill zones (Ocean Dr / Lincoln Rd / Art Deco district); hand-to-hand only in permitted City of Miami public corridors with zero pole/car posting.",
      transitExclusionRule:
        "Miami-Dade Transit Rules: Commercial distribution prohibited inside Metrorail and Metromover stations and cars.",
      likenessReleaseStatute:
        "FL Stat. § 540.08: Prior written commercial likeness release required from every recognizable 18+ filmed participant.",
      disclosureAuthority:
        "FTC 16 CFR Part 255 & 465: Mandatory spoken + on-screen #Ad disclosure and native Commercial Content toggle.",
      permitSummary:
        "Avoid Miami Beach commercial handbill ban zones; focus street teams on Brickell/Wynwood public sidewalks and venue-consented activations.",
    },
    vendors: {
      craigslistSubdomain: "miami",
      craigslistPostFeeCents: 700,
      recommendedAgencies: [
        "Kinetic Events Staffing",
        "Victory Agency",
        "The PUSH Agency",
        "Street Teams Co",
      ],
      recommendedPrinters: ["GotPrint", "4over Wholesale", "MOO"],
    },
  },

  austin: {
    code: "austin",
    label: "Austin",
    country: "US",
    currency: "USD",
    timezone: "America/Chicago",
    isPrimaryLaunch: false,
    defaultMonthlyBudgetCents: 500_000,
    defaultDailyCapCents: 50_000,
    defaultMaxTaskCents: 100_000,
    activationWaitlistMinAdults: 150,
    activationMinSignedVenues: 10,
    corridors: [
      {
        neighborhood: "East Austin",
        landmarks: "East 6th St & East Cesar Chavez sidewalks",
        bestWindows: "Thu-Sun 2:00 PM - 8:00 PM",
        primaryApps: ["friends", "slop"],
      },
      {
        neighborhood: "Downtown / South Congress",
        landmarks: "South Congress Ave (SoCo) & Congress Ave sidewalks",
        bestWindows: "Fri-Sun 12:30 PM - 6:30 PM",
        primaryApps: ["ntwrk", "slop"],
      },
      {
        neighborhood: "West Campus / UT Perimeter",
        landmarks: "Guadalupe St (The Drag) public sidewalks (strictly 18+)",
        bestWindows: "Wed-Sat 1:00 PM - 6:00 PM",
        primaryApps: ["friends", "peon"],
      },
    ],
    neighborhoodPatterns: [
      { label: "East Austin", patterns: ["east austin", "east 6th", "cesar chavez", "eastside"] },
      { label: "South Congress", patterns: ["south congress", "soco", "south lamar", "zilker"] },
      { label: "Downtown / Rainey", patterns: ["downtown austin", "rainey", "congress ave", "2nd street"] },
      { label: "Domain / North", patterns: ["the domain", "mueller", "hyde park"] },
      { label: "Austin", patterns: ["austin", "atx"] },
    ],
    transitKeywords: [
      "austin",
      "atx",
      "capmetro",
      "metrorail",
      "soco",
      "east 6th",
      "downtown",
      "guadalupe",
      "congress",
      "rainey",
    ],
    discovery: {
      lumaUrl: "https://lu.ma/austin",
      eventbriteUrl: "https://www.eventbrite.com/d/tx--austin/events/",
      subreddits: ["Austin", "AustinTech", "startups"],
      githubLocationQuery: "location:Austin followers:>20",
      openDataVenuesUrl: "https://data.austintexas.gov/resource/ecmv-9xxi.json?$limit=40",
      liquorLicensesUrl: null,
    },
    legal: {
      laborClassification: "1099_allowed",
      w2RequiredForStreetTeams: false,
      flierLicenceRequired: false,
      freelanceStatute:
        "Texas written itemized independent contractor clickwrap agreement retained 6 years; internal payout SLA <= 15 days (48h target post-proof).",
      payoutSlaDays: 15,
      antiPostingRule:
        "Austin City Code § 14-9-21 & § 25-10-103: Hand-to-hand distribution on public sidewalks only. Zero posting on utility poles, right-of-way signs, trees, or parked cars.",
      transitExclusionRule:
        "CapMetro Rules: Commercial handbill distribution prohibited inside CapMetro rail stations and buses.",
      likenessReleaseStatute:
        "Texas common-law right of publicity & TX CUBI (Bus. & Com. Code § 503.001): Prior written commercial likeness release required for every 18+ filmed participant; zero biometric facial-geometry extraction.",
      disclosureAuthority:
        "FTC 16 CFR Part 255 & 465: Mandatory spoken + on-screen #Ad disclosure and native Commercial Content toggle.",
      permitSummary:
        "Public sidewalk hand-to-hand permitted; during SXSW obey temporary right-of-way crowd-control zones and stay off private badges-only footprints.",
    },
    vendors: {
      craigslistSubdomain: "austin",
      craigslistPostFeeCents: 700,
      recommendedAgencies: [
        "Kinetic Events Staffing",
        "Street Teams Co",
        "The PUSH Agency",
        "Victory Agency",
      ],
      recommendedPrinters: ["GotPrint", "4over Wholesale", "MOO"],
    },
  },

  london: {
    code: "london",
    label: "London",
    country: "UK",
    currency: "GBP",
    timezone: "Europe/London",
    isPrimaryLaunch: false,
    defaultMonthlyBudgetCents: 650_000,
    defaultDailyCapCents: 65_000,
    defaultMaxTaskCents: 130_000,
    activationWaitlistMinAdults: 150,
    activationMinSignedVenues: 10,
    corridors: [
      {
        neighborhood: "Shoreditch / Old Street",
        landmarks: "Redchurch St, Brick Lane & Old St roundabout perimeter (licensed Hackney/Tower Hamlets zones)",
        bestWindows: "Thu-Sun 1:00 PM - 7:00 PM",
        primaryApps: ["peon", "ntwrk"],
      },
      {
        neighborhood: "Soho / Fitzrovia",
        landmarks: "Carnaby / Berwick St & Charlotte St (Westminster/Camden consent required)",
        bestWindows: "Thu-Sat 2:00 PM - 7:30 PM",
        primaryApps: ["slop", "ntwrk"],
      },
      {
        neighborhood: "Clapham / Brixton / Peckham",
        landmarks: "High St commercial corridors (Lambeth/Southwark consent)",
        bestWindows: "Fri-Sun 1:00 PM - 6:30 PM",
        primaryApps: ["friends", "slop"],
      },
    ],
    neighborhoodPatterns: [
      { label: "Shoreditch / Hackney", patterns: ["shoreditch", "hackney", "old street", "dalston", "hoxton"] },
      { label: "Soho / Fitzrovia", patterns: ["soho london", "fitzrovia", "covent garden", "marylebone", "westminster"] },
      { label: "Camden / King's Cross", patterns: ["camden", "king's cross", "kings cross", "islington", "angel"] },
      { label: "South London", patterns: ["peckham", "brixton", "clapham", "borough", "southwark"] },
      { label: "London", patterns: ["london", "canary wharf", "city of london"] },
    ],
    transitKeywords: [
      "london",
      "tube",
      "underground",
      "overground",
      "tfl",
      "elizabeth line",
      "shoreditch",
      "soho",
      "hackney",
      "clapham",
      "islington",
      "camden",
    ],
    discovery: {
      lumaUrl: "https://lu.ma/london",
      eventbriteUrl: "https://www.eventbrite.co.uk/d/united-kingdom--london/events/",
      subreddits: ["london", "LondonSocialClub", "startups"],
      githubLocationQuery: "location:London followers:>25",
      openDataVenuesUrl: null,
      liquorLicensesUrl: null,
    },
    legal: {
      laborClassification: "uk_paye_or_agency",
      w2RequiredForStreetTeams: true,
      flierLicenceRequired: true,
      freelanceStatute:
        "UK Employment Rights & IR35 Compliance: Use UK-insured PAYE staffing agencies (e.g., Elevate Global London) for hourly street teams; independent creators receive written UK services contracts with <= 15d payout SLA.",
      payoutSlaDays: 15,
      antiPostingRule:
        "UK Environmental Protection Act 1990 Schedule 3A: Designated London boroughs (Westminster, Camden, Hackney, Islington, Lambeth, Southwark, Tower Hamlets) REQUIRE a prior council Free Printed Matter Distribution Licence before ANY commercial hand-to-hand fliering. Fly-posting is a criminal offence.",
      transitExclusionRule:
        "TfL Byelaws: Commercial distribution is strictly prohibited on London Underground, Overground, Elizabeth Line, DLR, and bus station premises.",
      likenessReleaseStatute:
        "UK GDPR & Data Protection Act 2018: Explicit written 18+ commercial image/voice consent and privacy notice required before publishing street-interview footage.",
      disclosureAuthority:
        "UK ASA / CAP Code Rule 2.1 & DMCC Act: Prominent upfront 'Ad' label (not buried hashtags) + spoken disclosure on all paid creator posts.",
      permitSummary:
        "HARD GATE: Must hold an active borough Free Printed Matter Distribution Licence reference before dispatching any street fliering shift.",
    },
    vendors: {
      craigslistSubdomain: "london",
      craigslistPostFeeCents: 700,
      recommendedAgencies: ["Elevate Global (London & NYC)", "Oppizi UK"],
      recommendedPrinters: ["MOO UK", "Instantprint UK", "Solopress UK"],
    },
  },
};

export function isSupportedCity(city: string): city is SupportedCity {
  const normalized = city.trim().toLowerCase();
  return (SUPPORTED_CITIES as readonly string[]).includes(normalized);
}

export function normalizeCityCode(city: string | undefined | null): SupportedCity {
  if (!city) return "nyc";
  const normalized = city.trim().toLowerCase();
  return isSupportedCity(normalized) ? normalized : "nyc";
}

export function getCityConfig(city: string | undefined | null): CityLaunchConfig {
  return CITY_CONFIGS[normalizeCityCode(city)];
}

export function listCityConfigs(): readonly CityLaunchConfig[] {
  return SUPPORTED_CITIES.map((code) => CITY_CONFIGS[code]);
}

export function detectCityNeighborhood(
  city: string,
  text: string,
): string | undefined {
  const config = getCityConfig(city);
  const hay = text.toLowerCase();
  for (const entry of config.neighborhoodPatterns) {
    if (entry.patterns.some((p) => hay.includes(p))) {
      return entry.label;
    }
  }
  return undefined;
}

export function matchesCityTransitOrLocality(
  city: string,
  replyText: string,
): boolean {
  const config = getCityConfig(city);
  const lower = replyText.toLowerCase();
  if (lower.includes(config.code) || lower.includes(config.label.toLowerCase())) {
    return true;
  }
  return config.transitKeywords.some((kw) => lower.includes(kw));
}

export function checkCityHiringCompliance(
  input: CityHiringComplianceInput,
): CityHiringComplianceResult {
  const config = getCityConfig(input.city);
  const reasons: string[] = [];

  const isHourlyFieldRole =
    input.role === "street_fliering" || input.role === "event_activation";

  if (
    isHourlyFieldRole &&
    config.legal.w2RequiredForStreetTeams &&
    input.contractorMode === "1099_direct"
  ) {
    reasons.push(
      `${config.label} requires W-2/PAYE agency staffing for hourly ${input.role} (${config.legal.laborClassification}); direct 1099 hiring is blocked.`,
    );
  }

  if (
    input.role === "street_fliering" &&
    config.legal.flierLicenceRequired &&
    (!input.boroughLicenceRef || input.boroughLicenceRef.trim().length < 3)
  ) {
    reasons.push(
      `${config.label} requires an active borough Free Printed Matter Distribution Licence reference (UK EPA 1990 Schedule 3A) before dispatching street fliering.`,
    );
  }

  const requiredNotice = [
    config.legal.antiPostingRule,
    config.legal.transitExclusionRule,
    config.legal.freelanceStatute,
  ].join(" ");

  return {
    allowed: reasons.length === 0,
    city: config.code,
    reasons,
    requiredNotice,
  };
}

export function canActivateCityExpansion(
  city: string,
  verifiedStage2Adults: number,
  signedVenues: number,
): CityActivationReadiness {
  const config = getCityConfig(city);
  const adults = Math.max(0, Math.floor(verifiedStage2Adults));
  const venues = Math.max(0, Math.floor(signedVenues));
  const blockers: string[] = [];

  if (!config.isPrimaryLaunch) {
    if (adults < config.activationWaitlistMinAdults) {
      blockers.push(
        `Waitlist threshold unmet: ${adults}/${config.activationWaitlistMinAdults} verified 18+ Stage-2 adults in ${config.label}.`,
      );
    }
    if (venues < config.activationMinSignedVenues) {
      blockers.push(
        `Venue readiness unmet: ${venues}/${config.activationMinSignedVenues} signed partner venues in ${config.label}.`,
      );
    }
  }

  return {
    city: config.code,
    ready: blockers.length === 0,
    isPrimaryLaunch: config.isPrimaryLaunch,
    verifiedStage2Adults: adults,
    requiredAdults: config.activationWaitlistMinAdults,
    signedVenues: venues,
    requiredVenues: config.activationMinSignedVenues,
    blockers,
  };
}
