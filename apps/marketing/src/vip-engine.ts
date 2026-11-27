import { RealClock } from "../../../packages/core/src/clock.ts";
import { LeakGuard } from "../../../packages/core/src/guard.ts";
import { requireCityPack } from "./city-registry.ts";
import { marketingLeakAllowlist } from "./constants.ts";
import type { DesireLaneId } from "./desire-lanes.ts";
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
    matchKeywords: ["architect", "industrial designer", "aia", "pritzker", "design studio"],
  },
  {
    num: 12,
    slug: "oss_maintainer",
    title: "Open-Source Maintainers & Principal Engineers",
    desireLane: "money_work",
    primaryFreeSources: ["GitHub REST/GraphQL", "HN Algolia"],
    tableRoleLabel: "a systems maintainer",
    preferredNight: "Thu",
    angleTag: "zero_recruiting_craft_table",
    matchKeywords: ["open source", "maintainer", "principal engineer", "github", "committer", "rust", "postgres"],
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
    matchKeywords: ["fellow", "policy", "diplomat", "senate", "think tank", "commissioner", "consulate"],
  },
  {
    num: 14,
    slug: "podcaster_curator",
    title: "Top Podcasters, Creators & Cultural Curators",
    desireLane: "creative_collab",
    primaryFreeSources: ["Podcast RSS", "YouTube RSS", "Luma Discovery"],
    tableRoleLabel: "a cultural curator",
    preferredNight: "Thu",
    angleTag: "under_exposed_minds_table",
    matchKeywords: ["podcast", "curator", "super-host", "host", "programmer", "radio"],
  },
  {
    num: 15,
    slug: "leading_physician",
    title: "Leading Physicians, Surgeons & Longevity Leaders",
    desireLane: "mentorship_mastery",
    primaryFreeSources: ["ClinicalTrials.gov v2", "NPPES NPI API", "PubMed E-utilities"],
    tableRoleLabel: "a clinical trial surgeon",
    preferredNight: "Thu",
    angleTag: "outside_hospital_bubble_table",
    matchKeywords: ["surgeon", "physician", "md", "clinical trial", "longevity", "oncology", "langone", "sinai"],
  },
  {
    num: 16,
    slug: "philanthropist_foundation",
    title: "Philanthropists, Museum Directors & Major Nonprofit Heads",
    desireLane: "investors_patrons",
    primaryFreeSources: ["ProPublica Nonprofit Explorer 990", "IRS EO BMF"],
    tableRoleLabel: "a museum curator",
    preferredNight: "Thu",
    angleTag: "anti_gala_serendipity_table",
    matchKeywords: ["foundation", "museum", "nonprofit", "990", "philanthropist", "endowment", "501(c)(3)"],
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
    matchKeywords: ["partner", "litigator", "appellate", "prosecutor", "sdny", "general counsel", "courtlistener"],
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
    matchKeywords: ["aerospace", "fusion", "sbir", "darpa", "orbital", "energy", "satellite", "defense"],
  },
] as const;

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
  readonly desireLane: DesireLaneId;
  readonly breakdown: {
    readonly sourceAuthority: number;
    readonly impact: number;
    readonly recency: number;
    readonly locality: number;
    readonly hookSpecificity: number;
  };
}

export interface VipInviteDraftInput {
  readonly firstName: string;
  readonly archetypeSlug: string;
  readonly city: string;
  readonly neighborhood?: string;
  readonly proofOfWork1Line: string;
  readonly senderName: string;
  readonly dateLabel?: string;
  readonly desireLane?: DesireLaneId;
  readonly confirmedCoSeatedRoles?: readonly string[];
}

export interface VipInviteValidationResult {
  readonly valid: boolean;
  readonly subject: string;
  readonly body: string;
  readonly wordCount: number;
  readonly archetype: VipArchetypeSpec;
  readonly desireLane: DesireLaneId;
  readonly coSeatedRoles: readonly string[];
  readonly errors: readonly string[];
  readonly leakReasons: readonly string[];
}

export const MAX_VIP_INVITE_WORDS = 75;

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

export function getVipArchetype(slugOrNum: string | number): VipArchetypeSpec {
  const fallback = VIP_ARCHETYPES[0];
  if (typeof slugOrNum === "number") {
    return VIP_ARCHETYPES.find((a) => a.num === slugOrNum) ?? fallback;
  }
  const normalized = slugOrNum.trim().toLowerCase();
  return (
    VIP_ARCHETYPES.find((a) => a.slug === normalized || a.title.toLowerCase() === normalized) ??
    fallback
  );
}

