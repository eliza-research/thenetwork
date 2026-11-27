import { RealClock } from "../../../packages/core/src/clock.ts";
import { LeakGuard } from "../../../packages/core/src/guard.ts";
import { requireCityPack } from "./city-registry.ts";
import { marketingLeakAllowlist } from "./constants.ts";
import type { DesireLaneId } from "./desire-lanes.ts";
import type { NetworkCoreBridge } from "./network-bridge.ts";
import { evaluateReportRisk } from "./platform-playbooks.ts";
import {
  evaluateContactHygiene,
  isLocalQuietHours,
  keyedContactHash,
} from "./policy.ts";
import type { MarketingStore } from "./store.ts";
import type { Clock, VipProspect, VipProspectStatus } from "./types.ts";

export interface VipArchetypeSpec {
  readonly num: number;
  readonly slug: string;
  readonly title: string;
  readonly desireLane: DesireLaneId;
  readonly primaryFreeSources: readonly string[];
  readonly tableRoleLabel: string;
  readonly preferredNight: "Thu" | "Mon" | "Tue";
  readonly angleTag: string;
  readonly salutationPrefix: string;
  readonly antiAnnoyanceDisarm: string;
  readonly roomFraming: string;
  readonly bilateralValueProp: string;
  readonly apolloTitles: readonly string[];
  readonly matchKeywords: readonly string[];
}

