import { Rng, hash32 } from "@thenetwork/core";
import type { Archetype } from "./persona.ts";
import type { WritingStyle } from "./taxonomy.ts";

export type MarketingPlatform =
  | "x"
  | "instagram"
  | "tiktok"
  | "reddit"
  | "linkedin"
  | "discord"
  | "email"
  | "sms"
  | "ads"
  | "street";

export type ProspectRole =
  | "vip"
  | "bd_venue"
  | "social_user"
  | "email_lead"
  | "applicant"
  | "creator"
  | "ad_viewer";

export type ProspectSentiment =
  | "warm"
  | "curious"
  | "skeptical"
  | "negotiating"
  | "referral"
  | "decline"
  | "stop"
  | "hostile"
  | "tag_friend"
  | "underage"
  | "sybil";

export type MarketingDesireLane =
  | "love_dating"
  | "friends_belonging"
  | "career_money"
  | "status_scenes"
  | "builders_founders"
  | "creative_cultural"
  | "fitness_sports"
  | "local_hosts"
  | "campus_early_career"
  | "diaspora_newcomers";

export type VipSubtype =
  | "startup_founder"
  | "michelin_chef"
  | "ai_biotech_researcher"
  | "creative_director"
  | "community_host";

export type MarketingBrandPersona = "chadwick" | "sloane" | "peon" | "venn" | "operator";

export interface MarketingTemplateRequest {
  platform: MarketingPlatform;
  role: ProspectRole;
  sentiment: ProspectSentiment;
  desireLane?: MarketingDesireLane;
  city?: string;
  archetype?: Archetype;
  vipSubtype?: VipSubtype;
  venueName?: string;
  brandName?: string;
  handle?: string;
  style?: WritingStyle;
  seedKey: string;
}

export interface MarketingTemplateResponse {
  text: string;
  intent: ProspectSentiment;
  stopKeyword: boolean;
  underageSignal: boolean;
  sybilSignal: boolean;
  referredHandle?: string;
  metadata: Record<string, string | number | boolean>;
}

const CITY_DISPLAY: Record<string, string> = {
  nyc: "NYC",
  sf: "SF",
  la: "LA",
  chicago: "Chicago",
  miami: "Miami",
  austin: "Austin",
};

const LANE_LABEL: Record<MarketingDesireLane, string> = {
  love_dating: "real dates without swiping",
  friends_belonging: "making close friends",
  career_money: "high-signal career intros",
  status_scenes: "curated dinners",
  builders_founders: "meeting other builders",
  creative_cultural: "creative salons and gallery nights",
  fitness_sports: "run clubs and climbing crews",
  local_hosts: "hosting small neighborhood tables",
  campus_early_career: "early-career peer circles",
  diaspora_newcomers: "newcomer circles in the city",
};

