// Shared label definitions and zod schemas. The SAME guides are given to the data generator
// (which is told the label) and to the production model (which must predict it).
import { z } from "zod";

// ---------------------------------------------------------------- P12 strict extraction
export const CATEGORIES = ["social", "professional", "romance", "hobby", "help", "events", "growth"] as const;
export const STATES = ["pause", "quiet", "open", "normal"] as const;
export const SENSITIVE_TOPICS = [
  "physical_health", "mental_health", "sexual_orientation_gender", "finances", "immigration_status",
  "pregnancy_fertility", "breakup_divorce", "religion", "substance_use", "legal_trouble", "loneliness", "other_sensitive",
] as const;
export const SCOPES = ["agent_private", "matchable", "shareable"] as const;

export const Extraction = z.object({
  city: z.enum(["sf", "nyc", "other"]).nullable(),
  intents: z.array(z.object({ category: z.enum(CATEGORIES), objective: z.string().max(200) }).strict()).max(5),
  state_change: z.enum(STATES).nullable(),
  romance_opt_in: z.enum(["opt_in", "opt_out"]).nullable(),
  quiet_hours: z.object({ start: z.number().int().min(0).max(23).nullable(), end: z.number().int().min(0).max(23).nullable() }).strict().nullable(),
  age_signal: z.enum(["under_18", "adult"]).nullable(),
  sensitive: z.array(z.object({ topic: z.enum(SENSITIVE_TOPICS), scope: z.enum(SCOPES), summary: z.string().max(200) }).strict()).max(5),
}).strict();
export type Extraction = z.infer<typeof Extraction>;

/** extract.v1 rules (kept so cached v1 runs stay reproducible). */
export const EXTRACTION_GUIDE_V1 = `Field rules (strict pass; when in doubt use null / empty, never guess):
- city: where the member LIVES now. "sf" = San Francisco Bay Area (SF neighborhoods, Oakland, Berkeley). "nyc" = the five boroughs (Brooklyn/bk, Queens, LES, Harlem, etc). "other" = lives somewhere else. null if not stated or only visiting / grew up / traveling there.
- intents: things the member wants the Network to find or help with (people, activities, help, events, growth). category one of social (friends, hanging out), professional (work, cofounders, investors, collaborators, jobs), romance (ONLY if they explicitly ask for dating/romantic matches), hobby (activity partners: sports, music, games, crafts), help (a bounded one-off favor: moving, feedback on a deck), events (things to do / events to attend), growth (learning, mentors, practice, accountability). objective = short paraphrase. Empty if none.
- state_change: participation state the member asks for. "pause" = stop / take a break / don't message me for a while. "quiet" = fewer messages, only important stuff, busy/slammed. "open" = send more, surprise me, I have lots of time / ready to mingle. "normal" = back to normal / unpause / resume. null if nothing about how often the Network contacts them (e.g. pausing a gym membership is NOT a state change).
- romance_opt_in: "opt_in" ONLY for an explicit request to receive dating / romantic matches. "opt_out" for an explicit "no dating / keep it platonic / I'm taken, no romance". null otherwise: mentioning a partner, an ex, a bad date, dating apps, a friend who dates, or vague "meet someone special" hints are all null.
- quiet_hours: times the member does not want messages, as local 24h hours. start = hour messages must stop, end = hour they may resume. "not after 9pm" -> {start:21,end:null}; "nothing before 8am" -> {start:null,end:8}; "no texts 11pm-7am" -> {start:23,end:7}. null if not mentioned (working late is not quiet hours).
- age_signal: about the MEMBER themself only. "under_18" if they indicate being a minor (high-school grade, "I'm 16", "my mom says I can't..."). "adult" if they state an age 18+ or an unambiguously adult status (e.g. "I'm 34", retired, "my kids"). null if no signal. A child's or student's grade, or teaching a grade, is NOT the member's age.
- sensitive: each sensitive personal disclosure by the member about themself (health, mental health, sexual orientation / gender identity, finances or debt, immigration status, pregnancy/fertility, breakup/divorce, religion, substance use, legal trouble, loneliness, other intimate matters). Sensitive disclosures are ALWAYS scope "agent_private" (they may inform the member's own agent but must never be revealed or implied to others). summary = short neutral paraphrase. Empty if none.`;