export function classifyVipArchetype(text: string): VipArchetypeSpec {
  const lower = text.toLowerCase();
  let best = VIP_ARCHETYPES[0];
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

export function scoreVipProspect(signals: VipPrestigeSignals): VipPrestigeScoreResult {
  const archetype = signals.archetypeSlug
    ? getVipArchetype(signals.archetypeSlug)
    : classifyVipArchetype(`${signals.bioOrSummary ?? ""} ${signals.proofOfWorkHook ?? ""}`);

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

function selectComplementaryTableRoles(archetype: VipArchetypeSpec): string[] {
  const preferredOffsets = [3, 6, 9, 11, 16];
  const roles: string[] = [];
  for (const offset of preferredOffsets) {
    const candidate = VIP_ARCHETYPES[(archetype.num - 1 + offset) % VIP_ARCHETYPES.length];
    if (candidate && candidate.slug !== archetype.slug && !roles.includes(candidate.tableRoleLabel)) {
      roles.push(candidate.tableRoleLabel);
    }
    if (roles.length === 4) break;
  }
  return roles;
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
    const firstName = input.firstName.trim() || "there";
    const neighborhood =
      input.neighborhood?.trim() || cityPack.corridors[0]?.neighborhood || cityPack.label;
    const hook = input.proofOfWork1Line.trim().replace(/\.+$/, "");
    const confirmedRoles = (input.confirmedCoSeatedRoles ?? [])
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
    const coSeatedRoles =
      confirmedRoles.length > 0 ? confirmedRoles : selectComplementaryTableRoles(archetype);
    const night = input.dateLabel?.trim() || `next ${archetype.preferredNight}`;
    const confirmedSeatClause =
      confirmedRoles.length > 0 ? ` with ${confirmedRoles.join(", ")}` : "";

    let subject: string;
    let body: string;

    if (archetype.slug === "michelin_chef_hospitality") {
      subject = `Monday dinner in ${neighborhood}`;
      body = [
        `Hi Chef ${firstName},`,
        `Still thinking about ${hook}.`,
        `Hosting a quiet 6-seat off-duty dinner ${night} in ${neighborhood}${confirmedSeatClause} — people from outside hospitality, no press, no shop talk.`,
        `Happy to save a seat if Mondays are open, and completely understand if they are sacred rest nights.`,
        `— ${input.senderName}, The Network`,
      ].join("\n\n");
    } else if (archetype.slug === "oss_maintainer") {
      subject = `Quick note on your work (not recruiting)`;
      body = [
        `Hi ${firstName},`,
        `Upfront: not recruiting, not selling tools. Read ${hook} and appreciated how clearly you laid out the design.`,
        `I host small 6-seat craft dinners in ${neighborhood} (${night})${confirmedSeatClause}. Pure off-the-record conversation.`,
        `Want me to hold a seat? Zero pressure if the week is full.`,
        `— ${input.senderName}, The Network`,
      ].join("\n\n");
    } else if (archetype.slug === "startup_founder") {
      subject = `${neighborhood} founder dinner ${night} (no VCs)`;
      body = [
        `Hi ${firstName},`,
        `Read ${hook} and wanted to reach out directly.`,
        `Hosting a 6-seat off-the-record dinner ${night} in ${neighborhood}${confirmedSeatClause} for founders and builders in ${cityPack.label}. Strictly no pitching and no investors.`,
        `Happy to hold a seat if you are in town — zero pressure.`,
        `— ${input.senderName}, The Network`,
      ].join("\n\n");
    } else {
      subject = `${neighborhood} 6-seat dinner ${night}`;
      body = [
        `Hi ${firstName},`,
        `Read ${hook} and thought you would enjoy the conversation at our next ${cityPack.label} table.`,
        `Six curious people off-the-record ${night} in ${neighborhood}${confirmedSeatClause}. No panels, no pitching.`,
        `Happy to save you a seat if timing works — totally fine to pass.`,
        `— ${input.senderName}, The Network`,
      ].join("\n\n");
    }

    const baseResult = this.validateVipInvite(subject, body, archetype, coSeatedRoles, desireLane);
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

    return {
      valid: errors.length === 0,
      subject,
      body,
      wordCount,
      archetype,
      desireLane,
      coSeatedRoles,
      errors,
      leakReasons,
    };
  }

  buildVipFollowUp(
    firstName: string,
    touch: 2 | 3,
    topicLabel: string,
    senderName: string,
  ): { readonly touch: 2 | 3; readonly body: string; readonly wordCount: number } {
    const name = firstName.trim() || "there";
    const body =
      touch === 2
        ? `Hi ${name} — quick follow-up in case last week was packed. Still happy to save you a seat at the ${topicLabel} dinner if you are free. — ${senderName}`
        : `Hi ${name} — assuming timing is off this round. Happy to keep you on the quiet list for next month's ${topicLabel} dinner if useful. — ${senderName}`;
    return {
      touch,
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
    const scored = scoreVipProspect(input.signals);
    const cityPack = requireCityPack(input.city);
    return {
      id: input.id,
      campaignId: input.campaignId,
      city: cityPack.code,
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