const VIP_TEMPLATES: Record<VipSubtype, Partial<Record<ProspectSentiment, readonly string[]>>> = {
  startup_founder: {
    warm: [
      "Intriguing thesis. Put me down for the next {city} founder table—I am in for {lane}.",
      "Actually hate cold networking events, so a curated 6-person dinner in {city} sounds refreshing. Send the link.",
      "Count me in for {brand}. If the vetting holds up in {city}, I will bring two fellow founders.",
    ],
    curious: [
      "How are you curating the {city} cohort so it does not turn into a pitch fest?",
      "Interesting timing—just moved our team to {city}. Who else is in the {lane} circle?",
      "Is this invite-only or open signup? Curious how {brand} handles privacy.",
    ],
    skeptical: [
      "We get five curated community invites a week in {city}. What makes {brand} different from every other Slack group?",
      "Sounds slick, though I am skeptical of AI matchmakers. Show me one real {city} dinner that worked.",
      "Honestly do not have spare evenings unless the room is genuinely high signal.",
    ],
    referral: [
      "Slammed with our Series A sprint this month, but loop in {refHandle}—they are actively building in {city}.",
      "Not my season right now, though my cofounder {refHandle} is looking for {lane} in {city}.",
    ],
    decline: [
      "Appreciate the note, passing for now while we ship our launch.",
      "Thanks for reaching out—my calendar in {city} is locked through next quarter.",
    ],
    stop: [
      "STOP — please remove me from future outreach.",
      "Unsubscribe me from this list, thanks.",
    ],
  },
  michelin_chef: {
    warm: [
      "Love the idea of off-night hospitality tables in {city}. I have Mondays open if you want to test a supper.",
      "Always looking to meet curious people outside the kitchen in {city}. Send me the invite.",
    ],
    curious: [
      "Are these small seated dinners or casual drinks? Timing matters with service hours in {city}.",
      "How does {brand} keep guests from posting private table chatter online?",
    ],
    skeptical: [
      "Most foodie clubs in {city} are just influencer photo ops. Hard pass if it feels staged.",
      "I guard my nights off carefully—convince me this is not another PR mixer.",
    ],
    referral: [
      "My sous chef {refHandle} just relocated to {city} and would love {lane}. Reach out to them.",
    ],
    decline: [
      "Opening a new menu this month so I have zero bandwidth. Maybe later in the year.",
    ],
    stop: [
      "Please take me off your outreach list. STOP.",
    ],
  },
  ai_biotech_researcher: {
    warm: [
      "Would gladly join a small {city} salon on {lane}. Appreciate the concise note.",
      "Sign me up—finding rigorous peers outside my lab in {city} has been surprisingly hard.",
    ],
    curious: [
      "What privacy guarantees does {brand} give on profile data? Need to know before trying it.",
      "Are there other ML or wet-lab folks in the {city} cohort right now?",
    ],
    skeptical: [
      "Skeptical of matching algorithms without transparent evaluation. How do you measure real outcomes?",
      "Feels a bit promotional. Happy to read a technical overview before committing.",
    ],
    referral: [
      "I am traveling for NeurIPS, but my labmate {refHandle} in {city} is looking for {lane}.",
    ],
    decline: [
      "Grant deadline week—passing on new groups right now.",
    ],
    stop: [
      "Unsubscribe. Please do not contact this address again.",
    ],
  },
  creative_director: {
    warm: [
      "The aesthetic on {brand} is sharp. Would love a spot at the next {city} creative gathering.",
      "Definitely curious—{city} needs better offline rooms for {lane}.",
    ],
    curious: [
      "Who designs the gatherings in {city}? Looking for real conversation, not business cards.",
    ],
    skeptical: [
      "Seen too many members clubs lose their soul after month two. Keeping an eye on it first.",
    ],
    referral: [
      "Forwarding to {refHandle}—they run a studio in {city} and curate great people.",
    ],
    decline: [
      "Booked solid on shoots all month, appreciate the invite though.",
    ],
    stop: [
      "STOP please remove me.",
    ],
  },
  community_host: {
    warm: [
      "I already host monthly potlucks in {city}—would love to bring {brand} into the mix.",
      "This aligns right with what I build for {lane} in {city}. Let us connect.",
    ],
    curious: [
      "How do hosts collaborate with {brand} without losing their neighborhood vibe?",
    ],
    skeptical: [
      "Careful about letting platforms touch my guest list. Tell me how consent works first.",
    ],
    referral: [
      "Talk to {refHandle}, they run the best Sunday supper club in {city}.",
    ],
    decline: [
      "My roster is full for this season, thanks for thinking of me.",
    ],
    stop: [
      "Unsubscribe me from further emails.",
    ],
  },
};

const BD_VENUE_TEMPLATES: Partial<Record<ProspectSentiment, readonly string[]>> = {
  warm: [
    "We love hosting small groups at {venue} on Tuesday and Wednesday nights. Happy to put QR coasters on 20 tables.",
    "{venue} has a quiet back room that fits 6 to 12 people well. Let us run a 30-day tabletop card pilot in {city}.",
    "Count {venue} in—we want steady weeknight foot traffic from {brand} groups in {city}.",
  ],
  negotiating: [
    "Interested for {venue}, but our GM needs a quick phone callback to verify the tabletop stand terms and table count.",
    "Can we start with 15 coasters near the espresso bar at {venue} and review check-in volume after two weeks?",
    "We do not pay upfront for placements, though we can offer a 10% group tab perk at {venue} if you verify bookings.",
  ],
  curious: [
    "How many verified adult guests per week does {brand} actually send to partner spots in {city}?",
    "Are these quiet conversation groups or loud parties? {venue} keeps an all-ages daytime cafe vibe.",
  ],
  decline: [
    "Thanks for reaching out—{venue} keeps tables minimal and does not display third-party QR cards.",
    "Our ownership group is not taking new local partnerships in {city} this quarter.",
  ],
  stop: [
    "Please remove {venue} from your vendor outreach list. STOP.",
  ],
};

const SOCIAL_PLATFORM_TEMPLATES: Record<
  Exclude<MarketingPlatform, "email" | "sms" | "ads" | "street">,
  Partial<Record<ProspectSentiment, readonly string[]>>