/** extract.v2 rules: tightened adult signal + one documented meet-people rule. */
export const EXTRACTION_GUIDE = `Field rules (strict pass; when in doubt use null / empty, never guess):
- city: where the member LIVES now. "sf" = San Francisco Bay Area (SF neighborhoods, Oakland, Berkeley). "nyc" = the five boroughs (Brooklyn/bk, Queens, LES, Harlem, etc). "other" = lives somewhere else. null if not stated or only visiting / grew up / traveling there.
- intents: things the member wants the Network to find or help with (people, activities, help, events, growth). category one of social (new friends, people to hang out with; see the meet-people rule below), professional (work, cofounders, investors, collaborators, jobs), romance (ONLY if they explicitly ask for dating/romantic matches), hobby (activity partners: sports, music, games, crafts), help (a bounded one-off favor: moving, feedback on a deck), events (things to do / events to attend), growth (learning, mentors, practice, accountability). objective = short paraphrase. Empty if none.
  Meet-people rule (one rule for generic "meet people" wording): add social ONLY when meeting people / making friends / having people to hang out with is itself requested as a goal ("help me make friends here", "want to meet new people in my neighborhood", "looking for a crew to hang out with on weekends"). Do NOT add social when the people serve another intent ("meet founders" -> professional; "find people to start a band / play tennis / book club" -> hobby; "friends only, no dating" is a qualifier, not a new intent), when it is background, motivation or a side remark ("trying to stay active and meet people", "it's hard to meet people here", "I'm lonely", "build community"), when it is about future availability ("I'll tell you when I'm free to meet people again"), during a visit to another city, or about someone else.
- state_change: participation state the member asks for. "pause" = stop / take a break / don't message me for a while. "quiet" = fewer messages, only important stuff, busy/slammed. "open" = send more, surprise me, I have lots of time / ready to mingle. "normal" = back to normal / unpause / resume. null if nothing about how often the Network contacts them (e.g. pausing a gym membership is NOT a state change).
- romance_opt_in: "opt_in" ONLY for an explicit request to receive dating / romantic matches. "opt_out" for an explicit "no dating / keep it platonic / I'm taken, no romance". null otherwise: mentioning a partner, an ex, a bad date, dating apps, a friend who dates, or vague "meet someone special" hints are all null.
- quiet_hours: times the member does not want messages, as local 24h hours. start = hour messages must stop, end = hour they may resume. "not after 9pm" -> {start:21,end:null}; "nothing before 8am" -> {start:null,end:8}; "no texts 11pm-7am" -> {start:23,end:7}. null if not mentioned (working late is not quiet hours).
- age_signal: about the MEMBER themself only. "under_18" if they state their own minor age or school status (own high-school grade, "I'm 16", "my mom won't let me..."). "adult" ONLY if they state their own age of 18+ ("I'm 34", "just turned 41", "my 27th birthday") or an own status that by definition requires adulthood (retired, grandparent). Everything that only makes adulthood likely gives null: a job or role (teacher, coach, founder, manager), having or mentioning children ("my kids", "my daughter is in 10th grade"), a spouse, students, siblings, or anyone else's age or grade.
- sensitive: each sensitive personal disclosure by the member about themself (health, mental health, sexual orientation / gender identity, finances or debt, immigration status, pregnancy/fertility, breakup/divorce, religion, substance use, legal trouble, loneliness, other intimate matters). Sensitive disclosures are ALWAYS scope "agent_private" (they may inform the member's own agent but must never be revealed or implied to others). summary = short neutral paraphrase. Empty if none.`;

// ---------------------------------------------------------------- P10 action routing
export const ACTIONS = [
  "UPDATE_PROFILE", "MANAGE_INTENT", "ASK_NETWORK", "RESPOND_TO_OPPORTUNITY", "RELAY_MESSAGE", "SHARE_CONTACT",
  "SCHEDULE", "SET_STATE", "INVITE_PERSON", "BLOCK_OR_REPORT", "GIVE_FEEDBACK", "CONCIERGE_SEARCH", "NONE",
] as const;
export const ROUTES = ["information", "recommendation", "standing_intent", "human_opportunity", "none"] as const;
export type Action = (typeof ACTIONS)[number];
export type Route = (typeof ROUTES)[number];

export const Routing = z.object({ action: z.enum(ACTIONS), route: z.enum(ROUTES) }).strict();
export type Routing = z.infer<typeof Routing>;

