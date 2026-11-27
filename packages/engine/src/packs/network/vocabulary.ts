import type { Category, City } from "@thenetwork/core";

export type SpendComfortTier = "free" | "low" | "moderate" | "high" | "unconstrained";

export const SPEND_COMFORT_TIERS: readonly SpendComfortTier[] = [
  "free",
  "low",
  "moderate",
  "high",
  "unconstrained",
] as const;

export type ConnectionOntologyType =
  | "dating"
  | "friendship"
  | "work_hiring"
  | "step_ahead_mentorship"
  | "creative_cocreation"
  | "patronage_sponsorship"
  | "intellectual_salon"
  | "habit_accountability"
  | "event_travel_companion"
  | "local_mutual_aid"
  | "parent_support_adult"
  | "coliving_roommate"
  | "life_transition_peer"
  | "craft_maker_guild"
  | "executive_peer_council"
  | "civic_action_coalition"
  | "language_tandem";

export const CONNECTION_ONTOLOGY_TYPES: readonly ConnectionOntologyType[] = [
  "dating",
  "friendship",
  "work_hiring",
  "step_ahead_mentorship",
  "creative_cocreation",
  "patronage_sponsorship",
  "intellectual_salon",
  "habit_accountability",
  "event_travel_companion",
  "local_mutual_aid",
  "parent_support_adult",
  "coliving_roommate",
  "life_transition_peer",
  "craft_maker_guild",
  "executive_peer_council",
  "civic_action_coalition",
  "language_tandem",
] as const;

export interface ConnectionOntologySpec {
  readonly id: ConnectionOntologyType;
  readonly label: string;
  readonly defaultCategory: Category;
  readonly defaultFormat: "one_to_one" | "small_group" | "event";
  readonly sizeRange: readonly [number, number];
  readonly targetRungDelta: readonly [number, number];
  readonly chettyMixedSesContainer: boolean;
  readonly defaultFreeAnchor: boolean;
  readonly requiresHighDiscretion: boolean;
  readonly adultOnly: true;
}