> = {
  x: {
    curious: [
      "wait is {brand} actually live in {city} right now or still waitlist?",
      "ok this is the first {lane} pitch on my timeline that doesnt sound cringe—how does vetting work?",
      "anyone in {city} tried {brand} yet? tired of flaking on meetup apps",
    ],
    skeptical: [
      "sounds like an ad lol, prove it has real people in {city}",
      "another AI social app? wake me up when people actually show up irl",
      "cool copy but how do you stop spammers and bots?",
    ],
    warm: [
      "just signed up in {city}, honestly love the no-feed sms angle",
      "clicked through—if this actually gets me {lane} without endless texting im sold",
      "lowkey exactly what {city} needs rn, joining now",
    ],
    tag_friend: [
      "yo {refHandle} we literally talked about needing this in {city} last night",
      "{refHandle} sign up with me for {lane} in {city}",
    ],
    hostile: [
      "muted, stop flooding {city} search with promo threads",
      "reporting this as spam, nobody asked for cold replies",
    ],
    decline: [
      "cool idea just not my thing rn",
    ],
    stop: [
      "STOP do not dm me again",
    ],
  },
  instagram: {
    curious: [
      "Wait is this real in {city}?? Drop the link!",
      "How does {brand} pick the spots in {city}? Need this for {lane}",
    ],
    skeptical: [
      "Looks aesthetic ngl but is it actually active in {city} or just promo?",
      "Hmm feels like a paid promo, anyone actually gone to one?",
    ],
    warm: [
      "Just signed up!! So ready for {lane} in {city}",
      "Obsessed with this concept, tapped the link in bio",
    ],
    tag_friend: [
      "{refHandle} omg we need to try this in {city} this weekend",
      "Tagging {refHandle} because we keep saying we need {lane}",
    ],
    hostile: [
      "Stop commenting promo under {city} reels, instant block",
    ],
    decline: [
      "Cute idea but I am taking a break from new apps",
    ],
    stop: [
      "STOP please do not message this account",
    ],
  },
  tiktok: {
    curious: [
      "wait is this actually in {city}?? someone tell me if it works",
      "ok wait no swiping for {lane}? link??",
    ],
    skeptical: [
      "pov another app ad on my fyp lol",
      "be honest is {city} actually active or is it 12 people",
    ],
    warm: [
      "just joined from this vid!! {city} lets go",
      "ok this convinced me, signing up for {brand} rn",
    ],
    tag_friend: [
      "{refHandle} bestie look at this {city} thing",
      "{refHandle} we are literally doing this next week",
    ],
    hostile: [
      "scrolling past, feels like an undisclosed ad",
    ],
    decline: [
      "looks fun just not in {city} yet",
    ],
    stop: [
      "STOP leave me alone",
    ],
  },
  reddit: {
    curious: [
      "Actually curious how {brand} avoids the usual {city} meetup flake problem. Do both sides have to confirm first?",
      "Does this require installing an app or is it really just text? Looking for {lane} in {city}.",
    ],
    skeptical: [
      "Feels like astroturfing. Can you disclose if you are affiliated with {brand} and explain your privacy policy?",
      "Every six months someone posts a new {city} friend app here and it dies in three weeks. What is different?",
    ],
    warm: [
      "Tried {brand} in {city} last week—small group actually showed up on time, pleasantly surprised.",
      "Fair enough, the consent-first model makes sense. Checking out the signup page now.",
    ],
    tag_friend: [
      "Sending this thread to {refHandle}, they just moved to {city} and asked about {lane}.",
    ],
    hostile: [
      "Mods please remove, blatant self-promo violating sub rules.",
    ],
    decline: [
      "Interesting approach, though I prefer sticking to my local climbing gym.",
    ],
    stop: [
      "Do not DM me on Reddit again. STOP.",
    ],
  },
  linkedin: {
    curious: [
      "Interesting model for {lane} in {city}. How are introductions vetted for mutual fit?",
      "Would be curious to learn more about how {brand} curates local professional circles.",
    ],
    skeptical: [
      "I receive many networking pitches—how do you ensure outreach stays high signal and spam-free?",
    ],
    warm: [
      "Just signed up for the {city} launch. Much prefer curated 1:1 intros over large mixers.",
      "Thoughtful positioning on {brand}. Happy to test it in {city}.",
    ],
    tag_friend: [
      "Looping in {refHandle} who leads community partnerships in {city}.",
    ],
    hostile: [
      "Please stop sending unsolicited promotional messages on LinkedIn.",
    ],
    decline: [
      "Thanks for connecting—passing for now.",
    ],
    stop: [
      "Please opt me out of further messages. STOP.",
    ],
  },
  discord: {
    curious: [
      "yo is {brand} doing {lane} meetups in {city} this week?",
      "how does the sms matching work, does it leak your number?",
    ],
    skeptical: [
      "lowkey smells like a bot invite, is this legit?",
    ],
    warm: [
      "signed up just now, hyped to meet some {city} folks irl",
      "ngl consent-first intros sound way better than random server meetups",
    ],
    tag_friend: [
      "pinging {refHandle} come try this {city} thing with me",
    ],
    hostile: [
      "mods can we ban promo links in general?",
    ],
    decline: [
      "nah im good, mostly sticking to online hangs",
    ],
    stop: [
      "STOP dont dm me",
    ],
  },
};

