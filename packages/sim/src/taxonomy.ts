// Vocabulary for synthetic personas: interests, skills, desires, neighborhoods, names,
// private disclosures. Tags are the shared language between hidden truth and the oracle.
import type { Category, City } from "@thenetwork/core";

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

export interface DesireDef {
  id: string; text: string; category: Category;
  /** Skills in another person that would satisfy this desire. */
  needsSkills: string[];
  /** Two people with the same pool tag can satisfy each other (shared-intent pooling). */
  pool?: string;
  /** Interests that make someone a good companion for this desire. */
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

export const NEIGHBORHOODS: Record<City, string[]> = {
  sf: ["Mission", "Dolores Park", "SoMa", "Hayes Valley", "Noe Valley", "Sunset", "Richmond", "North Beach", "Castro", "Potrero Hill", "Bernal Heights", "Marina"],
  nyc: ["Williamsburg", "Bushwick", "East Village", "West Village", "Lower East Side", "Park Slope", "Greenpoint", "Harlem", "Astoria", "Chelsea", "Fort Greene", "Crown Heights"],
  la: [], // the Network simulator generates sf / nyc personas only
};

export const FIRST_NAMES = [
  "Maya", "Sam", "Theo", "Priya", "Jonah", "Lena", "Marcus", "Aiko", "Diego", "Nora", "Felix", "Imani",
  "Ravi", "Hana", "Owen", "Sofia", "Kofi", "Elena", "Jun", "Talia", "Mateo", "Zara", "Eli", "Noor",
  "Ines", "Caleb", "Yara", "Arjun", "Mira", "Luca", "Amara", "Ezra", "Wren", "Tomas", "Leila", "Kai",
  "Bea", "Omar", "Iris", "Rafael", "Jade", "Nikhil", "Ada", "Hugo", "Sana", "Milo", "Vera", "Dev",
  "Rosa", "Finn", "Lucia", "Idris", "Gwen", "Pablo", "Esme", "Anton", "Tessa", "Kenji", "Maren", "Silas",
];
export const LAST_NAMES = [
  "Okafor", "Chen", "Alvarez", "Nakamura", "Patel", "Kowalski", "Haddad", "Reyes", "Lindqvist", "Mensah",
  "Rossi", "Kim", "Fischer", "Abara", "Novak", "Sato", "Delgado", "Byrne", "Ivanova", "Osei", "Moreau",
  "Takahashi", "Silva", "Nguyen", "Hoffman", "Larsen", "Mehta", "Quinn", "Barros", "Yilmaz",
];

/** Agent-private disclosures. Each persona that has one also gets a unique canary token. */
export const PRIVATE_DISCLOSURES = [
  "is going through a divorce and doesn't want anyone to know yet",
  "is recovering from a burnout leave from work",
  "is quietly looking for a new job while still employed",
  "has a chronic illness that limits late nights",
  "is in early recovery from alcohol and avoids bars",
  "is grieving a parent who died this spring",
  "is in therapy for social anxiety",
  "is behind on rent and stressed about money",
];

export const BOUNDARIES = [
  "no bars or heavy drinking", "nothing after 9pm on weeknights", "no networking-heavy events",
  "prefers groups over one-on-one with strangers", "no loud venues", "no early mornings",
  "doesn't want to talk about work", "no romantic setups unless asked",
];

export const STYLES = ["terse", "chatty", "warm", "sarcastic", "formal", "emoji-heavy", "lowercase-casual", "non-native English"] as const;
export type WritingStyle = (typeof STYLES)[number];