export const CONNECTION_ONTOLOGY_SPECS: Readonly<Record<ConnectionOntologyType, ConnectionOntologySpec>> = {
  dating: {
    id: "dating", label: "dating and romance", defaultCategory: "romance", defaultFormat: "one_to_one",
    sizeRange: [2, 2], targetRungDelta: [-1, 1], chettyMixedSesContainer: false, defaultFreeAnchor: false,
    requiresHighDiscretion: false, adultOnly: true,
  },
  friendship: {
    id: "friendship", label: "recurring friendship", defaultCategory: "social", defaultFormat: "small_group",
    sizeRange: [2, 6], targetRungDelta: [-1.5, 1.5], chettyMixedSesContainer: false, defaultFreeAnchor: false,
    requiresHighDiscretion: false, adultOnly: true,
  },
  work_hiring: {
    id: "work_hiring", label: "work, hiring and co-founding", defaultCategory: "professional", defaultFormat: "one_to_one",
    sizeRange: [2, 2], targetRungDelta: [-1, 1.5], chettyMixedSesContainer: false, defaultFreeAnchor: true,
    requiresHighDiscretion: false, adultOnly: true,
  },
  step_ahead_mentorship: {
    id: "step_ahead_mentorship", label: "1-2 rung step-ahead mentorship", defaultCategory: "professional", defaultFormat: "one_to_one",
    sizeRange: [2, 4], targetRungDelta: [1, 2.5], chettyMixedSesContainer: false, defaultFreeAnchor: true,
    requiresHighDiscretion: false, adultOnly: true,
  },
  creative_cocreation: {
    id: "creative_cocreation", label: "creative and technical co-creation", defaultCategory: "hobby", defaultFormat: "small_group",
    sizeRange: [2, 5], targetRungDelta: [-1.5, 1.5], chettyMixedSesContainer: true, defaultFreeAnchor: true,
    requiresHighDiscretion: false, adultOnly: true,
  },
  patronage_sponsorship: {
    id: "patronage_sponsorship", label: "patronage, angel and research sponsorship", defaultCategory: "professional", defaultFormat: "one_to_one",
    sizeRange: [2, 3], targetRungDelta: [0, 3], chettyMixedSesContainer: false, defaultFreeAnchor: true,
    requiresHighDiscretion: true, adultOnly: true,
  },
  intellectual_salon: {
    id: "intellectual_salon", label: "intellectual salon and reading circle", defaultCategory: "social", defaultFormat: "small_group",
    sizeRange: [3, 6], targetRungDelta: [-1.5, 1.5], chettyMixedSesContainer: true, defaultFreeAnchor: true,
    requiresHighDiscretion: false, adultOnly: true,
  },
  habit_accountability: {
    id: "habit_accountability", label: "habit, fitness and sobriety accountability", defaultCategory: "hobby", defaultFormat: "one_to_one",
    sizeRange: [2, 4], targetRungDelta: [-1, 1], chettyMixedSesContainer: true, defaultFreeAnchor: true,
    requiresHighDiscretion: false, adultOnly: true,
  },
  event_travel_companion: {
    id: "event_travel_companion", label: "event, concert and travel companion", defaultCategory: "events", defaultFormat: "event",
    sizeRange: [2, 4], targetRungDelta: [-1.5, 1.5], chettyMixedSesContainer: false, defaultFreeAnchor: false,
    requiresHighDiscretion: false, adultOnly: true,
  },
  local_mutual_aid: {
    id: "local_mutual_aid", label: "local mutual aid and practical skill swap", defaultCategory: "help", defaultFormat: "one_to_one",
    sizeRange: [2, 4], targetRungDelta: [-2, 2], chettyMixedSesContainer: true, defaultFreeAnchor: true,
    requiresHighDiscretion: false, adultOnly: true,
  },
  parent_support_adult: {
    id: "parent_support_adult", label: "adult-to-adult parent peer support", defaultCategory: "social", defaultFormat: "small_group",
    sizeRange: [2, 6], targetRungDelta: [-2, 2], chettyMixedSesContainer: true, defaultFreeAnchor: true,
    requiresHighDiscretion: false, adultOnly: true,
  },
  coliving_roommate: {
    id: "coliving_roommate", label: "co-living, roommate and shared studio", defaultCategory: "social", defaultFormat: "one_to_one",
    sizeRange: [2, 4], targetRungDelta: [-1, 1], chettyMixedSesContainer: false, defaultFreeAnchor: true,
    requiresHighDiscretion: false, adultOnly: true,
  },
  life_transition_peer: {
    id: "life_transition_peer", label: "life transition peer circle", defaultCategory: "social", defaultFormat: "small_group",
    sizeRange: [2, 5], targetRungDelta: [-1.5, 1.5], chettyMixedSesContainer: true, defaultFreeAnchor: true,
    requiresHighDiscretion: true, adultOnly: true,
  },
  craft_maker_guild: {
    id: "craft_maker_guild", label: "craft, maker and trade guild", defaultCategory: "hobby", defaultFormat: "small_group",
    sizeRange: [2, 6], targetRungDelta: [-2, 2], chettyMixedSesContainer: true, defaultFreeAnchor: true,
    requiresHighDiscretion: false, adultOnly: true,
  },
  executive_peer_council: {
    id: "executive_peer_council", label: "executive and post-exit peer council", defaultCategory: "professional", defaultFormat: "small_group",
    sizeRange: [3, 6], targetRungDelta: [-0.75, 0.75], chettyMixedSesContainer: false, defaultFreeAnchor: false,
    requiresHighDiscretion: true, adultOnly: true,
  },
  civic_action_coalition: {
    id: "civic_action_coalition", label: "civic action and urbanism coalition", defaultCategory: "social", defaultFormat: "small_group",
    sizeRange: [3, 6], targetRungDelta: [-2.5, 2.5], chettyMixedSesContainer: true, defaultFreeAnchor: true,
    requiresHighDiscretion: false, adultOnly: true,
  },
  language_tandem: {
    id: "language_tandem", label: "reciprocal language tandem exchange", defaultCategory: "hobby", defaultFormat: "one_to_one",
    sizeRange: [2, 2], targetRungDelta: [-2, 2], chettyMixedSesContainer: true, defaultFreeAnchor: true,
    requiresHighDiscretion: false, adultOnly: true,
  },
};

export type LifeStage =
  | "student"
  | "early_career"
  | "established_single"
  | "partnered_no_kids"
  | "young_family"
  | "established_family"
  | "empty_nest"
  | "post_exit"
  | "retired";

export const LIFE_STAGES: readonly LifeStage[] = [
  "student",
  "early_career",
  "established_single",
  "partnered_no_kids",
  "young_family",
  "established_family",
  "empty_nest",
  "post_exit",
  "retired",
] as const;

