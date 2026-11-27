import type { ObjectiveDef } from "../../pack.ts";
import type { ConnectionOntologyType } from "./vocabulary.ts";
export type { ObjectiveDef };

export interface ExtendedObjectiveDef extends ObjectiveDef {
  connectionType: ConnectionOntologyType;
  domain?: string;
  targetRungDelta?: readonly [number, number];
  crossClassGuild?: boolean;
  freeAnchor?: boolean;
  extended?: boolean;
}

export const OBJECTIVES: ExtendedObjectiveDef[] = [
  { id: "start_band", pattern: /\b(band|bandmates?|jam(ming)?)\b/i, needs: ["guitar", "drums", "bass", "vocals"], pool: "band", interests: ["rock_music"], connectionType: "creative_cocreation", domain: "music", crossClassGuild: true, freeAnchor: true },
  { id: "learn_sailing", pattern: /\bsail(ing)?\b/i, needs: ["sailing_instructor"], interests: ["sailing"], connectionType: "step_ahead_mentorship", domain: "sailing", targetRungDelta: [1, 2.5] },
  { id: "climbing_partner", pattern: /\b(climb(ing)?|boulder(ing)?|belay)\b/i, needs: ["climbing_belay"], pool: "climb", interests: ["climbing"], connectionType: "habit_accountability", domain: "climbing", crossClassGuild: true },
  { id: "tennis_partner", pattern: /\btennis\b/i, needs: ["tennis_coach"], pool: "tennis", interests: ["tennis"], connectionType: "habit_accountability", domain: "tennis", crossClassGuild: true, freeAnchor: true },
  { id: "meet_founders", pattern: /\b(founders?|co-?founders?)\b/i, needs: ["fundraising", "design"], pool: "founders", interests: ["startups"], connectionType: "work_hiring", domain: "startups" },
  { id: "climate_people", pattern: /\bclimate\b/i, needs: ["climate_policy"], pool: "climate", interests: ["climate_tech"], connectionType: "civic_action_coalition", domain: "climate", crossClassGuild: true, freeAnchor: true },
  { id: "ai_mentor", pattern: /\b(senior|mentor\w*|advice)\b.*\b(ai|ml|machine learning)\b|\b(ai|ml|machine learning)\b.*\b(senior|mentor\w*|advice)\b/i, needs: ["ml_engineering", "interview_practice"], interests: ["ai"], connectionType: "step_ahead_mentorship", domain: "ai", targetRungDelta: [1, 2.5], freeAnchor: true },
  { id: "new_friends", pattern: /\b(new )?friends\b|\bmeet (some )?new people\b/i, needs: [], pool: "friends", interests: [], connectionType: "friendship", domain: "social" },
  { id: "dinner_club", pattern: /\b(dinner (group|club|party|parties)|supper club|regular dinners?)\b/i, needs: ["chef", "hosting"], pool: "dinner", interests: ["cooking", "wine"], connectionType: "friendship", domain: "food" },
  { id: "film_buddies", pattern: /\b(films?|movies?|cinema)\b/i, needs: [], pool: "film", interests: ["film"], connectionType: "event_travel_companion", domain: "film" },
  { id: "ceramics_class", pattern: /\b(ceramics|pottery)\b/i, needs: ["pottery_wheel"], pool: "ceramics", interests: ["ceramics"], connectionType: "craft_maker_guild", domain: "ceramics", crossClassGuild: true },
  { id: "moving_help", pattern: /\b(mov(e|ing)\b.*\b(couch|sofa|furniture|boxes)|moving help)\b/i, needs: ["moving_help"], interests: [], connectionType: "local_mutual_aid", domain: "mutual_aid", crossClassGuild: true, freeAnchor: true },
  { id: "pitch_feedback", pattern: /\bpitch( ?deck)?\b/i, needs: ["pitch_feedback", "fundraising"], interests: ["startups"], connectionType: "step_ahead_mentorship", domain: "startups", targetRungDelta: [1, 2.5], freeAnchor: true },
  { id: "dating", pattern: /\b(date|dating|romance|romantic|partner to date)\b/i, needs: [], pool: "romance", interests: [], romance: true, connectionType: "dating", domain: "romance" },
  { id: "chess_games", pattern: /\bchess\b/i, needs: ["chess_strong"], pool: "chess", interests: ["chess"], connectionType: "craft_maker_guild", domain: "chess", crossClassGuild: true, freeAnchor: true },
  { id: "parent_friends", pattern: /\b(parents?|parenting)\b/i, needs: [], pool: "parents", interests: ["parenting"], connectionType: "parent_support_adult", domain: "parenting", crossClassGuild: true, freeAnchor: true },
  { id: "run_club", pattern: /\b(running|runners?|jog(ging)?|run club|run with|go for a run|morning run|trail run|5k|10k|marathon)\b/i, needs: [], pool: "run", interests: ["running"], connectionType: "habit_accountability", domain: "running", crossClassGuild: true, freeAnchor: true },
  { id: "writing_group", pattern: /\b(writing|writers?)\b/i, needs: ["writing_editor"], pool: "writing", interests: ["writing"], connectionType: "intellectual_salon", domain: "writing", crossClassGuild: true, freeAnchor: true },
  { id: "hardware_collab", pattern: /\b(hardware (eng\w*|hack\w*|projects?|prototypes?|startups?|build\w*|collab\w*|design)|electronics|pcb|embedded)\b/i, needs: ["hardware_eng"], interests: ["hardware"], connectionType: "creative_cocreation", domain: "hardware", crossClassGuild: true, freeAnchor: true },
  { id: "photo_walks", pattern: /\b(photography|photographers?|photo ?walks?|street photo\w*|film photo\w*|camera club)\b/i, needs: ["photography_pro"], pool: "photo", interests: ["photography"], connectionType: "craft_maker_guild", domain: "photography", crossClassGuild: true, freeAnchor: true },
  { id: "step_ahead_career_mentor", pattern: /\b(mentor(ship)?|career advice|one step ahead|step[- ]ahead|coach(ing)?)\b/i, needs: ["ml_engineering", "systems_engineer", "design", "gtm_operator", "fundraising", "interview_practice"], interests: ["startups", "ai"], connectionType: "step_ahead_mentorship", domain: "career", targetRungDelta: [1, 2.5], freeAnchor: true, extended: true },
  { id: "creative_cocreation", pattern: /\b(co-?creat\w*|indie (film|game)|short film|collaborat\w*.*(album|film|game|comic|zine)|soundtrack|cinematograph\w*)\b/i, needs: ["producer_mixer", "director_writer", "cinematographer", "illustrator_animator", "songwriter", "audio_engineer"], pool: "cocreate", interests: ["film", "indie_games", "electronic_music", "modular_synths"], connectionType: "creative_cocreation", domain: "creative", crossClassGuild: true, freeAnchor: true, extended: true },
  { id: "music_production_pod", pattern: /\b(music produc\w*|vocalist|beatmaker|mix(ing)? engineer|modular synth|finish tracks)\b/i, needs: ["vocals", "producer_mixer", "audio_engineer", "songwriter"], pool: "music_pod", interests: ["electronic_music", "modular_synths", "rock_music"], connectionType: "creative_cocreation", domain: "music", crossClassGuild: true, freeAnchor: true, extended: true },
  { id: "patronage_sponsorship", pattern: /\b(patron(age)?|sponsor(ship)?|research grant|non[- ]dilutive|angel (check|backing)|back(ing)? (independent|research|artists?))\b/i, needs: ["angel_patron", "non_dilutive_patron", "ml_researcher", "biotech_scientist"], pool: "patronage", interests: ["biotech", "ai", "physics_math"], connectionType: "patronage_sponsorship", domain: "science", targetRungDelta: [0, 3], freeAnchor: true, extended: true },
  { id: "intellectual_salon", pattern: /\b(salon|reading (circle|group)|book club|philosophy (circle|group)|debate circle|study group)\b/i, needs: ["ml_researcher", "biotech_scientist", "writing_editor"], pool: "salon", interests: ["philosophy", "books", "physics_math", "history_economics"], connectionType: "intellectual_salon", domain: "ideas", crossClassGuild: true, freeAnchor: true, extended: true },
  { id: "habit_accountability", pattern: /\b(accountability|6 ?am (run|gym|workout)|sobriety|alcohol[- ]free|training partner|marathon prep)\b/i, needs: ["marathon_pacer", "climbing_belay"], pool: "accountability", interests: ["running", "yoga", "meditation", "sobriety_wellness"], connectionType: "habit_accountability", domain: "wellness", crossClassGuild: true, freeAnchor: true, extended: true },
  { id: "event_travel_companion", pattern: /\b(concert buddy|show companion|travel (buddy|companion)|backcountry|expedition|festival buddy)\b/i, needs: [], pool: "companion", interests: ["live_music", "backcountry_travel", "film"], connectionType: "event_travel_companion", domain: "events", extended: true },
  { id: "local_skill_swap", pattern: /\b(skill swap|mutual aid|tool library|bike repair|home repair|fix my|handyman swap)\b/i, needs: ["home_repair_hvac", "bike_mechanic", "woodworker", "moving_help"], pool: "mutual_aid", interests: ["mutual_aid", "gardening", "cycling"], connectionType: "local_mutual_aid", domain: "mutual_aid", crossClassGuild: true, freeAnchor: true, extended: true },
  { id: "coliving_roommate", pattern: /\b(roommate|housemate|co-?living|shared (lease|studio|apartment))\b/i, needs: [], pool: "coliving", interests: [], connectionType: "coliving_roommate", domain: "housing", freeAnchor: true, extended: true },
  { id: "life_transition_peer", pattern: /\b(just moved|new in town|post[- ]exit|career pivot|post[- ]divorce|empty nest|life transition)\b/i, needs: [], pool: "transition_peers", interests: [], connectionType: "life_transition_peer", domain: "transition", crossClassGuild: true, freeAnchor: true, extended: true },
  { id: "craft_maker_guild", pattern: /\b(woodwork\w*|woodshop|maker ?space|maker guild|robotics club|fermentation|sourdough|craft guild)\b/i, needs: ["woodworker", "pottery_wheel", "hardware_eng", "industrial_designer"], pool: "maker_guild", interests: ["woodworking", "ceramics", "modular_synths", "robotics", "fermentation"], connectionType: "craft_maker_guild", domain: "craft", crossClassGuild: true, freeAnchor: true, extended: true },
  { id: "executive_peer_council", pattern: /\b(executive (council|peers?)|post[- ]exit (founders?|peers?)|ceo peer|founder council|chatham house)\b/i, needs: ["fundraising", "gtm_operator", "angel_patron"], pool: "exec_council", interests: ["startups"], connectionType: "executive_peer_council", domain: "startups", targetRungDelta: [-0.75, 0.75], extended: true },
  { id: "civic_action_coalition", pattern: /\b(urbanis[mt]|yimby|housing coalition|park cleanup|community garden|transit advocacy|civic (action|working group)|volunteer crew)\b/i, needs: ["civic_organizer", "climate_policy"], pool: "civic_coalition", interests: ["urbanism", "volunteering", "gardening", "climate_tech"], connectionType: "civic_action_coalition", domain: "civic", crossClassGuild: true, freeAnchor: true, extended: true },
  { id: "language_tandem", pattern: /\b(language (exchange|tandem|partner)|practice (spanish|mandarin|french|japanese|english|portuguese|korean|german)|hablar espa[nñ]ol|conversational practice)\b/i, needs: ["spanish_native", "english_native", "mandarin_native", "french_native", "japanese_native"], pool: "language_tandem", interests: ["language_exchange"], connectionType: "language_tandem", domain: "language", crossClassGuild: true, freeAnchor: true, extended: true },
];
export const objectiveById = new Map(OBJECTIVES.map(o => [o.id, o]));