const EMAIL_LEAD_TEMPLATES: Partial<Record<ProspectSentiment, readonly string[]>> = {
  warm: [
    "Thanks for the note—just signed up for {brand} in {city}. Looking forward to {lane}.",
    "This landed at a good time. I clicked through and joined the {city} roster.",
  ],
  curious: [
    "Quick question before I sign up: is {brand} free to join in {city}, and how often does it text?",
    "Looks interesting—how do you verify members in {city}?",
  ],
  skeptical: [
    "How did you get my email, and how do I know my private notes will not be shared with strangers?",
  ],
  referral: [
    "Not looking right now, but my friend {refHandle} just moved to {city} and wants {lane}.",
  ],
  decline: [
    "Thanks, not interested at the moment.",
  ],
  stop: [
    "Unsubscribe me immediately. STOP.",
  ],
};

const APPLICANT_TEMPLATES: Partial<Record<ProspectSentiment, readonly string[]>> = {
  warm: [
    "Hi! I am 24, based in {city} near transit, have 2 years of local street-team and event promo experience. Portfolio: portfolio.example/local-crew. Available Friday through Sunday.",
    "Applying for the {city} creator and activation gig. I am 26, shoot short-form neighborhood reels, and can verify ID and live shift check-ins.",
  ],
  curious: [
    "I am 22 in {city} and interested in weekend QR flyer shifts. What is the hourly payout and check-in process?",
  ],
  underage: [
    "Hey I am 16 and a sophomore in high school in {city}, can I hand out flyers after school for cash?",
    "Just turned 15 in {city} and make TikToks all the time—can I join the paid creator team?",
    "I am 17 turning 18 next summer, can my friend and I do the {city} street team shift?",
  ],
  sybil: [
    "Submitting shift proof batch #4 with 5 accounts from the same corner in {city} (duplicate photo hash reuse).",
    "Ready to claim 8 referral bounties right now from my VoIP burner numbers in {city}.",
  ],
  decline: [
    "Schedule changed in {city}, withdrawing my application.",
  ],
  stop: [
    "STOP please remove my applicant contact info.",
  ],
};

const FALLBACK_TEMPLATES: Record<ProspectSentiment, readonly string[]> = {
  warm: ["Sounds great, signing up for {brand} in {city}."],
  curious: ["Tell me more about how {brand} works in {city}."],
  skeptical: ["Not sure yet—how do you keep {brand} high quality in {city}?"],
  negotiating: ["Open to talking details if we can verify terms for {city}."],
  referral: ["Passing this along to {refHandle} in {city}."],
  decline: ["Not for me right now, thanks."],
  stop: ["STOP — unsubscribe me immediately."],
  hostile: ["Not interested, please stop posting promos."],
  tag_friend: ["Hey {refHandle}, check out {brand} in {city}!"],
  underage: ["I am 16 in high school in {city}, can I join the paid promo crew?"],
  sybil: ["Claiming multiple instant payouts with recycled proof media."],
};

const BRAND_COPY: Record<MarketingBrandPersona, readonly string[]> = {
  chadwick: [
    "Curated small-group intros in {city} for {lane}. Consent-first, zero endless feeds: {link}",
    "Meet real people in {city} who actually show up for {lane}. Join at {link}",
  ],
  sloane: [
    "Skip the swipe fatigue in {city}. Thoughtful 1:1 introductions built around real compatibility: {link}",
    "A quieter way to meet someone worth your evening in {city}: {link}",
  ],
  peon: [
    "Warm, vetted career and founder introductions in {city} without cold spam. Explore {link}",
    "High-signal intros for builders and operators in {city}: {link}",
  ],
  venn: [
    "Small neighborhood tables and all-ages activity crews in {city} for {lane}. See upcoming plans: {link}",
    "Make real local friends in {city} over low-pressure small-group hangs: {link}",
  ],
  operator: [
    "Partner with us in {city} to bring steady weeknight small groups to your space. Details: {link}",
    "Local {city} activation open for vetted hosts and venues: {link}",
  ],
};