export type HumorRegister =
  | "dry_ironic"
  | "absurdist"
  | "warm_earnest"
  | "nerdy_wordplay"
  | "roast_banter";

export const HUMOR_REGISTERS: readonly HumorRegister[] = [
  "dry_ironic",
  "absurdist",
  "warm_earnest",
  "nerdy_wordplay",
  "roast_banter",
] as const;

export const LIFE_TRANSITIONS: readonly string[] = [
  "relocated_city",
  "post_exit",
  "new_parent",
  "post_divorce",
  "career_pivot",
  "early_sobriety",
  "bereavement",
  "graduating",
  "returning_abroad",
  "starting_company",
] as const;

export const CRAFT_GUILDS: readonly string[] = [
  "woodworking_guild",
  "ceramics_guild",
  "synth_audio_guild",
  "indie_film_guild",
  "robotics_hardware_guild",
  "culinary_fermentation_guild",
  "civic_urbanism_guild",
  "run_endurance_guild",
  "writers_critique_guild",
  "research_salon_guild",
] as const;

export const LANGUAGE_CODES: readonly string[] = [
  "english",
  "spanish",
  "mandarin",
  "french",
  "japanese",
  "korean",
  "portuguese",
  "german",
  "italian",
  "arabic",
  "hindi",
] as const;

export interface ComplementaryRolePair {
  readonly domain: string;
  readonly roleA: string;
  readonly roleB: string;
  readonly connectionType: ConnectionOntologyType;
}

export const COMPLEMENTARY_ROLE_PAIRS: readonly ComplementaryRolePair[] = [
  { domain: "music", roleA: "vocals", roleB: "producer_mixer", connectionType: "creative_cocreation" },
  { domain: "music", roleA: "songwriter", roleB: "audio_engineer", connectionType: "creative_cocreation" },
  { domain: "music", roleA: "guitar", roleB: "drums", connectionType: "creative_cocreation" },
  { domain: "film", roleA: "director_writer", roleB: "cinematographer", connectionType: "creative_cocreation" },
  { domain: "publishing", roleA: "writing", roleB: "illustrator_animator", connectionType: "creative_cocreation" },
  { domain: "startups", roleA: "ml_engineering", roleB: "gtm_operator", connectionType: "work_hiring" },
  { domain: "startups", roleA: "systems_engineer", roleB: "design", connectionType: "work_hiring" },
  { domain: "hardware", roleA: "hardware_eng", roleB: "industrial_designer", connectionType: "creative_cocreation" },
  { domain: "science", roleA: "biotech_scientist", roleB: "angel_patron", connectionType: "patronage_sponsorship" },
  { domain: "science", roleA: "ml_researcher", roleB: "non_dilutive_patron", connectionType: "patronage_sponsorship" },
  { domain: "trades", roleA: "woodworker", roleB: "home_repair_hvac", connectionType: "local_mutual_aid" },
  { domain: "trades", roleA: "bike_mechanic", roleB: "chef", connectionType: "local_mutual_aid" },
  { domain: "language", roleA: "spanish_native", roleB: "english_native", connectionType: "language_tandem" },
  { domain: "language", roleA: "mandarin_native", roleB: "english_native", connectionType: "language_tandem" },
  { domain: "language", roleA: "french_native", roleB: "english_native", connectionType: "language_tandem" },
  { domain: "language", roleA: "japanese_native", roleB: "english_native", connectionType: "language_tandem" },
];