const DETAIL_TAGS = /\btags:\s*([a-z0-9_,\s]+)/i;

export function detailTags(details: string | undefined): string[] {
  const m = DETAIL_TAGS.exec(details ?? "");
  return m ? m[1]!.split(",").map(t => t.trim().toLowerCase()).filter(Boolean) : [];
}

export function detailProse(details: string | undefined): string {
  return (details ?? "").replace(DETAIL_TAGS, "");
}

export function isMoonshotColdAsk(it: { objective?: string; details?: string }): boolean {
  return detailTags(it.details).includes("moonshot_8rung");
}

export function isHypePitchIntent(it: { details?: string }): boolean {
  return detailTags(it.details).includes("hype_pitch");
}

export function isFreeLowCostIntent(it: { details?: string }): boolean {
  return detailTags(it.details).includes("free_low_cost");
}

export function isStepAheadPeerIntent(it: { details?: string }): boolean {
  return detailTags(it.details).includes("step_ahead_peer");
}

export function objectivesFor(text: string, details?: string, category?: string): ExtendedObjectiveDef[] {
  if (category === "romance") return [objectiveById.get("dating")!];
  const tags = new Set(detailTags(details));
  if (tags.has("moonshot_8rung") || tags.has("step_ahead_peer")) return [objectiveById.get("step_ahead_career_mentor")!];
  const byText = OBJECTIVES.filter(o => !o.romance && o.pattern.test(text));
  if (byText.length) return byText;
  if (!tags.size) return [];
  return OBJECTIVES.filter(o => !o.romance && (tags.has(o.id) || (o.pool && tags.has(o.pool)) || (!o.extended && o.needs.some(n => tags.has(n)))));
}

export function connectionTypeForObjective(id: string): ConnectionOntologyType {
  return objectiveById.get(id)?.connectionType ?? "friendship";
}

export function connectionTypeForIntent(i: { objective: string; details?: string; category: string }): ConnectionOntologyType {
  if (i.category === "romance") return "dating";
  const defs = objectivesFor(i.objective, i.details, i.category);
  if (defs.length > 0) return defs[0]!.connectionType;
  switch (i.category) {
    case "professional": return "work_hiring";
    case "help": return "local_mutual_aid";
    case "events": return "event_travel_companion";
    case "hobby": return "craft_maker_guild";
    case "growth": return "step_ahead_mentorship";
    default: return "friendship";
  }
}

const NETWORK_GROWTH_TEXT = /\b(invite|bring|grow|recruit|introduce)\b.*\b(network|community|members?|friends to (join|the network))\b/i;
export function isPersonalGrowth(i: { category: string; objective: string; details?: string }): boolean {
  return i.category === "growth" && !NETWORK_GROWTH_TEXT.test(`${i.objective} ${i.details ?? ""}`);
}