export const ACTION_GUIDE = `Pick exactly ONE primary action for the member's latest message, using the conversation context.
- UPDATE_PROFILE: member tells facts about themself (job, neighborhood, interests, skills, availability habits) or corrects/removes what the agent knows, without asking for anything.
- MANAGE_INTENT: member creates a STANDING, open-ended want to be matched over time ("I want to start a band", "looking for a regular tennis partner", "want to meet climate founders"), or lists / edits / pauses / closes an existing standing intent.
- ASK_NETWORK: a specific, bounded ask that needs a PERSON from the Network soon: a help request ("need help moving a couch Saturday"), an intro to someone with specific expertise ("introduce me to someone who knows hardware"), a member-to-member intro request ("you'd like my friend Theo, he's a member"), or a group activity with people this week.
- CONCIERGE_SEARCH: asks about places, events, things to do, or facts that search / maps / event listings can answer without involving a person.
- RESPOND_TO_OPPORTUNITY: accepts, declines, says maybe, asks a question about, or counter-proposes a time for a PENDING invitation the agent sent (an intro/group/event offer not yet accepted).
- RELAY_MESSAGE: content the member wants passed to another member in an existing relay thread, including "running late" notes. (Not time changes, not contact sharing.)
- SHARE_CONTACT: member wants to share or exchange their own phone/contact with a member they've been connected to (or stop sharing it).
- SCHEDULE: availability, picking / changing / cancelling the time or venue of an already-ACCEPTED meetup.
- SET_STATE: how often / when / about what the Network contacts them: pause, quiet, open, resume, quiet hours, per-category notification preferences ("only tell me about music stuff").
- INVITE_PERSON: member wants to invite or vouch for someone who is NOT yet a member.
- BLOCK_OR_REPORT: block someone, report harassment / unsafe / creepy behavior, or raise a safety concern about a person.
- GIVE_FEEDBACK: how a meetup / intro / suggestion went, or whether a message was worth it ("was fun", "not my vibe", "that suggestion was off"), without asking to block or report.
- NONE: greetings, thanks, small talk, questions about how the Network works or what it knows about them, unclear messages.
Route (F8) applies only when the member asks the Network for something:
- information: a factual lookup answerable with search/maps (hours, where is X, how to). action CONCIERGE_SEARCH.
- recommendation: wants suggestions of places/events/things to do for them. action CONCIERGE_SEARCH.
- standing_intent: creates an open-ended want to be matched over time. action MANAGE_INTENT.
- human_opportunity: needs a person now (help request, intro, group). action ASK_NETWORK.
- none: everything else (including MANAGE_INTENT list/pause/close, and all other actions).`;

// ---------------------------------------------------------------- P10 turn: proposed structured actions (injection test)
const Ev = z.string().max(300); // verbatim evidence span from the MEMBER's own message
export const ProposedAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("UPDATE_PROFILE"), evidence: Ev, facets: z.array(z.object({ kind: z.enum(["interest", "skill", "fact", "preference", "availability_pattern", "goal"]), value: z.string().max(200) }).strict()).max(5) }).strict(),
  z.object({ type: z.literal("MANAGE_INTENT"), evidence: Ev, op: z.enum(["create", "pause", "close", "list"]), objective: z.string().max(200).optional() }).strict(),
  z.object({ type: z.literal("ASK_NETWORK"), evidence: Ev, ask: z.string().max(300) }).strict(),
  z.object({ type: z.literal("RESPOND_TO_OPPORTUNITY"), evidence: Ev, opportunity_id: z.string(), response: z.enum(["accept", "decline", "maybe", "question", "counter"]) }).strict(),
  z.object({ type: z.literal("RELAY_MESSAGE"), evidence: Ev, thread_id: z.string(), text: z.string().max(500) }).strict(),
  z.object({ type: z.literal("SHARE_CONTACT"), evidence: Ev, thread_id: z.string() }).strict(),
  z.object({ type: z.literal("SCHEDULE"), evidence: Ev, thread_id: z.string(), proposal: z.string().max(200) }).strict(),
  z.object({ type: z.literal("SET_STATE"), evidence: Ev, state: z.enum(["pause", "quiet", "open", "normal"]).optional(), quiet_hours: z.object({ start: z.number().int().nullable(), end: z.number().int().nullable() }).strict().optional() }).strict(),
  z.object({ type: z.literal("SET_ROMANCE_OPT_IN"), evidence: Ev, value: z.boolean() }).strict(),
  z.object({ type: z.literal("INVITE_PERSON"), evidence: Ev, name: z.string().max(100), contact: z.string().max(100).optional() }).strict(),
  z.object({ type: z.literal("BLOCK_OR_REPORT"), evidence: Ev, member_ref: z.string(), kind: z.enum(["block", "report"]) }).strict(),
  z.object({ type: z.literal("GIVE_FEEDBACK"), evidence: Ev, about: z.string(), sentiment: z.enum(["positive", "neutral", "negative"]) }).strict(),
  z.object({ type: z.literal("CONCIERGE_SEARCH"), evidence: Ev, query: z.string().max(200) }).strict(),
]);
export type ProposedAction = z.infer<typeof ProposedAction>;
export const Turn = z.object({ actions: z.array(ProposedAction).max(4), reply_brief: z.string().max(600) }).strict();
export type Turn = z.infer<typeof Turn>;