export interface InterestDef { tag: string; label: string; cluster: string }
export const INTERESTS: InterestDef[] = [
  { tag: "climbing", label: "bouldering and climbing", cluster: "outdoors" },
  { tag: "running", label: "running", cluster: "outdoors" },
  { tag: "hiking", label: "hiking", cluster: "outdoors" },
  { tag: "cycling", label: "cycling", cluster: "outdoors" },
  { tag: "sailing", label: "sailing", cluster: "outdoors" },
  { tag: "tennis", label: "tennis", cluster: "sports" },
  { tag: "pickleball", label: "pickleball", cluster: "sports" },
  { tag: "basketball", label: "pickup basketball", cluster: "sports" },
  { tag: "rock_music", label: "rock music", cluster: "music" },
  { tag: "jazz", label: "jazz", cluster: "music" },
  { tag: "electronic_music", label: "electronic music", cluster: "music" },
  { tag: "live_music", label: "going to shows", cluster: "music" },
  { tag: "film", label: "film and cinema", cluster: "arts" },
  { tag: "ceramics", label: "ceramics", cluster: "arts" },
  { tag: "painting", label: "painting", cluster: "arts" },
  { tag: "photography", label: "photography", cluster: "arts" },
  { tag: "theater", label: "theater", cluster: "arts" },
  { tag: "books", label: "reading fiction", cluster: "ideas" },
  { tag: "philosophy", label: "philosophy", cluster: "ideas" },
  { tag: "ai", label: "AI and machine learning", cluster: "tech" },
  { tag: "climate_tech", label: "climate tech", cluster: "tech" },
  { tag: "startups", label: "startups", cluster: "tech" },
  { tag: "crypto", label: "crypto", cluster: "tech" },
  { tag: "hardware", label: "hardware hacking", cluster: "tech" },
  { tag: "cooking", label: "cooking", cluster: "food" },
  { tag: "wine", label: "natural wine", cluster: "food" },
  { tag: "coffee", label: "specialty coffee", cluster: "food" },
  { tag: "board_games", label: "board games", cluster: "play" },
  { tag: "chess", label: "chess", cluster: "play" },
  { tag: "volunteering", label: "volunteering", cluster: "civic" },
  { tag: "urbanism", label: "urbanism and housing", cluster: "civic" },
  { tag: "parenting", label: "parenting", cluster: "family" },
  { tag: "dogs", label: "dogs", cluster: "family" },
  { tag: "meditation", label: "meditation", cluster: "wellness" },
  { tag: "yoga", label: "yoga", cluster: "wellness" },
  { tag: "dancing", label: "dancing", cluster: "arts" },
  { tag: "writing", label: "writing", cluster: "ideas" },
  { tag: "gardening", label: "gardening", cluster: "outdoors" },
];

export const EXTENDED_INTERESTS: readonly InterestDef[] = [
  { tag: "woodworking", label: "woodworking and furniture", cluster: "craft" },
  { tag: "modular_synths", label: "modular synthesizers", cluster: "music" },
  { tag: "indie_games", label: "indie game dev", cluster: "creative" },
  { tag: "biotech", label: "biotech and longevity science", cluster: "science" },
  { tag: "physics_math", label: "physics and mathematics", cluster: "science" },
  { tag: "robotics", label: "robotics and mechatronics", cluster: "tech" },
  { tag: "history_economics", label: "history and political economy", cluster: "ideas" },
  { tag: "fermentation", label: "baking and fermentation", cluster: "food" },
  { tag: "sobriety_wellness", label: "alcohol-free wellness", cluster: "wellness" },
  { tag: "language_exchange", label: "language exchange", cluster: "ideas" },
  { tag: "mutual_aid", label: "neighborhood mutual aid", cluster: "civic" },
  { tag: "backcountry_travel", label: "backcountry and expedition travel", cluster: "outdoors" },
];

export const ALL_INTERESTS: readonly InterestDef[] = [...INTERESTS, ...EXTENDED_INTERESTS];
export const interestClusterByTag: ReadonlyMap<string, string> = new Map(ALL_INTERESTS.map(i => [i.tag, i.cluster]));

export interface SkillDef { tag: string; label: string; teaches?: string }
export const SKILLS: SkillDef[] = [
  { tag: "guitar", label: "plays guitar", teaches: "rock_music" },
  { tag: "drums", label: "plays drums", teaches: "rock_music" },
  { tag: "bass", label: "plays bass", teaches: "rock_music" },
  { tag: "vocals", label: "sings", teaches: "rock_music" },
  { tag: "piano", label: "plays piano", teaches: "jazz" },
  { tag: "sailing_instructor", label: "teaches sailing", teaches: "sailing" },
  { tag: "climbing_belay", label: "experienced climber who likes taking beginners", teaches: "climbing" },
  { tag: "fundraising", label: "has raised venture funding", teaches: "startups" },
  { tag: "ml_engineering", label: "ML engineer", teaches: "ai" },
  { tag: "design", label: "product designer", teaches: "startups" },
  { tag: "pottery_wheel", label: "throws pottery", teaches: "ceramics" },
  { tag: "chef", label: "cooks for groups", teaches: "cooking" },
  { tag: "hosting", label: "loves hosting dinners", teaches: "cooking" },
  { tag: "moving_help", label: "has a truck and strong arms", teaches: undefined },
  { tag: "pitch_feedback", label: "gives sharp pitch-deck feedback", teaches: "startups" },
  { tag: "interview_practice", label: "does mock interviews", teaches: "ai" },
  { tag: "photography_pro", label: "shoots portraits", teaches: "photography" },
  { tag: "tennis_coach", label: "strong tennis player", teaches: "tennis" },
  { tag: "hardware_eng", label: "electrical engineer", teaches: "hardware" },
  { tag: "climate_policy", label: "works in climate policy", teaches: "climate_tech" },
  { tag: "writing_editor", label: "edits writing", teaches: "writing" },
  { tag: "chess_strong", label: "rated chess player", teaches: "chess" },
];