export const VIP_ARCHETYPES: readonly VipArchetypeSpec[] = [
  {
    num: 1,
    slug: "startup_founder",
    title: "Startup Founders & Scale-Up CEOs",
    desireLane: "cofounder_venture",
    primaryFreeSources: ["SEC EDGAR Form D", "YC Directory", "HN Show HN"],
    tableRoleLabel: "a technical founder",
    preferredNight: "Thu",
    angleTag: "zero_vc_operator_table",
    salutationPrefix: "",
    antiAnnoyanceDisarm: "Strictly no pitching and no investors.",
    roomFraming: "a quiet 6-seat off-the-record operator dinner",
    bilateralValueProp: "a peer founder or rare senior builder solving the same scaling problem",
    apolloTitles: ["Founder", "Co-Founder", "Chief Executive Officer", "CEO"],
    matchKeywords: ["founder", "co-founder", "ceo", "seed", "series a", "form d", "yc"],
  },
  {
    num: 2,
    slug: "vc_lp",
    title: "VCs, Super-Angels & Institutional LPs",
    desireLane: "investors_patrons",
    primaryFreeSources: ["SEC Form ADV/IAPD", "SEC Form D", "Luma VC Calendars"],
    tableRoleLabel: "a seed investor",
    preferredNight: "Thu",
    angleTag: "contrarian_thesis_salon",
    salutationPrefix: "",
    antiAnnoyanceDisarm: "No cold decks, no pitch-slapping.",
    roomFraming: "a 6-seat thesis-first salon with frontier researchers and builders",
    bilateralValueProp: "a non-consensus technical researcher or pre-raise builder aligned with your thesis",
    apolloTitles: ["General Partner", "Managing Partner", "Partner", "Angel Investor"],
    matchKeywords: ["venture", "general partner", "angel", "lp", "fund", "form adv", "endowment"],
  },
  {
    num: 3,
    slug: "patent_inventor",
    title: "Inventors & Prolific Patent Holders",
    desireLane: "cofounder_venture",
    primaryFreeSources: ["USPTO Open Data Portal", "Google Patents BigQuery"],
    tableRoleLabel: "a hardware inventor",
    preferredNight: "Thu",
    angleTag: "builder_behind_the_patent",
    salutationPrefix: "",
    antiAnnoyanceDisarm: "Not recruiting, not selling IP services.",
    roomFraming: "a 6-seat atoms-over-bits builder table",
    bilateralValueProp: "an industrial designer or hard-tech operator who ships physical products",
    apolloTitles: ["Principal Inventor", "Chief Scientist", "VP Hardware", "Hardware Architect"],
    matchKeywords: ["patent", "inventor", "uspto", "hardware prototype"],
  },
  {
    num: 4,
    slug: "scientist_academic",
    title: "Scientists & Top Academics",
    desireLane: "mentorship_mastery",
    primaryFreeSources: ["OpenAlex API", "Semantic Scholar", "NSF", "NIH RePORTER", "ORCID"],
    tableRoleLabel: "a cognitive scientist",
    preferredNight: "Thu",
    angleTag: "interdisciplinary_translation_table",
    salutationPrefix: "",
    antiAnnoyanceDisarm: "No panels, no press, no sales.",
    roomFraming: "a 6-seat cross-discipline table outside departmental silos",
    bilateralValueProp: "an applied builder or writer working directly on your research frontier",
    apolloTitles: ["Professor", "Associate Professor", "Principal Investigator", "Research Fellow"],
    matchKeywords: ["professor", "fellow", "openalex", "nsf", "nih", "h-index", "university", "phd"],
  },
  {
    num: 5,
    slug: "ai_biotech_researcher",
    title: "AI, Biotech & Frontier Hardware Researchers",
    desireLane: "cofounder_venture",
    primaryFreeSources: ["arXiv API", "bioRxiv", "Hugging Face Hub", "OpenAlex"],
    tableRoleLabel: "an AI researcher",
    preferredNight: "Thu",
    angleTag: "chatham_house_frontier_table",
    salutationPrefix: "",
    antiAnnoyanceDisarm: "Not recruiting, strictly off-the-record.",
    roomFraming: "a 6-seat Chatham House frontier research dinner",
    bilateralValueProp: "a peer lab lead or systems builder tackling the same open problem",
    apolloTitles: ["Research Scientist", "Member of Technical Staff", "Staff Research Scientist", "Lab Director"],
    matchKeywords: ["arxiv", "biorxiv", "neurips", "icml", "iclr", "interpretability", "biotech", "robotics"],
  },
  {
    num: 6,
    slug: "quant_finance",
    title: "Hedge Fund Managers, Quants & Finance Leaders",
    desireLane: "investors_patrons",
    primaryFreeSources: ["SEC Form 13F", "SEC Form ADV", "FINRA BrokerCheck"],
    tableRoleLabel: "a quant strategist",
    preferredNight: "Thu",
    angleTag: "high_discretion_polymath_table",
    salutationPrefix: "",
    antiAnnoyanceDisarm: "Zero finance sales, zero press, full discretion.",
    roomFraming: "a high-discretion 6-seat polymath dinner outside finance",
    bilateralValueProp: "a frontier scientist or founder outside Wall Street worth debating",
    apolloTitles: ["Portfolio Manager", "Quantitative Researcher", "Head of Research", "Managing Director"],
    matchKeywords: ["quant", "hedge fund", "13f", "portfolio manager", "macro strategist"],
  },
  {
    num: 7,
    slug: "author_journalist",
    title: "Best-Selling Authors, Essayists & Investigative Journalists",
    desireLane: "creative_collab",
    primaryFreeSources: ["NYT Books API", "Substack Directories", "Pulitzer Archives"],
    tableRoleLabel: "an investigative writer",
    preferredNight: "Thu",
    angleTag: "idea_first_salon",
    salutationPrefix: "",
    antiAnnoyanceDisarm: "Not a PR pitch, strictly off-the-record.",
    roomFraming: "a 6-seat idea-first dinner with rare domain practitioners",
    bilateralValueProp: "an under-exposed practitioner with firsthand stories in your beat",
    apolloTitles: ["Staff Writer", "Senior Editor", "Investigative Journalist", "Author"],
    matchKeywords: ["author", "journalist", "pulitzer", "substack", "essayist", "novelist", "editor"],
  },
  {
    num: 8,
    slug: "filmmaker_artist",
    title: "Filmmakers, Directors, Musicians & Fine Artists",
    desireLane: "creative_collab",
    primaryFreeSources: ["TMDB API", "IMDb TSV", "Spotify Web API", "MusicBrainz"],
    tableRoleLabel: "a documentary director",
    preferredNight: "Thu",
    angleTag: "patron_free_creative_table",
    salutationPrefix: "",
    antiAnnoyanceDisarm: "No schmoozing, no pitching, no press.",
    roomFraming: "a 6-seat patron-free creative craft table",
    bilateralValueProp: "a complementary craftsperson (composer, designer, or writer) aligned with your next piece",
    apolloTitles: ["Film Director", "Documentary Filmmaker", "Executive Producer", "Showrunner"],
    matchKeywords: ["filmmaker", "director", "sundance", "musician", "artist", "biennial", "composer"],
  },
  {
    num: 9,
    slug: "elite_athlete",
    title: "Elite Athletes, Olympians & Championship Coaches",
    desireLane: "sport_wellness_crew",
    primaryFreeSources: ["Olympedia", "World Athletics", "SweatPals Elite Captains"],
    tableRoleLabel: "an Olympic rower",
    preferredNight: "Tue",
    angleTag: "second_act_peak_performance_table",
    salutationPrefix: "",
    antiAnnoyanceDisarm: "Not an endorsement pitch, zero press.",
    roomFraming: "a quiet 6-seat Tuesday table for builders and athletes outside the spotlight",
    bilateralValueProp: "a sharp founder or fellow high-performer navigating a similar next chapter",
    apolloTitles: ["Head Coach", "Performance Director", "Olympic Athlete", "Athletic Director"],
    matchKeywords: ["olympian", "athlete", "marathon", "coach", "championship", "all-american"],
  },
  {
    num: 10,
    slug: "michelin_chef_hospitality",
    title: "Michelin-Starred Chefs & Cult Hospitality Founders",
    desireLane: "bespoke_irl_experience",
    primaryFreeSources: ["James Beard Finder", "Michelin Guide", "Municipal Hospitality Filings"],
    tableRoleLabel: "a Michelin pastry chef",
    preferredNight: "Mon",
    angleTag: "monday_off_night_hospitality_salon",
    salutationPrefix: "Chef ",
    antiAnnoyanceDisarm: "People from outside hospitality, no press, no shop talk.",
    roomFraming: "a quiet 6-seat off-duty Monday dinner",
    bilateralValueProp: "an architect or founder who deeply appreciates hospitality craft",
    apolloTitles: ["Executive Chef", "Chef Owner", "Culinary Director", "Restaurateur"],
    matchKeywords: ["chef", "michelin", "james beard", "sommelier", "restaurateur", "hospitality"],
  },
  {
    num: 11,
    slug: "architect_designer",
    title: "Architects & Industrial Designers",
    desireLane: "creative_collab",
    primaryFreeSources: ["AIA Directory", "USPTO Design Patents", "Core77"],
    tableRoleLabel: "an industrial designer",
    preferredNight: "Thu",
    angleTag: "object_and_space_table",
    salutationPrefix: "",
    antiAnnoyanceDisarm: "No client pitching, pure craft conversation.",
    roomFraming: "a 6-seat object-and-space dinner with hardware builders and curators",
    bilateralValueProp: "a hospitality founder or hardware engineer thinking deeply about physical space",
    apolloTitles: ["Principal Architect", "Industrial Design Director", "Founding Partner"],
    matchKeywords: ["architect", "industrial designer", "aia", "pritzker", "design studio"],
  },
  {
    num: 12,
    slug: "oss_maintainer",
    title: "Open-Source Maintainers & Core Committers",
    desireLane: "money_work",
    primaryFreeSources: ["GitHub REST/GraphQL", "HN Algolia"],
    tableRoleLabel: "a systems maintainer",
    preferredNight: "Thu",
    angleTag: "zero_recruiting_craft_table",
    salutationPrefix: "",
    antiAnnoyanceDisarm: "Upfront: not recruiting, not selling tools.",
    roomFraming: "a small 6-seat off-the-record systems craft dinner",
    bilateralValueProp: "a peer maintainer or systems architect solving the exact same bottleneck",
    apolloTitles: ["Open Source Maintainer", "Core Maintainer", "Principal Systems Engineer"],
    matchKeywords: ["open source", "maintainer", "github", "committer", "rust", "postgres"],
  },
  {
    num: 13,
    slug: "policymaker_diplomat",
    title: "Policymakers, Think-Tank Fellows & Diplomats",
    desireLane: "elite_serendipity",
    primaryFreeSources: ["Congress.gov API", "FEC API", "Think-Tank Directories"],
    tableRoleLabel: "a policy fellow",
    preferredNight: "Thu",
    angleTag: "off_the_record_tech_policy_table",
    salutationPrefix: "",
    antiAnnoyanceDisarm: "Zero lobbyists, zero press, Chatham House rules.",
    roomFraming: "an off-the-record 6-seat tech-and-policy dinner",
    bilateralValueProp: "an active AI, energy, or biotech practitioner with unvarnished field perspective",
    apolloTitles: ["Senior Fellow", "Policy Director", "Diplomat", "Commissioner"],
    matchKeywords: ["policy", "diplomat", "senate", "think tank", "commissioner", "consulate"],
  },
  {
    num: 14,
    slug: "podcaster_curator",
    title: "Top Podcasters, Editors & Cultural Curators",
    desireLane: "creative_collab",
    primaryFreeSources: ["Podcast RSS", "YouTube RSS", "Luma Discovery"],
    tableRoleLabel: "a cultural curator",
    preferredNight: "Thu",
    angleTag: "under_exposed_minds_table",
    salutationPrefix: "",
    antiAnnoyanceDisarm: "Not a guest PR pitch, zero sponsorship ask.",
    roomFraming: "a 6-seat dinner for rare, under-exposed thinkers",
    bilateralValueProp: "an unusual practitioner outside the standard PR circuit worth knowing",
    apolloTitles: ["Podcast Host", "Executive Producer", "Editorial Director", "Cultural Curator"],
    matchKeywords: ["podcast", "curator", "host", "radio", "editorial"],
  },
  {
    num: 15,
    slug: "leading_physician",
    title: "Leading Physicians, Surgeons & Longevity Specialists",
    desireLane: "mentorship_mastery",
    primaryFreeSources: ["ClinicalTrials.gov v2", "NPPES NPI API", "PubMed E-utilities"],
    tableRoleLabel: "a clinical trial surgeon",
    preferredNight: "Thu",
    angleTag: "outside_hospital_bubble_table",
    salutationPrefix: "Dr. ",
    antiAnnoyanceDisarm: "Not selling medical software, zero pharma.",
    roomFraming: "a 6-seat dinner outside the hospital bubble",
    bilateralValueProp: "a biotech researcher or engineer translating work in your clinical domain",
    apolloTitles: ["Attending Surgeon", "Chief of Medicine", "Clinical Investigator", "Physician"],
    matchKeywords: ["surgeon", "physician", "md", "clinical trial", "longevity", "oncology", "langone", "sinai"],
  },
  {
    num: 16,
    slug: "philanthropist_foundation",
    title: "Philanthropists, Museum Directors & Major Nonprofit Heads",
    desireLane: "investors_patrons",
    primaryFreeSources: ["ProPublica Nonprofit Explorer 990", "IRS EO BMF"],
    tableRoleLabel: "a museum director",
    preferredNight: "Thu",
    angleTag: "anti_gala_serendipity_table",
    salutationPrefix: "",
    antiAnnoyanceDisarm: "Strictly zero fundraising or solicitation.",
    roomFraming: "an anti-gala 6-seat peer table where nobody is pitching",
    bilateralValueProp: "a high-integrity scientist or artist aligned with your curiosity (zero ask)",
    apolloTitles: ["Executive Director", "Museum Director", "Chief Curator", "Program Director"],
    matchKeywords: ["foundation", "museum", "nonprofit", "990", "philanthropist", "501(c)(3)"],
  },
  {
    num: 17,
    slug: "legal_rainmaker",
    title: "Legal & M&A Rainmakers / Appellate Litigators",
    desireLane: "elite_serendipity",
    primaryFreeSources: ["CourtListener API", "SEC EDGAR Exhibits"],
    tableRoleLabel: "an appellate litigator",
    preferredNight: "Thu",
    angleTag: "intellectual_peerage_outside_billables",
    salutationPrefix: "",
    antiAnnoyanceDisarm: "Zero business development theater, off-the-record.",
    roomFraming: "a 6-seat intellectual peerage dinner outside law firms",
    bilateralValueProp: "a frontier founder or policy thinker debating an issue you care about",
    apolloTitles: ["Litigation Partner", "Appellate Counsel", "General Counsel", "M&A Partner"],
    matchKeywords: ["litigator", "appellate", "prosecutor", "sdny", "general counsel", "courtlistener"],
  },
  {
    num: 18,
    slug: "defense_space_energy",
    title: "Defense, Aerospace, Space & Next-Gen Energy Pioneers",
    desireLane: "cofounder_venture",
    primaryFreeSources: ["USASpending.gov API", "SBIR.gov API", "DOE ARPA-E"],
    tableRoleLabel: "a fusion engineer",
    preferredNight: "Thu",
    angleTag: "hard_tech_atoms_over_bits_table",
    salutationPrefix: "",
    antiAnnoyanceDisarm: "Zero consulting pitches, off-the-record.",
    roomFraming: "a 6-seat hard-tech atoms-over-bits dinner",
    bilateralValueProp: "a robotics, materials, or energy peer building in the same metro",
    apolloTitles: ["Propulsion Lead", "Fusion Engineer", "VP Aerospace", "Chief Engineer"],
    matchKeywords: ["aerospace", "fusion", "sbir", "darpa", "orbital", "energy", "satellite", "defense"],
  },
  {
    num: 19,
    slug: "creative_director_tastemaker",
    title: "Creative Directors, Brand Builders & Cultural Tastemakers",
    desireLane: "creative_collab",
    primaryFreeSources: ["D&AD / TDC Archives", "Editorial Mastheads", "Luma Art Salons"],
    tableRoleLabel: "a creative director",
    preferredNight: "Thu",
    angleTag: "high_taste_cross_medium_table",
    salutationPrefix: "",
    antiAnnoyanceDisarm: "No influencer stunts, no agency pitches.",
    roomFraming: "a 6-seat cross-medium taste dinner with architects, chefs, and founders",
    bilateralValueProp: "a founder or architect building something culturally original",
    apolloTitles: ["Creative Director", "VP Brand", "Head of Brand", "Executive Creative Director"],
    matchKeywords: ["creative director", "brand director", "tastemaker", "art direction", "fashion director"],
  },
  {
    num: 20,
    slug: "super_connector_host",
    title: "Super-Connectors, Salon Hosts & Community Architects",
    desireLane: "elite_serendipity",
    primaryFreeSources: ["Luma Repeat Hosts", "Partiful Public Hosts", "Substack Salonists"],
    tableRoleLabel: "a salon host",
    preferredNight: "Thu",
    angleTag: "hosts_who_dont_have_to_host_table",
    salutationPrefix: "",
    antiAnnoyanceDisarm: "Zero ask — just happy to send great humans your way.",
    roomFraming: "a 6-seat hosts-only dinner where you don't have to host",
    bilateralValueProp: "one or two extraordinary vetted guests who genuinely elevate your next room",
    apolloTitles: ["Community Director", "Salon Host", "Head of Community", "Founder"],
    matchKeywords: ["super-connector", "super-host", "salon host", "community architect", "supper club"],
  },
  {
    num: 21,
    slug: "senior_staff_engineer",
    title: "Staff / Distinguished Engineers & Technical Architects",
    desireLane: "money_work",
    primaryFreeSources: ["Engineering Blogs", "Conference Talks", "GitHub"],
    tableRoleLabel: "a staff architect",
    preferredNight: "Thu",
    angleTag: "zero_recruiter_architecture_table",
    salutationPrefix: "",
    antiAnnoyanceDisarm: "Upfront: zero recruiting, zero vendor sales.",
    roomFraming: "a 6-seat senior engineering dinner on real architecture tradeoffs",
    bilateralValueProp: "a peer staff architect or technical founder working on the same systems scale",
    apolloTitles: ["Staff Software Engineer", "Principal Engineer", "Distinguished Engineer", "Chief Architect"],
    matchKeywords: ["staff engineer", "principal engineer", "distinguished engineer", "technical architect", "distributed systems"],
  },
  {
    num: 22,
    slug: "indie_maker_shipper",
    title: "Indie Makers, Bootstrapped Founders & Solo Shippers",
    desireLane: "cofounder_venture",
    primaryFreeSources: ["HN Show HN", "GitHub", "Independent Maker Blogs"],
    tableRoleLabel: "a bootstrapped maker",
    preferredNight: "Thu",
    angleTag: "solo_shippers_zero_vc_table",
    salutationPrefix: "",
    antiAnnoyanceDisarm: "Zero VC theater, zero course pitches.",
    roomFraming: "a 6-seat dinner strictly for people shipping profitable independent products",
    bilateralValueProp: "a local bootstrapped founder at similar craft and revenue stage",
    apolloTitles: ["Indie Founder", "Solo Founder", "Bootstrapped Founder", "Maker"],
    matchKeywords: ["bootstrapped", "indie maker", "solo founder", "micro-saas", "show hn", "indie hacker"],
  },
  {
    num: 23,
    slug: "executive_operator",
    title: "Executive Operators (COO, VP Eng, VP Product, Head of Design)",
    desireLane: "money_work",
    primaryFreeSources: ["Company Leadership Pages", "Operator Podcasts", "Apollo"],
    tableRoleLabel: "a VP of Product",
    preferredNight: "Thu",
    angleTag: "confidential_operator_sounding_board",
    salutationPrefix: "",
    antiAnnoyanceDisarm: "Not recruiting, not selling SaaS, strictly confidential.",
    roomFraming: "a 6-seat Chatham House operator dinner for senior scale-up leaders",
    bilateralValueProp: "a peer operator at the same company stage facing identical org tradeoffs",
    apolloTitles: ["Chief Operating Officer", "COO", "VP Engineering", "VP Product", "Head of Design"],
    matchKeywords: ["coo", "vp engineering", "vp product", "head of design", "chief operating officer", "vp operations"],
  },
  {
    num: 24,
    slug: "music_producer_programmer",
    title: "Music Producers, Touring Artists & Venue Programmers",
    desireLane: "bespoke_irl_experience",
    primaryFreeSources: ["MusicBrainz", "Spotify Credits", "Venue Programming Calendars"],
    tableRoleLabel: "a music producer",
    preferredNight: "Mon",
    angleTag: "late_afternoon_sound_and_culture_table",
    salutationPrefix: "",
    antiAnnoyanceDisarm: "No label pitches, no playlist spam.",
    roomFraming: "an off-night 6-seat creative table with filmmakers, architects, and sound minds",
    bilateralValueProp: "a documentary director, acoustics engineer, or listening-room founder",
    apolloTitles: ["Music Producer", "Talent Buyer", "Artistic Director", "Audio Director"],
    matchKeywords: ["music producer", "talent buyer", "venue programmer", "sound designer", "listening bar", "record label"],
  },
  {
    num: 25,
    slug: "gallery_collector",
    title: "Gallery Owners, Art Advisors & Cultural Collectors",
    desireLane: "investors_patrons",
    primaryFreeSources: ["Gallery Rosters", "Artforum", "ProPublica Cultural Boards"],
    tableRoleLabel: "a gallery director",
    preferredNight: "Thu",
    angleTag: "beyond_the_art_fair_salon",
    salutationPrefix: "",
    antiAnnoyanceDisarm: "No cold art pitches, no commercial brokerage.",
    roomFraming: "a quiet 6-seat salon pairing collectors with architects, scientists, and artists",
    bilateralValueProp: "a deeply curious founder, architect, or artist outside the repetitive fair circuit",
    apolloTitles: ["Gallery Director", "Gallery Owner", "Art Advisor", "Managing Partner"],
    matchKeywords: ["gallery director", "gallery owner", "art advisor", "art collector", "contemporary art"],
  },
  {
    num: 26,
    slug: "civic_urbanist_leader",
    title: "Civic Leaders, Urbanists & Housing / Transit / Climate Builders",
    desireLane: "elite_serendipity",
    primaryFreeSources: ["Municipal Boards", "Urbanist Newsletters", "Climate Week Luma"],
    tableRoleLabel: "an urbanist leader",
    preferredNight: "Thu",
    angleTag: "city_builders_cross_sector_table",
    salutationPrefix: "",
    antiAnnoyanceDisarm: "Zero lobbying, zero partisan theater.",
    roomFraming: "a 6-seat city-builders dinner bridging urbanism, engineering, and design",
    bilateralValueProp: "a local transit engineer, architect, or climate founder building real infrastructure",
    apolloTitles: ["Urban Planner", "Director of Transit", "Climate Director", "Housing Director"],
    matchKeywords: ["urbanist", "urban planning", "transit", "housing policy", "climate infrastructure", "civic"],
  },
  {
    num: 27,
    slug: "performance_coach_captain",
    title: "Performance Coaches, Sports Physicians & Run/Endurance Captains",
    desireLane: "sport_wellness_crew",
    primaryFreeSources: ["Strava / SweatPals Captains", "Marathon Qualifiers", "Sports Med Rosters"],
    tableRoleLabel: "an endurance captain",
    preferredNight: "Tue",
    angleTag: "tuesday_high_discipline_table",
    salutationPrefix: "",
    antiAnnoyanceDisarm: "No supplement brands, no influencer asks.",
    roomFraming: "a Tuesday 6-seat dinner for coaches, physicians, and disciplined founders",
    bilateralValueProp: "a sports-med physician or founder-athlete sharing your training standard",
    apolloTitles: ["Performance Coach", "Sports Medicine Physician", "Run Club Founder", "Strength Coach"],
    matchKeywords: ["run club", "running club", "endurance", "triathlon", "sports medicine", "strength coach", "captain"],
  },
  {
    num: 28,
    slug: "family_office_patron",
    title: "Family Office Principals & Private Cultural/Science Patrons",
    desireLane: "investors_patrons",
    primaryFreeSources: ["SEC Form D/ADV Family Offices", "IRS 990 Private Foundations"],
    tableRoleLabel: "a private patron",
    preferredNight: "Thu",
    angleTag: "zero_solicitation_private_salon",
    salutationPrefix: "",
    antiAnnoyanceDisarm: "Strictly zero capital raising or solicitation.",
    roomFraming: "an ultra-discreet 6-seat salon with scientists, artists, and operators",
    bilateralValueProp: "a vetted scientist or cultural creator aligned with your intellectual interests (zero ask)",
    apolloTitles: ["Family Office Principal", "Chief Investment Officer", "Managing Director"],
    matchKeywords: ["family office", "single family office", "private patron", "cio", "private foundation"],
  },
] as const;