function renderTokens(
  template: string,
  values: { city: string; lane: string; venue: string; brand: string; refHandle: string; link: string },
): string {
  return template
    .replaceAll("{city}", values.city)
    .replaceAll("{lane}", values.lane)
    .replaceAll("{venue}", values.venue)
    .replaceAll("{brand}", values.brand)
    .replaceAll("{refHandle}", values.refHandle)
    .replaceAll("{link}", values.link);
}

function applyStyle(text: string, style: WritingStyle | undefined): string {
  if (!style) return text;
  if (style === "terse") {
    const first = text.split(/(?<=[.!?])\s+/)[0] ?? text;
    return first.length <= 90 ? first : `${first.slice(0, 87).trimEnd()}...`;
  }
  if (style === "lowercase-casual") return text.toLowerCase();
  return text;
}

export function renderMarketingTemplate(
  req: MarketingTemplateRequest,
  rng?: Rng,
): MarketingTemplateResponse {
  const stream = rng ?? new Rng(hash32("mkt-tpl", req.platform, req.role, req.sentiment, req.seedKey));
  const city = CITY_DISPLAY[req.city?.toLowerCase() ?? "nyc"] ?? req.city ?? "NYC";
  const lane = LANE_LABEL[req.desireLane ?? "friends_belonging"];
  const venue = req.venueName ?? "Neighborhood Roasters";
  const brand = req.brandName ?? "The Network";
  const refSuffix = stream.int(100, 999);
  const refHandle = req.handle ? `@${req.handle.replace(/^@/, "")}_pal` : `@friend_${refSuffix}`;

  let pool: readonly string[] | undefined;
  if (req.role === "vip") {
    const subtype = req.vipSubtype ?? "startup_founder";
    pool = VIP_TEMPLATES[subtype][req.sentiment];
  } else if (req.role === "bd_venue") {
    pool = BD_VENUE_TEMPLATES[req.sentiment];
  } else if (req.role === "applicant" || req.role === "creator") {
    pool = APPLICANT_TEMPLATES[req.sentiment];
  } else if (req.platform === "email" || req.role === "email_lead") {
    pool = EMAIL_LEAD_TEMPLATES[req.sentiment];
  } else if (
    req.platform === "x" ||
    req.platform === "instagram" ||
    req.platform === "tiktok" ||
    req.platform === "reddit" ||
    req.platform === "linkedin" ||
    req.platform === "discord"
  ) {
    pool = SOCIAL_PLATFORM_TEMPLATES[req.platform][req.sentiment];
  }

  const chosenPool = pool && pool.length > 0 ? pool : FALLBACK_TEMPLATES[req.sentiment];
  const raw = stream.pick(chosenPool);
  const rendered = renderTokens(raw, {
    city,
    lane,
    venue,
    brand,
    refHandle,
    link: "https://ntwrk.party",
  });
  const text =
    req.sentiment === "stop" || req.sentiment === "underage" || req.sentiment === "sybil"
      ? rendered
      : applyStyle(rendered, req.style);

  return {
    text,
    intent: req.sentiment,
    stopKeyword: req.sentiment === "stop" || /\b(stop|unsubscribe)\b/i.test(text),
    underageSignal: req.sentiment === "underage",
    sybilSignal: req.sentiment === "sybil",
    ...(req.sentiment === "referral" || req.sentiment === "tag_friend" ? { referredHandle: refHandle } : {}),
    metadata: {
      platform: req.platform,
      role: req.role,
      city,
      desireLane: req.desireLane ?? "friends_belonging",
      ...(req.vipSubtype ? { vipSubtype: req.vipSubtype } : {}),
      ...(req.archetype ? { archetype: req.archetype } : {}),
    },
  };
}

export function renderBrandOutreachTemplate(params: {
  persona: MarketingBrandPersona;
  city: string;
  desireLane: MarketingDesireLane;
  linkUrl: string;
  seedKey: string;
}): string {
  const stream = new Rng(hash32("brand-copy", params.persona, params.city, params.desireLane, params.seedKey));
  const city = CITY_DISPLAY[params.city.toLowerCase()] ?? params.city;
  const lane = LANE_LABEL[params.desireLane];
  const tpl = stream.pick(BRAND_COPY[params.persona]);
  return renderTokens(tpl, {
    city,
    lane,
    venue: "",
    brand: params.persona,
    refHandle: "",
    link: params.linkUrl,
  });
}