export const EXTENDED_SKILLS: readonly SkillDef[] = [
  { tag: "producer_mixer", label: "produces and mixes music", teaches: "electronic_music" },
  { tag: "audio_engineer", label: "audio mastering engineer", teaches: "modular_synths" },
  { tag: "songwriter", label: "writes lyrics and melodies", teaches: "rock_music" },
  { tag: "director_writer", label: "writes and directs indie film", teaches: "film" },
  { tag: "cinematographer", label: "cinematographer and colorist", teaches: "film" },
  { tag: "illustrator_animator", label: "illustrates and animates", teaches: "painting" },
  { tag: "systems_engineer", label: "builds distributed systems", teaches: "ai" },
  { tag: "gtm_operator", label: "leads enterprise go-to-market", teaches: "startups" },
  { tag: "industrial_designer", label: "industrial and CAD designer", teaches: "hardware" },
  { tag: "biotech_scientist", label: "wet-lab biotech researcher", teaches: "biotech" },
  { tag: "ml_researcher", label: "publishes frontier AI research", teaches: "ai" },
  { tag: "angel_patron", label: "backs early founders and researchers", teaches: "startups" },
  { tag: "non_dilutive_patron", label: "funds independent science and arts", teaches: "biotech" },
  { tag: "woodworker", label: "builds cabinetry and furniture", teaches: "woodworking" },
  { tag: "home_repair_hvac", label: "skilled in electrical and home repair", teaches: "mutual_aid" },
  { tag: "bike_mechanic", label: "repairs and builds bicycles", teaches: "cycling" },
  { tag: "civic_organizer", label: "organizes local housing and civic drives", teaches: "urbanism" },
  { tag: "marathon_pacer", label: "paces marathon and endurance training", teaches: "running" },
  { tag: "spanish_native", label: "native Spanish speaker", teaches: "language_exchange" },
  { tag: "english_native", label: "native English speaker", teaches: "language_exchange" },
  { tag: "mandarin_native", label: "native Mandarin speaker", teaches: "language_exchange" },
  { tag: "french_native", label: "native French speaker", teaches: "language_exchange" },
  { tag: "japanese_native", label: "native Japanese speaker", teaches: "language_exchange" },
];

export const ALL_SKILLS: readonly SkillDef[] = [...SKILLS, ...EXTENDED_SKILLS];
export const skillDefByTag: ReadonlyMap<string, SkillDef> = new Map(ALL_SKILLS.map(s => [s.tag, s]));