export const VIP_ARCHETYPE_KEYWORDS: ReadonlyArray<readonly [string, readonly string[]]> =
  VIP_ARCHETYPES.map((arch) => [arch.slug, arch.matchKeywords] as const);

export interface VipPrestigeSignals {
  readonly archetypeSlug?: string | null;
  readonly bioOrSummary?: string | null;
  readonly primarySourceAuthority?: "tier1_filing" | "tier2_directory" | "social_only";
  readonly citationsOrStarsOrFundingScore?: number;
  readonly recentWithin18Months?: boolean;
  readonly inTargetCity?: boolean;
  readonly proofOfWorkHook?: string | null;
}

export interface VipPrestigeScoreResult {
  readonly score: number;
  readonly archetype: VipArchetypeSpec;
  readonly matchedExplicitly: boolean;
  readonly desireLane: DesireLaneId;
  readonly breakdown: {
    readonly sourceAuthority: number;
    readonly impact: number;
    readonly recency: number;
    readonly locality: number;
    readonly hookSpecificity: number;
  };
}

export type VipOfferMode = "bilateral_intro" | "curated_table";

export interface VipInviteDraftInput {
  readonly firstName: string;
  readonly archetypeSlug: string;
  readonly city: string;
  readonly neighborhood?: string;
  readonly proofOfWork1Line: string;
  readonly senderName: string;
  readonly dateLabel?: string;
  readonly desireLane?: DesireLaneId;
  readonly offerMode?: VipOfferMode;
  readonly bilateralPeerSummary?: string;
  readonly sharedExactProblem?: string;
  readonly confirmedCoSeatedRoles?: readonly string[];
}

