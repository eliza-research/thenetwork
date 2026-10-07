// Objective taxonomy (engine-side product knowledge): what each kind of stated want needs from
// another member. Used by the structured complementarity term (complementarity.ts). Inputs are
// engine-visible only: an intent's objective text, its `details` ("tags: a,b" when the agent
// captured them) and goal/desire facets. Nothing here reads hidden truth.
//
// The vocabulary (skill / interest / pool tags) is the facet tag vocabulary the onboarding agent
// writes. In production the agent (an LLM extraction pass per profile update) would map free text
// into these ids; here a keyword pass stands in for it. CAVEAT: the synthetic personas and the
// simulator oracle use the same taxonomy (packages/sim/src/taxonomy.ts DESIRES), so on synthetic
// data this mapping is unusually clean; test/complementarity.test.ts pins the two together so
// they cannot drift silently.

export interface ObjectiveDef {
  id: string;
  /** Matched against the objective text (case-insensitive). */
  pattern: RegExp;
  /** Capability tags (skill / offer facets) in another member that satisfy this want. */
  needs: string[];
  /** Two members whose wants share a pool satisfy each other (shared-intent pooling). */
  pool?: string;
  /** Interest tags that make someone a decent companion for this want. */
  interests: string[];
  /** Romance is satisfied by mutual romance preferences, not by tags. */
  romance?: boolean;
}

export const OBJECTIVES: ObjectiveDef[] = [
  { id: "start_band", pattern: /\b(band|bandmates?|jam(ming)?)\b/i, needs: ["guitar", "drums", "bass", "vocals"], pool: "band", interests: ["rock_music"] },
  { id: "learn_sailing", pattern: /\bsail(ing)?\b/i, needs: ["sailing_instructor"], interests: ["sailing"] },
  { id: "climbing_partner", pattern: /\b(climb(ing)?|boulder(ing)?|belay)\b/i, needs: ["climbing_belay"], pool: "climb", interests: ["climbing"] },
  { id: "tennis_partner", pattern: /\btennis\b/i, needs: ["tennis_coach"], pool: "tennis", interests: ["tennis"] },
  { id: "meet_founders", pattern: /\b(founders?|co-?founders?)\b/i, needs: ["fundraising", "design"], pool: "founders", interests: ["startups"] },
  { id: "climate_people", pattern: /\bclimate\b/i, needs: ["climate_policy"], pool: "climate", interests: ["climate_tech"] },
  { id: "ai_mentor", pattern: /\b(senior|mentor\w*|advice)\b.*\b(ai|ml|machine learning)\b|\b(ai|ml|machine learning)\b.*\b(senior|mentor\w*|advice)\b/i, needs: ["ml_engineering", "interview_practice"], interests: ["ai"] },
  { id: "new_friends", pattern: /\b(new )?friends\b|\bmeet (some )?new people\b/i, needs: [], pool: "friends", interests: [] },
  { id: "dinner_club", pattern: /\b(dinner (group|club|party|parties)|supper club|regular dinners?)\b/i, needs: ["chef", "hosting"], pool: "dinner", interests: ["cooking", "wine"] },
  { id: "film_buddies", pattern: /\b(films?|movies?|cinema)\b/i, needs: [], pool: "film", interests: ["film"] },
  { id: "ceramics_class", pattern: /\b(ceramics|pottery)\b/i, needs: ["pottery_wheel"], pool: "ceramics", interests: ["ceramics"] },
  { id: "moving_help", pattern: /\b(mov(e|ing)\b.*\b(couch|sofa|furniture|boxes)|moving help)\b/i, needs: ["moving_help"], interests: [] },
  { id: "pitch_feedback", pattern: /\bpitch( ?deck)?\b/i, needs: ["pitch_feedback", "fundraising"], interests: ["startups"] },
  { id: "dating", pattern: /\b(date|dating|romance|romantic|partner to date)\b/i, needs: [], pool: "romance", interests: [], romance: true },
  { id: "chess_games", pattern: /\bchess\b/i, needs: ["chess_strong"], pool: "chess", interests: ["chess"] },
  { id: "parent_friends", pattern: /\b(parents?|parenting)\b/i, needs: [], pool: "parents", interests: ["parenting"] },
  { id: "run_club", pattern: /\b(run|running|runners?|jog(ging)?)\b/i, needs: [], pool: "run", interests: ["running"] },
  { id: "writing_group", pattern: /\b(writing|writers?)\b/i, needs: ["writing_editor"], pool: "writing", interests: ["writing"] },
  { id: "hardware_collab", pattern: /\bhardware\b/i, needs: ["hardware_eng"], interests: ["hardware"] },
  { id: "photo_walks", pattern: /\bphoto(s|graphy| ?walks?)?\b/i, needs: ["photography_pro"], pool: "photo", interests: ["photography"] },
];
export const objectiveById = new Map(OBJECTIVES.map(o => [o.id, o]));

/** Tags the agent wrote into intent details, e.g. "(format: small_group; tags: rock_music,guitar,band)". */
export function detailTags(details: string | undefined): string[] {
  const m = /\btags:\s*([a-z0-9_,\s]+)/i.exec(details ?? "");
  return m ? m[1]!.split(",").map(t => t.trim().toLowerCase()).filter(Boolean) : [];
}

/**
 * Objectives a stated want maps to. Order of evidence: the objective text; else the explicit
 * detail tags (an objective whose pool or needs appear there); else nothing. Free-text details
 * prose is deliberately not keyword-matched (too noisy: "after dinner", "run into").
 */
export function objectivesFor(text: string, details?: string, category?: string): ObjectiveDef[] {
  if (category === "romance") return [objectiveById.get("dating")!];
  const byText = OBJECTIVES.filter(o => !o.romance && o.pattern.test(text));
  if (byText.length) return byText;
  const tags = new Set(detailTags(details));
  if (!tags.size) return [];
  return OBJECTIVES.filter(o => !o.romance && ((o.pool && tags.has(o.pool)) || o.needs.some(n => tags.has(n))));
}

/**
 * Category semantics (v1.2). The engine uses "growth" for growing the Network (the network_growth
 * generator: asking a member to bring in someone who fills a gap). Members, and the simulator,
 * use "growth" for personal growth: "learn to sail", "try ceramics", "join a writing group".
 * Every intent generator skipped "growth" intents, so those wants were never matched
 * (docs/research/2026-10-07-match-failures-and-diversity.md, finding 4). A member intent is
 * personal growth unless its text is about growing the Network itself.
 */
const NETWORK_GROWTH_TEXT = /\b(invite|bring|grow|recruit|introduce)\b.*\b(network|community|members?|friends to (join|the network))\b/i;
export function isPersonalGrowth(i: { category: string; objective: string; details?: string }): boolean {
  return i.category === "growth" && !NETWORK_GROWTH_TEXT.test(`${i.objective} ${i.details ?? ""}`);
}