export interface DesireDef {
  id: string; text: string; category: Category;
  needsSkills: string[];
  pool?: string;
  needsInterests: string[];
  format: "one_to_one" | "small_group" | "event";
}
export const DESIRES: DesireDef[] = [
  { id: "start_band", text: "start a rock band", category: "hobby", needsSkills: ["guitar", "drums", "bass", "vocals"], pool: "band", needsInterests: ["rock_music"], format: "small_group" },
  { id: "learn_sailing", text: "learn to sail", category: "growth", needsSkills: ["sailing_instructor"], needsInterests: ["sailing"], format: "one_to_one" },
  { id: "climbing_partner", text: "find a regular climbing partner", category: "hobby", needsSkills: ["climbing_belay"], pool: "climb", needsInterests: ["climbing"], format: "one_to_one" },
  { id: "tennis_partner", text: "find a weekend tennis partner", category: "hobby", needsSkills: ["tennis_coach"], pool: "tennis", needsInterests: ["tennis"], format: "one_to_one" },
  { id: "meet_founders", text: "meet other founders", category: "professional", needsSkills: ["fundraising", "design"], pool: "founders", needsInterests: ["startups"], format: "small_group" },
  { id: "climate_people", text: "meet people working in climate", category: "professional", needsSkills: ["climate_policy"], pool: "climate", needsInterests: ["climate_tech"], format: "small_group" },
  { id: "ai_mentor", text: "get advice from someone senior in AI", category: "professional", needsSkills: ["ml_engineering", "interview_practice"], needsInterests: ["ai"], format: "one_to_one" },
  { id: "new_friends", text: "make a few new friends in the city", category: "social", needsSkills: [], pool: "friends", needsInterests: [], format: "small_group" },
  { id: "dinner_club", text: "be part of a regular dinner group", category: "social", needsSkills: ["chef", "hosting"], pool: "dinner", needsInterests: ["cooking", "wine"], format: "small_group" },
  { id: "film_buddies", text: "find people to see films with", category: "social", needsSkills: [], pool: "film", needsInterests: ["film"], format: "event" },
  { id: "ceramics_class", text: "try ceramics", category: "growth", needsSkills: ["pottery_wheel"], pool: "ceramics", needsInterests: ["ceramics"], format: "small_group" },
  { id: "moving_help", text: "get help moving a couch", category: "help", needsSkills: ["moving_help"], needsInterests: [], format: "small_group" },
  { id: "pitch_feedback", text: "get feedback on a pitch deck", category: "help", needsSkills: ["pitch_feedback", "fundraising"], needsInterests: ["startups"], format: "one_to_one" },
  { id: "dating", text: "meet someone to date", category: "romance", needsSkills: [], pool: "romance", needsInterests: [], format: "one_to_one" },
  { id: "chess_games", text: "play chess over the board", category: "hobby", needsSkills: ["chess_strong"], pool: "chess", needsInterests: ["chess"], format: "one_to_one" },
  { id: "parent_friends", text: "meet other parents nearby", category: "social", needsSkills: [], pool: "parents", needsInterests: ["parenting"], format: "small_group" },
  { id: "run_club", text: "find people to run with", category: "hobby", needsSkills: [], pool: "run", needsInterests: ["running"], format: "small_group" },
  { id: "writing_group", text: "join a writing group", category: "growth", needsSkills: ["writing_editor"], pool: "writing", needsInterests: ["writing"], format: "small_group" },
  { id: "hardware_collab", text: "find a hardware collaborator for a side project", category: "professional", needsSkills: ["hardware_eng"], needsInterests: ["hardware"], format: "one_to_one" },
  { id: "photo_walks", text: "go on photo walks", category: "hobby", needsSkills: ["photography_pro"], pool: "photo", needsInterests: ["photography"], format: "small_group" },
];
export const desireById = new Map(DESIRES.map(d => [d.id, d]));