export interface VipInviteValidationResult {
  readonly valid: boolean;
  readonly offerMode: VipOfferMode;
  readonly subject: string;
  readonly body: string;
  readonly wordCount: number;
  readonly archetype: VipArchetypeSpec;
  readonly desireLane: DesireLaneId;
  readonly coSeatedRoles: readonly string[];
  readonly reportRiskScore: number;
  readonly errors: readonly string[];
  readonly leakReasons: readonly string[];
}

export const MAX_VIP_INVITE_WORDS = 75;
export const MIN_VIP_FOLLOWUP_DAYS = 14;

const WEAK_HOOK_FALLBACK_PATTERN =
  /(open_data|dohmh|nys_sla|hn_show|arxiv_|manual_ui|public\s+discovery\s+slot|your\s+recent\s+work\s+at)/i;

const VIP_SPAM_TRIGGER_PATTERNS: ReadonlyArray<{ readonly label: string; readonly re: RegExp }> = [
  {
    label: "sales_hype_phrase",
    re: /\b(limited\s+time|act\s+now|free\s+trial|click\s+here|exclusive\s+offer|guaranteed|download\s+our\s+app|sign\s+up\s+today)\b/i,
  },
  {
    label: "calendly_or_booking_link",
    re: /\b(calendly|cal\.com|hubspot\.com\/meetings|book\s+a\s+demo)\b/i,
  },
  { label: "raw_url_not_allowed", re: /https?:\/\//i },
  { label: "html_or_tracking_pixel", re: /<[a-z][^>]*>/i },
  {
    label: "cash_vouch_violation",
    re: /\b(cash\s+bounty|paid\s+vouch|referral\s+cash|usdc\s+reward)\b/i,
  },
  {
    label: "fake_social_proof_or_cliche",
    re: /(sparked\s+a\s+real\s+debate|bubbling\s+this\s+up|rare\s+honesty\s+on\s+the\s+trade-offs|five\s+of\s+six\s+seats)/i,
  },
];

export function isWeakOrFallbackProofOfWorkHook(hook: string): boolean {
  const trimmed = hook.trim();
  if (trimmed.length < 14) return true;
  return WEAK_HOOK_FALLBACK_PATTERN.test(trimmed);
}

export function countWords(text: string): number {
  const tokens = text
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  return tokens.length;
}

export function inferSourceAuthority(
  publicSource: string | null | undefined,
): "tier1_filing" | "tier2_directory" | "social_only" {
  const s = (publicSource ?? "").trim().toLowerCase();
  if (
    /(sec|edgar|form_d|form d|uspto|patent|openalex|arxiv|biorxiv|clinical_trials|irs_990|990|courtlistener|sbir|arpa|nys_sla|dohmh|michelin|pulitzer|olympedia|apollo_verified)/.test(
      s,
    )
  ) {
    return "tier1_filing";
  }
  if (/(github|hn|hacker_news|yc|luma|eventbrite|meetup|substack|youtube|podcast|apollo|directory|aia|imdb)/.test(s)) {
    return "tier2_directory";
  }
  return "social_only";
}

export function getVipArchetypeOrNull(slugOrNum: string | number): VipArchetypeSpec | null {
  if (typeof slugOrNum === "number") {
    return VIP_ARCHETYPES.find((a) => a.num === slugOrNum) ?? null;
  }
  const normalized = slugOrNum.trim().toLowerCase();
  return (
    VIP_ARCHETYPES.find((a) => a.slug === normalized || a.title.toLowerCase() === normalized) ?? null
  );
}

export function getVipArchetype(slugOrNum: string | number): VipArchetypeSpec {
  return getVipArchetypeOrNull(slugOrNum) ?? VIP_ARCHETYPES[0];
}

export function classifyVipArchetypeOrNull(text: string): VipArchetypeSpec | null {
  const lower = text.toLowerCase();
  let best: VipArchetypeSpec | null = null;
  let bestHits = 0;
  for (const arch of VIP_ARCHETYPES) {
    let hits = 0;
    for (const kw of arch.matchKeywords) {
      if (lower.includes(kw)) hits += 1;
    }
    if (hits > bestHits) {
      bestHits = hits;
      best = arch;
    }
  }
  return best;
}

export function classifyVipArchetype(text: string): VipArchetypeSpec {
  return classifyVipArchetypeOrNull(text) ?? VIP_ARCHETYPES[0];
}

export function scoreVipProspect(signals: VipPrestigeSignals): VipPrestigeScoreResult {
  const explicitArch = signals.archetypeSlug
    ? getVipArchetypeOrNull(signals.archetypeSlug)
    : classifyVipArchetypeOrNull(`${signals.bioOrSummary ?? ""} ${signals.proofOfWorkHook ?? ""}`);
  const archetype = explicitArch ?? VIP_ARCHETYPES[0];
  const matchedExplicitly = explicitArch !== null;

  const sourceAuthority =
    signals.primarySourceAuthority === "tier1_filing"
      ? 35
      : signals.primarySourceAuthority === "tier2_directory"
        ? 22
        : 10;

  const rawImpact = signals.citationsOrStarsOrFundingScore ?? 50;
  const impact = Math.max(0, Math.min(30, Math.round((Math.max(0, Math.min(100, rawImpact)) / 100) * 30)));
  const recency = signals.recentWithin18Months === false ? 4 : 15;
  const locality = signals.inTargetCity === false ? 0 : 10;
  const hook = signals.proofOfWorkHook?.trim() ?? "";
  const hookSpecificity = isWeakOrFallbackProofOfWorkHook(hook)
    ? 0
    : hook.length >= 24
      ? 10
      : 5;

  const score = Math.max(
    0,
    Math.min(100, sourceAuthority + impact + recency + locality + hookSpecificity),
  );

  return {
    score,
    archetype,
    matchedExplicitly,
    desireLane: archetype.desireLane,
    breakdown: {
      sourceAuthority,
      impact,
      recency,
      locality,
      hookSpecificity,
    },
  };
}

export interface VipSendGateInput {
  readonly prospect: VipProspect;
  readonly store: MarketingStore;
  readonly bridge?: NetworkCoreBridge;
  readonly clock?: Clock;
  readonly env?: Record<string, string | undefined>;
  readonly lockdown?: boolean;
  readonly ignoreQuietHours?: boolean;
}

export interface VipSendGateResult {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly contactHash?: string;
}

export async function gateVipOutreach(input: VipSendGateInput): Promise<VipSendGateResult> {
  const env = input.env ?? process.env;
  const clock = input.clock ?? input.store.clock ?? new RealClock();
  const nowMs = clock.now();
  const email = input.prospect.contactEmail?.trim() ?? "";
  const contactHash = email
    ? keyedContactHash("email", email, env)
    : keyedContactHash("handle", `${input.prospect.city}:${input.prospect.name}`, env);
  if (!contactHash) {
    return { allowed: false, reason: "missing_vip_contact_hash" };
  }

  const suppression = await input.store.isContactSuppressed(contactHash);
  let bridgeMinor = false;
  let bridgeStopped = false;
  let bridgeBanned = false;
  let bridgeReason: string | undefined;
  if (input.bridge) {
    const verdict = await input.bridge.checkContactFence({
      email: email || null,
      handleHash: contactHash,
    });
    if (!verdict.allowed) {
      bridgeMinor = verdict.knownMinor;
      bridgeStopped = verdict.globallyStopped;
      bridgeBanned = verdict.banned || verdict.recycledHold || (!verdict.globallyStopped && !verdict.knownMinor);
      bridgeReason = verdict.reason;
    }
  }

  const isKnownMinor = Boolean(suppression?.isMinor) || bridgeMinor;
  const isStopped = bridgeStopped || Boolean(suppression?.reason.includes("stop"));
  const isBanned =
    bridgeBanned ||
    Boolean(suppression && !suppression.isMinor && !suppression.reason.includes("stop"));

  const stats = await input.store.getContactTouchpointStats(contactHash, nowMs);
  const quiet = input.ignoreQuietHours ? false : isLocalQuietHours(input.prospect.city, nowMs);
  const hygiene = evaluateContactHygiene({
    isStopped,
    isBanned,
    isKnownMinor,
    lockdown: Boolean(input.lockdown),
    isCold: true,
    isQuietHours: quiet,
    daysSinceCold: stats.daysSinceLastCold,
    coldTouches30d: stats.coldTouches30d,
    unansweredCold: stats.unansweredColdStreak,
    opTouchesToday: stats.opTouchesToday,
  });

  if (!hygiene.allowed) {
    return {
      allowed: false,
      reason: bridgeReason ?? hygiene.reason,
      contactHash,
    };
  }
  return { allowed: true, contactHash };
}

export async function recordVipOutreachTouch(
  store: MarketingStore,
  input: {
    readonly contactHash: string;
    readonly campaignId?: string | null;
    readonly isCold?: boolean;
    readonly answered?: boolean;
  },
): Promise<void> {
  await store.recordContactTouchpoint({
    contactHash: input.contactHash,
    campaignId: input.campaignId ?? null,
    surface: "vip",
    isCold: input.isCold ?? true,
    answered: input.answered ?? false,
  });
}

export class VipDiscoveryEngine {
  private readonly clock: Clock;
  private readonly leakGuard: LeakGuard;

  constructor(opts?: { readonly clock?: Clock; readonly leakGuard?: LeakGuard }) {
    this.clock = opts?.clock ?? new RealClock();
    this.leakGuard =
      opts?.leakGuard ??
      new LeakGuard({
        contacts: true,
        canaryShapes: true,
        allow: [...marketingLeakAllowlist()],
      });
  }

  listArchetypes(): readonly VipArchetypeSpec[] {
    return VIP_ARCHETYPES;
  }

  buildAndValidateVipInvite(input: VipInviteDraftInput): VipInviteValidationResult {
    const archetype = getVipArchetype(input.archetypeSlug);
    const cityPack = requireCityPack(input.city);
    const desireLane = input.desireLane ?? archetype.desireLane;
    const offerMode: VipOfferMode = input.offerMode ?? "curated_table";
    const firstName = input.firstName.trim() || "there";
    const salutation = archetype.salutationPrefix
      ? `Hi ${archetype.salutationPrefix}${firstName},`
      : `Hi ${firstName},`;
    const neighborhood =
      input.neighborhood?.trim() || cityPack.corridors[0]?.neighborhood || cityPack.label;
    const hook = input.proofOfWork1Line.trim().replace(/\.+$/, "");
    const confirmedRoles = (input.confirmedCoSeatedRoles ?? [])
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
    const night = input.dateLabel?.trim() || `next ${archetype.preferredNight}`;
    const confirmedSeatClause =
      confirmedRoles.length > 0 ? ` with ${confirmedRoles.join(", ")}` : "";

    let subject: string;
    let body: string;

    if (offerMode === "bilateral_intro") {
      const peerDesc = input.bilateralPeerSummary?.trim() || archetype.bilateralValueProp;
      const problem = input.sharedExactProblem?.trim();
      subject = `Quick intro in ${neighborhood}`;
      body = [
        salutation,
        `Read ${hook} and wanted to pass along one concrete intro.`,
        problem
          ? `Know ${peerDesc} in ${cityPack.label} working on ${problem}. ${archetype.antiAnnoyanceDisarm}`
          : `Know ${peerDesc} in ${cityPack.label} you might genuinely enjoy 20 minutes with. ${archetype.antiAnnoyanceDisarm}`,
        `Happy to connect you two with zero strings — totally fine to pass.`,
        `— ${input.senderName}`,
      ].join("\n\n");
    } else {
      subject =
        archetype.slug === "oss_maintainer" || archetype.slug === "senior_staff_engineer"
          ? `Quick note on your work (not recruiting)`
          : archetype.slug === "michelin_chef_hospitality"
            ? `Monday dinner in ${neighborhood}`
            : `${neighborhood} 6-seat dinner ${night}`;
      body = [
        salutation,
        `Read ${hook} and thought you would enjoy the conversation in ${cityPack.label}.`,
        `Hosting ${archetype.roomFraming} ${night} in ${neighborhood}${confirmedSeatClause}. ${archetype.antiAnnoyanceDisarm}`,
        `Happy to save you a seat if timing works — totally fine to pass.`,
        `— ${input.senderName}`,
      ].join("\n\n");
    }

    const baseResult = this.validateVipInvite(
      subject,
      body,
      archetype,
      confirmedRoles,
      desireLane,
      offerMode,
    );
    if (isWeakOrFallbackProofOfWorkHook(hook)) {
      return {
        ...baseResult,
        valid: false,
        errors: [
          ...baseResult.errors,
          "weak_or_fallback_proof_of_work_hook: supply a specific, human-readable proof-of-work reference (>=14 chars, no raw DB slugs).",
        ],
      };
    }

    return baseResult;
  }

  validateVipInvite(
    subject: string,
    body: string,
    archetype: VipArchetypeSpec,
    coSeatedRoles: readonly string[] = [],
    desireLane: DesireLaneId = archetype.desireLane,
    offerMode: VipOfferMode = "curated_table",
  ): VipInviteValidationResult {
    const errors: string[] = [];
    const wordCount = countWords(body);

    if (wordCount === 0) {
      errors.push("empty_invite_body");
    }
    if (wordCount > MAX_VIP_INVITE_WORDS) {
      errors.push(`exceeds_75_word_limit (${wordCount} > ${MAX_VIP_INVITE_WORDS})`);
    }

    const fullText = `${subject}\n${body}`;
    for (const rule of VIP_SPAM_TRIGGER_PATTERNS) {
      if (rule.re.test(fullText)) {
        errors.push(rule.label);
      }
    }

    const leakReasons = this.leakGuard.check(fullText);
    for (const r of leakReasons) {
      errors.push(`leak_guard:${r}`);
    }

    const risk = evaluateReportRisk({
      platform: "luma",
      subject,
      text: body,
      isFirstTouch: true,
      hasRecipientSpecificReference: true,
      leakGuard: this.leakGuard,
    });
    if (!risk.pass) {
      for (const flag of risk.flags) {
        if (!flag.startsWith("leak_guard:") && !errors.includes(flag)) {
          errors.push(`report_risk:${flag}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      offerMode,
      subject,
      body,
      wordCount,
      archetype,
      desireLane,
      coSeatedRoles,
      reportRiskScore: risk.score,
      errors,
      leakReasons,
    };
  }

  buildVipFollowUp(
    firstName: string,
    daysSinceFirstTouch: number,
    topicLabel: string,
    senderName: string,
  ): {
    readonly allowed: boolean;
    readonly touch: 2;
    readonly minDaysRequired: number;
    readonly body: string | null;
    readonly wordCount: number;
    readonly reason?: string;
  } {
    if (!Number.isFinite(daysSinceFirstTouch) || daysSinceFirstTouch < MIN_VIP_FOLLOWUP_DAYS) {
      return {
        allowed: false,
        touch: 2,
        minDaysRequired: MIN_VIP_FOLLOWUP_DAYS,
        body: null,
        wordCount: 0,
        reason: `cold_cooldown_window_active (${daysSinceFirstTouch}d < ${MIN_VIP_FOLLOWUP_DAYS}d)`,
      };
    }
    const name = firstName.trim() || "there";
    const body = `Hi ${name} — quick final note in case last month was packed. Still happy to connect you on the ${topicLabel} intro if useful; otherwise I will leave you be. — ${senderName}`;
    return {
      allowed: true,
      touch: 2,
      minDaysRequired: MIN_VIP_FOLLOWUP_DAYS,
      body,
      wordCount: countWords(body),
    };
  }

  toProspectDraft(input: {
    readonly id: string;
    readonly campaignId: string;
    readonly city: string;
    readonly name: string;
    readonly organization?: string | null;
    readonly publicSource: string;
    readonly sourceUrl?: string | null;
    readonly contactEmail?: string | null;
    readonly signals: VipPrestigeSignals;
    readonly status?: VipProspectStatus;
  }): VipProspect {
    const nowIso = new Date(this.clock.now()).toISOString();
    const scored = scoreVipProspect({
      ...input.signals,
      primarySourceAuthority:
        input.signals.primarySourceAuthority ?? inferSourceAuthority(input.publicSource),
    });
    const cityPack = requireCityPack(input.city);
    return {
      id: input.id,
      campaignId: input.campaignId,
      city: cityPack.code,
      desireLane: scored.desireLane,
      name: input.name,
      archetype: scored.archetype.slug,
      organization: input.organization ?? null,
      publicSource: input.publicSource,
      sourceUrl: input.sourceUrl ?? null,
      prestigeScore: scored.score,
      contactEmail: input.contactEmail ?? null,
      inviteDraft: null,
      status: input.status ?? "scored",
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  }
}