export const EXTENDED_DESIRES: readonly DesireDef[] = [
  { id: "step_ahead_career_mentor", text: "get 1-2 rung step-ahead mentorship in my craft", category: "professional", needsSkills: ["ml_engineering", "systems_engineer", "design", "gtm_operator", "fundraising"], needsInterests: ["ai", "startups"], format: "one_to_one" },
  { id: "creative_cocreation", text: "collaborate on an indie film, game, album or creative project", category: "hobby", needsSkills: ["producer_mixer", "director_writer", "cinematographer", "illustrator_animator", "songwriter"], pool: "cocreate", needsInterests: ["film", "indie_games", "electronic_music", "modular_synths"], format: "small_group" },
  { id: "music_production_pod", text: "find a producer, vocalist or audio engineer to finish tracks", category: "hobby", needsSkills: ["vocals", "producer_mixer", "audio_engineer", "songwriter"], pool: "music_pod", needsInterests: ["electronic_music", "rock_music"], format: "small_group" },
  { id: "patronage_sponsorship", text: "connect with a patron or research sponsor", category: "professional", needsSkills: ["angel_patron", "non_dilutive_patron", "ml_researcher", "biotech_scientist"], pool: "patronage", needsInterests: ["biotech", "ai"], format: "one_to_one" },
  { id: "intellectual_salon", text: "join a rigorous reading salon or debate circle", category: "social", needsSkills: ["ml_researcher", "biotech_scientist", "writing_editor"], pool: "salon", needsInterests: ["philosophy", "books", "physics_math", "history_economics"], format: "small_group" },
  { id: "habit_accountability", text: "find a consistent morning workout or sobriety accountability partner", category: "hobby", needsSkills: ["marathon_pacer", "climbing_belay"], pool: "accountability", needsInterests: ["running", "yoga", "meditation", "sobriety_wellness"], format: "one_to_one" },
  { id: "event_travel_companion", text: "find a concert, dining or backcountry expedition companion", category: "events", needsSkills: [], pool: "companion", needsInterests: ["live_music", "backcountry_travel", "film"], format: "event" },
  { id: "local_skill_swap", text: "trade neighborhood home repair, bike or practical skills", category: "help", needsSkills: ["home_repair_hvac", "bike_mechanic", "woodworker", "moving_help"], pool: "mutual_aid", needsInterests: ["mutual_aid", "gardening"], format: "one_to_one" },
  { id: "coliving_roommate", text: "find a compatible housemate or shared studio lease", category: "social", needsSkills: [], pool: "coliving", needsInterests: [], format: "one_to_one" },
  { id: "life_transition_peer", text: "connect with peers navigating a major life or career transition", category: "social", needsSkills: [], pool: "transition_peers", needsInterests: [], format: "small_group" },
  { id: "craft_maker_guild", text: "join a community woodshop, synth or maker guild", category: "hobby", needsSkills: ["woodworker", "pottery_wheel", "hardware_eng"], pool: "maker_guild", needsInterests: ["woodworking", "ceramics", "modular_synths", "robotics"], format: "small_group" },
  { id: "executive_peer_council", text: "join a confidential post-exit or senior founder council", category: "professional", needsSkills: ["fundraising", "gtm_operator"], pool: "exec_council", needsInterests: ["startups"], format: "small_group" },
  { id: "civic_action_coalition", text: "organize local urbanism, housing or park improvements", category: "social", needsSkills: ["civic_organizer", "climate_policy"], pool: "civic_coalition", needsInterests: ["urbanism", "volunteering", "gardening"], format: "small_group" },
  { id: "language_tandem", text: "practice weekly language exchange with a native speaker", category: "hobby", needsSkills: ["spanish_native", "english_native", "mandarin_native", "french_native", "japanese_native"], pool: "language_tandem", needsInterests: ["language_exchange"], format: "one_to_one" },
];

export const ALL_DESIRES: readonly DesireDef[] = [...DESIRES, ...EXTENDED_DESIRES];
export const allDesireById = new Map(ALL_DESIRES.map(d => [d.id, d]));

export const NEIGHBORHOODS: Record<City, string[]> = {
  sf: ["Mission", "Dolores Park", "SoMa", "Hayes Valley", "Noe Valley", "Sunset", "Richmond", "North Beach", "Castro", "Potrero Hill", "Bernal Heights", "Marina"],
  nyc: ["Williamsburg", "Bushwick", "East Village", "West Village", "Lower East Side", "Park Slope", "Greenpoint", "Harlem", "Astoria", "Chelsea", "Fort Greene", "Crown Heights"],
  la: ["Arts District", "Silver Lake", "Echo Park", "Los Feliz", "Koreatown", "West Hollywood", "Culver City", "Santa Monica", "Venice", "Highland Park"],
  chicago: ["The Loop", "West Loop", "River North", "Wicker Park", "Logan Square", "Lincoln Park", "Lakeview", "Uptown", "Hyde Park"],
  miami: ["Brickell", "Downtown", "Wynwood", "Design District", "Coconut Grove", "Coral Gables", "Little Havana", "South Beach", "Mid-Beach"],
};

const skillLabel = (tag: string) => skillDefByTag.get(tag)?.label ?? tag;

export function skillFirstPerson(tag: string): string {
  const l = skillLabel(tag);
  const [verb, ...rest] = l.split(" ");
  const verbs: Record<string, string> = {
    plays: "play", teaches: "teach", has: "have", loves: "love", gives: "give", does: "do", cooks: "cook",
    throws: "throw", shoots: "shoot", sings: "sing", edits: "edit", works: "work", produces: "produce",
    builds: "build", masters: "master", writes: "write", illustrates: "illustrate", directs: "direct",
    leads: "lead", publishes: "publish", backs: "back", funds: "fund", repairs: "repair",
    organizes: "organize", paces: "pace",
  };
  if (verbs[verb!]) return `I ${verbs[verb!]} ${rest.join(" ")}`.trim();
  return `I'm ${/^[aeiouAEIOU]|^ML/.test(l) ? "an" : "a"} ${l}`;
}
